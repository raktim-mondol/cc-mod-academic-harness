// The tools and skills brought back: the self-improvement loop (ah_rsi) driven by hook events, paper_mcp registering servers with Claude Code
// through .mcp.json, zvec_index, and the five skills.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { mcpEntry, removeFromMcpJson, writeMcpJson } from '../../server/src/mcpjson.mjs'
import { addTool, bareName, loadRsi, mergeReply, rsiEvent } from '../../server/src/rsi-bridge.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const UP = join(root, 'core')
const HAVE_UP = existsSync(join(UP, 'node_modules', 'ah-dsh-tools'))
const scratch = prefix => { const base = join(homedir(), '.cache', 'ah-test-homes'); mkdirSync(base, { recursive: true }); return mkdtempSync(join(base, prefix)) }

describe('the self-improvement loop, one hook event at a time', () => {
  test('a stated preference is recorded and returned as context; a tool outcome and the end of the turn are kept across processes', { skip: !HAVE_UP }, async () => {
    const dir = scratch('rsi-')
    const saved = { ...process.env }
    try {
      process.env.DSH_HOME = join(dir, 'home')
      process.env.AH_RSI_STORE = join(dir, 'store')
      delete process.env.AH_RSI
      mkdirSync(join(dir, 'proj'), { recursive: true })
      writeFileSync(join(dir, 'proj', 'ah.yaml'), 'name: x\n')
      const rsi = await loadRsi(UP)
      const ev = (event, payload) => rsiEvent({ event, payload: { session_id: 's1', ...payload }, root: join(dir, 'proj'), home: join(dir, 'home'), rsi })
      const first = await ev('userprompt', { prompt: 'From now on, always run integrity_check before you cite a paper in the manuscript.' })
      assert.match(first.additionalContext, /Local learned guidance \(RSI\)/)
      assert.match(first.additionalContext, /integrity_check before you cite/)
      assert.deepEqual(await ev('post', { tool_name: 'mcp__plugin_academic-harness_ah__integrity_check', tool_input: { doi: '10.1/x' }, tool_response: '{"verdict":"retracted"}' }), {})
      assert.deepEqual(await ev('stop', {}), {})
      const events = readFileSync(join(dir, 'store', 'events.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
      assert.deepEqual(events.map(e => e.type), ['user_turn', 'lesson_injected', 'tool'])
      assert.equal(events[2].tool, 'integrity_check', 'the MCP prefix is stripped')
      assert.equal(events[2].verdict, 'retracted')
      const episodes = readFileSync(join(dir, 'store', 'episodes.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
      assert.equal(episodes.length, 1, 'the stop closed the turn into one episode')
      // a second prompt opens a new turn with its own index
      await ev('userprompt', { prompt: 'Please revise the introduction.' })
      const state = JSON.parse(readFileSync(join(dir, 'home', 'rsi-sessions', 's1.json'), 'utf8'))
      assert.equal(state.currentTurn.index, 1)
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
      Object.assign(process.env, saved)
      rmSync(dir, { recursive: true, force: true })
    }
  })
  test('mode off does nothing and writes nothing; observe records but injects nothing', { skip: !HAVE_UP }, async () => {
    const dir = scratch('rsi-mode-')
    const saved = { ...process.env }
    try {
      process.env.DSH_HOME = join(dir, 'home')
      process.env.AH_RSI_STORE = join(dir, 'store')
      const rsi = await loadRsi(UP)
      const prompt = 'From now on, always run integrity_check before you cite a paper in the manuscript.'
      const run = () => rsiEvent({ event: 'userprompt', payload: { session_id: 's', prompt }, root: dir, home: join(dir, 'home'), rsi })
      process.env.AH_RSI = 'off'
      assert.deepEqual(await run(), {})
      assert.equal(existsSync(join(dir, 'home', 'rsi-sessions')), false)
      process.env.AH_RSI = 'observe'
      assert.deepEqual(await run(), {}, 'observe injects nothing')
      assert.ok(existsSync(join(dir, 'store', 'events.jsonl')), 'but it records')
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
      Object.assign(process.env, saved)
      rmSync(dir, { recursive: true, force: true })
    }
  })
  test('the hook entry point runs the loop for the rsi-post event and exits 0 outside an ah.yaml tree', { skip: !HAVE_UP }, () => {
    const dir = scratch('rsi-hook-')
    try {
      mkdirSync(join(dir, 'plain'), { recursive: true })
      const r = spawnSync('node', [join(root, 'server', 'bin', 'ah-hook.mjs'), 'rsi-post'], { input: JSON.stringify({ session_id: 's', cwd: join(dir, 'plain'), tool_name: 'Bash', tool_input: {}, tool_response: '' }), env: { ...process.env, AH_MOD_HOME: join(dir, 'home'), AH_RSI_STORE: join(dir, 'store') }, encoding: 'utf8' })
      assert.equal(r.status, 0, r.stderr)
      assert.equal(existsSync(join(dir, 'store')), false, 'nothing is written outside an ah.yaml project')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  test('the lessons are merged into the engine reply when there is one, and stand alone when there is not', () => {
    assert.equal(mergeReply('x', undefined), 'x')
    assert.deepEqual(JSON.parse(mergeReply('', 'L')), { additionalContext: 'L' })
    assert.deepEqual(JSON.parse(mergeReply('{"additionalContext":"card"}', 'L')), { additionalContext: 'card\n\nL' })
    assert.deepEqual(JSON.parse(mergeReply('{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"card"}}', 'L')).hookSpecificOutput.additionalContext, 'card\n\nL')
    assert.equal(mergeReply('a log line, not JSON', 'L'), 'a log line, not JSON', 'a reply that cannot be merged is left alone')
  })
  test('tool names lose the MCP prefix, and a turn counts what a tool did', () => {
    assert.equal(bareName('mcp__plugin_academic-harness_ah__ah_check'), 'ah_check')
    assert.equal(bareName('Bash'), 'Bash')
    const turn = { toolCounts: {}, findings: new Map(), signals: new Set(), injectedActions: new Map([['L1', 'integrity_check']]), reachedLessonIds: new Set(), toolSignatures: new Set(), qualitySignals: {}, errors: 0 }
    const summary = { name: 'integrity_check', is_error: true, findings: ['TEX-12'], error_signature: 'boom', args_hash: 'h', verdict: 'retracted' }
    addTool(turn, summary, {})
    addTool(turn, summary, {})
    assert.equal(turn.errors, 2)
    assert.ok(turn.signals.has('retry:integrity_check'), 'the same call twice is a retry')
    assert.ok(turn.signals.has('integrity:retracted'))
    assert.ok(turn.reachedLessonIds.has('L1'), 'a lesson whose action the model took is counted as reached')
    assert.equal(turn.substantive, true)
  })
})

describe('paper_mcp writes .mcp.json and never a secret', () => {
  const spec = { serverName: 'p', command: '/venv/bin/python', args: ['/srv/p_mcp.py'], cwd: '/srv', env: { PYTHONUNBUFFERED: '1', S2_API_KEY: 'sk-secret-value' } }
  test('the entry runs the server in its folder and names variables, not values', () => {
    const e = mcpEntry(spec)
    assert.deepEqual(e.args.slice(0, 3), ['-c', 'cd "$0" && exec "$@"', '/srv'])
    assert.deepEqual(e.args.slice(3), ['/venv/bin/python', '/srv/p_mcp.py'])
    assert.deepEqual(e.env, { PYTHONUNBUFFERED: '1', S2_API_KEY: '${S2_API_KEY}' })
    assert.doesNotMatch(JSON.stringify(e), /sk-secret-value/)
    assert.deepEqual(Object.keys(mcpEntry({ ...spec, env: { 'BAD NAME': 'x', 'a=b': 'y' } }).env), ['PYTHONUNBUFFERED'], 'a name that is not an identifier is dropped')
  })
  test('other servers in the file are kept, an identical entry is not rewritten, a broken file is refused untouched, and only our entry is removed', () => {
    const dir = scratch('mcpjson-')
    try {
      const file = join(dir, '.mcp.json')
      writeFileSync(file, JSON.stringify({ mcpServers: { mine: { command: 'x' } }, other: 1 }))
      assert.equal(writeMcpJson(dir, 'p', spec).changed, true)
      assert.equal(writeMcpJson(dir, 'p', spec).changed, false)
      const doc = JSON.parse(readFileSync(file, 'utf8'))
      assert.deepEqual(Object.keys(doc.mcpServers).sort(), ['mine', 'p'])
      assert.equal(doc.other, 1)
      assert.equal(removeFromMcpJson(dir, 'mine'), false, 'a server that is not ours is left')
      assert.equal(removeFromMcpJson(dir, 'p'), true)
      assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8')).mcpServers), ['mine'])
      writeFileSync(file, '{ not json')
      assert.throws(() => writeMcpJson(dir, 'p', spec), /not valid JSON/)
      assert.equal(readFileSync(file, 'utf8'), '{ not json')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('what the host serves now', () => {
  test('zvec_index, ah_rsi and paper_mcp are served; registering a server writes .mcp.json and a cloned registry mounts nothing by itself', { skip: !HAVE_UP }, async () => {
    const { createHost } = await import('../../server/src/host.mjs')
    const dir = scratch('host-')
    const saved = { ...process.env }
    process.env.DSH_HOME = join(dir, 'home')
    for (const f of ['ACADEMIC_HARNESS_SKIP_INSTALL', 'ACADEMIC_HARNESS_MODAL_SKIP_INSTALL', 'TEXTFOLD_SKIP_INSTALL', 'PAPERMEMORY_SKIP_INSTALL', 'ZVEC_GREP_SKIP_INSTALL']) process.env[f] = '1'
    const proj = join(dir, 'proj')
    mkdirSync(join(proj, '.dsh'), { recursive: true })
    mkdirSync(join(proj, 'srv'), { recursive: true })
    writeFileSync(join(proj, 'srv', 'p_mcp.py'), '# server\n')
    // a registry that came with the folder, already "approved" by nobody: it must not write .mcp.json at session start
    writeFileSync(join(proj, '.dsh', 'paper-mcps.json'), JSON.stringify({ schema_version: 1, servers: [{ serverName: 'shipped', command: process.execPath, args: [join(proj, 'srv', 'p_mcp.py')], cwd: proj, envNames: [] }] }))
    let host
    try {
      host = await createHost({ upstream: UP, areas: 'search,writing,memory', cwd: proj, logger: () => {}, env: { ...process.env, AH_MOD_HOME: join(dir, 'home'), AH_AUTO_PROVIDERS: '0', AH_DREAM_DELAY_MS: '-1' } })
      const names = host.list().map(t => t.name)
      for (const n of ['zvec_index', 'ah_rsi', 'paper_mcp']) assert.ok(names.includes(n), n)
      host.start()
      await new Promise(r => setTimeout(r, 200))
      assert.equal(existsSync(join(proj, '.mcp.json')), false, 'session start mounted nothing')
      const status = await host.call('paper_mcp', { action: 'status' })
      assert.match(status.content[0].text, /shipped/)
      assert.match(status.content[0].text, /pending approval|not-mounted/)
      const reg = await host.call('paper_mcp', { action: 'register', serverName: 'p', command: process.execPath, args: [join(proj, 'srv', 'p_mcp.py')], cwd: proj, envNames: ['S2_API_KEY'] })
      assert.notEqual(reg.isError, true, JSON.stringify(reg))
      const doc = JSON.parse(readFileSync(join(proj, '.mcp.json'), 'utf8'))
      assert.equal(doc.mcpServers.p.command, 'bash')
      assert.equal(doc.mcpServers.p.env.S2_API_KEY, '${S2_API_KEY}')
      const gone = await host.call('paper_mcp', { action: 'unregister', serverName: 'p' })
      assert.notEqual(gone.isError, true)
      assert.equal(JSON.parse(readFileSync(join(proj, '.mcp.json'), 'utf8')).mcpServers.p, undefined)
      const rsi = await host.call('ah_rsi', { action: 'status' })
      assert.match(rsi.content[0].text, /RSI mode: /)
    } finally {
      await host?.dispose()
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
      Object.assign(process.env, saved)
      rmSync(dir, { recursive: true, force: true })
    }
  })
  test('the five skills are built, none of them names the other host, and using-science-superpowers asks for a skill by need, not on every response', () => {
    const sup = readFileSync(join(root, 'skills', 'using-science-superpowers', 'SKILL.md'), 'utf8')
    assert.doesNotMatch(sup, /ANY response|even 1%|1% chance|ABSOLUTELY MUST/)
    assert.match(sup, /without waiting to be asked/)
    assert.match(sup, /greeting/)
    for (const n of ['agent-browser', 'modal', 'runpod', 'vastai', 'using-science-superpowers']) {
      const f = join(root, 'skills', n, 'SKILL.md')
      assert.ok(existsSync(f), n)
      const t = readFileSync(f, 'utf8')
      assert.doesNotMatch(t, /\bDSH\b|DeepSeek|dsh plugin|read_image|restart dsh/, n)
    }
  })
})
