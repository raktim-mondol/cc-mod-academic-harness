// The tool host: loads upstream tool modules and answers Claude Code over MCP.
//
// Two parts, kept apart so tests can use the first without the second:
//   createHost()  loads the modules into a registry and runs a call
//   serve()       the stdio MCP loop (newline-delimited JSON-RPC)
//
// Standard output belongs to the protocol. Everything else goes to stderr.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createContext, Registry } from './context.mjs'
import { createJobs, DEFAULT_KEEP_DAYS } from './jobs.mjs'
import { createLlm, DEFAULT_BUDGET_USD, DEFAULT_MODEL } from './llm.mjs'
import { doctorTool } from './doctortool.mjs'
import { jobTools } from './jobtools.mjs'
import { modHome, modRoot } from './paths.mjs'
import { makeExec, sessionIdFrom } from './exec.mjs'
import { parseAreas, plan, restoreList } from './manifest.mjs'
import { autoProviders } from './fit.mjs'
import { webTools } from './webtools.mjs'
import { adaptPaperMcpTool, approvalStub, pluginMounter } from './mcpjson.mjs'
import { seedPacing } from './pacing.mjs'
import { seenDir } from './compat.mjs'
import { adapt, blocksToContent, clip, DEFAULT_MAX_CHARS, DEFAULT_OUTPUT_KEEP_DAYS, fixSkillSearch, pruneOutputDir } from './render.mjs'
import { listedSkills } from './skills-list.mjs'
import { createUsage, DEFAULT_KEEP_DAYS as USAGE_KEEP_DAYS, usageDir, usageEnabled } from './usage.mjs'
import { toInputSchema } from './schema.mjs'
import { describeIssues, issuePaths, validateArgs, validationMode } from './validate.mjs'

export const SERVER_NAME = 'ah'
/** The plugin's version, read from its manifest so the two cannot drift apart. */
export const SERVER_VERSION = (() => {
  try { return String(JSON.parse(readFileSync(join(modRoot(), '.claude-plugin', 'plugin.json'), 'utf8')).version) } catch { return '0.0.0' }
})()
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
/** Tools whose work is long: the host runs them as jobs and answers the call after a foreground window (AH_JOB_FOREGROUND_MS). */
export const DETACHED_TOOLS = new Set(['deep_research', 'deep_review', 'analysis_run'])
/** Tools that block for as long as they rent hardware for (up to an hour, plus provisioning). */
export const SLOW_TOOLS = new Map([['modal_run', 65 * 60_000], ['runpod_run', 65 * 60_000], ['vastai_run', 65 * 60_000]])
export const DEFAULT_FOREGROUND_MS = 30_000

const log = msg => process.stderr.write(`[academic-harness] ah: ${msg}\n`)

export function missingDependencies(upstream) {
  return existsSync(join(upstream, 'node_modules', 'ah-dsh-tools')) ? null : `dependencies are not installed. Run: node scripts/install-deps.mjs (it runs npm ci inside ${upstream}).`
}

/**
 * Ground rule 2: upstream modules read `process.env.DSH_HOME` and install into it, seed it and write ledgers there. It must be the
 * mod's own home, never DSH's. Refuse to load a module otherwise.
 */
export function assertSafeHome(env = process.env) {
  const home = env.DSH_HOME?.trim()
  if (!home) throw new Error('DSH_HOME is not set: the tool host must point it at the mod\'s own home (prepareEnv) before it loads an upstream module.')
  if (resolve(home) === resolve(homedir(), '.dsh')) throw new Error('DSH_HOME is the real DeepSeek Harness home (~/.dsh). The tool host never uses it: set AH_MOD_HOME.')
}

export async function createHost({ upstream, areas = 'all', env = process.env, cwd = process.cwd(), logger = log } = {}) {
  // Deliberately process.env, not `env`: the upstream modules read process.env, so that is the home that must be safe.
  assertSafeHome(process.env)
  const problem = missingDependencies(upstream)
  if (problem) throw new Error(problem)
  const { areas: wanted, unknown } = parseAreas(areas)
  if (unknown.length) logger(`unknown tool area(s) ignored: ${unknown.join(', ')}`)
  // The shell variable and the plugin setting (AH_RESTORE_TOOLS_SETTING, empty when unset) both count.
  const { restore: named, unknown: unknownRestore } = restoreList(`${env.AH_RESTORE_TOOLS ?? ''},${env.AH_RESTORE_TOOLS_SETTING ?? ''}`)
  // A search provider whose key is set comes back without being named (fit.mjs autoProviders).
  const restore = [...new Set([...named, ...autoProviders(env)])]
  if (unknownRestore.length) logger(`restore_tools names no tool that can come back, ignored: ${unknownRestore.join(', ')}`)
  const { load, missing } = plan(upstream, wanted, { restore })
  if (missing.length) logger(`expected modules not in the core: ${missing.join(', ')}`)

  // Before any upstream module loads: the first limiter made for a provider is the one every tool shares (pacing.mjs).
  const paced = await seedPacing(upstream, process.env)
  if (paced.s2) logger(`Semantic Scholar paced at one request every ${paced.s2} ms across all tools`)

  const registry = new Registry()
  const sessionId = sessionIdFrom(env)
  const jobs = createJobs({ dir: join(modHome(env), 'jobs'), session: sessionId ?? null, cwd })
  // Old records go when a server starts (AH_JOBS_KEEP_DAYS, default 30; 0 keeps everything).
  try {
    const keep = env.AH_JOBS_KEEP_DAYS?.trim()
    const gone = jobs.prune({ keepDays: keep !== undefined && keep !== '' && Number(keep) >= 0 ? Number(keep) : DEFAULT_KEEP_DAYS })
    if (gone) logger(`removed ${gone} job record${gone === 1 ? '' : 's'} that ended long ago`)
  } catch { /* housekeeping must not stop the server */ }
  // The records the hooks module leaves, one per session (compat.mjs): a week is longer than any session worth checking.
  pruneOutputDir(seenDir(modHome(env)), { keepDays: 7, ext: '.json' })
  // Usage counts (usage.mjs): names and numbers, kept for a year (AH_USAGE_KEEP_DAYS; 0 keeps everything).
  let usage = null
  if (usageEnabled(env)) {
    const keepRaw = env.AH_USAGE_KEEP_DAYS?.trim()
    pruneOutputDir(usageDir(modHome(env)), { keepDays: keepRaw !== undefined && keepRaw !== '' && Number(keepRaw) >= 0 ? Number(keepRaw) : USAGE_KEEP_DAYS, ext: '.json' })
    usage = createUsage({ dir: usageDir(modHome(env)), id: `srv-${process.pid}-${Date.now().toString(36)}` })
  }
  const budget = Number(env.AH_LLM_BUDGET_USD)
  const llm = createLlm({ model: env.AH_LLM_MODEL?.trim() || DEFAULT_MODEL, budgetUsd: budget > 0 ? budget : DEFAULT_BUDGET_USD, cwd, env })
  // paper_mcp registers its servers with Claude Code through the project's .mcp.json (mcpjson.mjs); `workspace.cwd` follows the session directory.
  const workspace = { cwd }
  const services = { jobs, llm, plugin: pluginMounter(workspace), optional: { approval: approvalStub } }
  const loaded = []
  const failed = []
  for (const entry of load) {
    try {
      const mod = await import(pathToFileURL(join(upstream, entry.file)).href)
      const apply = mod[entry.fn] ?? mod.default?.[entry.fn]
      if (typeof apply !== 'function') throw new Error(`no export "${entry.fn}"`)
      const before = registry.tools.size
      await apply(createContext(registry, { log: logger, module: entry.file, services }), {})
      loaded.push({ file: entry.file, area: entry.area, tools: registry.tools.size - before })
    } catch (error) {
      failed.push({ file: entry.file, error: String(error?.message ?? error).split('\n')[0] })
      logger(`${entry.file} did not load: ${String(error?.message ?? error).split('\n')[0]}`)
    }
  }

  let bindParentJob = () => () => {}
  const runner = join(upstream, 'job-runner.js')
  if (existsSync(runner)) ({ bindParentJob } = await import(pathToFileURL(runner).href))
  let fence
  const fencePath = join(upstream, 'untrusted-fence.js')
  if (existsSync(fencePath)) ({ fenceUntrusted: fence } = await import(pathToFileURL(fencePath).href))
  // paper_mcp says what really happens here: the entry goes into .mcp.json, and Claude Code asks before it starts the server.
  const paperMcp = registry.tools.get('paper_mcp')
  if (paperMcp) adaptPaperMcpTool(paperMcp, workspace)
  return hostOver(registry, { loaded, failed, env, cwd, jobs, llm, usage, bindParentJob, fence, workspace })
}

/** The calling half of the host, over any registry. createHost loads upstream modules into one; tests fill their own. */
export function hostOver(registry, { loaded = [], failed = [], env = process.env, cwd: startCwd = process.cwd(), jobs = null, llm = null, usage = null, bindParentJob = () => () => {}, detached = DETACHED_TOOLS, fence, workspace = null } = {}) {
  const sessionId = sessionIdFrom(env)
  // The session directory: the server's own at start, then what the client says with roots/list (it changes with /cd).
  let cwd = startCwd
  const maxChars = Number(env.AH_MAX_RESULT_CHARS) > 0 ? Number(env.AH_MAX_RESULT_CHARS) : DEFAULT_MAX_CHARS
  const keepRaw = env.AH_TOOL_OUTPUT_KEEP_DAYS?.trim()
  const keepOutputDays = keepRaw !== undefined && keepRaw !== '' && Number(keepRaw) >= 0 ? Number(keepRaw) : DEFAULT_OUTPUT_KEEP_DAYS
  const route = llm ? { provider: 'claude-code', model: llm.model } : null
  const raw = env.AH_JOB_FOREGROUND_MS
  const foregroundMs = raw !== undefined && raw !== '' && Number(raw) >= 0 ? Number(raw) : DEFAULT_FOREGROUND_MS
  // AH_VALIDATE_TOOL_ARGS: `enforce` (default) refuses a call whose arguments the tool's schema refuses, before anything runs (no job is started);
  // `warn` counts and notes it and runs it anyway; `off` does not look. See validate.mjs.
  const validate = validationMode(env.AH_VALIDATE_TOOL_ARGS)
  const schemas = new Map()
  const schemaOf = tool => { let s = schemas.get(tool.name); if (!s) { s = toInputSchema(tool); schemas.set(tool.name, s) } return s }
  const timeoutFor = tool => (Number.isFinite(tool.timeoutMs) && tool.timeoutMs > 0 ? tool.timeoutMs : SLOW_TOOLS.get(tool.name) ?? (Number(env.AH_TOOL_TIMEOUT_MS) > 0 ? Number(env.AH_TOOL_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS))

  // The job tools exist when a long tool does.
  if (jobs && [...registry.tools.keys()].some(n => detached.has(n))) {
    for (const t of jobTools({ jobs, sessionId, cwd: () => cwd, maxChars })) if (!registry.tools.has(t.name)) registry.register(t)
  }

  // web_search and web_extract are the host's own: they pick among the providers that are served (webtools.mjs), so they exist only when one is.
  for (const t of webTools({ registry, env, ...(fence ? { fence } : {}) })) if (!registry.tools.has(t.name)) registry.register(t)

  // The doctor tool is the host's own too: it reports what this server loaded and what its environment holds.
  if (!registry.tools.has('doctor')) registry.register(doctorTool({ env, loaded, failed, served: () => [...registry.tools.keys()], flush: () => usage?.flush(), cwd: () => cwd }))

  let started = false
  const renderValue = (tool, args, value) => (tool.output?.render ? tool.output.render(args, value) : [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }])
  const listed = listedSkills()
  const fixContent = (tool, content) => (tool.name === 'skill_search' ? content.map(c => (c.type === 'text' ? { ...c, text: fixSkillSearch(c.text, listed) } : c)) : content)
  const ok = (tool, args, value, exec) => ({ content: clip(fixContent(tool, blocksToContent(renderValue(tool, args, value))), { maxChars, cwd, tool: tool.name, callId: exec.callId, keepDays: keepOutputDays }).content })
  const failure = text => ({ isError: true, content: [{ type: 'text', text: adapt(`Error: ${text}`) }] })

  /** A long tool as a job: the call waits `foregroundMs`, then answers and the work goes on. */
  async function callDetached(tool, name, args, { signal, callId }) {
    const topic = String(args?.query ?? args?.topic ?? args?.question ?? args?.action ?? args?.path ?? '').replace(/\s+/g, ' ').slice(0, 80)
    const job = jobs.create({ kind: name, label: topic ? `${name}: ${topic}` : name, toolCall: { callId }, tool: name })
    const exec = makeExec({ name, args, callId, signal: job.signal, cwd, sessionId, route })
    const unbind = bindParentJob(exec.callId, job)
    const finished = (async () => {
      try {
        const value = await tool.execute(args, exec)
        const result = ok(tool, args, value, exec)
        jobs.settle(job.id, { status: 'completed', detail: value?.status ?? 'completed', result: result.content.filter(c => c.type === 'text').map(c => c.text).join('\n') })
        return result
      } catch (error) {
        const text = String(error?.message ?? error)
        jobs.settle(job.id, { status: job.signal.aborted ? 'killed' : 'failed', detail: text })
        return failure(job.signal.aborted ? `${name} was stopped: ${text}` : text)
      } finally {
        unbind()
      }
    })()
    let timer
    // A cancellation that arrives after the job settled (or its record was pruned) has nothing to stop; it must not throw from an abort listener.
    const onCancel = () => { try { jobs.kill(job.id, null, 'the call was cancelled') } catch { /* already gone */ } }
    signal?.addEventListener('abort', onCancel, { once: true })
    const window = new Promise(resolve => { timer = setTimeout(() => resolve(null), foregroundMs) })
    const first = await Promise.race([finished, window])
    clearTimeout(timer)
    signal?.removeEventListener('abort', onCancel)
    if (first) { jobs.deliver(job.id); return first }
    return {
      content: [{ type: 'text', text: `${name} is running as job ${job.id} (it goes on in the background).\nProgress: job_status {"job_id":"${job.id}"}. Wait: job_wait. Log: job_log. Stop: job_kill. In an interactive session you are told when it ends; in a non-interactive run, keep calling job_wait until it does, because the job stops when the session ends.` }],
    }
  }

  /** Where a call is run; `call` (below) counts it. */
  async function invoke(name, args = {}, { signal, callId, onInvalid } = {}) {
    const tool = registry.tools.get(name)
    if (!tool) return { isError: true, content: [{ type: 'text', text: `Unknown tool "${name}". Known tools: ${[...registry.tools.keys()].slice(0, 12).join(', ')}${registry.tools.size > 12 ? ', ...' : ''}` }] }
    if (validate !== 'off') {
      const checked = validateArgs(schemaOf(tool), args)
      if (!checked.ok) {
        onInvalid?.()
        if (validate === 'enforce') return failure(describeIssues(name, checked.issues))
        // Field paths only, never a value.
        process.stderr.write(`[academic-harness] ah: ${name} was called with arguments its schema refuses (${issuePaths(checked.issues)}); running it anyway (AH_VALIDATE_TOOL_ARGS=enforce refuses)\n`)
      }
    }
    if (jobs && detached.has(name)) return callDetached(tool, name, args, { signal, callId })
    // An explicit timer, cleared when the call ends. `AbortSignal.timeout` would do, but its timer does not keep the event loop alive, so a
    // process with nothing else pending (a test, on Node 22) is ended before a hung tool's limit is reached.
    const limit = timeoutFor(tool)
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(new Error(`timed out after ${limit} ms`)), limit)
    const merged = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal
    const exec = makeExec({ name, args, callId, signal: merged, cwd, sessionId, route })
    try {
      return ok(tool, args, await tool.execute(args, exec), exec)
    } catch (error) {
      const why = merged.aborted ? (signal?.aborted ? 'was cancelled' : `timed out after ${Math.round(limit / 1000)} s`) : null
      return failure(why ? `${name} ${why}` : String(error?.message ?? error))
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    registry,
    loaded,
    failed,
    sessionId,
    get cwd() { return cwd },
    setCwd(next) { if (typeof next === 'string' && next) { cwd = next; if (workspace) workspace.cwd = next } },
    jobs,
    llm,
    list() {
      return [...registry.tools.values()].map(t => ({ name: t.name, description: adapt(t.description ?? ''), inputSchema: toInputSchema(t) }))
    },
    /** Run one tool. Resolves to an MCP tool result; never throws for a tool's own failure. The use is counted (usage.mjs): the tool's name, whether it failed, never its arguments. */
    async call(name, args = {}, options = {}) {
      let invalid = false
      const result = await invoke(name, args, { ...options, onInvalid: () => { invalid = true } })
      if (usage && registry.tools.has(name)) {
        usage.record('tools', name, { error: result.isError === true, invalid })
        if (name === 'skill_load' && typeof args?.name === 'string') usage.record('skills', args.name, { error: result.isError === true })
      }
      return result
    },
    usage,
    /** Run the handlers modules registered with `ctx.on(event, ...)`. Upstream's events are DSH's; the host raises the ones that have a meaning here. */
    async fire(event, payload) {
      // paper_mcp's own session-start mount is not run: a registry that came with a cloned folder must not write .mcp.json by itself. register and approve do.
      for (const sub of registry.subscriptions.filter(x => x.event === event && x.module !== 'paper-mcp.js')) {
        try { await sub.handler(payload) } catch (error) { process.stderr.write(`[academic-harness] ah: ${sub.module} ${event} handler failed: ${String(error?.message ?? error).split('\n')[0]}\n`) }
      }
    },
    /** Once the client has said it is initialised and told us where the session is: `session/created` and, a little later, a PaperMemory dream pass. */
    start() {
      if (started) return
      started = true
      void this.fire('session/created', { header: { cwd, id: sessionId, origin: 'main' } })
      if (env.AH_DREAM_DELAY_MS !== '-1') setTimeout(() => { void this.fire('agent/disposed', {}) }, Number(env.AH_DREAM_DELAY_MS) >= 0 ? Number(env.AH_DREAM_DELAY_MS) : 20_000).unref?.()
    },
    async dispose() {
      usage?.flush()
      await jobs?.closeAll()
      await registry.dispose()
    },
  }
}

const registry0 = host => host.registry

/** The MCP loop over a pair of streams. Returns when input ends. */
export function serve({ host, input = process.stdin, output = process.stdout, protocolVersion = '2025-06-18' } = {}) {
  const inflight = new Map()
  const send = message => output.write(`${JSON.stringify(message)}\n`)
  let buffer = ''
  let closed
  const done = new Promise(resolve => { closed = resolve })
  const pending = new Set()

  // Requests the server makes of the client (roots/list). Their answers arrive as messages with an id and no method.
  const asked = new Map()
  let askId = 0
  const ask = (method, params, ms = 5000) => new Promise((resolve, reject) => {
    const id = `srv-${++askId}`
    const timer = setTimeout(() => { asked.delete(id); reject(new Error(`${method} timed out`)) }, ms)
    timer.unref?.()
    asked.set(id, { resolve: v => { clearTimeout(timer); resolve(v) }, reject: e => { clearTimeout(timer); reject(e) } })
    send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })
  })
  let clientHasRoots = false
  /** The session directory, as the client says it now. A client that does not answer leaves the last one in place. */
  async function refreshRoots() {
    if (!clientHasRoots || typeof host.setCwd !== 'function') return
    try {
      const { roots } = await ask('roots/list')
      const uri = (roots ?? []).map(r => r?.uri).find(u => typeof u === 'string' && u.startsWith('file://'))
      if (uri) host.setCwd(fileURLToPath(uri))
    } catch { /* keep the working directory the server started in */ }
  }

  async function handle(request) {
    const { id, method, params } = request
    const reply = result => id !== undefined && send({ jsonrpc: '2.0', id, result })
    const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } })
    switch (method) {
      case 'initialize':
        clientHasRoots = Boolean(params?.capabilities?.roots)
        if (registry0(host)) registry0(host).onChange = () => send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
        return reply({ protocolVersion: params?.protocolVersion ?? protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } })
      case 'ping':
        return reply({})
      case 'tools/list':
        return reply({ tools: host.list() })
      case 'tools/call': {
        const controller = new AbortController()
        inflight.set(id, controller)
        try {
          const result = await host.call(params?.name, params?.arguments ?? {}, { signal: controller.signal, callId: params?._meta?.['claudecode/toolUseId'] })
          if (!controller.signal.aborted) reply(result)
        } finally {
          inflight.delete(id)
        }
        return
      }
      case 'notifications/initialized':
        await refreshRoots()
        return host.start?.()
      case 'notifications/roots/list_changed':
        return refreshRoots()
      case 'notifications/cancelled':
        inflight.get(params?.requestId)?.abort(new Error('cancelled by the client'))
        return
      default:
        if (method?.startsWith('notifications/')) return
        return fail(-32601, `method not found: ${method}`)
    }
  }

  function onLine(line) {
    if (!line.trim()) return
    let request
    try { request = JSON.parse(line) } catch { return }
    if (request && request.method === undefined && request.id !== undefined && asked.has(request.id)) {
      const waiting = asked.get(request.id)
      asked.delete(request.id)
      return request.error ? waiting.reject(new Error(request.error.message ?? 'request failed')) : waiting.resolve(request.result)
    }
    const p = handle(request).catch(error => {
      if (request.id !== undefined) send({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: String(error?.message ?? error) } })
    })
    pending.add(p)
    p.finally(() => pending.delete(p))
  }

  input.setEncoding?.('utf8')
  input.on('data', chunk => {
    buffer += chunk
    let i
    while ((i = buffer.indexOf('\n')) >= 0) {
      onLine(buffer.slice(0, i))
      buffer = buffer.slice(i + 1)
    }
  })
  input.on('end', async () => {
    if (buffer.trim()) onLine(buffer)
    await Promise.allSettled([...pending])
    closed()
  })
  return done
}
