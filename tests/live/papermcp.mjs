#!/usr/bin/env node
// Live check of the paper_mcp flow, with a nested Claude Code (Haiku): the person is asked before a server is written into .mcp.json, the entry
// holds no secret, Claude Code asks again before it starts the server, the server runs in its own folder with the variable it names, and
// unregister takes it out again.
//
//   node tests/live/papermcp.mjs                 all, in order, in a fresh scratch folder under ~/.cache/ah-cc-papermcp
//   node tests/live/papermcp.mjs refused no yes  some (they share one scratch project: name it with PAPERMCP_RUN=<name>)
//
// refused     `claude -p`: register is refused (nobody can answer the ask) with the hint, and nothing is written
// no          interactive: register asks, showing the program and the variable; No writes nothing
// yes         interactive: the same ask; Yes writes .mcp.json (a bash wrapper that cd's to the folder, the variable as ${NAME}, no value)
// gated       interactive, new session: Claude Code stops at "New MCP server found in this project: demo" and defaults to not using it
// approved    `claude -p` with the project's servers approved (enableAllProjectMcpServers, standing in for the person's yes): the server starts,
//             runs in its folder and sees the variable's value from the shell Claude Code was started in
// unregister  `claude -p`: paper_mcp action=unregister (no ask) removes it from the registry and from .mcp.json
// Each run uses a new folder, so nothing is deleted. Needs tmux and a working `claude` login. A few cents.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const base = join(homedir(), '.cache', 'ah-cc-papermcp', process.env.PAPERMCP_RUN || `run-${Date.now()}`)
const project = join(base, 'project')
const PM = 'mcp__plugin_academic-harness_ah__paper_mcp'
const SECRET = 'tok-live-check-4711'
const SOCK = 'ahpm'
const sleep = ms => new Promise(r => setTimeout(r, ms))

// A stand-in Paper2MCP server: newline-delimited JSON-RPC over stdio, one tool that reports where it runs and the variable it was given.
const SERVER = `
import { createInterface } from 'node:readline'
const send = m => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n')
createInterface({ input: process.stdin }).on('line', line => {
  let m; try { m = JSON.parse(line) } catch { return }
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'demo', version: '1' } } })
  else if (m.method === 'tools/list') send({ id: m.id, result: { tools: [{ name: 'whoami', description: 'Report the folder this server runs in and the DEMO_TOKEN it was given.', inputSchema: { type: 'object', properties: {} } }] } })
  else if (m.method === 'tools/call') send({ id: m.id, result: { content: [{ type: 'text', text: 'cwd=' + process.cwd() + ' token=' + (process.env.DEMO_TOKEN ?? 'unset') }] } })
  else if (m.id !== undefined) send({ id: m.id, result: {} })
})
`
const server = () => join(project, 'srv', 'server.mjs')
const REGISTER = () => `Use ToolSearch to load paper_mcp from the academic-harness server, then call it once with action "register", serverName "demo", command "${process.execPath}", args ["${server()}"], cwd "${project}" and envNames ["DEMO_TOKEN"]. This is a deliberate test: if it is refused, do not try another way, just say what the refusal said.`

function prepare() {
  mkdirSync(join(project, 'srv'), { recursive: true })
  if (!existsSync(server())) writeFileSync(server(), SERVER)
}

// ---- headless runs ----
function run(prompt, { allow = [], env = {}, settings } = {}) {
  const args = ['-p', prompt, '--plugin-dir', root, '--model', 'haiku', '--max-budget-usd', '0.5', '--output-format', 'stream-json', '--verbose']
  if (allow.length) args.push('--allowedTools', allow.join(','))
  if (settings) args.push('--settings', JSON.stringify(settings))
  const r = spawnSync('claude', args, { cwd: project, encoding: 'utf8', timeout: 300_000, maxBuffer: 1 << 28, input: '', env: { ...process.env, AH_MOD_HOME: join(base, 'home'), AH_MANAGED_INSTALLS: '0', AH_AUTO_INSTALL: '0', ...env } })
  const events = r.stdout.split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
  const calls = events.filter(e => e.type === 'assistant').flatMap(e => e.message.content.filter(b => b.type === 'tool_use'))
  const results = events.filter(e => e.type === 'user').flatMap(e => (Array.isArray(e.message?.content) ? e.message.content : []).filter(b => b.type === 'tool_result'))
  return { init: events.find(e => e.type === 'system' && e.subtype === 'init'), calls, results, result: events.find(e => e.type === 'result') }
}
const cost = r => `$${(r.result?.total_cost_usd ?? 0).toFixed(3)}`
const text = r => JSON.stringify(r.results.map(x => x.content))
const mcpJson = () => JSON.parse(readFileSync(join(project, '.mcp.json'), 'utf8'))

// ---- interactive runs (tmux on a private socket) ----
const tmux = (...a) => spawnSync('tmux', ['-L', SOCK, ...a], { encoding: 'utf8' })
const screen = () => tmux('capture-pane', '-p', '-J', '-S', '-300', '-t', 'main').stdout
const send = (...keys) => tmux('send-keys', '-t', 'main', ...keys)
const type = async s => { tmux('send-keys', '-t', 'main', '-l', s); await sleep(600); tmux('send-keys', '-t', 'main', 'Enter') }
async function until(test, { timeoutMs = 120_000, every = 1500, label }) {
  const end = Date.now() + timeoutMs
  for (;;) {
    const s = screen()
    if (test(s)) return s
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}\n${s.slice(-700)}`)
    if (/trust the files in this folder|Yes, I trust|trust this folder/i.test(s)) send('Enter')
    await sleep(every)
  }
}
/** Start Claude Code in tmux. `wait` is false when a dialog (the new-server prompt) will stand in front of the prompt box. */
async function session(env = {}, { wait = true } = {}) {
  tmux('kill-server')
  const envs = Object.entries({ AH_MOD_HOME: join(base, 'home'), ...env }).map(([k, v]) => `${k}=${v}`).join(' ')
  spawnSync('tmux', ['-L', SOCK, 'new-session', '-d', '-s', 'main', '-x', '200', '-y', '50', '-c', project, `env ${envs} claude --plugin-dir ${root} --model haiku --permission-mode default --allowedTools ToolSearch`], { encoding: 'utf8' })
  if (!wait) return
  await until(s => /❯/.test(s) && /Haiku|haiku/.test(s), { timeoutMs: 90_000, label: 'the prompt box' })
  await sleep(2000)
}
const kill = () => tmux('kill-server')

const scenarios = {
  async refused() {
    prepare()
    const r = run(REGISTER(), { allow: ['ToolSearch', PM], env: { DEMO_TOKEN: SECRET } })
    assert.ok(r.calls.some(c => c.name === PM && c.input.action === 'register'), `paper_mcp was not called: ${r.calls.map(c => c.name)}`)
    assert.match(text(r), /Nobody is available to confirm/, `no refusal hint: ${text(r).slice(0, 400)}`)
    assert.equal(existsSync(join(project, '.mcp.json')), false, 'a server was written without anyone confirming')
    return `refused under -p with the hint, nothing written, ${cost(r)}`
  },
  async no() {
    prepare()
    await session({ DEMO_TOKEN: SECRET })
    try {
      await type(REGISTER())
      const s = await until(x => /Register the Paper2MCP server "demo"/.test(x), { label: 'the paper_mcp confirmation' })
      assert.match(s, new RegExp(server().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the dialog shows the program that will run')
      assert.match(s, /DEMO_TOKEN/, 'the dialog names the variable')
      assert.match(s, /Claude Code will ask again/)
      send('Down'); send('Enter')
      await sleep(8000)
      assert.equal(existsSync(join(project, '.mcp.json')), false, 'a server was written after No')
      return 'asks with the program and the variable; No writes nothing'
    } finally { kill() }
  },
  async yes() {
    prepare()
    await session({ DEMO_TOKEN: SECRET })
    try {
      await type(REGISTER())
      await until(x => /Register the Paper2MCP server "demo"/.test(x), { label: 'the paper_mcp confirmation' })
      send('Enter')
      for (let i = 0; i < 40 && !existsSync(join(project, '.mcp.json')); i++) await sleep(1000)
      assert.ok(existsSync(join(project, '.mcp.json')), `no .mcp.json after Yes:\n${screen().slice(-600)}`)
      const entry = mcpJson().mcpServers.demo
      assert.equal(entry.command, 'bash')
      assert.deepEqual(entry.args.slice(0, 3), ['-c', 'cd "$0" && exec "$@"', project])
      assert.equal(entry.env.DEMO_TOKEN, '${DEMO_TOKEN}')
      const raw = readFileSync(join(project, '.mcp.json'), 'utf8')
      assert.ok(!raw.includes(SECRET), 'the secret value is in .mcp.json')
      assert.ok(!readFileSync(join(project, '.dsh', 'paper-mcps.json'), 'utf8').includes(SECRET), 'the secret value is in the registry')
      return 'Yes writes .mcp.json with the variable as a name and no value'
    } finally { kill() }
  },
  async gated() {
    await session({ DEMO_TOKEN: SECRET }, { wait: false })
    try {
      const s = await until(x => /New MCP server found in this project: demo/.test(x), { label: 'the new-server prompt' })
      assert.match(s, /Continue without using this MCP server/, 'the prompt offers a no')
      return 'Claude Code asked before using the new project server (it defaults to "Continue without")'
    } finally { kill() }
  },
  async approved() {
    const r = run('Use ToolSearch to load the whoami tool of the demo MCP server, call it once, and reply with exactly what it returned.', { allow: ['ToolSearch', 'mcp__demo'], env: { DEMO_TOKEN: SECRET }, settings: { enableAllProjectMcpServers: true } })
    const demo = (r.init?.mcp_servers ?? []).find(s => s.name === 'demo')
    assert.equal(demo?.status, 'connected', `demo: ${JSON.stringify(demo)}`)
    assert.ok(r.calls.some(c => /^mcp__demo__whoami$/.test(c.name)), `whoami was not called: ${r.calls.map(c => c.name)}`)
    const out = text(r)
    assert.ok(out.includes(`cwd=${project}`), `the server did not run in its folder: ${out}`)
    assert.ok(out.includes(`token=${SECRET}`), `the variable did not arrive: ${out}`)
    return `started in ${project} and saw the variable, ${cost(r)}`
  },
  async unregister() {
    const r = run('Use ToolSearch to load paper_mcp from the academic-harness server, then call it once with action "unregister" and serverName "demo". Then tell me what it said.', { allow: ['ToolSearch', PM] })
    assert.ok(r.calls.some(c => c.name === PM && c.input.action === 'unregister'), `unregister was not called: ${r.calls.map(c => c.name)}`)
    const doc = existsSync(join(project, '.mcp.json')) ? mcpJson() : { mcpServers: {} }
    assert.equal(doc.mcpServers?.demo, undefined, 'still in .mcp.json')
    const registry = JSON.parse(readFileSync(join(project, '.dsh', 'paper-mcps.json'), 'utf8'))
    assert.ok(!registry.servers.some(s => s.serverName === 'demo'), 'still in the registry')
    return `removed from the registry and .mcp.json without a question, ${cost(r)}`
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
