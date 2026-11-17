#!/usr/bin/env node
// Live P6 checks: the exit of the phase, a fresh clone that works with no source checkout, and the doctor inside a session.
//
//   node tests/live/p6.mjs                 all
//   node tests/live/p6.mjs doctor          one or more by name
//
// doctor   `claude -p "/academic doctor"` on this folder: the report comes from the running `ah` server (its `doctor` tool), names the core,
//          lists key names and no values, and adds what the server loaded. No model turn, no cost.
// fresh    a copy of this repository's files (as `git clone` gives them: core/ with no node_modules) in a scratch folder, with nothing else to
//          read the source from: `node scripts/setup.mjs` installs the dependencies and builds the engine; then `claude -p` loads that copy,
//          the server connects with every tool, `/academic doctor` runs, and `/ah-papers` finds papers. Needs the network (npm, PyPI) and about
//          a minute.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const base = join(homedir(), '.cache', 'ah-cc-p6', 'live-tests')
const fresh = join(base, 'fresh')
const freshHome = join(base, 'fresh-home')

function claude(plugin, prompt, { cwd, env = {} }) {
  mkdirSync(cwd, { recursive: true })
  const r = spawnSync('claude', ['-p', prompt, '--plugin-dir', plugin, '--model', 'haiku', '--max-budget-usd', '0.3', '--output-format', 'stream-json', '--verbose'], {
    cwd, encoding: 'utf8', timeout: 240_000, maxBuffer: 1 << 28, input: '', env: { ...process.env, ...env },
  })
  const events = r.stdout.split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
  const init = events.find(e => e.type === 'system' && e.subtype === 'init')
  const said = events.filter(e => e.type === 'assistant').flatMap(e => e.message.content.filter(b => b.type === 'text').map(b => b.text)).join('\n')
  return { init, said, result: events.find(e => e.type === 'result') }
}
const serverOf = init => init?.mcp_servers?.find(s => s.name === 'plugin:academic-harness:ah')
const node = (cwd, args, env = {}) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 1 << 28 })

const scenarios = {
  doctor() {
    const secret = 'LIVE-SECRET-VALUE-0042'
    const r = claude(root, '/academic doctor', { cwd: join(base, 'doctor'), env: { AH_MOD_HOME: join(base, 'doctor-home'), S2_API_KEY: secret } })
    assert.equal(serverOf(r.init)?.status, 'connected')
    assert.match(r.said, /Core: Academic Harness \d+\.\d+\.\d+, in the plugin folder/)
    assert.match(r.said, /This server loaded \d+ tool modules/)
    assert.match(r.said, /1 set \(S2_API_KEY\)/, 'a key the server holds is named')
    assert.ok(!r.said.includes(secret), 'the value of a key must never be printed')
    assert.equal(r.result?.num_turns, 0)
    return 'the server\'s own report, the core named, a key named and its value not shown, no model turn'
  },
  fresh() {
    rmSync(fresh, { recursive: true, force: true })
    rmSync(freshHome, { recursive: true, force: true })
    const files = spawnSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' }).stdout.split('\0').filter(Boolean)
    for (const f of files) {
      mkdirSync(dirname(join(fresh, f)), { recursive: true })
      cpSync(join(root, f), join(fresh, f))
    }
    assert.equal(existsSync(join(fresh, 'core', 'node_modules')), false, 'a clone has nothing installed')
    assert.equal(existsSync(join(fresh, 'core', 'package.json')), true, 'but it has the source')
    const env = { AH_MOD_HOME: freshHome }
    const setup = node(fresh, ['scripts/setup.mjs'], env)
    assert.equal(setup.status, 0, setup.stdout.slice(-1500) + setup.stderr.slice(-500))
    assert.match(setup.stdout, /Core: Academic Harness \d+\.\d+\.\d+, in the plugin folder/)
    assert.doesNotMatch(setup.stdout + setup.stderr, /github\.com\/raktim-mondol\/academic-harness|downloading/i, 'nothing is fetched from the Academic Harness repository')
    assert.match(setup.stdout, /Writing engine[^\n]*ready/)
    assert.equal(existsSync(join(fresh, 'core', 'node_modules', 'ah-dsh-tools')), true)

    const doctor = claude(fresh, '/academic doctor', { cwd: join(base, 'fresh-work'), env })
    assert.equal(serverOf(doctor.init)?.status, 'connected', 'the ah server of a fresh clone connects')
    const tools = doctor.init.tools.filter(t => t.startsWith('mcp__plugin_academic-harness_ah__')).length
    assert.ok(tools >= 126, `${tools} ah tools`)
    assert.match(doctor.said, /Core: Academic Harness \d+\.\d+\.\d+, in the plugin folder/)
    assert.match(doctor.said, /PaperMemory CLI: installed/)
    const papers = claude(fresh, '/ah-papers --effort low sparse autoencoders', { cwd: join(base, 'fresh-work'), env })
    assert.match(papers.said, /Literature search: "sparse autoencoders"/)
    assert.equal(papers.result?.total_cost_usd, 0)
    return `setup from a copy of this repository alone, the server connects with ${tools} tools, doctor and /ah-papers answer`
  },
}

const which = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(scenarios)
let failed = 0
for (const name of which) {
  if (!scenarios[name]) { console.log(`${name}: unknown scenario`); failed++; continue }
  try {
    console.log(`${name}: ok: ${scenarios[name]()}`)
  } catch (e) {
    failed++
    console.log(`${name}: FAIL ${e.message}`)
  }
}
process.exit(failed ? 1 : 0)
