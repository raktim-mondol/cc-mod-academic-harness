#!/usr/bin/env node
// Live checks of what the mod leaves out (server/src/fit.mjs) and the research-mode text written for Claude Code. Nested `claude -p`, Haiku.
//
//   node tests/live/fit.mjs                 all
//   node tests/live/fit.mjs search_route    one or more by name
//
// catalogue     what Claude Code lists from the mod: 60 skills (the 10 duplicates of agents and of Anthropic's own skills are
//               gone, the 17 niche ones are on demand), 21 agents, none of the 12 dropped tools, and the unified literature_search
// restore       AH_RESTORE_TOOLS=brave_search brings that one tool back, and only that one
// search_route  asked for papers, the model reaches for an academic search tool through ToolSearch, not for WebSearch (the guidance says which)
// on_demand     a skill that is not in the catalogue is found with skill_search and read with skill_load
// Costs a few cents. Needs a working `claude` login.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const base = join(homedir(), '.cache', 'ah-cc-p6', 'live-tests')
const PREFIX = 'mcp__plugin_academic-harness_ah__'

function run(name, prompt, { allow = [], env = {}, project = true, budget = '0.5' } = {}) {
  const cwd = join(base, name)
  rmSync(cwd, { recursive: true, force: true })
  mkdirSync(cwd, { recursive: true })
  if (project) writeFileSync(join(cwd, 'ah.yaml'), 'project: fit\n')
  const args = ['-p', prompt, '--plugin-dir', root, '--model', 'haiku', '--max-budget-usd', budget, '--output-format', 'stream-json', '--verbose']
  if (allow.length) args.push('--allowedTools', allow.join(','))
  const r = spawnSync('claude', args, { cwd, encoding: 'utf8', timeout: 300_000, maxBuffer: 1 << 28, input: '', env: { ...process.env, AH_MOD_HOME: join(base, `${name}-home`), AH_MANAGED_INSTALLS: '0', AH_AUTO_INSTALL: '0', ...env } })
  const events = r.stdout.split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
  const calls = events.filter(e => e.type === 'assistant').flatMap(e => e.message.content.filter(b => b.type === 'tool_use'))
  return { init: events.find(e => e.type === 'system' && e.subtype === 'init'), calls, result: events.find(e => e.type === 'result') }
}
const cost = r => `$${(r.result?.total_cost_usd ?? 0).toFixed(3)}`

const scenarios = {
  catalogue() {
    const r = run('catalogue', 'Say hi in one word.')
    const i = r.init
    const skills = i.skills.filter(s => s.startsWith('academic-harness:'))
    assert.equal(skills.length, 60, `${skills.length} skills`)
    for (const gone of ['docx', 'pdf', 'pptx', 'xlsx', 'peer-reviewer', 'literature-researcher']) assert.ok(!skills.includes(`academic-harness:${gone}`), gone)
    for (const kept of ['academic-search', 'literature-review', 'academic-harness', 'papermemory', 'research-guides', 'agent-browser', 'modal', 'runpod', 'vastai', 'using-science-superpowers']) assert.ok(skills.includes(`academic-harness:${kept}`), kept)
    const agents = i.agents.filter(a => a.startsWith('academic-harness:'))
    assert.equal(agents.length, 21)
    assert.ok(agents.includes('academic-harness:peer-reviewer') && !agents.includes('academic-harness:pipeline-engineer'))
    const tools = i.tools.filter(t => t.startsWith(PREFIX)).map(t => t.slice(PREFIX.length))
    for (const gone of ['brave_search', 'tavily_search', 'exa_search', 'perplexity_search', 'parallel_search', 'parallel_extract', 'consensus_search', 'elicit_search', 'scientific_result', 'fold_text', 'research_template', 'latex_compile']) assert.ok(!tools.includes(gone), gone)
    for (const kept of ['literature_search', 'paper_get', 'jina_read', 'notebook', 'deep_research', 'ah_state', 'job_wait', 'zvec_index', 'ah_rsi', 'paper_mcp']) assert.ok(tools.includes(kept), kept)
    return `${skills.length} skills, ${agents.length} agents, ${tools.length} ah tools; none of the 12 dropped tools, the unified search stays, ${cost(r)}`
  },
  restore() {
    const r = run('restore', 'Say hi in one word.', { env: { AH_RESTORE_TOOLS: 'brave_search,nonsense', AH_AUTO_PROVIDERS: '0' } })
    const tools = r.init.tools.filter(t => t.startsWith(PREFIX)).map(t => t.slice(PREFIX.length))
    assert.ok(tools.includes('brave_search'), 'brave_search came back')
    assert.ok(!tools.includes('tavily_search'), 'only the named tool came back')
    return `brave_search is served again and the others are not, ${cost(r)}`
  },
  search_route() {
    const r = run('search_route', 'Find three recent papers on sparse autoencoders for language model interpretability and give their titles and years.', { allow: ['ToolSearch', `${PREFIX}literature_search`, `${PREFIX}openalex_search`, `${PREFIX}s2_search`, 'WebSearch', 'WebFetch'] })
    const names = r.calls.map(c => c.name)
    assert.ok(names.some(n => n === `${PREFIX}literature_search` || n === `${PREFIX}openalex_search` || n === `${PREFIX}s2_search`), `no academic search tool was called: ${names}`)
    assert.ok(!names.includes('WebSearch'), `the model searched the web for papers: ${names}`)
    return `the model used ${names.filter(n => n.startsWith(PREFIX)).map(n => n.slice(PREFIX.length)).join(', ')} and no WebSearch, ${cost(r)}`
  },
  on_demand() {
    const r = run('on_demand', 'Use ToolSearch to load skill_search and skill_load of the academic-harness server. Search for a skill about querying the FDA openFDA adverse event API, then load the skill it finds and tell me its first heading.', { allow: ['ToolSearch', `${PREFIX}skill_search`, `${PREFIX}skill_load`] })
    const names = r.calls.map(c => c.name)
    assert.ok(names.includes(`${PREFIX}skill_search`), `skill_search was not called: ${names}`)
    assert.ok(names.includes(`${PREFIX}skill_load`), `skill_load was not called: ${names}`)
    const load = r.calls.find(c => c.name === `${PREFIX}skill_load`)
    assert.match(JSON.stringify(load.input), /openfda/i)
    return `openfda is not in the catalogue and was found and loaded on demand, ${cost(r)}`
  },
  // skill_auto    in a project (research mode on), a research task that a skill covers makes the model load a skill itself, with no request to; a greeting loads none
  skill_auto() {
    const task = run('skill_auto_task', 'I have survey data and a hunch that sleep affects exam scores. Help me turn that into a plan I can test before I look at any outcomes.', { allow: ['Skill'] })
    const loaded = task.calls.filter(c => c.name === 'Skill').map(c => String(c.input.skill ?? c.input.name))
    assert.ok(loaded.some(n => /academic-harness:/.test(n)), `no academic-harness skill was loaded by itself: ${task.calls.map(c => c.name)}`)
    const hi = run('skill_auto_hi', 'Hi! What can you do in one sentence?', { allow: ['Skill'] })
    assert.equal(hi.calls.filter(c => c.name === 'Skill').length, 0, `a greeting loaded a skill: ${hi.calls.map(c => c.name)}`)
    return `loaded ${loaded.join(', ')} on its own for the task and none for a greeting, ${cost(task)}+${cost(hi)}`
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
