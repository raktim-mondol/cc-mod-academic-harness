// Build the writing engine's virtual environment inside the snapshot, in the background or from the script.
//
//   installEngine({ upstream })   resolves { built, how } once the venv is built and stamped; rejects with the reason
//
// The venv goes to upstream/vendor/academic-harness/.venv (upstream's own layout). uv when present, else python -m venv
// and pip. A marker file (.ah-installing) holds the build's pid while it runs, so the guard can say "being installed"
// instead of "missing", and two servers do not build at once. The server builds through `installEngineInWorker`: a detached
// process, so the build outlives a short session. Nothing is ever built in a checkout (AH_UPSTREAM).
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runDetached } from './detached.mjs'
import { engineDir, engineHash, engineStatus, INSTALLING_FILE, STAMP_FILE, venvBin, venvPython } from './engine.mjs'
import { isDevMode, upstreamDir } from './paths.mjs'

export { INSTALLING_FILE }

const which = (names, env = process.env) => {
  for (const name of names) for (const dir of (env.PATH || '').split(delimiter)) if (dir && existsSync(join(dir, name))) return join(dir, name)
  return undefined
}

function sh(cmd, args, cwd, quiet) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', quiet ? 'ignore' : 'inherit', quiet ? 'pipe' : 'inherit'] })
    let err = ''
    child.stderr?.on('data', d => { err += d })
    child.on('error', reject)
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.slice(0, 3).join(' ')} failed (exit ${code})${err ? `: ${err.trim().slice(-200)}` : ''}`))))
  })
}

const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e?.code === 'EPERM' } }

/** Is a build running right now (a marker whose process is alive)? */
export function installing(dir = engineDir()) {
  const f = join(dir, INSTALLING_FILE)
  if (!existsSync(f)) return false
  const pid = Number(readFileSync(f, 'utf8').trim())
  if (Number.isInteger(pid) && alive(pid)) return true
  rmSync(f, { force: true })
  return false
}

/** Is a build running in ANOTHER process? The marker may already carry this process's pid: the server writes it for the worker it starts. */
export function installingElsewhere(dir = engineDir()) {
  if (!installing(dir)) return false
  try { return Number(readFileSync(join(dir, INSTALLING_FILE), 'utf8').trim()) !== process.pid } catch { return false }
}

const WORKER = fileURLToPath(new URL('../bin/ah-engine-install.mjs', import.meta.url))

/**
 * `installEngine`, run by a detached process (server/bin/ah-engine-install.mjs), so that the build goes on when this server is ended: a session
 * shorter than the build (a headless run) would otherwise cut it short, and the next one would start it again from nothing. The marker is written
 * here, in the worker's name, as soon as it exists, so the guard says "being installed" from the first moment. Resolves `{ ok, why? }` when the
 * worker has ended: `ok` is whether the environment is usable now. Never rejects. `worker` is a seam for tests.
 */
export async function installEngineInWorker({ env = process.env, upstream = upstreamDir(env), worker = WORKER } = {}) {
  const dir = engineDir(upstream)
  const marker = join(dir, INSTALLING_FILE)
  let pid = null
  const code = await runDetached(worker, {
    env,
    args: [upstream],
    onStart(p) { pid = p; if (existsSync(join(dir, 'pyproject.toml')) && !installing(dir)) writeFileSync(marker, `${p}\n`) },
  })
  // A worker that ended without building (it could not start) leaves the marker written for it: remove it, or the next look has to.
  try { if (pid !== null && Number(readFileSync(marker, 'utf8').trim()) === pid) rmSync(marker, { force: true }) } catch { /* no marker */ }
  if (installing(dir)) return { ok: false, why: 'another build is still running' }
  const status = engineStatus(env, dir)
  return status.ok ? { ok: true } : { ok: false, why: code === null ? 'the build could not be started' : status.why }
}

export async function installEngine({ force = false, upstream = upstreamDir(), quiet = false } = {}) {
  if (isDevMode()) throw new Error('AH_UPSTREAM is set (development mode): the engine is never built inside a checkout. Use ACADEMIC_HARNESS_CLI to point at one.')
  const dir = engineDir(upstream)
  if (!existsSync(join(dir, 'pyproject.toml'))) throw new Error(`no engine at ${dir}: run node scripts/sync-upstream.mjs first`)
  if (!force && engineStatus({}, dir).ok) return { built: false, how: 'venv already matches the engine files' }
  if (installingElsewhere(dir)) return { built: false, how: 'another build is running' }
  const marker = join(dir, INSTALLING_FILE)
  writeFileSync(marker, `${process.pid}\n`)
  try {
    const venv = join(dir, '.venv')
    rmSync(venv, { recursive: true, force: true })
    rmSync(join(dir, STAMP_FILE), { force: true })
    const uv = process.env.UV?.trim() || which(['uv'])
    if (uv) {
      await sh(uv, ['venv', '--clear', venv], dir, quiet)
      await sh(uv, ['pip', 'install', '--python', venvPython(dir), dir], dir, quiet)
    } else {
      const python = process.env.ACADEMIC_HARNESS_PYTHON?.trim() || which(['python3', 'python']) || 'python3'
      await sh(python, ['-m', 'venv', '--clear', venv], dir, quiet)
      await sh(venvPython(dir), ['-m', 'pip', 'install', dir], dir, quiet)
    }
    if (!existsSync(venvBin(dir)) && !existsSync(venvPython(dir))) throw new Error('the virtual environment was created but has no python')
    // upstream's installer stamp, so a run without ACADEMIC_HARNESS_SKIP_INSTALL does not rebuild it
    const read = f => { try { return readFileSync(f, 'utf8') } catch { return '' } }
    const version = /^version\s*=\s*"([^"]+)"/m.exec(read(join(dir, 'pyproject.toml')))?.[1] ?? '0.1.0'
    const rev = /BUNDLE_REV\s*=\s*'([^']+)'/.exec(read(join(upstream, 'academic-harness-cli.js')))?.[1]
    if (rev) writeFileSync(join(dir, 'installed-version'), `${version}+${rev}\n`)
    writeFileSync(join(dir, STAMP_FILE), `${engineHash(dir)}\n`)
    return { built: true, how: uv ? 'uv' : 'venv+pip' }
  } finally {
    rmSync(marker, { force: true })
  }
}
