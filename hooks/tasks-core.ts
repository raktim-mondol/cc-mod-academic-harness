// The seven task commands, as pure functions: no `$`, no Node, so a test can run them and compare them with upstream's.
//
// Upstream's composer tasks (academic-task.js) take a task, a prompt and an effort, check the prompt, and start one tool with
// arguments that depend on the effort. This file is that mapping for Claude Code. The effort tables come from the copy of
// task-modes.js in hooks/generated/, so a change upstream arrives with a sync; the prompt rules are ported from academic-task.js
// and checked against it by tests/scripts/tasks.test.mjs, which runs upstream's own submitAcademicTask and compares the tool calls.
//
// Written in the erasable subset of TypeScript (no enums, no parameter properties) so Node can run it as it is in a test.
import { AUDIT_LIMITS, HYPOTHESIS_LIMITS, PAPER_LIMITS, REVIEW_TOPOLOGY, REVISION_COMPILE, TASK_EFFORTS } from './generated/task-modes'

export type TaskId = 'deep_research' | 'deep_review' | 'find_papers' | 'check_references' | 'write_revise' | 'analyze_data' | 'generate_hypotheses'
export type Effort = 'auto' | 'low' | 'medium' | 'high'

export const TASK_IDS: readonly TaskId[] = ['deep_research', 'deep_review', 'find_papers', 'check_references', 'write_revise', 'analyze_data', 'generate_hypotheses']

/** The slash command of each task. Prefixed `ah-` because the bare names can collide (S7: `analyze` is already a command of another plugin). */
export const TASK_COMMANDS: Record<TaskId, string> = {
  deep_research: 'ah-research',
  deep_review: 'ah-review',
  find_papers: 'ah-papers',
  check_references: 'ah-references',
  write_revise: 'ah-write',
  analyze_data: 'ah-analyze',
  generate_hypotheses: 'ah-hypotheses',
}

export const TASK_LABELS: Record<TaskId, string> = {
  deep_research: 'Deep Research',
  deep_review: 'Deep Review',
  find_papers: 'Find Papers',
  check_references: 'Check References',
  write_revise: 'Write / Revise',
  analyze_data: 'Analyze Data',
  generate_hypotheses: 'Generate Hypotheses',
}

/** What each command expects after its name, for the usage line. */
export const TASK_USAGE: Record<TaskId, string> = {
  deep_research: '[--effort low|medium|high] <research question>',
  deep_review: '[--effort low|medium|high] <manuscript path> [-- <what the reviewers should focus on>]',
  find_papers: '[--effort low|medium|high] <search query>',
  check_references: '[--effort low|medium|high] <bibliography path> [-- <manuscript path>]',
  write_revise: '[--effort low|medium|high] <earlier manuscript path> -- <revised manuscript path>',
  analyze_data: '[--effort low|medium|high] [<slug> --] <analysis question>',
  generate_hypotheses: '[--effort low|medium|high] [<slug> --] <research goal>',
}

/** The bare tool each task starts (upstream's TASK_TOOLS). */
export const TASK_TOOLS: Record<TaskId, string> = {
  deep_research: 'deep_research',
  deep_review: 'deep_review',
  find_papers: 'literature_search',
  check_references: 'citation',
  write_revise: 'manuscript_diff',
  analyze_data: 'analysis_run',
  generate_hypotheses: 'coscientist',
}

export const PLUGIN_TOOL_PREFIX = 'mcp__plugin_academic-harness_ah__'
export const toolName = (bare: string): `mcp__${string}__${string}` => `${PLUGIN_TOOL_PREFIX}${bare}`

const EMPTY: Record<string, string> = {
  deep_review: 'enter a manuscript path first',
  find_papers: 'enter a search query first',
  check_references: 'enter a bibliography path first',
  write_revise: 'enter the two manuscript paths first',
  analyze_data: 'enter an analysis question first',
  generate_hypotheses: 'enter a research goal first',
}

const PROMPT_LIMIT = 64_000
const REVIEW_FOCUS_LIMIT = 4000
const PAPER_QUERY_LIMIT = 2000
const TASK_BODY_LIMIT = 8000
const SLUG_LINE = /^[a-z0-9][a-z0-9-]{0,40}$/u
const MANUSCRIPT_EXT = new Set(['tex', 'md', 'markdown', 'qmd', 'rmd'])
const REVISION_EXT = new Set(['tex', 'md', 'txt', 'markdown'])

// ---- the command line ----

export type Parsed = { effort: Effort; prompt: string } | { error: string }

/**
 * `<leading flags> <prompt>`. The effort is a leading `--effort <level>`, `--effort=<level>`, `-e <level>` or `effort=<level>`;
 * anything else is the prompt, verbatim. (A bare first word `low` is not taken as an effort: "low rank adaptation" is a topic.)
 */
export function parseCommandArgs(raw: string): Parsed {
  let rest = String(raw ?? '').replace(/^\s+/, '')
  let effort: string = 'auto'
  for (;;) {
    const m = /^(?:--effort[= ]|-e |effort=)(\S*)\s*/u.exec(rest)
    if (!m) break
    effort = (m[1] ?? '').toLowerCase()
    rest = rest.slice(m[0].length)
  }
  if (!(TASK_EFFORTS as readonly string[]).includes(effort)) return { error: 'effort must be auto, low, medium, or high' }
  return { effort: effort as Effort, prompt: rest.replace(/\s+$/, '') }
}

/** A one-line form for the commands that take two lines: the first ` -- ` stands for the line break. */
export function lines(prompt: string): string {
  return prompt.includes('\n') ? prompt : prompt.replace(' -- ', '\n')
}

// ---- the task prompt rules (from academic-task.js) ----

export function reviewPromptParts(prompt: string): { path: string; focus: string } {
  const text = String(prompt ?? '')
  const breakAt = text.indexOf('\n')
  const path = (breakAt === -1 ? text : text.slice(0, breakAt)).trim()
  const focus = breakAt === -1 ? '' : text.slice(breakAt + 1).trim()
  if (!path) throw new Error('enter a manuscript path first')
  if (focus.length > REVIEW_FOCUS_LIMIT) throw new Error(`focus is limited to ${REVIEW_FOCUS_LIMIT} characters`)
  return { path, focus }
}

export function referencePromptParts(prompt: string): { path: string; manuscript: string } {
  const all = String(prompt ?? '').split('\n').map(line => line.trim()).filter(Boolean)
  if (!all.length) throw new Error('enter a bibliography path first')
  if (all.length > 2) throw new Error('Check References takes a bibliography path and an optional manuscript path')
  const path = all[0] as string
  const manuscript = all[1] ?? ''
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : ''
  if (!manuscript && MANUSCRIPT_EXT.has(ext)) throw new Error('put the bibliography path on the first line; a manuscript path is optional on the second line')
  return { path, manuscript }
}

export function revisionPaths(prompt: string): { old: string; next: string } {
  const all = String(prompt ?? '').split('\n').map(line => line.trim()).filter(Boolean)
  if (all.length !== 2) throw new Error('Write / Revise compares two manuscript versions. Put the earlier file on the first line and the revised file on the second.')
  if (all[0] === all[1]) throw new Error('the two manuscript paths must differ')
  for (const path of all) {
    const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : ''
    if (!REVISION_EXT.has(ext)) throw new Error('Write / Revise compares .tex, .md, or .txt versions')
  }
  return { old: all[0] as string, next: all[1] as string }
}

/** SHA-256 of a string as hex (UTF-8), for the default slug. The hooks module has no `crypto`. */
export function sha256Hex(input: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  const bytes: number[] = []
  for (const ch of String(input)) {
    const c = ch.codePointAt(0) as number
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  const bitLength = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  const high = Math.floor(bitLength / 0x100000000)
  const low = bitLength >>> 0
  for (const w of [high, low]) bytes.push((w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255)
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  const w = new Array<number>(64)
  for (let i = 0; i < bytes.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = ((bytes[i + t * 4] as number) << 24) | ((bytes[i + t * 4 + 1] as number) << 16) | ((bytes[i + t * 4 + 2] as number) << 8) | (bytes[i + t * 4 + 3] as number)
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15] as number, 7) ^ rotr(w[t - 15] as number, 18) ^ ((w[t - 15] as number) >>> 3)
      const s1 = rotr(w[t - 2] as number, 17) ^ rotr(w[t - 2] as number, 19) ^ ((w[t - 2] as number) >>> 10)
      w[t] = ((w[t - 16] as number) + s0 + (w[t - 7] as number) + s1) | 0
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number]
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + (K[t] as number) + (w[t] as number)) | 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    h[0] = (h[0] as number + a) | 0; h[1] = (h[1] as number + b) | 0; h[2] = (h[2] as number + c) | 0; h[3] = (h[3] as number + d) | 0
    h[4] = (h[4] as number + e) | 0; h[5] = (h[5] as number + f) | 0; h[6] = (h[6] as number + g) | 0; h[7] = (h[7] as number + hh) | 0
  }
  return h.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('')
}

export function slugAndBody(prompt: string, { empty, prefix }: { empty: string; prefix: string }): { slug: string; body: string } {
  const text = String(prompt ?? '')
  const breakAt = text.indexOf('\n')
  const first = (breakAt === -1 ? text : text.slice(0, breakAt)).trim()
  const rest = breakAt === -1 ? '' : text.slice(breakAt + 1).trim()
  const body = rest && SLUG_LINE.test(first) ? rest : text.trim()
  if (!body) throw new Error(empty)
  if (body.length > TASK_BODY_LIMIT) throw new Error(`this task is limited to ${TASK_BODY_LIMIT} characters`)
  const slug = rest && SLUG_LINE.test(first) ? first : `${prefix}-${sha256Hex(body).slice(0, 12)}`
  return { slug, body }
}

// ---- the plan: which tool, with which arguments ----

export type Step = {
  /** The bare tool name (`deep_research`); `toolName()` adds the plugin prefix. */
  tool: string
  args: Record<string, unknown>
  /** The progress line upstream shows for this step. */
  progress: string
  /** For `run` after `start`: take `run_id` from the earlier step's JSON result. */
  runIdFromPrevious?: true
}

export type Plan = {
  task: TaskId
  label: string
  /** Workspace paths that must be files (at most 50 MB) before anything starts. */
  files: string[]
  steps: Step[]
  error?: undefined
} | { error: string }

/** Everything `submitAcademicTask` checks and decides before it starts a job, for one task, prompt and effort. */
export function planTask(task: TaskId, rawPrompt: string, effort: Effort): Plan {
  const label = TASK_LABELS[task]
  if (!(TASK_IDS as readonly string[]).includes(task)) return { error: 'task is not available' }
  if (!(TASK_EFFORTS as readonly string[]).includes(effort)) return { error: 'effort must be auto, low, medium, or high' }
  if (typeof rawPrompt !== 'string' || !rawPrompt.trim()) return { error: EMPTY[task] ?? 'enter a research question first' }
  if (rawPrompt.length > PROMPT_LIMIT) return { error: 'research prompt exceeds 64000 characters' }
  const prompt = task === 'deep_research' || task === 'find_papers' ? rawPrompt : lines(rawPrompt)
  try {
    if (task === 'deep_review') {
      const review = reviewPromptParts(prompt)
      const topology = (REVIEW_TOPOLOGY as Record<string, string>)[effort]
      return { task, label, files: [review.path], steps: [{ tool: 'deep_review', progress: `Reviewing ${review.path}${topology ? ` at ${topology}` : ''}`, args: { action: 'review', path: review.path, ...(review.focus ? { focus: review.focus } : {}), ...(topology ? { topology } : {}) } }] }
    }
    if (task === 'check_references') {
      const refs = referencePromptParts(prompt)
      const limit = (AUDIT_LIMITS as Record<string, number>)[effort]
      return { task, label, files: [refs.path, ...(refs.manuscript ? [refs.manuscript] : [])], steps: [{ tool: 'citation', progress: `Auditing ${refs.path}${limit ? ` (${limit} online)` : ''}`, args: { action: 'audit', path: refs.path, ...(refs.manuscript ? { manuscript: refs.manuscript } : {}), ...(limit ? { max_audit: limit } : {}) } }] }
    }
    if (task === 'write_revise') {
      const rev = revisionPaths(prompt)
      const compile = Object.hasOwn(REVISION_COMPILE, effort) ? (REVISION_COMPILE as Record<string, boolean>)[effort] : undefined
      return { task, label, files: [rev.old, rev.next], steps: [{ tool: 'manuscript_diff', progress: `Comparing ${rev.old} with ${rev.next}`, args: { action: 'diff', old: rev.old, new: rev.next, ...(compile === undefined ? {} : { compile }) } }] }
    }
    if (task === 'analyze_data') {
      const a = slugAndBody(prompt, { empty: 'enter an analysis question first', prefix: 'analysis' })
      return { task, label, files: [], steps: [{ tool: 'analysis_run', progress: `Freezing analysis plan ${a.slug}`, args: { action: 'plan', slug: a.slug, plan: { question: a.body } } }] }
    }
    if (task === 'generate_hypotheses') {
      const t = slugAndBody(prompt, { empty: 'enter a research goal first', prefix: 'hypotheses' })
      const limit = (HYPOTHESIS_LIMITS as Record<string, number>)[effort]
      return { task, label, files: [], steps: [{ tool: 'coscientist', progress: `Opening tournament ${t.slug}`, args: { action: 'start', slug: t.slug, goal: t.body, ...(limit ? { max_hypotheses: limit } : {}) } }] }
    }
    if (task === 'find_papers') {
      const query = prompt.trim()
      if (query.length > PAPER_QUERY_LIMIT) return { error: `search query exceeds ${PAPER_QUERY_LIMIT} characters` }
      const limit = (PAPER_LIMITS as Record<string, number>)[effort]
      return { task, label, files: [], steps: [{ tool: 'literature_search', progress: `Searching for “${query.slice(0, 80)}”${limit ? ` (${limit})` : ''}`, args: { query, ...(limit ? { max_results: limit } : {}) } }] }
    }
    return {
      task, label, files: [],
      steps: [
        { tool: 'deep_research', progress: 'Framing research questions', args: { action: 'start', query: prompt, run: false, ...(effort === 'auto' ? {} : { effort }) } },
        { tool: 'deep_research', progress: 'Running the research run', args: { action: 'run' }, runIdFromPrevious: true },
      ],
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** The plan with the `run_id` filled in for a step that takes it from the one before. */
export function withRunId(step: Step, previous: unknown): Step {
  if (!step.runIdFromPrevious) return step
  const id = previous && typeof previous === 'object' ? (previous as { run_id?: unknown }).run_id : undefined
  return { ...step, args: { ...step.args, ...(typeof id === 'string' && id ? { run_id: id } : {}) } }
}

/** The `run_id` a `deep_research` start answered with: from its JSON, or from the text the server rendered. */
export function runIdFrom(text: string): string | undefined {
  const body = String(text ?? '')
  try {
    const parsed = JSON.parse(body) as { run_id?: unknown }
    if (typeof parsed?.run_id === 'string' && parsed.run_id) return parsed.run_id
  } catch {
    // not JSON: read the rendered text
  }
  const found = /"?run_id"?\s*[:=]\s*`?"?([A-Za-z0-9][A-Za-z0-9_-]*)/u.exec(body) ?? /\b(dr-\d{3,})\b/u.exec(body)
  return found?.[1]
}

/** True when a workspace-relative or absolute path stays inside `cwd` (upstream's resolveWorkspacePath refuses the rest). */
export function insideWorkspace(cwd: string, path: string): { ok: true; abs: string } | { ok: false; error: string } {
  const base = cwd.replace(/\/+$/, '') || '/'
  const joined = path.startsWith('/') ? path : `${base}/${path}`
  const out: string[] = []
  for (const part of joined.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  const abs = `/${out.join('/')}`
  if (abs !== base && !abs.startsWith(`${base}/`)) return { ok: false, error: `path escapes the workspace: ${path}` }
  return { ok: true, abs }
}

export const FILE_LIMIT_BYTES = 50 * 1024 * 1024

// ---- /ah-watch: the saved literature searches, run and read in one line ----
//
// Not one of upstream's seven tasks, so it is not compared with upstream's task code. `literature_watch` keeps saved searches under
// `.dsh/watch/`; "scheduling is manual: nothing runs on a timer". In Claude Code a schedule is `/loop`, so one command runs what is due
// and prints what is new: `/loop 1d /ah-watch`.

export const WATCH_COMMAND = 'ah-watch'
export const WATCH_USAGE = '[--all] [--preview]   (default: run the watches that are due, then print what is new since the last digest)'

export type WatchPlan = { steps: Step[]; error?: undefined } | { error: string }

/** `--all` runs every watch, not only the due ones; `--preview` prints the digest without moving its "since" cut. */
export function planWatch(raw: string): WatchPlan {
  const words = String(raw ?? '').trim().split(/\s+/).filter(Boolean)
  const unknown = words.filter(w => w !== '--all' && w !== '--preview')
  if (unknown.length) return { error: `unknown argument "${unknown[0]}"` }
  const all = words.includes('--all')
  const preview = words.includes('--preview')
  return {
    steps: [
      { tool: 'literature_watch', progress: all ? 'Running every watch' : 'Running the watches that are due', args: { action: 'run', ...(all ? {} : { due_only: true }) } },
      { tool: 'literature_watch', progress: preview ? 'Reading what is new (the cut stays where it was)' : 'Reading what is new since the last digest', args: { action: 'digest', ...(preview ? { preview: true } : {}) } },
    ],
  }
}
