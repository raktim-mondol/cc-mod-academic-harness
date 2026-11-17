import { expect, test } from 'claude-code/testing'

// The task commands and /fold (P5). Nothing sits beneath the plugin in a test: each hook below stands for the engine, and the
// tool.call hook stands for the tool host. Which tool a task starts, and with which arguments, is checked against upstream's own
// code by tests/scripts/tasks.test.mjs; these tests drive the command hooks: the line, the file checks, the steps and the text.

const P = 'mcp__plugin_academic-harness_ah__'

type Answer = Record<string, unknown>
type Call = { tool: string; input: Answer }

function world(on: any, opts: { cwd?: string; folderReal?: string; files?: Record<string, { size?: number; kind?: string; real?: string | null }>; answer?: (tool: string, input: Answer, n: number) => Answer; messages?: unknown[] } = {}) {
  const cwd = opts.cwd ?? '/p'
  const files = opts.files ?? {}
  const calls: Call[] = []
  const commands: string[] = []
  on('session.cwd', () => ({ value: cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.messages', () => ({ value: opts.messages ?? [] }))
  on('fs.stat', (_: unknown, e: { path: string; resolve?: boolean }) => {
    // the session folder itself is asked for where it lands, and lands where it is
    const f = e.path === cwd ? { kind: 'dir' } as { kind?: string; size?: number; real?: string | null } : files[e.path]
    if (!f) throw new Error(`ENOENT: ${e.path}`)
    const real = e.path === cwd ? (opts.folderReal ?? cwd) : f.real === undefined ? e.path : f.real
    return { value: { kind: f.kind ?? 'file', size: f.size ?? 100, mtimeMs: 1, isLink: f.real !== undefined, ...(e.resolve && real !== null ? { realPath: real } : {}) } }
  })
  on('command.register', (_: unknown, e: { name: string }) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('tool.call', (_: unknown, e: Answer & { tool: string }) => {
    const { tool, tool_use_id: _id, ...input } = e as Answer & { tool: string; tool_use_id?: string }
    calls.push({ tool, input })
    const a = opts.answer ? opts.answer(tool, input, calls.length) : { text: `ran ${tool.replace(P, '')}` }
    return 'deny' in a ? { deny: a['deny'] } : { result: a['result'] ?? {}, ...a }
  })
  return { calls, commands, cwd }
}

const run = ($: any, command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
const start = ($: any, cwd = '/p') => $.session.start({ cwd, surface: 'terminal', isInteractive: false })

test('the seven task commands, /ah-watch and /fold are declared at session start', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.commands).toEqual(['academic', 'ah-research', 'ah-review', 'ah-papers', 'ah-references', 'ah-write', 'ah-analyze', 'ah-hypotheses', 'ah-watch', 'fold', 'model-router'])
})

test('/ah-papers starts literature_search with the effort\'s limit and shows what it answered', async ($, on) => {
  const w = world(on, { answer: () => ({ text: '12 papers found.' }) })
  await start($)
  const r = await run($, 'ah-papers', '--effort low sparse autoencoders for interpretability')
  expect(w.calls.length).toBe(1)
  expect(w.calls[0]!.tool).toBe(`${P}literature_search`)
  expect(w.calls[0]!.input['query']).toBe('sparse autoencoders for interpretability')
  expect(typeof w.calls[0]!.input['max_results']).toBe('number')
  expect(r.text).toContain('Find Papers (effort low)')
  expect(r.text).toContain('12 papers found.')
})

test('/ah-research frames the run, then runs it with the run id the first step gave', async ($, on) => {
  const w = world(on, { answer: (_t, input) => (input['action'] === 'start' ? { text: 'Framed.\nrun_id: dr-0003\n' } : { text: 'The run went on as job job-7.' }) })
  await start($)
  const r = await run($, 'ah-research', '--effort low what is retrieval-augmented generation')
  expect(w.calls.map(c => [c.tool.replace(P, ''), c.input['action']])).toEqual([['deep_research', 'start'], ['deep_research', 'run']])
  expect(w.calls[0]!.input).toMatchObject({ query: 'what is retrieval-augmented generation', run: false, effort: 'low' })
  expect(w.calls[1]!.input).toMatchObject({ run_id: 'dr-0003' })
  expect(r.text).toContain('→ Framing research questions')
  expect(r.text).toContain('→ Running the research run')
  expect(r.text).toContain('job-7')
})

test('with no effort given, the research start leaves the choice to the tool', async ($, on) => {
  const w = world(on, { answer: (_t, input) => (input['action'] === 'start' ? { text: 'run_id: dr-0001' } : { text: 'ok' }) })
  await start($)
  await run($, 'ah-research', 'a plain question')
  expect(Object.keys(w.calls[0]!.input)).not.toContain('effort')
})

test('a research start that gives no run id stops there and shows what the tool said', async ($, on) => {
  const w = world(on, { answer: () => ({ text: 'needs input: which period should this cover?' }) })
  await start($)
  const r = await run($, 'ah-research', 'a question')
  expect(w.calls.length).toBe(1)
  expect(r.text).toContain('which period should this cover?')
  expect(r.text).toContain('did not start')
})

test('a tool that refuses stops the command with the reason', async ($, on) => {
  const w = world(on, { answer: () => ({ deny: 'a rule refuses this tool' }) })
  await start($)
  const r = await run($, 'ah-papers', 'x')
  expect(w.calls.length).toBe(1)
  expect(r.text).toContain('stopped at')
  expect(r.text).toContain('a rule refuses this tool')
})

test('a tool that errors stops the command with what it said', async ($, on) => {
  world(on, { answer: () => ({ isError: true, text: 'the service is down' }) })
  await start($)
  const r = await run($, 'ah-papers', 'y')
  expect(r.text).toContain('stopped at')
  expect(r.text).toContain('the service is down')
})

test('an empty line, a bad effort and a missing file are refused before any tool runs, with the usage', async ($, on) => {
  const w = world(on, { files: { '/p/paper.tex': {}, '/p/d': { kind: 'dir' } } })
  await start($)
  const empty = await run($, 'ah-papers', '   ')
  expect(empty.text).toContain('enter a search query first')
  expect(empty.text).toContain('Usage: /ah-papers')
  const bad = await run($, 'ah-review', '--effort extreme paper.tex')
  expect(bad.text).toContain('effort must be auto, low, medium, or high')
  const missing = await run($, 'ah-review', 'nowhere.tex')
  expect(missing.text).toContain('file not found: nowhere.tex')
  const outside = await run($, 'ah-review', '../secret.tex')
  expect(outside.text).toContain('path escapes the workspace')
  const notFile = await run($, 'ah-review', 'd')
  expect(notFile.text).toContain('not a file: d')
  expect(w.calls.length).toBe(0)
})

test('a link inside the folder that leads outside it is refused; one that stays inside, and a folder reached through a link, are not', async ($, on) => {
  const w = world(on, { files: { '/p/out.tex': { real: '/etc/secret.tex' }, '/p/in.tex': { real: '/p/sub/real.tex' }, '/p/lost.tex': { real: null }, '/p/a.tex': {}, '/p/b.tex': {} } })
  await start($)
  const out = await run($, 'ah-review', 'out.tex')
  expect(out.text).toContain('is a link that leads outside the workspace')
  expect(out.text).toContain('/etc/secret.tex')
  const lost = await run($, 'ah-review', 'lost.tex')
  expect(lost.text).toContain('cannot tell where lost.tex leads')
  expect(w.calls.length).toBe(0)
  await run($, 'ah-review', 'in.tex')
  expect(w.calls.length).toBe(1)
})

test('the session folder reached through a link is compared by where it really is', async ($, on) => {
  // /p is a link to /real/p: the file's real path is under /real/p, which is the folder's own real path
  const w = world(on, { folderReal: '/real/p', files: { '/p/a.tex': { real: '/real/p/a.tex' } } })
  await start($)
  await run($, 'ah-review', 'a.tex')
  expect(w.calls.length).toBe(1)
})

test('a file over 50 MB is refused; a two-line task takes " -- " for the break', async ($, on) => {
  const w = world(on, { files: { '/p/big.tex': { size: 60 * 1024 * 1024 }, '/p/a.tex': {}, '/p/b.tex': {} } })
  await start($)
  const big = await run($, 'ah-review', 'big.tex')
  expect(big.text).toContain('file is larger than 50 MB: big.tex')
  expect(w.calls.length).toBe(0)

  const ok = await run($, 'ah-write', 'a.tex -- b.tex')
  expect(w.calls.length).toBe(1)
  expect(w.calls[0]!.tool).toBe(`${P}manuscript_diff`)
  expect(w.calls[0]!.input).toMatchObject({ action: 'diff', old: 'a.tex', new: 'b.tex' })
  expect(ok.text).toContain('Write / Revise')
})

test('/ah-review passes the focus line and the effort\'s topology', async ($, on) => {
  const w = world(on, { files: { '/p/paper.tex': {} } })
  await start($)
  await run($, 'ah-review', '--effort high paper.tex -- focus on the statistics')
  expect(w.calls[0]!.tool).toBe(`${P}deep_review`)
  expect(w.calls[0]!.input).toMatchObject({ action: 'review', path: 'paper.tex', focus: 'focus on the statistics' })
  expect(typeof w.calls[0]!.input['topology']).toBe('string')
})

test('/ah-analyze and /ah-hypotheses take an optional slug line', async ($, on) => {
  const w = world(on)
  await start($)
  await run($, 'ah-analyze', 'trial-1 -- does the dose change the response?')
  expect(w.calls[0]!.tool).toBe(`${P}analysis_run`)
  expect(w.calls[0]!.input).toMatchObject({ action: 'plan', slug: 'trial-1', plan: { question: 'does the dose change the response?' } })
  await run($, 'ah-hypotheses', 'find a mechanism for X')
  expect(w.calls[1]!.tool).toBe(`${P}coscientist`)
  expect(w.calls[1]!.input['action']).toBe('start')
  expect(String(w.calls[1]!.input['slug'])).toMatch(/^hypotheses-[0-9a-f]{12}$/)
})

const REPLY = `# Findings\n\n${'The first paragraph explains the setup in some detail and says why it matters here. '.repeat(6)}\n\n## Details\n\n- first point with a long explanation that goes on for a while and a while\n- second point with another long explanation that also goes on\n- third point\n\n${'A closing paragraph with more words to read before the end of the reply. '.repeat(5)}\n`

test('/fold folds the last reply of the model, at brief by default', async ($, on) => {
  world(on, { messages: [{ role: 'user', text: 'explain', toolUses: [] }, { role: 'assistant', text: REPLY, toolUses: [] }, { role: 'user', text: 'thanks', toolUses: [] }] })
  await start($)
  const r = await run($, 'fold')
  expect(r.text).toMatch(/^Last reply, folded to brief: \d+ of \d+ words/)
  const shown = Number(/: (\d+) of/.exec(r.text)![1])
  const total = Number(/of (\d+) words/.exec(r.text)![1])
  expect(shown).toBeLessThan(total)
  expect(r.text).toContain('# Findings')
})

test('/fold takes a level by name or by number, and refuses others', async ($, on) => {
  world(on, { messages: [{ role: 'assistant', text: REPLY, toolUses: [] }] })
  await start($)
  const full = await run($, 'fold', 'full')
  expect(full.text).toContain('nothing hidden')
  expect(full.text).toContain('A closing paragraph')
  const gist = await run($, 'fold', '5')
  expect(gist.text).toContain('folded to gist')
  expect(gist.text).not.toContain('A closing paragraph')
  const bad = await run($, 'fold', 'tiny')
  expect(bad.text).toContain('Unknown level "tiny"')
  expect(bad.text).toContain('Usage: /fold')
})

test('/fold with no reply yet says so', async ($, on) => {
  world(on, { messages: [{ role: 'user', text: 'hello', toolUses: [] }, { role: 'assistant', text: '   ', toolUses: [] }] })
  await start($)
  const r = await run($, 'fold')
  expect(r.text).toContain('There is no reply to fold yet')
})

// ---- /ah-watch ----

test('/ah-watch runs what is due, then prints what is new, and moves the digest\'s cut', async ($, on) => {
  const w = world(on, { answer: (_t, input) => (input['action'] === 'run' ? { text: 'Ran 2 watches: 5 new records.' } : { text: '# New since the last digest\n\n- A paper (2025)' }) })
  await start($)
  const r = await run($, 'ah-watch')
  expect(w.calls.map(c => [c.tool.replace(P, ''), c.input['action']])).toEqual([['literature_watch', 'run'], ['literature_watch', 'digest']])
  expect(w.calls[0]!.input['due_only']).toBe(true)
  expect(w.calls[1]!.input['preview']).toBeUndefined()
  expect(r.text).toContain('→ Running the watches that are due')
  expect(r.text).toContain('Ran 2 watches: 5 new records.')
  expect(r.text).toContain('- A paper (2025)')
})

test('--all runs every watch and --preview leaves the cut where it was', async ($, on) => {
  const w = world(on, { answer: () => ({ text: 'ok' }) })
  await start($)
  await run($, 'ah-watch', '--all --preview')
  expect(w.calls[0]!.input).toEqual({ action: 'run' })
  expect(w.calls[1]!.input).toEqual({ action: 'digest', preview: true })
})

test('with no watch saved it says how to make one, and reads nothing', async ($, on) => {
  const w = world(on, { answer: () => ({ text: 'no watches to run' }) })
  await start($)
  const r = await run($, 'ah-watch')
  expect(w.calls.length).toBe(1)
  expect(r.text).toContain('Save a search first')
  expect(r.text).toContain('/loop 1d /ah-watch')
})

test('an unknown word and a refusing tool are reported', async ($, on) => {
  const w = world(on, { answer: () => ({ deny: 'a rule refuses this tool' }) })
  await start($)
  const bad = await run($, 'ah-watch', '--weekly')
  expect(bad.text).toContain('unknown argument "--weekly"')
  expect(bad.text).toContain('Usage: /ah-watch')
  expect(w.calls.length).toBe(0)
  const refused = await run($, 'ah-watch')
  expect(refused.text).toContain('stopped at')
  expect(refused.text).toContain('a rule refuses this tool')
})
