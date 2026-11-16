// The doctor (server/src/doctor.mjs): what it says about a good setup, a bare one and a clone with no snapshot, that it never prints a key,
// and the host tool that wraps it.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { seenDir, seenName, TESTED_VERSIONS } from '../../server/src/compat.mjs'
import { diagnose, format } from '../../server/src/doctor.mjs'
import { doctorTool } from '../../server/src/doctortool.mjs'
import { treeDigest } from '../../server/src/snapshot.mjs'

const scratch = join(homedir(), '.cache', 'ah-test-homes')
mkdirSync(scratch, { recursive: true })
const root = mkdtempSync(join(scratch, 'doctor-'))
const by = (report, id) => report.checks.find(c => c.id === id)
after(() => rmSync(root, { recursive: true, force: true }))

const clone = join(root, 'clone')
const snap = join(clone, 'upstream')
before(() => {
  mkdirSync(snap, { recursive: true })
  writeFileSync(join(snap, 'package.json'), '{"name":"x","version":"0.54.1"}')
  const d = treeDigest(snap)
  writeFileSync(join(clone, 'UPSTREAM.lock.json'), JSON.stringify({ source: 'github.com/o/r', commit: 'a'.repeat(40), version: '0.54.1', treeSha256: d.sha256, fileCount: d.fileCount }))
})

const base = { PATH: process.env.PATH, HOME: process.env.HOME }

describe('the report', () => {
  test('a clone with no snapshot says what to run, and is blocking', async () => {
    const r = await diagnose({ env: base, root: clone, upstream: join(clone, 'nowhere'), home: join(root, 'home1') })
    assert.equal(by(r, 'snapshot').state, 'missing')
    assert.match(by(r, 'snapshot').fix, /node scripts\/setup\.mjs/)
    assert.equal(by(r, 'deps').state, 'missing')
    assert.ok(r.blocking >= 2)
    assert.match(format(r), /the mod cannot work without/)
  })
  test('a snapshot that matches the lock is ok; an edited one is a warning, not a crash', async () => {
    const good = await diagnose({ env: base, root: clone, upstream: snap, home: join(root, 'home2') })
    assert.equal(by(good, 'snapshot').state, 'ok')
    assert.match(by(good, 'snapshot').detail, /0\.54\.1.*aaaaaaa/)
    writeFileSync(join(snap, 'extra.js'), 'x')
    const edited = await diagnose({ env: base, root: clone, upstream: snap, home: join(root, 'home2') })
    assert.equal(by(edited, 'snapshot').state, 'warn')
    rmSync(join(snap, 'extra.js'))
  })
  test('keys are named and never printed', async () => {
    const secret = 'SECRET-VALUE-9f8e7d'
    const r = await diagnose({ env: { ...base, AH_KEY_S2_API_KEY: secret, AH_KEY_PARALLEL_API_KEY: 'another-secret-1' }, root: clone, upstream: snap, home: join(root, 'home3') })
    const text = format(r)
    assert.match(by(r, 'keys').detail, /2 set \(PARALLEL_API_KEY, S2_API_KEY\)/)
    assert.ok(!text.includes(secret) && !text.includes('another-secret-1'))
    assert.match(by(r, 'keys').detail, /UNPAYWALL_EMAIL/, 'what is still worth setting')
    assert.doesNotMatch(by(r, 'keys').detail, /S2_API_KEY \(Semantic/, 'a key that is set is not asked for')
  })
  test('what is left out and what is restored are reported', async () => {
    const r = await diagnose({ env: { ...base, AH_RESTORE_TOOLS: 'brave_search', AH_RESTORE_TOOLS_SETTING: '' }, root: clone, upstream: snap, home: join(root, 'home4') })
    assert.match(by(r, 'surface').detail, /15 Academic Harness tools are left out.*restored: brave_search/)
  })
  test('jobs are counted when the folder exists', async () => {
    const home = join(root, 'home5')
    mkdirSync(join(home, 'jobs'), { recursive: true })
    writeFileSync(join(home, 'jobs', 'job-1.json'), '{}')
    writeFileSync(join(home, 'jobs', 'job-1.log'), '')
    const r = await diagnose({ env: base, root: clone, upstream: snap, home })
    assert.match(by(r, 'jobs').detail, /^1 record in /)
  })
  test('the text ends with a verdict', async () => {
    const r = await diagnose({ env: base, root: clone, upstream: snap, home: join(root, 'home6') })
    assert.match(format({ ...r, blocking: 0 }).split('\n').at(-1), /^(Ready\.|Ready, with \d+ feature)/)
  })
})

describe('the hooks module and the Claude Code version', () => {
  const home = join(root, 'home-mod')
  const inSession = id => ({ ...base, CLAUDE_CODE_SESSION_ID: id })
  const record = (id, version) => {
    mkdirSync(seenDir(home), { recursive: true })
    writeFileSync(join(seenDir(home), seenName(id)), `${JSON.stringify({ session: id, version, at: 1 })}\n`)
  }
  test('outside a session it is not checked (and says what Claude Code on PATH is, when there is one)', async () => {
    const r = await diagnose({ env: base, root: clone, upstream: snap, home })
    assert.equal(by(r, 'mod').state, 'info')
    assert.match(by(r, 'mod').detail, /not from inside a session; \/academic doctor checks it\./)
  })
  test('a session whose hooks module reported, on a version it was seen on, is ok', async () => {
    record('s-ok', TESTED_VERSIONS[0])
    const r = await diagnose({ env: inSession('s-ok'), root: clone, upstream: snap, home })
    assert.equal(by(r, 'mod').state, 'ok')
    assert.match(by(r, 'mod').detail, new RegExp(`loaded in this session, Claude Code ${TESTED_VERSIONS[0].replace(/\./g, '\\.')}`))
  })
  test('a newer version is said, not warned about; an older one warns with the fix', async () => {
    record('s-new', '9.9.9')
    const newer = await diagnose({ env: inSession('s-new'), root: clone, upstream: snap, home })
    assert.equal(by(newer, 'mod').state, 'info')
    assert.match(by(newer, 'mod').detail, /9\.9\.9 has not been tried/)
    record('s-old', '1.0.0')
    const older = await diagnose({ env: inSession('s-old'), root: clone, upstream: snap, home })
    assert.equal(by(older, 'mod').state, 'warn')
    assert.equal(by(older, 'mod').fix, 'update Claude Code')
  })
  test('a session whose hooks module never reported warns, and does not make the report blocking', async () => {
    const r = await diagnose({ env: inSession('s-silent'), root: clone, upstream: snap, home })
    assert.equal(by(r, 'mod').state, 'warn')
    assert.match(by(r, 'mod').detail, /has not reported in this session/)
    assert.match(by(r, 'mod').fix, /claude --debug/)
    assert.ok(!r.checks.filter(c => c.state === 'missing').some(c => c.id === 'mod'))
  })
})

describe('the host tool', () => {
  test('adds what the server loaded and what failed to load', async () => {
    const tool = doctorTool({ env: base, loaded: [{ file: 'a.js', area: 'search', tools: 3 }, { file: 'b.js', area: 'search', tools: 2 }, { file: 'c.js', area: 'papers', tools: 1 }], failed: [{ file: 'd.js', error: 'Cannot find module x' }] })
    assert.equal(tool.name, 'doctor')
    const text = await tool.execute({})
    assert.match(text, /This server loaded 3 tool modules \(search 5, papers 1\)/)
    assert.match(text, /1 did not load:\n {2}d\.js: Cannot find module x/)
    assert.ok(tool.parameters.online)
  })
})
