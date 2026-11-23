// paper_mcp, in Claude Code: register a Paper2MCP server in the project's `.mcp.json`.
//
// Upstream's paper_mcp mounts a stdio server into the running process with an MCP client of its own. Claude Code has no such call:
// it reads servers from `.mcp.json` (project scope), asks the person to approve each one the first time it sees it, and starts it
// when a session opens. So the tool's "mount" becomes "write the entry", and what the person has to do next is approve it and
// reload (`/mcp`, or a new session). Nothing is started here.
//
// The entry never holds a secret: environment variables are written as `${NAME}` and Claude Code fills them from the shell it
// was started in. The server runs in its own folder through `bash -c 'cd "$0" && exec "$@"'`, because `.mcp.json` has no `cwd`.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const SAFE_ENV = /^[A-Za-z_][A-Za-z0-9_]*$/

/** The `.mcp.json` entry for a server spec ({ serverName, command, args, cwd, env }). `env` values are dropped; only the names are kept. */
export function mcpEntry({ command, args = [], cwd, env = {} }) {
  const names = Object.keys(env).filter(n => n !== 'PYTHONUNBUFFERED' && SAFE_ENV.test(n))
  return {
    type: 'stdio',
    command: 'bash',
    args: ['-c', 'cd "$0" && exec "$@"', cwd, command, ...args],
    env: { PYTHONUNBUFFERED: '1', ...Object.fromEntries(names.map(n => [n, `\${${n}}`])) },
  }
}

/** Write (or replace) one server in <root>/.mcp.json, keeping everything else in the file. Throws when the file is not valid JSON, rather than overwrite it. */
export function writeMcpJson(root, serverName, spec) {
  const file = join(root, '.mcp.json')
  let doc = {}
  if (existsSync(file)) {
    try { doc = JSON.parse(readFileSync(file, 'utf8')) } catch (error) { throw new Error(`${file} is not valid JSON (${error.message}); fix it, then register again`) }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error(`${file} is not a JSON object`)
  }
  const servers = doc.mcpServers && typeof doc.mcpServers === 'object' ? doc.mcpServers : {}
  const next = mcpEntry(spec)
  if (JSON.stringify(servers[serverName]) === JSON.stringify(next)) return { file, changed: false }
  doc.mcpServers = { ...servers, [serverName]: next }
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`)
  renameSync(tmp, file)
  return { file, changed: true }
}

/** Remove a server this module wrote (a bash wrapper whose command is ours). Returns whether anything was removed. */
export function removeFromMcpJson(root, serverName) {
  const file = join(root, '.mcp.json')
  if (!existsSync(file)) return false
  let doc
  try { doc = JSON.parse(readFileSync(file, 'utf8')) } catch { return false }
  const entry = doc?.mcpServers?.[serverName]
  if (!entry || entry.command !== 'bash' || entry.args?.[1] !== 'cd "$0" && exec "$@"') return false
  delete doc.mcpServers[serverName]
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`)
  renameSync(tmp, file)
  return true
}

/**
 * What `ctx.plugin(McpClient, opts)` does for paper-mcp.js: register the server with Claude Code. `workspace.cwd` is the session
 * directory at the time of the call. Approval is Claude Code's own: it asks before it starts a project server.
 */
export function pluginMounter(workspace) {
  return (_client, opts = {}) => {
    const root = workspace.cwd
    if (!root) throw new Error('no workspace folder to write .mcp.json in')
    // The variables the registry names, whether or not a value is set now: Claude Code fills `${NAME}` from its own environment when it starts the server.
    let names = []
    try {
      const registry = JSON.parse(readFileSync(join(root, '.dsh', 'paper-mcps.json'), 'utf8'))
      names = registry.servers?.find(s => s.serverName === opts.serverName)?.envNames ?? []
    } catch { /* no registry: only what the call carried */ }
    const env = { ...Object.fromEntries(names.filter(n => typeof n === 'string').map(n => [n, ''])), ...opts.env }
    writeMcpJson(root, opts.serverName, { command: opts.command, args: opts.args, cwd: opts.cwd ?? root, env })
  }
}

/** The `approval` service paper-mcp.js asks. The person's real approval is Claude Code's, when it first sees the .mcp.json entry; this only lets the entry be written. */
export const approvalStub = { request: async () => 'allowed-once' }
