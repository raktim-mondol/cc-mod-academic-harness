#!/usr/bin/env node
// Install the snapshot's runtime dependencies inside upstream/ (never in the source checkout).
//
//   node scripts/install-deps.mjs            npm ci --omit=dev, only when the lock changed
//   node scripts/install-deps.mjs --force    reinstall
//
// The upstream modules import `ah-dsh-tools` and other packages by bare name, and Node resolves those
// from the importing file's folder upward, so the packages must sit in upstream/node_modules.
// sync-upstream.mjs keeps that folder across a sync when package-lock.json is unchanged.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const upstream = process.env.AH_UPSTREAM?.trim() ? null : join(root, 'upstream')

export function install({ force = false, dir, quiet = false } = {}) {
  if (!upstream && !dir) throw new Error('AH_UPSTREAM is set (development mode): nothing is installed into a checkout')
  const target = dir ?? upstream
  const lockFile = join(target, 'package-lock.json')
  if (!existsSync(lockFile)) throw new Error(`${lockFile} is missing: run node scripts/sync-upstream.mjs first`)
  const stamp = join(target, 'node_modules', '.ah-lock-sha256')
  const want = createHash('sha256').update(readFileSync(lockFile)).digest('hex')
  const have = existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : ''
  if (!force && have === want && existsSync(join(target, 'node_modules', 'ah-dsh-tools'))) return { installed: false, sha: want }
  const r = spawnSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: target, stdio: ['ignore', quiet ? 'ignore' : 'inherit', 'inherit'] })
  if (r.status !== 0) throw new Error(`npm ci failed (exit ${r.status})`)
  writeFileSync(stamp, `${want}\n`)
  return { installed: true, sha: want }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const r = install({ force: process.argv.includes('--force') })
    console.log(r.installed ? 'installed dependencies in upstream/node_modules' : 'dependencies already match upstream/package-lock.json')
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
