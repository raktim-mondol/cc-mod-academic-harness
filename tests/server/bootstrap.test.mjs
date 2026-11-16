// The first start of an installed copy: where the snapshot is looked for, the fetch (with a throw-away repository standing in for GitHub and a stand-in
// for npm), two servers starting together, the doctor's view of it, and a host that is swapped for the full one while the server is running.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { after, before, describe, test } from 'node:test'
import { sync } from '../../scripts/sync-upstream.mjs'
import { bootstrap } from '../../server/src/bootstrap.mjs'
import { claim, clearState, readState, stateFile, writeState } from '../../server/src/bootstrap-state.mjs'
import { Registry } from '../../server/src/context.mjs'
import { diagnose } from '../../server/src/doctor.mjs'
import { hostOver, serve } from '../../server/src/host.mjs'
import { lateHost } from '../../server/src/late-host.mjs'
import { fetchedUpstreamDir, upstreamDir } from '../../server/src/paths.mjs'
import { checkSnapshot } from '../../server/src/snapshot.mjs'

const scratch = join(homedir(), '.cache', 'ah-test-homes')
mkdirSync(scratch, { recursive: true })
const root = mkdtempSync(join(scratch, 'boot-'))
after(() => rmSync(root, { recursive: true, force: true }))

const src = join(root, 'src-repo')
const git = (...args) => execFileSync('git', ['-C', src, ...args], { encoding: 'utf8' })
let sha
let lockText
const plugin = join(root, 'plugin') // an installed copy: a lock, and no upstream/

/** What GitHub serves for the commit: a tar.gz under one top-level folder. */
const tarball = async (_url, file) => {
  const tar = execFileSync('git', ['-C', src, 'archive', '--format=tar', `--prefix=academic-harness-${sha}/`, sha], { maxBuffer: 1 << 28 })
  writeFileSync(file, execFileSync('gzip', ['-c'], { input: tar, maxBuffer: 1 << 28 }))
}
const envFor = name => ({ AH_MOD_HOME: join(root, name) })

before(async () => {
  mkdirSync(join(src, 'vendor', 'academic-harness'), { recursive: true })
  execFileSync('git', ['init', '-q', src])
  git('config', 'user.email', 't@example.invalid')
  git('config', 'user.name', 't')
  writeFileSync(join(src, 'package.json'), '{"name":"x","version":"3.1.4"}')
  writeFileSync(join(src, 'package-lock.json'), '{"lockfileVersion":3}')
  writeFileSync(join(src, 'index.js'), 'export const a = 1\n')
  writeFileSync(join(src, 'vendor', 'academic-harness', 'pyproject.toml'), '[project]\nname = "x"\n')
  git('add', '-A')
  git('commit', '-qm', 'one')
  sha = git('rev-parse', 'HEAD').trim()
  // the lock a release would carry: made by a sync from the repository
  const lock = await sync({ source: src, commit: sha, outDir: join(root, 'reference'), lockFile: join(root, 'reference.lock.json') })
  mkdirSync(plugin, { recursive: true })
  lockText = `${JSON.stringify(lock, null, 2)}\n`
  writeFileSync(join(plugin, 'UPSTREAM.lock.json'), lockText)
})

describe('where the snapshot is', () => {
  test('a set-up clone first, then the folder in the mod\'s home named for the commit; AH_UPSTREAM beats both', () => {
    const env = envFor('home-paths')
    const clone = join(root, 'clone')
    mkdirSync(plugin, { recursive: true })
    assert.equal(upstreamDir(env, plugin), join(root, 'home-paths', 'upstream', sha.slice(0, 12)))
    assert.equal(fetchedUpstreamDir(env, plugin), join(root, 'home-paths', 'upstream', sha.slice(0, 12)))
    mkdirSync(join(clone, 'upstream'), { recursive: true })
    writeFileSync(join(clone, 'upstream', 'package.json'), '{}')
    assert.equal(upstreamDir(env, clone), join(clone, 'upstream'))
    assert.equal(upstreamDir({ ...env, AH_UPSTREAM: '/a/checkout' }, clone), '/a/checkout')
    assert.equal(upstreamDir(env, join(root, 'no-lock')), join(root, 'home-paths', 'upstream', 'unlocked'))
  })
})

describe('the state file', () => {
  test('a live process holds it; a dead one, a failure and our own are taken over', () => {
    const env = envFor('home-state')
    assert.equal(readState(env), null)
    assert.equal(claim({ pid: process.pid, step: 'a', startedAt: 1 }, env), true)
    assert.equal(readState(env).step, 'a')
    writeState({ pid: process.ppid, step: 'b', startedAt: 1 }, env)
    assert.equal(claim({ pid: process.pid, step: 'c', startedAt: 2 }, env), false, 'a live parent process holds it')
    writeState({ pid: 2 ** 22 + 12345, step: 'dead', startedAt: 1 }, env)
    assert.equal(readState(env), null, 'a dead process with no error is stale')
    assert.equal(claim({ pid: process.pid, step: 'd', startedAt: 3 }, env), true)
    writeState({ pid: process.ppid, step: 'failed here', startedAt: 1, error: 'boom' }, env)
    assert.equal(readState(env).error, 'boom')
    assert.equal(claim({ pid: process.pid, step: 'e', startedAt: 4 }, env), true, 'a failed fetch is retried')
    clearState(env)
    assert.equal(existsSync(stateFile(env)), false)
  })
})

describe('the fetch', () => {
  test('downloads the locked commit into the home, checks it against the lock, installs dependencies, and clears its state', async () => {
    const env = envFor('home-a')
    const installed = []
    const r = await bootstrap({ env, root: plugin, fetchTarball: tarball, install: async dir => { installed.push(dir); return { installed: true } } })
    assert.equal(r.dir, join(root, 'home-a', 'upstream', sha.slice(0, 12)))
    assert.equal(r.fetched, true)
    assert.deepEqual(installed, [r.dir])
    assert.equal(checkSnapshot(r.dir, JSON.parse(lockText)).state, 'ok')
    assert.equal(readState(env), null)
    assert.equal(readFileSync(join(plugin, 'UPSTREAM.lock.json'), 'utf8'), lockText, 'the plugin\'s own lock is not rewritten')
    assert.equal(existsSync(join(root, 'home-a', 'bootstrap-lock.json')), false)
  })
  test('a second start finds it there and fetches nothing', async () => {
    const env = envFor('home-a')
    let downloads = 0
    const r = await bootstrap({ env, root: plugin, fetchTarball: async (u, f) => { downloads++; return tarball(u, f) }, install: async () => ({ installed: false }) })
    assert.equal(r.fetched, false)
    assert.equal(downloads, 0)
  })
  test('a download that is not the locked bytes is refused, and the reason is left for the doctor', async () => {
    const env = envFor('home-b')
    const other = join(root, 'other-plugin')
    mkdirSync(other, { recursive: true })
    writeFileSync(join(other, 'UPSTREAM.lock.json'), JSON.stringify({ ...JSON.parse(lockText), treeSha256: '0'.repeat(64) }))
    await assert.rejects(bootstrap({ env, root: other, fetchTarball: tarball, install: async () => ({}) }), /does not match the lock/)
    const s = readState(env)
    assert.match(s.error, /does not match the lock/)
    assert.match(s.step, /fetching Academic Harness 3\.1\.4/)
    const report = await diagnose({ env, root: other, upstream: upstreamDir(env, other), home: join(root, 'home-b') })
    const snap = report.checks.find(c => c.id === 'snapshot')
    assert.equal(snap.state, 'missing')
    assert.match(snap.detail, /first-start fetch failed at "fetching Academic Harness 3\.1\.4/)
  })
  test('a failed download is retried by the next start', async () => {
    const env = envFor('home-c')
    await assert.rejects(bootstrap({ env, root: plugin, fetchTarball: async () => { throw new Error('HTTP 503') }, install: async () => ({}) }), /HTTP 503/)
    assert.match(readState(env).error, /HTTP 503/)
    const r = await bootstrap({ env, root: plugin, fetchTarball: tarball, install: async () => ({ installed: true }) })
    assert.equal(r.fetched, true)
    assert.equal(readState(env), null)
  })
  test('a failing install is reported and leaves its step in the state', async () => {
    const env = envFor('home-d')
    await assert.rejects(bootstrap({ env, root: plugin, fetchTarball: tarball, install: async () => { throw new Error('npm ci failed (exit 1)') } }), /npm ci failed/)
    assert.match(readState(env).step, /installing the tool dependencies/)
  })
  test('while another server is fetching this one waits, and uses what it fetched', async () => {
    const env = envFor('home-e')
    const first = await bootstrap({ env, root: plugin, fetchTarball: tarball, install: async dir => { mkdirSync(join(dir, 'node_modules', 'ah-dsh-tools'), { recursive: true }); return { installed: true } } })
    writeState({ pid: process.ppid, step: 'fetching', startedAt: Date.now() }, env)
    setTimeout(() => clearState(env), 150)
    const second = await bootstrap({ env, root: plugin, fetchTarball: async () => { throw new Error('must not download again') }, install: async () => ({ installed: false }), waitMs: 5000 })
    assert.deepEqual([second.dir, second.fetched], [first.dir, false])
  })
  test('an other server that never finishes is not waited for for ever', async () => {
    const env = envFor('home-f')
    writeState({ pid: process.ppid, step: 'fetching', startedAt: Date.now() }, env)
    await assert.rejects(bootstrap({ env, root: plugin, fetchTarball: tarball, install: async () => ({}), waitMs: 100 }), /too long/)
  })
  test('the doctor says it is being set up while the state is live', async () => {
    const env = envFor('home-g')
    writeState({ pid: process.pid, step: 'installing the tool dependencies (npm ci)', startedAt: Date.now() - 12_000 }, env)
    const report = await diagnose({ env, root: plugin, upstream: join(root, 'nothing-here'), home: join(root, 'home-g') })
    const snap = report.checks.find(c => c.id === 'snapshot')
    assert.equal(snap.state, 'info')
    assert.match(snap.detail, /being set up by the server \(started 1\d s ago\): installing the tool dependencies/)
  })
})

describe('a host that is swapped while the server runs', () => {
  function serverOver(first) {
    const late = lateHost(first)
    const input = new PassThrough()
    const output = new PassThrough()
    const lines = []
    const waiting = new Map()
    let buf = ''
    output.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); lines.push(m); if (m.id !== undefined) waiting.get(m.id)?.(m) } })
    const done = serve({ host: late, input, output })
    let n = 0
    // the waiter is registered before the write: initialize is answered synchronously
    const send = (method, params) => { const id = ++n; const reply = new Promise(r => waiting.set(id, r)); input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); return reply }
    const notify = (method, params) => input.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
    return { late, lines, send, notify, end: async () => { input.end(); await done } }
  }
  const hostWith = (names, env = {}) => {
    const registry = new Registry()
    for (const name of names) registry.register({ name, description: '', parameters: {}, execute: async () => `from ${name}` })
    return hostOver(registry, { env: { CLAUDE_CODE_SESSION_ID: 's', ...env }, cwd: scratch })
  }

  test('the doctor alone first, then the full list and a list_changed notice; the session folder and start are handed over', async () => {
    const first = hostWith([])
    let started = 0
    let folder
    const full = hostWith(['literature_search', 'paper_get'])
    full.start = () => { started++ }
    full.setCwd = dir => { folder = dir }
    const s = serverOver(first)
    await s.send('initialize', { capabilities: {} })
    s.notify('notifications/initialized')
    await new Promise(r => setTimeout(r, 30))
    assert.deepEqual((await s.send('tools/list')).result.tools.map(t => t.name), ['doctor'])
    s.late.setCwd('/the/session')
    s.late.swap(full)
    await new Promise(r => setTimeout(r, 30))
    assert.ok(s.lines.some(l => l.method === 'notifications/tools/list_changed'), 'the client is told the list changed')
    assert.deepEqual((await s.send('tools/list')).result.tools.map(t => t.name).sort(), ['doctor', 'literature_search', 'paper_get'])
    assert.equal(folder, '/the/session')
    assert.equal(started, 1)
    const call = await s.send('tools/call', { name: 'paper_get', arguments: {} })
    assert.equal(call.result.content[0].text, 'from paper_get')
    await s.end()
  })
  test('a swap before the client has said anything starts nothing early', async () => {
    const first = hostWith([])
    const full = hostWith(['a'])
    let started = 0
    full.start = () => { started++ }
    const late = lateHost(first)
    late.swap(full)
    assert.equal(started, 0)
    late.start()
    assert.equal(started, 1)
    assert.deepEqual(late.list().map(t => t.name).sort(), ['a', 'doctor'])
  })
})
