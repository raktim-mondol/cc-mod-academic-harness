// What the interface pane and the status line show about a project and the library, read through the engine and PaperMemory's database.
//
// Everything here is read-only: `ah state` (which prints the paper-state card and changes nothing) and a read-only open of the PaperMemory
// database. Parsing is separate from reading so the tests can feed it text.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadEngine } from './engine-launch.mjs'

const CARD_KEEP = [/^# Paper state/, /^Bibliography:/, /^Outline status:/, /^Structure:/, /^Gate now:/, /^Done:/]

/** `Gate now: FAIL (5 blocking, 7 open).` -> { status, blocking, open }; null when the card has no such line. */
export function parseGate(card) {
  const m = /^Gate now: (PASS|FAIL)(?: \((\d+) blocking, (\d+) open\))?/m.exec(String(card ?? ''))
  if (!m) return null
  return { status: m[1], blocking: Number(m[2] ?? 0), open: Number(m[3] ?? 0) }
}

/** The card cut down to what a pane has room for: the title, bibliography, outline, structure, the gate, its first findings and the verdict. */
export function summarizeCard(card, { findings = 5 } = {}) {
  const all = String(card ?? '').split('\n')
  const out = []
  let afterGate = false
  let shown = 0
  for (const line of all) {
    if (CARD_KEEP.some(re => re.test(line))) {
      out.push(line)
      afterGate = /^Gate now:/.test(line)
    } else if (afterGate && /^- \S/.test(line)) {
      if (shown++ < findings) out.push(line)
    } else if (line.trim() === '' || /^Done:/.test(line)) afterGate = false
  }
  if (shown > findings) out.splice(out.findIndex(l => /^Done:/.test(l)) < 0 ? out.length : out.findIndex(l => /^Done:/.test(l)), 0, `- … and ${shown - findings} more`)
  return out
}

/** The project: its root, the summary lines and the gate. Null outside an ah.yaml tree; { error } when the engine cannot answer. */
export async function projectState(cwd, env = process.env) {
  const loaded = await loadEngine(env)
  if (loaded.error) return { error: loaded.error }
  const { cli, launch } = loaded
  const root = cli.findAhRoot(cwd)
  if (!root) return null
  const r = await cli.run(launch.command, cli.cliArgs(launch, ['state', '--project', root]), { cwd: root, timeoutMs: 20_000, env: cli.ahEnv({}, { root }), silent: true })
  if (r.code !== 0) return { root, error: `ah state exited ${r.code}: ${(r.err || r.out).trim().slice(0, 160)}` }
  return { root, lines: summarizeCard(r.out), gate: parseGate(r.out) }
}

export function papermemoryDb(env = process.env) {
  return env.PAPERMEMORY_DB?.trim() || join(homedir(), '.local', 'share', 'papermemory', 'papermemory.db')
}

/** Counts from the PaperMemory database, opened read-only. Null when there is no database yet. */
export async function libraryCounts(env = process.env) {
  const path = papermemoryDb(env)
  if (!existsSync(path)) return null
  try {
    const { DatabaseSync } = await import('node:sqlite')
    // A file URL, so a `?`, `#` or `%` in the path is not read as part of the query. immutable=1: SQLite touches nothing, not even the -shm and -wal files a read-only open of a WAL database would leave beside the shared store.
    const db = new DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, { readOnly: true })
    try {
      const one = sql => { try { return Number(db.prepare(sql).get()?.c ?? 0) } catch { return 0 } }
      return {
        path,
        papers: one('select count(*) c from papers'),
        citable: one("select count(*) c from papers where cite_state = 'citable'"),
        claims: one('select count(*) c from claims'),
        notes: one('select count(*) c from observations') + one('select count(*) c from lessons'),
      }
    } finally {
      db.close()
    }
  } catch (error) {
    return { path, error: String(error?.message ?? error).split('\n')[0] }
  }
}

export async function panelData(cwd, { gateOnly = false, env = process.env } = {}) {
  const [project, library] = await Promise.all([projectState(cwd, env), gateOnly ? null : libraryCounts(env)])
  return { project, library }
}
