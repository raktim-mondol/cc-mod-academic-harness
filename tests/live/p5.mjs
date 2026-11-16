#!/usr/bin/env node
// Live P5 scenarios, headless (`claude -p`, the mod loaded by --plugin-dir). The interface itself (status line, pane, notices) needs a
// terminal: tests/live/p5-tui.mjs.
//
//   node tests/live/p5.mjs                 every scenario
//   node tests/live/p5.mjs papers errors   some, by name
//
// papers    `/ah-papers --effort low ...` runs literature_search through $.tool.call from the command hook, with no model call and no
//           permission rule (cost 0), and the answer is the command's output. Reads OpenAlex (public, read-only).
// errors    a missing file, a path outside the folder, an empty line and a bad effort are refused with the usage, before any tool starts.
// status    the one status line the mod pins: the mode, and nothing from the interface timers in a headless run.
// fold      a reply of the model is folded by /fold in a resumed session (two Haiku turns, a few cents).
// research  `/ah-research --effort low ...` frames the run (start, run:false) and starts it with the run id (Haiku on the model route,
//           $1.5 cap): the command's output names the job, and a job record exists.
// Needs a working `claude` login. papers, errors and status cost nothing.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const base = join(homedir(), '.cache', 'ah-cc-p5', 'live-tests')

function run(name, prompt, { env = {}, budget = '0.5', timeout = 300_000, resume, files = {}, keep = false } = {}) {
  const cwd = join(base, name)
  if (!keep) rmSync(cwd, { recursive: true, force: true })
  mkdirSync(cwd, { recursive: true })
  for (const [to, text] of Object.entries(files)) writeFileSync(join(cwd, to), text)
  const home = join(base, `${name}-home`)
  if (!keep) rmSync(home, { recursive: true, force: true })
  const args = ['-p', prompt, '--plugin-dir', root, '--model', 'haiku', '--max-budget-usd', budget, '--output-format', 'stream-json', '--verbose']
  if (resume) args.push('--resume', resume)
  const r = spawnSync('claude', args, { cwd, encoding: 'utf8', timeout, maxBuffer: 1 << 28, input: '', env: { ...process.env, AH_MOD_HOME: home, AH_MANAGED_INSTALLS: '0', AH_AUTO_INSTALL: '0', ...env } })
  const events = r.stdout.split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
  const said = events.filter(e => e.type === 'assistant').flatMap(e => e.message.content.filter(b => b.type === 'text').map(b => b.text)).join('\n')
  const result = events.find(e => e.type === 'result')
  const status = events.filter(e => e.type === 'system' && e.subtype === 'ui_status').map(e => e.text)
  const calls = events.filter(e => e.type === 'assistant').flatMap(e => e.message.content.filter(b => b.type === 'tool_use'))
  return { cwd, home, events, said, result, status, calls, session: events.find(e => e.type === 'system' && e.subtype === 'init')?.session_id, raw: r.stdout + r.stderr }
}
const cost = r => `$${(r.result?.total_cost_usd ?? 0).toFixed(3)}`
const jobsOf = r => {
  const dir = join(r.home, 'jobs')
  return existsSync(dir) ? readdirSync(dir).filter(n => n.endsWith('.json')).map(n => JSON.parse(readFileSync(join(dir, n), 'utf8'))) : []
}

const scenarios = {
  papers() {
    const r = run('papers', '/ah-papers --effort low sparse autoencoders interpretability')
    assert.equal(r.result?.is_error, false, r.raw.slice(-400))
    assert.equal(r.result?.num_turns, 0, 'a task command must not start a model turn')
    assert.equal(r.result?.total_cost_usd, 0, 'a task command must not cost anything by itself')
    assert.match(r.said, /Find Papers \(effort low\)/)
    assert.match(r.said, /→ Searching for “sparse autoencoders interpretability” \(10\)/)
    assert.match(r.said, /Literature search: "sparse autoencoders interpretability"/)
    assert.match(r.said, /\b10 unique\b|\bshowing \d+\b/)
    assert.deepEqual(r.result?.permission_denials, [])
    return `literature_search ran from the command hook, no model turn, ${cost(r)}`
  },
  errors() {
    const cases = [
      ['/ah-papers', /enter a search query first[\s\S]*Usage: \/ah-papers/],
      ['/ah-papers --effort extreme x', /effort must be auto, low, medium, or high/],
      ['/ah-review nowhere.tex', /file not found: nowhere\.tex/],
      ['/ah-review ../outside.tex', /path escapes the workspace/],
      ['/ah-write a.tex', /compares two manuscript versions|file not found/],
      ['/ah-references', /enter a bibliography path first/],
    ]
    for (const [line, expected] of cases) {
      const r = run('errors', line, { keep: false })
      assert.equal(r.result?.num_turns, 0, `${line}: no model turn`)
      assert.match(r.said, expected, `${line}: ${r.said.slice(0, 300)}`)
      assert.equal(r.calls.length, 0, `${line}: no tool call`)
    }
    return `${cases.length} refusals, each with its reason, no tool started`
  },
  status() {
    const outside = run('status_out', '/academic status')
    assert.match(outside.said, /Research mode is off \(auto: no ah\.yaml here\)/)
    assert.deepEqual([...new Set(outside.status)], ['research mode off'])
    const inside = run('status_in', '/academic status', { files: { 'ah.yaml': 'project: p5\n' } })
    assert.deepEqual([...new Set(inside.status)], ['research mode on'])
    return `one line per plugin: "${outside.status.at(-1)}" outside, "${inside.status.at(-1)}" inside; a headless run has no timers to add to it`
  },
  fold() {
    const first = run('fold', 'Write exactly three paragraphs of about 60 words each about why the sky is blue, with a heading "# Sky" first and a bullet list of three short points after them. No tools.')
    assert.ok(first.session, 'the first run has a session id')
    assert.ok(first.said.length > 400, `the first reply was short: ${first.said.length}`)
    const second = run('fold', '/fold gist', { resume: first.session, keep: true })
    assert.match(second.said, /Last reply, folded to gist: \d+ of \d+ words/, second.said.slice(0, 300))
    const [shown, total] = /: (\d+) of (\d+) words/.exec(second.said).slice(1).map(Number)
    assert.ok(shown < total, `gist hid nothing: ${shown} of ${total}`)
    assert.equal(second.result?.num_turns, 0)
    return `/fold gist on the last reply: ${shown} of ${total} words, no model turn, ${cost(first)}`
  },
  research() {
    const r = run('research', '/ah-research --effort low Quickly: what is retrieval-augmented generation, and name the original paper?', { env: { AH_LLM_MODEL: 'haiku', AH_LLM_BUDGET_USD: '1.5', AH_JOB_FOREGROUND_MS: '600000' }, budget: '1.0', timeout: 900_000 })
    assert.equal(r.result?.is_error, false, r.raw.slice(-400))
    assert.match(r.said, /→ Framing research questions/)
    assert.match(r.said, /→ Running the research run/)
    assert.doesNotMatch(r.said, /stopped at|did not start/, r.said.slice(0, 600))
    const jobs = jobsOf(r).filter(j => j.kind === 'deep_research')
    assert.ok(jobs.length >= 1, `no deep_research job record; output: ${r.said.slice(0, 500)}`)
    assert.ok(existsSync(join(r.cwd, '.dsh', 'deep-research')), 'the run left nothing under .dsh/deep-research')
    return `framed, started (${jobs.length} job record, status ${jobs[0].status}), the output names it, ${cost(r)}`
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
