#!/usr/bin/env node
// Build the Python helper environment inside the snapshot (never in the source checkout).
//
//   node scripts/install-helpers.mjs            uv sync --frozen in upstream/python-helpers (numpy, scipy, pandas, rdkit, ...)
//   node scripts/install-helpers.mjs --check    exit 1 when the environment is missing
//
// The data, statistics, chemistry and sequence tools shell out to python-helpers/. upstream's python-runtime.js uses
// python-helpers/.venv when it exists and python3 on PATH otherwise, so this step is optional: without it a tool uses
// whatever python3 has and reports the import it lacks. It is large (hundreds of MB) and needs the network once.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDevMode } from '../server/src/paths.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'upstream', 'python-helpers')
const python = join(dir, '.venv', 'bin', 'python')

if (process.argv.includes('--check')) {
  console.log(existsSync(python) ? 'helper environment ready' : 'helper environment missing: run node scripts/install-helpers.mjs')
  process.exit(existsSync(python) ? 0 : 1)
}
if (isDevMode()) { console.error('AH_UPSTREAM is set (development mode): nothing is built inside a checkout.'); process.exit(1) }
if (!existsSync(join(dir, 'pyproject.toml'))) { console.error(`no ${dir}: run node scripts/sync-upstream.mjs first`); process.exit(1) }
const uv = process.env.UV?.trim() || (process.env.PATH || '').split(delimiter).map(d => join(d, 'uv')).find(existsSync)
if (!uv) { console.error('uv is required (https://docs.astral.sh/uv/). It builds the helper environment from the locked versions.'); process.exit(1) }
const r = spawnSync(uv, ['sync', '--frozen', '--no-dev'], { cwd: dir, stdio: 'inherit' })
process.exit(r.status ?? 1)
