#!/usr/bin/env node
// Snapshot integrity: run upstream's own test scripts for the tier-1 modules against core/.
//
//   node scripts/test-upstream.mjs            the tier-1 set
//   node scripts/test-upstream.mjs --all      every upstream test except the ones for DSH's own client and packaging (about 2 minutes; needs the engine venv)
//
// Upstream's runner gives each file its own scratch DSH_HOME under ~/.cache/ah-test-homes and kills a hung file.
// A failure here after a sync means the snapshot or its dependencies differ from what upstream tested.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const TIER1_TESTS = [
  'test-library', 'test-fold', 'test-reference-library', 'test-academic-search-parity', 'test-domain-sources',
  'test-search-execute', 'test-search-normalize', 'test-search-ratelimit', 'test-skills-on-demand', 'test-identity-tools',
  'test-integrity', 'test-fetch-guards', 'test-keys-not-in-urls', 'test-net-guard', 'test-citation-format',
  'test-tool-output-json', 'test-untrusted-fencing', 'test-nonsearch-tools', 'test-download-guard', 'test-source-deadline',
  'test-merge-sources', 'test-lookup-snapshot', 'test-jev-router', 'test-research-cycle-template', 'test-discovery',
]

/** Tests about DSH itself: the React client (needs dev dependencies) and the release tarball (needs the whole tree). None touches a tool. */
export const DSH_ONLY_TESTS = ['test-reply-fold', 'test-secret-settings', 'test-task-modes', 'test-task-modes-browser', 'test-package-files', 'test-noncommercial-exclusion']

export function allTests(dir = join(root, 'core', 'scripts')) {
  return readdirSync(dir).filter(n => /^test-.*\.mjs$/.test(n)).map(n => n.slice(0, -4)).filter(n => !DSH_ONLY_TESTS.includes(n)).sort()
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const all = process.argv.includes('--all')
  const args = [join(root, 'core', 'scripts', 'run-tests.mjs'), '--jobs', '4', '--timeout', '300', ...(all ? allTests() : ['--no-prepare', ...TIER1_TESTS])]
  const r = spawnSync(process.execPath, args, { cwd: join(root, 'core'), stdio: 'inherit' })
  process.exit(r.status ?? 1)
}
