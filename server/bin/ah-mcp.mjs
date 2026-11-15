#!/usr/bin/env node
// The `ah` MCP server: the Academic Harness tools, run from the snapshot in upstream/.
//
//   node server/bin/ah-mcp.mjs            serve over stdio
//   node server/bin/ah-mcp.mjs --list     print the tools that would be served, then exit
//
// Environment (set before any upstream module is imported):
//   DSH_HOME           the mod's own home (AH_MOD_HOME), never ~/.dsh
//   AH_TOOL_AREAS      comma list of search,papers,notebook,skills, or "all" (default)
//   AH_KEY_<NAME>      a key from the plugin's userConfig; copied to <NAME> only when <NAME> is unset or empty,
//                      so a variable exported in the shell keeps winning (credential-env.js reads process.env first)
//   AH_UPSTREAM        development mode: read a checkout, install nothing
import { KEY_ENV_PREFIX, prepareEnv } from '../src/env.mjs'
import { createHost, serve } from '../src/host.mjs'
import { upstreamDir } from '../src/paths.mjs'

prepareEnv(process.env)
void KEY_ENV_PREFIX

let host
try {
  host = await createHost({ upstream: upstreamDir(), areas: process.env.AH_TOOL_AREAS, cwd: process.cwd() })
} catch (error) {
  process.stderr.write(`[academic-harness] ah: ${error.message}\n`)
  process.exit(1)
}

if (process.argv.includes('--list')) {
  process.stdout.write(`${JSON.stringify({ tools: host.list().map(t => t.name), loaded: host.loaded, failed: host.failed }, null, 2)}\n`)
  await host.dispose()
  process.exit(0)
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => host.dispose().finally(() => process.exit(0)))
await serve({ host })
await host.dispose()
process.exit(0)
