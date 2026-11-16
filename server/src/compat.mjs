// Which Claude Code versions the mod has been seen working on, and what the doctor says about the one that is running.
//
// The hooks module (research mode, the guard, the commands, the pane, the status line) runs inside Claude Code and uses its mod platform,
// which is new: a version older than the oldest one tried may lack it, and a newer one may have changed it. Nothing here refuses to run; it
// says what was and was not seen.
//
// At session start the hooks module writes `<home>/mod-seen/<session>.json` (hooks/seen.ts): the session id, the running Claude Code's
// version and the time. The doctor reads the one for its own session (CLAUDE_CODE_SESSION_ID). No such file means the hooks module did not
// run in this session: Claude Code without the mod platform, or a failure while it loaded.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The versions of Claude Code the mod was seen working on: the commands answer, the status line and the pane draw, the guard refuses
 * protected writes, and the servers connect (tests/live). Add a version here after running the live scripts on it (docs/maintain/testing.md).
 */
export const TESTED_VERSIONS = ['2.1.325']

const VERSION = /(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.]+)?/

/** `2.1.325 (Claude Code)` -> { core: [2, 1, 325], text: '2.1.325' }; null when no version can be read. */
export function parseVersion(text) {
  const m = VERSION.exec(String(text ?? ''))
  return m ? { core: [Number(m[1]), Number(m[2]), Number(m[3])], text: m[0] } : null
}

export function compareCores(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}

/**
 * What to say about a version: `ok` when it is one the mod was seen on, `warn` when it is older than the oldest of those (the mod platform may
 * be missing), `info` when it is newer or between them (expected to work, not seen), `info` too when no version can be read.
 * @returns {{ state: 'ok' | 'warn' | 'info', detail: string }}
 */
export function assessVersion(text, tested = TESTED_VERSIONS) {
  const v = parseVersion(text)
  if (!v) return { state: 'info', detail: `could not read a version from "${String(text ?? '').trim().slice(0, 60)}"` }
  const seen = tested.map(parseVersion).filter(Boolean).sort((a, b) => compareCores(a.core, b.core))
  if (seen.length === 0) return { state: 'info', detail: `${v.text} (no version is recorded as tested)` }
  if (seen.some(t => compareCores(t.core, v.core) === 0)) return { state: 'ok', detail: `${v.text}, a version the mod was seen working on` }
  const list = seen.map(t => t.text).join(', ')
  if (compareCores(v.core, seen[0].core) < 0) {
    return { state: 'warn', detail: `${v.text} is older than the oldest version the mod was seen working on (${list}); the mod platform may be missing or different there. Update Claude Code` }
  }
  return { state: 'info', detail: `${v.text} has not been tried with the mod (seen working on ${list}); it is expected to work. If a command, the status line or the guard misbehaves, report it with this version` }
}

/** The file name for a session's record: the session id with anything but letters, digits, dot, dash and underscore replaced (the same rule as hooks/seen.ts). */
export const seenName = session => `${String(session).replace(/[^A-Za-z0-9._-]/g, '_')}.json`

export const seenDir = home => join(home, 'mod-seen')

/** The record the hooks module left for `session`, or null when there is none or it cannot be read. */
export function readSeen(home, session) {
  if (!session) return null
  const file = join(seenDir(home), seenName(session))
  if (!existsSync(file)) return null
  try {
    const r = JSON.parse(readFileSync(file, 'utf8'))
    return r && typeof r === 'object' && typeof r.version === 'string' ? r : null
  } catch {
    return null
  }
}
