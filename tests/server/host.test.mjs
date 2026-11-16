// node --test tests/server   (needs upstream/ and its node_modules: node scripts/sync-upstream.mjs && node scripts/install-deps.mjs)
// Scratch state lives under ~/.cache (plan ground rule 4).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { applyKeyEnv, MANAGED_INSTALLS, prepareEnv } from '../../server/src/env.mjs'
import { createContext, Registry, UnportedServiceError } from '../../server/src/context.mjs'
import { makeExec } from '../../server/src/exec.mjs'
import { classify, discover, indexComponents, parseAreas, plan, presetModules, AREAS, TIER1, HOST_ONLY } from '../../server/src/manifest.mjs'
import { adapt, blocksToContent, clip, fixSkillSearch, pruneOutputDir } from '../../server/src/render.mjs'
import { toInputSchema } from '../../server/src/schema.mjs'
import { upstreamDir } from '../../server/src/paths.mjs'
import { hostOver, serve } from '../../server/src/host.mjs'
import { PassThrough } from 'node:stream'
import { createUsage } from '../../server/src/usage.mjs'

const BIN = fileURLToPath(new URL('../../server/bin/ah-mcp.mjs', import.meta.url))
const scratch = join(homedir(), '.cache', 'ah-cc-p2', `test-${process.pid}`)
const UP = upstreamDir()
before(() => { rmSync(scratch, { recursive: true, force: true }); mkdirSync(scratch, { recursive: true }) })
after(() => rmSync(scratch, { recursive: true, force: true }))

describe('schema', () => {
  test('a JSON Schema root is copied, not shared', () => {
    const tool = { parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } }
    const out = toInputSchema(tool)
    assert.deepEqual(out, tool.parameters)
    out.properties.q.type = 'number'
    assert.equal(tool.parameters.properties.q.type, 'string')
  })
  test('a parameter DSL object becomes JSON Schema, with nesting, arrays and oneOf', () => {
    const out = toInputSchema({ parameters: {
      query: { type: 'string', required: true, description: 'd' },
      limit: { type: 'number' },
      tags: { type: 'array', items: { type: 'string' } },
      opts: { type: 'object', properties: { deep: { type: 'boolean', required: true } } },
      pick: { oneOf: [{ type: 'string' }, { type: 'number' }] },
    } })
    assert.deepEqual(out.required, ['query'])
    assert.equal(out.properties.query.required, undefined)
    assert.deepEqual(out.properties.tags.items, { type: 'string' })
    assert.deepEqual(out.properties.opts.required, ['deep'])
    assert.equal(out.properties.opts.properties.deep.required, undefined)
    assert.equal(out.properties.pick.oneOf.length, 2)
  })
  test('a tool with no parameters gets an empty object schema', () => {
    assert.deepEqual(toInputSchema({}), { type: 'object', properties: {} })
    assert.deepEqual(toInputSchema({ parameters: { type: 'object' } }), { type: 'object', properties: {} })
  })
})

describe('context', () => {
  const tool = name => ({ name, description: '', parameters: { type: 'object', properties: {} }, execute: async () => 1 })
  test('registers, looks up and refuses a duplicate name', () => {
    const reg = new Registry()
    const ctx = createContext(reg)
    const off = ctx.tools.register(tool('a'))
    assert.equal(ctx.tools.get('a').name, 'a')
    assert.throws(() => ctx.tools.register(tool('a')), /registered twice/)
    off()
    assert.equal(ctx.tools.get('a'), undefined)
    assert.throws(() => ctx.tools.register({ name: 'b' }), /expected a tool definition/)
  })
  test('a service the host does not provide fails with a named error', () => {
    const ctx = createContext(new Registry(), { module: 'deep-review.js' })
    assert.throws(() => ctx.llm, err => err instanceof UnportedServiceError && err.service === 'llm' && /deep-review\.js/.test(err.message))
    assert.throws(() => ctx.jobs.start({}), /"jobs" service/)
  })
  test('ctx.get answers undefined, ctx.on records without firing, effect disposers run on dispose', async () => {
    const reg = new Registry()
    const ctx = createContext(reg, { module: 'm.js' })
    assert.equal(ctx.get('sessions'), undefined)
    ctx.on('session/created', () => {})
    assert.deepEqual(reg.subscriptions.map(s => [s.module, s.event]), [['m.js', 'session/created']])
    let disposed = false
    ctx.effect(() => () => { disposed = true })
    await reg.dispose()
    assert.equal(disposed, true)
  })
  test('a promise check on the context does not throw (await ctx)', async () => {
    assert.equal(await createContext(new Registry()) !== undefined, true)
  })
})

describe('manifest', () => {
  test('index.js components are read from its apply(), not from imports alone', () => {
    const src = `import { applyA } from './a.js'\nimport { applyB, applyC } from './b.js'\nimport { seed } from './seed.js'\nexport function apply(ctx) {\n  seed()\n  applyA(ctx)\n  applyC(ctx)\n}\n`
    assert.deepEqual(indexComponents(src), [{ file: 'a.js', fn: 'applyA' }, { file: 'b.js', fn: 'applyC' }])
  })
  test('preset rows map through package.json exports', () => {
    const yaml = `- name: academic-harness/ah\n- name: academic-harness/paper-get\n- name: '@deepseek-ai/dsh-tool-bash'\n`
    assert.deepEqual(presetModules(yaml, { './ah': './academic-harness.js' }), ['academic-harness.js', 'paper-get.js'])
  })
  test('areas: all, a list, and unknown names reported', () => {
    assert.deepEqual(parseAreas('all').areas, AREAS)
    assert.deepEqual(parseAreas('').areas, AREAS)
    assert.deepEqual(parseAreas('search, notebook,nope'), { areas: ['search', 'notebook'], unknown: ['nope'] })
  })
  test('classification: tier 1 by area, host-only with a reason, everything else later', () => {
    assert.deepEqual(classify({ file: 'notebook.js' }), { tier: 1, area: 'notebook' })
    assert.equal(classify({ file: 'zvec-grep.js' }).tier, 'host-only')
    assert.deepEqual(classify({ file: 'rsi.js' }), { tier: 'dropped', tool: 'ah_rsi', reason: classify({ file: 'rsi.js' }).reason })
    assert.equal(classify({ file: 'a-module-nobody-classified.js' }).tier, 'later')
  })
  test('every tier-1 module exists in the snapshot and no module is in two groups', { skip: !existsSync(UP) }, () => {
    const found = discover(UP).map(e => e.file)
    for (const files of Object.values(TIER1)) for (const f of files) assert.ok(found.includes(f), `${f} is not in the snapshot`)
    const all = Object.values(TIER1).flat()
    assert.equal(new Set(all).size, all.length)
    for (const f of Object.keys(HOST_ONLY)) assert.ok(!all.includes(f))
  })
  test('plan loads tier 1 for the chosen areas only', { skip: !existsSync(UP) }, () => {
    const { load } = plan(UP, ['skills'])
    assert.deepEqual(load.map(e => e.file), TIER1.skills)
  })
})

describe('render', () => {
  test('wording: "restart dsh" says Claude Code, and a tool name that already has the plugin prefix is left alone', () => {
    assert.equal(adapt('If they do not appear, restart dsh.'), 'If they do not appear, restart Claude Code.')
    assert.equal(adapt('mcp__plugin_academic-harness_ah__echo stays'), 'mcp__plugin_academic-harness_ah__echo stays')
  })
  test('skill_search: a listed skill says how to load it, a left-out one says so', () => {
    const t = '- `peer-review` (in the session catalogue): reviews\n- `deep-research` (in the session catalogue): x\n- `other`: y'
    const out = fixSkillSearch(t, new Set(['peer-review']))
    assert.match(out, /`peer-review` \(listed: load it with the Skill tool as academic-harness:peer-review\)/)
    assert.match(out, /`deep-research` \(not in this plugin's skill list/)
    assert.match(out, /- `other`: y/)
  })
  test('blocks become MCP text content; a bare string and an unknown block survive', () => {
    assert.deepEqual(blocksToContent([{ type: 'text', text: 'a' }, 'b', { type: 'odd', x: 1 }]), [
      { type: 'text', text: 'a' }, { type: 'text', text: 'b' }, { type: 'text', text: '{"type":"odd","x":1}' },
    ])
    assert.deepEqual(blocksToContent([]), [{ type: 'text', text: '' }])
  })
  test('a short result is untouched; a long one is cut, the whole text is saved, and the note names the file', () => {
    const short = clip([{ type: 'text', text: 'abc' }], { maxChars: 10, cwd: scratch, tool: 't' })
    assert.equal(short.clipped, false)
    const long = clip([{ type: 'text', text: 'x'.repeat(100) }], { maxChars: 10, cwd: scratch, tool: 'big tool!', callId: 'toolu_1' })
    assert.equal(long.clipped, true)
    assert.ok(long.file.startsWith(join(scratch, '.dsh', 'tool-output')))
    assert.equal(readFileSync(long.file, 'utf8').length, 100)
    assert.match(long.content[0].text, /^x{10}\n\n\[output clipped: 100 characters, showing the first 10\. The full text is in /)
  })
  test('clipped results older than the keep time are removed when a new one is written; other files and recent ones stay', () => {
    const cwd = join(scratch, 'prune-output')
    const dir = join(cwd, '.dsh', 'tool-output')
    mkdirSync(dir, { recursive: true })
    const day = 24 * 60 * 60 * 1000
    const aged = (name, days) => { const f = join(dir, name); writeFileSync(f, 'x'); const t = new Date(Date.now() - days * day); utimesSync(f, t, t); return f }
    const old = aged('old-tool-call.txt', 40)
    const recent = aged('recent-tool-call.txt', 5)
    const other = aged('notes.md', 90)
    clip([{ type: 'text', text: 'z'.repeat(100) }], { maxChars: 10, cwd, tool: 't', callId: 'new' })
    assert.equal(existsSync(old), false)
    assert.equal(existsSync(recent), true)
    assert.equal(existsSync(other), true, 'only the .txt files of clipped results are touched')
    assert.equal(existsSync(join(dir, 't-new.txt')), true)
    assert.equal(pruneOutputDir(dir, { keepDays: 0 }), 0, '0 keeps everything')
    assert.equal(pruneOutputDir(dir, { keepDays: 1 }), 1, 'a stricter keep time removes the 5-day-old one, not the one just written')
    assert.equal(pruneOutputDir(join(scratch, 'no-such-folder')), 0)
  })
  test('if the file cannot be written the note says so and the head is still returned', () => {
    const notADir = join(scratch, 'a-file')
    writeFileSync(notADir, 'x')
    const out = clip([{ type: 'text', text: 'y'.repeat(50) }], { maxChars: 5, cwd: notADir, tool: 't' })
    assert.match(out.content[0].text, /could not be saved/)
  })
  test('DSH settings wording is replaced', () => {
    assert.equal(adapt('X is not set (Settings -> Academic Harness API keys, or the env var).'), 'X is not set (the academic-harness plugin settings, or the env var).')
  })
})

describe('env', () => {
  test('managed installers stay on only for the areas that read them, and only when asked for', () => {
    const base = { AH_MOD_HOME: join(scratch, 'home-m') }
    const off = { ...base }
    prepareEnv(off)
    assert.equal(off.TEXTFOLD_SKIP_INSTALL, '1', 'no areas given: everything off')
    const on = { ...base }
    prepareEnv(on, { areas: ['search', 'submission', 'compute'] })
    assert.equal(on.TEXTFOLD_SKIP_INSTALL, undefined)
    assert.equal(on.ACADEMIC_HARNESS_MODAL_SKIP_INSTALL, undefined)
    assert.equal(on.ACADEMIC_HARNESS_SKIP_INSTALL, '1', 'the engine is built by the mod, not by upstream\'s installer')
    const some = { ...base }
    prepareEnv(some, { areas: ['search', 'compute'] })
    assert.equal(some.TEXTFOLD_SKIP_INSTALL, '1')
    const optOut = { ...base, AH_MANAGED_INSTALLS: '0' }
    prepareEnv(optOut, { areas: ['submission', 'compute'] })
    assert.equal(optOut.TEXTFOLD_SKIP_INSTALL, '1')
    const dev = { ...base, AH_UPSTREAM: '/somewhere' }
    prepareEnv(dev, { areas: ['submission'] })
    assert.equal(dev.TEXTFOLD_SKIP_INSTALL, '1', 'development mode installs nothing')
    assert.ok(Object.keys(MANAGED_INSTALLS).length >= 2)
  })
  test('the host refuses a DSH_HOME that is unset or is the real DSH home', async () => {
    const { assertSafeHome } = await import('../../server/src/host.mjs')
    const { homedir } = await import('node:os')
    assert.throws(() => assertSafeHome({}), /DSH_HOME is not set/)
    assert.throws(() => assertSafeHome({ DSH_HOME: join(homedir(), '.dsh') }), /real DeepSeek Harness home/)
    assert.doesNotThrow(() => assertSafeHome({ DSH_HOME: join(scratch, 'home') }))
  })
  test('a config key is copied only when the variable is empty; the shell wins; empty config does nothing', () => {
    const env = { AH_KEY_A_API_KEY: 'from-config', A_API_KEY: '', AH_KEY_B_API_KEY: 'cfg', B_API_KEY: 'from-shell', AH_KEY_C_API_KEY: '', AH_KEY_D_API_KEY: '  spaced  ' }
    const set = applyKeyEnv(env)
    assert.equal(env.A_API_KEY, 'from-config')
    assert.equal(env.B_API_KEY, 'from-shell')
    assert.equal(env.C_API_KEY, undefined)
    assert.equal(env.D_API_KEY, 'spaced')
    assert.deepEqual(set.sort(), ['A_API_KEY', 'D_API_KEY'])
  })
  test('prepareEnv points DSH_HOME at the mod home and switches installers off unless the person set them', () => {
    const env = { AH_MOD_HOME: join(scratch, 'home'), TEXTFOLD_SKIP_INSTALL: '0' }
    prepareEnv(env)
    assert.equal(env.DSH_HOME, join(scratch, 'home'))
    assert.ok(existsSync(env.DSH_HOME))
    assert.equal(env.PAPERMEMORY_SKIP_INSTALL, '1')
    assert.equal(env.TEXTFOLD_SKIP_INSTALL, '0')
  })
})

describe('exec', () => {
  test('carries what the tools read: signal, callId, session id and cwd', () => {
    const signal = new AbortController().signal
    const e = makeExec({ name: 'notebook', args: { a: 1 }, callId: 'toolu_9', signal, cwd: '/w', sessionId: 's-1' })
    assert.equal(e.callId, 'toolu_9')
    assert.equal(e.signal, signal)
    assert.equal(e.agent.session.header.cwd, '/w')
    assert.equal(e.agent.session.header.id, 's-1')
    assert.equal(e.agent.ctx.get('sessions'), undefined)
    assert.match(makeExec({ name: 'x', args: {}, cwd: '/w' }).callId, /^call-/)
  })
})

/** Spawn the server and talk to it. */
// A test that fails before it closes its server must not leave the server running: `node --test` would wait for it for ever.
const spawned = new Set()
after(() => { for (const child of spawned) child.kill() })

function client(env = {}, cwd = scratch) {
  const child = spawn(process.execPath, [BIN], { cwd, env: { ...process.env, AH_MOD_HOME: join(scratch, 'home'), AH_MANAGED_INSTALLS: '0', AH_AUTO_INSTALL: '0', CLAUDE_CODE_SESSION_ID: 'test-session', ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
  spawned.add(child)
  let buf = ''
  let err = ''
  const waiting = new Map()
  const answers = new Map() // what this stand-in client answers when the server asks it something
  child.stdout.on('data', d => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const m = JSON.parse(buf.slice(0, i))
      buf = buf.slice(i + 1)
      if (m.method && m.id !== undefined) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: answers.get(m.method)?.(m.params) ?? {} })}\n`)
      else waiting.get(m.id)?.(m)
    }
  })
  child.stderr.on('data', d => { err += d })
  let n = 0
  const rpc = (method, params) => new Promise(resolve => { const id = ++n; waiting.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`) })
  const notify = (method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  const call = async (name, args = {}, id = `toolu_${name}`) => (await rpc('tools/call', { name, arguments: args, _meta: { 'claudecode/toolUseId': id } })).result
  const text = r => r.content.map(c => c.text).join('\n')
  const close = () => new Promise(resolve => { child.on('close', resolve); child.stdin.end() })
  return { child, rpc, notify, call, text, close, answers, stderr: () => err, nextId: () => n + 1 }
}

describe('stdio server', { skip: !existsSync(join(UP, 'node_modules', 'ah-dsh-tools')) }, () => {
  test('initialize, list, and the protocol edge cases', async () => {
    const c = client()
    const init = (await c.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} })).result
    assert.equal(init.serverInfo.name, 'ah')
    assert.equal(init.protocolVersion, '2025-06-18')
    c.notify('notifications/initialized')
    assert.deepEqual((await c.rpc('ping')).result, {})
    const tools = (await c.rpc('tools/list')).result.tools
    assert.ok(tools.length >= 35)
    for (const t of tools) { assert.equal(t.inputSchema.type, 'object'); assert.equal(typeof t.description, 'string') }
    assert.equal((await c.rpc('nope/nothing')).error.code, -32601)
    const unknown = await c.call('no_such_tool')
    assert.equal(unknown.isError, true)
    assert.match(c.text(unknown), /Unknown tool "no_such_tool"/)
    await c.close()
    assert.doesNotMatch(c.stderr(), /did not load/)
  })

  test('notebook writes under <cwd>/.dsh/notebook/<session>.jsonl, with the tool-use id as the entry id', async () => {
    const cwd = join(scratch, 'proj'); mkdirSync(cwd, { recursive: true })
    const c = client({}, cwd)
    await c.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} })
    const r = await c.call('notebook', { action: 'log', kind: 'note', title: 'first', summary: 'hello' }, 'toolu_abc')
    assert.equal(r.isError, undefined)
    const file = join(cwd, '.dsh', 'notebook', 'test-session.jsonl')
    assert.ok(existsSync(file), c.text(r))
    const entry = JSON.parse(readFileSync(file, 'utf8').trim())
    assert.equal(entry.id, 'toolu_abc')
    assert.equal(entry.title, 'first')
    const read = JSON.parse(c.text(await c.call('notebook', { action: 'read' })))
    assert.equal(read.count, 1)
    await c.close()
  })

  test('roots/list: the client\'s answer becomes the working directory, and a change is followed', async () => {
    const first = join(scratch, 'root-a'); const second = join(scratch, 'root-b')
    mkdirSync(first, { recursive: true }); mkdirSync(second, { recursive: true })
    const c = client({}, scratch)
    let current = first
    c.answers.set('roots/list', () => ({ roots: [{ uri: pathToFileURL(current).href, name: 'session' }] }))
    await c.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: { roots: { listChanged: true } } })
    c.notify('notifications/initialized')
    await new Promise(r => setTimeout(r, 300))
    await c.call('notebook', { action: 'log', kind: 'note', title: 'in a', summary: 's' }, 'toolu_a')
    assert.ok(existsSync(join(first, '.dsh', 'notebook', 'test-session.jsonl')), 'written under the first root')
    current = second
    c.notify('notifications/roots/list_changed')
    await new Promise(r => setTimeout(r, 300))
    await c.call('notebook', { action: 'log', kind: 'note', title: 'in b', summary: 's' }, 'toolu_b')
    assert.ok(existsSync(join(second, '.dsh', 'notebook', 'test-session.jsonl')), 'written under the new root after /cd')
    await c.close()
  })

  test('a client with no roots capability keeps the server\'s own directory', async () => {
    const cwd = join(scratch, 'root-c'); mkdirSync(cwd, { recursive: true })
    const c = client({}, cwd)
    await c.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} })
    c.notify('notifications/initialized')
    await c.call('notebook', { action: 'log', kind: 'note', title: 'c', summary: 's' }, 'toolu_c')
    assert.ok(existsSync(join(cwd, '.dsh', 'notebook', 'test-session.jsonl')))
    await c.close()
  })

  test('invalid arguments come back as a tool error naming the field, not as a protocol error', async () => {
    const c = client()
    await c.rpc('initialize', {})
    const r = await c.call('notebook', { action: 'bogus' })
    assert.equal(r.isError, true)
    assert.match(c.text(r), /Invalid arguments for notebook: "action" must be one of/)
    await c.close()
  })

  test('a key from the plugin config reaches the tool; a key exported in the shell is not masked by an empty one', async () => {
    const withCfg = client({ AH_KEY_S2_API_KEY: 'cfg-key-value', S2_API_KEY: '' })
    await withCfg.rpc('initialize', {})
    const a = withCfg.text(await withCfg.call('database_catalog'))
    assert.match(a, /S2_API_KEY: configured/)
    assert.doesNotMatch(a, /cfg-key-value/)
    await withCfg.close()
    assert.doesNotMatch(withCfg.stderr(), /cfg-key-value/)

    const shell = client({ AH_KEY_S2_API_KEY: '', S2_API_KEY: 'shell-key' })
    await shell.rpc('initialize', {})
    assert.match(shell.text(await shell.call('database_catalog')), /S2_API_KEY: configured/)
    await shell.close()

    const none = client({ AH_KEY_S2_API_KEY: '', S2_API_KEY: '' })
    await none.rpc('initialize', {})
    assert.match(none.text(await none.call('database_catalog')), /S2_API_KEY: not set/)
    await none.close()
  })

  test('AH_TOOL_AREAS trims the surface', async () => {
    const c = client({ AH_TOOL_AREAS: 'skills' })
    await c.rpc('initialize', {})
    const names = (await c.rpc('tools/list')).result.tools.map(t => t.name).sort()
    assert.deepEqual(names, ['doctor', 'skill_load', 'skill_search'], 'the areas, and the host\'s own doctor')
    await c.close()
  })

  test('a result over the limit is clipped and the whole text saved under .dsh/tool-output', async () => {
    const cwd = join(scratch, 'clip'); mkdirSync(cwd, { recursive: true })
    const c = client({ AH_MAX_RESULT_CHARS: '300' }, cwd)
    await c.rpc('initialize', {})
    const r = await c.call('database_catalog', {}, 'toolu_clip')
    const t = c.text(r)
    assert.match(t, /\[output clipped: \d+ characters, showing the first 300\./)
    const file = join(cwd, '.dsh', 'tool-output', 'database_catalog-toolu_clip.txt')
    assert.ok(existsSync(file))
    assert.ok(readFileSync(file, 'utf8').length > 300)
    await c.close()
  })

  test('without installed dependencies the server exits 1 and says what to run', async () => {
    const child = spawn(process.execPath, [BIN], { env: { ...process.env, AH_UPSTREAM: join(scratch, 'empty-upstream'), AH_MOD_HOME: join(scratch, 'home') }, stdio: ['pipe', 'pipe', 'pipe'] })
    let err = ''
    child.stderr.on('data', d => { err += d })
    const code = await new Promise(r => child.on('close', r))
    assert.equal(code, 1)
    assert.match(err, /dependencies are not installed\. Run: node scripts\/install-deps\.mjs/)
  })
})

/** A host over a registry of fake tools, served over in-memory streams. */
function fakeServer(tools, env = {}) {
  const registry = new Registry()
  for (const t of tools) registry.register({ description: '', parameters: { type: 'object', properties: {} }, ...t })
  const host = hostOver(registry, { env: { CLAUDE_CODE_SESSION_ID: 's', ...env }, cwd: scratch })
  const input = new PassThrough()
  const output = new PassThrough()
  const lines = []
  const waiting = new Map()
  let buf = ''
  output.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); lines.push(m); waiting.get(m.id)?.(m) } })
  const done = serve({ host, input, output })
  let n = 0
  const send = (method, params) => { const id = ++n; input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); return { id, reply: new Promise(r => waiting.set(id, r)) } }
  return { host, input, lines, send, notify: (method, params) => input.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`), end: async () => { input.end(); await done } }
}
const text = r => r.result.content.map(c => c.text).join('\n')

describe('protocol loop with fake tools', () => {
  test('cancel aborts the running tool through exec.signal and sends no reply for it', async () => {
    let sawAbort = false
    const s = fakeServer([{ name: 'slow', execute: (args, exec) => new Promise((_, reject) => exec.signal.addEventListener('abort', () => { sawAbort = true; reject(new Error('aborted')) })) }, { name: 'quick', execute: async () => 'fast' }])
    const call = s.send('tools/call', { name: 'slow', arguments: {} })
    await new Promise(r => setTimeout(r, 50))
    s.notify('notifications/cancelled', { requestId: call.id })
    await new Promise(r => setTimeout(r, 100))
    assert.equal(sawAbort, true)
    assert.equal(s.lines.some(l => l.id === call.id), false)
    assert.equal(text(await s.send('tools/call', { name: 'quick', arguments: {} }).reply), 'fast')
    await s.end()
  })

  test('a tool over its time limit ends with a timeout error, and others are not held up', async () => {
    const s = fakeServer([{ name: 'hang', timeoutMs: 80, execute: (a, exec) => new Promise((_, reject) => exec.signal.addEventListener('abort', () => reject(new Error('x')))) }, { name: 'ok', execute: async () => 'ok' }])
    const hang = s.send('tools/call', { name: 'hang', arguments: {} })
    const ok = await s.send('tools/call', { name: 'ok', arguments: {} }).reply
    assert.equal(text(ok), 'ok')
    const r = await hang.reply
    assert.equal(r.result.isError, true)
    assert.match(text(r), /^Error: hang timed out after \d+ s$/)
    await s.end()
  })

  test('a hung tool reaches its time limit even when nothing else keeps the process alive', async () => {
    // A process whose only pending work is the tool: if the limit's timer did not keep it alive, Node would end it (exit 13) before the limit.
    const hostUrl = pathToFileURL(fileURLToPath(new URL('../../server/src/host.mjs', import.meta.url))).href
    const contextUrl = pathToFileURL(fileURLToPath(new URL('../../server/src/context.mjs', import.meta.url))).href
    const script = `
      import { hostOver } from ${JSON.stringify(hostUrl)}
      import { Registry } from ${JSON.stringify(contextUrl)}
      const registry = new Registry()
      registry.register({ name: 'hang', timeoutMs: 80, execute: (a, exec) => new Promise((_, reject) => exec.signal.addEventListener('abort', () => reject(new Error('x')))) })
      const r = await hostOver(registry, { env: {} }).call('hang', {})
      process.stdout.write(JSON.stringify(r))`
    const out = await new Promise(res => { const c = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; let e = ''; c.stdout.on('data', d => { o += d }); c.stderr.on('data', d => { e += d }); c.on('close', code => res({ code, o, e })) })
    assert.equal(out.code, 0, out.e)
    assert.match(JSON.parse(out.o).content[0].text, /hang timed out after \d+ s/)
  })

  test('a thrown error becomes a tool error with the DSH wording replaced; the callId is the tool-use id', async () => {
    let seen
    const s = fakeServer([{ name: 'boom', execute: async (a, exec) => { seen = exec; throw new Error('KEY is not set (Settings -> Academic Harness API keys)') } }])
    const r = await s.send('tools/call', { name: 'boom', arguments: {}, _meta: { 'claudecode/toolUseId': 'toolu_77' } }).reply
    assert.equal(r.result.isError, true)
    assert.equal(text(r), 'Error: KEY is not set (the academic-harness plugin settings)')
    assert.equal(seen.callId, 'toolu_77')
    assert.equal(seen.agent.session.header.id, 's')
    await s.end()
  })

  test('input split across chunks and a bad line are handled; end of input waits for calls in flight', async () => {
    const s = fakeServer([{ name: 'late', execute: () => new Promise(r => setTimeout(() => r('done'), 80)) }])
    const request = JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: 'late', arguments: {} } })
    s.input.write('this is not json\n\n')
    s.input.write(request.slice(0, 20))
    await new Promise(r => setTimeout(r, 20))
    s.input.write(`${request.slice(20)}\n`)
    await s.end()
    const reply = s.lines.find(l => l.id === 99)
    assert.equal(reply.result.content[0].text, 'done')
  })
})

describe('argument validation at the host', () => {
  const PARAMS = { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] }
  function validatingHost(env = {}) {
    const ran = []
    const registry = new Registry()
    registry.register({ name: 'search', description: '', parameters: PARAMS, execute: async args => { ran.push(args); return 'ran' } })
    const usage = createUsage({ dir: join(scratch, `val-${Math.random().toString(36).slice(2, 8)}`), id: 'srv-v', flushMs: 60_000 })
    return { host: hostOver(registry, { env: { CLAUDE_CODE_SESSION_ID: 's', ...env }, cwd: scratch, usage }), ran, usage }
  }
  /** Run `fn` and return what it wrote to stderr. */
  async function stderrOf(fn) {
    const lines = []
    const write = process.stderr.write
    process.stderr.write = chunk => { lines.push(String(chunk)); return true }
    try { await fn() } finally { process.stderr.write = write }
    return lines.join('')
  }
  const txt = r => r.content.map(c => c.text).join('\n')

  test('enforce refuses before the tool runs, names the field, and counts the call as failed and invalid', async () => {
    const { host, ran, usage } = validatingHost({ AH_VALIDATE_TOOL_ARGS: 'enforce' })
    const r = await host.call('search', { query: 42, limit: 'SECRET-TEXT' })
    assert.equal(r.isError, true)
    assert.match(txt(r), /Invalid arguments for search: "query" must be a string; "limit" must be a number\./)
    assert.ok(!txt(r).includes('SECRET-TEXT'))
    assert.deepEqual(ran, [])
    assert.deepEqual([usage.data.tools.search.calls, usage.data.tools.search.errors, usage.data.tools.search.invalid], [1, 1, 1])
  })
  test('warn runs the tool, writes one stderr line with paths only, and counts the call as invalid but not failed', async () => {
    const { host, ran, usage } = validatingHost({ AH_VALIDATE_TOOL_ARGS: 'warn' })
    let r
    const err = await stderrOf(async () => { r = await host.call('search', { query: 'q', limit: 'SECRET-TEXT' }) })
    assert.equal(r.isError, undefined)
    assert.deepEqual(ran, [{ query: 'q', limit: 'SECRET-TEXT' }])
    assert.equal(err.trim().split('\n').length, 1)
    assert.match(err, /search was called with arguments its schema refuses \(limit\)/)
    assert.ok(!err.includes('SECRET-TEXT'))
    assert.deepEqual([usage.data.tools.search.errors, usage.data.tools.search.invalid], [0, 1])
  })
  test('a valid call is untouched, is not counted as invalid, and writes nothing', async () => {
    for (const mode of [undefined, 'warn', 'enforce', 'nonsense']) {
      const { host, ran, usage } = validatingHost(mode ? { AH_VALIDATE_TOOL_ARGS: mode } : {})
      let r
      const err = await stderrOf(async () => { r = await host.call('search', { query: 'q', limit: null }) })
      assert.equal(r.isError, undefined, mode)
      assert.equal(err, '', mode)
      assert.equal(ran.length, 1, mode)
      assert.equal(usage.data.tools.search.invalid, undefined, mode)
    }
  })
  test('off does not look, and counts nothing as invalid', async () => {
    const { host, ran, usage } = validatingHost({ AH_VALIDATE_TOOL_ARGS: 'off' })
    const err = await stderrOf(() => host.call('search', {}))
    assert.equal(err, '')
    assert.equal(ran.length, 1)
    assert.equal(usage.data.tools.search.invalid, undefined)
  })
  test('enforce is the default, and so is an unknown value', async () => {
    for (const env of [{}, { AH_VALIDATE_TOOL_ARGS: 'strict' }]) {
      const { host, ran } = validatingHost(env)
      const r = await host.call('search', {})
      assert.equal(r.isError, true, JSON.stringify(env))
      assert.deepEqual(ran, [])
    }
  })
  test('a tool that declares no parameters accepts any arguments', async () => {
    const registry = new Registry()
    registry.register({ name: 'bare', execute: async () => 'ok' })
    const r = await hostOver(registry, { env: { AH_VALIDATE_TOOL_ARGS: 'enforce' } }).call('bare', { anything: 1 })
    assert.equal(r.isError, undefined)
  })
})
