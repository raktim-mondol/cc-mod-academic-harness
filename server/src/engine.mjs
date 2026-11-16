// Where the writing engine (the Python `ah` package) lives and whether it is ready.
//
// The engine is vendored at upstream/vendor/academic-harness. Its virtual environment is built inside
// that folder (upstream's own layout, `academic-harness-cli.js`), so it sits in the mod's snapshot and
// never in the source checkout. A stamp records the hash of the engine's files when the venv was built;
// when a sync brings a different engine, the stamp no longer matches and the venv is rebuilt.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { isDevMode, upstreamDir } from './paths.mjs'

export const STAMP_FILE = '.ah-tree-sha256'
/** Holds the pid of a running build (engine-install.mjs). Not part of the engine, so not part of its hash. */
export const INSTALLING_FILE = '.ah-installing'
const SKIP_DIRS = new Set(['.venv', '__pycache__', 'build', 'dist', '.pytest_cache', '.mypy_cache', '.ruff_cache'])

export function engineDir(upstream = upstreamDir()) {
  return join(upstream, 'vendor', 'academic-harness')
}

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name) || name.endsWith('.egg-info') || name === STAMP_FILE || name === INSTALLING_FILE || name === 'installed-version') continue
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) yield* walk(p)
    else if (s.isFile()) yield p
  }
}

/** SHA-256 over the engine's source files (names and bytes), not over the venv or build output. */
export function engineHash(dir = engineDir()) {
  const h = createHash('sha256')
  for (const f of walk(dir)) {
    h.update(relative(dir, f).split('\\').join('/'))
    h.update('\0')
    h.update(readFileSync(f))
    h.update('\0')
  }
  return h.digest('hex')
}

export function venvBin(dir = engineDir(), platform = process.platform) {
  return platform === 'win32' ? join(dir, '.venv', 'Scripts', 'ah.exe') : join(dir, '.venv', 'bin', 'ah')
}

export function venvPython(dir = engineDir(), platform = process.platform) {
  return platform === 'win32' ? join(dir, '.venv', 'Scripts', 'python.exe') : join(dir, '.venv', 'bin', 'python')
}

/**
 * Is there an engine this mod can run? `verify: false` skips the hash comparison (a hook's fast path).
 *   { ok: true, how }   an override (ACADEMIC_HARNESS_CLI or AH_CMD) or a venv built from the current engine files
 *   { ok: false, why }  what is missing, worded for the person who has to fix it
 */
export function engineStatus(env = process.env, dir = engineDir(env.AH_UPSTREAM?.trim() || undefined), { verify = true } = {}) {
  const override = (env.ACADEMIC_HARNESS_CLI || env.AH_CMD || '').trim()
  if (override) return { ok: true, how: 'override', command: override }
  if (!existsSync(join(dir, 'pyproject.toml'))) return { ok: false, why: `the engine is not in the snapshot (${dir}); run node scripts/sync-upstream.mjs` }
  if (!existsSync(venvBin(dir)) && !existsSync(venvPython(dir))) return { ok: false, why: 'the engine has no virtual environment; run node scripts/install-engine.mjs' }
  const stamp = join(dir, STAMP_FILE)
  if (!existsSync(stamp)) return { ok: false, why: 'the engine environment was not built by this mod; run node scripts/install-engine.mjs' }
  // Hashing reads every engine file (about 1 MB). A hook skips it: it only needs to know a venv is there.
  if (verify && readFileSync(stamp, 'utf8').trim() !== engineHash(dir)) return { ok: false, why: 'the engine changed since its environment was built; run node scripts/install-engine.mjs' }
  return { ok: true, how: 'venv' }
}

export { isDevMode }
