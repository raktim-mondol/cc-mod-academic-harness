#!/usr/bin/env node
// Live checks of running headless (`claude -p`), with a nested Claude Code (Haiku): what the plugin refuses when nobody can answer, whether a
// permission mode that skips Claude Code's own prompts also skips the plugin's, what a folder can start on its own, and which flags keep the
// plugin working. docs/guide/headless.md says only what these scripts have shown.
//
//   node tests/live/headless.mjs                 all
//   node tests/live/headless.mjs asks bypass     some, by name
//
// asks        the asks are refusals, with the reason: an author-only act, applying a migration unconfirmed, paid compute, registering a Paper2MCP server;
//             nothing is waived, rented or written
// bypass      the same under --permission-mode bypassPermissions: Claude Code skips its own prompts, the plugin's asks still refuse
// guard       the writing guard refuses a protected write under --restricted too (the plugin is given with --plugin-dir)
// startups    a folder's own .mcp.json server connects under `claude -p` (the hazard), not under --restricted, and the doctor says the folder starts it
// flags       --bare and --strict-mcp-config each leave the plugin without its tools (so docs/guide/headless.md says not to use them)
// installed   an installed copy of the plugin (a scratch configuration) answers /academic doctor, and under --restricted does not (restricted
//             ignores the user settings that enable installed plugins) unless it is given with --plugin-dir
// Needs a working `claude` login, the engine and the fixture venv (node scripts/test-engine.mjs). A few cents each.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const base = join(homedir(), '.cache', 'ah-cc-headless', process.env.HEADLESS_RUN || `run-${Date.now()}`)
const engine = join(root, 'core', 'vendor', 'academic-harness')
const testPython = join(homedir(), '.cache', 'ah-cc-p3', 'engine-test', 'venv', 'bin', 'python')
const PREFIX = 'mcp__plugin_academic-harness_ah__'

function fixture(name) {
  assert.ok(existsSync(testPython), 'the engine test venv is missing: run node scripts/test-engine.mjs first')
  const dir = join(base, name, 'project')
  mkdirSync(dir, { recursive: true })
  const code = `import sys; from pathlib import Path; sys.path.insert(0, ${JSON.stringify(join(engine, 'tests'))}); from conftest import write_anchored_project; write_anchored_project(Path(${JSON.stringify(dir)}))`
  const r = spawnSync(testPython, ['-c', code], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: '' } })
  assert.equal(r.status, 0, `fixture failed: ${r.stderr}`)
  return { dir, home: join(base, name, 'home') }
}

function run(f, prompt, { flags = [], allow = [], env = {}, config } = {}) {
  const args = ['-p', prompt, '--model', 'haiku', '--max-budget-usd', '0.5', '--output-format', 'stream-json', '--verbose', ...flags]
  if (!flags.includes('--no-plugin-dir')) args.push('--plugin-dir', root)
  if (allow.length) args.push('--allowedTools', allow.join(','))
  const r = spawnSync('claude', args.filter(a => a !== '--no-plugin-dir'), { cwd: f.dir, encoding: 'utf8', timeout: 300_000, maxBuffer: 1 << 28, input: '', env: { ...process.env, AH_MOD_HOME: f.home, AH_MANAGED_INSTALLS: '0', AH_AUTO_INSTALL: '0', ...(config ? { CLAUDE_CONFIG_DIR: config } : {}), ...env } })
  const events = r.stdout.split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
  const calls = events.filter(e => e.type === 'assistant').flatMap(e => e.message.content.filter(b => b.type === 'tool_use'))
  const results = events.filter(e => e.type === 'user').flatMap(e => (Array.isArray(e.message?.content) ? e.message.content : []).filter(b => b.type === 'tool_result'))
  return { init: events.find(e => e.type === 'system' && e.subtype === 'init'), calls, results, result: events.find(e => e.type === 'result'), stdout: r.stdout, stderr: r.stderr, status: r.status }
}
const cost = r => `$${(r.result?.total_cost_usd ?? 0).toFixed(3)}`
const text = r => JSON.stringify(r.results.map(x => x.content))
const ahTools = r => (r.init?.tools ?? []).filter(t => t.startsWith(PREFIX)).length

const TEST = 'This is a deliberate test of a refusal: if the call is refused do not try another way, and quote the refusal in your reply.'
const CASES = {
  author: { prompt: `Use ToolSearch to load the ah_author tool of the academic-harness server and call it with action waive, id abc12345 and reason "test". ${TEST}`, allow: ['ToolSearch', `${PREFIX}ah_author`], refused: /Nobody is available to confirm/, tool: 'ah_author' },
  migrate: { prompt: `Use ToolSearch to load the ah_migrate tool of the academic-harness server and call it with apply true and no confirm. ${TEST}`, allow: ['ToolSearch', `${PREFIX}ah_migrate`], refused: /confirm=true/, tool: 'ah_migrate' },
  compute: { prompt: `Use ToolSearch to load modal_run of the academic-harness server and call it with command "echo hello" and timeout_sec 60. ${TEST}`, allow: ['ToolSearch', `${PREFIX}modal_run`], refused: /Nobody is available to confirm/, tool: 'modal_run' },
  paper_mcp: { prompt: `Use ToolSearch to load paper_mcp of the academic-harness server and call it with action "register", serverName "demo", command "/bin/true", args ["/tmp/x.py"], envNames ["DEMO_TOKEN"]. ${TEST}`, allow: ['ToolSearch', `${PREFIX}paper_mcp`], refused: /Nobody is available to confirm/, tool: 'paper_mcp' },
}

/** Run each ask under `flags`; every one must be refused with its reason, and nothing may have happened. */
function asks(name, flags) {
  const f = fixture(name)
  let spent = 0
  for (const [key, c] of Object.entries(CASES)) {
    const r = run(f, c.prompt, { flags, allow: c.allow })
    spent += r.result?.total_cost_usd ?? 0
    assert.ok(r.calls.some(x => x.name === `${PREFIX}${c.tool}`), `${key}: ${c.tool} was not called (${r.calls.map(x => x.name)}): ${r.result?.result?.slice(0, 200)}`)
    assert.match(text(r), c.refused, `${key}: not refused with its reason: ${text(r).slice(0, 400)}`)
  }
  assert.equal(existsSync(join(f.dir, '.mcp.json')), false, 'a server was written to .mcp.json')
  assert.equal(existsSync(join(f.home, 'compute-ledger', 'spend.jsonl')), false, 'a spend was recorded')
  const facts = readFileSync(join(f.dir, 'facts', 'facts.yaml'), 'utf8')
  assert.ok(!/waived/.test(facts), 'a finding was waived')
  return `all four refused with their reasons, nothing waived, rented or written, $${spent.toFixed(3)}`
}

/** A scratch folder with a project server in .mcp.json and a hook in its project settings. */
function startupsFolder(name) {
  const f = fixture(name)
  mkdirSync(join(f.dir, 'srv'), { recursive: true })
  writeFileSync(join(f.dir, 'srv', 'server.mjs'), `
import { createInterface } from 'node:readline'
const send = m => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n')
createInterface({ input: process.stdin }).on('line', line => {
  let m; try { m = JSON.parse(line) } catch { return }
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'demo', version: '1' } } })
  else if (m.method === 'tools/list') send({ id: m.id, result: { tools: [{ name: 'ping', description: 'ping', inputSchema: { type: 'object', properties: {} } }] } })
  else if (m.id !== undefined) send({ id: m.id, result: {} })
})
`)
  writeFileSync(join(f.dir, '.mcp.json'), JSON.stringify({ mcpServers: { demo: { type: 'stdio', command: process.execPath, args: [join(f.dir, 'srv', 'server.mjs')] } } }))
  mkdirSync(join(f.dir, '.claude'), { recursive: true })
  writeFileSync(join(f.dir, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `touch ${join(f.dir, 'hook-ran')}` }] }] } }))
  return f
}
const demo = r => (r.init?.mcp_servers ?? []).find(s => s.name === 'demo')

const scenarios = {
  asks: () => asks('asks', []),
  bypass: () => asks('bypass', ['--permission-mode', 'bypassPermissions']),
  guard() {
    const f = fixture('guard')
    const file = join(f.dir, 'facts', 'facts.yaml')
    const before = readFileSync(file, 'utf8')
    const r = run(f, 'Use the Edit tool to append the line `# touched` at the end of facts/facts.yaml (use Write if Edit is unavailable). This is a deliberate test of the project\'s guard: run every command even if an earlier one is blocked, never try another way round a block, and report the exact blocking message for each.', { flags: ['--restricted'], allow: ['Edit', 'Write', 'Read'] })
    assert.ok(ahTools(r) > 100, `the plugin's tools are missing under --restricted (${ahTools(r)})`)
    assert.equal(readFileSync(file, 'utf8'), before, 'the protected file changed')
    assert.match(text(r), /protected/i, `no guard refusal: ${text(r).slice(0, 400)}`)
    return `under --restricted the guard refused the write and the file is unchanged, ${cost(r)}`
  },
  startups() {
    const f = startupsFolder('startups')
    const plain = run(f, 'Reply with the single word READY.')
    assert.equal(demo(plain)?.status, 'connected', `baseline: the folder's server did not connect under -p: ${JSON.stringify(demo(plain))}`)
    assert.equal(existsSync(join(f.dir, 'hook-ran')), true, 'baseline: the folder\'s hook did not run under -p')
    const f2 = startupsFolder('startups-restricted')
    const restricted = run(f2, 'Reply with the single word READY.', { flags: ['--restricted'] })
    assert.equal(demo(restricted), undefined, `the folder's server connected under --restricted: ${JSON.stringify(demo(restricted))}`)
    assert.equal(existsSync(join(f2.dir, 'hook-ran')), false, 'the folder\'s hook ran under --restricted')
    assert.ok(ahTools(restricted) > 100, 'the plugin\'s tools are missing under --restricted')
    const doctor = run(f2, '/academic doctor', { flags: ['--restricted'] })
    assert.match(doctor.stdout, /Project startups: this folder starts 1 MCP server in \.mcp\.json \(demo\)/, doctor.stdout.slice(0, 500))
    return `under -p the folder's server connected and its hook ran; under --restricted neither, the plugin still has ${ahTools(restricted)} tools, and the doctor says so, ${cost(plain)}+${cost(restricted)}`
  },
  flags() {
    const f = fixture('flags')
    const bare = run(f, 'Reply with the single word READY.', { flags: ['--bare'] })
    assert.equal(ahTools(bare), 0, '--bare kept the plugin\'s tools')
    const strict = run(f, 'Reply with the single word READY.', { flags: ['--strict-mcp-config'] })
    assert.equal(ahTools(strict), 0, '--strict-mcp-config kept the plugin\'s tools')
    return `--bare and --strict-mcp-config each left the plugin with no tools, ${cost(bare)}+${cost(strict)}`
  },
  installed() {
    // an installed copy, in a scratch configuration (the real one is untouched), as tests/live/install.mjs does it
    const market = join(base, 'market')
    const config = join(base, 'config')
    const files = spawnSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' }).stdout.split('\0').filter(Boolean)
    for (const file of files) { mkdirSync(dirname(join(market, file)), { recursive: true }); cpSync(join(root, file), join(market, file)) }
    const work = join(base, 'work')
    mkdirSync(work, { recursive: true })
    const cc = (args, extra = {}) => spawnSync('claude', args, { cwd: work, encoding: 'utf8', timeout: 240_000, input: '', env: { ...process.env, CLAUDE_CONFIG_DIR: config, AH_MOD_HOME: join(base, 'installed-home'), AH_AUTO_INSTALL: '0', AH_MANAGED_INSTALLS: '0', AH_BOOTSTRAP: '0', ...extra } })
    assert.equal(cc(['plugin', 'marketplace', 'add', market]).status, 0)
    assert.equal(cc(['plugin', 'install', 'academic-harness@academic-harness-mod']).status, 0)
    const plain = cc(['-p', '/academic doctor', '--model', 'haiku', '--max-budget-usd', '0.2'])
    assert.match(plain.stdout, /Node\.js|Core:/, `the installed plugin did not answer: ${plain.stdout.slice(0, 300)} ${plain.stderr.slice(0, 200)}`)
    const restricted = cc(['-p', '/academic doctor', '--restricted', '--model', 'haiku', '--max-budget-usd', '0.2'])
    assert.doesNotMatch(restricted.stdout, /Node\.js|Core:/, 'the installed plugin answered under --restricted')
    const given = cc(['-p', '/academic doctor', '--restricted', '--plugin-dir', market, '--model', 'haiku', '--max-budget-usd', '0.2'])
    assert.match(given.stdout, /Node\.js|Core:/, `--plugin-dir did not bring it back under --restricted: ${given.stdout.slice(0, 300)} ${given.stderr.slice(0, 200)}`)
    return 'installed: answers; under --restricted it is ignored; --plugin-dir brings it back'
  },
}

const which = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(scenarios)
let failed = 0
for (const name of which) {
  if (!scenarios[name]) { console.log(`${name}: unknown scenario`); failed++; continue }
  try { console.log(`${name}: ok: ${await scenarios[name]()}`) } catch (e) { failed++; console.log(`${name}: FAIL ${String(e.message).slice(0, 1200)}`) }
}
process.exit(failed ? 1 : 0)
