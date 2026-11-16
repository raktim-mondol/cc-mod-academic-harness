// The interface's pure parts (hooks/ui-core.ts) and the bridge's parsing (server/src/panel.mjs): the status line, the pane's text,
// the layout choice, and the readers of the job folder and the notebook.
import '../helpers/ts-resolve.mjs'
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { parseGate, summarizeCard } from '../../server/src/panel.mjs'

const ui = await import('../../hooks/ui-core.ts')
const tasks = await import('../../hooks/tasks-core.ts')

const CARD = `# Paper state — demo
Bibliography: 12 entries, 3 unresolved
Outline status: 4 of 6 sections drafted
Structure: ok
Gate now: FAIL (5 blocking, 7 open).
- missing citation in intro
- unit lost in methods
- claim without evidence in results
- figure 2 not referenced
- abstract over the limit
- table 1 unlabelled
- stray TODO

Done: nothing yet.
`

describe('status line', () => {
  test('the mode alone, with jobs, with a failing and a passing gate', () => {
    assert.equal(ui.composeStatus(false, 0, null), 'research mode off')
    assert.equal(ui.composeStatus(true, 1, null), 'research mode on · 1 job running')
    assert.equal(ui.composeStatus(true, 3, { status: 'FAIL', blocking: 5, open: 7 }), 'research mode on · 3 jobs running · gate FAIL (5 blocking)')
    assert.equal(ui.composeStatus(true, 0, { status: 'PASS', blocking: 0, open: 2 }), 'research mode on · gate PASS')
  })
  test('the key changes with the jobs and the gate, not with anything else', () => {
    assert.notEqual(ui.statusKey(0, null), ui.statusKey(1, null))
    assert.notEqual(ui.statusKey(0, { status: 'PASS', blocking: 0, open: 0 }), ui.statusKey(0, { status: 'FAIL', blocking: 2, open: 2 }))
    assert.equal(ui.statusKey(2, { status: 'FAIL', blocking: 2, open: 5 }), ui.statusKey(2, { status: 'FAIL', blocking: 2, open: 9 }))
  })
})

describe('what the engine bridge says', () => {
  test('the gate line is read, a card without one is null', () => {
    assert.deepEqual(parseGate(CARD), { status: 'FAIL', blocking: 5, open: 7 })
    assert.deepEqual(parseGate('Gate now: PASS'), { status: 'PASS', blocking: 0, open: 0 })
    assert.equal(parseGate('# nothing here'), null)
  })
  test('the card is cut to what a pane has room for, with the findings counted', () => {
    const lines = summarizeCard(CARD, { findings: 3 })
    assert.equal(lines[0], '# Paper state — demo')
    assert.ok(lines.includes('- … and 4 more'), lines.join('\n'))
    assert.equal(lines.filter(l => l.startsWith('- ')).length, 4)
    assert.ok(lines.at(-1)?.startsWith('Done:'))
  })
  test('the bridge output is parsed; anything else is an error, never a throw', () => {
    assert.deepEqual(ui.parseBridge('{"project":null,"library":{"papers":3}}\n'), { project: null, library: { papers: 3 } })
    assert.deepEqual(ui.parseBridge('(node:1) ExperimentalWarning: x\n{"project":null,"library":null}\n'), { project: null, library: null })
    assert.ok('error' in ui.parseBridge('not json'))
    assert.ok('error' in ui.parseBridge(''))
  })
})

describe('files', () => {
  const recs = [
    { id: 'a', status: 'running', session: 's', kind: 'deep_research', label: 'deep_research: RAG', startedAt: 1000, progress: 'step 2 of 6' },
    { id: 'b', status: 'completed', session: 's', label: 'review', startedAt: 100, endedAt: 500 },
    { id: 'c', status: 'failed', session: 's', label: 'older', startedAt: 10, endedAt: 50 },
    { id: 'd', status: 'running', session: 'other', label: 'not mine' },
    { id: 'e', status: 'completed', session: 's', label: 'e', endedAt: 600 },
    { id: 'f', status: 'completed', session: 's', label: 'f', endedAt: 700 },
  ]
  test('running jobs of this session first, then the three that ended last; others are left out', () => {
    const rows = ui.jobRows(recs, 's')
    assert.deepEqual(rows.map(r => r.id), ['a', 'f', 'e', 'b'])
    assert.equal(rows[0].detail, 'step 2 of 6')
    assert.equal(ui.runningCount(recs, 's'), 1)
    assert.equal(ui.runningCount(recs, 'nobody'), 0)
  })
  test('the notebook tail skips a half-written line and keeps the order', () => {
    const text = [1, 2, 3, 4, 5, 6, 7].map(n => JSON.stringify({ timestamp: n * 1000, type: n % 2 ? 'note' : 'decision', title: `entry ${n}` })).join('\n') + '\n{"timestamp":8,"ti'
    const rows = ui.noteRows(text, 3)
    assert.deepEqual(rows.map(r => r.title), ['entry 5', 'entry 6', 'entry 7'])
    assert.deepEqual(ui.noteRows('', 3), [])
  })
  test('the notebook file is named as upstream names it', () => {
    assert.equal(ui.notebookName('8f2a-1'), '8f2a-1.jsonl')
    assert.equal(ui.notebookName('a/b c'), 'a_b_c.jsonl')
  })
})

describe('the pane', () => {
  const state = {
    at: 100_000,
    cwd: '/p',
    project: { root: '/p', lines: summarizeCard(CARD, { findings: 2 }), gate: { status: 'FAIL', blocking: 5, open: 7 } },
    library: { papers: 106, citable: 80, claims: 12, notes: 30 },
    jobs: ui.jobRows([{ id: 'job-1', status: 'running', session: 's', label: 'deep_research: a very long question about retrieval-augmented generation and everything near it', startedAt: 40_000, progress: 'framing' }], 's'),
    notes: [{ at: 70_000, type: 'decision', title: 'use the 2024 split' }],
  }
  test('four parts, each with what it should say', () => {
    const all = ui.sections(state, 60)
    assert.deepEqual(all.map(s => s.title), ['Project', 'Jobs', 'Notebook', 'Library'])
    const text = ui.summaryText(state, 60)
    assert.match(text, /Gate now: FAIL/)
    assert.match(text, /▶ job-1 deep_research/)
    assert.match(text, /▶ job-1 .*60s/)
    assert.match(text, /30s ago decision: use the 2024 split/)
    assert.match(text, /106 papers \(80 citable\) · 12 claims · 30 notes/)
  })
  test('no line is wider than the column it is given', () => {
    for (const width of [20, 30, 40, 60]) {
      for (const s of ui.sections(state, width)) for (const l of s.lines) assert.ok(l.text.length <= width, `${width}: ${l.text}`)
    }
  })
  test('a failed job says why in a dim line; a completed one does not repeat its label', () => {
    const jobs = ui.jobRows([
      { id: 'j-ok', status: 'completed', session: 's', label: 'done', endedAt: 900 },
      { id: 'j-bad', status: 'failed', session: 's', label: 'review', detail: 'review model call failed: 429', endedAt: 950 },
    ], 's')
    const lines = ui.sections({ ...ui.EMPTY_PANEL, at: 1000, cwd: '/p', jobs }, 60)[1].lines
    assert.ok(lines.some(l => l.text.includes('429') && l.tone === 'dim'), lines.map(l => l.text).join('\n'))
    assert.equal(lines.filter(l => l.text.includes('review')).length, 2, 'the row and its detail')
    assert.equal(lines.filter(l => l.text.includes('done')).length, 1, 'no detail line for a completed job')
  })
  test('empty parts say so instead of showing nothing', () => {
    const text = ui.summaryText({ ...ui.EMPTY_PANEL, cwd: '/p' }, 80)
    assert.match(text, /Not in an ah\.yaml project/)
    assert.match(text, /No background jobs/)
    assert.match(text, /No notebook entries/)
    assert.match(text, /no library yet/)
    assert.match(ui.summaryText(ui.EMPTY_PANEL, 80), /Reading…/)
  })
  test('an error from a source is shown as a warning, not hidden', () => {
    const lib = ui.sections({ ...state, library: { error: 'database is locked' }, project: { error: 'ah state exited 2: boom' } }, 60)
    assert.deepEqual(lib[3].lines.map(l => [l.text, l.tone]), [['database is locked', 'warn']])
    assert.deepEqual(lib[0].lines.map(l => [l.text, l.tone]), [['ah state exited 2: boom', 'warn']])
  })
  test('two columns from 96 cells, one below, and the sections divide as the plan says', () => {
    assert.deepEqual(ui.layoutFor(120), { columns: 2, width: 58 })
    assert.deepEqual(ui.layoutFor(96), { columns: 2, width: 46 })
    assert.deepEqual(ui.layoutFor(95), { columns: 1, width: 94 })
    assert.deepEqual(ui.layoutFor(40), { columns: 1, width: 39 })
    assert.deepEqual(ui.layoutFor(0), { columns: 1, width: 19 })
    const all = ui.sections(state, 40)
    assert.deepEqual(ui.arrange(all, ui.layoutFor(120)).map(c => c.map(s => s.title)), [['Project'], ['Jobs', 'Notebook', 'Library']])
    assert.deepEqual(ui.arrange(all, ui.layoutFor(40)).map(c => c.map(s => s.title)), [['Project', 'Jobs', 'Notebook', 'Library']])
  })
  test('a small pane gets a shorter project: no outline, structure or verdict line, three findings and the count of the rest', () => {
    const lines = ui.compactProject(summarizeCard(CARD, { findings: 5 }))
    assert.deepEqual(lines.filter(l => /^(Outline status|Structure|Done):/.test(l)), [])
    assert.equal(lines.filter(l => /^- \S/.test(l) && !l.startsWith('- … ')).length, 3)
    assert.equal(lines.at(-1), '- … and 4 more')
    assert.ok(lines.some(l => l.startsWith('Gate now: FAIL')))
    assert.deepEqual(ui.compactProject(['Gate now: PASS']), ['Gate now: PASS'])
    const narrow = ui.sections(state, 40, true)[0].lines.length
    assert.ok(narrow < ui.sections(state, 40, false)[0].lines.length)
  })
  test('parts are separated by a blank row only when every column has the room for it', () => {
    const cols = ui.arrange(ui.sections(state, 40, true), ui.layoutFor(40))
    const need = cols[0].reduce((n, s) => n + s.lines.length + 1, 0) + (cols[0].length - 1)
    assert.equal(ui.hasRoomForGaps(cols, need), true)
    assert.equal(ui.hasRoomForGaps(cols, need - 1), false)
    assert.equal(ui.hasRoomForGaps([], 5), true)
  })
  test('ages read in the unit a person would say', () => {
    assert.deepEqual([5_000, 120_000, 3 * 3_600_000, 3 * 86_400_000].map(ui.age), ['5s', '2m', '3h', '3d'])
  })
})

describe('the run id a deep research start answers with', () => {
  test('from JSON, from rendered text, and nothing when there is none', () => {
    assert.equal(tasks.runIdFrom('{"run_id":"dr-0004","status":"framed"}'), 'dr-0004')
    assert.equal(tasks.runIdFrom('Run framed.\nrun_id: dr-0012\nNext: run it'), 'dr-0012')
    assert.equal(tasks.runIdFrom('Stored under .dsh/deep-research/dr-0007/plan.md'), 'dr-0007')
    assert.equal(tasks.runIdFrom('"run_id": "custom_1"'), 'custom_1')
    assert.equal(tasks.runIdFrom('needs input: which period?'), undefined)
  })
})
