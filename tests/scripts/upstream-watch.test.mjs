// The weekly upstream watch (scripts/upstream-watch.mjs): which issue is opened, updated or closed, what it says, and the calls it makes. No network:
// the GitHub CLI is a recording stand-in.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { act, compareUrl, decide, fenced, issueBody, LABEL, MAX_REPORT_CHARS, titleFor } from '../../scripts/upstream-watch.mjs'

const root = join(import.meta.dirname, '..', '..')
const lock = { source: 'github.com/o/academic-harness', commit: 'a'.repeat(40), version: '0.54.1' }
const next = 'b'.repeat(40)
const newer = 'c'.repeat(40)

describe('what to do about the issue', () => {
  test('up to date with nothing open says nothing; with an issue open it is closed', () => {
    assert.deepEqual(decide({ behind: false, candidate: lock.commit, open: [] }), { action: 'none' })
    assert.deepEqual(decide({ behind: false, candidate: lock.commit, open: [{ number: 4, title: 'x' }, { number: 9, title: 'y' }] }), { action: 'close', numbers: [4, 9] })
  })
  test('behind with nothing open opens one', () => {
    assert.deepEqual(decide({ behind: true, candidate: next, open: [] }), { action: 'create' })
  })
  test('an issue already naming this commit is left alone, so there is no mail every week', () => {
    const open = [{ number: 7, title: titleFor(lock.commit, next) }]
    assert.deepEqual(decide({ behind: true, candidate: next, open }), { action: 'none', number: 7, reason: 'this commit is already reported' })
  })
  test('an issue naming an older candidate is updated, and any others are closed', () => {
    const open = [{ number: 7, title: titleFor(lock.commit, next) }, { number: 3, title: titleFor(lock.commit, 'd'.repeat(40)) }]
    assert.deepEqual(decide({ behind: true, candidate: newer, open }), { action: 'update', number: 7, close: [3] })
  })
})

describe('the issue', () => {
  test('the title names both commits; the compare link is the two', () => {
    assert.equal(titleFor(lock.commit, next), 'Academic Harness moved: aaaaaaa → bbbbbbb')
    assert.equal(compareUrl(lock.source, lock.commit, next), `https://github.com/o/academic-harness/compare/${lock.commit}...${next}`)
  })
  test('the body holds the report in a fence it cannot break out of, the commands, and whether a decision is needed', () => {
    const report = 'tools added: 2\n```\nnot a fence\n```\nmodules nobody has classified: x.js'
    const body = issueBody({ lock, candidate: next, report, needsDecision: true })
    assert.match(body, /holds Academic Harness \*\*0\.54\.1\*\* \(`aaaaaaa`\)/)
    assert.match(body, /Its newest commit is `bbbbbbb`/)
    assert.match(body, /needs a decision before it can be taken/)
    assert.ok(body.includes(`node scripts/update-upstream.mjs --commit ${next} --apply`))
    assert.ok(body.includes(compareUrl(lock.source, lock.commit, next)))
    // the report's own fences are neutralised: the only fences are the three blocks of the body (report, commands) = 4 markers
    assert.equal((body.match(/```/g) ?? []).length, 4)
    assert.match(issueBody({ lock, candidate: next, report: '', needsDecision: false }), /Nothing in it needs a decision/)
  })
  test('a long report is cut so the issue stays under what GitHub accepts, and says so', () => {
    const body = issueBody({ lock, candidate: next, report: 'x'.repeat(MAX_REPORT_CHARS * 2), needsDecision: false })
    assert.ok(body.length < 65_000, String(body.length))
    assert.match(fenced('y'.repeat(100), 10), /^y{10}\n… \(90 more characters/)
  })
})

describe('the calls', () => {
  const recorder = (answers = {}) => {
    const calls = []
    const gh = args => { calls.push(args); return answers[args.slice(0, 2).join(' ')] ?? '' }
    return { calls, gh }
  }
  const quiet = fn => { const w = process.stderr.write; process.stderr.write = () => true; try { return fn() } finally { process.stderr.write = w } }
  const common = { title: titleFor(lock.commit, next), bodyFile: '/tmp/issue.md', candidate: next, lock }

  test('create: the label is made (or updated), then the issue is opened with it', () => {
    const r = recorder({ 'issue create': 'https://github.com/o/r/issues/12\n' })
    quiet(() => act({ action: 'create' }, { ...common, gh: r.gh }))
    assert.deepEqual(r.calls.map(c => c.slice(0, 2).join(' ')), ['label create', 'issue create'])
    assert.ok(r.calls[0].includes(LABEL) && r.calls[0].includes('--force'))
    assert.deepEqual(r.calls[1].slice(2), ['--title', common.title, '--body-file', '/tmp/issue.md', '--label', LABEL])
  })
  test('update: edits the open issue and closes the others as replaced', () => {
    const r = recorder()
    quiet(() => act({ action: 'update', number: 7, close: [3] }, { ...common, gh: r.gh }))
    assert.deepEqual(r.calls.map(c => c.slice(0, 3).join(' ')), ['label create upstream-update', 'issue edit 7', 'issue close 3'])
    assert.ok(r.calls[2].join(' ').includes('Replaced by #7'))
  })
  test('close: each open issue is closed with a comment that says why; nothing else is called', () => {
    const r = recorder()
    quiet(() => act({ action: 'close', numbers: [4, 9] }, { ...common, gh: r.gh }))
    assert.deepEqual(r.calls.map(c => c.slice(0, 3).join(' ')), ['issue close 4', 'issue close 9'])
    assert.ok(r.calls[0].join(' ').includes('holds the newest Academic Harness commit again'))
  })
  test('none calls nothing', () => {
    const r = recorder()
    quiet(() => act({ action: 'none' }, { ...common, gh: r.gh }))
    assert.deepEqual(r.calls, [])
  })
})

describe('the command and the workflow', () => {
  test('a commit that is not a full sha is refused before anything is called', () => {
    assert.throws(() => execFileSync(process.execPath, [join(root, 'scripts', 'upstream-watch.mjs'), '--commit', 'main', '--dry-run'], { stdio: 'pipe' }), /full 40-character sha/)
  })
  test('with the commit the plugin holds, a dry run says it is up to date and calls nothing', () => {
    const lockCommit = JSON.parse(readFileSync(join(root, 'UPSTREAM.lock.json'), 'utf8')).commit
    const r = execFileSync(process.execPath, [join(root, 'scripts', 'upstream-watch.mjs'), '--commit', lockCommit, '--dry-run'], { stdio: 'pipe', encoding: 'utf8' })
    assert.equal(r, '', 'standard output stays empty')
  })
  test('the workflow runs weekly, may be run by hand, can only write issues, and passes inputs by environment, not into the shell line', () => {
    const text = readFileSync(join(root, '.github', 'workflows', 'upstream-watch.yml'), 'utf8')
    assert.match(text, /cron: '\d+ \d+ \* \* 1'/)
    assert.match(text, /workflow_dispatch:/)
    assert.match(text, /permissions:\n {2}contents: read\n {2}issues: write/)
    assert.match(text, /node scripts\/upstream-watch\.mjs/)
    const runLines = text.split('\n').filter(l => /^\s+(run:|node |if |args)/.test(l))
    assert.ok(runLines.every(l => !l.includes('${{')), 'no expression is interpolated into a shell line')
    for (const m of text.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@v\d+$/)
  })
})
