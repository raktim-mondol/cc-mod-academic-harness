#!/usr/bin/env node
// Bring the mod up to a newer Academic Harness commit, and say what that changes for it.
//
//   node scripts/update-upstream.mjs                    report against the newest commit (the checkout's HEAD, else GitHub's)
//   node scripts/update-upstream.mjs --commit <sha>     report against that commit (a full sha when there is no checkout)
//   node scripts/update-upstream.mjs --apply            also take it: sync, install, build, check parity, run the tests
//
// The report comes first, in a scratch folder: the candidate snapshot is taken beside the real one (the real one is not touched), its
// tools are loaded with the current dependencies, and the two are compared: tools added, removed or changed, prompt sections, core
// skills, settings fields, and which of them nobody has decided about yet (a new tool, a module not classified). `--apply` stops when
// a decision is needed, unless `--force`. The source checkout is only read.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { diffDescriptions, describeSnapshot, formatDiff, needsDecision } from './update-lib.mjs'
import { checkSnapshot } from '../server/src/snapshot.mjs'
import { git, sync } from './sync-upstream.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const lockFile = join(root, 'UPSTREAM.lock.json')
const lock = JSON.parse(readFileSync(lockFile, 'utf8'))
const source = opt('--source') ?? process.env.AH_SOURCE ?? join(homedir(), 'academic-harness')
const haveCheckout = existsSync(join(source, '.git'))

function resolveTarget() {
  const want = opt('--commit')
  if (haveCheckout) {
    try { return { sha: git(source, ['rev-parse', '--verify', `${want ?? 'HEAD'}^{commit}`], { encoding: 'utf8' }).trim(), github: false } } catch { /* not in the checkout: ask GitHub */ }
  }
  if (want && /^[0-9a-f]{40}$/.test(want)) return { sha: want, github: true }
  const out = spawnSync('git', ['ls-remote', `https://${lock.source}.git`, 'HEAD'], { encoding: 'utf8' })
  const head = out.stdout?.split(/\s+/)[0]
  if (!want && /^[0-9a-f]{40}$/.test(head ?? '')) return { sha: head, github: true }
  throw new Error(want ? `${want} is not in the checkout, and a download needs the full 40-character sha` : 'no checkout, and GitHub did not answer')
}

const held = checkSnapshot(join(root, 'upstream'), lock)
if (held.state !== 'ok') console.log(`note: upstream/ is not what the lock says (${held.state}: ${held.detail ?? 'no detail'}). The report compares the snapshot as it is; \`node scripts/setup.mjs\` restores the locked one.`)
const target = resolveTarget()
console.log(`current: ${lock.commit.slice(0, 7)} (${lock.version})   candidate: ${target.sha.slice(0, 7)} (${target.github ? 'GitHub' : 'checkout'})`)
if (target.sha === lock.commit && !args.includes('--force')) {
  console.log('The mod already holds that commit. Nothing to do.')
  process.exit(0)
}

const scratch = join(homedir(), '.cache', 'ah-update', target.sha.slice(0, 12))
rmSync(scratch, { recursive: true, force: true })
mkdirSync(scratch, { recursive: true })
const candidate = join(scratch, 'upstream')
await sync({ source, commit: target.sha, github: target.github, outDir: candidate, lockFile: join(scratch, 'lock.json') })
// The candidate's modules are loaded with the dependencies the mod has now. A change in package-lock.json is reported, and applied by `--apply`.
symlinkSync(join(root, 'upstream', 'node_modules'), join(candidate, 'node_modules'), 'dir')

const [from, to] = [await describeSnapshot(join(root, 'upstream')), await describeSnapshot(candidate)]
const reviewedFile = join(root, 'scripts', 'prompt-reviewed.json')
const diff = diffDescriptions(from, to, { reviewed: existsSync(reviewedFile) ? JSON.parse(readFileSync(reviewedFile, 'utf8')) : {} })
console.log(`\n${formatDiff(diff)}`)
rmSync(scratch, { recursive: true, force: true })

if (!args.includes('--apply')) {
  console.log('\nThis was a report. `node scripts/update-upstream.mjs --apply` takes the candidate.')
  process.exit(needsDecision(diff) ? 2 : 0)
}
if (needsDecision(diff) && !args.includes('--force')) {
  console.error('\nNot applied: decide the points above first (or --force to apply and look at the parity check).')
  process.exit(2)
}

const run = (label, script, extra = []) => {
  console.log(`\n== ${label}`)
  const r = spawnSync(process.execPath, [join(root, 'scripts', script), ...extra], { cwd: root, stdio: 'inherit' })
  if (r.status !== 0) { console.error(`\nstopped at "${label}"`); process.exit(1) }
}
console.log('\n== sync')
const taken = await sync({ source, commit: target.sha, github: target.github })
console.log(`now ${taken.commit.slice(0, 7)} (${taken.version}), ${taken.fileCount} files`)
run('dependencies', 'install-deps.mjs')
run('engine', 'install-engine.mjs')
run('build skills, agents, prompt, interface data', 'build-all.mjs')
run('plugin.json', 'build-manifest.mjs')
run('surface parity', 'measure-surface.mjs')
const tests = spawnSync(process.execPath, ['--test', 'tests/scripts/*.test.mjs', 'tests/server/*.test.mjs'], { cwd: root, stdio: 'inherit', shell: false })
console.log(tests.status === 0 ? '\nThe tests pass.' : '\nSome tests fail: they say what the new commit changed that the mod has to follow.')
console.log('\nReview `git diff`, run `claude plugin test .` and tests/live/*, then commit. build-prompt.mjs --accept-upstream records a reviewed research-mode.md.')
process.exit(tests.status === 0 ? 0 : 1)
