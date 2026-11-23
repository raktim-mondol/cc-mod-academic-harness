import { expect, mock, test } from 'claude-code/testing'

// The writing-engine guard (P3). Nothing sits beneath the plugin in a test: each hook below stands for the
// engine, and `process.run` stands for server/bin/ah-hook.mjs, so these tests drive the guard's own logic.
// The real engine is exercised by tests/server/guard-bridge.test.mjs and tests/live/p3.mjs.

type Reply = { exitCode: number; stdout?: string; stderr?: string } | 'throw'

function world(on: any, opts: { cwd?: string; files?: string[]; reply?: Reply | ((event: string, payload: any) => Reply) } = {}) {
  const cwd = opts.cwd ?? '/p/sections'
  const files = new Set(opts.files ?? ['/p/ah.yaml'])
  const runs: { argv: string[]; event: string; payload: any; env: Record<string, string> | undefined }[] = []
  on('session.cwd', () => ({ value: cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.model', () => ({ value: 'claude-haiku-5-5' }))
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: files.has(e.path) }))
  on('process.run', (_: unknown, e: { argv: string[]; init?: { stdin?: string; env?: Record<string, string> } }) => {
    const event = e.argv[e.argv.length - 1] ?? ''
    const payload = e.init?.stdin ? JSON.parse(e.init.stdin) : null
    runs.push({ argv: e.argv, event, payload, env: e.init?.env })
    const r = typeof opts.reply === 'function' ? opts.reply(event, payload) : (opts.reply ?? { exitCode: 0, stdout: '' })
    if (r === 'throw') throw new Error('could not start')
    return { value: { exitCode: r.exitCode, stdout: r.stdout ?? '', stderr: r.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // What sits beneath the plugin: the tool itself, and the classic events' and the permission check's own answers.
  on('tool.call', () => ({ result: 'RAN' }))
  on('classic.PostToolUse', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.Stop', () => ({}))
  on('tool.check', () => ({ decision: 'allow' }))
  return { runs, cwd }
}

/** The calls that went to the writing engine: the self-improvement loop's own events (`rsi-batch`, `rsi-fail`) are other calls and are tested below. */
const engineRuns = <T extends { event: string; argv: string[] }>(w: { runs: T[] }): T[] => w.runs.filter((r) => /ah-hook\.mjs$/.test(r.argv[1] ?? '') && r.event !== 'rsi-batch' && r.event !== 'rsi-fail')

const deny = (reason: string) => ({ stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }), exitCode: 0 })
const at = (w: { cwd: string }) => ({ cwd: w.cwd, session_id: 'sess-1' })
const write = ($: any, path = '/p/facts/facts.yaml') => $.tool.call({ tool: 'Write', file_path: path, content: 'x' })

test('outside an ah.yaml tree no process is started, for any tool', async ($, on) => {
  const w = world(on, { cwd: '/home/u/notes', files: [] })
  const r = await write($, '/home/u/notes/a.txt')
  expect(r.isError ?? false).toBe(false)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(w.runs.length).toBe(0)
})

test('a read inside the project starts no process either', async ($, on) => {
  const w = world(on)
  await $.tool.call({ tool: 'Read', file_path: '/p/facts/facts.yaml' })
  expect(w.runs.length).toBe(0)
})

test('the engine denies a protected write: the call is refused with its reason, and the payload is the settings-hook shape', async ($, on) => {
  const w = world(on, { reply: deny('AH guard: facts/facts.yaml is protected. If it is wrong, record a question for the author with `ah finding decide <id> --reason "..."`.') })
  const r = await write($)
  expect(r.isError).toBe(true)
  expect(JSON.stringify(r)).toContain('facts/facts.yaml is protected')
  expect(JSON.stringify(r)).toContain('ah_decision_request')
  expect(JSON.stringify(r)).not.toContain('ah finding decide')
  expect(w.runs.length).toBe(1)
  const run = w.runs[0]!
  expect(run.argv[0]).toBe('node')
  expect(run.argv[1]).toMatch(/server\/bin\/ah-hook\.mjs$/)
  expect(run.event).toBe('pre')
  expect(run.payload).toMatchObject({ hook_event_name: 'PreToolUse', tool_name: 'Write', session_id: 'sess-1', cwd: '/p/sections', tool_input: { file_path: '/p/facts/facts.yaml', content: 'x' } })
  expect(run.payload.tool_input.tool).toBeUndefined()
  expect(run.env?.AH_MODEL).toBe('claude-haiku-5-5')
})

test('a warning line, a JSON log line and a trailing line around the reply do not hide a denial', async ($, on) => {
  const reply = deny('still protected').stdout
  world(on, { reply: { exitCode: 0, stdout: `warning: profile not found\n{"level":"info","msg":"starting"}\n${reply}\n[trace] done\n` } })
  const r = await write($)
  expect(r.isError).toBe(true)
  expect(JSON.stringify(r)).toContain('still protected')
})

test('an allowed edit goes on to the tool', async ($, on) => {
  const w = world(on, { reply: { exitCode: 0, stdout: '' } })
  const r = await $.tool.call({ tool: 'Edit', file_path: '/p/sections/a.tex', old_string: 'a', new_string: 'b' })
  expect(r.isError ?? false).toBe(false)
  expect(w.runs.map(x => x.event)).toEqual(['pre'])
})

test('Bash is checked with its command', async ($, on) => {
  const w = world(on, { reply: deny('AH guard: only the author can do this (waive).') })
  const r = await $.tool.call({ tool: 'Bash', command: 'ah finding waive abc --yes' })
  expect(r.isError).toBe(true)
  expect(w.runs[0]!.payload.tool_input).toEqual({ command: 'ah finding waive abc --yes' })
})

test('fail closed: the engine exits non-zero, so Write, Edit, NotebookEdit and Bash are refused and a Read goes through', async ($, on) => {
  const w = world(on, { reply: { exitCode: 3, stdout: '', stderr: 'ah-hook: no engine to run: the engine has no virtual environment' } })
  for (const call of [
    { tool: 'Write', file_path: '/p/sections/a.tex', content: 'x' },
    { tool: 'Edit', file_path: '/p/sections/a.tex', old_string: 'a', new_string: 'b' },
    { tool: 'NotebookEdit', notebook_path: '/p/n.ipynb', new_source: 'x' },
    { tool: 'Bash', command: 'echo hi > /p/sections/a.tex' },
  ]) {
    const r = await $.tool.call(call as any)
    expect(r.isError).toBe(true)
    expect(JSON.stringify(r)).toContain('could not be checked')
    expect(JSON.stringify(r)).toContain('install-engine')
  }
  const read = await $.tool.call({ tool: 'Read', file_path: '/p/sections/a.tex' })
  expect(read.isError ?? false).toBe(false)
})

test('fail closed: the process cannot start or overruns, so the call is refused', async ($, on) => {
  const w = world(on, { reply: 'throw' })
  const r = await $.tool.call({ tool: 'Bash', command: 'sed -i s/a/b/ /p/sections/a.tex' })
  expect(r.isError).toBe(true)
  expect(JSON.stringify(r)).toContain('could not be checked')
})

test('fail closed: exit 0 with output that is not JSON is a failure, not an allow', async ($, on) => {
  const w = world(on, { reply: { exitCode: 0, stdout: 'Traceback (most recent call last)' } })
  const r = await write($, '/p/sections/a.tex')
  expect(r.isError).toBe(true)
})

test('the post-edit note reaches the model, and a failing post check never blocks', async ($, on) => {
  const note = '[AH] This edit introduced 1 finding(s): NUM-01'
  const w = world(on, { reply: (event) => event === 'post' ? { exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: note } }) } : { exitCode: 0, stdout: '' } })
  const out = await $.classic.PostToolUse({ ...at(w), tool_name: 'Edit', tool_input: { file_path: '/p/sections/a.tex' }, tool_response: { big: 'x'.repeat(1000) }, tool_use_id: 't1' })
  expect(out.additionalContext).toEqual([note])
  expect(engineRuns(w).length).toBe(1)
  expect(JSON.stringify(engineRuns(w)[0]!.payload)).not.toContain('tool_response')
})

test('a post check that fails never blocks the turn', async ($, on) => {
  const w = world(on, { reply: { exitCode: 1, stdout: '', stderr: 'boom' } })
  const out = await $.classic.PostToolUse({ ...at(w), tool_name: 'Edit', tool_input: { file_path: '/p/sections/a.tex' }, tool_response: {}, tool_use_id: 't2' })
  expect(out.block).toBeUndefined()
  expect(out.additionalContext).toBeUndefined()
  expect(engineRuns(w).length).toBe(1)
})

test('a Read does not run the post check', async ($, on) => {
  const w = world(on)
  await $.classic.PostToolUse({ ...at(w), tool_name: 'Read', tool_input: { file_path: '/p/a' }, tool_response: {}, tool_use_id: 't3' })
  expect(engineRuns(w).length).toBe(0)
})

test('the prompt hook adds the paper-state card, without the shell sentence and with the tool names', async ($, on) => {
  const card = '# Paper state: demo\n\nRules...\n\nHarness commands run in your shell as `ah ...` (for example `ah check`). Finding ids are the 8 characters printed first on each finding.\n'
  const w = world(on, { reply: { exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: card } }) } })
  const out = await $.classic.UserPromptSubmit({ ...at(w), prompt: 'write the intro' })
  const text = (out.additionalContext ?? []).join('\n')
  expect(text).toContain('# Paper state: demo')
  expect(text).not.toContain('run in your shell as')
  expect(text).toContain('ah_decision_request')
  expect(text).toContain('mcp__plugin_academic-harness_ah__')
  expect(w.runs[0]!.event).toBe('userprompt')
})

test('the stop gate keeps the turn going while blockers stand, hands off once, then lets the turn end', async ($, on) => {
  const block = { decision: 'block', reason: 'AH gate (attempt 1/3): your edits introduced blocking findings.\n- NUM-01 a.tex\nrun `ah finding decide <id> --reason "<question>"` and stop.' }
  const handoff = { systemMessage: 'AH gate: stopped after 3 attempts with 1 blocking finding(s) the agent\'s edits introduced:\n- NUM-01\nThe author decides what to do next.' }
  let n = 0
  const w = world(on, { reply: (event) => { if (event !== 'stop') return { exitCode: 0, stdout: '' }; n++; return { exitCode: 0, stdout: JSON.stringify(n === 1 ? block : handoff) } } })

  const first = await $.classic.Stop({ ...at(w), stop_hook_active: false })
  expect(first.block).toContain('AH gate (attempt 1/3)')
  expect(first.block).toContain('ah_decision_request')

  const second = await $.classic.Stop({ ...at(w), stop_hook_active: true })
  expect(second.block).toContain('STOP. Report these findings to the author.')

  const third = await $.classic.Stop({ ...at(w), stop_hook_active: true })
  expect(third.block).toBeUndefined()
  expect(w.runs.every(r => r.event === 'stop')).toBe(true)
})

test('a clean stop and a stop outside a project do nothing', async ($, on) => {
  const w = world(on, { reply: { exitCode: 0, stdout: '' } })
  expect((await $.classic.Stop({ ...at(w), stop_hook_active: false })).block).toBeUndefined()
  expect(w.runs.length).toBe(1)
})

test('outside a project the stop gate, the prompt hook and the post check start no process', async ($, on) => {
  const w = world(on, { cwd: '/home/u/notes', files: [], reply: { exitCode: 0, stdout: JSON.stringify({ decision: 'block', reason: 'never asked' }) } })
  expect((await $.classic.Stop({ ...at(w), stop_hook_active: false })).block).toBeUndefined()
  expect((await $.classic.UserPromptSubmit({ ...at(w), prompt: 'hi' })).additionalContext).toBeUndefined()
  await $.classic.PostToolUse({ ...at(w), tool_name: 'Edit', tool_input: {}, tool_response: {}, tool_use_id: 't' })
  expect(w.runs.length).toBe(0)
})

test('the evidence check is off unless the setting says run', async ($, on) => {
  const w = world(on)
  await $.classic.Stop({ ...at(w), stop_hook_active: false })
  expect(w.runs[0]!.env?.AH_T3_MODE).toBe('skip')
})

test('the evidence check runs when the setting is run', { options: { evidence_check: 'run' } }, async ($, on) => {
  const w = world(on)
  await $.classic.Stop({ ...at(w), stop_hook_active: false })
  expect(w.runs[0]!.env?.AH_T3_MODE).toBe('run')
})

test('ah_author asks, with the act named; where nobody can answer the reason says how to go on', async ($, on) => {
  world(on)
  const person = await $.tool.check({ tool: 'mcp__plugin_academic-harness_ah__ah_author', input: { action: 'waive', id: 'abc12345', reason: 'x' } })
  expect(person.decision).toBe('ask')
  expect(person.reason).toContain('Author-only')
})

test('ah_migrate with apply and no confirm is denied; with confirm it is not asked about', async ($, on) => {
  world(on)
  const bad = await $.tool.check({ tool: 'mcp__plugin_academic-harness_ah__ah_migrate', input: { apply: true } })
  expect(bad.decision).toBe('deny')
  expect(bad.reason).toContain('confirm=true')
  const ok = await $.tool.check({ tool: 'mcp__plugin_academic-harness_ah__ah_migrate', input: { apply: true, confirm: true } })
  expect(ok.decision).not.toBe('deny')
  const other = await $.tool.check({ tool: 'mcp__plugin_academic-harness_ah__ah_state', input: {} })
  expect(other.decision).not.toBe('deny')
  expect(other.decision).not.toBe('ask')
})

const MODAL = 'mcp__plugin_academic-harness_ah__modal_run'

test('paid compute always asks, with the reason the approval script gave, in any folder', async ($, on) => {
  const w = world(on, { cwd: '/home/u/notes', files: [], reply: { exitCode: 0, stdout: JSON.stringify({ decision: 'ask', reason: 'Modal will rent paid hardware: instance "cpu".' }) + '\n' } })
  const r = await $.tool.check({ tool: MODAL, input: { command: 'python train.py', timeout_sec: 600 } })
  expect(r.decision).toBe('ask')
  expect(r.reason).toContain('Modal will rent paid hardware')
  expect(w.runs[0]!.argv[1]).toMatch(/server\/bin\/ah-approve\.mjs$/)
  expect(w.runs[0]!.payload).toMatchObject({ tool: 'modal_run', input: { command: 'python train.py' }, session_id: 'sess-1' })
})

test('paid compute: a run over the session cap is refused with the numbers', async ($, on) => {
  world(on, { reply: { exitCode: 0, stdout: JSON.stringify({ decision: 'deny', reason: 'Session spend cap reached: this Modal run could cost up to $5.32' }) } })
  const r = await $.tool.check({ tool: MODAL, input: { command: 'x', timeout_sec: 3600 } })
  expect(r.decision).toBe('deny')
  expect(r.reason).toContain('Session spend cap reached')
})

test('paid compute: when the approval script fails the call still asks, with the plain reason, and never allows', async ($, on) => {
  world(on, { reply: { exitCode: 1, stdout: '', stderr: 'boom' } })
  const r = await $.tool.check({ tool: MODAL, input: { command: 'x' } })
  expect(r.decision).toBe('ask')
  expect(r.reason).toContain('rented hardware')
})

test('paid compute: when the script cannot even start the call asks', async ($, on) => {
  world(on, { reply: 'throw' })
  const r = await $.tool.check({ tool: 'mcp__plugin_academic-harness_ah__runpod_run', input: { command: 'x' } })
  expect(r.decision).toBe('ask')
})

test('paid compute: the session cap setting reaches the approval script', { options: { compute_session_cap_usd: '2.5' } }, async ($, on) => {
  const w = world(on, { reply: { exitCode: 0, stdout: '{"decision":"ask","reason":"r"}' } })
  await $.tool.check({ tool: MODAL, input: { command: 'x' } })
  expect(w.runs[0]!.env?.AH_KEY_COMPUTE_SESSION_CAP_USD).toBe('2.5')
})

test('other tools are not asked about', async ($, on) => {
  const w = world(on)
  const r = await $.tool.check({ tool: 'mcp__plugin_academic-harness_ah__deep_research', input: { query: 'q' } })
  expect(r.decision).toBe('allow')
  expect(w.runs.length).toBe(0)
})

// ---- the self-improvement loop's hooks (hooks/rsi.ts) ----
//
// The loop is off unless a person turns it on, never runs headless, and only runs in an ah.yaml project; when it does not run, its hooks start
// no process at all. When it does, one process takes the calls of a step (PostToolBatch) or one failed call (PostToolUseFailure).

/** The guard's world plus what an interactive or headless session.start needs, and the shell's AH_RSI. */
function rsiWorld(on: any, opts: { env?: Record<string, string>; reply?: Reply | ((event: string, payload: any) => Reply); cwd?: string; files?: string[] } = {}) {
  const w = world(on, { ...(opts.cwd ? { cwd: opts.cwd } : {}), ...(opts.files ? { files: opts.files } : {}), ...(opts.reply ? { reply: opts.reply } : {}) })
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'AH_MOD_HOME' ? '/mod' : e.name === 'HOME' ? '/home/u' : opts.env?.[e.name] }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ value: '' }))
  on('fs.write', () => ({ value: undefined }))
  mock.clock(on)
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal' } }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.status', () => ({ value: undefined }))
  on('session.version', () => ({ value: { version: '2.1.330', base: '2.1.330' } }))
  // what sits beneath the plugin for the loop's two events
  on('classic.PostToolBatch', () => ({}))
  on('classic.PostToolUseFailure', () => ({}))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  return w
}
const loopRuns = <T extends { event: string }>(w: { runs: T[] }): T[] => w.runs.filter((r) => r.event === 'rsi-batch' || r.event === 'rsi-fail')
/** Every call to the hook bridge (a session start also runs the pane's own helper, which is not the bridge). */
const hookRuns = <T extends { argv: string[] }>(w: { runs: T[] }): T[] => w.runs.filter((r) => /ah-hook\.mjs$/.test(r.argv[1] ?? ''))
const READ_CALL = { tool_name: 'Read', tool_input: { file_path: '/p/a.tex' }, tool_response: 'text', tool_use_id: 'u1' }

test('the loop is off by default: a person at the prompt, an ah.yaml project, and still no process is started', async ($, on) => {
  const w = rsiWorld(on)
  await $.session.start({ cwd: '/p/sections', surface: 'terminal', isInteractive: true })
  await $.classic.PostToolBatch({ ...at(w), tool_calls: [READ_CALL] })
  await $.classic.PostToolUseFailure({ ...at(w), tool_name: 'Bash', tool_input: {}, error: 'boom', tool_use_id: 'u2' })
  expect(hookRuns(w).length).toBe(0)
})

test('with the loop on, a step\'s calls go to the bridge in one process and the engine\'s own post check sees none of them', { options: { rsi_mode: 'observe' } }, async ($, on) => {
  const w = rsiWorld(on)
  await $.session.start({ cwd: '/p/sections', surface: 'terminal', isInteractive: true })
  const out = await $.classic.PostToolBatch({ ...at(w), tool_calls: [READ_CALL, { ...READ_CALL, tool_name: 'Write', tool_input: { file_path: '/p/big.tex', content: 'z'.repeat(200_000) }, tool_response: 'y'.repeat(100_000), tool_use_id: 'u3' }] })
  expect(out.block).toBeUndefined()
  expect(out.additionalContext).toBeUndefined()
  const runs = loopRuns(w)
  expect(runs.length).toBe(1)
  expect(runs[0]!.event).toBe('rsi-batch')
  expect(runs[0]!.argv[1]).toMatch(/server\/bin\/ah-hook\.mjs$/)
  expect(runs[0]!.env?.AH_RSI_SETTING).toBe('observe')
  expect(runs[0]!.env?.AH_RSI_INTERACTIVE).toBe('1')
  const calls = runs[0]!.payload.tool_calls
  expect(calls.map((c: any) => c.tool_name)).toEqual(['Read', 'Write'])
  expect(typeof calls[1].tool_input).toBe('string')
  expect(calls[1].tool_input.length).toBeLessThanOrEqual(20_000)
  expect(calls[1].tool_response.length).toBeLessThanOrEqual(30_000)
  expect(engineRuns(w).length).toBe(0)
})

test('a batch is bounded', { options: { rsi_mode: 'auto' } }, async ($, on) => {
  const w = rsiWorld(on)
  await $.session.start({ cwd: '/p/sections', surface: 'terminal', isInteractive: true })
  await $.classic.PostToolBatch({ ...at(w), tool_calls: Array.from({ length: 100 }, (_, i) => ({ ...READ_CALL, tool_use_id: `b${i}` })) })
  expect(loopRuns(w)[0]!.payload.tool_calls.length).toBe(40)
})

test('a call that failed goes to the bridge, an interrupted one does not', { options: { rsi_mode: 'auto' } }, async ($, on) => {
  const w = rsiWorld(on)
  await $.session.start({ cwd: '/p/sections', surface: 'terminal', isInteractive: true })
  await $.classic.PostToolUseFailure({ ...at(w), tool_name: 'Bash', tool_input: { command: 'latexmk' }, error: 'e'.repeat(10_000), tool_use_id: 'f1' })
  await $.classic.PostToolUseFailure({ ...at(w), tool_name: 'Bash', tool_input: {}, error: 'interrupted', is_interrupt: true, tool_use_id: 'f2' })
  const runs = loopRuns(w)
  expect(runs.length).toBe(1)
  expect(runs[0]!.event).toBe('rsi-fail')
  expect(runs[0]!.payload).toMatchObject({ tool_name: 'Bash', tool_input: { command: 'latexmk' } })
  expect(runs[0]!.payload.error.length).toBeLessThanOrEqual(2000)
})

test('a headless run is never recorded, even when the loop is asked for', { options: { rsi_mode: 'auto' } }, async ($, on) => {
  const w = rsiWorld(on, { env: { AH_RSI: 'auto' } })
  await $.session.start({ cwd: '/p/sections', surface: null, isInteractive: false })
  await $.classic.PostToolBatch({ ...at(w), tool_calls: [READ_CALL] })
  await $.classic.PostToolUseFailure({ ...at(w), tool_name: 'Bash', tool_input: {}, error: 'boom', tool_use_id: 'h1' })
  expect(hookRuns(w).length).toBe(0)
  // and what the guard hands the bridge says so, so the prompt and the stop add nothing either
  await $.classic.UserPromptSubmit({ ...at(w), prompt: 'write the intro' })
  expect(hookRuns(w)[0]!.event).toBe('userprompt')
  expect(hookRuns(w)[0]!.env?.AH_RSI_INTERACTIVE).toBe('0')
})

test('the shell\'s AH_RSI wins over the setting, both ways', { options: { rsi_mode: 'auto' } }, async ($, on) => {
  const w = rsiWorld(on, { env: { AH_RSI: 'off' } })
  await $.session.start({ cwd: '/p/sections', surface: 'terminal', isInteractive: true })
  await $.classic.PostToolBatch({ ...at(w), tool_calls: [READ_CALL] })
  expect(hookRuns(w).length).toBe(0)
})

test('the shell can turn the loop on when the setting is off', async ($, on) => {
  const w = rsiWorld(on, { env: { AH_RSI: 'observe' } })
  await $.session.start({ cwd: '/p/sections', surface: 'terminal', isInteractive: true })
  await $.classic.PostToolBatch({ ...at(w), tool_calls: [READ_CALL] })
  expect(loopRuns(w).length).toBe(1)
})

test('outside an ah.yaml tree the loop starts no process', { options: { rsi_mode: 'auto' } }, async ($, on) => {
  const w = rsiWorld(on, { cwd: '/home/u/notes', files: [] })
  await $.session.start({ cwd: '/home/u/notes', surface: 'terminal', isInteractive: true })
  await $.classic.PostToolBatch({ cwd: '/home/u/notes', session_id: 'sess-1', tool_calls: [READ_CALL] })
  expect(hookRuns(w).length).toBe(0)
})

test('a loop that cannot start never blocks or changes the call', { options: { rsi_mode: 'auto' } }, async ($, on) => {
  const w = rsiWorld(on, { reply: 'throw' })
  await $.session.start({ cwd: '/p/sections', surface: 'terminal', isInteractive: true })
  const out = await $.classic.PostToolBatch({ ...at(w), tool_calls: [READ_CALL] })
  expect(out.block).toBeUndefined()
  expect(out.additionalContext).toBeUndefined()
})

test('what the guard hands the bridge: the mode setting when there is one, and that a person is at the prompt', { options: { rsi_mode: 'observe' } }, async ($, on) => {
  const w = rsiWorld(on)
  await $.session.start({ cwd: '/p/sections', surface: 'terminal', isInteractive: true })
  await $.classic.UserPromptSubmit({ ...at(w), prompt: 'write the intro' })
  expect(hookRuns(w)[0]!.env?.AH_RSI_SETTING).toBe('observe')
  expect(hookRuns(w)[0]!.env?.AH_RSI_INTERACTIVE).toBe('1')
})

// ---- paper_mcp ----

const PAPER_MCP = 'mcp__plugin_academic-harness_ah__paper_mcp'

test('paper_mcp register and approve ask, showing the program and the variables; status and unregister do not', async ($, on) => {
  const w = world(on)
  const reg = await $.tool.check({ tool: PAPER_MCP, input: { action: 'register', serverName: 'demo', command: '/venv/bin/python', args: ['/srv/demo_mcp.py'], cwd: '/srv', envNames: ['S2_API_KEY'] } })
  expect(reg.decision).toBe('ask')
  expect(reg.reason).toContain('"demo"')
  expect(reg.reason).toContain('/venv/bin/python /srv/demo_mcp.py')
  expect(reg.reason).toContain('S2_API_KEY')
  expect((await $.tool.check({ tool: PAPER_MCP, input: { action: 'approve', serverName: 'demo' } })).decision).toBe('ask')
  expect((await $.tool.check({ tool: PAPER_MCP, input: { action: 'status' } })).decision).toBe('allow')
  expect((await $.tool.check({ tool: PAPER_MCP, input: { action: 'unregister', serverName: 'demo' } })).decision).toBe('allow')
  expect(w.runs.length).toBe(0)
})
