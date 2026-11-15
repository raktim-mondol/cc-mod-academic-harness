#!/usr/bin/env node
// The one P2 exit item `--settings` cannot show: a sensitive option saved the way a person saves it (`claude plugin configure`),
// stored by Claude Code's own secure store, and delivered to the server of an INSTALLED copy of the mod.
//
//   node tests/live/p2-config.mjs
//
// Everything happens in a scratch Claude Code config directory under ~/.cache (CLAUDE_CONFIG_DIR), so the real one is never touched:
// a scratch marketplace holds a copy of the mod's tracked files, the mod is installed from it, a fake S2 key is saved with
// `claude plugin configure --values-stdin`, and a session starts with AH_KEYS_REPORT set. The server writes the name, length and a
// short hash of each key it received (never the value). No model call is made, so there is no login and no cost.
// Asserted: the value is in the secure store (.credentials.json) and nowhere in settings.json or .claude.json; the server got it;
// the hash matches; the value is in no output.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const base = join(homedir(), '.cache', 'ah-cc-p2', 'config-test')
const cfg = join(base, 'cfg')
const FAKE = 'FAKE-INSTALLED-KEY-12345-for-the-config-test'

rmSync(base, { recursive: true, force: true })
mkdirSync(join(base, 'mkt', '.claude-plugin'), { recursive: true })
const files = spawnSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' }).stdout.split('\0').filter(Boolean)
for (const f of files) {
  const to = join(base, 'mkt', 'plugins', 'academic-harness', f)
  mkdirSync(dirname(to), { recursive: true })
  cpSync(join(root, f), to)
}
writeFileSync(join(base, 'mkt', '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'local', owner: { name: 'config-test' }, plugins: [{ name: 'academic-harness', source: './plugins/academic-harness', description: 'copy for the config test' }] }))

const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg }
const claude = (args, input) => spawnSync('claude', args, { env, encoding: 'utf8', input: input ?? '', cwd: base, timeout: 120_000 })
let all = ''
const note = r => { all += r.stdout + r.stderr; return r }

try {
  assert.equal(note(claude(['plugin', 'marketplace', 'add', join(base, 'mkt')])).status, 0, 'marketplace add')
  assert.equal(note(claude(['plugin', 'install', 'academic-harness@local'])).status, 0, 'install')
  const saved = note(claude(['plugin', 'configure', 'academic-harness@local', '--values-stdin'], JSON.stringify({ s2_api_key: FAKE })))
  assert.equal(saved.status, 0, saved.stderr)
  const shown = note(claude(['plugin', 'configure', 'academic-harness@local'])).stdout
  assert.match(shown, /s2_api_key[^\n]*sensitive, set/, 'the option reads as set')

  const where = ['.credentials.json', 'settings.json', '.claude.json'].filter(f => existsSync(join(cfg, f)) && readFileSync(join(cfg, f), 'utf8').includes(FAKE))
  assert.deepEqual(where, ['.credentials.json'], `the sensitive value must be in the secure store only, found in: ${where}`)

  const report = join(base, 'keys.json')
  const run = spawnSync('claude', ['-p', 'hi', '--output-format', 'stream-json', '--verbose', '--model', 'haiku'], {
    env: { ...env, AH_UPSTREAM: join(root, 'upstream'), AH_MOD_HOME: join(base, 'home'), AH_KEYS_REPORT: report, AH_MANAGED_INSTALLS: '0', AH_AUTO_INSTALL: '0' },
    cwd: base, encoding: 'utf8', input: '', timeout: 120_000,
  })
  all += run.stdout + run.stderr
  const init = run.stdout.split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } }).find(e => e.type === 'system' && e.subtype === 'init')
  assert.equal(init?.mcp_servers?.find(s => s.name === 'plugin:academic-harness:ah')?.status, 'connected', 'the ah server of the installed copy connected')
  const got = JSON.parse(readFileSync(report, 'utf8'))
  assert.equal(got.S2_API_KEY?.length, FAKE.length, 'the server got the value')
  assert.equal(got.S2_API_KEY?.sha256, createHash('sha256').update(FAKE).digest('hex').slice(0, 12), 'and it is the same value')
  assert.ok(!all.includes(FAKE), 'the value appears in the output of a command or the session')
  console.log('p2-config: ok: saved with `claude plugin configure`, stored in .credentials.json only, delivered to the installed server (length and hash match), in no output')
} catch (e) {
  console.log(`p2-config: FAIL ${e.message}`)
  process.exitCode = 1
} finally {
  rmSync(base, { recursive: true, force: true })
}
