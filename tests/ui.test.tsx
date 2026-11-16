import { expect, mock, test } from 'claude-code/testing'

// The status line and the pane (P5). Nothing sits beneath the plugin in a test: each hook below stands for the engine, `fs.*` for the
// disk, and `process.run` for server/bin/ah-ui.mjs (which reads the engine's state card and PaperMemory's database; its own parsing is
// tested by tests/scripts/ui-core.test.mjs and its run against the real engine by tests/live/p5.mjs).

const PANE = {
  plugin: 'academic-harness',
  component: 'Pane',
  requestId: 'academic',
} as const

const props = (bodyColumns: number) => ({ title: 'Academic Harness', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }) as const

const FAIL = { project: { root: '/p', lines: ['# Paper state — demo', 'Bibliography: 12 entries', 'Gate now: FAIL (5 blocking, 7 open).', '- missing citation in intro'], gate: { status: 'FAIL', blocking: 5, open: 7 } }, library: { papers: 106, citable: 80, claims: 12, notes: 30 } }
const PASS = { project: { root: '/p', lines: ['# Paper state — demo', 'Gate now: PASS'], gate: { status: 'PASS', blocking: 0, open: 1 } }, library: null }

type Rec = Record<string, unknown>
const job = (id: string, status: string, extra: Rec = {}) => ({ id, status, session: 'sess-1', kind: 'deep_research', label: 'deep_research: RAG', startedAt: 1000, ...extra })

function world(on: any, opts: { open?: { isPlaced: boolean; reason?: string }; files?: Record<string, unknown>; project?: boolean; bridge?: () => unknown; notebook?: string; panes?: { id: string }[] } = {}) {
  const status: (string | undefined)[] = []
  const bridge: string[][] = []
  const opened: { id: string; title?: string }[] = []
  const files = opts.files ?? {}
  const exist = new Set(opts.project === false ? [] : ['/p/ah.yaml'])
  mock.env(on, { AH_MOD_HOME: '/mod', HOME: '/home/u' })
  const clock = mock.clock(on)
  on('session.cwd', () => ({ value: '/p' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: exist.has(e.path) }))
  on('fs.list', (_: unknown, e: { path: string }) => ({ value: e.path === '/mod/jobs' ? Object.keys(files).map(n => ({ name: n, kind: 'file', size: 1, mtimeMs: 1, isLink: false })) : [] }))
  on('fs.read', (_: unknown, e: { path: string }) => {
    if (e.path === '/p/.dsh/notebook/sess-1.jsonl' && opts.notebook !== undefined) return { value: opts.notebook }
    const name = e.path.split('/').pop()!
    if (e.path.startsWith('/mod/jobs/') && files[name] !== undefined) return { value: JSON.stringify(files[name]) }
    throw new Error(`ENOENT ${e.path}`)
  })
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    bridge.push(e.argv.slice(-2))
    const out = opts.bridge ? opts.bridge() : FAIL
    return { value: { exitCode: 0, stdout: `${JSON.stringify(out)}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.status', (_: unknown, e: { text: string | undefined }) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('ui.open', (_: unknown, e: { id: string; title?: string }) => {
    opened.push({ id: e.id, title: e.title })
    return { value: opts.open ?? { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: (opts.panes ?? []).map(p => ({ id: p.id, title: p.id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal' } }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.complete', (_: unknown, e: { answer: string }) => ({ text: e.answer }))
  return { status, bridge, opened, files, clock }
}

const academic = ($: any, args = '') => $.command.run({ command: 'academic', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
const start = ($: any) => $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })

test('the status line carries the mode, the jobs running and the gate, in one line', async ($, on) => {
  const w = world(on, { files: { 'job-1.json': job('job-1', 'running') } })
  await start($)
  expect(w.status.at(-1)).toBe('research mode on · 1 job running · gate FAIL (5 blocking)')
  expect(w.bridge).toEqual([['gate', '/p']])
})

test('the line follows the jobs on a timer: it changes when a job ends, and is not written again when nothing changed', async ($, on) => {
  const w = world(on, { files: { 'job-1.json': job('job-1', 'running') } })
  await start($)
  const written = w.status.length
  await w.clock.advance(5000)
  expect(w.status.length).toBe(written)
  w.files['job-1.json'] = job('job-1', 'completed', { endedAt: 3000, delivered: true })
  await w.clock.advance(5000)
  expect(w.status.at(-1)).toBe('research mode on · gate FAIL (5 blocking)')
  expect(w.bridge.length).toBe(1)
})

test('the gate is read again after a turn, not before', async ($, on) => {
  let answer: unknown = FAIL
  const w = world(on, { bridge: () => answer })
  await start($)
  expect(w.status.at(-1)).toContain('gate FAIL')
  await w.clock.advance(5000)
  expect(w.bridge.length).toBe(1)
  answer = PASS
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  await w.clock.advance(5000)
  expect(w.bridge.length).toBe(2)
  expect(w.status.at(-1)).toBe('research mode on · gate PASS')
})

test('outside a project there is no gate on the line', async ($, on) => {
  const w = world(on, { project: false, bridge: () => ({ project: null, library: null }) })
  await start($)
  expect(w.status.at(-1)).toBe('research mode off')
})

test('a bridge that cannot run leaves the line with the mode alone', async ($, on) => {
  const w = world(on, { bridge: () => { throw new Error('no node') } })
  await start($)
  expect(w.status.at(-1)).toBe('research mode on')
})

test('/academic with no word opens the pane; status and the settings words do not', async ($, on) => {
  const w = world(on)
  await start($)
  const bare = await academic($)
  expect(w.opened).toEqual([{ id: 'academic', title: 'Academic Harness' }])
  expect(bare.text).toContain('Research mode is on')
  expect(bare.text).toContain('Pane opened')
  const status = await academic($, 'status')
  expect(status.text).not.toContain('Pane opened')
  await academic($, 'off')
  expect(w.opened.length).toBe(1)
  await academic($, 'pane')
  expect(w.opened.length).toBe(2)
})

test('a pane that cannot be placed says why instead of pretending', async ($, on) => {
  world(on, { open: { isPlaced: false, reason: 'the terminal is too narrow' } })
  await start($)
  const r = await academic($)
  expect(r.text).toContain('did not open (the terminal is too narrow)')
})

const NOTES = [1, 2, 3].map(n => JSON.stringify({ timestamp: 90_000 + n, type: 'decision', title: `entry ${n}` })).join('\n')
test('narrow (about 40 columns): one column with the four parts, nothing wider than the room', async ($, on) => {
  world(on, { files: { 'job-1.json': job('job-1', 'running', { label: 'deep_research: a long question about retrieval and everything near it', progress: 'framing' }), 'job-0.json': job('job-0', 'completed', { endedAt: 500 }) }, notebook: NOTES })
  await start($)
  await academic($)

  const ui = await $.ui.mount({ ...PANE, props: props(40), surface: 'terminal' })
  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes[0]!.props['flexDirection']).toBe('row')
  const columns = boxes.filter(b => b.props['flexShrink'] === 0)
  expect(columns.length).toBe(1)
  expect(columns[0]!.props['width']).toBe(39)

  for (const title of ['Project', 'Jobs', 'Notebook', 'Library']) expect(await ui.find({ type: 'Text', text: title })).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /Gate now: FAIL/ }))?.props['color']).toBe('red')
  expect(await ui.find({ type: 'Text', text: /▶ job-1/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /decision: entry 3/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /106 papers \(80 citable\)/ })).toBeTruthy()
  for (const t of await ui.findAll({ type: 'Text' })) expect(t.text.length).toBeLessThanOrEqual(39)
  await ui.unmount()
})

test('wide (about 120 columns): two columns, the project on the left, jobs, notebook and library on the right', async ($, on) => {
  world(on, { files: { 'job-1.json': job('job-1', 'running') }, notebook: NOTES })
  await start($)
  await academic($)

  const ui = await $.ui.mount({ ...PANE, props: props(120), surface: 'terminal' })
  const columns = (await ui.findAll({ type: 'Box' })).filter(b => b.props['flexShrink'] === 0)
  expect(columns.length).toBe(2)
  expect(columns[0]!.props['width']).toBe(58)
  const titles = columns.map(c => c.children.flatMap(section => JSON.stringify(section).match(/"(Project|Jobs|Notebook|Library)"/g) ?? []))
  expect(titles[0]).toEqual(['"Project"'])
  expect(titles[1]).toEqual(['"Jobs"', '"Notebook"', '"Library"'])
  await ui.unmount()
})

test('the parts are spaced apart when the pane has the rows, and run together when it has not', async ($, on) => {
  world(on, { files: { 'job-1.json': job('job-1', 'running') }, notebook: NOTES })
  await start($)
  await academic($)
  const roomy = await $.ui.mount({ ...PANE, props: props(60), surface: 'terminal' })
  expect((await roomy.findAll({ type: 'Box' })).some(b => b.props['marginBottom'] === 1)).toBe(true)
  await roomy.unmount()
  const tight = await $.ui.mount({ ...PANE, props: { ...props(60), scroll: { offset: 0, bodyRows: 8 } }, surface: 'terminal' })
  expect((await tight.findAll({ type: 'Box' })).some(b => b.props['marginBottom'] === 1)).toBe(false)
  await tight.unmount()
})

test('before anything was read the pane says so; with no project and no jobs it says what is missing', async ($, on) => {
  world(on, { project: false, bridge: () => ({ project: null, library: null }) })
  const early = await $.ui.mount({ ...PANE, props: props(60), surface: 'terminal' })
  expect(await early.find({ type: 'Text', text: /Reading…/ })).toBeTruthy()
  await early.unmount()

  await start($)
  await academic($)
  const ui = await $.ui.mount({ ...PANE, props: props(60), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Not in an ah\.yaml project/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /No background jobs/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /No notebook entries/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /no library yet/ })).toBeTruthy()
  await ui.unmount()
})

test('the open pane keeps itself fresh: files every period, the engine side every half minute', async ($, on) => {
  const w = world(on, { files: { 'job-1.json': job('job-1', 'running') }, panes: [{ id: 'academic' }] })
  await start($)
  await academic($)
  const afterOpen = w.bridge.length
  w.files['job-2.json'] = job('job-2', 'running', { label: 'a second job' })
  await w.clock.advance(5000)
  const ui = await $.ui.mount({ ...PANE, props: props(60), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /job-2/ })).toBeTruthy()
  const early = w.bridge.length
  expect(early).toBeGreaterThanOrEqual(afterOpen)
  await w.clock.advance(30_000)
  expect(w.bridge.length).toBeGreaterThan(early)
  await ui.unmount()
})

test('a render that is not the mod\'s pane is left to the engine', async ($, on) => {
  world(on)
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...PANE, requestId: 'other', props: props(60), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})
