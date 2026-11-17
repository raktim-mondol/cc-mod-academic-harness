// Where things live. One place, so the launchers, the tool host and the tests agree.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { snapshotFiles } from './snapshot.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

export const modRoot = () => resolve(HERE, '..', '..')
/** Stand-in for DSH_HOME: managed installs and job records. Never ~/.dsh. */
export const modHome = (env = process.env) => env.AH_MOD_HOME?.trim() || join(homedir(), '.local', 'share', 'cc-mod-academic-harness', 'home')

/** The source of the tools, the writing engine and the skills: committed in the plugin at <plugin>/core. */
export const bundledCoreDir = (root = modRoot()) => join(root, 'core')

/**
 * The core the server runs from, in the order that applies:
 *   AH_CORE               a folder to use instead, read-only (development, tests)
 *   <plugin>/core         a clone that has been set up (scripts/setup.mjs): its dependencies are installed in place
 *   <home>/core/<id>      an installed copy of the plugin, or a clone nobody set up: the server copies the plugin's core there on first start
 *                         (server/src/bootstrap.mjs), outside the plugin folder, which an update replaces
 */
export function coreDir(env = process.env, root = modRoot()) {
  if (env.AH_CORE?.trim()) return env.AH_CORE.trim()
  const bundled = bundledCoreDir(root)
  return existsSync(join(bundled, 'node_modules', 'ah-dsh-tools')) ? bundled : workingCoreDir(env, root)
}

const ids = new Map()

/**
 * What the working copy is named: the plugin's version and a fingerprint of the files of its core (their paths and sizes), so a plugin update
 * that changes the core starts a clean copy, and one that does not keeps the dependencies and the engine's environment it built.
 */
export function coreId(root = modRoot()) {
  const bundled = bundledCoreDir(root)
  const cached = ids.get(bundled)
  if (cached) return cached
  let version = '0'
  try { version = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version } catch { /* no manifest: the fingerprint alone names it */ }
  const hash = createHash('sha256')
  try { for (const f of snapshotFiles(bundled)) hash.update(`${f}\0${statSync(join(bundled, f)).size}\n`) } catch { /* no core: the id is of nothing, and bootstrap says so */ }
  const id = `${version}-${hash.digest('hex').slice(0, 10)}`
  ids.set(bundled, id)
  return id
}

/** Where the first-start copy of the core goes: one folder per core, so an update that changes it starts clean. */
export function workingCoreDir(env = process.env, root = modRoot()) {
  return join(modHome(env), 'core', coreId(root))
}
export const isDevMode = (env = process.env) => Boolean(env.AH_CORE?.trim())
