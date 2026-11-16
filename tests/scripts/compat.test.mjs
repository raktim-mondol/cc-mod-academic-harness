// Which Claude Code versions the mod was seen on (server/src/compat.mjs), and that the hooks module and the server agree on the record
// the hooks module leaves for the doctor (hooks/seen.ts).
import '../helpers/ts-resolve.mjs'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { assessVersion, parseVersion, readSeen, seenDir, seenName, TESTED_VERSIONS } from '../../server/src/compat.mjs'

const seen = await import('../../hooks/seen.ts')
const scratch = join(homedir(), '.cache', 'ah-test-homes')
mkdirSync(scratch, { recursive: true })
const root = mkdtempSync(join(scratch, 'compat-'))
after(() => rmSync(root, { recursive: true, force: true }))

describe('versions', () => {
  test('a version is read from what `claude --version` prints, and from a development build', () => {
    assert.deepEqual(parseVersion('2.1.325 (Claude Code)'), { core: [2, 1, 325], text: '2.1.325' })
    assert.deepEqual(parseVersion('2.1.280-dev.20260920.t101500.sha1a2b3c4').core, [2, 1, 280])
    assert.equal(parseVersion('nonsense'), null)
    assert.equal(parseVersion(undefined), null)
  })
  test('the version the mod was seen on is ok', () => {
    assert.ok(TESTED_VERSIONS.length > 0)
    for (const v of TESTED_VERSIONS) assert.equal(assessVersion(`${v} (Claude Code)`).state, 'ok')
  })
  test('older than the oldest tried warns, newer or in between is only said, and an unreadable one is not a failure', () => {
    const tested = ['2.1.300', '2.1.325']
    assert.equal(assessVersion('2.1.299', tested).state, 'warn')
    assert.match(assessVersion('2.0.9', tested).detail, /older than the oldest .*2\.1\.300, 2\.1\.325.*Update Claude Code/)
    assert.equal(assessVersion('2.1.310', tested).state, 'info', 'between two tried versions')
    assert.equal(assessVersion('2.2.0', tested).state, 'info')
    assert.match(assessVersion('2.2.0', tested).detail, /has not been tried with the mod/)
    assert.equal(assessVersion('who knows', tested).state, 'info')
    assert.equal(assessVersion('2.1.325', []).state, 'info', 'with nothing recorded as tried, nothing is claimed')
  })
})

describe('the record the hooks module leaves', () => {
  test('the hooks module and the server name the file the same way', () => {
    for (const id of ['0a1b2c3d-4e5f-6789-abcd-ef0123456789', '../../etc/passwd', 'a b/c:d', 'ünï']) assert.equal(seen.seenName(id), seenName(id), id)
    assert.equal(seen.seenFile('/m', '/h', 's1'), `${seenDir('/m')}/${seenName('s1')}`)
  })
  test('the server reads what the hooks module wrote, and nothing for another session, a missing file or a damaged one', () => {
    const home = join(root, 'home')
    mkdirSync(seenDir(home), { recursive: true })
    writeFileSync(seen.seenFile(home, undefined, 'sess-1'), `${JSON.stringify({ session: 'sess-1', version: '2.1.325', at: 1 })}\n`)
    assert.equal(readSeen(home, 'sess-1').version, '2.1.325')
    assert.equal(readSeen(home, 'sess-2'), null)
    assert.equal(readSeen(home, undefined), null)
    writeFileSync(seen.seenFile(home, undefined, 'bad'), '{not json')
    assert.equal(readSeen(home, 'bad'), null)
    writeFileSync(seen.seenFile(home, undefined, 'odd'), '{"session":"odd"}')
    assert.equal(readSeen(home, 'odd'), null, 'a record with no version says nothing')
  })
})

describe('the CI workflow', () => {
  test('its Claude Code versions are the tested ones, then latest', async () => {
    const { matrix } = await import('../../scripts/ci-matrix.mjs')
    assert.deepEqual(matrix(), [...TESTED_VERSIONS, 'latest'])
  })
  test('the script prints one line for $GITHUB_OUTPUT', async () => {
    const { execFileSync } = await import('node:child_process')
    const out = execFileSync(process.execPath, [join(import.meta.dirname, '..', '..', 'scripts', 'ci-matrix.mjs')], { encoding: 'utf8' }).trim()
    assert.match(out, /^claude=\[.*\]$/)
    assert.deepEqual(JSON.parse(out.slice('claude='.length)), [...TESTED_VERSIONS, 'latest'])
  })
  test('the workflow file names the jobs the docs describe, and installs nothing from a floating action', async () => {
    const { readFileSync } = await import('node:fs')
    const text = readFileSync(join(import.meta.dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8')
    for (const job of ['node:', 'versions:', 'claude-code:']) assert.ok(text.includes(`\n  ${job}`), job)
    for (const m of text.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@v\d+$/, `${m[1]} is pinned to a major version`)
    assert.match(text, /node scripts\/setup\.mjs --github/)
    assert.match(text, /claude plugin validate \. --strict/)
  })
})
