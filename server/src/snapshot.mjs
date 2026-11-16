// The snapshot of the Academic Harness source (upstream/): what it is, and whether it is what the lock says.
//
// `UPSTREAM.lock.json` records the commit and a digest of the snapshot's files, so a snapshot fetched from GitHub on another machine, with
// no source checkout, can be shown to hold the same bytes as the one taken with `git archive` here.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Names the installers and the interpreter create inside the snapshot: never part of what upstream shipped. */
const GENERATED = new Set(['node_modules', '.venv', '__pycache__', '.ah-tree-sha256', '.ah-installing', 'installed-version', '.staging'])

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

/** One digest over every file's path and content. Cheap enough (about 3,000 files, 55 MB) to check at setup and in the doctor. */
export function treeDigest(dir) {
  const hash = createHash('sha256')
  const files = snapshotFiles(dir)
  for (const path of files) hash.update(`${path}\0${createHash('sha256').update(readFileSync(join(dir, path))).digest('hex')}\n`)
  return { sha256: hash.digest('hex'), fileCount: files.length }
}

/** What is in `dir` against what the lock says. Never throws: a missing snapshot is a finding. */
export function checkSnapshot(dir, lock) {
  if (!existsSync(join(dir, 'package.json'))) return { state: 'missing', detail: `no snapshot at ${dir}` }
  let version
  try { version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version } catch { return { state: 'broken', detail: 'package.json is unreadable' } }
  if (!lock?.treeSha256) return { state: 'unverified', version, detail: 'the lock has no digest (run sync-upstream)' }
  if (statSync(dir).isDirectory() === false) return { state: 'broken', detail: 'not a directory' }
  const now = treeDigest(dir)
  return now.sha256 === lock.treeSha256
    ? { state: 'ok', version, fileCount: now.fileCount, commit: lock.commit }
    : { state: 'differs', version, detail: `${now.fileCount} files, the lock says ${lock.fileCount}: the snapshot is not what ${String(lock.commit).slice(0, 7)} holds (edited, or from another commit)` }
}
