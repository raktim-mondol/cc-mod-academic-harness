#!/usr/bin/env node
// Make a clone of this repository work. Everything it needs is in the clone (core/); this installs what is built from it.
//
//   node scripts/setup.mjs                  dependencies, the writing engine, a check
//   node scripts/setup.mjs --helpers        also the Python helper environment (about 800 MB, optional)
//   node scripts/setup.mjs --no-engine      leave the engine for the server to build in the background on first start
//
// What it does, each step skipped when it is already done:
//   1. the tool modules' npm dependencies, inside core/ (about 115 MB)
//   2. the writing engine's Python environment, inside core/vendor/academic-harness
//   3. the Python helpers, with --helpers
//   4. a check that plugin.json matches the core, and the doctor's report
// Skills, agents and the research-mode text are committed, so they need no build here (`node scripts/build-all.mjs` regenerates them).
// Nothing is downloaded from the plugin's own repository or from GitHub: only the npm and Python packages the core depends on.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { diagnose, format } from '../server/src/doctor.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const script = (name, extra = []) => spawnSync(process.execPath, [join(root, 'scripts', name), ...extra], { cwd: root, stdio: 'inherit', env: process.env })
const step = (n, text) => console.log(`\n[${n}] ${text}`)
const fail = message => { console.error(`\nsetup stopped: ${message}`); process.exit(1) }

if (process.env.AH_CORE?.trim()) fail('AH_CORE is set (development mode): the core is a folder of your own, and nothing is installed into it. Unset it.')
if (Number(process.versions.node.split('.')[0]) < 22) fail(`Node.js ${process.versions.node} is too old: 22 or newer is needed`)
if (spawnSync('npm', ['--version'], { stdio: 'ignore' }).status !== 0) fail('npm is not on PATH')
if (!existsSync(join(root, 'core', 'package.json'))) fail('core/ is missing: this is not a clone of the repository')

step(1, 'tool dependencies (npm ci, inside core/)')
if (script('install-deps.mjs').status !== 0) fail('npm ci failed')

if (flag('--no-engine')) {
  step(2, 'writing engine: skipped (the server builds it in the background on first start)')
} else {
  step(2, 'writing engine (a Python environment inside core/vendor/academic-harness)')
  if (script('install-engine.mjs').status !== 0) console.log('the engine did not build: ah_* tools and the guard will say so until it does. Fix the error above and rerun, or leave it to the server.')
}

if (flag('--helpers')) {
  step(3, 'Python helpers (about 800 MB)')
  if (script('install-helpers.mjs').status !== 0) console.log('the helpers did not install: the data and statistics tools fall back to python3.')
}

step(4, 'check')
if (script('build-manifest.mjs', ['--check']).status !== 0) console.log('plugin.json differs from what the core would generate: run node scripts/build-manifest.mjs and review the change.')
const report = await diagnose({ root })
console.log(`\n${format(report)}`)
console.log(`\nStart Claude Code with the plugin:\n  claude --plugin-dir ${root}\nor export CLAUDE_CODE_PLUGIN_DIRS=${root} to load it in every session. Inside a session, /academic doctor shows this report again.`)
process.exit(report.blocking ? 1 : 0)
