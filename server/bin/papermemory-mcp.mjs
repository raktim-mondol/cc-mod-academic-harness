#!/usr/bin/env node
// Launcher for the PaperMemory MCP server. The plugin manifest runs this as the `papermemory` server.
//
//   node server/bin/papermemory-mcp.mjs            run `papermemory mcp` over stdio (installs it first if needed)
//   node server/bin/papermemory-mcp.mjs --install  install only, to warm the first run
//   node server/bin/papermemory-mcp.mjs --where    print how it would be launched, then exit
//
// If the CLI cannot be found or installed this exits 1 with a message on stderr, so a missing
// memory server shows up as a failed server and never looks like an empty library.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { bootstrap } from '../src/bootstrap.mjs'
import { findManaged, isDevMode, resolveLaunch, say, serverEnv, installDir, vendorDir } from '../src/papermemory.mjs'

const arg = process.argv[2]
// The first install builds from the core's PaperMemory source. On a first start the `ah` server is copying the core at the same moment: join in
// (bootstrap.mjs coordinates), so this server does not fail for a copy that is a minute away.
if (!process.env.PAPERMEMORY_CLI?.trim() && !isDevMode() && !findManaged() && !existsSync(join(vendorDir(), 'pyproject.toml')) && process.env.AH_BOOTSTRAP?.trim() !== '0') {
  say('the core is not set up yet: setting it up first')
  try { await bootstrap() } catch (error) { say(`could not set it up: ${error.message}`) }
}
const launch = await resolveLaunch()
if (!launch) {
  say(`CLI not found and could not be installed. Set PAPERMEMORY_CLI to a papermemory executable, or fix ${installDir()} (source: ${vendorDir()}).`)
  process.exit(1)
}
if (arg === '--install') { say(`ready: ${launch.command}`); process.exit(0) }
if (arg === '--where') { process.stdout.write(JSON.stringify(launch) + '\n'); process.exit(0) }

const child = spawn(launch.command, [...launch.args, 'mcp'], { env: serverEnv(), stdio: 'inherit' })
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { try { child.kill(sig) } catch { /* gone */ } })
child.on('error', e => { say(`could not start ${launch.command}: ${e.message}`); process.exit(1) })
child.on('close', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
