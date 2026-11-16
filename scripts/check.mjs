#!/usr/bin/env node
// The checks that need no account and no model, behind one command:
//
//   npm run check              the node suites, the manifest check and the tool-surface check
//   npm run check -- --types   also the hooks module's type check (the types exist after a real session has loaded the mod)
//
// CI runs `npm run check` after `node scripts/setup.mjs --github`. The live scripts are not here: they drive a real Claude Code and cost
// money (docs/maintain/testing.md). Everything runs from the repository root, whichever folder the command was started in.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { upstreamDir } from '../server/src/paths.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const hasUpstream = existsSync(join(upstreamDir(), 'package.json'))
const hasTypes = existsSync(join(root, '.claude-plugin', 'types', 'claude-code', 'index.d.ts'))

if (!hasUpstream) {
  console.error('The source snapshot is missing: run `node scripts/setup.mjs` first, or point AH_UPSTREAM at an Academic Harness checkout.')
  process.exit(2)
}

const steps = [
  { name: 'Node suites', command: process.execPath, args: ['--test', 'tests/scripts/*.test.mjs', 'tests/server/*.test.mjs'] },
  { name: 'plugin.json matches the snapshot', command: process.execPath, args: ['scripts/build-manifest.mjs', '--check'] },
  { name: 'the served tool surface', command: process.execPath, args: ['scripts/measure-surface.mjs'] },
]
if (args.has('--types')) {
  if (hasTypes) steps.push({ name: 'hooks module types', command: 'npx', args: ['--yes', '-p', 'typescript@5.6.3', 'tsc', '-p', '.', '--noEmit'] })
  else console.log('! hooks module types: skipped (the engine writes .claude-plugin/types after a real session loads the mod)')
}

const seconds = ms => `${(ms / 1000).toFixed(1)} s`
const failed = []
for (const [index, step] of steps.entries()) {
  console.log(`\n[${index + 1}/${steps.length}] ${step.name}`)
  const started = Date.now()
  const run = spawnSync(step.command, step.args, { cwd: root, stdio: 'inherit', env: process.env })
  const took = Date.now() - started
  if (run.error || run.status !== 0) {
    failed.push({ ...step, status: run.status, error: run.error })
    console.error(`✘ ${step.name} (${seconds(took)})`)
  } else {
    console.log(`✔ ${step.name} (${seconds(took)})`)
  }
}

if (failed.length) {
  console.error(`\n${failed.length} of ${steps.length} checks failed:`)
  for (const f of failed) console.error(`  ${f.name}${f.error ? `: ${f.error.message}` : ` (exit ${f.status})`}`)
  process.exit(1)
}
console.log(`\nAll ${steps.length} checks passed.`)
