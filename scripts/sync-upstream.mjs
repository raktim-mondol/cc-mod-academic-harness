#!/usr/bin/env node
// Take a snapshot of the Academic Harness source at a pinned commit into upstream/.
//
//   node scripts/sync-upstream.mjs [--commit <sha>] [--source <path>]
//
// The source checkout is only read, with `git archive` and `git ls-tree` against
// the object database: no working-tree file is opened and nothing is written in
// it (ground rule 1 of docs/history/implementation-plan.md). With no checkout (a fresh clone of this
// repository on another machine), or with --github, the same commit is downloaded from
// GitHub (the repository is public), cut down to the same allow-list, and checked
// against the digest in the lock. Output:
//   upstream/            the allow-listed files at that commit (gitignored)
//   UPSTREAM.lock.json   commit, package version, allow-list, the SHA-256 of the
//                        archive, and a digest of the snapshot's files (treeSha256), so a
//                        later run, or another machine, can prove it got the same bytes
//
// The default commit is the one in UPSTREAM.lock.json, else PINNED below.
// Environment: AH_SOURCE (default ~/academic-harness).

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { engineDir, engineHash, STAMP_FILE } from '../server/src/engine.mjs'
import { treeDigest } from '../server/src/snapshot.mjs'

export const PINNED = 'a3f17eb8ae15221adeaa45cd19918c1f82f82973'
export const SOURCE_REPO = 'raktim-mondol/academic-harness'

// Paths taken from the source. Each phase adds what it needs; a path that does not
// exist at the commit is reported and skipped, never silently ignored.
export const ALLOW = [
  // identity and licence
  'package.json',
  'LICENSE',
  'NOTICE',
  'docs',
  // P1: prompt, skills, PaperMemory
  'prompt.js',
  'untrusted-fence.js',
  'skills-core.json',
  'skill-licenses.js',
  'skills',
  'vendor/papermemory',
  // P3: the writing engine (Python). Its virtual environment is built inside the snapshot by install-engine.mjs.
  'vendor/academic-harness',
  // P4: deep_review runs the vendored Open Deep Review engine (TypeScript, run by node), and supervisor-skills is its licence record.
  'vendor/open-deepreview',
  'vendor/supervisor-skills',
  // P2: the tool modules and what they read at run time. `*.js` means every .js file at the root.
  '*.js',
  'package-lock.json',
  'workflows.json',
  'appraisal',
  'assets',
  'checklists',
  'locale',
  'paper',
  'presets',
  'python-helpers',
  'schemas',
  'science-sources',
  'styles',
  // upstream's own tests, for the snapshot-integrity check. Some read docs, the client and the preset patch as static checks.
  'scripts',
  'client',
  '.github',
  'cordis.patch.yml',
  'README.md',
]

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function git(source, args, opts = {}) {
  return execFileSync('git', ['-C', source, ...args], { maxBuffer: 1 << 30, ...opts })
}

/**
 * The allow-listed files of `commit`, downloaded from GitHub into `staging` (no checkout needed). `fetchTarball(url, file)` is a seam for tests.
 * Returns what `sync` needs from a source: the paths present and missing, and no archive digest (the tarball is not `git archive`'s bytes).
 */
export async function obtainFromGithub({ commit, staging, allow = ALLOW, repo = SOURCE_REPO, fetchTarball = download }) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('a download needs the full 40-character commit, not a branch or a short sha')
  const scratch = mkdtempSync(join(homedir(), '.cache', 'ah-sync-'))
  try {
    const file = join(scratch, 'source.tar.gz')
    await fetchTarball(`https://codeload.github.com/${repo}/tar.gz/${commit}`, file)
    const tree = join(scratch, 'tree')
    mkdirSync(tree)
    execFileSync('tar', ['-xzf', file, '-C', tree, '--strip-components=1'], { maxBuffer: 1 << 30 })
    const rootFiles = readdirSync(tree)
    const present = []
    const missing = []
    for (const p of allow) {
      const found = p === '*.js' ? rootFiles.filter(f => f.endsWith('.js') && existsSync(join(tree, f))) : existsSync(join(tree, p)) ? [p] : []
      if (found.length) present.push(...found)
      else missing.push(p)
    }
    if (present.length === 0) throw new Error('none of the allow-listed paths exist in the download')
    for (const p of present) {
      mkdirSync(dirname(join(staging, p)), { recursive: true })
      cpSync(join(tree, p), join(staging, p), { recursive: true, dereference: false })
    }
    return { present, missing }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

async function download(url, file) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`download of ${url} failed: HTTP ${res.status}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
}

export async function sync({ source, commit, github = false, outDir = join(root, 'upstream'), lockFile = join(root, 'UPSTREAM.lock.json'), allow = ALLOW, fetchTarball } = {}) {
  const staging = outDir + '.staging'
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  let sha, present, missing, archiveSha256 = null
  if (github) {
    sha = commit
    ;({ present, missing } = await obtainFromGithub({ commit, staging, allow, fetchTarball }))
  } else {
    sha = git(source, ['rev-parse', '--verify', `${commit}^{commit}`], { encoding: 'utf8' }).trim()
    present = []
    missing = []
    const rootFiles = git(source, ['ls-tree', '--name-only', sha], { encoding: 'utf8' }).split('\n').filter(Boolean)
    for (const p of allow) {
      // `*.js` is expanded against the root listing; git pathspecs would match nested files too.
      const found = p === '*.js' ? rootFiles.filter(f => f.endsWith('.js')) : git(source, ['ls-tree', '--name-only', sha, '--', p], { encoding: 'utf8' }).split('\n').filter(Boolean)
      if (found.length) present.push(...(p === '*.js' ? found : [p]))
      else missing.push(p)
    }
    if (present.length === 0) throw new Error('none of the allow-listed paths exist at ' + sha)
    const tar = git(source, ['archive', '--format=tar', sha, '--', ...present])
    archiveSha256 = createHash('sha256').update(tar).digest('hex')
    execFileSync('tar', ['-x', '-C', staging], { input: tar, maxBuffer: 1 << 30 })
  }

  const pkg = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8'))
  // Installed dependencies are expensive. Keep them across a sync when the lockfile did not change.
  const keep = join(outDir, 'node_modules')
  const sameLock = existsSync(keep) && existsSync(join(outDir, 'package-lock.json')) && existsSync(join(staging, 'package-lock.json')) &&
    readFileSync(join(outDir, 'package-lock.json')).equals(readFileSync(join(staging, 'package-lock.json')))
  if (sameLock) renameSync(keep, join(staging, 'node_modules'))
  // The engine's virtual environment is expensive too. Keep it when the engine's files are byte-identical.
  const engineOld = engineDir(outDir)
  const engineNew = engineDir(staging)
  if (existsSync(join(engineOld, '.venv')) && existsSync(join(engineOld, STAMP_FILE)) && existsSync(join(engineNew, 'pyproject.toml')) &&
    readFileSync(join(engineOld, STAMP_FILE), 'utf8').trim() === engineHash(engineNew)) {
    renameSync(join(engineOld, '.venv'), join(engineNew, '.venv'))
    copyFileSync(join(engineOld, STAMP_FILE), join(engineNew, STAMP_FILE))
    for (const f of ['installed-version']) if (existsSync(join(engineOld, f))) copyFileSync(join(engineOld, f), join(engineNew, f))
  }
  // The helper environment (install-helpers.mjs, hundreds of MB): kept when its lock and project file are byte-identical.
  const helperOld = join(outDir, 'python-helpers')
  const helperNew = join(staging, 'python-helpers')
  const same = f => existsSync(join(helperOld, f)) && existsSync(join(helperNew, f)) && readFileSync(join(helperOld, f)).equals(readFileSync(join(helperNew, f)))
  if (existsSync(join(helperOld, '.venv')) && existsSync(helperNew) && same('uv.lock') && same('pyproject.toml')) renameSync(join(helperOld, '.venv'), join(helperNew, '.venv'))
  rmSync(outDir, { recursive: true, force: true })
  renameSync(staging, outDir)

  const digest = treeDigest(outDir)
  const before = existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, 'utf8')) : null
  const lock = {
    source: 'github.com/raktim-mondol/academic-harness',
    commit: sha,
    version: pkg.version,
    // `git archive`'s bytes; a download is not those bytes, so a download of the locked commit keeps the one recorded
    archiveSha256: archiveSha256 ?? (before?.commit === sha ? before.archiveSha256 ?? null : null),
    treeSha256: digest.sha256,
    fileCount: digest.fileCount,
    paths: present,
    missing,
  }
  // A download of the locked commit must hold the bytes the lock describes: otherwise the commit changed under us, or the download is wrong.
  if (github && before?.commit === sha && before.treeSha256 && before.treeSha256 !== digest.sha256) {
    throw new Error(`the download of ${sha.slice(0, 7)} does not match the lock (${digest.fileCount} files, digest ${digest.sha256.slice(0, 12)}, expected ${before.fileCount} files, ${before.treeSha256.slice(0, 12)}). The snapshot in ${outDir} is the new one; the lock is unchanged.`)
  }
  writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n')
  return lock
}

async function main() {
  const args = process.argv.slice(2)
  const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
  const lockFile = join(root, 'UPSTREAM.lock.json')
  const locked = existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, 'utf8')).commit : undefined
  const source = opt('--source') ?? process.env.AH_SOURCE ?? join(homedir(), 'academic-harness')
  const commit = opt('--commit') ?? locked ?? PINNED
  // Use the checkout when there is one that has the commit; otherwise (or with --github) download it.
  const haveCheckout = existsSync(join(source, '.git')) && (() => { try { git(source, ['cat-file', '-e', `${commit}^{commit}`], { stdio: 'ignore' }); return true } catch { return false } })()
  const github = args.includes('--github') || !haveCheckout
  if (github && !/^[0-9a-f]{40}$/.test(commit)) throw new Error(`no checkout has ${commit}, and a download needs the full commit sha`)
  if (github) console.log(`downloading ${SOURCE_REPO} at ${commit.slice(0, 7)} (${haveCheckout || args.includes('--github') ? 'asked for' : `no checkout at ${source}`})`)
  const lock = await sync({ source, commit, github })
  console.log(`synced ${lock.paths.length} paths at ${lock.commit.slice(0, 7)} (version ${lock.version}), ${lock.fileCount} files, digest ${lock.treeSha256.slice(0, 12)}${lock.archiveSha256 ? `, archive sha256 ${lock.archiveSha256.slice(0, 12)}` : ''}`)
  if (lock.missing.length) console.log(`not present at that commit: ${lock.missing.join(', ')}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exit(1) })
