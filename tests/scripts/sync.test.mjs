// The snapshot digest, and fetching the source without a checkout. The download is replaced by a tarball made from a throw-away repository, so
// these tests need no network; the real download is exercised by scripts/setup.mjs (see docs/history/p6-results.md).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { sync } from '../../scripts/sync-upstream.mjs'
import { checkSnapshot, snapshotFiles, treeDigest } from '../../server/src/snapshot.mjs'

const scratch = join(homedir(), '.cache', 'ah-test-homes')
mkdirSync(scratch, { recursive: true })
const root = mkdtempSync(join(scratch, 'sync-'))
const src = join(root, 'src-repo')
const git = (...args) => execFileSync('git', ['-C', src, ...args], { encoding: 'utf8' })
const ALLOW = ['package.json', '*.js', 'skills', 'vendor/academic-harness']
let sha

before(() => {
  mkdirSync(join(src, 'skills', 'a'), { recursive: true })
  mkdirSync(join(src, 'vendor', 'academic-harness'), { recursive: true })
  execFileSync('git', ['init', '-q', src])
  git('config', 'user.email', 't@example.invalid')
  git('config', 'user.name', 't')
  writeFileSync(join(src, 'package.json'), '{"name":"x","version":"2.0.0"}')
  writeFileSync(join(src, 'index.js'), 'export const a = 1\n')
  writeFileSync(join(src, 'tool.js'), 'export const b = 2\n')
  writeFileSync(join(src, 'README.md'), 'not allow-listed\n')
  writeFileSync(join(src, 'skills', 'a', 'SKILL.md'), '---\nname: a\n---\n')
  writeFileSync(join(src, 'vendor', 'academic-harness', 'pyproject.toml'), '[project]\nname = "x"\n')
  git('add', '-A')
  git('commit', '-qm', 'one')
  sha = git('rev-parse', 'HEAD').trim()
})
after(() => rmSync(root, { recursive: true, force: true }))

/** The download, as GitHub serves it: a tar.gz of the commit under one top-level folder. */
const tarballOf = commit => async (_url, file) => {
  const tar = execFileSync('git', ['-C', src, 'archive', '--format=tar', `--prefix=academic-harness-${commit}/`, commit], { maxBuffer: 1 << 28 })
  writeFileSync(file, execFileSync('gzip', ['-c'], { input: tar, maxBuffer: 1 << 28 }))
}

describe('the digest', () => {
  test('is the same for the same files, differs when one changes, and ignores what installers generate', () => {
    const dir = join(root, 'd1')
    mkdirSync(join(dir, 'sub'), { recursive: true })
    writeFileSync(join(dir, 'a.js'), '1')
    writeFileSync(join(dir, 'sub', 'b.md'), '2')
    const one = treeDigest(dir)
    assert.equal(one.fileCount, 2)
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'x', 'i.js'), 'dep')
    mkdirSync(join(dir, 'vendor', '.venv'), { recursive: true })
    writeFileSync(join(dir, 'vendor', '.venv', 'bin'), 'venv')
    writeFileSync(join(dir, 'sub', 'm.pyc'), 'bytes')
    writeFileSync(join(dir, '.ah-tree-sha256'), 'stamp')
    // what installing PaperMemory from vendor/papermemory leaves beside its sources (found by running a fresh clone)
    mkdirSync(join(dir, 'vendor', 'papermemory', 'build', 'lib'), { recursive: true })
    writeFileSync(join(dir, 'vendor', 'papermemory', 'build', 'lib', 'x.py'), 'x')
    mkdirSync(join(dir, 'vendor', 'papermemory', 'papermemory.egg-info'), { recursive: true })
    writeFileSync(join(dir, 'vendor', 'papermemory', 'papermemory.egg-info', 'PKG-INFO'), 'x')
    assert.deepEqual(treeDigest(dir), one)
    writeFileSync(join(dir, 'a.js'), '1 changed')
    assert.notEqual(treeDigest(dir).sha256, one.sha256)
    assert.deepEqual(snapshotFiles(dir), ['a.js', 'sub/b.md'])
    mkdirSync(join(dir, 'vendor', 'papermemory', 'src'), { recursive: true })
    writeFileSync(join(dir, 'vendor', 'papermemory', 'src', 'real.py'), 'kept')
    assert.ok(snapshotFiles(dir).includes('vendor/papermemory/src/real.py'), 'sources next to the build output are still counted')
  })
  test('a snapshot is checked against the lock: ok, differs, missing, unverified', () => {
    const dir = join(root, 'd2')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), '{"version":"1.2.3"}')
    const d = treeDigest(dir)
    const lock = { commit: 'a'.repeat(40), treeSha256: d.sha256, fileCount: d.fileCount }
    assert.equal(checkSnapshot(dir, lock).state, 'ok')
    assert.equal(checkSnapshot(dir, { ...lock, treeSha256: '0'.repeat(64) }).state, 'differs')
    assert.equal(checkSnapshot(join(root, 'nope'), lock).state, 'missing')
    assert.equal(checkSnapshot(dir, { commit: 'a'.repeat(40) }).state, 'unverified')
  })
})

describe('sync without a checkout', () => {
  test('a download holds exactly what git archive gives, so the lock\'s digest verifies it', async () => {
    const fromGit = { out: join(root, 'snap-git'), lock: join(root, 'git.lock.json') }
    const fromWeb = { out: join(root, 'snap-web'), lock: join(root, 'web.lock.json') }
    const a = await sync({ source: src, commit: sha, outDir: fromGit.out, lockFile: fromGit.lock, allow: ALLOW })
    // the web snapshot starts from the git lock, as a fresh clone does
    copyFileSync(fromGit.lock, fromWeb.lock)
    const b = await sync({ source: '/no/such/checkout', commit: sha, github: true, outDir: fromWeb.out, lockFile: fromWeb.lock, allow: ALLOW, fetchTarball: tarballOf(sha) })
    assert.equal(b.treeSha256, a.treeSha256)
    assert.equal(b.fileCount, a.fileCount)
    assert.deepEqual(snapshotFiles(fromWeb.out), snapshotFiles(fromGit.out))
    assert.equal(b.archiveSha256, a.archiveSha256, 'the lock keeps the recorded archive digest for the same commit')
    assert.equal(existsSync(join(fromWeb.out, 'README.md')), false, 'only the allow-list is taken')
    assert.deepEqual(b.paths.sort(), ['index.js', 'package.json', 'skills', 'tool.js', 'vendor/academic-harness'])
  })
  test('a download that is not the locked bytes is refused, and the lock is left alone', async () => {
    const out = join(root, 'snap-bad')
    const lockFile = join(root, 'bad.lock.json')
    const real = await sync({ source: src, commit: sha, outDir: join(root, 'snap-ref'), lockFile, allow: ALLOW })
    writeFileSync(lockFile, JSON.stringify({ ...real, treeSha256: '0'.repeat(64) }))
    await assert.rejects(sync({ source: '/none', commit: sha, github: true, outDir: out, lockFile, allow: ALLOW, fetchTarball: tarballOf(sha) }), /does not match the lock/)
    assert.equal(JSON.parse(readFileSync(lockFile, 'utf8')).treeSha256, '0'.repeat(64))
  })
  test('a download needs a full commit, and a failed one says so', async () => {
    await assert.rejects(sync({ source: '/none', commit: 'main', github: true, outDir: join(root, 'x'), lockFile: join(root, 'x.json'), allow: ALLOW }), /full 40-character commit/)
    await assert.rejects(sync({ source: '/none', commit: sha, github: true, outDir: join(root, 'y'), lockFile: join(root, 'y.json'), allow: ALLOW, fetchTarball: async () => { throw new Error('HTTP 404') } }), /HTTP 404/)
  })
  test('a newer commit downloads and re-records the lock', async () => {
    writeFileSync(join(src, 'tool.js'), 'export const b = 3\n')
    git('commit', '-qam', 'two')
    const next = git('rev-parse', 'HEAD').trim()
    const lockFile = join(root, 'new.lock.json')
    const first = await sync({ source: src, commit: sha, outDir: join(root, 'snap-n'), lockFile, allow: ALLOW })
    const second = await sync({ source: '/none', commit: next, github: true, outDir: join(root, 'snap-n'), lockFile, allow: ALLOW, fetchTarball: tarballOf(next) })
    assert.notEqual(second.treeSha256, first.treeSha256)
    assert.equal(second.commit, next)
    assert.equal(second.archiveSha256, null)
    assert.equal(readFileSync(join(root, 'snap-n', 'tool.js'), 'utf8'), 'export const b = 3\n')
  })
})
