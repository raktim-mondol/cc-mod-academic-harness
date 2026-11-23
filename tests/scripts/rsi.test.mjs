// The self-improvement loop (ah_rsi): off unless a person turns it on, never headless, driven one hook event at a time, with a store that stays bounded.
import '../helpers/ts-resolve.mjs'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { prepareEnv } from '../../server/src/env.mjs'
import { addTool, bareName, gateKind, loadRsi, mergeReply, rsiEvent } from '../../server/src/rsi-bridge.mjs'
import { DEFAULT_LIMITS, housekeeping } from '../../server/src/rsi-retention.mjs'
import { normalizeRsiMode, rsiMode } from '../../server/src/rsi-mode.mjs'

const guard = await import('../../hooks/guard-core.ts')
const hook = await import('../../hooks/rsi-core.ts')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const UP = join(root, 'core')
const HAVE_UP = existsSync(join(UP, 'node_modules', 'ah-dsh-tools'))
const scratch = prefix => { const base = join(homedir(), '.cache', 'ah-test-homes'); mkdirSync(base, { recursive: true }); return mkdtempSync(join(base, prefix)) }

/** Run `fn` with the loop's store and the mod's home in a scratch folder, and the process environment put back after. */
async function withLoop(prefix, fn) {
  const dir = scratch(prefix)
  const saved = { ...process.env }
  try {
    process.env.DSH_HOME = join(dir, 'home')
    process.env.AH_RSI_STORE = join(dir, 'store')
    delete process.env.AH_RSI
    mkdirSync(join(dir, 'proj'), { recursive: true })
    writeFileSync(join(dir, 'proj', 'ah.yaml'), 'name: x\n')
    const rsi = await loadRsi(UP)
    const ev = (event, payload = {}, extra = {}) => rsiEvent({ event, payload: { session_id: 's1', ...payload }, root: join(dir, 'proj'), home: join(dir, 'home'), rsi, mode: 'auto', ...extra })
    const lines = name => (existsSync(join(dir, 'store', name)) ? readFileSync(join(dir, 'store', name), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [])
    return await fn({ dir, ev, lines, rsi })
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
    rmSync(dir, { recursive: true, force: true })
  }
}
const call = (tool_name, tool_input = {}, tool_response = 'ok') => ({ tool_name, tool_input, tool_response })

describe('the mode: off unless a person turns it on', () => {
  // one table, run over the server's rule and the hooks module's
  const table = [
    // [AH_RSI, rsi_mode setting, expected]
    [undefined, undefined, 'off'], ['', '', 'off'], ['  ', undefined, 'off'],
    [undefined, 'off', 'off'], [undefined, 'observe', 'observe'], [undefined, 'auto', 'auto'],
    ['observe', undefined, 'observe'], ['auto', 'off', 'auto'], ['off', 'auto', 'off'], ['observe', 'auto', 'observe'],
    ['AUTO', undefined, 'auto'], [' Observe ', undefined, 'observe'], ['1', undefined, 'auto'], ['true', undefined, 'auto'], ['on', undefined, 'auto'], ['yes', undefined, 'auto'],
    ['0', 'auto', 'off'], ['false', 'auto', 'off'], ['no', 'auto', 'off'],
    ['sometimes', undefined, 'off'], [undefined, 'sometimes', 'off'], ['autoo', 'auto', 'off'], ['', 'sometimes', 'off'],
  ]
  test('the server and the hooks module read the same table the same way', () => {
    for (const [shell, setting, expected] of table) {
      assert.equal(rsiMode({ AH_RSI: shell, AH_RSI_SETTING: setting }), expected, `server: ${JSON.stringify([shell, setting])}`)
      assert.equal(hook.rsiMode(shell, setting), expected, `hooks: ${JSON.stringify([shell, setting])}`)
    }
    assert.equal(normalizeRsiMode(''), null)
    assert.equal(hook.normalizeRsiMode(''), null)
  })
  test('a headless run is always off, whatever the shell says', () => {
    assert.equal(rsiMode({ AH_RSI: 'auto', AH_RSI_INTERACTIVE: '0' }), 'off')
    assert.equal(rsiMode({ AH_RSI_SETTING: 'auto', AH_RSI_INTERACTIVE: '0' }), 'off')
    assert.equal(rsiMode({ AH_RSI: 'auto', AH_RSI_INTERACTIVE: '1' }), 'auto')
    assert.equal(rsiMode({ AH_RSI: 'auto' }), 'auto', 'a process that was not told is not assumed headless (the server)')
  })
  test('the hooks module starts out as not interactive, and only session.start says otherwise', () => {
    assert.equal(hook.rsiInteractive(), false)
    hook.setRsiInteractive(true)
    assert.equal(hook.rsiInteractive(), true)
    hook.setRsiInteractive(false)
    assert.equal(hook.rsiInteractive(), false)
    hook.setRsiInteractive(undefined)
    assert.equal(hook.rsiInteractive(), false)
  })
  test('the server settles AH_RSI for the core once: the shell, else the plugin option, else off', () => {
    const a = {}; prepareEnv(a, {})
    assert.equal(a.AH_RSI, 'off', 'the default')
    const b = { AH_RSI_SETTING: 'observe' }; prepareEnv(b)
    assert.equal(b.AH_RSI, 'observe')
    const c = { AH_RSI_SETTING: 'observe', AH_RSI: 'auto' }; prepareEnv(c)
    assert.equal(c.AH_RSI, 'auto', 'a variable the person exported wins')
    const d = { AH_RSI: 'whenever' }; prepareEnv(d)
    assert.equal(d.AH_RSI, 'off', 'a value that is not a mode is off, never on')
  })
  test('the plugin option exists, is off by default and reaches the server and the bridge', () => {
    const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'))
    assert.deepEqual(manifest.userConfig.rsi_mode.options, ['off', 'observe', 'auto'])
    assert.equal(manifest.userConfig.rsi_mode.default, 'off')
    assert.equal(manifest.mcpServers.ah.env.AH_RSI_SETTING, '${user_config.rsi_mode}')
  })
})

describe('what the hooks hand the loop', () => {
  test('a tool input and result are bounded, and a value that cannot be printed does not throw', () => {
    assert.deepEqual(hook.clipInput({ file_path: 'a.tex' }), { file_path: 'a.tex' }, 'a small input is passed as it is')
    const big = hook.clipInput({ file_path: 'a.tex', content: 'x'.repeat(100_000) })
    assert.equal(typeof big, 'string')
    assert.equal(big.length, hook.MAX_INPUT_CHARS)
    assert.equal(hook.clipResponse('y'.repeat(100_000)).length, hook.MAX_RESPONSE_CHARS)
    assert.equal(hook.clipResponse({ content: [{ type: 'text', text: 'ok' }] }), '{"content":[{"type":"text","text":"ok"}]}')
    assert.equal(hook.clipResponse(undefined), '""')
    assert.equal(hook.clipFailure('e'.repeat(10_000)).length, hook.MAX_FAILURE_CHARS)
    const cyclic = {}; cyclic.self = cyclic
    assert.doesNotThrow(() => hook.clipResponse(cyclic))
  })
  test('a batch is at most MAX_BATCH_CALLS calls, each cut, and what is not a call is dropped', () => {
    const calls = Array.from({ length: 100 }, (_, i) => ({ tool_name: `t${i}`, tool_input: { i }, tool_response: 'r'.repeat(100_000) }))
    const reduced = hook.reduceBatch([null, 5, 'x', { tool_name: '' }, { nothing: 1 }, ...calls])
    assert.equal(reduced.length, hook.MAX_BATCH_CALLS)
    assert.ok(reduced.every(c => c.tool_response.length === hook.MAX_RESPONSE_CHARS))
    assert.deepEqual(hook.reduceBatch('not a list'), [])
    assert.deepEqual(hook.reduceBatch(undefined), [])
    assert.deepEqual(hook.reduceBatch([{ tool_name: 'Read', tool_input: { f: 1 } }]), [{ tool_name: 'Read', tool_input: { f: 1 }, tool_response: '""' }])
  })
})

describe('the loop, one hook event at a time', () => {
  test('a stated preference is recorded and returned as context; a step\'s calls and the end of the turn are kept across processes', { skip: !HAVE_UP }, async () => {
    await withLoop('rsi-', async ({ dir, ev, lines }) => {
      const first = await ev('userprompt', { prompt: 'From now on, always run integrity_check before you cite a paper in the manuscript.' })
      assert.match(first.additionalContext, /Local learned guidance \(RSI\)/)
      assert.match(first.additionalContext, /integrity_check before you cite/)
      assert.deepEqual(await ev('batch', { tool_calls: [call('mcp__plugin_academic-harness_ah__integrity_check', { doi: '10.1/x' }, '{"verdict":"retracted"}'), call('Read', { file_path: 'a.tex' }, 'text')] }), {})
      assert.deepEqual(await ev('stop', {}), {})
      const events = lines('events.jsonl')
      assert.deepEqual(events.map(e => e.type), ['user_turn', 'lesson_injected', 'tool', 'tool', 'gate'])
      assert.equal(events[2].tool, 'integrity_check', 'the MCP prefix is stripped')
      assert.equal(events[2].verdict, 'retracted')
      assert.equal(events[3].tool, 'Read')
      assert.equal(lines('episodes.jsonl').length, 1, 'the stop closed the turn into one episode')
      await ev('userprompt', { prompt: 'Please revise the introduction.' })
      assert.equal(JSON.parse(readFileSync(join(dir, 'home', 'rsi-sessions', 's1', 'state.json'), 'utf8')).currentTurn.index, 1, 'a second prompt opens a new turn')
    })
  })
  test('a call that failed is an error signal of its own', { skip: !HAVE_UP }, async () => {
    await withLoop('rsi-fail-', async ({ ev, lines }) => {
      await ev('userprompt', { prompt: 'Please compile the manuscript.' })
      await ev('fail', { tool_name: 'Bash', tool_input: { command: 'latexmk main.tex' }, error: 'Command failed: latexmk main.tex (exit 12) in /home/u/paper/main.tex' })
      await ev('fail', { tool_name: 'Bash', tool_input: { command: 'latexmk main.tex' }, error: 'Command failed: latexmk main.tex (exit 12) in /home/u/paper/main.tex' })
      await ev('stop', {})
      const tools = lines('events.jsonl').filter(e => e.type === 'tool')
      assert.equal(tools.length, 2)
      assert.ok(tools.every(t => t.tool === 'Bash' && t.is_error === true))
      const [episode] = lines('episodes.jsonl')
      const signals = episode.signals ?? []
      const err = signals.find(x => x.kind === 'error')
      assert.ok(err && err.key.startsWith('Bash:command failed: latexmk'), `signals: ${JSON.stringify(signals)}`)
      assert.ok(!/\/home\/u/.test(err.key), 'a path in the error is not kept: the signature is normalised')
      assert.ok(signals.some(x => x.kind === 'retry' && x.key === 'Bash'), 'the same failing call twice is a retry')
    })
  })
  test('a stop the gate blocks keeps the turn open; the stop that ends it closes it once, and a handoff is a signal', { skip: !HAVE_UP }, async () => {
    await withLoop('rsi-gate-', async ({ ev, lines }) => {
      await ev('userprompt', { prompt: 'Please revise the introduction of the manuscript.' })
      await ev('batch', { tool_calls: [call('Edit', { file_path: 'a.tex' })] })
      await ev('stop', {}, { engineOut: JSON.stringify({ decision: 'block', reason: 'AH gate: 2 blocking findings remain.' }) })
      assert.equal(lines('episodes.jsonl').length, 0, 'the gate blocked the stop, so the turn is still open')
      await ev('batch', { tool_calls: [call('Edit', { file_path: 'a.tex', again: 1 })] })
      await ev('stop', {}, { engineOut: '' })
      const [episode] = lines('episodes.jsonl')
      assert.equal(lines('episodes.jsonl').length, 1, 'closed once, when the gate let go')
      assert.deepEqual(episode.gate_history, ['continue', 'none'])
      assert.equal(episode.gate, null, 'a gate that let go leaves no gate on the turn')
      await ev('userprompt', { prompt: 'Please revise the introduction of the manuscript again.' })
      await ev('batch', { tool_calls: [call('Edit', { file_path: 'b.tex' })] })
      await ev('stop', {}, { engineOut: JSON.stringify({ systemMessage: 'AH gate: stopped after 3 attempts with 2 blocking finding(s) the agent\'s edits introduced:\n- X-1\nThe author decides what to do next.' }) })
      assert.equal(lines('episodes.jsonl').length, 2)
      assert.equal(lines('episodes.jsonl').at(-1).gate?.kind, 'handoff')
    })
  })
  test('hook events that arrive together are all counted, under the session\'s lock', { skip: !HAVE_UP }, async () => {
    await withLoop('rsi-par-', async ({ dir, ev }) => {
      await ev('userprompt', { prompt: 'Please check the statistics in the results section.' })
      const results = await Promise.all(Array.from({ length: 24 }, (_, i) => ev(i % 2 ? 'batch' : 'fail', i % 2 ? { tool_calls: [call('Read', { f: i })] } : { tool_name: 'Read', tool_input: { f: i }, error: `boom ${i}` })))
      assert.ok(results.every(r => !r.error), JSON.stringify(results.find(r => r.error)))
      const state = JSON.parse(readFileSync(join(dir, 'home', 'rsi-sessions', 's1', 'state.json'), 'utf8'))
      assert.equal(state.currentTurn.toolCounts.Read, 24, 'no update was lost')
    })
  })
  test('observe records and adds nothing to the prompt; off reads and writes nothing, not even the store\'s folder', { skip: !HAVE_UP }, async () => {
    await withLoop('rsi-mode-', async ({ dir, ev, lines }) => {
      const prompt = 'From now on, always run integrity_check before you cite a paper in the manuscript.'
      for (const mode of ['off', undefined, 'bogus']) assert.deepEqual(await ev('userprompt', { prompt }, { mode }), {}, `mode ${mode}`)
      assert.equal(existsSync(join(dir, 'store')), false, 'no store')
      assert.equal(existsSync(join(dir, 'home', 'rsi-sessions')), false, 'no session folder')
      assert.deepEqual(await ev('userprompt', { prompt }, { mode: 'observe' }), {}, 'observe adds nothing')
      assert.ok(lines('events.jsonl').some(e => e.type === 'user_turn'), 'but it records')
    })
  })
  test('the lessons are merged into the engine reply when there is one, and stand alone when there is not', () => {
    assert.equal(mergeReply('x', undefined), 'x')
    assert.deepEqual(JSON.parse(mergeReply('', 'L')), { additionalContext: 'L' })
    assert.deepEqual(JSON.parse(mergeReply('{"additionalContext":"card"}', 'L')), { additionalContext: 'card\n\nL' })
    assert.equal(JSON.parse(mergeReply('{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"card"}}', 'L')).hookSpecificOutput.additionalContext, 'card\n\nL')
    assert.equal(mergeReply('a log line, not JSON', 'L'), 'a log line, not JSON', 'a reply that cannot be merged is left alone')
  })
  test('the loop reads the stop gate the way the guard does', () => {
    const samples = [
      '', '{}', 'not json', '{"decision":"block","reason":"AH gate: 2 blocking findings remain."}',
      '{"decision":"block","reason":"AH gate: stopping after 5 attempts. The author decides what to do next."}',
      '{"hookSpecificOutput":{"hookEventName":"Stop","permissionDecision":"deny","permissionDecisionReason":"no"},"reason":"blocked by the gate"}',
      '{"systemMessage":"AH gate: stopped after 3 attempts."}', '{"systemMessage":"Evidence check: 2 clauses look unsupported."}',
      '{"additionalContext":"note only"}', '{"hookSpecificOutput":{"additionalContext":"card"}}', '{"decision":"deny","reason":"AH gate: stopping after 2 rounds."}',
    ]
    for (const raw of samples) assert.equal(gateKind(raw), guard.gateDecision(guard.parseEngineStdout(raw)).kind, JSON.stringify(raw))
  })
  test('tool names lose the MCP prefix, and a turn counts what a tool did', () => {
    assert.equal(bareName('mcp__plugin_academic-harness_ah__ah_check'), 'ah_check')
    assert.equal(bareName('Bash'), 'Bash')
    const turn = { toolCounts: {}, findings: new Map(), signals: new Set(), injectedActions: new Map([['L1', 'integrity_check']]), reachedLessonIds: new Set(), toolSignatures: new Set(), qualitySignals: {}, errors: 0 }
    const summary = { name: 'integrity_check', is_error: true, findings: ['TEX-12'], error_signature: 'boom', args_hash: 'h', verdict: 'retracted' }
    addTool(turn, summary, {})
    addTool(turn, summary, {})
    assert.equal(turn.errors, 2)
    assert.ok(turn.signals.has('retry:integrity_check'))
    assert.ok(turn.signals.has('integrity:retracted'))
    assert.ok(turn.reachedLessonIds.has('L1'))
    assert.equal(turn.substantive, true)
  })
})

describe('the hook entry point', () => {
  /** Run ah-hook.mjs `event` with a payload, in a scratch mod home; returns the process result. */
  const run = (dir, event, payload, env) => spawnSync('node', [join(root, 'server', 'bin', 'ah-hook.mjs'), event], { input: JSON.stringify(payload), env: { ...process.env, AH_MOD_HOME: join(dir, 'mod'), AH_RSI_STORE: join(dir, 'store'), AH_RSI: '', AH_RSI_SETTING: '', AH_RSI_INTERACTIVE: '', ...env }, encoding: 'utf8' })
  test('off by default, off headless and off outside a project: nothing is loaded or written; observe in a project with a person at the prompt records', { skip: !HAVE_UP }, () => {
    const dir = scratch('rsi-hook-')
    try {
      mkdirSync(join(dir, 'proj'), { recursive: true })
      mkdirSync(join(dir, 'plain'), { recursive: true })
      writeFileSync(join(dir, 'proj', 'ah.yaml'), 'name: x\n')
      const batch = (cwd, session) => ({ session_id: session, cwd, tool_calls: [call('Read', {}, 'x')] })
      const sessions = join(dir, 'mod', 'rsi-sessions')
      // nothing set: off
      assert.equal(run(dir, 'rsi-batch', batch(join(dir, 'proj'), 'a'), {}).status, 0)
      assert.equal(existsSync(sessions), false, 'off by default')
      assert.equal(existsSync(join(dir, 'store')), false)
      // asked for, but headless
      assert.equal(run(dir, 'rsi-batch', batch(join(dir, 'proj'), 'b'), { AH_RSI: 'auto', AH_RSI_INTERACTIVE: '0' }).status, 0)
      assert.equal(existsSync(sessions), false, 'never headless')
      // asked for, with a person, but outside an ah.yaml tree
      assert.equal(run(dir, 'rsi-batch', batch(join(dir, 'plain'), 'c'), { AH_RSI_SETTING: 'observe', AH_RSI_INTERACTIVE: '1' }).status, 0)
      assert.equal(existsSync(sessions), false, 'only in an Academic Harness project')
      // asked for, with a person, in a project: a session folder, and nothing for a turn that is not open
      assert.equal(run(dir, 'rsi-batch', batch(join(dir, 'proj'), 'd'), { AH_RSI_SETTING: 'observe', AH_RSI_INTERACTIVE: '1' }).status, 0)
      assert.ok(existsSync(join(sessions, 'd')), 'observe is on')
      // the shell wins over the option
      assert.equal(run(dir, 'rsi-fail', { session_id: 'e', cwd: join(dir, 'proj'), tool_name: 'Bash', error: 'x' }, { AH_RSI: 'off', AH_RSI_SETTING: 'auto', AH_RSI_INTERACTIVE: '1' }).status, 0)
      assert.equal(existsSync(join(sessions, 'e')), false)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('the store stays bounded', () => {
  const fakeStore = (dir, { lessons = [], meta = {} } = {}) => {
    let m = { ...meta }
    return {
      RSI_VERSION: 1,
      readMeta: () => ({ ...m }),
      updateMeta: (_d, patch) => { m = { ...m, ...patch }; return m },
      currentLessons: () => lessons,
      withStoreLock: async (_d, fn) => fn(),
      get meta() { return m },
    }
  }
  const write = (dir, name, n, line = 'x'.repeat(99)) => writeFileSync(join(dir, name), `${Array.from({ length: n }, () => line).join('\n')}\n`)

  test('a file past its limit is rotated to <name>.1 once a day, a file within it is left, and a new append starts a new file', async () => {
    const dir = scratch('rsi-ret-')
    try {
      write(dir, 'events.jsonl', 50)       // 5,000 bytes
      write(dir, 'episodes.jsonl', 5)      // 500 bytes
      write(dir, 'decisions.jsonl', 50)
      const store = fakeStore(dir)
      const limits = { events: 1000, episodes: 1000, decisions: 1000, lessons: 1000, everyMs: 1000 }
      const done = await housekeeping({ dir, store, lock: store.withStoreLock, limits, now: 10_000 })
      assert.deepEqual(done.rotated.sort(), ['decisions.jsonl', 'events.jsonl'])
      assert.ok(existsSync(join(dir, 'events.jsonl.1')) && !existsSync(join(dir, 'events.jsonl')))
      assert.ok(existsSync(join(dir, 'episodes.jsonl')) && !existsSync(join(dir, 'episodes.jsonl.1')), 'a small file is left')
      writeFileSync(join(dir, 'events.jsonl'), 'new\n', { flag: 'a' })
      assert.equal(readFileSync(join(dir, 'events.jsonl'), 'utf8'), 'new\n', 'the next append starts a new file')
      // not again within the interval, again after it, and the generation before is replaced
      assert.deepEqual(await housekeeping({ dir, store, lock: store.withStoreLock, limits, now: 10_500 }), { skipped: true })
      write(dir, 'events.jsonl', 50)
      assert.equal((await housekeeping({ dir, store, lock: store.withStoreLock, limits, now: 12_000 })).rotated[0], 'events.jsonl')
      assert.equal(statSync(join(dir, 'events.jsonl.1')).size, 5000, 'at most two generations: the older one is replaced')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  test('a lessons file past its limit is compacted to one row per lesson, atomically and under the store lock', async () => {
    const dir = scratch('rsi-lessons-')
    try {
      const lessons = [{ id: 'La', text: 'one', status: 'active' }, { id: 'Lb', text: 'two', status: 'retired' }]
      write(dir, 'lessons.jsonl', 40)
      let locked = 0
      const store = { ...fakeStore(dir, { lessons }), withStoreLock: async (_d, fn) => { locked++; return fn() } }
      const done = await housekeeping({ dir, store, lock: store.withStoreLock, limits: { lessons: 1000, everyMs: 1 }, now: 5_000 })
      assert.equal(done.compacted, true)
      assert.equal(locked, 1)
      const rows = readFileSync(join(dir, 'lessons.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
      assert.deepEqual(rows.map(r => [r.op, r.lesson.id, r.reason]), [['upsert', 'La', 'compact'], ['upsert', 'Lb', 'compact']])
      assert.equal(existsSync(`${join(dir, 'lessons.jsonl')}.${process.pid}.tmp`), false, 'no temporary file is left')
      assert.equal((await housekeeping({ dir, store, lock: store.withStoreLock, limits: { lessons: 1000, everyMs: 1 }, now: 9_000 })).compacted, false, 'a small file is left')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  test('the default limits are generous and the interval is a day', () => {
    assert.ok(DEFAULT_LIMITS.events >= 1024 * 1024 && DEFAULT_LIMITS.episodes >= 512 * 1024 && DEFAULT_LIMITS.lessons >= 128 * 1024)
    assert.equal(DEFAULT_LIMITS.everyMs, 24 * 60 * 60 * 1000)
  })
  test('a stop runs the housekeeping through the real store, and a store that is not there yet is no error', { skip: !HAVE_UP }, async () => {
    await withLoop('rsi-stop-', async ({ dir, ev }) => {
      await ev('userprompt', { prompt: 'Please check the statistics in the results section.' })
      await ev('batch', { tool_calls: [call('Read', { f: 1 })] })
      const done = await ev('stop', {}, { limits: { events: 10, episodes: 10, decisions: 10, lessons: 10, everyMs: 0 } })
      assert.ok(!done.error, JSON.stringify(done))
      assert.ok(existsSync(join(dir, 'store', 'events.jsonl.1')) && existsSync(join(dir, 'store', 'episodes.jsonl.1')), 'the files past their limit were rotated')
      assert.ok(JSON.parse(readFileSync(join(dir, 'store', 'meta.json'), 'utf8')).housekeeping_at > 0)
    })
  })
})
