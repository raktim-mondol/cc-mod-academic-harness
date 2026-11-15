#!/usr/bin/env node
// Live P4 scenarios: nested `claude -p` runs (Haiku, budget-capped) with the mod loaded by --plugin-dir.
//
//   node tests/live/p4.mjs                 every scenario
//   node tests/live/p4.mjs deep_research   one or more by name
//
// deep_research  a low-effort deep research run through the model route: the call goes on as a job, the model waits with
//                job_wait, the report is on disk, and the job record says completed. Model calls run as headless Claude
//                Code children on Haiku with a $1.5 cap.
// compute_ask    a paid-compute call is refused under -p with the approval text, and nothing is rented or recorded.
// power          a tool from one of the plain new areas (analysis) runs and its answer reaches the model.
// deep_review    a real manuscript review on the model route (Haiku): the engine's comments are stored, the job completed.
// analysis       analysis_run: a frozen plan, a run of python3, the manifest on disk.
// job_surface    the job tools and the model route's settings are visible to the model.
// The interactive notice (job ends -> notification -> the model picks the result up) needs a terminal: tests/live/p4-tui.mjs.
// Costs a few cents each, the deep research one about 10 cents. Needs a working `claude` login.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const base = join(homedir(), '.cache', 'ah-cc-p4', 'live-tests')
const PREFIX = 'mcp__plugin_academic-harness_ah__'

function run(name, prompt, { allow, env = {}, budget = '0.6', timeout = 600_000, files = {} } = {}) {
  const cwd = join(base, name)
  rmSync(cwd, { recursive: true, force: true })
  mkdirSync(cwd, { recursive: true })
  for (const [to, from] of Object.entries(files)) copyFileSync(from, join(cwd, to))
  const home = join(base, `${name}-home`)
  rmSync(home, { recursive: true, force: true })
  const args = ['-p', prompt, '--plugin-dir', root, '--model', 'haiku', '--max-budget-usd', budget, '--allowedTools', allow.join(','), '--output-format', 'stream-json', '--verbose']
  const r = spawnSync('claude', args, { cwd, encoding: 'utf8', timeout, maxBuffer: 1 << 28, env: { ...process.env, AH_MOD_HOME: home, ...env } })
  const events = r.stdout.split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
  const calls = events.filter(e => e.type === 'assistant').flatMap(e => e.message.content.filter(b => b.type === 'tool_use'))
  const results = events.filter(e => e.type === 'user').flatMap(e => (Array.isArray(e.message?.content) ? e.message.content : []).filter(b => b.type === 'tool_result'))
    .map(b => ({ id: b.tool_use_id, error: Boolean(b.is_error), text: typeof b.content === 'string' ? b.content : (b.content ?? []).map(c => c.text ?? '').join('\n') }))
  const init = events.find(e => e.type === 'system' && e.subtype === 'init')
  const result = events.find(e => e.type === 'result')
  return { cwd, home, raw: r.stdout + r.stderr, events, calls, results, init, result, status: r.status }
}

const resultOf = (r, call) => r.results.find(x => x.id === call.id)
const cost = r => `$${(r.result?.total_cost_usd ?? 0).toFixed(3)}`
const jobsOf = r => {
  const dir = join(r.home, 'jobs')
  return existsSync(dir) ? readdirSync(dir).filter(n => n.endsWith('.json')).map(n => JSON.parse(readFileSync(join(dir, n), 'utf8'))) : []
}

const fixture = n => join(root, 'tests', 'fixtures', n)

const scenarios = {
  deep_review() {
    const r = run('deep_review', "Use the academic-harness deep_review tool (load it with ToolSearch) on manuscript.md: first action 'estimate' with topology LOW, then action 'review' with topology LOW and thinking_level LOW. If the review goes on as a background job, call job_wait with its job id (seconds 60) until it ends. Reply with the number of comments the review found.",
      { allow: ['ToolSearch', `${PREFIX}deep_review`, `${PREFIX}job_wait`, `${PREFIX}job_status`], files: { 'manuscript.md': fixture('manuscript.md') }, env: { AH_LLM_MODEL: 'haiku', AH_LLM_BUDGET_USD: '1.5', AH_JOB_FOREGROUND_MS: '15000' }, budget: '1.0', timeout: 900_000 })
    const calls = r.calls.filter(c => c.name === `${PREFIX}deep_review`)
    assert.ok(calls.some(c => c.input.action === 'review'), `no review call: ${calls.map(c => c.input.action)}`)
    const jobs = jobsOf(r).filter(j => j.kind === 'deep_review')
    assert.ok(jobs.length >= 1 && jobs.every(j => j.status === 'completed'), `job states: ${jobs.map(j => j.status)}`)
    const dir = join(r.cwd, '.dsh', 'deep-review')
    const keys = existsSync(dir) ? readdirSync(dir) : []
    assert.ok(keys.length === 1, `stored reviews: ${keys}`)
    const review = JSON.parse(readFileSync(join(dir, keys[0], 'review.json'), 'utf8'))
    const comments = (review.result?.anchoredComments ?? []).length
    assert.ok(comments >= 1, `no anchoredComments in review.json`)
    assert.match(r.result?.result ?? '', /\d+/)
    return `review ran on the model route, ${comments} comments stored, answer "${String(r.result.result).trim().slice(0, 50)}", ${cost(r)}`
  },
  analysis() {
    const r = run('analysis', "Use the academic-harness analysis_run tool (load it with ToolSearch). Call action 'plan' with slug demo and a plan {question: 'Is the mean of 1..10 equal to 5.5?', hypotheses: ['mean = 5.5'], inputs: [], outputs: ['out.json'], methods: ['python'], alpha: 0.05, seed: 1}. The file calc.py is in the folder: call action 'run' with slug demo, command ['python3', 'calc.py'] and outputs ['out.json']. Then call action 'status' with slug demo and tell me the exit code of the run.",
      { allow: ['ToolSearch', `${PREFIX}analysis_run`, `${PREFIX}job_wait`, `${PREFIX}job_status`, 'Write'], env: { AH_JOB_FOREGROUND_MS: '30000' }, files: { 'calc.py': fixture('calc.py') } })
    const calls = r.calls.filter(c => c.name === `${PREFIX}analysis_run`).map(c => c.input.action)
    assert.deepEqual(['plan', 'run'].filter(a => !calls.includes(a)), [], `calls: ${calls}`)
    assert.ok(existsSync(join(r.cwd, 'out.json')), 'the analysis did not produce out.json')
    const runs = join(r.cwd, '.dsh', 'analysis', 'demo', 'runs')
    assert.ok(existsSync(runs) && readdirSync(runs).length >= 1, 'no run manifest')
    return `plan frozen, run recorded (${readdirSync(runs).length}), output written, ${cost(r)}`
  },
  deep_research() {
    const r = run('deep_research',
      "Use the academic-harness deep_research tool (load it with ToolSearch). Call it with action 'start', effort 'low', and this query word for word: 'Quickly: what is retrieval-augmented generation, and name the original paper?'. Then call it again with action 'run' and the run_id it gave. If a call says the run is going on as a background job, call job_wait with that job id (seconds 60) again and again until the job has ended. Finally say the title of the report's first heading.",
      { allow: ['ToolSearch', `${PREFIX}deep_research`, `${PREFIX}job_wait`, `${PREFIX}job_status`, 'Read'], env: { AH_LLM_MODEL: 'haiku', AH_LLM_BUDGET_USD: '1.5', AH_JOB_FOREGROUND_MS: '15000' }, budget: '1.0', timeout: 900_000 })
    const server = r.init.mcp_servers.find(s => s.name === 'plugin:academic-harness:ah')
    assert.equal(server?.status, 'connected')
    const dr = r.calls.filter(c => c.name === `${PREFIX}deep_research`)
    assert.ok(dr.length >= 2, `deep_research was called ${dr.length} time(s)`)
    const jobs = jobsOf(r).filter(j => j.kind === 'deep_research')
    assert.ok(jobs.length >= 1, 'no deep_research job record')
    assert.ok(jobs.every(j => j.status === 'completed'), `job states: ${jobs.map(j => j.status)}`)
    const report = join(r.cwd, '.dsh', 'deep-research', 'dr-0001', 'artifacts', 'final-report.md')
    assert.ok(existsSync(report), `no report at ${report}`)
    const heading = /^# (.+)$/m.exec(readFileSync(report, 'utf8'))?.[1]
    assert.ok(heading, 'the report has no title')
    const waited = r.calls.filter(c => c.name === `${PREFIX}job_wait`).length
    return `run completed (${jobs.length} job record(s), job_wait x${waited}), report "${heading.slice(0, 60)}", ${cost(r)}`
  },
  compute_ask() {
    const r = run('compute_ask', `Use ToolSearch to load the modal_run tool of the academic-harness server, then call it with command "echo hello" and timeout_sec 60. This is a deliberate test of the approval: if the call is refused, do not try another way, just report the exact refusal message.`,
      { allow: ['ToolSearch', `${PREFIX}modal_run`] })
    const call = r.calls.find(c => c.name === `${PREFIX}modal_run`)
    assert.ok(call, `the model did not call modal_run: ${r.calls.map(c => c.name)}`)
    const res = resultOf(r, call)
    assert.equal(res?.error, true, 'modal_run ran without anyone confirming')
    assert.match(res.text, /will rent paid hardware/)
    assert.match(res.text, /interactive session/)
    assert.equal(existsSync(join(r.home, 'compute-ledger', 'spend.jsonl')), false, 'a spend was recorded for a refused run')
    return `refused with the approval text, nothing recorded, ${cost(r)}`
  },
  power() {
    const r = run('power', 'Use ToolSearch to find the power_analysis tool of the academic-harness server and use it: how many participants per group for a two-sided independent-samples t-test, effect size d = 0.5, alpha 0.05, power 0.8? Reply with the number only.',
      { allow: ['ToolSearch', `${PREFIX}power_analysis`] })
    const call = r.calls.find(c => c.name === `${PREFIX}power_analysis`)
    assert.ok(call, `the model did not call power_analysis: ${r.calls.map(c => c.name)}`)
    assert.equal(resultOf(r, call)?.error, false, resultOf(r, call)?.text)
    assert.match(r.result?.result ?? '', /6[34]/)
    return `answer ${String(r.result.result).trim().slice(0, 40)}, ${cost(r)}`
  },
  job_surface() {
    const r = run('job_surface', 'Use ToolSearch with the query "job_status job_wait job_log job_kill deep_review analysis_run" and tell me which of those tool names exist, comma separated, nothing else.',
      { allow: ['ToolSearch'] })
    const text = String(r.result?.result ?? '')
    for (const n of ['job_status', 'job_wait', 'job_log', 'job_kill', 'deep_review', 'analysis_run']) assert.match(text, new RegExp(n), `${n} not found: ${text.slice(0, 200)}`)
    return `all six found, ${cost(r)}`
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
