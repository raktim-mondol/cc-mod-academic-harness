#!/usr/bin/env node
// Live P3 interactive matrix, in a real terminal session (tmux on a private socket, killed afterwards). The counterpart of upstream's
// scripts/claude-host-test/tui_matrix.py for the mod: what a person sees when the guard and the approvals work with Claude Code's own
// permission dialogs. Default permission mode, so every call that is not refused outright asks.
//
//   node tests/live/p3-tui.mjs            all checks
//   node tests/live/p3-tui.mjs author     one or more by name
//
//   protected    a write to a protected file is refused with no dialog at all; the file is unchanged
//   allowed_no   an allowed edit asks (Claude Code's own dialog); No leaves the file unchanged
//   allowed_yes  the same edit, Yes: it is written and the post-edit check runs
//   author_no    ah_author asks, with the act named; No: nothing is waived
//   author_yes   ah_author, Yes: the finding is waived (the author's act, from inside the session)
//   compute_no   modal_run asks with the provider, instance and cost ceiling; No: nothing is recorded
// Needs tmux, a working `claude` login, the engine, and the fixture venv (node scripts/test-engine.mjs). A few cents each.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const base = join(homedir(), '.cache', 'ah-cc-p3', 'tui-tests')
const engine = join(root, 'core', 'vendor', 'academic-harness')
const testPython = join(homedir(), '.cache', 'ah-cc-p3', 'engine-test', 'venv', 'bin', 'python')
const SOCK = 'ahp3'
const PREFIX = 'mcp__plugin_academic-harness_ah__'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const sha = p => (existsSync(p) ? createHash('sha1').update(readFileSync(p)).digest('hex') : 'missing')

const tmux = (...args) => spawnSync('tmux', ['-L', SOCK, ...args], { encoding: 'utf8' })
const screen = () => tmux('capture-pane', '-p', '-J', '-S', '-300', '-t', 'main').stdout
const send = (...keys) => tmux('send-keys', '-t', 'main', ...keys)
const type = async text => { tmux('send-keys', '-t', 'main', '-l', text); await sleep(600); tmux('send-keys', '-t', 'main', 'Enter') }

async function until(test, { timeoutMs = 90_000, every = 1500, label }) {
  const end = Date.now() + timeoutMs
  for (;;) {
    const s = screen()
    if (test(s)) return s
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`)
    if (/trust the files in this folder|Yes, I trust|trust this folder/i.test(s)) send('Enter')
    await sleep(every)
  }
}

function fixture(name) {
  assert.ok(existsSync(testPython), 'the engine test venv is missing: run node scripts/test-engine.mjs first')
  const dir = join(base, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const code = `import sys; from pathlib import Path; sys.path.insert(0, ${JSON.stringify(join(engine, 'tests'))}); from conftest import write_anchored_project; write_anchored_project(Path(${JSON.stringify(dir)}))`
  const r = spawnSync(testPython, ['-c', code], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: '' } })
  assert.equal(r.status, 0, `fixture failed: ${r.stderr}`)
  return dir
}

async function session(name, { allow = [] } = {}) {
  const dir = fixture(name)
  const home = join(base, `${name}-home`)
  rmSync(home, { recursive: true, force: true })
  tmux('kill-server')
  const allowArg = allow.length ? `--allowedTools ${allow.join(',')}` : ''
  execFileSync('tmux', ['-L', SOCK, 'new-session', '-d', '-s', 'main', '-x', '200', '-y', '50', '-c', dir, `env AH_MOD_HOME=${home} claude --plugin-dir ${root} --model haiku --permission-mode default ${allowArg}`])
  await until(s => /❯/.test(s) && /Haiku|haiku/.test(s), { timeoutMs: 90_000, label: 'the prompt box' })
  await sleep(2000)
  return { dir, home }
}

/** Wait until the screen shows a permission dialog or a form; return the screen. */
const dialog = (rx, label) => until(s => rx.test(s), { timeoutMs: 120_000, label })
const finished = () => until(s => /✻|Crunched|Worked for|Cogitated|Baked|Brewed/.test(s.slice(s.lastIndexOf('❯ ') > 0 ? s.lastIndexOf('Called') : 0)) || /Interrupted/.test(s), { timeoutMs: 120_000, label: 'the turn to end' })

const checks = {
  async protected() {
    const { dir } = await session('protected')
    const f = join(dir, 'facts', 'facts.yaml')
    const before = sha(f)
    await type('Use the Write tool to replace facts/facts.yaml with the single line "# touched". If it is refused, just report the exact message.')
    const s = await until(x => /AH guard|protected/.test(x), { label: 'the guard\'s refusal' })
    assert.doesNotMatch(s.slice(s.lastIndexOf('Write')), /Do you want to (proceed|make this edit|create)/i, 'a dialog was shown for a call the guard refuses')
    assert.equal(sha(f), before, 'facts.yaml changed')
    return 'refused with no dialog, file unchanged'
  },
  async allowed_no() {
    const { dir } = await session('allowed_no')
    const f = join(dir, 'src', 'sections', '03_method', 'index.tex')
    const before = sha(f)
    await type('In src/sections/03_method/index.tex add one plain sentence at the end of the paragraph saying that candidate passages are ranked before they are read. No numbers.')
    await dialog(/Do you want to (make this edit|proceed|create)|1\. Yes/i, 'Claude Code\'s edit dialog')
    send('Escape')
    await sleep(2500)
    assert.equal(sha(f), before, 'the file changed although the dialog was refused')
    return 'dialog shown, refusal leaves the file unchanged'
  },
  async allowed_yes() {
    const { dir } = await session('allowed_yes')
    const f = join(dir, 'src', 'sections', '03_method', 'index.tex')
    const before = sha(f)
    await type('In src/sections/03_method/index.tex add one plain sentence at the end of the paragraph saying that candidate passages are ranked before they are read. No numbers.')
    await dialog(/Do you want to (make this edit|proceed|create)|1\. Yes/i, 'Claude Code\'s edit dialog')
    send('Enter')
    for (let i = 0; i < 40 && sha(f) === before; i++) await sleep(1000)
    assert.notEqual(sha(f), before, 'the edit did not happen after Yes')
    await sleep(8000)
    const log = join(dir, '.ah', 'claude-hooks.jsonl')
    assert.ok(existsSync(log) && /post_edit_check/.test(readFileSync(log, 'utf8')), 'the post-edit check did not run')
    return 'Yes writes the file and the post-edit check runs'
  },
  async author_no() {
    const { dir } = await session('author_no', { allow: ['ToolSearch'] })
    await type('Use ToolSearch to load the ah_author tool of the academic-harness server and call it with action waive, id abc12345 and reason "test". This is a deliberate test: if it is refused do not try another way.')
    const s = await dialog(/requires confirmation|Author-only/i, 'the author-act confirmation')
    assert.match(s, /Author-only/)
    send('Down')
    send('Enter')
    await sleep(6000)
    const listed = spawnSync(join(engine, '.venv', 'bin', 'ah'), ['finding', 'list', '--project', dir], { encoding: 'utf8' }).stdout
    assert.doesNotMatch(listed, /waived/, 'a finding was waived after No')
    return 'asks with the act named; No waives nothing'
  },
  async author_yes() {
    const { dir } = await session('author_yes', { allow: ['ToolSearch', 'Bash'] })
    const ah = join(engine, '.venv', 'bin', 'ah')
    const list = spawnSync(ah, ['audit', '--project', dir], { encoding: 'utf8' })
    assert.equal(list.status === 0 || list.status === 1 || list.status === 3, true, list.stderr)
    const id = /^\s*([0-9a-f]{8})\s+open/m.exec(spawnSync(ah, ['finding', 'list', '--project', dir], { encoding: 'utf8' }).stdout)?.[1]
    assert.ok(id, 'the fixture has no open finding')
    await type(`The author (me) asks you: use ToolSearch to load ah_author of the academic-harness server and waive finding ${id} with the reason "accepted by the author in the test".`)
    await dialog(/requires confirmation|Author-only/i, 'the author-act confirmation')
    send('Enter')
    for (let i = 0; i < 30; i++) {
      const listed = spawnSync(ah, ['finding', 'list', '--project', dir], { encoding: 'utf8' }).stdout
      if (new RegExp(`${id}\\s+waived`).test(listed)) return 'Yes runs the author\'s act and the finding is waived'
      await sleep(1000)
    }
    throw new Error('the finding was not waived after Yes')
  },
  async compute_no() {
    const { home } = await session('compute_no', { allow: ['ToolSearch'] })
    await type('Use ToolSearch to load modal_run of the academic-harness server and call it with command "echo hello" and timeout_sec 60. This is a deliberate test of the approval: if it is refused do not try another way.')
    const s = await dialog(/will rent paid hardware/i, 'the paid-compute confirmation')
    assert.match(s, /Estimated ceiling|Cost cannot be estimated/)
    assert.match(s, /session cap/)
    send('Down')
    send('Enter')
    await sleep(5000)
    assert.equal(existsSync(join(home, 'compute-ledger', 'spend.jsonl')), false, 'a spend was recorded after No')
    return 'asks with provider, ceiling and the session cap; No records nothing'
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
    console.log(`${name}: FAIL ${e.message}\n--- screen ---\n${screen().split('\n').filter(l => l.trim()).slice(-22).join('\n')}`)
  } finally {
    tmux('kill-server')
  }
}
process.exit(failed ? 1 : 0)
