// The interface's pure parts (P5): the status line, the pane's data and what each part of the pane says. No `$`, no Node, so a test can
// drive them directly.
//
// Written in the erasable subset of TypeScript (no enums, no parameter properties) so Node can run it as it is in a test.
import type { JobRecord } from './jobs-core'

export type Gate = { status: 'PASS' | 'FAIL'; blocking: number; open: number }
export type ProjectData = { root: string; lines: string[]; gate: Gate | null; error?: string }
export type Library = { papers?: number; citable?: number; claims?: number; notes?: number; error?: string }
export type JobRow = { id: string; kind: string; label: string; status: string; detail: string; startedAt: number | null; endedAt: number | null }
export type NoteRow = { at: number; type: string; title: string }

/** What the pane shows. Kept as one value so a refresh is one write and every reader of it redraws. */
export type PanelState = {
  /** When the file reads were made (ms since the epoch); ages are counted from here. */
  at: number
  /** The folder the data is about. */
  cwd: string
  /** null outside an ah.yaml tree; { error } when the engine could not answer; unset before the first read. */
  project: ProjectData | { error: string } | null
  /** null when PaperMemory has no database yet. */
  library: Library | null
  jobs: JobRow[]
  notes: NoteRow[]
}

export const EMPTY_PANEL: PanelState = { at: 0, cwd: '', project: null, library: null, jobs: [], notes: [] }

/** What the status line is made of besides the mode: kept here so mode.ts (which writes the line) and ui.tsx (which refreshes it) agree. */
export const live: { jobs: number; gate: Gate | null; shownKey: string } = { jobs: 0, gate: null, shownKey: '' }

export function resetLive(): void {
  live.jobs = 0
  live.gate = null
  live.shownKey = ''
}

// ---- the status line ----

export function composeStatus(isOn: boolean, jobs: number, gate: Gate | null): string {
  const parts = [`research mode ${isOn ? 'on' : 'off'}`]
  if (jobs > 0) parts.push(`${jobs} job${jobs === 1 ? '' : 's'} running`)
  if (gate) parts.push(gate.status === 'FAIL' ? `gate FAIL (${gate.blocking} blocking)` : 'gate PASS')
  return parts.join(' · ')
}

/** Changes whenever the line would read differently, so a timer redraws it only then. */
export function statusKey(jobs: number, gate: Gate | null): string {
  return `${jobs}|${gate ? `${gate.status}${gate.blocking}` : '-'}`
}

// ---- reading what the bridge, the job folder and the notebook say ----

/** The JSON `server/bin/ah-ui.mjs` prints. Anything else is an error, never a throw. */
export function parseBridge(stdout: string): { project: PanelState['project']; library: PanelState['library'] } | { error: string } {
  try {
    const parsed = JSON.parse(String(stdout ?? '').trim().split('\n').filter(Boolean).pop() ?? '') as { project?: unknown; library?: unknown }
    if (!parsed || typeof parsed !== 'object') return { error: 'the interface bridge printed nothing readable' }
    return { project: (parsed.project ?? null) as PanelState['project'], library: (parsed.library ?? null) as PanelState['library'] }
  } catch {
    return { error: 'the interface bridge printed nothing readable' }
  }
}

const RUNNING = ['running', 'stopping']

export function isRunning(r: JobRecord): boolean {
  return RUNNING.includes(String(r.status))
}

/** Running jobs of this session. */
export function runningCount(records: readonly JobRecord[], session: string): number {
  return records.filter(r => r && r.session === session && isRunning(r)).length
}

/** The jobs of this session for the pane: the running ones first, then the last few that ended. */
export function jobRows(records: readonly JobRecord[], session: string, keepEnded = 3): JobRow[] {
  const mine = records.filter(r => r && r.id && r.session === session)
  const row = (r: (typeof mine)[number]): JobRow => ({
    id: String(r.id),
    kind: String(r.kind ?? 'job'),
    label: String(r.label ?? r.kind ?? 'job'),
    status: String(r.status ?? ''),
    detail: String((r.progress ?? r.detail ?? '') || ''),
    startedAt: typeof r.startedAt === 'number' ? r.startedAt : null,
    endedAt: typeof r.endedAt === 'number' ? r.endedAt : null,
  })
  const running = mine.filter(isRunning).sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0)).map(row)
  const ended = mine.filter(r => !isRunning(r)).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).slice(0, keepEnded).map(row)
  return [...running, ...ended]
}

/** The last `limit` entries of a notebook file (JSON lines, oldest first). A line that is not an entry is skipped. */
export function noteRows(text: string, limit = 5): NoteRow[] {
  const out: NoteRow[] = []
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as { timestamp?: unknown; type?: unknown; title?: unknown }
      if (typeof e?.title === 'string' && e.title) out.push({ at: typeof e.timestamp === 'number' ? e.timestamp : 0, type: typeof e.type === 'string' ? e.type : 'note', title: e.title })
    } catch {
      // a half-written last line: the next read has it
    }
  }
  return out.slice(-limit)
}

/** The notebook file's name for a session, as upstream makes it. */
export const notebookName = (session: string): string => `${String(session).replace(/[^A-Za-z0-9._-]/g, '_')}.jsonl`

// ---- what the pane says ----

export function age(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 90) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 90) return `${m}m`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`
}

export type Tone = 'plain' | 'dim' | 'warn' | 'ok' | 'bad'
export type Line = { text: string; tone: Tone }
export type Section = { title: string; lines: Line[] }

const plain = (text: string): Line => ({ text, tone: 'plain' })
const dim = (text: string): Line => ({ text, tone: 'dim' })

/** Cut `text` to `width` cells, with an ellipsis. */
export function clip(text: string, width: number): string {
  const w = Math.max(1, Math.floor(width))
  const one = String(text).replace(/\s+/g, ' ')
  return one.length <= w ? one : `${one.slice(0, Math.max(0, w - 1))}…`
}

const JOB_MARK: Record<string, string> = { running: '▶', stopping: '■', completed: '✓', failed: '✗', killed: '■', interrupted: '!' }

const MORE_LINE = /^- … and (\d+) more$/

/** The project's lines for a small pane: the title, bibliography and gate, the first findings, and a count of the rest. */
export function compactProject(lines: readonly string[], keep = 3): string[] {
  const out: string[] = []
  let findings = 0
  let hidden = 0
  for (const l of lines) {
    const more = MORE_LINE.exec(l)
    if (more) hidden += Number(more[1])
    else if (/^- \S/.test(l)) {
      if (findings++ < keep) out.push(l)
      else hidden++
    } else if (!/^(Outline status:|Structure:|Done:)/.test(l)) out.push(l)
  }
  if (hidden > 0) out.push(`- … and ${hidden} more`)
  return out
}

/** The four parts of the pane, as text. `width` is the room of one column; `compact` shortens the project part for a pane with little height. */
export function sections(state: PanelState, width: number, compact = false): Section[] {
  const project: Section = { title: 'Project', lines: [] }
  const p = state.project as (ProjectData & { error?: string }) | { error: string } | null
  if (!p) project.lines.push(dim(state.cwd ? 'Not in an ah.yaml project (research mode can still be on).' : 'Reading…'))
  else if ('lines' in p && Array.isArray(p.lines) && p.lines.length) {
    if (!compact) project.lines.push(dim(clip(`root ${p.root}`, width)))
    for (const l of compact ? compactProject(p.lines) : p.lines) {
      const tone: Tone = /^Gate now: FAIL/.test(l) ? 'bad' : /^Gate now: PASS/.test(l) ? 'ok' : /^# /.test(l) ? 'plain' : 'plain'
      project.lines.push({ text: clip(l.replace(/^# /, ''), width), tone })
    }
    if (p.error) project.lines.push({ text: clip(p.error, width), tone: 'warn' })
  } else project.lines.push({ text: clip(('error' in p && p.error) || 'The engine gave no state.', width), tone: 'warn' })

  const jobs: Section = { title: 'Jobs', lines: [] }
  if (state.jobs.length === 0) jobs.lines.push(dim('No background jobs in this session.'))
  for (const j of state.jobs) {
    const since = j.status && RUNNING.includes(j.status) ? (j.startedAt ? ` ${age(state.at - j.startedAt)}` : '') : j.endedAt ? ` ${age(state.at - j.endedAt)} ago` : ''
    const tone: Tone = RUNNING.includes(j.status) ? 'warn' : j.status === 'completed' ? 'ok' : 'bad'
    const head = `${JOB_MARK[j.status] ?? '·'} ${j.id} `
    const room = Math.max(8, width - head.length - since.length)
    jobs.lines.push({ text: clip(`${head}${clip(j.label, room)}${since}`, width), tone })
    if (RUNNING.includes(j.status) && j.detail) jobs.lines.push(dim(clip(`  ${j.detail}`, width)))
  }

  const notes: Section = { title: 'Notebook', lines: [] }
  if (state.notes.length === 0) notes.lines.push(dim('No notebook entries in this session yet.'))
  for (const n of state.notes) notes.lines.push(plain(clip(`${n.at ? `${age(state.at - n.at)} ago ` : ''}${n.type}: ${n.title}`, width)))

  const library: Section = { title: 'Library', lines: [] }
  const lib = state.library
  if (!lib) library.lines.push(dim('PaperMemory has no library yet.'))
  else if (lib.error) library.lines.push({ text: clip(lib.error, width), tone: 'warn' })
  else library.lines.push(plain(clip(`${lib.papers ?? 0} papers (${lib.citable ?? 0} citable) · ${lib.claims ?? 0} claims · ${lib.notes ?? 0} notes`, width)))

  return [project, jobs, notes, library]
}

export type Layout = { columns: 1 | 2; width: number }

/** Two columns from 96 cells, one below; `width` is the room of one column, less the gap. */
export function layoutFor(bodyColumns: number): Layout {
  const total = Math.max(20, Math.floor(bodyColumns || 0))
  return total >= 96 ? { columns: 2, width: Math.floor((total - 3) / 2) } : { columns: 1, width: total - 1 }
}

/** The sections of each column: wide puts the project on the left, which is the tall part, and the jobs, notebook and library on the right. */
export function arrange(all: readonly Section[], layout: Layout): Section[][] {
  const [project, jobs, notes, library] = all as [Section, Section, Section, Section]
  return layout.columns === 2 ? [[project], [jobs, notes, library]] : [[project, jobs, notes, library]]
}

/** True when every column fits `bodyRows` with a blank row between its parts; otherwise the parts run together so that more of them show. */
export function hasRoomForGaps(columns: readonly (readonly Section[])[], bodyRows: number): boolean {
  const rows = columns.map(col => col.reduce((n, s) => n + s.lines.length + 1, 0) + Math.max(0, col.length - 1))
  return Math.max(0, ...rows) <= Math.max(1, Math.floor(bodyRows || 0))
}

/** Everything the pane says as plain text: for a test, and for the line the command prints. */
export function summaryText(state: PanelState, width = 80): string {
  return sections(state, width).map(s => `${s.title}\n${s.lines.map(l => `  ${l.text}`).join('\n')}`).join('\n')
}
