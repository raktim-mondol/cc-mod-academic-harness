// Where things live. One place, so the launchers, the tool host and the tests agree.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export const modRoot = () => resolve(HERE, '..', '..')
/** Stand-in for DSH_HOME: managed installs and job records. Never ~/.dsh. */
export const modHome = (env = process.env) => env.AH_MOD_HOME?.trim() || join(homedir(), '.local', 'share', 'cc-mod-academic-harness', 'home')
/**
 * The snapshot of the source, in the order that applies:
 *   AH_UPSTREAM            a checkout, read-only (development mode)
 *   <plugin>/upstream      a clone that has been set up (scripts/setup.mjs, scripts/sync-upstream.mjs)
 *   <home>/upstream/<sha>  an installed copy of the plugin, or a clone nobody set up: the server fetches it there on first start
 *                          (server/src/bootstrap.mjs), outside the plugin folder, which an update replaces
 */
export function upstreamDir(env = process.env, root = modRoot()) {
  if (env.AH_UPSTREAM?.trim()) return env.AH_UPSTREAM.trim()
  const cloned = join(root, 'upstream')
  return existsSync(join(cloned, 'package.json')) ? cloned : fetchedUpstreamDir(env, root)
}

/** Where the first-start fetch puts the snapshot: one folder per commit, so an update to a new commit starts clean. */
export function fetchedUpstreamDir(env = process.env, root = modRoot()) {
  let commit = 'unlocked'
  try { commit = JSON.parse(readFileSync(join(root, 'UPSTREAM.lock.json'), 'utf8')).commit.slice(0, 12) } catch { /* no lock: one shared folder */ }
  return join(modHome(env), 'upstream', commit)
}
export const isDevMode = (env = process.env) => Boolean(env.AH_UPSTREAM?.trim())
