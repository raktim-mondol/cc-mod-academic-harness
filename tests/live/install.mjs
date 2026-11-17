#!/usr/bin/env node
// Live checks of the first start of an installed copy: the plugin folder holds the source (core/) with nothing installed in it, so the server copies
// it to the mod's home and installs its dependencies there (server/src/bootstrap.mjs). Nothing is fetched from another repository.
//
//   node tests/live/install.mjs                 all
//   node tests/live/install.mjs first_start     one by name
//
// first_start   The server on its own, no Claude Code: a copy of the repository's files (core/ with no node_modules) and an empty home. It
//               answers `initialize` and lists the `doctor` tool at once, copies core/ to the home, installs the dependencies, and then
//               sends tools/list_changed; the new list holds the whole surface, and the doctor names the working copy.
//               Network: npm. About a minute. No account, no cost.
// marketplace   Claude Code: the same copy as a local marketplace (`claude plugin marketplace add`, `claude plugin install`) in a scratch
//               CLAUDE_CONFIG_DIR, so the real configuration is untouched. The first session answers `/academic doctor` while the setup is
//               running or done; a second session, once the setup has finished, has every tool and `/ah-papers` finds papers.
//               Needs a working `claude` login (no model call is made: both commands answer by themselves). About two minutes.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const base = join(homedir(), '.cache', 'ah-cc-p6', 'install-tests')

function copyPlugin(to) {
  rmSync(to, { recursive: true, force: true })
  const files = spawnSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' }).stdout.split('\0').filter(Boolean)
  for (const f of files) {
    mkdirSync(dirname(join(to, f)), { recursive: true })
    cpSync(join(root, f), join(to, f))
  }
  assert.equal(existsSync(join(to, 'core', 'package.json')), true, 'a copy of the repository holds the source')
  assert.equal(existsSync(join(to, 'core', 'node_modules')), false, 'and nothing installed in it')
}

/** A stdio client for the server: send requests, collect everything it says. */
function client(plugin, env) {
  const child = spawn(process.execPath, [join(plugin, 'server', 'bin', 'ah-mcp.mjs')], { cwd: plugin, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
  const lines = []
  const waiting = new Map()
  let buf = ''
  let err = ''
  child.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); lines.push(m); if (m.id !== undefined) waiting.get(m.id)?.(m) } })
  child.stderr.on('data', d => { err += d })
  let n = 0
  const send = (method, params) => { const id = ++n; const reply = new Promise(r => waiting.set(id, r)); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); return reply }
  const notify = method => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`)
  const until = async (test, ms, label) => { const end = Date.now() + ms; while (!test()) { if (Date.now() > end) throw new Error(`timed out waiting for ${label}\n${err.slice(-800)}`); await new Promise(r => setTimeout(r, 500)) } }
  return { child, lines, send, notify, until, stderr: () => err, close: () => child.kill() }
}

const claude = (config, args, cwd) => spawnSync('claude', args, { cwd, encoding: 'utf8', timeout: 240_000, input: '', env: { ...process.env, CLAUDE_CONFIG_DIR: config } })

const scenarios = {
  async first_start() {
    const plugin = join(base, 'first-start-plugin')
    const home = join(base, 'first-start-home')
    copyPlugin(plugin)
    rmSync(home, { recursive: true, force: true })
    const c = client(plugin, { AH_MOD_HOME: home, AH_AUTO_INSTALL: '0', AH_MANAGED_INSTALLS: '0', CLAUDE_CODE_SESSION_ID: 'first-start' })
    try {
      const init = await c.send('initialize', { capabilities: {} })
      assert.equal(init.result.capabilities.tools.listChanged, true)
      c.notify('notifications/initialized')
      const first = (await c.send('tools/list')).result.tools.map(t => t.name)
      assert.deepEqual(first, ['doctor'], 'before the setup is done the doctor is the only tool')
      const early = (await c.send('tools/call', { name: 'doctor', arguments: {} })).result.content[0].text
      assert.match(early, /Core: (being set up by the server|Academic Harness|not set up yet)/)
      await c.until(() => c.lines.some(l => l.method === 'notifications/tools/list_changed'), 240_000, 'the setup to finish and the list to change')
      const full = (await c.send('tools/list')).result.tools.map(t => t.name)
      assert.ok(full.length >= 126, `${full.length} tools`)
      for (const name of ['literature_search', 'paper_get', 'deep_research', 'ah_state', 'job_wait', 'doctor']) assert.ok(full.includes(name), name)
      const after = (await c.send('tools/call', { name: 'doctor', arguments: {} })).result.content[0].text
      assert.match(after, /Core: Academic Harness \d+\.\d+\.\d+, a working copy at /)
      assert.ok(existsSync(join(home, 'core')), 'the working copy is in the mod\'s home')
      assert.equal(existsSync(join(plugin, 'core', 'node_modules')), false, 'the plugin folder is left alone')
      assert.equal(existsSync(join(home, 'bootstrap.json')), false, 'the state file is cleared')
      return `answered at once with the doctor alone, copied the core and installed it, then listed ${full.length} tools after list_changed`
    } finally {
      c.close()
    }
  },
  marketplace() {
    const market = join(base, 'marketplace')
    const config = join(base, 'config')
    const work = join(base, 'work')
    const home = join(base, 'market-home')
    rmSync(config, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
    copyPlugin(market)
    mkdirSync(work, { recursive: true })
    const add = claude(config, ['plugin', 'marketplace', 'add', market], work)
    assert.equal(add.status, 0, add.stdout + add.stderr)
    const install = claude(config, ['plugin', 'install', 'academic-harness@academic-harness-mod'], work)
    assert.equal(install.status, 0, install.stdout + install.stderr)
    const session = prompt => claude(config, ['-p', prompt, '--model', 'haiku', '--max-budget-usd', '0.2'], work)
    const env = { AH_MOD_HOME: home }
    Object.assign(process.env, env)
    const first = session('/academic doctor')
    assert.equal(first.status, 0, first.stderr)
    assert.match(first.stdout, /Core:|Node\.js/)
    // the setup runs in the server of that session; give it time, then ask again
    const end = Date.now() + 240_000
    let second
    do {
      second = session('/academic doctor')
    } while (!/a working copy at/.test(second.stdout) && Date.now() < end)
    assert.match(second.stdout, /a working copy at/, second.stdout.slice(0, 600))
    const papers = session('/ah-papers --effort low sparse autoencoders')
    assert.match(papers.stdout, /Literature search: "sparse autoencoders"/)
    return 'installed from a local marketplace into a scratch configuration; the first session set itself up, the next had every tool'
  },
}

const which = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(scenarios)
let failed = 0
for (const name of which) {
  if (!scenarios[name]) { console.log(`${name}: unknown scenario`); failed++; continue }
  try {
    console.log(`${name}: ok: ${await scenarios[name]()}`)
  } catch (e) {
    failed++
    console.log(`${name}: FAIL ${e.message}`)
  }
}
process.exit(failed ? 1 : 0)
