#!/usr/bin/env node
// Live P2 scenarios: a nested `claude -p` (Haiku, budget-capped) in a scratch directory under ~/.cache.
//
//   node tests/live/p2.mjs            both scenarios
//   node tests/live/p2.mjs search     only the search-and-notebook one
//   node tests/live/p2.mjs key        only the plugin-config key one
//
// search: the model finds papers with openalex_search through ToolSearch and logs a notebook entry.
//         Asserts the tool calls, the entry's id (the tool-use id) and the file <cwd>/.dsh/notebook/<session id>.jsonl.
// key:    a fake key set through the plugin's userConfig (pluginConfigs) reaches the tool: database_catalog reports
//         S2_API_KEY as configured, and the value appears nowhere in the run's output.
// Costs about two cents per run. Needs a working `claude` login.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const base = join(homedir(), '.cache', 'ah-cc-p2', 'live-tests')
const PREFIX = 'mcp__plugin_academic-harness_ah__'

function run(name, prompt, { allow, settings } = {}) {
  const cwd = join(base, name)
  rmSync(cwd, { recursive: true, force: true })
  mkdirSync(cwd, { recursive: true })
  const args = ['-p', prompt, '--plugin-dir', root, '--model', 'haiku', '--max-budget-usd', '0.6', '--allowedTools', allow.join(','), '--output-format', 'stream-json', '--verbose']
  if (settings) {
    const f = join(base, `${name}-settings.json`)
    writeFileSync(f, JSON.stringify(settings))
    args.push('--settings', f)
  }
  const r = spawnSync('claude', args, { cwd, encoding: 'utf8', timeout: 280_000, maxBuffer: 1 << 28, env: { ...process.env, AH_MOD_HOME: join(base, 'home') } })
  const events = r.stdout.split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
  const calls = events.filter(e => e.type === 'assistant').flatMap(e => e.message.content.filter(b => b.type === 'tool_use'))
  const init = events.find(e => e.type === 'system' && e.subtype === 'init')
  const result = events.find(e => e.type === 'result')
  return { cwd, raw: r.stdout + r.stderr, calls, init, result, status: r.status }
}

const scenarios = {
  search() {
    const r = run('search', "Use the academic-harness tools. Search OpenAlex for papers on 'retrieval-augmented generation for scientific question answering' and pick three. Then record one lab-notebook entry (the notebook tool, action log, type observation) that lists those three papers by title and DOI. Reply with the three titles only.", { allow: ['ToolSearch', `${PREFIX}openalex_search`, `${PREFIX}notebook`] })
    const server = r.init.mcp_servers.find(s => s.name === 'plugin:academic-harness:ah')
    assert.equal(server?.status, 'connected')
    assert.ok(r.calls.some(c => c.name === `${PREFIX}openalex_search`), 'openalex_search was not called')
    const log = r.calls.find(c => c.name === `${PREFIX}notebook` && c.input.action === 'log')
    assert.ok(log, 'notebook log was not called')
    const dir = join(r.cwd, '.dsh', 'notebook')
    const file = join(dir, `${r.init.session_id}.jsonl`)
    assert.ok(existsSync(file), `no notebook file at ${file}; found ${existsSync(dir) ? readdirSync(dir) : 'nothing'}`)
    const entry = JSON.parse(readFileSync(file, 'utf8').trim().split('\n').at(-1))
    assert.equal(entry.id, log.id, 'entry id is the tool-use id')
    assert.ok((entry.body.match(/10\.\d{4,}\//g) ?? []).length >= 3, 'three DOIs in the entry')
    return `ok: ${r.calls.length} tool calls, entry ${entry.id}, $${r.result.total_cost_usd.toFixed(3)}`
  },
  key() {
    const FAKE = 'FAKE-S2-KEY-VALUE-for-p2-test'
    const r = run('key', 'Call the database_catalog tool of the academic-harness server with no arguments and tell me the exact line that starts with "S2_API_KEY".', { allow: ['ToolSearch', `${PREFIX}database_catalog`], settings: { pluginConfigs: { 'academic-harness@inline': { options: { s2_api_key: FAKE } } } } })
    assert.ok(r.calls.some(c => c.name === `${PREFIX}database_catalog`), 'database_catalog was not called')
    assert.match(r.result.result, /S2_API_KEY: configured/)
    assert.ok(!r.raw.includes(FAKE), 'the key value appears in the run output')
    return `ok: key reached the tool, value not in output ($${r.result.total_cost_usd.toFixed(3)})`
  },
}

const which = process.argv[2] ? [process.argv[2]] : Object.keys(scenarios)
let failed = 0
for (const name of which) {
  try {
    console.log(`${name}: ${scenarios[name]()}`)
  } catch (e) {
    failed++
    console.log(`${name}: FAIL ${e.message}`)
  }
}
process.exit(failed ? 1 : 0)
