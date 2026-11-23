// What a folder can start on its own.
//
// In an interactive session Claude Code asks before it starts a project's MCP servers (`.mcp.json`) or runs the hooks in its project settings
// (`.claude/settings.json`). In a headless run (`claude -p`, the SDK) it does not ask: both start. So a folder that came from somewhere else
// (a clone, a pull request, a downloaded archive) can run programs there. This reads the two places and reports names and counts, never a
// command, so the doctor can say it. See docs/guide/headless.md for what to do about it (`--restricted`).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = file => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null } }

/** { mcp: [server names], hooks: [{ file, events }] } for the folder `cwd`. Nothing but names; a file that is missing or not JSON counts as empty. */
export function projectStartups(cwd) {
  const out = { mcp: [], hooks: [] }
  const mcp = read(join(cwd, '.mcp.json'))
  if (mcp && typeof mcp === 'object' && mcp.mcpServers && typeof mcp.mcpServers === 'object') out.mcp = Object.keys(mcp.mcpServers).sort()
  for (const name of ['settings.json', 'settings.local.json']) {
    const doc = read(join(cwd, '.claude', name))
    const hooks = doc && typeof doc === 'object' && doc.hooks && typeof doc.hooks === 'object' ? doc.hooks : null
    const events = hooks ? Object.keys(hooks).filter(k => Array.isArray(hooks[k]) && hooks[k].length > 0).sort() : []
    if (events.length) out.hooks.push({ file: `.claude/${name}`, events })
  }
  return out
}

/** The doctor's sentence for it, or null when the folder starts nothing. */
export function startupsLine(s) {
  const parts = []
  if (s.mcp.length) parts.push(`${s.mcp.length} MCP server${s.mcp.length === 1 ? '' : 's'} in .mcp.json (${s.mcp.slice(0, 6).join(', ')}${s.mcp.length > 6 ? ', ...' : ''})`)
  for (const h of s.hooks) parts.push(`hooks in ${h.file} (${h.events.join(', ')})`)
  if (!parts.length) return null
  return `this folder starts ${parts.join(' and ')}. Claude Code asks before it does in an interactive session and does not in claude -p: for a folder you did not write, run headless with --restricted (docs/guide/headless.md)`
}
