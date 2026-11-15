#!/usr/bin/env node
// Build the writing engine's virtual environment inside the snapshot (never in the source checkout).
//
//   node scripts/install-engine.mjs            build when missing or when the engine's files changed
//   node scripts/install-engine.mjs --force    rebuild
//   node scripts/install-engine.mjs --check    exit 1 when the engine is not ready, build nothing
//
// The venv goes to upstream/vendor/academic-harness/.venv, upstream's own layout, and is found by
// academic-harness-cli.js with no setting. A stamp (.ah-tree-sha256) records the hash of the engine's
// files so a sync that brings a different engine triggers a rebuild. uv is used when present, else
// python -m venv and pip. The build needs the network once, for pyyaml and the build backend.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { engineDir, engineHash, engineStatus, STAMP_FILE, venvBin, venvPython } from '../server/src/engine.mjs'
import { isDevMode } from '../server/src/paths.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function which(names, env = process.env) {
  for (const name of names) for (const dir of (env.PATH || '').split(delimiter)) if (dir && existsSync(join(dir, name))) return join(dir, name)
  return undefined
}

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')} failed (exit ${r.status})`)
}

export function installEngine({ force = false, upstream = join(root, 'upstream') } = {}) {
  if (isDevMode()) throw new Error('AH_UPSTREAM is set (development mode): the engine is never built inside a checkout. Use ACADEMIC_HARNESS_CLI to point at one.')
  const dir = engineDir(upstream)
  if (!existsSync(join(dir, 'pyproject.toml'))) throw new Error(`no engine at ${dir}: run node scripts/sync-upstream.mjs first`)
  const status = engineStatus({}, dir)
  if (!force && status.ok) return { built: false, how: 'venv already matches the engine files' }
  const venv = join(dir, '.venv')
  rmSync(venv, { recursive: true, force: true })
  rmSync(join(dir, STAMP_FILE), { force: true })
  const uv = process.env.UV?.trim() || which(['uv'])
  if (uv) {
    sh(uv, ['venv', '--clear', venv], dir)
    sh(uv, ['pip', 'install', '--python', venvPython(dir), dir], dir)
  } else {
    const python = process.env.ACADEMIC_HARNESS_PYTHON?.trim() || which(['python3', 'python']) || 'python3'
    sh(python, ['-m', 'venv', '--clear', venv], dir)
    sh(venvPython(dir), ['-m', 'pip', 'install', dir], dir)
  }
  if (!existsSync(venvBin(dir)) && !existsSync(venvPython(dir))) throw new Error('the virtual environment was created but has no python')
  // upstream's installer stamp, so a run without ACADEMIC_HARNESS_SKIP_INSTALL does not rebuild it
  const version = /^version\s*=\s*"([^"]+)"/m.exec(readFileSyncSafe(join(dir, 'pyproject.toml')))?.[1] ?? '0.1.0'
  const rev = /BUNDLE_REV\s*=\s*'([^']+)'/.exec(readFileSyncSafe(join(upstream, 'academic-harness-cli.js')))?.[1]
  if (rev) writeFileSync(join(dir, 'installed-version'), `${version}+${rev}\n`)
  writeFileSync(join(dir, STAMP_FILE), `${engineHash(dir)}\n`)
  return { built: true, how: uv ? 'uv' : 'venv+pip' }
}

function readFileSyncSafe(p) {
  try { return readFileSync(p, 'utf8') } catch { return '' }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--check')) {
      const s = engineStatus({}, engineDir(join(root, 'upstream')))
      console.log(s.ok ? `engine ready (${s.how})` : `engine not ready: ${s.why}`)
      process.exit(s.ok ? 0 : 1)
    }
    const r = installEngine({ force: process.argv.includes('--force') })
    console.log(r.built ? `built the engine environment (${r.how})` : r.how)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
