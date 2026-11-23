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

// ---- the tool as the model sees it ----
//
// Upstream's paper_mcp talks about mounting a server into the running process, asking the person inside the tool, and restarting dsh.
// None of that is what happens here, so the description, the results and the status are rewritten to say what does: the entry is written
// to .mcp.json after the hooks module has asked the person (hooks/approvals.ts), and Claude Code asks again before it starts the server.

export const PAPER_MCP_DESCRIPTION = [
  'Register, list or drop Paper2MCP stdio servers for this project.',
  'The registry is <project>/.dsh/paper-mcps.json (python, server script, environment variable *names*, never secrets).',
  'action=status lists the registered servers and whether each is in the project\'s .mcp.json.',
  'action=register adds a server (from Paper2MCP\'s USAGE.md after a verified ZIP) and writes it into .mcp.json; the person is asked to confirm first, and Claude Code asks again before it starts the server, so its tools (mcp__<serverName>__*) appear once they approve it and reload with /mcp or start a new session.',
  'action=approve does the same for an entry that is already in the registry (for example one that came with a cloned folder).',
  'action=unregister removes it from the registry and from .mcp.json.',
  'Connect a server only when the user asked. Never put API keys in the JSON: name the variables in envNames, and the person sets them in the shell Claude Code starts in.',
].join(' ')

/** Is `serverName` in <root>/.mcp.json? */
export function hasMcpEntry(root, serverName) {
  try { return Boolean(JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'))?.mcpServers?.[serverName]) } catch { return false }
}

const writtenHint = (name, file) => `Written to ${file}. Claude Code asks you to approve the server the next time the project loads; run /mcp to reload now. Its tools will be mcp__${name}__*, and any variable it names must be set in the shell Claude Code was started from.`

/** The text of a paper_mcp result. */
export function renderPaperMcp(v) {
  if (!v || typeof v !== 'object') return String(v ?? '')
  if (v.error && !v.action) return `Error: ${v.error}`
  const lines = []
  if (v.action) lines.push(`action: ${v.action}`)
  if (v.path) lines.push(`registry: ${v.path}`)
  if (v.mcp_json) lines.push(`.mcp.json: ${v.in_mcp_json ? 'has the entry' : 'has no entry'} (${v.mcp_json})`)
  if (v.hint) lines.push(v.hint)
  if (Array.isArray(v.servers)) {
    if (!v.servers.length) lines.push('no paper MCP servers are registered in this project')
    for (const s of v.servers) {
      const bits = [s.serverName, s.in_mcp_json ? 'in .mcp.json' : 'not in .mcp.json']
      if (s.approved === false) bits.push('not confirmed yet')
      if (s.command) bits.push(s.command)
      lines.push(`- ${bits.join(' · ')}`)
      if (s.hint) lines.push(`  ${s.hint}`)
      if (s.error) lines.push(`  error: ${s.error}`)
    }
  }
  if (v.error) lines.push(`error: ${v.error}`)
  return lines.join('\n')
}

/** Rewrite the core's paper_mcp tool in place: its description, what its results say, and what happens on unregister. `workspace.cwd` is the session folder. */
export function adaptPaperMcpTool(tool, workspace) {
  const run = tool.execute.bind(tool)
  tool.description = PAPER_MCP_DESCRIPTION
  tool.output = { ...(tool.output ?? {}), render: (_args, value) => [{ type: 'text', text: renderPaperMcp(value) }] }
  tool.execute = async (args, exec) => {
    const root = exec?.agent?.session?.header?.cwd || workspace.cwd
    const action = args?.action ?? 'status'
    const value = await run(args, exec)
    if (!value || typeof value !== 'object') return value
    const name = typeof args?.serverName === 'string' ? args.serverName.trim() : ''
    if (action === 'status' && Array.isArray(value.servers)) {
      for (const s of value.servers) {
        s.in_mcp_json = hasMcpEntry(root, s.serverName)
        delete s.mounted; delete s.restart
        s.hint = s.in_mcp_json
          ? 'In .mcp.json. Claude Code starts it once you have approved it there (run /mcp to reload).'
          : (s.approved === false ? 'Not confirmed here yet: run paper_mcp action=approve, which asks the person.' : 'In the registry but not in .mcp.json: run paper_mcp action=approve to write it.')
      }
    } else if ((action === 'register' || action === 'approve') && !value.error) {
      value.mcp_json = join(root, '.mcp.json')
      value.in_mcp_json = hasMcpEntry(root, name)
      delete value.mounted; delete value.already; delete value.restart
      value.hint = value.in_mcp_json ? writtenHint(name, value.mcp_json) : (value.hint ?? 'The entry was not written to .mcp.json.')
    } else if (action === 'unregister' && !value.error && name) {
      try {
        const removed = removeFromMcpJson(root, name)
        delete value.mounted; delete value.restart
        value.hint = removed ? 'Removed from the registry and from .mcp.json; reload with /mcp.' : 'Removed from the registry.'
      } catch { /* the registry entry is gone either way */ }
    }
    return value
  }
  return tool
}
