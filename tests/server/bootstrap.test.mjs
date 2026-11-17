// The first start of an installed copy: where the core is looked for, the copy of the plugin's core into the mod's home (with a stand-in for npm),
// two servers starting together, the doctor's view of it, and a host that is swapped for the full one while the server is running.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { bootstrap, bootstrapInWorker, pruneOldSnapshots, READY } from '../../server/src/bootstrap.mjs'
import { claim, clearState, readState, stateFile, writeState } from '../../server/src/bootstrap-state.mjs'
import { Registry } from '../../server/src/context.mjs'
import { diagnose } from '../../server/src/doctor.mjs'
import { hostOver, serve } from '../../server/src/host.mjs'
import { lateHost } from '../../server/src/late-host.mjs'
import { coreDir, coreId, workingCoreDir } from '../../server/src/paths.mjs'

const scratch = join(homedir(), '.cache', 'ah-test-homes')
mkdirSync(scratch, { recursive: true })
const root = mkdtempSync(join(scratch, 'boot-'))
after(() => rmSync(root, { recursive: true, force: true }))

const envFor = name => ({ AH_MOD_HOME: join(root, name) })

/** A plugin folder as an installed copy has it: a manifest and a core. The core holds what an install generates too, which a copy must leave behind. */
function makePlugin(name, version = '1.0.0') {
  const plugin = join(root, name)
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true })
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'x', version }))
  const core = join(plugin, 'core')
  mkdirSync(join(core, 'vendor', 'academic-harness', '.venv', 'bin'), { recursive: true })
  mkdirSync(join(core, 'node_modules', 'left-behind'), { recursive: true })
  mkdirSync(join(core, 'skills', 'one'), { recursive: true })
  writeFileSync(join(core, 'package.json'), '{"name":"x","version":"3.1.4"}')
  writeFileSync(join(core, 'package-lock.json'), '{"lockfileVersion":3}')
  writeFileSync(join(core, 'index.js'), 'export const a = 1\n')
  writeFileSync(join(core, 'skills', 'one', 'SKILL.md'), '# one\n')
  writeFileSync(join(core, 'vendor', 'academic-harness', 'pyproject.toml'), '[project]\nname = "x"\n')
  writeFileSync(join(core, 'vendor', 'academic-harness', '.venv', 'bin', 'python'), 'not a python')
  writeFileSync(join(core, 'node_modules', 'left-behind', 'index.js'), 'x')
  return plugin
}
const plugin = makePlugin('plugin') // an installed copy: a core with nothing installed in it

describe('where the core is', () => {
  test('a set-up clone first, then the folder in the mod\'s home named for the plugin\'s core; AH_CORE beats both', () => {
    const env = envFor('home-paths')
    const clone = makePlugin('clone')
    const id = coreId(plugin)
    assert.match(id, /^1\.0\.0-[0-9a-f]{10}$/)
    assert.equal(coreDir(env, plugin), join(root, 'home-paths', 'core', id))
    assert.equal(workingCoreDir(env, plugin), join(root, 'home-paths', 'core', id))
    mkdirSync(join(clone, 'core', 'node_modules', 'ah-dsh-tools'), { recursive: true })
    assert.equal(coreDir(env, clone), join(clone, 'core'), 'dependencies installed in place: it runs where it is')
    assert.equal(coreDir({ ...env, AH_CORE: '/a/folder' }, clone), '/a/folder')
  })
  test('the name changes when the plugin\'s version or one of its core\'s files does, and not otherwise', () => {
    const one = makePlugin('id-one')
    const same = makePlugin('id-same')
    const newer = makePlugin('id-newer', '1.1.0')
    const edited = makePlugin('id-edited')
    writeFileSync(join(edited, 'core', 'index.js'), 'export const a = 22222\n')
    const added = makePlugin('id-added')
    writeFileSync(join(added, 'core', 'skills', 'one', 'extra.md'), 'x')
    assert.equal(coreId(one).split('-')[1], coreId(same).split('-')[1], 'the same files, the same fingerprint')
    assert.notEqual(coreId(newer), coreId(one))
    assert.notEqual(coreId(edited), coreId(one))
    assert.notEqual(coreId(added), coreId(one))
  })
  test('what an install generates is not part of the name: a clone that was set up is the same core', () => {
    const a = makePlugin('gen-a')
    const b = makePlugin('gen-b')
    mkdirSync(join(b, 'core', 'node_modules', 'more'), { recursive: true })
    writeFileSync(join(b, 'core', 'node_modules', 'more', 'x.js'), 'x')
    writeFileSync(join(b, 'core', 'vendor', 'academic-harness', 'installed-version'), '1\n')
    assert.equal(coreId(a).split('-')[1], coreId(b).split('-')[1])
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
    assert.equal(claim({ pid: process.pid, step: 'e', startedAt: 4 }, env), true, 'a failed setup is retried')
    clearState(env)
    assert.equal(existsSync(stateFile(env)), false)
  })
})

describe('the copy', () => {
  test('copies the plugin\'s core into the home without what an install generates, installs dependencies there, and clears its state', async () => {
    const env = envFor('home-a')
    const installed = []
    const r = await bootstrap({ env, root: plugin, install: async dir => { installed.push(dir); return { installed: true } } })
    assert.equal(r.dir, join(root, 'home-a', 'core', coreId(plugin)))
    assert.equal(r.copied, true)
    assert.deepEqual(installed, [r.dir])
    assert.equal(readFileSync(join(r.dir, 'index.js'), 'utf8'), 'export const a = 1\n')
    assert.equal(readFileSync(join(r.dir, 'skills', 'one', 'SKILL.md'), 'utf8'), '# one\n')
    assert.ok(existsSync(join(r.dir, 'vendor', 'academic-harness', 'pyproject.toml')))
    assert.equal(existsSync(join(r.dir, 'node_modules')), false, 'a dependency folder is never copied: it is installed')
    assert.equal(existsSync(join(r.dir, 'vendor', 'academic-harness', '.venv')), false, 'neither is a virtual environment, which cannot be moved')
    assert.equal(readFileSync(join(r.dir, READY), 'utf8').trim(), coreId(plugin))
    assert.equal(existsSync(`${r.dir}.staging`), false)
    assert.equal(readState(env), null)
    assert.ok(existsSync(join(plugin, 'core', 'node_modules', 'left-behind')), 'the plugin\'s own core is untouched')
  })
  test('a second start finds it there and copies nothing', async () => {
    const env = envFor('home-a')
    const dir = workingCoreDir(env, plugin)
    writeFileSync(join(dir, 'index.js'), 'changed in the copy')
    const r = await bootstrap({ env, root: plugin, install: async () => ({ installed: false }) })
    assert.equal(r.copied, false)
    assert.equal(readFileSync(join(dir, 'index.js'), 'utf8'), 'changed in the copy', 'a copy that is whole is left as it is')
  })
  test('a copy that was cut short is made again, and a staging folder left by one is cleared', async () => {
    const env = envFor('home-cut')
    const dir = workingCoreDir(env, plugin)
    mkdirSync(`${dir}.staging`, { recursive: true })
    writeFileSync(join(`${dir}.staging`, 'half'), 'x')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), '{"name":"x","version":"0.0.1"}') // no READY: not a whole copy
    const r = await bootstrap({ env, root: plugin, install: async () => ({ installed: true }) })
    assert.equal(r.copied, true)
    assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version, '3.1.4')
    assert.equal(existsSync(`${dir}.staging`), false)
    assert.ok(existsSync(join(dir, READY)))
  })
  test('a plugin folder without its core is refused, and the reason is left for the doctor', async () => {
    const env = envFor('home-b')
    const bare = join(root, 'bare-plugin')
    mkdirSync(bare, { recursive: true })
    await assert.rejects(bootstrap({ env, root: bare, install: async () => ({}) }), /is missing: this is not the plugin's folder/)
    const report = await diagnose({ env, root: bare, core: coreDir(env, bare), home: join(root, 'home-b') })
    assert.equal(report.checks.find(c => c.id === 'snapshot').state, 'missing')
  })
  test('a clone that was set up runs its own core in place: nothing is copied, and dependencies are checked there', async () => {
    const env = envFor('home-inplace')
    const clone = makePlugin('clone-inplace')
    mkdirSync(join(clone, 'core', 'node_modules', 'ah-dsh-tools'), { recursive: true })
    const seen = []
    const r = await bootstrap({ env, root: clone, install: async dir => { seen.push(dir); return { installed: false } } })
    assert.equal(r.dir, join(clone, 'core'))
    assert.equal(r.copied, false)
    assert.deepEqual(seen, [join(clone, 'core')])
    assert.equal(existsSync(join(root, 'home-inplace', 'core')), false)
  })
  test('a failing install is reported and leaves its step in the state; the next start copies nothing again and tries the install again', async () => {
    const env = envFor('home-d')
    await assert.rejects(bootstrap({ env, root: plugin, install: async () => { throw new Error('npm ci failed (exit 1)') } }), /npm ci failed/)
    assert.match(readState(env).step, /installing the tool dependencies/)
    assert.match(readState(env).error, /npm ci failed/)
    const again = await bootstrap({ env, root: plugin, install: async () => ({ installed: true }) })
    assert.equal(again.copied, false, 'the copy was whole')
    assert.equal(readState(env), null)
  })
  test('while another server is setting up this one waits, and uses what it made', async () => {
    const env = envFor('home-e')
    const first = await bootstrap({ env, root: plugin, install: async dir => { mkdirSync(join(dir, 'node_modules', 'ah-dsh-tools'), { recursive: true }); return { installed: true } } })
    writeState({ pid: process.ppid, step: 'copying the core', startedAt: Date.now() }, env)
    setTimeout(() => clearState(env), 150)
    const second = await bootstrap({ env, root: plugin, install: async () => { throw new Error('must not install again') }, waitMs: 5000 })
    assert.deepEqual([second.dir, second.copied], [first.dir, false])
  })
  test('an other server that never finishes is not waited for for ever', async () => {
    const env = envFor('home-f')
    writeState({ pid: process.ppid, step: 'copying the core', startedAt: Date.now() }, env)
    await assert.rejects(bootstrap({ env, root: plugin, install: async () => ({}), waitMs: 100 }), /too long/)
  })
  test('the doctor says it is being set up while the state is live', async () => {
    const env = envFor('home-g')
    writeState({ pid: process.pid, step: 'installing the tool dependencies (npm ci)', startedAt: Date.now() - 12_000 }, env)
    const report = await diagnose({ env, root: plugin, core: join(root, 'nothing-here'), home: join(root, 'home-g') })
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

describe('what the setup must never do', () => {
  test('with AH_CORE set it refuses: the folder is somebody\'s own', async () => {
    const checkout = join(root, 'a-checkout')
    mkdirSync(checkout, { recursive: true })
    writeFileSync(join(checkout, 'package.json'), '{"name":"x","version":"9.9.9"}')
    const env = { ...envFor('home-dev'), AH_CORE: checkout }
    await assert.rejects(bootstrap({ env, root: plugin, install: async () => ({}) }), /development mode/)
    assert.ok(existsSync(join(checkout, 'package.json')), 'the folder is untouched')
    assert.equal(readState(env), null, 'and no setup is recorded')
  })
})

describe('the doctor after a failed setup was repaired by hand', () => {
  test('an old setup error is not reported once the core is usable', async () => {
    const env = envFor('home-stale')
    const up = join(root, 'repaired')
    mkdirSync(join(up, 'node_modules', 'ah-dsh-tools'), { recursive: true })
    writeFileSync(join(up, 'package.json'), '{"name":"x","version":"3.1.4"}')
    writeState({ pid: 1, step: 'copying the core', startedAt: Date.now() - 60_000, error: 'ENOSPC' }, env)
    const broken = await diagnose({ env, root: plugin, core: join(root, 'not-there'), home: join(root, 'home-stale') })
    assert.match(broken.checks.find(c => c.id === 'snapshot').detail, /first-start setup failed/)
    const repaired = await diagnose({ env, root: plugin, core: up, home: join(root, 'home-stale') })
    assert.doesNotMatch(repaired.checks.find(c => c.id === 'snapshot').detail, /setup failed/)
  })
})

describe('copies an update left behind', () => {
  const day = 24 * 60 * 60 * 1000
  const made = (base, name, days) => {
    const dir = join(base, name)
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), '{"name":"x","version":"1.0.0"}')
    const t = new Date(Date.now() - days * day)
    utimesSync(dir, t, t)
    return dir
  }

  test('an old folder that is not this plugin\'s core goes; this one, the one in use and recent ones stay', async () => {
    const env = envFor('home-prune')
    const base = join(root, 'home-prune', 'core')
    const locked = workingCoreDir(env, plugin)
    mkdirSync(base, { recursive: true })
    const lockedDir = made(base, locked.split('/').pop(), 40)
    const oldDir = made(base, 'aaaaaaaaaaaa', 20)
    const staging = made(base, 'bbbbbbbbbbbb.staging', 9)
    const recentDir = made(base, 'cccccccccccc', 2)
    writeFileSync(join(base, 'a-stray-file'), 'x')
    const gone = await pruneOldSnapshots({ env, root: plugin })
    assert.deepEqual(gone.sort(), ['aaaaaaaaaaaa', 'bbbbbbbbbbbb.staging'])
    assert.equal(existsSync(oldDir), false)
    assert.equal(existsSync(staging), false, 'an interrupted copy\'s staging folder goes the same way')
    assert.equal(existsSync(recentDir), true, 'used inside the keep time')
    assert.equal(existsSync(lockedDir), true, 'this core\'s copy is never removed, however old')
    assert.ok(existsSync(join(base, 'a-stray-file')), 'only folders are considered')
    assert.ok(Date.now() - statSync(lockedDir).mtimeMs < 60_000, 'a server running from its folder marks it used')
  })

  test('the folder earlier releases fetched the snapshot into goes the same way, once it has not been used for the keep time', async () => {
    const env = envFor('home-legacy')
    const legacy = join(root, 'home-legacy', 'upstream')
    mkdirSync(legacy, { recursive: true })
    const old = made(legacy, 'a3f17eb8ae15', 30)
    const recent = made(legacy, 'b3f17eb8ae15', 1)
    assert.deepEqual(await pruneOldSnapshots({ env, root: plugin }), ['a3f17eb8ae15'])
    assert.equal(existsSync(old), false)
    assert.equal(existsSync(recent), true)
  })

  test('0 keeps everything; a development checkout and a missing folder are left alone', async () => {
    const env = envFor('home-prune-2')
    const base = join(root, 'home-prune-2', 'core')
    mkdirSync(base, { recursive: true })
    const oldDir = made(base, 'dddddddddddd', 60)
    assert.deepEqual(await pruneOldSnapshots({ env: { ...env, AH_SNAPSHOT_KEEP_DAYS: '0' }, root: plugin }), [])
    assert.deepEqual(await pruneOldSnapshots({ env: { ...env, AH_CORE: root }, root: plugin }), [])
    assert.equal(existsSync(oldDir), true)
    assert.deepEqual(await pruneOldSnapshots({ env: envFor('home-never-made'), root: plugin }), [])
    assert.deepEqual(await pruneOldSnapshots({ env: { ...env, AH_SNAPSHOT_KEEP_DAYS: '30' }, root: plugin }), ['dddddddddddd'])
  })
})

describe('the setup in a process of its own', () => {
  const dir = join(root, 'worker')
  const until = async (cond, ms = 8000) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) await new Promise(r => setTimeout(r, 50)); return cond() }
  before(() => mkdirSync(dir, { recursive: true }))

  test('the worker runs first; when it has ended the core is confirmed here, and that result is the answer', async () => {
    const mark = join(dir, 'ran')
    const worker = join(dir, 'ok.mjs')
    writeFileSync(worker, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(mark)}, process.env.AH_MOD_HOME)\n`)
    let sawMark = null
    const env = { ...process.env, AH_MOD_HOME: join(dir, 'home-ok') }
    const started = bootstrapInWorker({ env, worker, run: async ({ env }) => { sawMark = existsSync(mark); return { dir: env.AH_MOD_HOME, copied: false, installed: false } } })
    const early = readState(env)
    assert.ok(early && early.pid !== process.pid && /starting/.test(early.step), 'the state names the worker at once, for a doctor asked straight away')
    const r = await started
    assert.equal(sawMark, true, 'the worker had finished before the check ran')
    assert.equal(readFileSync(mark, 'utf8'), env.AH_MOD_HOME, 'the worker gets the server\'s environment')
    assert.deepEqual(r, { dir: env.AH_MOD_HOME, copied: false, installed: false })
    assert.equal(existsSync(stateFile(env)), false, 'a worker that left no word leaves no state behind')
  })
  test('a worker that fails, or cannot be started, leaves the work and its error to this process', async () => {
    const failing = join(dir, 'fail.mjs')
    writeFileSync(failing, 'process.exit(1)\n')
    for (const worker of [failing, join(dir, 'no-such-file.mjs')]) {
      let runs = 0
      await assert.rejects(bootstrapInWorker({ env: { ...process.env, AH_MOD_HOME: join(dir, 'home-fail') }, worker, run: async () => { runs++; throw new Error('the real reason') } }), /the real reason/)
      assert.equal(runs, 1)
    }
  })
  test('the worker goes on after the process that started it has ended', async () => {
    const mark = join(dir, 'outlived')
    const worker = join(dir, 'slow.mjs')
    writeFileSync(worker, `import { writeFileSync } from 'node:fs'\nsetTimeout(() => writeFileSync(${JSON.stringify(mark)}, 'done'), 600)\n`)
    const parent = join(dir, 'parent.mjs')
    const lib = pathToFileURL(fileURLToPath(new URL('../../server/src/bootstrap.mjs', import.meta.url))).href
    writeFileSync(parent, `import { bootstrapInWorker } from ${JSON.stringify(lib)}\nvoid bootstrapInWorker({ env: { ...process.env, AH_MOD_HOME: ${JSON.stringify(join(dir, 'home-slow'))} }, worker: ${JSON.stringify(worker)}, run: async () => ({}) })\nsetTimeout(() => process.exit(0), 100)\n`)
    const r = spawnSync(process.execPath, [parent], { encoding: 'utf8', timeout: 10_000 })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(existsSync(mark), false, 'the server was gone before the worker finished')
    assert.equal(await until(() => existsSync(mark)), true, 'the worker finished without it')
  })
  test('the real worker says nothing, exits 1 when the setup is refused, and leaves nothing behind', () => {
    const home = join(root, 'worker-home')
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('../../server/bin/ah-bootstrap.mjs', import.meta.url))], { encoding: 'utf8', timeout: 20_000, env: { ...process.env, AH_MOD_HOME: home, AH_CORE: join(root, 'a-checkout') } })
    assert.equal(r.status, 1)
    assert.equal(r.stdout + r.stderr, '')
    assert.equal(existsSync(join(home, 'core')), false)
  })
})
