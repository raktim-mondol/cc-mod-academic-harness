#!/usr/bin/env node
// Live check of the self-improvement loop with a nested Claude Code (Haiku), in an Academic Harness project: off unless a person turns it on, never
// headless, and what it records and adds when it is on.
//
//   node tests/live/rsi.mjs                 all
//   node tests/live/rsi.mjs off headless    some, by name
//
// off         a session at the prompt with nothing set: a preference stated, tools used, a call that fails, and nothing is recorded (no store, no session folder)
// headless    `claude -p` with AH_RSI=auto in the same project: still nothing is recorded
// observe     AH_RSI=observe: the turn, the calls of a step and a failed call are recorded; a stated preference is kept; nothing is added to the next prompt
// auto        AH_RSI=auto: the same, and the lesson comes back as guidance in the next prompt (the model is asked what extra guidance it was given)
// Needs tmux, a working `claude` login, the engine and the fixture venv (node scripts/test-engine.mjs). A few cents each.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const stamp = process.env.RSI_RUN || `run-${Date.now()}`
const base = join(homedir(), '.cache', 'ah-cc-rsi', stamp)
const engine = join(root, 'core', 'vendor', 'academic-harness')
const testPython = join(homedir(), '.cache', 'ah-cc-p3', 'engine-test', 'venv', 'bin', 'python')
const SOCK = 'ahrsi'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const tmux = (...a) => spawnSync('tmux', ['-L', SOCK, ...a], { encoding: 'utf8' })
const screen = () => tmux('capture-pane', '-p', '-J', '-S', '-300', '-t', 'main').stdout
const send = (...keys) => tmux('send-keys', '-t', 'main', ...keys)
const type = async s => { tmux('send-keys', '-t', 'main', '-l', s); await sleep(600); tmux('send-keys', '-t', 'main', 'Enter') }
async function until(test, { timeoutMs = 120_000, every = 1500, label }) {
  const end = Date.now() + timeoutMs
  for (;;) {
    const s = screen()
    if (test(s)) return s
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}\n${s.slice(-600)}`)
    if (/trust the files in this folder|Yes, I trust|trust this folder/i.test(s)) send('Enter')
    await sleep(every)
  }
}
/** How many turns have ended on the screen: Claude Code prints "✻ <verb> for <n>s" at the end of each. */
const turnsEnded = () => (screen().match(/✻ [A-Za-zé]+ for \d+[smh]/g) ?? []).length
/** Wait until one more turn has ended than `before`. */
const turnEnded = async (before, label) => { await until(() => turnsEnded() > before, { timeoutMs: 150_000, label }); return screen() }

function fixture(name) {
  assert.ok(existsSync(testPython), 'the engine test venv is missing: run node scripts/test-engine.mjs first')
  const dir = join(base, name, 'project')
  mkdirSync(dir, { recursive: true })
  const code = `import sys; from pathlib import Path; sys.path.insert(0, ${JSON.stringify(join(engine, 'tests'))}); from conftest import write_anchored_project; write_anchored_project(Path(${JSON.stringify(dir)}))`
  const r = spawnSync(testPython, ['-c', code], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: '' } })
  assert.equal(r.status, 0, `fixture failed: ${r.stderr}`)
  return { dir, home: join(base, name, 'home'), store: join(base, name, 'store') }
}

async function session(name, env = {}) {
  const f = fixture(name)
  tmux('kill-server')
  const envs = Object.entries({ AH_MOD_HOME: f.home, AH_RSI_STORE: f.store, ...env }).map(([k, v]) => `${k}=${v}`).join(' ')
  spawnSync('tmux', ['-L', SOCK, 'new-session', '-d', '-s', 'main', '-x', '200', '-y', '50', '-c', f.dir, `env ${envs} claude --plugin-dir ${root} --model haiku --permission-mode default --allowedTools Read`], { encoding: 'utf8' })
  await until(s => /❯/.test(s) && /Haiku|haiku/.test(s), { timeoutMs: 90_000, label: 'the prompt box' })
  await sleep(2000)
  return f
}
const kill = () => tmux('kill-server')
const lines = (f, name) => (existsSync(join(f.store, name)) ? readFileSync(join(f.store, name), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [])

const PREFERENCE = 'From now on, always spell out a paper\'s DOI in full when you cite it.'
const MISSING = 'Use the Read tool on the file nothing-here.md in this folder and tell me in one sentence what happened.'
const ASK = 'Without using any tool: list the titles of any extra guidance sections your hooks added to your context for this turn, or answer NONE if there are none.'

/** One interactive session: state a preference, make a call that fails, then ask what guidance was added. Returns the screen after each turn. */
async function conversation() {
  let before = turnsEnded()
  await type(PREFERENCE)
  await turnEnded(before, 'the first turn')
  before = turnsEnded()
  await type(MISSING)
  await turnEnded(before, 'the second turn')
  before = turnsEnded()
  await type(ASK)
  const s = await turnEnded(before, 'the third turn')
  await sleep(3000) // the stop hook closes the turn after the screen settles
  return s.slice(Math.max(0, s.lastIndexOf('Without using any tool')))
}

const scenarios = {
  async off() {
    const f = await session('off')
    try {
      await conversation()
      assert.equal(existsSync(f.store), false, 'a store was created with the loop off')
      assert.equal(existsSync(join(f.home, 'rsi-sessions')), false, 'a session folder was created with the loop off')
      return 'a preference, a failing call and three turns, and nothing recorded: no store, no session folder'
    } finally { kill() }
  },
  headless() {
    const f = fixture('headless')
    const r = spawnSync('claude', ['-p', PREFERENCE, '--plugin-dir', root, '--model', 'haiku', '--max-budget-usd', '0.3', '--allowedTools', 'Read'], { cwd: f.dir, encoding: 'utf8', timeout: 240_000, input: '', env: { ...process.env, AH_MOD_HOME: f.home, AH_RSI_STORE: f.store, AH_RSI: 'auto' } })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(existsSync(f.store), false, 'a headless run was recorded')
    assert.equal(existsSync(join(f.home, 'rsi-sessions')), false, 'a headless run left a session folder')
    return 'AH_RSI=auto in `claude -p`: nothing recorded'
  },
  async observe() {
    const f = await session('observe', { AH_RSI: 'observe' })
    try {
      const reply = await conversation()
      const events = lines(f, 'events.jsonl')
      assert.ok(events.filter(e => e.type === 'user_turn').length >= 3, `user turns: ${JSON.stringify(events.map(e => e.type))}`)
      assert.ok(events.some(e => e.type === 'tool' && e.is_error === true), 'the failed Read was not recorded as an error')
      assert.ok(events.some(e => e.type === 'tool' && e.is_error === false), 'no successful call was recorded')
      assert.ok(lines(f, 'episodes.jsonl').length >= 2, 'turns were not closed into episodes')
      assert.ok(lines(f, 'lessons.jsonl').some(r => /DOI/.test(JSON.stringify(r))), 'the stated preference was not kept')
      assert.equal(events.filter(e => e.type === 'lesson_injected').length, 0, 'observe added guidance to a prompt')
      assert.doesNotMatch(reply, /learned guidance/i, 'the model reports guidance in observe mode')
      return `${events.length} events, ${lines(f, 'episodes.jsonl').length} episodes and the preference recorded; nothing added to a prompt`
    } finally { kill() }
  },
  async auto() {
    const f = await session('auto', { AH_RSI: 'auto' })
    try {
      const reply = await conversation()
      const events = lines(f, 'events.jsonl')
      assert.ok(events.some(e => e.type === 'lesson_injected'), `no lesson was injected: ${JSON.stringify(events.map(e => e.type))}`)
      assert.match(reply, /learned guidance/i, `the model was not given the guidance:\n${reply.slice(-500)}`)
      return 'the stated preference came back as guidance, and the model reported it'
    } finally { kill() }
  },
}

const which = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(scenarios)
let failed = 0
for (const name of which) {
  if (!scenarios[name]) { console.log(`${name}: unknown scenario`); failed++; continue }
  try { console.log(`${name}: ok: ${await scenarios[name]()}`) } catch (e) { failed++; console.log(`${name}: FAIL ${String(e.message).slice(0, 900)}`) }
}
kill()
process.exit(failed ? 1 : 0)
