// The tools and skills brought back: the self-improvement loop (ah_rsi) driven by hook events, paper_mcp registering servers with Claude Code
// through .mcp.json, zvec_index, and the five skills.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { mcpEntry, removeFromMcpJson, writeMcpJson } from '../../server/src/mcpjson.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const UP = join(root, 'core')
const HAVE_UP = existsSync(join(UP, 'node_modules', 'ah-dsh-tools'))
const scratch = prefix => { const base = join(homedir(), '.cache', 'ah-test-homes'); mkdirSync(base, { recursive: true }); return mkdtempSync(join(base, prefix)) }

describe('paper_mcp writes .mcp.json and never a secret', () => {
  const spec = { serverName: 'p', command: '/venv/bin/python', args: ['/srv/p_mcp.py'], cwd: '/srv', env: { PYTHONUNBUFFERED: '1', S2_API_KEY: 'sk-secret-value' } }
  test('the entry runs the server in its folder and names variables, not values', () => {
    const e = mcpEntry(spec)
    assert.deepEqual(e.args.slice(0, 3), ['-c', 'cd "$0" && exec "$@"', '/srv'])
    assert.deepEqual(e.args.slice(3), ['/venv/bin/python', '/srv/p_mcp.py'])
    assert.deepEqual(e.env, { PYTHONUNBUFFERED: '1', S2_API_KEY: '${S2_API_KEY}' })
    assert.doesNotMatch(JSON.stringify(e), /sk-secret-value/)
    assert.deepEqual(Object.keys(mcpEntry({ ...spec, env: { 'BAD NAME': 'x', 'a=b': 'y' } }).env), ['PYTHONUNBUFFERED'], 'a name that is not an identifier is dropped')
  })
  test('other servers in the file are kept, an identical entry is not rewritten, a broken file is refused untouched, and only our entry is removed', () => {
    const dir = scratch('mcpjson-')
    try {
      const file = join(dir, '.mcp.json')
      writeFileSync(file, JSON.stringify({ mcpServers: { mine: { command: 'x' } }, other: 1 }))
      assert.equal(writeMcpJson(dir, 'p', spec).changed, true)
      assert.equal(writeMcpJson(dir, 'p', spec).changed, false)
      const doc = JSON.parse(readFileSync(file, 'utf8'))
      assert.deepEqual(Object.keys(doc.mcpServers).sort(), ['mine', 'p'])
      assert.equal(doc.other, 1)
      assert.equal(removeFromMcpJson(dir, 'mine'), false, 'a server that is not ours is left')
      assert.equal(removeFromMcpJson(dir, 'p'), true)
      assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8')).mcpServers), ['mine'])
      writeFileSync(file, '{ not json')
      assert.throws(() => writeMcpJson(dir, 'p', spec), /not valid JSON/)
      assert.equal(readFileSync(file, 'utf8'), '{ not json')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('what the host serves now', () => {
  test('zvec_index, ah_rsi and paper_mcp are served; registering a server writes .mcp.json and a cloned registry mounts nothing by itself', { skip: !HAVE_UP }, async () => {
    const { createHost } = await import('../../server/src/host.mjs')
    const dir = scratch('host-')
    const saved = { ...process.env }
    process.env.DSH_HOME = join(dir, 'home')
    for (const f of ['ACADEMIC_HARNESS_SKIP_INSTALL', 'ACADEMIC_HARNESS_MODAL_SKIP_INSTALL', 'TEXTFOLD_SKIP_INSTALL', 'PAPERMEMORY_SKIP_INSTALL', 'ZVEC_GREP_SKIP_INSTALL']) process.env[f] = '1'
    const proj = join(dir, 'proj')
    mkdirSync(join(proj, '.dsh'), { recursive: true })
    mkdirSync(join(proj, 'srv'), { recursive: true })
    writeFileSync(join(proj, 'srv', 'p_mcp.py'), '# server\n')
    // a registry that came with the folder, already "approved" by nobody: it must not write .mcp.json at session start
    writeFileSync(join(proj, '.dsh', 'paper-mcps.json'), JSON.stringify({ schema_version: 1, servers: [{ serverName: 'shipped', command: process.execPath, args: [join(proj, 'srv', 'p_mcp.py')], cwd: proj, envNames: [] }] }))
    let host
    try {
      host = await createHost({ upstream: UP, areas: 'search,writing,memory', cwd: proj, logger: () => {}, env: { ...process.env, AH_MOD_HOME: join(dir, 'home'), AH_AUTO_PROVIDERS: '0', AH_DREAM_DELAY_MS: '-1' } })
      const names = host.list().map(t => t.name)
      for (const n of ['zvec_index', 'ah_rsi', 'paper_mcp']) assert.ok(names.includes(n), n)
      host.start()
      await new Promise(r => setTimeout(r, 200))
      assert.equal(existsSync(join(proj, '.mcp.json')), false, 'session start mounted nothing')
      const status = await host.call('paper_mcp', { action: 'status' })
      assert.match(status.content[0].text, /shipped/)
      assert.match(status.content[0].text, /shipped · not in \.mcp\.json · not confirmed yet/)
      assert.match(host.list().find(t => t.name === 'paper_mcp').description, /writes it into \.mcp\.json; the person is asked to confirm first/, 'the description says what really happens')
      assert.doesNotMatch(host.list().find(t => t.name === 'paper_mcp').description, /mounts it|restart dsh/i)
      const reg = await host.call('paper_mcp', { action: 'register', serverName: 'p', command: process.execPath, args: [join(proj, 'srv', 'p_mcp.py')], cwd: proj, envNames: ['S2_API_KEY'] })
      assert.notEqual(reg.isError, true, JSON.stringify(reg))
      assert.match(reg.content[0].text, /\.mcp\.json: has the entry/)
      assert.match(reg.content[0].text, /Claude Code asks you to approve the server/)
      assert.doesNotMatch(reg.content[0].text, /mounted|restart/i)
      assert.match((await host.call('paper_mcp', { action: 'status' })).content[0].text, /- p · in \.mcp\.json/)
      const doc = JSON.parse(readFileSync(join(proj, '.mcp.json'), 'utf8'))
      assert.equal(doc.mcpServers.p.command, 'bash')
      assert.equal(doc.mcpServers.p.env.S2_API_KEY, '${S2_API_KEY}')
      const gone = await host.call('paper_mcp', { action: 'unregister', serverName: 'p' })
      assert.notEqual(gone.isError, true)
      assert.match(gone.content[0].text, /Removed from the registry and from \.mcp\.json/)
      assert.equal(JSON.parse(readFileSync(join(proj, '.mcp.json'), 'utf8')).mcpServers.p, undefined)
      const rsi = await host.call('ah_rsi', { action: 'status' })
      assert.match(rsi.content[0].text, /RSI mode: /)
    } finally {
      await host?.dispose()
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
      Object.assign(process.env, saved)
      rmSync(dir, { recursive: true, force: true })
    }
  })
  test('the five skills are built, none of them names the other host, and using-science-superpowers asks for a skill by need, not on every response', () => {
    const sup = readFileSync(join(root, 'skills', 'using-science-superpowers', 'SKILL.md'), 'utf8')
    assert.doesNotMatch(sup, /ANY response|even 1%|1% chance|ABSOLUTELY MUST/)
    assert.match(sup, /without waiting to be asked/)
    assert.match(sup, /greeting/)
    for (const n of ['agent-browser', 'modal', 'runpod', 'vastai', 'using-science-superpowers']) {
      const f = join(root, 'skills', n, 'SKILL.md')
      assert.ok(existsSync(f), n)
      const t = readFileSync(f, 'utf8')
      assert.doesNotMatch(t, /\bDSH\b|DeepSeek|dsh plugin|read_image|restart dsh/, n)
    }
  })
})
