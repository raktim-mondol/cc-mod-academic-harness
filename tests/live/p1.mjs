#!/usr/bin/env node
// Live P1 scenarios: nested `claude -p` (Haiku, budget-capped) with the mod loaded by --plugin-dir.
//
//   node tests/live/p1.mjs               all
//   node tests/live/p1.mjs mode skill    some, by name
//
// init         what Claude Code lists from the mod: the specialist agents, the core skills, /academic, both MCP servers connected and their tools
// mode         the research section is absent outside an ah.yaml tree, present inside one, and present anywhere when the setting says on
// skill        a core skill loads by name
// papermemory  a PaperMemory tool answers on a scratch store (the launcher installs the CLI into the mod's home on first use)
// Costs a few cents. Needs a working `claude` login.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const base = join(homedir(), '.cache', 'ah-cc-p1', 'live-tests')

function run(name, prompt, { allow = [], env = {}, project = false, settings } = {}) {
  const cwd = join(base, name)
  rmSync(cwd, { recursive: true, force: true })
  mkdirSync(cwd, { recursive: true })
  if (project) writeFileSync(join(cwd, 'ah.yaml'), 'project: p1\n')
  const args = ['-p', prompt, '--plugin-dir', root, '--model', 'haiku', '--max-budget-usd', '0.4', '--output-format', 'stream-json', '--verbose']
  if (allow.length) args.push('--allowedTools', allow.join(','))
  if (settings) {
    const f = join(base, `${name}.settings.json`)
    writeFileSync(f, JSON.stringify(settings))
    args.push('--settings', f)
  }
  const r = spawnSync('claude', args, { cwd, encoding: 'utf8', timeout: 240_000, maxBuffer: 1 << 28, env: { ...process.env, AH_MOD_HOME: join(base, 'home'), AH_MANAGED_INSTALLS: '0', AH_AUTO_INSTALL: '0', ...env }, input: '' })
  const events = r.stdout.split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
  const calls = events.filter(e => e.type === 'assistant').flatMap(e => e.message.content.filter(b => b.type === 'tool_use'))
  const results = events.filter(e => e.type === 'user').flatMap(e => (Array.isArray(e.message?.content) ? e.message.content : []).filter(b => b.type === 'tool_result'))
    .map(b => ({ id: b.tool_use_id, error: Boolean(b.is_error), text: typeof b.content === 'string' ? b.content : (b.content ?? []).map(c => c.text ?? '').join('\n') }))
  return { cwd, init: events.find(e => e.type === 'system' && e.subtype === 'init'), calls, results, result: events.find(e => e.type === 'result') }
}
const cost = r => `$${(r.result?.total_cost_usd ?? 0).toFixed(3)}`
const ask = 'Without using any tool: your system prompt may contain a section whose first line is a heading. Quote that heading exactly, or answer NONE if you have no research-mode section.'

const scenarios = {
  init() {
    const r = run('init', 'Say hi in one word.', { project: true })
    const i = r.init
    assert.equal(i.agents.filter(a => a.startsWith('academic-harness:')).length, 21, 'the 21 specialist agents')
    assert.ok(i.skills.filter(s => s.startsWith('academic-harness:')).length >= 54, 'the core skills')
    assert.ok(i.slash_commands.includes('academic'), '/academic')
    for (const n of ['ah', 'papermemory']) assert.equal(i.mcp_servers.find(s => s.name === `plugin:academic-harness:${n}`)?.status, 'connected', `${n} server`)
    const ah = i.tools.filter(t => t.startsWith('mcp__plugin_academic-harness_ah__')).length
    const pm = i.tools.filter(t => t.startsWith('mcp__plugin_academic-harness_papermemory__')).length
    assert.ok(ah >= 125, `${ah} ah tools`)
    assert.equal(pm, 14, 'the 14 PaperMemory tools')
    return `21 agents, ${i.skills.filter(s => s.startsWith('academic-harness:')).length} skills, /academic, ${ah} ah tools, ${pm} PaperMemory tools, ${cost(r)}`
  },
  mode() {
    const out = run('mode_out', ask)
    assert.match(out.result.result, /\bNONE\b/i, `outside a project: ${out.result.result}`)
    const inside = run('mode_in', ask, { project: true })
    assert.match(inside.result.result, /research mode/i, `inside a project: ${inside.result.result}`)
    const set = run('mode_set', ask, { settings: { pluginConfigs: { 'academic-harness@inline': { options: { research_mode: 'on' } } } } })
    assert.match(set.result.result, /research mode/i, `with research_mode on: ${set.result.result}`)
    return `no section outside, the section inside, and with the setting, ${cost(out)}+${cost(inside)}+${cost(set)}`
  },
  skill() {
    const r = run('skill', 'Use the Skill tool to load the skill academic-harness:academic-search, then reply with the single word LOADED.', { allow: ['Skill'] })
    const call = r.calls.find(c => c.name === 'Skill')
    assert.ok(call, 'the Skill tool was not called')
    assert.match(String(call.input.skill ?? call.input.name), /academic-search/)
    assert.equal(r.results.find(x => x.id === call.id)?.error, false)
    return `loaded by name, ${cost(r)}`
  },
  papermemory() {
    const db = join(base, 'papermemory-scratch.db')
    rmSync(db, { force: true })
    const r = run('papermemory', 'Use ToolSearch to load papermemory_recap from the academic-harness papermemory server and call it once. Reply with one sentence on what it returned.', { allow: ['ToolSearch', 'mcp__plugin_academic-harness_papermemory'], env: { PAPERMEMORY_DB: db } })
    const call = r.calls.find(c => /papermemory_recap$/.test(c.name))
    assert.ok(call, `papermemory_recap was not called: ${r.calls.map(c => c.name)}`)
    assert.equal(r.results.find(x => x.id === call.id)?.error, false, r.results.find(x => x.id === call.id)?.text)
    return `answered on a scratch store, ${cost(r)}`
  },
}

const which = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(scenarios)
let failed = 0
for (const name of which) {
  if (!scenarios[name]) {
    console.log(`${name}: unknown scenario`)
    failed++
    continue
  }
  try {
    console.log(`${name}: ok: ${scenarios[name]()}`)
  } catch (e) {
    failed++
    console.log(`${name}: FAIL ${e.message}`)
  }
}
process.exit(failed ? 1 : 0)
