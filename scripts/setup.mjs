#!/usr/bin/env node
// Make a fresh clone of this repository work, with no source checkout.
//
//   node scripts/setup.mjs                  snapshot, dependencies, the writing engine, a check
//   node scripts/setup.mjs --helpers        also the Python helper environment (about 800 MB, optional)
//   node scripts/setup.mjs --no-engine      leave the engine for the server to build in the background on first start
//   node scripts/setup.mjs --github         take the snapshot from GitHub even when a checkout is present
//
// What it does, each step skipped when it is already done:
//   1. the snapshot of Academic Harness (upstream/) at the commit in UPSTREAM.lock.json: from the checkout at ~/academic-harness
//      (or AH_SOURCE) when it has that commit, else downloaded from GitHub (the repository is public) and checked against the digest
//      in the lock, so a download that is not the locked bytes is refused
//   2. the tool modules' npm dependencies, inside upstream/ (about 115 MB)
//   3. the writing engine's Python environment, inside upstream/vendor/academic-harness
//   4. the Python helpers, with --helpers
//   5. a check that plugin.json matches the snapshot, and the doctor's report
// Skills, agents and the research-mode text are committed, so they need no build here (`node scripts/build-all.mjs` regenerates them).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { diagnose, format } from '../server/src/doctor.mjs'
import { checkSnapshot } from '../server/src/snapshot.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const script = (name, extra = []) => spawnSync(process.execPath, [join(root, 'scripts', name), ...extra], { cwd: root, stdio: 'inherit', env: process.env })
const step = (n, text) => console.log(`\n[${n}] ${text}`)
const fail = message => { console.error(`\nsetup stopped: ${message}`); process.exit(1) }

if (process.env.AH_UPSTREAM?.trim()) fail('AH_UPSTREAM is set (development mode): the snapshot is a checkout, and nothing is installed into a checkout. Unset it.')
if (Number(process.versions.node.split('.')[0]) < 22) fail(`Node.js ${process.versions.node} is too old: 22 or newer is needed`)
for (const tool of ['tar', 'npm']) if (spawnSync(tool, ['--version'], { stdio: 'ignore' }).status !== 0) fail(`${tool} is not on PATH`)

const lockFile = join(root, 'UPSTREAM.lock.json')
if (!existsSync(lockFile)) fail('UPSTREAM.lock.json is missing: this is not a clone of the repository')
const lock = JSON.parse(readFileSync(lockFile, 'utf8'))

step(1, `source snapshot (Academic Harness ${lock.version}, commit ${lock.commit.slice(0, 7)})`)
const now = checkSnapshot(join(root, 'upstream'), lock)
if (now.state === 'ok' && !flag('--github')) console.log('already there, and its digest matches the lock')
else {
  const r = script('sync-upstream.mjs', flag('--github') ? ['--github'] : [])
  if (r.status !== 0) fail('the snapshot could not be taken (see above)')
}

step(2, 'tool dependencies (npm ci, inside upstream/)')
if (script('install-deps.mjs').status !== 0) fail('npm ci failed')

if (flag('--no-engine')) {
  step(3, 'writing engine: skipped (the server builds it in the background on first start)')
} else {
  step(3, 'writing engine (a Python environment inside upstream/vendor/academic-harness)')
  if (script('install-engine.mjs').status !== 0) console.log('the engine did not build: ah_* tools and the guard will say so until it does. Fix the error above and rerun, or leave it to the server.')
}

if (flag('--helpers')) {
  step(4, 'Python helpers (about 800 MB)')
  if (script('install-helpers.mjs').status !== 0) console.log('the helpers did not install: the data and statistics tools fall back to python3.')
}

step(5, 'check')
if (script('build-manifest.mjs', ['--check']).status !== 0) console.log('plugin.json differs from what the snapshot would generate: run node scripts/build-manifest.mjs and review the change.')
const report = await diagnose({ root })
console.log(`\n${format(report)}`)
console.log(`\nStart Claude Code with the plugin:\n  claude --plugin-dir ${root}\nor export CLAUDE_CODE_PLUGIN_DIRS=${root} to load it in every session. Inside a session, /academic doctor shows this report again.`)
process.exit(report.blocking ? 1 : 0)
