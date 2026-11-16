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
//   AH_BOOTSTRAP=0     do not fetch the source snapshot on first start (the server then exits, saying what to run)
//
// On first start without a snapshot the server answers at once with its doctor tool alone, fetches the snapshot into <home>/upstream/<sha>
// (server/src/bootstrap.mjs), then swaps in the full tool list and tells the client it changed.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootstrapInWorker, pruneOldSnapshots } from '../src/bootstrap.mjs'
import { Registry } from '../src/context.mjs'
import { prepareEnv } from '../src/env.mjs'
import { createHost, hostOver, missingDependencies, serve } from '../src/host.mjs'
import { lateHost } from '../src/late-host.mjs'
import { parseAreas } from '../src/manifest.mjs'
import { isDevMode, modRoot, upstreamDir } from '../src/paths.mjs'

// `--list` only reads: no installer may start for it.
const keysSet = prepareEnv(process.env, { areas: process.argv.includes('--list') ? undefined : parseAreas(process.env.AH_TOOL_AREAS).areas })
// A diagnostic for tests and for "did my setting arrive?": AH_KEYS_REPORT=<file> records which key variables the server got, as name, length and a short hash. Never a value.
if (process.env.AH_KEYS_REPORT?.trim()) {
  const report = Object.fromEntries(keysSet.map(name => [name, { length: process.env[name].length, sha256: createHash('sha256').update(process.env[name]).digest('hex').slice(0, 12) }]))
  try { writeFileSync(process.env.AH_KEYS_REPORT, `${JSON.stringify(report)}\n`) } catch { /* a diagnostic that cannot be written is not worth stopping for */ }
}

const say = text => process.stderr.write(`[academic-harness] ah: ${text}\n`)
const listing = process.argv.includes('--list')

/** The writing engine (the `ah_*` tools and the guard) needs its virtual environment. When the writing area is loaded and the
 *  environment is missing, build it in the background (a detached worker, bin/ah-engine-install.mjs); until it is ready the tools and the guard say so.
 *  AH_AUTO_INSTALL=0 turns this off. It never runs for --list, in development mode or when ACADEMIC_HARNESS_CLI is set. */
async function buildEngineInBackground() {
  if (listing || process.env.AH_AUTO_INSTALL?.trim() === '0' || !parseAreas(process.env.AH_TOOL_AREAS).areas.includes('writing')) return
  const { engineStatus } = await import('../src/engine.mjs')
  if (engineStatus(process.env, undefined, { verify: false }).ok) return
  // In a process of its own, so that a session that ends before the build does (a headless run) does not end the build with it.
  import('../src/engine-install.mjs')
    .then(m => m.installEngineInWorker())
    .then(r => say(r.ok ? 'writing engine ready' : `the writing engine is not ready: ${r.why}. \`node scripts/install-engine.mjs\` builds it and shows why`))
    .catch(error => say(`the writing engine could not be installed: ${error.message}`))
}

/** A pull of the plugin can move the lock to a new commit while upstream/ still holds the old snapshot, dependencies and all, and the server
 *  would load it without a word. Comparing versions costs two small reads (the doctor compares every byte); say so on stderr. */
function warnIfSnapshotIsOld() {
  if (isDevMode() || listing) return
  try {
    const lock = JSON.parse(readFileSync(join(modRoot(), 'UPSTREAM.lock.json'), 'utf8'))
    const held = JSON.parse(readFileSync(join(upstreamDir(), 'package.json'), 'utf8')).version
    if (lock.version && held && lock.version !== held) say(`the snapshot is Academic Harness ${held}, the lock says ${lock.version}: run \`node scripts/setup.mjs\` in the plugin folder to take the locked one`)
  } catch { /* no lock or no snapshot: the doctor says so */ }
}

const open = async () => {
  warnIfSnapshotIsOld()
  return createHost({ upstream: upstreamDir(), areas: process.env.AH_TOOL_AREAS, cwd: process.cwd() })
}
// The snapshot is fetched on first start (bootstrap.mjs) unless this is development mode, `--list`, or AH_BOOTSTRAP=0.
const needsFetch = !isDevMode() && !listing && process.env.AH_BOOTSTRAP?.trim() !== '0' && missingDependencies(upstreamDir()) !== null

// Snapshots an update left behind in the mod's home (bootstrap.mjs): removed in the background, a week after their last use.
if (!listing) void pruneOldSnapshots().then(gone => { if (gone.length) say(`removed ${gone.length} old source snapshot${gone.length === 1 ? '' : 's'}: ${gone.join(', ')}`) })

let host
if (needsFetch) {
  // Answer now with the doctor alone; the full tool list follows when the fetch is done.
  say('the source snapshot is not here yet: fetching it (the doctor tool says how far it has got)')
  const placeholder = hostOver(new Registry(), { env: process.env, cwd: process.cwd() })
  const late = lateHost(placeholder)
  host = late
  // In a process of its own, so that a session that ends before the download does (a headless run) does not end the download with it.
  bootstrapInWorker()
    .then(async () => {
      say('snapshot ready')
      late.swap(await open())
      await buildEngineInBackground()
    })
    .catch(error => say(`could not set up: ${error.message}. Run \`node scripts/setup.mjs\` in the plugin folder, or see /academic doctor.`))
} else {
  try {
    host = await open()
  } catch (error) {
    process.stderr.write(`[academic-harness] ah: ${error.message}\n`)
    process.exit(1)
  }
  await buildEngineInBackground()
}

if (listing) {
  process.stdout.write(`${JSON.stringify({ tools: host.list().map(t => t.name), loaded: host.loaded, failed: host.failed }, null, 2)}\n`)
  await host.dispose()
  process.exit(0)
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => host.dispose().finally(() => process.exit(0)))
await serve({ host })
await host.dispose()
process.exit(0)
