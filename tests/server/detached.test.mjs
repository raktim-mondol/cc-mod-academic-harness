// Work that outlives the server (server/src/detached.mjs), and the writing engine's build run that way (server/src/engine-install.mjs).
// Nothing here needs the snapshot: a small folder stands in for the engine, and a shell script for uv.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runDetached } from '../../server/src/detached.mjs'
import { engineDir, engineStatus, INSTALLING_FILE } from '../../server/src/engine.mjs'
import { installEngine, installEngineInWorker, installing, installingElsewhere } from '../../server/src/engine-install.mjs'

const scratch = join(homedir(), '.cache', 'ah-test-homes')
mkdirSync(scratch, { recursive: true })
const root = mkdtempSync(join(scratch, 'detached-'))
after(() => rmSync(root, { recursive: true, force: true }))
const until = async (cond, ms = 8000) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) await new Promise(r => setTimeout(r, 50)); return cond() }
const script = (name, body) => { const f = join(root, name); writeFileSync(f, body); return f }
const src = rel => fileURLToPath(new URL(`../../server/${rel}`, import.meta.url))

describe('a detached worker', () => {
  test('its exit code is the answer, it gets the arguments and the environment, and its pid is known before it has run', async () => {
    const out = join(root, 'out.json')
    const worker = script('w-ok.mjs', `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(out)}, JSON.stringify({ pid: process.pid, arg: process.argv[2], env: process.env.MARK }))\nprocess.exit(7)\n`)
    let started = null
    const code = await runDetached(worker, { env: { ...process.env, MARK: 'm' }, args: ['a'], onStart: pid => { started = pid; assert.equal(existsSync(out), false) } })
    assert.equal(code, 7)
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), { pid: started, arg: 'a', env: 'm' })
  })
  test('a script that is not there is a failure, not a throw; nor is an onStart that throws', async () => {
    assert.notEqual(await runDetached(join(root, 'no-such.mjs')), 0)
    assert.equal(await runDetached(script('w-zero.mjs', 'process.exit(0)\n'), { onStart() { throw new Error('x') } }), 0)
  })
  test('it goes on after the process that started it has ended', async () => {
    const mark = join(root, 'outlived')
    const worker = script('w-slow.mjs', `import { writeFileSync } from 'node:fs'\nsetTimeout(() => writeFileSync(${JSON.stringify(mark)}, 'done'), 600)\n`)
    const parent = script('parent.mjs', `import { runDetached } from ${JSON.stringify(pathToFileURL(src('src/detached.mjs')).href)}\nvoid runDetached(${JSON.stringify(worker)})\nsetTimeout(() => process.exit(0), 100)\n`)
    assert.equal(spawnSync(process.execPath, [parent], { timeout: 10_000 }).status, 0)
    assert.equal(existsSync(mark), false, 'the parent was gone before the worker finished')
    assert.equal(await until(() => existsSync(mark)), true)
  })
})

describe('the engine build in a process of its own', () => {
  /** A folder shaped like a snapshot with an engine in it, and no environment. */
  function engine(name) {
    const upstream = join(root, name)
    const dir = engineDir(upstream)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "x"\nversion = "1.2.3"\n')
    return { upstream, dir, marker: join(dir, INSTALLING_FILE) }
  }
  /** Stands in for uv: `uv venv --clear <venv>` makes a python, `uv pip install ...` does nothing. */
  const fakeUv = script('uv', '#!/bin/sh\nif [ "$1" = venv ]; then mkdir -p "$3/bin" && : > "$3/bin/python" && chmod +x "$3/bin/python"; fi\nexit 0\n')
  chmodSync(fakeUv, 0o755)
  const withUv = async fn => { const saved = process.env.UV; process.env.UV = fakeUv; try { return await fn() } finally { if (saved === undefined) delete process.env.UV; else process.env.UV = saved } }

  test('the marker names the worker before it has run a line, and is gone when a worker that built nothing has ended', async () => {
    const e = engine('e-marker')
    const seen = join(root, 'seen-marker')
    const worker = script('w-look.mjs', `import { readFileSync, writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(seen)}, JSON.stringify({ pid: process.pid, marker: readFileSync(${JSON.stringify(e.marker)}, 'utf8').trim() }))\nprocess.exit(1)\n`)
    const r = await installEngineInWorker({ env: {}, upstream: e.upstream, worker })
    const s = JSON.parse(readFileSync(seen, 'utf8'))
    assert.equal(Number(s.marker), s.pid, 'the guard could already say "being installed"')
    assert.equal(existsSync(e.marker), false)
    assert.equal(r.ok, false)
    assert.match(r.why, /no virtual environment/)
  })
  test('a build whose marker carries its own pid is its own, and builds; another live process\'s is not', async () => {
    const e = engine('e-own')
    writeFileSync(e.marker, `${process.pid}\n`)
    assert.equal(installing(e.dir), true)
    assert.equal(installingElsewhere(e.dir), false)
    const r = await withUv(() => installEngine({ upstream: e.upstream, quiet: true }))
    assert.deepEqual(r, { built: true, how: 'uv' })
    assert.equal(engineStatus({}, e.dir).ok, true)
    assert.equal(existsSync(e.marker), false)
    const other = engine('e-other')
    writeFileSync(other.marker, `${process.ppid}\n`)
    assert.equal(installingElsewhere(other.dir), true)
    assert.deepEqual(await withUv(() => installEngine({ upstream: other.upstream, quiet: true })), { built: false, how: 'another build is running' })
    assert.equal(readFileSync(other.marker, 'utf8').trim(), String(process.ppid), 'the other build\'s marker is left alone')
  })
  test('the real worker builds the environment after the server that started it has gone', async () => {
    const e = engine('e-real')
    const parent = script('parent-engine.mjs', `import { installEngineInWorker } from ${JSON.stringify(pathToFileURL(src('src/engine-install.mjs')).href)}\nvoid installEngineInWorker({ upstream: ${JSON.stringify(e.upstream)} })\nsetTimeout(() => process.exit(0), 20)\n`)
    const r = spawnSync(process.execPath, [parent], { timeout: 10_000, encoding: 'utf8', env: { ...process.env, UV: fakeUv } })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(await until(() => engineStatus({}, e.dir).ok), true, 'built by the worker alone')
    assert.equal(await until(() => !existsSync(e.marker)), true)
  })
  test('the real worker says nothing and exits 1 when nothing may be built', () => {
    const r = spawnSync(process.execPath, [src('bin/ah-engine-install.mjs')], { encoding: 'utf8', timeout: 20_000, env: { ...process.env, AH_CORE: join(root, 'a-checkout') } })
    assert.equal(r.status, 1)
    assert.equal(r.stdout + r.stderr, '')
  })
})
