// The core of the plugin (core/): the files it holds, as a list, without what the installers and the interpreter generate inside a copy.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Names the installers and the interpreter create inside the snapshot: never part of the core's own files. */
const GENERATED = new Set(['node_modules', '.venv', '__pycache__', '.ah-tree-sha256', '.ah-installing', '.ah-core-ready', 'installed-version', '.staging'])

/** An install from the snapshot's own sources (`pip install vendor/papermemory`) leaves build output beside them. */
const BUILD_OUTPUT = /^vendor\/[^/]+\/(build|[^/]+\.egg-info)(\/|$)/

/** Every file of the snapshot, relative to `dir`, sorted, without what the installers generated. */
export function snapshotFiles(dir, rel = '', out = []) {
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (GENERATED.has(entry.name) || entry.name.endsWith('.pyc')) continue
    const path = rel ? `${rel}/${entry.name}` : entry.name
    if (BUILD_OUTPUT.test(path)) continue
    if (entry.isDirectory()) snapshotFiles(dir, path, out)
    else if (entry.isFile()) out.push(path)
  }
  return out
}

/** The version of the core in `dir`, or null when there is none. */
export function coreVersion(dir) {
  if (!existsSync(join(dir, 'package.json'))) return null
  try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version ?? null } catch { return null }
}
