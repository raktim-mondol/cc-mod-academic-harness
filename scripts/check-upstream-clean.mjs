#!/usr/bin/env node
// Ground rules 1 and 2 of docs/history/implementation-plan.md, as a check.
//
//   node scripts/check-upstream-clean.mjs --record   before a test run
//   node scripts/check-upstream-clean.mjs            after it (default mode: compare)
//
// Records, and then compares, three things about what must not change:
//   1. the source repository's HEAD
//   2. its `git status --porcelain --ignored` (ignored files count: the source's
//      gitignored venvs are inside the live-linked checkout, see ground rule 1)
//   3. the name, size and mtime of the top level of the real DSH home
//
// It only reads. It never writes in the source or in the DSH home. The baseline
// is written into this repository (.upstream-baseline.json, gitignored).
//
// Environment: AH_SOURCE (default ~/academic-harness), AH_DSH_HOME_REAL
// (default ~/.dsh).

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baselineFile = join(root, '.upstream-baseline.json')
const source = process.env.AH_SOURCE ?? join(homedir(), 'academic-harness')
const dshHome = process.env.AH_DSH_HOME_REAL ?? join(homedir(), '.dsh')

function git(...args) {
  return execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' })
}

function dshListing() {
  if (!existsSync(dshHome)) return null
  return readdirSync(dshHome)
    .sort()
    .map(name => {
      const st = statSync(join(dshHome, name), { throwIfNoEntry: false })
      return st ? `${name}\t${st.isDirectory() ? 'd' : 'f'}\t${st.size}\t${Math.floor(st.mtimeMs)}` : `${name}\tgone`
    })
}

function snapshot() {
  return {
    sourceHead: git('rev-parse', 'HEAD').trim(),
    sourceStatus: git('status', '--porcelain', '--ignored').split('\n').filter(Boolean).sort(),
    dshListing: dshListing(),
  }
}

function diffLists(label, before, after) {
  const problems = []
  const b = new Set(before ?? [])
  const a = new Set(after ?? [])
  for (const x of a) if (!b.has(x)) problems.push(`${label}: + ${x}`)
  for (const x of b) if (!a.has(x)) problems.push(`${label}: - ${x}`)
  return problems
}

const mode = process.argv.includes('--record') ? 'record' : 'compare'
const now = snapshot()

if (mode === 'record') {
  writeFileSync(baselineFile, JSON.stringify({ recordedAt: new Date().toISOString(), source, dshHome, ...now }, null, 2) + '\n')
  console.log(`recorded: source HEAD ${now.sourceHead.slice(0, 7)}, ${now.sourceStatus.length} status lines, ` +
    `${now.dshListing ? now.dshListing.length : 0} entries in ${dshHome}`)
  process.exit(0)
}

if (!existsSync(baselineFile)) {
  console.error('no baseline: run with --record before the test run')
  process.exit(2)
}
const base = JSON.parse(readFileSync(baselineFile, 'utf8'))
const problems = []
if (base.sourceHead !== now.sourceHead) problems.push(`source HEAD moved: ${base.sourceHead} -> ${now.sourceHead}`)
problems.push(...diffLists('source status', base.sourceStatus, now.sourceStatus))
problems.push(...diffLists('DSH home', base.dshListing, now.dshListing))

if (problems.length) {
  console.error('NOT CLEAN:')
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}
console.log(`clean: source HEAD ${now.sourceHead.slice(0, 7)}, status unchanged, ${dshHome} unchanged`)
