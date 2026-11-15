#!/usr/bin/env node
// Live P4 interactive scenario, in a real terminal session (tmux on a private socket, killed afterwards):
// a deep research run starts, goes on as a background job, ends, and the session raises the completion notice and
// prompts the model, which reads the result and carries on (a `start` that ends is followed by `run`, a second job, a
// second notice). The model is told NOT to call job_wait, so the only way it learns a job ended is the notice.
//
//   node tests/live/p4-tui.mjs
//
// Costs about 10 cents. Needs tmux and a working `claude` login. On failure the last screen is printed.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const base = join(homedir(), '.cache', 'ah-cc-p4', 'tui')
const SOCK = 'ahp4'
const PREFIX = 'mcp__plugin_academic-harness_ah__'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const tmux = (...args) => spawnSync('tmux', ['-L', SOCK, ...args], { encoding: 'utf8' })
const screen = () => tmux('capture-pane', '-p', '-J', '-S', '-200', '-t', 'main').stdout
const type = text => { tmux('send-keys', '-t', 'main', '-l', text); tmux('send-keys', '-t', 'main', 'Enter') }

async function until(test, { timeoutMs, every = 2000, label }) {
  const end = Date.now() + timeoutMs
  for (;;) {
    const s = screen()
    const hit = test(s)
    if (hit) return s
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`)
    // the first start asks to trust the folder
    if (/trust the files in this folder|Yes, I trust|trust this folder/i.test(s)) tmux('send-keys', '-t', 'main', 'Enter')
    await sleep(every)
  }
}

const cwd = join(base, 'proj')
const home = join(base, 'home')
rmSync(base, { recursive: true, force: true })
mkdirSync(cwd, { recursive: true })
let last = ''
try {
  tmux('kill-server')
  const allow = ['ToolSearch', `${PREFIX}deep_research`, `${PREFIX}job_status`, `${PREFIX}job_wait`, 'Read'].join(',')
  const env = `AH_MOD_HOME=${home} AH_LLM_MODEL=haiku AH_LLM_BUDGET_USD=1.5 AH_JOB_FOREGROUND_MS=3000`
  execFileSync('tmux', ['-L', SOCK, 'new-session', '-d', '-s', 'main', '-x', '200', '-y', '50', '-c', cwd, `env ${env} claude --plugin-dir ${root} --model haiku --allowedTools ${allow}`])
  await until(s => /❯|> /.test(s) && /plugin|haiku|Haiku/i.test(s), { timeoutMs: 90_000, label: 'the prompt box' })
  await sleep(2000)
  type("Use the academic-harness deep_research tool (load it with ToolSearch). Call it with action 'start', effort 'low' and this query word for word: 'Quickly: what is retrieval-augmented generation, and name the original paper?'. Then call it with action 'run' and the run_id. When a call says the run is going on as a background job, do NOT call job_wait or poll: tell me in one sentence that it is running and stop. You will be told when it ends.")
  // the model's `start` call may itself go on as a job; its notice then prompts it to call `run`, which goes on as a second job
  const ended = s => new Set([...s.matchAll(/Background job (job-\S+) (?:finished|failed)/g)].map(m => m[1]))
  last = await until(s => ended(s).size >= 1, { timeoutMs: 300_000, every: 5000, label: 'the first completion notice' })
  const reportFile = join(cwd, '.dsh', 'deep-research', 'dr-0001', 'artifacts', 'final-report.md')
  last = await until(s => existsSync(reportFile) && s.lastIndexOf('Background job') >= 0 && /\.dsh\/deep-research|report/i.test(s.slice(s.lastIndexOf('Background job'))) && /✻|Crunched|Cogitated|Worked for/.test(s.slice(s.lastIndexOf('Background job'))), { timeoutMs: 600_000, every: 5000, label: 'the report and the model reporting it' })
  const jobsDir = join(home, 'jobs')
  const jobs = existsSync(jobsDir) ? readdirSync(jobsDir).filter(n => n.endsWith('.json')).map(n => JSON.parse(readFileSync(join(jobsDir, n), 'utf8'))) : []
  assert.ok(jobs.some(j => j.kind === 'deep_research' && j.status === 'completed'), `job states: ${jobs.map(j => `${j.kind}:${j.status}`)}`)
  assert.ok(existsSync(reportFile), 'no report')
  assert.ok(jobs.length >= 1 && jobs.every(j => j.status === 'completed'), 'a job did not complete')
  console.log(`--- screen after the last notice ---\n${screen().slice(screen().lastIndexOf('Prompt from the academic-harness plugin')).split('\n').filter(l => l.trim()).slice(0, 14).join('\n')}\n---`)
  console.log('p4-tui: ok: the job ended, the notice appeared, the model read the result and reported it')
} catch (e) {
  console.log(`p4-tui: FAIL ${e.message}\n--- last screen ---\n${screen() || last}`)
  process.exitCode = 1
} finally {
  tmux('kill-server')
}
