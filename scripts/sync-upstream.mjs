#!/usr/bin/env node
// Take a snapshot of the Academic Harness source at a pinned commit into upstream/.
//
//   node scripts/sync-upstream.mjs [--commit <sha>] [--source <path>]
//
// The source checkout is only read, with `git archive` and `git ls-tree` against
// the object database: no working-tree file is opened and nothing is written in
// it (ground rule 1 of IMPLEMENTATION_PLAN.md). Output:
//   upstream/            the allow-listed files at that commit (gitignored)
//   UPSTREAM.lock.json   commit, package version, allow-list, and the SHA-256 of
//                        the archive, so a later run can prove it got the same bytes
//
// The default commit is the one in UPSTREAM.lock.json, else PINNED below.
// Environment: AH_SOURCE (default ~/academic-harness).

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PINNED = 'a3f17eb8ae15221adeaa45cd19918c1f82f82973'

// Paths taken from the source. Each phase adds what it needs; a path that does not
// exist at the commit is reported and skipped, never silently ignored.
export const ALLOW = [
  // identity and licence
  'package.json',
  'LICENSE',
  'NOTICE',
  'docs/legal',
  // P1: prompt, skills, PaperMemory
  'prompt.js',
  'untrusted-fence.js',
  'skills-core.json',
  'skill-licenses.js',
  'skills',
  'vendor/papermemory',
]

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function git(source, args, opts = {}) {
  return execFileSync('git', ['-C', source, ...args], { maxBuffer: 1 << 30, ...opts })
}

export function sync({ source, commit, outDir = join(root, 'upstream'), lockFile = join(root, 'UPSTREAM.lock.json'), allow = ALLOW } = {}) {
  const sha = git(source, ['rev-parse', '--verify', `${commit}^{commit}`], { encoding: 'utf8' }).trim()
  const present = []
  const missing = []
  for (const p of allow) {
    const found = git(source, ['ls-tree', '--name-only', sha, '--', p], { encoding: 'utf8' }).trim()
    ;(found ? present : missing).push(p)
  }
  if (present.length === 0) throw new Error('none of the allow-listed paths exist at ' + sha)

  const tar = git(source, ['archive', '--format=tar', sha, '--', ...present])
  const archiveSha256 = createHash('sha256').update(tar).digest('hex')

  const staging = outDir + '.staging'
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  execFileSync('tar', ['-x', '-C', staging], { input: tar, maxBuffer: 1 << 30 })

  const pkg = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8'))
  rmSync(outDir, { recursive: true, force: true })
  renameSync(staging, outDir)

  const lock = {
    source: 'github.com/raktim-mondol/academic-harness',
    commit: sha,
    version: pkg.version,
    archiveSha256,
    paths: present,
    missing,
  }
  writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n')
  return lock
}

function main() {
  const args = process.argv.slice(2)
  const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
  const lockFile = join(root, 'UPSTREAM.lock.json')
  const locked = existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, 'utf8')).commit : undefined
  const source = opt('--source') ?? process.env.AH_SOURCE ?? join(homedir(), 'academic-harness')
  const commit = opt('--commit') ?? locked ?? PINNED
  const lock = sync({ source, commit })
  console.log(`synced ${lock.paths.length} paths at ${lock.commit.slice(0, 7)} (version ${lock.version}), archive sha256 ${lock.archiveSha256.slice(0, 12)}`)
  if (lock.missing.length) console.log(`not present at that commit: ${lock.missing.join(', ')}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
