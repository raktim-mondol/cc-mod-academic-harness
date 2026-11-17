#!/usr/bin/env node
// Run the writing engine's own pytest suite against the snapshot, in a throw-away venv under ~/.cache.
//
//   node scripts/test-engine.mjs                      tests/test_claude_adapter.py (the hook handlers)
//   node scripts/test-engine.mjs --all                the whole engine suite
//   node scripts/test-engine.mjs tests/test_x.py -k y extra pytest arguments
//
// The snapshot's own .venv is left alone: pytest is a dev dependency and does not belong in what the guard runs.
// The engine is installed from the snapshot (a copy, not an editable link), so what is tested is what was synced.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { engineDir } from '../server/src/engine.mjs'
import { isDevMode } from '../server/src/paths.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scratch = join(homedir(), '.cache', 'ah-cc-p3', 'engine-test')
const dir = engineDir(join(root, 'core'))

function which(name) {
  for (const d of (process.env.PATH || '').split(delimiter)) if (d && existsSync(join(d, name))) return join(d, name)
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.error) throw r.error
  return r.status ?? 1
}

if (isDevMode()) throw new Error('AH_CORE is set: this script tests the snapshot only')
if (!existsSync(join(dir, 'tests'))) throw new Error(`no engine tests in ${dir}: run node scripts/setup.mjs`)
mkdirSync(scratch, { recursive: true })
const venv = join(scratch, 'venv')
const py = join(venv, 'bin', 'python')
const uv = process.env.UV?.trim() || which('uv')
if (!existsSync(py)) {
  if (uv) {
    if (sh(uv, ['venv', venv]) !== 0) process.exit(1)
  } else if (sh(which('python3') ?? 'python3', ['-m', 'venv', venv]) !== 0) process.exit(1)
}
// Always reinstall the engine, so a sync is what gets tested.
const installed = uv
  ? sh(uv, ['pip', 'install', '--python', py, '--reinstall-package', 'academic-harness', 'pytest>=8', dir])
  : sh(py, ['-m', 'pip', 'install', '--force-reinstall', '--no-deps', dir]) || sh(py, ['-m', 'pip', 'install', 'pytest>=8', dir])
if (installed !== 0) process.exit(1)

const args = process.argv.slice(2)
const all = args.includes('--all')
const rest = args.filter(a => a !== '--all')
const targets = rest.length ? rest : all ? ['tests'] : ['tests/test_claude_adapter.py']
const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: '' }
const where = spawnSync(py, ['-c', 'import ah, sys; sys.stdout.write(ah.__file__)'], { encoding: 'utf8', env, cwd: scratch }).stdout
if (where.startsWith(dir)) throw new Error(`the tests would import the snapshot's source tree (${where}), not the installed copy`)
console.log(`engine under test: ${where}`)
process.exit(sh(py, ['-m', 'pytest', '-q', '-p', 'no:cacheprovider', ...targets], { cwd: dir, env }))
