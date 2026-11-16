// The first start of an installed copy of the plugin (or of a clone nobody ran `scripts/setup.mjs` in): the snapshot of Academic Harness is
// not part of the repository, so the server fetches the commit in UPSTREAM.lock.json into <home>/upstream/<sha> (outside the plugin folder,
// which an update replaces), checks it against the digest in the lock, and runs `npm ci` there. The writing engine builds itself afterwards, as
// it always has (engine-install.mjs). While this runs the server answers with its `doctor` tool alone; when it is done the full tool list
// follows (late-host.mjs, then tools/list_changed).
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { sync } from '../../scripts/sync-upstream.mjs'
import { claim, clearState, readState, writeState } from './bootstrap-state.mjs'
import { modHome, modRoot, upstreamDir } from './paths.mjs'
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

