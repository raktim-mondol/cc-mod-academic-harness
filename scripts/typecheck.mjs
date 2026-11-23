#!/usr/bin/env node
// The hooks module's type check (`npm run typecheck`): tsc over hooks/, types/ and the plugin tests, against the engine's own typings.
//
// Those typings are not in the repository: the engine writes them into .claude-plugin/types/ whenever a mod loads in a session, and the MCP part
// (claude-code-mcp/index.d.ts) holds the input types of every MCP tool that session had connected. A session with a large set of connectors
// (a hundred tools of other servers) writes a file of megabytes, and tsc then gives up on the PreToolUse event with TS2589 ("Type instantiation is
// excessively deep") and a run of TS2339 after it. The code is not at fault; the typings are. This runs tsc and, only for that failure, says how to
// get small typings back.
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const MCP_TYPES = join(root, '.claude-plugin', 'types', 'claude-code-mcp', 'index.d.ts')
/** A generated MCP typings file this large is what makes tsc give up. */
export const TOO_BIG_BYTES = 500_000

/** The advice for a failed run, or null when the failure is not that one. `output` is tsc's text, `bytes` the size of the MCP typings. */
export function hint(output, bytes) {
  if (!/error TS2589/.test(String(output)) || !(bytes > TOO_BIG_BYTES)) return null
  return [
    `The type errors above come from the generated typings, not from the code: ${MCP_TYPES.slice(root.length + 1)} is ${(bytes / 1e6).toFixed(1)} MB,`,
    'written by a session that had many MCP servers connected. Write small ones with a session that has none of the claude.ai connectors, then run this again:',
    '',
    '  mv .claude-plugin/types/claude-code-mcp/index.d.ts /tmp/ && ENABLE_CLAUDEAI_MCP_SERVERS=false claude --plugin-dir "$PWD"     # exit it once it has started',
  ].join('\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = spawnSync('npx', ['--yes', '-p', 'typescript@5.6.3', 'tsc', '-p', '.', '--noEmit'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 })
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`
  process.stdout.write(text)
  if (r.status !== 0) {
    const advice = hint(text, existsSync(MCP_TYPES) ? statSync(MCP_TYPES).size : 0)
    if (advice) process.stderr.write(`\n${advice}\n`)
  }
  process.exit(r.status ?? 1)
}
