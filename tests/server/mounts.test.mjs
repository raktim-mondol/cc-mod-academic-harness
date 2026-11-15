// Mounted MCP servers (mounts.mjs) and the paper_mcp tool that uses them, with a stand-in MCP server.
// Scratch under ~/.cache; the host runs in this process with a scratch DSH_HOME.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { createHost } from '../../server/src/host.mjs'
import { Registry } from '../../server/src/context.mjs'
import { mountServer } from '../../server/src/mounts.mjs'
import { prepareEnv } from '../../server/src/env.mjs'
import { upstreamDir } from '../../server/src/paths.mjs'

const root = join(homedir(), '.cache', 'ah-cc-audit', 'mounts-unit')
const UP = upstreamDir()
const HAVE_UP = existsSync(join(UP, 'node_modules', 'ah-dsh-tools'))
const server = join(root, 'fake-server.mjs')

before(() => {
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  writeFileSync(server, readFileSync(join(import.meta.dirname, '..', 'fixtures', 'fake-mcp-server.mjs'), 'utf8'))
})
after(() => rmSync(root, { recursive: true, force: true }))

const text = r => r.content.map(c => c.text).join('\n')
const sleep = ms => new Promise(r => setTimeout(r, ms))

describe('mounted stdio MCP server', () => {
  const spec = { serverName: 'fake', command: process.execPath, args: [server], cwd: root }

  test('its tools are registered as mcp__<server>__<tool> and calls go through, errors included', async () => {
    const registry = new Registry()
    let changes = 0
    const m = await mountServer(registry, spec, { onChange: () => { changes++ } })
    try {
      assert.deepEqual([...registry.tools.keys()].sort(), ['mcp__fake__boom', 'mcp__fake__echo', 'mcp__fake__grow', 'mcp__fake__slow'])
      assert.ok(changes >= 1)
      const echo = registry.tools.get('mcp__fake__echo')
      assert.deepEqual(echo.parameters.required, ['text'])
      assert.deepEqual(await echo.execute({ text: 'hi' }, {}), [{ type: 'text', text: 'echo:hi:nosecret' }])
      await assert.rejects(registry.tools.get('mcp__fake__boom').execute({}, {}), /it broke/)
    } finally { m.close() }
  })

  test('a server that adds a tool and says so is re-listed; cancelling a call tells the server and rejects it', async () => {
    const log = join(root, 'cancel.log')
    const registry = new Registry()
    const m = await mountServer(registry, { ...spec, env: { FAKE_LOG: log } })
    try {
      await registry.tools.get('mcp__fake__grow').execute({}, {})
      for (let i = 0; i < 20 && !registry.tools.has('mcp__fake__extra'); i++) await sleep(50)
      assert.ok(registry.tools.has('mcp__fake__extra'), 'the new tool appeared')
      const c = new AbortController()
      const p = registry.tools.get('mcp__fake__slow').execute({}, { signal: c.signal })
      setTimeout(() => c.abort(), 100)
      await assert.rejects(p, /cancelled/)
      await sleep(100)
      assert.match(readFileSync(log, 'utf8'), /notifications\/cancelled/)
    } finally { m.close() }
  })

  test('a server that cannot start rejects the mount; closing removes the tools', async () => {
    await assert.rejects(mountServer(new Registry(), { serverName: 'nope', command: join(root, 'no-such-binary'), args: [], cwd: root }), /ENOENT|could not start|exited/)
    const registry = new Registry()
    const m = await mountServer(registry, spec)
    m.close()
    assert.equal(registry.tools.size, 0)
  })
})

describe('paper_mcp through the host', { skip: !HAVE_UP }, () => {
  let host
  let proj
  let answer = 'accept'
  let asked = []
  const originalEnv = { ...process.env }

  before(async () => {
    process.env.AH_MOD_HOME = join(root, 'home')
    prepareEnv(process.env, { areas: ['memory'] })
    process.env.AH_MANAGED_INSTALLS = '0'
    proj = join(root, 'proj')
    mkdirSync(proj, { recursive: true })
    host = await createHost({ upstream: UP, areas: 'memory', cwd: proj, logger: () => {} })
    host.bridge.elicit = async p => { asked.push(p); return answer === 'accept' ? { action: 'accept', content: { approve: true } } : { action: answer } }
  })
  after(async () => {
    await host?.dispose()
    for (const k of Object.keys(process.env)) if (!(k in originalEnv)) delete process.env[k]
    Object.assign(process.env, originalEnv)
  })

  const args = { action: 'register', serverName: 'fake', command: process.execPath, args: [server], envNames: [] }

  test('the three memory tools load', () => {
    assert.ok(['paper_mcp', 'paper_backfill'].every(n => host.registry.tools.has(n)))
    assert.ok(host.registry.subscriptions.some(s => s.event === 'agent/disposed'), 'the dream pass is subscribed')
  })

  test('a declined or cancelled approval mounts nothing and writes no trust record', async () => {
    for (const a of ['decline', 'cancel']) {
      answer = a
      asked = []
      const r = await host.call('paper_mcp', args, { callId: `reg-${a}` })
      assert.match(text(r), /was not approved|not approved/)
      assert.equal(asked.length, 1)
      assert.ok(![...host.registry.tools.keys()].some(n => n.startsWith('mcp__fake__')))
    }
    const trust = join(root, 'home', 'paper-mcp', 'approvals.json')
    assert.ok(!existsSync(trust) || !readFileSync(trust, 'utf8').includes('"fake"'), 'a refused server left a trust record')
  })

  test('no elicitation channel at all fails closed', async () => {
    const saved = host.bridge.elicit
    host.bridge.elicit = null
    const r = await host.call('paper_mcp', args, { callId: 'reg-none' })
    host.bridge.elicit = saved
    assert.match(text(r), /not approved|denied/)
    assert.ok(![...host.registry.tools.keys()].some(n => n.startsWith('mcp__fake__')))
  })

  test('an approved server is mounted, its tools are callable, and the question names what will run', async () => {
    answer = 'accept'
    asked = []
    const changed = []
    host.registry.onChange = () => changed.push(Date.now())
    const r = await host.call('paper_mcp', args, { callId: 'reg-ok' })
    assert.match(text(r), /mounted: true/)
    assert.equal(asked.length, 1)
    assert.match(asked[0].message, /fake/)
    assert.match(asked[0].message, new RegExp(process.execPath.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')))
    for (let i = 0; i < 40 && !host.registry.tools.has('mcp__fake__echo'); i++) await sleep(50)
    assert.ok(host.registry.tools.has('mcp__fake__echo'))
    assert.ok(changed.length >= 1, 'the client is told the tool list changed')
    const echoed = await host.call('mcp__fake__echo', { text: 'hello' }, { callId: 'echo' })
    assert.match(text(echoed), /echo:hello/)
    assert.ok(existsSync(join(proj, '.dsh', 'paper-mcps.json')))
    const status = await host.call('paper_mcp', { action: 'status' }, { callId: 'st' })
    assert.match(text(status), /fake · mounted/)
    assert.match(readFileSync(join(root, 'home', 'paper-mcp', 'approvals.json'), 'utf8'), /fake|\w{16,}/, 'an approved server leaves its trust record in the mod\'s home')
  })

  test('a registry entry that came with the folder and was never approved is not mounted at session start', async () => {
    const other = join(root, 'cloned')
    mkdirSync(join(other, '.dsh'), { recursive: true })
    writeFileSync(join(other, '.dsh', 'paper-mcps.json'), JSON.stringify({ version: 1, servers: [{ serverName: 'sneaky', command: process.execPath, args: [server], cwd: other, envNames: [] }] }))
    await host.fire('session/created', { header: { cwd: other, id: 's', origin: 'main' } })
    await sleep(300)
    assert.ok(![...host.registry.tools.keys()].some(n => n.startsWith('mcp__sneaky__')))
  })

  test('the stored environment names are resolved at mount time, and the secret value is not in the registry file', async () => {
    process.env.FAKE_SECRET = 'S3CRET-VALUE'
    answer = 'accept'
    const r = await host.call('paper_mcp', { ...args, serverName: 'withenv', envNames: ['FAKE_SECRET'] }, { callId: 'reg-env' })
    assert.match(text(r), /mounted: true/)
    for (let i = 0; i < 40 && !host.registry.tools.has('mcp__withenv__echo'); i++) await sleep(50)
    const out = await host.call('mcp__withenv__echo', { text: 'x' }, { callId: 'echo2' })
    assert.match(text(out), /S3CRET-VALUE/)
    assert.ok(!readFileSync(join(proj, '.dsh', 'paper-mcps.json'), 'utf8').includes('S3CRET-VALUE'))
    delete process.env.FAKE_SECRET
  })
})
