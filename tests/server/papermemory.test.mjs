// node --test tests/server
// Scratch state lives under ~/.cache (plan ground rule 4). The real PaperMemory store is only ever
// stat()ed: the live test asserts it is unchanged.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { EXPECTED_TOOLS, HIDDEN_TOOLS, MIN_VERSION, resolveLaunch, serverEnv, vendoredVersion, versionAtLeast, wantStamp } from '../../server/src/papermemory.mjs'

const BIN = fileURLToPath(new URL('../../server/bin/papermemory-mcp.mjs', import.meta.url))
const scratch = join(homedir(), '.cache', 'ah-cc-p1', `test-${process.pid}`)
const realStore = join(homedir(), '.local', 'share', 'papermemory', 'papermemory.db')
const stat = p => (existsSync(p) ? `${statSync(p).size}:${statSync(p).mtimeMs}` : 'absent')

before(() => { rmSync(scratch, { recursive: true, force: true }); mkdirSync(scratch, { recursive: true }) })
after(() => rmSync(scratch, { recursive: true, force: true }))

describe('version and stamp', () => {
  test('versionAtLeast compares the numeric prefix', () => {
    assert.equal(versionAtLeast('0.3.6+ah.1', '0.3.6'), true)
    assert.equal(versionAtLeast('0.3.5', '0.3.6'), false)
    assert.equal(versionAtLeast('1.0.0', '0.9.9'), true)
    assert.equal(versionAtLeast(undefined, '0.3.6'), false)
    assert.equal(versionAtLeast('garbage', '0.3.6'), false)
  })
  test('the want-stamp is the vendored version plus the mod revision', () => {
    assert.match(vendoredVersion(), /^\d+\.\d+\.\d+/)
    assert.ok(versionAtLeast(vendoredVersion(), MIN_VERSION))
    assert.equal(wantStamp(), `${vendoredVersion()}+ccmod1`)
  })
})

describe('server environment', () => {
  test('hides the MCP reference library and keeps the caller\'s database choice', () => {
    const env = serverEnv({ PAPERMEMORY_DB: '/x/pm.db', PATH: '/bin' })
    assert.equal(env.PAPERMEMORY_HIDE_TOOLS, 'papermemory_library')
    assert.equal(env.PAPERMEMORY_DB, '/x/pm.db')
    assert.equal(env.PYTHONUNBUFFERED, '1')
  })
})

describe('resolution', () => {
  test('PAPERMEMORY_CLI wins and is taken as given', async () => {
    const launch = await resolveLaunch({ PAPERMEMORY_CLI: '/opt/pm', AH_MOD_HOME: join(scratch, 'none'), PATH: '' })
    assert.deepEqual(launch, { command: '/opt/pm', args: [] })
  })
  test('development mode (AH_UPSTREAM) installs nothing', async () => {
    const home = join(scratch, 'dev-home')
    const launch = await resolveLaunch({ AH_UPSTREAM: join(scratch, 'no-checkout'), AH_MOD_HOME: home, PATH: '' })
    assert.equal(launch, undefined)
    assert.equal(existsSync(home), false)
  })
  test('PAPERMEMORY_SKIP_INSTALL=1 installs nothing', async () => {
    const home = join(scratch, 'skip-home')
    assert.equal(await resolveLaunch({ PAPERMEMORY_SKIP_INSTALL: '1', AH_MOD_HOME: home, PATH: '' }), undefined)
    assert.equal(existsSync(home), false)
  })
})

// --- live: install into a scratch home, start the real server, talk MCP to it -------------------

function rpc(child) {
  let buf = ''
  const waiting = new Map()
  child.stdout.on('data', d => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      if (!line.trim()) continue
      const m = JSON.parse(line)
      waiting.get(m.id)?.(m)
    }
  })
  let n = 0
  return (method, params = {}) => new Promise((res, rej) => {
    const id = ++n
    const t = setTimeout(() => rej(new Error(`no answer to ${method}`)), 20000)
    waiting.set(id, m => { clearTimeout(t); res(m) })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}

describe('install without uv', { timeout: 240000 }, () => {
  // upstream's installer falls back to `python -m venv` and pip when uv is missing or fails. UV points at a program that is not there,
  // which is how the installer is told "this is the uv to use" and finds it broken.
  test('a missing uv falls back to python -m venv and pip, and the result runs', async () => {
    const home = join(scratch, 'home-nouv')
    const env = { ...process.env, AH_MOD_HOME: home, PAPERMEMORY_DB: join(scratch, 'pm-nouv.db'), UV: join(scratch, 'no-such-uv') }
    delete env.AH_UPSTREAM
    delete env.PAPERMEMORY_CLI
    const r = await new Promise(res => { const c = spawn(process.execPath, [BIN, '--install'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); let err = ''; c.stderr.on('data', d => { err += d }); c.on('close', code => res({ code, err })) })
    assert.equal(r.code, 0, r.err)
    assert.ok(existsSync(join(home, 'papermemory', 'installed-version')))
    const where = JSON.parse(await new Promise(res => { const c = spawn(process.execPath, [BIN, '--where'], { env, stdio: ['ignore', 'pipe', 'ignore'] }); let out = ''; c.stdout.on('data', d => { out += d }); c.on('close', () => res(out)) }))
    assert.match(JSON.stringify(where), /\.venv/)
    const v = spawnSync(where.command, [...where.args, 'version'], { encoding: 'utf8', env })
    assert.equal(v.status, 0, v.stderr)
  })
})

describe('live server', { timeout: 180000 }, () => {
  const home = join(scratch, 'home')
  const db = join(scratch, 'pm.db')
  const env = { ...process.env, AH_MOD_HOME: home, PAPERMEMORY_DB: db }
  delete env.AH_UPSTREAM
  delete env.PAPERMEMORY_CLI

  test('two installs at once both succeed and leave one good install', async () => {
    const one = () => new Promise(res => { const c = spawn(process.execPath, [BIN, '--install'], { env, stdio: 'ignore' }); c.on('close', res) })
    const codes = await Promise.all([one(), one()])
    assert.deepEqual(codes, [0, 0])
    assert.ok(existsSync(join(home, 'papermemory', 'installed-version')))
    assert.equal(existsSync(join(home, 'papermemory', 'install.lock')), false)
  })

  test('serves the 14 tools, without the hidden library tool, and answers a call; the real store is untouched', async () => {
    const before = stat(realStore)
    const child = spawn(process.execPath, [BIN], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    const call = rpc(child)
    try {
      const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
      assert.ok(init.result, JSON.stringify(init))
      const listed = await call('tools/list')
      const names = listed.result.tools.map(t => t.name)
      assert.equal(names.length, EXPECTED_TOOLS, names.join(','))
      for (const hidden of HIDDEN_TOOLS) assert.ok(!names.includes(hidden))
      assert.ok(names.every(n => n.startsWith('papermemory_')))
      const recap = await call('tools/call', { name: 'papermemory_recap', arguments: {} })
      assert.ok(recap.result, JSON.stringify(recap))
    } finally {
      child.kill('SIGTERM')
    }
    assert.equal(stat(realStore), before, 'the real PaperMemory store changed')
    assert.ok(existsSync(db), 'the scratch store was not created')
  })

  test('a missing CLI fails loudly with a message on stderr and exit 1', async () => {
    const res = await new Promise(r => {
      const c = spawn(process.execPath, [BIN], { env: { ...env, AH_MOD_HOME: join(scratch, 'empty'), PAPERMEMORY_SKIP_INSTALL: '1', PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
      let err = ''; c.stderr.on('data', d => { err += d }); c.on('close', code => r({ code, err }))
    })
    assert.equal(res.code, 1)
    assert.match(res.err, /CLI not found/)
  })
})
