#!/usr/bin/env node
// Live check of the paper_mcp registration flow: a nested `claude -p` (Haiku) registers a stand-in stdio MCP server, the entry lands in the
// project's .mcp.json, Claude Code holds it back until the project's servers are approved, and once approved the server starts in its own
// folder with the variable the entry names. Then unregister takes it out again.
//
//   node tests/live/papermcp.mjs                 all, in order, in a fresh scratch folder under ~/.cache/ah-cc-papermcp
//   node tests/live/papermcp.mjs register gated  some (they share one scratch project, so name the folder: PAPERMCP_RUN=<name>)
//
// register    paper_mcp action=register writes .mcp.json: a bash wrapper that cd's to the server's folder, the variable as ${NAME}, no value
// gated       an interactive session in that folder (tmux) stops at "New MCP server found in this project: demo" and defaults to not using it
// approved    with the project's servers approved (enableAllProjectMcpServers, standing in for the person's yes), the server starts, runs in its
//             folder and sees the variable's value from the shell Claude Code was started in
// unregister  paper_mcp action=unregister removes it from the registry and from .mcp.json
// Each run uses a new folder, so nothing is deleted. Costs a few cents. Needs a working `claude` login and tmux.
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

function run(name, prompt, { allow = [], env = {}, settings } = {}) {
  const args = ['-p', prompt, '--plugin-dir', root, '--model', 'haiku', '--max-budget-usd', '0.5', '--output-format', 'stream-json', '--verbose']
  if (allow.length) args.push('--allowedTools', allow.join(','))
  if (settings) args.push('--settings', JSON.stringify(settings))
  const r = spawnSync('claude', args, { cwd: project, encoding: 'utf8', timeout: 300_000, maxBuffer: 1 << 28, input: '', env: { ...process.env, AH_MOD_HOME: join(base, 'home'), AH_MANAGED_INSTALLS: '0', AH_AUTO_INSTALL: '0', ...env } })
  const events = r.stdout.split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
  const calls = events.filter(e => e.type === 'assistant').flatMap(e => e.message.content.filter(b => b.type === 'tool_use'))
  const results = events.filter(e => e.type === 'user').flatMap(e => (Array.isArray(e.message?.content) ? e.message.content : []).filter(b => b.type === 'tool_result'))
  return { init: events.find(e => e.type === 'system' && e.subtype === 'init'), calls, results, result: events.find(e => e.type === 'result'), name }
}
const cost = r => `$${(r.result?.total_cost_usd ?? 0).toFixed(3)}`
const text = r => JSON.stringify(r.results.map(x => x.content))
const mcpJson = () => JSON.parse(readFileSync(join(project, '.mcp.json'), 'utf8'))

const scenarios = {
  register() {
    mkdirSync(join(project, 'srv'), { recursive: true })
    writeFileSync(join(project, 'srv', 'server.mjs'), SERVER)
    const prompt = `Use ToolSearch to load paper_mcp from the academic-harness server, then call it once with action "register", serverName "demo", command "${process.execPath}", args ["${join(project, 'srv', 'server.mjs')}"], cwd "${project}" and envNames ["DEMO_TOKEN"]. Then tell me what it said.`
    const r = run('register', prompt, { allow: ['ToolSearch', PM], env: { DEMO_TOKEN: SECRET } })
    const call = r.calls.find(c => c.name === PM)
    assert.ok(call, `paper_mcp was not called: ${r.calls.map(c => c.name)}`)
    assert.equal(call.input.action, 'register')
    assert.ok(existsSync(join(project, '.mcp.json')), `no .mcp.json: ${text(r).slice(0, 400)}`)
    const entry = mcpJson().mcpServers.demo
    assert.equal(entry.command, 'bash')
    assert.deepEqual(entry.args.slice(0, 3), ['-c', 'cd "$0" && exec "$@"', project])
    assert.equal(entry.env.DEMO_TOKEN, '${DEMO_TOKEN}')
    assert.ok(!readFileSync(join(project, '.mcp.json'), 'utf8').includes(SECRET), 'the secret value is in .mcp.json')
    assert.ok(!readFileSync(join(project, '.dsh', 'paper-mcps.json'), 'utf8').includes(SECRET), 'the secret value is in the registry')
    return `.mcp.json written with the variable as a name, no value, ${cost(r)}`
  },
  gated() {
    // `claude -p` skips the project-server prompt (its workspace trust dialog is skipped in print mode), so this one runs the real TUI under tmux.
    const sh = (...a) => spawnSync('tmux', a, { encoding: 'utf8' })
    const session = `papermcp-${Date.now()}`
    sh('new-session', '-d', '-s', session, '-x', '140', '-y', '45', '-c', project, `DEMO_TOKEN=${SECRET} AH_MOD_HOME=${join(base, 'home')} claude --plugin-dir ${root} --model haiku`)
    try {
      let screen = ''
      for (let i = 0; i < 20 && !/New MCP server found in this project: demo/.test(screen); i++) { spawnSync('sleep', ['2']); screen = sh('capture-pane', '-t', session, '-p').stdout }
      assert.match(screen, /New MCP server found in this project: demo/, `no approval prompt:\n${screen.slice(-600)}`)
      assert.match(screen, /Continue without using this MCP server/, 'the prompt offers a no')
      return 'Claude Code asked before using the new project server (it defaults to "Continue without")'
    } finally { sh('kill-session', '-t', session) }
  },
  approved() {
    const r = run('approved', 'Use ToolSearch to load the whoami tool of the demo MCP server, call it once, and reply with exactly what it returned.', { allow: ['ToolSearch', 'mcp__demo'], env: { DEMO_TOKEN: SECRET }, settings: { enableAllProjectMcpServers: true } })
    const demo = (r.init?.mcp_servers ?? []).find(s => s.name === 'demo')
    assert.equal(demo?.status, 'connected', `demo: ${JSON.stringify(demo)}`)
    const call = r.calls.find(c => /^mcp__demo__whoami$/.test(c.name))
    assert.ok(call, `whoami was not called: ${r.calls.map(c => c.name)}`)
    const out = text(r)
    assert.ok(out.includes(`cwd=${project}`), `the server did not run in its folder: ${out}`)
    assert.ok(out.includes(`token=${SECRET}`), `the variable did not arrive: ${out}`)
    return `started in ${project} and saw the variable, ${cost(r)}`
  },
  unregister() {
    const r = run('unregister', 'Use ToolSearch to load paper_mcp from the academic-harness server, then call it once with action "unregister" and serverName "demo". Then tell me what it said.', { allow: ['ToolSearch', PM] })
    assert.ok(r.calls.some(c => c.name === PM && c.input.action === 'unregister'), `unregister was not called: ${r.calls.map(c => c.name)}`)
    const doc = existsSync(join(project, '.mcp.json')) ? mcpJson() : { mcpServers: {} }
    assert.equal(doc.mcpServers?.demo, undefined, 'still in .mcp.json')
    const registry = JSON.parse(readFileSync(join(project, '.dsh', 'paper-mcps.json'), 'utf8'))
    assert.ok(!registry.servers.some(s => s.serverName === 'demo'), 'still in the registry')
    return `removed from the registry and .mcp.json, ${cost(r)}`
  },
}

const which = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(scenarios)
let failed = 0
for (const name of which) {
  if (!scenarios[name]) { console.log(`${name}: unknown scenario`); failed++; continue }
  try { console.log(`${name}: ok: ${scenarios[name]()}`) } catch (e) { failed++; console.log(`${name}: FAIL ${String(e.message).slice(0, 700)}`) }
}
process.exit(failed ? 1 : 0)
