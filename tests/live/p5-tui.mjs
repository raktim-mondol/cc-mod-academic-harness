#!/usr/bin/env node
// Live P5 interface checks, in a real terminal session (tmux on a private socket, killed afterwards): what a person sees.
//
//   node tests/live/p5-tui.mjs             all checks
//   node tests/live/p5-tui.mjs pane_wide   one or more by name
//
//   status       in a project folder the line under the prompt reads "research mode on · gate ..." (the gate comes from the engine)
//   pane_wide    104 columns: /academic opens the pane inline across the terminal, two columns (Project left; Jobs, Notebook, Library right), the four parts, the gate
//   pane_narrow  72 columns: the same pane in one column (Jobs under Project), no line wider than the terminal
//   pane_docked  200 columns: the pane docks beside the transcript and takes its own, narrower width: one column
//   task         /ah-papers runs from the prompt box and prints the search result, with no permission dialog and no model turn
//   fold         after a reply, /fold gist prints the folded reply
//   job          /ah-research starts a job that outlives the call: the line says "1 job running", the pane's Jobs part shows it,
//                the job ends, the line drops it, and the completion notice reaches the model, which reports the report
// Needs tmux and a working `claude` login. status and the panes need the engine's fixture venv (node scripts/test-engine.mjs).
// task and fold cost a few cents (fold) or nothing (task); job costs about 10 cents on Haiku.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const base = join(homedir(), '.cache', 'ah-cc-p5', 'tui-tests')
const engine = join(root, 'upstream', 'vendor', 'academic-harness')
const testPython = join(homedir(), '.cache', 'ah-cc-p3', 'engine-test', 'venv', 'bin', 'python')
const SOCK = 'ahp5'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const tmux = (...args) => spawnSync('tmux', ['-L', SOCK, ...args], { encoding: 'utf8' })
const screen = () => tmux('capture-pane', '-p', '-J', '-S', '-300', '-t', 'main').stdout
/** What is on the screen now, without the scrollback: where the panes and the line are. */
const visible = () => tmux('capture-pane', '-p', '-t', 'main').stdout
const send = (...keys) => tmux('send-keys', '-t', 'main', ...keys)
const type = async text => { tmux('send-keys', '-t', 'main', '-l', text); await sleep(700); tmux('send-keys', '-t', 'main', 'Enter') }

async function until(test, { timeoutMs = 90_000, every = 1500, label, from = screen }) {
  const end = Date.now() + timeoutMs
  for (;;) {
    const s = from()
    if (test(s)) return s
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`)
    if (/trust the files in this folder|Yes, I trust|trust this folder/i.test(s)) send('Enter')
    await sleep(every)
  }
}

function projectFixture(name) {
  assert.ok(existsSync(testPython), 'the engine test venv is missing: run node scripts/test-engine.mjs first')
  const dir = join(base, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const code = `import sys; from pathlib import Path; sys.path.insert(0, ${JSON.stringify(join(engine, 'tests'))}); from conftest import write_anchored_project; write_anchored_project(Path(${JSON.stringify(dir)}))`
  const r = spawnSync(testPython, ['-c', code], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: '' } })
  assert.equal(r.status, 0, `fixture failed: ${r.stderr}`)
  return dir
}

async function session(name, { project = false, columns = 200, rows = 50, env = '' } = {}) {
  let dir
  if (project) dir = projectFixture(name)
  else {
    dir = join(base, name)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
  }
  const home = join(base, `${name}-home`)
  rmSync(home, { recursive: true, force: true })
  tmux('kill-server')
  execFileSync('tmux', ['-L', SOCK, 'new-session', '-d', '-s', 'main', '-x', String(columns), '-y', String(rows), '-c', dir, `env AH_MOD_HOME=${home} ${env} claude --plugin-dir ${root} --model haiku --permission-mode default`])
  await until(s => /❯/.test(s) && /Haiku|haiku/.test(s), { timeoutMs: 90_000, label: 'the prompt box' })
  await sleep(2000)
  return { dir, home }
}

const lineWith = (text, ...words) => text.split('\n').find(l => words.every(w => l.includes(w)))
const finished = () => until(s => /✻ .* for \d+s/.test(s) || /Interrupted/.test(s), { timeoutMs: 120_000, label: 'the turn to end' })

const checks = {
  async status() {
    await session('status', { project: true })
    const s = await until(x => /research mode on · gate (PASS|FAIL)/.test(visible()), { label: 'the status line with the gate', from: visible, timeoutMs: 60_000 })
    return `the line reads "${/research mode on · gate [^\n]*/.exec(s)[0].trim()}"`
  },
  async pane_wide() {
    await session('pane_wide', { project: true, columns: 104, rows: 50 })
    await until(() => /gate (PASS|FAIL)/.test(visible()), { label: 'the gate on the line', from: visible, timeoutMs: 60_000 })
    await type('/academic')
    const s = await until(x => ['Project', 'Jobs', 'Notebook', 'Library', 'Gate now'].every(w => x.includes(w)), { label: 'the pane', from: visible, timeoutMs: 40_000 })
    const top = lineWith(s, 'Project', 'Jobs')
    assert.ok(top, `wide: Project and Jobs should share a row:\n${s}`)
    const right = top.indexOf('Jobs')
    assert.ok(right > 20, 'Jobs is in the right column')
    const rowOf = w => s.split('\n').findIndex(l => l.includes(w, right - 1))
    assert.ok(rowOf('Library') > rowOf('Notebook') && rowOf('Notebook') > rowOf('Jobs'), `Jobs, Notebook and Library stack in the right column:\n${s}`)
    assert.match(s, /Gate now: (PASS|FAIL)/)
    assert.match(s, /No background jobs/)
    return 'two columns: Project left, Jobs, Notebook and Library stacked right, the gate is shown'
  },
  async pane_narrow() {
    await session('pane_narrow', { project: true, columns: 72, rows: 56 })
    await until(() => /gate (PASS|FAIL)/.test(visible()), { label: 'the gate on the line', from: visible, timeoutMs: 60_000 })
    await type('/academic')
    const s = await until(x => ['Project', 'Jobs', 'Notebook', 'Library'].every(w => x.includes(w)), { label: 'the pane', from: visible, timeoutMs: 40_000 })
    assert.equal(lineWith(s, 'Project', 'Jobs'), undefined, `narrow: Project and Jobs must not share a row:\n${s}`)
    const rowOf = w => s.split('\n').findIndex(l => l.trim() === w || l.includes(` ${w}`) || l.startsWith(w))
    const order = ['Project', 'Jobs', 'Notebook', 'Library'].map(rowOf)
    assert.ok(order.every(n => n >= 0) && order.every((n, i) => i === 0 || n > order[i - 1]), `one column in order, rows ${order}:\n${s}`)
    for (const l of s.split('\n')) assert.ok(l.length <= 72, `a line is wider than the terminal: ${l}`)
    return `one column, the four parts in order (rows ${order.join(', ')})`
  },
  async pane_docked() {
    await session('pane_docked', { project: true, columns: 200, rows: 50 })
    await until(() => /gate (PASS|FAIL)/.test(visible()), { label: 'the gate on the line', from: visible, timeoutMs: 60_000 })
    await type('/academic')
    const s = await until(x => ['Project', 'Jobs', 'Notebook', 'Library'].every(w => x.includes(w)) && x.includes('│'), { label: 'the docked pane', from: visible, timeoutMs: 40_000 })
    const bar = s.split('\n').find(l => /│Project/.test(l))
    assert.ok(bar, `docked: the pane should sit right of a divider:\n${s}`)
    assert.ok(bar.indexOf('│') > 90, 'the dock sits at the right of the terminal')
    assert.equal(lineWith(s, 'Project', 'Jobs'), undefined, 'a docked pane is about 90 columns: one column')
    return 'docked beside the transcript, one column, all four parts in view'
  },
  async task() {
    await session('task')
    await type('/ah-papers --effort low sparse autoencoders interpretability')
    // The result is long and Claude Code draws it in its own scroll region, so its first lines can be off screen: wait for its last one.
    const s = await until(x => /<\/untrusted-source>/.test(x), { label: 'the end of the search result', timeoutMs: 150_000 })
    assert.doesNotMatch(s.slice(s.lastIndexOf('/ah-papers')), /Do you want to proceed|requires confirmation|1\. Yes/i, 'a dialog was shown for the person\'s own command')
    assert.match(s, /sources: openalex/)
    return 'the command printed the search result, no dialog (its first lines are checked headless, tests/live/p5.mjs papers)'
  },
  async fold() {
    await session('fold')
    await type('Write exactly three paragraphs of about 60 words each about why the sky is blue, with a heading "# Sky" first and a bullet list of three short points after them. No tools.')
    await finished()
    await sleep(1500)
    await type('/fold gist')
    const s = await until(x => /Last reply, folded to gist: \d+ of \d+ words/.test(x), { label: 'the folded reply', timeoutMs: 40_000 })
    const [shown, total] = /: (\d+) of (\d+) words/.exec(s).slice(1).map(Number)
    assert.ok(shown < total, `${shown} of ${total}`)
    return `the last reply folded to ${shown} of ${total} words`
  },
  async job() {
    const { home } = await session('job', { columns: 200, rows: 50, env: 'AH_LLM_MODEL=haiku AH_LLM_BUDGET_USD=1.5 AH_JOB_FOREGROUND_MS=6000' })
    await type('/ah-research --effort low Quickly: what is retrieval-augmented generation, and name the original paper?')
    const running = await until(() => /research mode (on|off) · 1 job running/.test(visible()), { label: 'the line to say a job runs', from: visible, timeoutMs: 120_000, every: 1000 })
    assert.match(running, /1 job running/)
    await type('/academic')
    const pane = await until(x => /▶ job-/.test(x) && x.includes('Jobs'), { label: 'the pane to list the running job', from: visible, timeoutMs: 30_000, every: 1000 })
    assert.match(pane, /▶ job-\S+ deep_research/)
    const s = await until(x => /Background job job-\S+ finished/.test(x), { label: 'the completion notice', timeoutMs: 420_000, every: 3000 })
    assert.match(s, /Background job job-\S+ finished/)
    await until(() => !/1 job running/.test(visible()), { label: 'the line to drop the finished job', from: visible, timeoutMs: 30_000, every: 1000 })
    return 'the line said "1 job running", the pane listed it, the notice arrived, the line dropped it'
  },
}

const which = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(checks)
let failed = 0
for (const name of which) {
  if (!checks[name]) { console.log(`${name}: unknown check`); failed++; continue }
  try {
    console.log(`${name}: ok: ${await checks[name]()}`)
  } catch (e) {
    failed++
    console.log(`${name}: FAIL ${e.message}\n--- screen ---\n${visible().split('\n').filter(l => l.trim()).slice(-30).join('\n')}`)
  } finally {
    tmux('kill-server')
  }
}
process.exit(failed ? 1 : 0)
