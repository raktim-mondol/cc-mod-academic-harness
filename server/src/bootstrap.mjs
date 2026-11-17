// The first start of an installed copy of the plugin (or of a clone nobody ran `scripts/setup.mjs` in): the plugin's core (core/) is copied to
// <home>/core/<id> (outside the plugin folder, which an update replaces) and `npm ci` runs there. The writing engine builds itself afterwards
// (engine-install.mjs). Nothing is fetched: the source is in the plugin. While this runs the server answers with its `doctor` tool alone; when it
// is done the full tool list follows (late-host.mjs, then tools/list_changed).
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cp, readdir, rename, rm, stat, utimes } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { claim, clearState, readState, stateFile, writeState } from './bootstrap-state.mjs'
import { runDetached } from './detached.mjs'
import { bundledCoreDir, coreDir, coreId, isDevMode, modHome, modRoot, workingCoreDir } from './paths.mjs'

/** Written last: a copy without it was cut short and is made again. */
export const READY = '.ah-core-ready'

const STAMP = '.ah-lock-sha256'

/** `npm ci --omit=dev` in `dir`, unless its package-lock.json is the one already installed. Asynchronous: the server keeps answering meanwhile. */
export async function installDependencies(dir) {
  const lockFile = join(dir, 'package-lock.json')
  if (!existsSync(lockFile)) throw new Error(`${lockFile} is missing`)
  const want = createHash('sha256').update(readFileSync(lockFile)).digest('hex')
  const stamp = join(dir, 'node_modules', STAMP)
  if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === want && existsSync(join(dir, 'node_modules', 'ah-dsh-tools'))) return { installed: false }
  await new Promise((resolve, reject) => {
    const child = spawn('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr.on('data', d => { err += d })
    child.on('error', reject)
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`npm ci failed (exit ${code}): ${err.trim().split('\n').slice(-2).join(' ').slice(0, 200)}`))))
  })
  writeFileSync(stamp, `${want}\n`)
  return { installed: true }
}

/** Wait for another server's fetch to end. Resolves when its state is gone or has failed; rejects after `timeoutMs`. */
async function waitForOther(env, timeoutMs, every = 2000) {
  const end = Date.now() + timeoutMs
  for (;;) {
    const s = readState(env)
    if (!s || s.error || s.pid === process.pid) return
    if (Date.now() > end) throw new Error('another academic-harness server has been fetching the source for too long')
    await new Promise(r => setTimeout(r, every))
  }
}

/** Copy the core to `dir` through a staging folder, so a copy that was cut short is never taken for a whole one. Never copies what an install generated. */
export async function copyCore(from, dir, id) {
  const staging = `${dir}.staging`
  await rm(staging, { recursive: true, force: true })
  await cp(from, staging, { recursive: true, filter: source => !/(^|\/)(node_modules|\.venv|__pycache__)$/.test(source) })
  writeFileSync(join(staging, READY), `${id}\n`)
  await rm(dir, { recursive: true, force: true })
  await rename(staging, dir)
}

const isReady = (dir, id) => { try { return readFileSync(join(dir, READY), 'utf8').trim() === id } catch { return false } }

/**
 * Make the core at `coreDir()` exist and have its dependencies: copy the plugin's core there when it is not already, then `npm ci`. `install` and
 * `waitMs` are seams for tests. Resolves `{ dir, copied, installed }`; rejects with the reason, which is also left in the state file for the doctor.
 */
export async function bootstrap({ env = process.env, root = modRoot(), install = installDependencies, waitMs = 15 * 60_000 } = {}) {
  // The copy replaces the folder it copies into. With AH_CORE that folder is somebody's own, and is only ever read.
  if (isDevMode(env)) throw new Error('AH_CORE is set (development mode): the core is a folder of your own, and nothing is copied into it')
  const from = bundledCoreDir(root)
  if (!existsSync(join(from, 'package.json'))) throw new Error(`${from} is missing: this is not the plugin's folder`)
  const dir = coreDir(env, root)
  const id = coreId(root)
  // A clone that was set up runs its own core in place: its dependencies are there already.
  const inPlace = resolve(dir) === resolve(from)
  // Another server (the PaperMemory launcher starts at the same time) may already be copying: wait for it, then see whether it finished.
  let step = 'checking the core'
  if (!claim({ pid: process.pid, step, startedAt: Date.now() }, env)) {
    await waitForOther(env, waitMs)
    if ((inPlace || isReady(dir, id)) && existsSync(join(dir, 'node_modules', 'ah-dsh-tools'))) return { dir, copied: false, installed: false }
    if (!claim({ pid: process.pid, step, startedAt: Date.now() }, env)) throw new Error('another academic-harness server is setting up the core and did not finish')
  }
  try {
    let copied = false
    if (!inPlace && !isReady(dir, id)) {
      step = 'copying the core'
      writeState({ pid: process.pid, step, startedAt: Date.now() }, env)
      await copyCore(from, dir, id)
      copied = true
    }
    step = 'installing the tool dependencies (npm ci)'
    writeState({ pid: process.pid, step, startedAt: Date.now() }, env)
    const { installed } = await install(dir)
    clearState(env)
    return { dir, copied, installed }
  } catch (error) {
    writeState({ pid: process.pid, step, startedAt: Date.now(), error: String(error?.message ?? error).split('\n')[0] }, env)
    throw error
  }
}

const WORKER = fileURLToPath(new URL('../bin/ah-bootstrap.mjs', import.meta.url))

/**
 * `bootstrap`, run by a detached process (server/bin/ah-bootstrap.mjs), so that it goes on when this server is ended. A session can be over in
 * seconds (`claude -p`), which is less than the download takes: a fetch that lives in the server would be cut short by every such session and
 * never finish. The next server to start finds the worker still going (the state file names its pid), starts one of its own that waits for it,
 * and gets the core when it is there.
 *
 * The state file is written here, in the worker's name, as soon as it is started: the doctor is asked within milliseconds of a first start, before
 * the worker has run a line, and must already say that the core is being set up. The worker takes the file over as its own.
 *
 * When the worker ends, `bootstrap` is run here too: after a success it only confirms the core (nothing is copied twice); after a failure
 * it tries once more in this process and so gives the real reason. `worker` and `run` are seams for tests. Resolves what `bootstrap` resolves.
 */
export async function bootstrapInWorker({ env = process.env, worker = WORKER, run = bootstrap } = {}) {
  let pid = null
  await runDetached(worker, {
    env,
    onStart(p) { pid = p; claim({ pid: p, step: 'starting the setup of the core', startedAt: Date.now() }, env) },
  })
  // A worker that ended without a word (it could not start) leaves the file written for it above: clear it, or it reads as a setup that died.
  try { const s = JSON.parse(readFileSync(stateFile(env), 'utf8')); if (s.pid === pid && !s.error) clearState(env) } catch { /* no file: nothing to clear */ }
  return run({ env })
}


export const DEFAULT_SNAPSHOT_KEEP_DAYS = 7

/**
 * Remove the working copies in <home>/core/ that an update left behind: every folder other than the one for this core and the one in use, that
 * has not been used for `keepDays` days (AH_SNAPSHOT_KEEP_DAYS; 0 keeps them all). Each is about 170 MB with its dependencies and the engine's
 * environment. A server that runs from its folder marks it used when it starts, so a session of an older plugin version that is still open is
 * not cut from under it; an interrupted copy's staging folder goes the same way. The folder <home>/upstream/, where releases before 0.6.0 put
 * the snapshot they fetched from GitHub, goes the same way. Asynchronous, so a start does not wait for it. Resolves the names removed. Never throws.
 */
export async function pruneOldSnapshots({ env = process.env, root = modRoot(), keepDays, now = Date.now() } = {}) {
  try {
    if (isDevMode(env)) return []
    const raw = env.AH_SNAPSHOT_KEEP_DAYS?.trim()
    const days = keepDays ?? (raw !== undefined && raw !== '' && Number(raw) >= 0 ? Number(raw) : DEFAULT_SNAPSHOT_KEEP_DAYS)
    if (!(days > 0)) return []
    const current = resolve(workingCoreDir(env, root))
    const inUse = resolve(coreDir(env, root))
    if (inUse === current) { const t = new Date(now); await utimes(current, t, t).catch(() => {}) }
    const cutoff = now - days * 24 * 60 * 60 * 1000
    const removed = []
    for (const base of [join(modHome(env), 'core'), join(modHome(env), 'upstream')]) {
      for (const entry of await readdir(base, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory()) continue
        const path = resolve(base, entry.name)
        if (path === current || path === inUse) continue
        const { mtimeMs } = await stat(path)
        if (mtimeMs >= cutoff) continue
        await rm(path, { recursive: true, force: true })
        removed.push(entry.name)
      }
    }
    return removed
  } catch {
    return []
  }
}
