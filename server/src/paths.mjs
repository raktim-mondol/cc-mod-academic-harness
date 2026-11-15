// Where things live. One place, so the launchers, the tool host and the tests agree.
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export const modRoot = () => resolve(HERE, '..', '..')
/** Stand-in for DSH_HOME: managed installs and job records. Never ~/.dsh. */
export const modHome = (env = process.env) => env.AH_MOD_HOME?.trim() || join(homedir(), '.local', 'share', 'cc-mod-academic-harness', 'home')
/** The snapshot of the source. AH_UPSTREAM points it at a checkout, read-only (development mode). */
export const upstreamDir = (env = process.env) => env.AH_UPSTREAM?.trim() || join(modRoot(), 'upstream')
export const isDevMode = (env = process.env) => Boolean(env.AH_UPSTREAM?.trim())
