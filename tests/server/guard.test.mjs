// The guard bridge (server/bin/ah-hook.mjs) and the engine's place in the snapshot (server/src/engine.mjs,
// the sync's keep rule). Scratch under ~/.cache; the fake engine is upstream's own helper where it is staged,
// else a small stand-in written here.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { engineDir, engineHash, engineStatus, STAMP_FILE, venvBin } from '../../server/src/engine.mjs'
import { upstreamDir } from '../../server/src/paths.mjs'
import { sync } from '../../scripts/sync-upstream.mjs'

const root = join(homedir(), '.cache', 'ah-cc-p3', 'unit')
const HOOK = join(import.meta.dirname, '..', '..', 'server', 'bin', 'ah-hook.mjs')
const UP = upstreamDir()
const REAL = engineStatus({}, engineDir(UP), { verify: false }).ok
const AH = venvBin(engineDir(UP))

before(() => { rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true }) })
after(() => rmSync(root, { recursive: true, force: true }))

/** A stand-in engine: prints FAKE_REPLY, logs its stdin, exits FAKE_EXIT, optionally sleeps first. */
const fake = join(root, 'fake-ah.mjs')
function writeFake() {
  writeFileSync(fake, `import { appendFileSync } from 'node:fs'
let stdin = ''
for await (const c of process.stdin) stdin += c
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: process.argv.slice(2), mode: process.env.AH_T3_MODE ?? null, ahLog: process.env.AH_LOG ?? null, stdin: JSON.parse(stdin || '{}') }) + '\\n')
if (process.env.FAKE_SLEEP) await new Promise(r => setTimeout(r, Number(process.env.FAKE_SLEEP)))
if (process.env.FAKE_REPLY) process.stdout.write(process.env.FAKE_REPLY + '\\n')
if (process.env.FAKE_ERR) process.stderr.write(process.env.FAKE_ERR + '\\n')
process.exit(Number(process.env.FAKE_EXIT ?? 0))
`)
}

function project(name) {
  const dir = join(root, name)
  mkdirSync(join(dir, 'sections'), { recursive: true })
  writeFileSync(join(dir, 'ah.yaml'), 'project: t\n')
  return dir
}

function hook(event, payload, env = {}) {
  return new Promise(resolve => {
    const child = spawn('node', [HOOK, event], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('close', code => resolve({ code, out, err }))
    child.stdin.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
  })
}

describe('ah-hook with a stand-in engine', () => {
  before(writeFake)
  const via = (extra = {}) => ({ ACADEMIC_HARNESS_CLI: `node ${fake}`, ...extra })

  test('the payload goes to `ah hook <event>` in the project, and the reply and exit code come back unchanged', async () => {
    const dir = project('a')
    const log = join(root, 'a.log')
    const reply = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'no' } })
    const r = await hook('pre', { cwd: join(dir, 'sections'), tool_name: 'Write', tool_input: { file_path: 'x' } }, via({ FAKE_LOG: log, FAKE_REPLY: reply }))
    assert.equal(r.code, 0)
    assert.equal(r.out.trim(), reply)
    const seen = JSON.parse(readFileSync(log, 'utf8').trim())
    assert.deepEqual(seen.argv, ['hook', 'pre'])
    assert.equal(seen.stdin.tool_name, 'Write')
    assert.equal(seen.ahLog, join(dir, '.ah', 'claude-hooks.jsonl'), 'the engine log is Claude Code\'s own file')
  })

  test('outside an ah.yaml tree the engine is not started and nothing is printed', async () => {
    const log = join(root, 'b.log')
    const r = await hook('pre', { cwd: join(root, 'no-project'), tool_name: 'Bash', tool_input: { command: 'ls' } }, via({ FAKE_LOG: log, FAKE_REPLY: '{"decision":"block"}' }))
    assert.equal(r.code, 0)
    assert.equal(r.out, '')
    assert.equal(existsSync(log), false)
  })

  test('AH_T3_MODE reaches the engine', async () => {
    const dir = project('c')
    const log = join(root, 'c.log')
    await hook('stop', { cwd: dir }, via({ FAKE_LOG: log, AH_T3_MODE: 'skip' }))
    assert.equal(JSON.parse(readFileSync(log, 'utf8').trim()).mode, 'skip')
  })

  test('an engine that exits non-zero gives that exit code, with its stderr', async () => {
    const dir = project('d')
    const r = await hook('pre', { cwd: dir, tool_name: 'Write', tool_input: {} }, via({ FAKE_EXIT: '1', FAKE_ERR: 'Traceback boom' }))
    assert.equal(r.code, 1)
    assert.match(r.err, /Traceback boom/)
  })

  test('an engine that overruns is killed and the exit code is 124', async () => {
    const dir = project('e')
    const r = await hook('pre', { cwd: dir, tool_name: 'Write', tool_input: {} }, via({ FAKE_SLEEP: '5000', AH_HOOK_TIMEOUT_MS: '300' }))
    assert.equal(r.code, 124)
    assert.match(r.err, /did not answer/)
  })

  test('an unknown event and a payload that is not JSON are refused with exit 2', async () => {
    assert.equal((await hook('nope', {}, via())).code, 2)
    assert.equal((await hook('pre', 'not json', via())).code, 2)
  })
})

describe("ah-hook with upstream's own scripted engine (scripts/helpers/fake-ah-engine.mjs)", { skip: !existsSync(join(UP, 'scripts', 'helpers', 'fake-ah-engine.mjs')) }, () => {
  const helper = join(UP, 'scripts', 'helpers', 'fake-ah-engine.mjs')
  const run = (event, payload, script, name) => {
    const dir = project(`up-${name}`)
    const scriptFile = join(root, `${name}.script.json`)
    const log = join(root, `${name}.log`)
    const state = join(root, `${name}.state.json`)
    writeFileSync(scriptFile, JSON.stringify(script))
    return hook(event, { cwd: dir, ...payload }, { ACADEMIC_HARNESS_CLI: `node ${helper}`, FAKE_AH_SCRIPT: scriptFile, FAKE_AH_LOG: log, FAKE_AH_STATE: state }).then(r => ({ ...r, log: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [] }))
  }

  test('its replies come through unchanged, in order, for each event the guard sends', async () => {
    const deny = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'scripted deny' } }
    const pre = await run('pre', { tool_name: 'Write', tool_input: { file_path: 'x' } }, { pre: [deny] }, 'pre')
    assert.equal(pre.code, 0)
    assert.deepEqual(JSON.parse(pre.out), deny)
    assert.equal(pre.log[0].event, 'pre')
    assert.equal(pre.log[0].payload.tool_name, 'Write')

    const block = { decision: 'block', reason: 'AH gate (attempt 1/3)' }
    const stop = await run('stop', { hook_event_name: 'Stop' }, { stop: [block] }, 'stop')
    assert.deepEqual(JSON.parse(stop.out), block)

    const quiet = await run('post', { tool_name: 'Edit', tool_input: {} }, { post: [null] }, 'post')
    assert.equal(quiet.code, 0)
    assert.equal(quiet.out.trim(), '')
  })
})

describe('ah-hook with no engine', () => {
  test('exit 3 and a message that says what to run', async () => {
    const dir = project('f')
    const empty = join(root, 'empty-upstream')
    mkdirSync(empty, { recursive: true })
    const r = await hook('pre', { cwd: dir, tool_name: 'Write', tool_input: {} }, { AH_UPSTREAM: empty, ACADEMIC_HARNESS_CLI: '', AH_CMD: '' })
    assert.equal(r.code, 3)
    assert.match(r.err, /no engine to run/)
    assert.match(r.err, /sync-upstream/)
  })
})

describe('engine status', () => {
  test('override, missing pieces, a stale stamp and a ready venv each read as they are', () => {
    const up = join(root, 'status-upstream')
    const dir = engineDir(up)
    mkdirSync(join(dir, 'ah'), { recursive: true })
    assert.match(engineStatus({}, dir).why, /not in the snapshot/)
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "x"\n')
    writeFileSync(join(dir, 'ah', '__init__.py'), '')
    assert.match(engineStatus({}, dir).why, /no virtual environment/)
    mkdirSync(join(dir, '.venv', 'bin'), { recursive: true })
    writeFileSync(join(dir, '.venv', 'bin', 'ah'), '')
    assert.match(engineStatus({}, dir).why, /not built by this mod/)
    writeFileSync(join(dir, STAMP_FILE), 'deadbeef\n')
    assert.match(engineStatus({}, dir).why, /changed since/)
    assert.equal(engineStatus({}, dir, { verify: false }).ok, true, 'the hook fast path does not hash')
    writeFileSync(join(dir, STAMP_FILE), `${engineHash(dir)}\n`)
    assert.equal(engineStatus({}, dir).ok, true)
    assert.equal(engineStatus({ ACADEMIC_HARNESS_CLI: 'ah' }, join(root, 'nowhere')).how, 'override')
  })

  test('the hash covers the engine files and ignores the venv, caches and the stamp', () => {
    const dir = engineDir(join(root, 'status-upstream'))
    const before = engineHash(dir)
    writeFileSync(join(dir, '.venv', 'bin', 'extra'), 'x')
    mkdirSync(join(dir, 'ah', '__pycache__'), { recursive: true })
    writeFileSync(join(dir, 'ah', '__pycache__', 'a.pyc'), 'x')
    writeFileSync(join(dir, 'installed-version'), '1')
    assert.equal(engineHash(dir), before)
    writeFileSync(join(dir, 'ah', '__init__.py'), '# changed')
    assert.notEqual(engineHash(dir), before)
  })
})

describe('sync keeps the engine venv when the engine is unchanged', () => {
  const src = join(root, 'src-repo')
  const git = (...args) => execFileSync('git', ['-C', src, ...args], { encoding: 'utf8' })
  const out = join(root, 'snap')
  const lock = join(root, 'snap.lock.json')
  const run = () => sync({ source: src, commit: 'HEAD', outDir: out, lockFile: lock, allow: ['package.json', 'vendor/academic-harness'] })

  before(() => {
    mkdirSync(join(src, 'vendor', 'academic-harness', 'ah'), { recursive: true })
    execFileSync('git', ['init', '-q', src])
    git('config', 'user.email', 't@example.invalid')
    git('config', 'user.name', 't')
    writeFileSync(join(src, 'package.json'), '{"name":"x","version":"1.0.0"}')
    writeFileSync(join(src, 'vendor', 'academic-harness', 'pyproject.toml'), '[project]\nname = "x"\n')
    writeFileSync(join(src, 'vendor', 'academic-harness', 'ah', '__init__.py'), '')
    git('add', '-A')
    git('commit', '-qm', 'one')
  })

  test('same engine: the venv and its stamps survive; changed engine: they go', () => {
    run()
    const dir = engineDir(out)
    mkdirSync(join(dir, '.venv', 'bin'), { recursive: true })
    writeFileSync(join(dir, '.venv', 'bin', 'ah'), 'venv')
    writeFileSync(join(dir, STAMP_FILE), `${engineHash(dir)}\n`)
    run()
    assert.equal(readFileSync(join(dir, '.venv', 'bin', 'ah'), 'utf8'), 'venv', 'kept')
    assert.equal(engineStatus({}, dir).ok, true)

    writeFileSync(join(src, 'vendor', 'academic-harness', 'ah', '__init__.py'), '# v2')
    git('commit', '-qam', 'two')
    run()
    assert.equal(existsSync(join(dir, '.venv')), false, 'a changed engine gets no stale venv')
  })
})

describe('the real engine, through the bridge', { skip: !REAL }, () => {
  const dir = join(root, 'real')
  const run = (event, payload, extra = {}) => hook(event, { cwd: dir, session_id: 's1', ...payload }, { AH_T3_MODE: 'skip', ...extra })

  before(() => {
    execFileSync(AH, ['init', dir], { stdio: 'ignore' })
  })

  test('a write to a protected file is denied, and the reason names the way out', async () => {
    const r = await run('pre', { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(dir, 'facts', 'facts.yaml'), content: 'x' } })
    assert.equal(r.code, 0)
    const out = JSON.parse(r.out)
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /protected/)
  })

  test('an author-only shell command is denied', async () => {
    const r = await run('pre', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ah finding waive abc12345 --reason x --yes' } })
    assert.equal(JSON.parse(r.out).hookSpecificOutput.permissionDecision, 'deny')
  })

  test('an ordinary edit of prose is allowed: exit 0 and no output', async () => {
    const r = await run('pre', { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(dir, 'src', 'sections', 'a.tex'), content: 'Hello.\n' } })
    assert.equal(r.code, 0)
    assert.equal(r.out.trim(), '')
  })

  test('a broken ah.yaml makes the engine deny a mutating call itself, and a read still passes', async () => {
    const yaml = join(dir, 'ah.yaml')
    const good = readFileSync(yaml, 'utf8')
    writeFileSync(yaml, 'project: [unclosed\n')
    try {
      const w = await run('pre', { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(dir, 'src', 'sections', 'a.tex'), content: 'x' } })
      assert.equal(JSON.parse(w.out).hookSpecificOutput.permissionDecision, 'deny')
      assert.match(JSON.parse(w.out).hookSpecificOutput.permissionDecisionReason, /could not be checked/)
      const rd = await run('pre', { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: join(dir, 'src', 'sections', 'a.tex') } })
      assert.equal(rd.out.trim(), '')
    } finally {
      writeFileSync(yaml, good)
    }
  })

  test('the prompt hook returns the paper-state card', async () => {
    const r = await run('userprompt', { hook_event_name: 'UserPromptSubmit', prompt: 'hi' })
    assert.match(JSON.parse(r.out).hookSpecificOutput.additionalContext, /Paper state/)
  })

  test('the engine logs to .ah/claude-hooks.jsonl, not DSH\'s file', () => {
    assert.ok(existsSync(join(dir, '.ah', 'claude-hooks.jsonl')))
    assert.equal(existsSync(join(dir, '.ah', 'dsh-hooks.jsonl')), false)
  })
})
