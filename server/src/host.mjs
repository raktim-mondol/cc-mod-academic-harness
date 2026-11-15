// The tool host: loads upstream tool modules and answers Claude Code over MCP.
//
// Two parts, kept apart so tests can use the first without the second:
//   createHost()  loads the modules into a registry and runs a call
//   serve()       the stdio MCP loop (newline-delimited JSON-RPC)
//
// Standard output belongs to the protocol. Everything else goes to stderr.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createContext, Registry } from './context.mjs'
import { createJobs, FINISHED } from './jobs.mjs'
import { createLlm, DEFAULT_BUDGET_USD, DEFAULT_MODEL } from './llm.mjs'
import { jobTools } from './jobtools.mjs'
import { modHome } from './paths.mjs'
import { makeExec, sessionIdFrom } from './exec.mjs'
import { parseAreas, plan } from './manifest.mjs'
import { adapt, blocksToContent, clip, DEFAULT_MAX_CHARS } from './render.mjs'
import { toInputSchema } from './schema.mjs'

export const SERVER_NAME = 'ah'
export const SERVER_VERSION = '0.4.0'
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

export async function createHost({ upstream, areas = 'all', env = process.env, cwd = process.cwd(), logger = log } = {}) {
  const problem = missingDependencies(upstream)
  if (problem) throw new Error(problem)
  const { areas: wanted, unknown } = parseAreas(areas)
  if (unknown.length) logger(`unknown tool area(s) ignored: ${unknown.join(', ')}`)
  const { load, missing } = plan(upstream, wanted)
  if (missing.length) logger(`expected modules not in the snapshot (upstream drift?): ${missing.join(', ')}`)

  const registry = new Registry()
  const sessionId = sessionIdFrom(env)
  const jobs = createJobs({ dir: join(modHome(env), 'jobs'), session: sessionId ?? null, cwd })
  const budget = Number(env.AH_LLM_BUDGET_USD)
  const llm = createLlm({ model: env.AH_LLM_MODEL?.trim() || DEFAULT_MODEL, budgetUsd: budget > 0 ? budget : DEFAULT_BUDGET_USD, cwd, env })
  const loaded = []
  const failed = []
  for (const entry of load) {
    try {
      const mod = await import(pathToFileURL(join(upstream, entry.file)).href)
      const apply = mod[entry.fn] ?? mod.default?.[entry.fn]
      if (typeof apply !== 'function') throw new Error(`no export "${entry.fn}"`)
      const before = registry.tools.size
      await apply(createContext(registry, { log: logger, module: entry.file, services: { jobs, llm } }), {})
      loaded.push({ file: entry.file, area: entry.area, tools: registry.tools.size - before })
    } catch (error) {
      failed.push({ file: entry.file, error: String(error?.message ?? error).split('\n')[0] })
      logger(`${entry.file} did not load: ${String(error?.message ?? error).split('\n')[0]}`)
    }
  }

  let bindParentJob = () => () => {}
  const runner = join(upstream, 'job-runner.js')
  if (existsSync(runner)) ({ bindParentJob } = await import(pathToFileURL(runner).href))
  return hostOver(registry, { loaded, failed, env, cwd, jobs, llm, bindParentJob })
}

/** The calling half of the host, over any registry. createHost loads upstream modules into one; tests fill their own. */
export function hostOver(registry, { loaded = [], failed = [], env = process.env, cwd = process.cwd(), jobs = null, llm = null, bindParentJob = () => () => {}, detached = DETACHED_TOOLS } = {}) {
  const sessionId = sessionIdFrom(env)
  const maxChars = Number(env.AH_MAX_RESULT_CHARS) > 0 ? Number(env.AH_MAX_RESULT_CHARS) : DEFAULT_MAX_CHARS
  const route = llm ? { provider: 'claude-code', model: llm.model } : null
  const raw = env.AH_JOB_FOREGROUND_MS
  const foregroundMs = raw !== undefined && raw !== '' && Number(raw) >= 0 ? Number(raw) : DEFAULT_FOREGROUND_MS
  const timeoutFor = tool => (Number.isFinite(tool.timeoutMs) && tool.timeoutMs > 0 ? tool.timeoutMs : SLOW_TOOLS.get(tool.name) ?? (Number(env.AH_TOOL_TIMEOUT_MS) > 0 ? Number(env.AH_TOOL_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS))

  // The job tools exist when a long tool does.
  if (jobs && [...registry.tools.keys()].some(n => detached.has(n))) {
    for (const t of jobTools({ jobs, sessionId, cwd, maxChars })) if (!registry.tools.has(t.name)) registry.register(t)
  }

  const renderValue = (tool, args, value) => (tool.output?.render ? tool.output.render(args, value) : [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }])
  const ok = (tool, args, value, exec) => ({ content: clip(blocksToContent(renderValue(tool, args, value)), { maxChars, cwd, tool: tool.name, callId: exec.callId }).content })
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
    const onCancel = () => jobs.kill(job.id, null, 'the call was cancelled')
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

  return {
    registry,
    loaded,
    failed,
    sessionId,
    cwd,
    jobs,
    llm,
    list() {
      return [...registry.tools.values()].map(t => ({ name: t.name, description: t.description ?? '', inputSchema: toInputSchema(t) }))
    },
    /** Run one tool. Resolves to an MCP tool result; never throws for a tool's own failure. */
    async call(name, args = {}, { signal, callId } = {}) {
      const tool = registry.tools.get(name)
      if (!tool) return { isError: true, content: [{ type: 'text', text: `Unknown tool "${name}". Known tools: ${[...registry.tools.keys()].slice(0, 12).join(', ')}${registry.tools.size > 12 ? ', ...' : ''}` }] }
      if (jobs && detached.has(name)) return callDetached(tool, name, args, { signal, callId })
      const timeout = AbortSignal.timeout(timeoutFor(tool))
      const merged = signal ? AbortSignal.any([signal, timeout]) : timeout
      const exec = makeExec({ name, args, callId, signal: merged, cwd, sessionId, route })
      try {
        return ok(tool, args, await tool.execute(args, exec), exec)
      } catch (error) {
        const why = merged.aborted ? (signal?.aborted ? 'was cancelled' : `timed out after ${Math.round(timeoutFor(tool) / 1000)} s`) : null
        return failure(why ? `${name} ${why}` : String(error?.message ?? error))
      }
    },
    async dispose() {
      await jobs?.closeAll()
      await registry.dispose()
    },
  }
}

/** The MCP loop over a pair of streams. Returns when input ends. */
export function serve({ host, input = process.stdin, output = process.stdout, protocolVersion = '2025-06-18' } = {}) {
  const inflight = new Map()
  const send = message => output.write(`${JSON.stringify(message)}\n`)
  let buffer = ''
  let closed
  const done = new Promise(resolve => { closed = resolve })
  const pending = new Set()

  async function handle(request) {
    const { id, method, params } = request
    const reply = result => id !== undefined && send({ jsonrpc: '2.0', id, result })
    const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } })
    switch (method) {
      case 'initialize':
        return reply({ protocolVersion: params?.protocolVersion ?? protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } })
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
