// The first start of an installed copy of the plugin (or of a clone nobody ran `scripts/setup.mjs` in): the snapshot of Academic Harness is
// not part of the repository, so the server fetches the commit in UPSTREAM.lock.json into <home>/upstream/<sha> (outside the plugin folder,
// which an update replaces), checks it against the digest in the lock, and runs `npm ci` there. The writing engine builds itself afterwards, as
// it always has (engine-install.mjs). While this runs the server answers with its `doctor` tool alone; when it is done the full tool list
// follows (late-host.mjs, then tools/list_changed).
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readdir, rm, stat, utimes } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sync } from '../../scripts/sync-upstream.mjs'
import { claim, clearState, readState, stateFile, writeState } from './bootstrap-state.mjs'
import { runDetached } from './detached.mjs'
import { fetchedUpstreamDir, isDevMode, modHome, modRoot, upstreamDir } from './paths.mjs'
import { checkSnapshot } from './snapshot.mjs'

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

/**
 * Make the snapshot at `upstreamDir()` exist, match the lock, and have its dependencies. `fetchTarball`, `install` and `waitMs` are seams for tests.
 * Resolves `{ dir, fetched, installed }`; rejects with the reason, which is also left in the state file for the doctor.
 */
export async function bootstrap({ env = process.env, root = modRoot(), fetchTarball, install = installDependencies, waitMs = 15 * 60_000 } = {}) {
  // The fetch replaces the folder it fetches into. With AH_UPSTREAM that folder is a source checkout, which is only ever read.
  if (isDevMode(env)) throw new Error('AH_UPSTREAM is set (development mode): the snapshot is a checkout, and nothing is fetched into a checkout')
  const lockPath = join(root, 'UPSTREAM.lock.json')
  if (!existsSync(lockPath)) throw new Error('UPSTREAM.lock.json is missing: this is not the plugin\'s folder')
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  const dir = upstreamDir(env, root)
  // Another server (the PaperMemory launcher starts at the same time) may already be fetching: wait for it, then see whether it finished.
  let step = 'checking the source snapshot'
  if (!claim({ pid: process.pid, step, startedAt: Date.now() }, env)) {
    await waitForOther(env, waitMs)
    const after = checkSnapshot(dir, lock)
    if (after.state === 'ok' && existsSync(join(dir, 'node_modules', 'ah-dsh-tools'))) return { dir, fetched: false, installed: false }
    if (!claim({ pid: process.pid, step, startedAt: Date.now() }, env)) throw new Error('another academic-harness server is fetching the source and did not finish')
  }
  try {
    const held = checkSnapshot(dir, lock)
    let fetched = false
    if (held.state !== 'ok') {
      step = `fetching Academic Harness ${lock.version} (${lock.commit.slice(0, 7)}) from GitHub`
      writeState({ pid: process.pid, step, startedAt: Date.now() }, env)
      // sync verifies a download against the lock it is given, and rewrites that lock: give it a copy, so the plugin's own is never touched
      const scratch = join(modHome(env), 'bootstrap-lock.json')
      mkdirSync(modHome(env), { recursive: true })
      copyFileSync(lockPath, scratch)
      rmSync(dir, { recursive: true, force: true })
      await sync({ source: '/none', commit: lock.commit, github: true, outDir: dir, lockFile: scratch, fetchTarball })
      rmSync(scratch, { force: true })
      fetched = true
    }
    step = 'installing the tool dependencies (npm ci)'
    writeState({ pid: process.pid, step, startedAt: Date.now() }, env)
    const { installed } = await install(dir)
    clearState(env)
    return { dir, fetched, installed }
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
 * and gets the snapshot when it is there.
 *
 * The state file is written here, in the worker's name, as soon as it is started: the doctor is asked within milliseconds of a first start, before
 * the worker has run a line, and must already say that the snapshot is being set up. The worker takes the file over as its own.
 *
 * When the worker ends, `bootstrap` is run here too: after a success it only confirms the snapshot (nothing is fetched twice); after a failure
 * it tries once more in this process and so gives the real reason. `worker` and `run` are seams for tests. Resolves what `bootstrap` resolves.
 */
export async function bootstrapInWorker({ env = process.env, worker = WORKER, run = bootstrap } = {}) {
  let pid = null
  await runDetached(worker, {
    env,
    onStart(p) { pid = p; claim({ pid: p, step: 'starting the fetch of the source snapshot', startedAt: Date.now() }, env) },
  })
  // A worker that ended without a word (it could not start) leaves the file written for it above: clear it, or it reads as a fetch that died.
  try { const s = JSON.parse(readFileSync(stateFile(env), 'utf8')); if (s.pid === pid && !s.error) clearState(env) } catch { /* no file: nothing to clear */ }
  return run({ env })
}


export const DEFAULT_SNAPSHOT_KEEP_DAYS = 7

/**
 * Remove the snapshots in <home>/upstream/ that an update left behind: every folder other than the one for the locked commit and the one in
 * use, that has not been used for `keepDays` days (AH_SNAPSHOT_KEEP_DAYS; 0 keeps them all). Each is about 170 MB with its dependencies and the
 * engine's environment. A server that runs from its folder marks it used when it starts, so a session of an older plugin version that is
 * still open is not cut from under it; an interrupted fetch's staging folder goes the same way. Asynchronous, so a start does not wait for it.
 * Resolves the names removed. Never throws.
 */
export async function pruneOldSnapshots({ env = process.env, root = modRoot(), keepDays, now = Date.now() } = {}) {
  try {
    if (isDevMode(env)) return []
    const raw = env.AH_SNAPSHOT_KEEP_DAYS?.trim()
    const days = keepDays ?? (raw !== undefined && raw !== '' && Number(raw) >= 0 ? Number(raw) : DEFAULT_SNAPSHOT_KEEP_DAYS)
    if (!(days > 0)) return []
    const base = join(modHome(env), 'upstream')
    const locked = resolve(fetchedUpstreamDir(env, root))
    const inUse = resolve(upstreamDir(env, root))
    if (inUse === locked) { const t = new Date(now); await utimes(locked, t, t).catch(() => {}) }
    const cutoff = now - days * 24 * 60 * 60 * 1000
    const removed = []
    for (const entry of await readdir(base, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue
      const path = resolve(base, entry.name)
      if (path === locked || path === inUse) continue
      const { mtimeMs } = await stat(path)
      if (mtimeMs >= cutoff) continue
      await rm(path, { recursive: true, force: true })
      removed.push(entry.name)
    }
    return removed
  } catch {
    return []
  }
}
