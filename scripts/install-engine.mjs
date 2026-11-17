#!/usr/bin/env node
// Build the writing engine's virtual environment inside the snapshot (never in the source checkout).
//
//   node scripts/install-engine.mjs            build when missing or when the engine's files changed
//   node scripts/install-engine.mjs --force    rebuild
//   node scripts/install-engine.mjs --check    exit 1 when the engine is not ready, build nothing
//
// The tool host does the same in the background when it starts with the engine missing (AH_AUTO_INSTALL=0 turns that
// off); this script is for doing it by hand. See server/src/engine-install.mjs.
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installEngine } from '../server/src/engine-install.mjs'
import { engineDir, engineStatus } from '../server/src/engine.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const upstream = join(root, 'core')

try {
  if (process.argv.includes('--check')) {
    const s = engineStatus({}, engineDir(upstream))
    console.log(s.ok ? `engine ready (${s.how})` : `engine not ready: ${s.why}`)
    process.exit(s.ok ? 0 : 1)
  }
  const r = await installEngine({ force: process.argv.includes('--force'), upstream })
  console.log(r.built ? `built the engine environment (${r.how})` : r.how)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
