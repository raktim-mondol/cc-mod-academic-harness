import type { EngineInterface } from 'claude-code'

import { modHomeOf } from './jobs-core'

// A record that this hooks module loaded, for the doctor.
//
// At session start it writes `<mod home>/mod-seen/<session>.json`: the session id, the Claude Code version that is really running and the
// time. The `ah` server's doctor (server/src/compat.mjs) reads the one for its own session: no record means this module did not run, and the
// version is compared with the ones the mod was seen working on. The server removes records older than a week.
//
// Helpers here take `$` as a parameter and call it in full: the engine reads this source statically and refuses an aliased `$`.

/** The file name for a session: its id with anything but letters, digits, dot, dash and underscore replaced (the same rule as server/src/compat.mjs). */
export const seenName = (session: string): string => `${session.replace(/[^A-Za-z0-9._-]/g, '_')}.json`

export function seenFile(modHome: string | undefined, home: string | undefined, session: string): string | null {
  const base = modHomeOf(modHome, home)
  return base ? `${base}/mod-seen/${seenName(session)}` : null
}

/** Write the record. A record that cannot be written is a missing line in the doctor, never a failed start. */
export async function recordSeen($: EngineInterface): Promise<void> {
  try {
    const session = await $.session.id()
    const file = seenFile(await $.env.get('AH_MOD_HOME'), await $.env.get('HOME'), session)
    if (!file) return
    const { version, base } = await $.session.version()
    await $.fs.write(file, `${JSON.stringify({ session, version, ...(base ? { base } : {}), at: await $.clock.now() })}\n`)
  } catch {
    // not recorded: the doctor says the module has not reported
  }
}
