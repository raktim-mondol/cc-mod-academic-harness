// The jobs service, the model route and the detached call path. Scratch under ~/.cache.
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { Registry, createContext } from '../../server/src/context.mjs'
import { hostOver } from '../../server/src/host.mjs'
import { createJobs } from '../../server/src/jobs.mjs'
import { createLlm, parseResult, promptFrom } from '../../server/src/llm.mjs'
import { upstreamDir } from '../../server/src/paths.mjs'

const root = join(homedir(), '.cache', 'ah-cc-p4', 'unit')
const UP = upstreamDir()
const HAVE_UP = existsSync(join(UP, 'job-runner.js'))
const sleep = ms => new Promise(r => setTimeout(r, ms))

before(() => { rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true }) })
after(() => rmSync(root, { recursive: true, force: true }))

describe('jobs service', () => {
  test('a job has a record and a log on disk, settles once, and wait returns its view', async () => {
    const jobs = createJobs({ dir: join(root, 'a'), session: 's1', cwd: '/p' })
    const job = jobs.create({ kind: 'k', label: 'L' })
    job.append('one\n')
    job.append('warn\n', { channel: 'stderr' })
    job.updateProgress('40% step')
    assert.equal(jobs.get(job.id).progress, '40% step')
    assert.equal(jobs.log(job.id), 'one\n[stderr] warn\n')
    const waiting = jobs.wait(job.id, 5000)
    jobs.settle(job.id, { status: 'completed', detail: 'done', result: 'R' })
    assert.equal((await waiting).status, 'completed')
    assert.equal(jobs.settle(job.id, { status: 'failed' }), null, 'a second settle changes nothing')
    const disk = JSON.parse(readFileSync(jobs.recordPath(job.id), 'utf8'))
    assert.deepEqual([disk.status, disk.result, disk.session, disk.cwd], ['completed', 'R', 's1', '/p'])
    assert.equal(disk.progress, null)
  })

  test('wait gives up after its time with the job still running, and rejects on an aborted signal', async () => {
    const jobs = createJobs({ dir: join(root, 'b') })
    const job = jobs.create({ kind: 'k' })
    assert.equal((await jobs.wait(job.id, 30)).status, 'running')
    const c = new AbortController()
    const p = jobs.wait(job.id, 5000, null, c.signal)
    c.abort(new Error('stop waiting'))
    await assert.rejects(p, /stop waiting/)
    jobs.settle(job.id, { status: 'completed' })
  })

  test('kill aborts the job signal and stopping becomes the settled status', async () => {
    const jobs = createJobs({ dir: join(root, 'c') })
    const job = jobs.create({ kind: 'k' })
    jobs.kill(job.id, null, 'because')
    assert.equal(job.signal.aborted, true)
    assert.equal(jobs.get(job.id).status, 'stopping')
    jobs.settle(job.id, { status: 'killed', detail: 'because' })
    assert.equal(jobs.get(job.id).status, 'killed')
  })

  test("upstream's start(): run returns { done, cancel }; a thrown run and a rejected done both fail the job", async () => {
    const jobs = createJobs({ dir: join(root, 'd') })
    const id = jobs.start({ kind: 'x', label: 'y', run: job => { job.append('hi'); return { done: Promise.resolve({ status: 'completed', detail: 'ok' }), cancel() {} } } })
    assert.equal((await jobs.wait(id, 1000)).status, 'completed')
    const bad = jobs.start({ kind: 'x', run: () => ({ done: Promise.reject(new Error('nope')), cancel() {} }) })
    assert.equal((await jobs.wait(bad, 1000)).detail, 'nope')
    assert.throws(() => jobs.start({ kind: 'x', run: () => { throw new Error('sync') } }), /sync/)
    let cancelled = null
    const k = jobs.start({ kind: 'x', run: () => ({ done: new Promise(() => {}), cancel: r => { cancelled = r } }) })
    jobs.kill(k, null, 'enough')
    assert.equal(cancelled, 'enough')
  })

  test('a running record whose server is gone reads as interrupted; another live pid is left running', () => {
    const dir = join(root, 'e')
    const mine = createJobs({ dir, session: 's1' })
    const base = { kind: 'k', label: 'l', status: 'running', startedAt: 1, session: 's1' }
    writeFileSync(join(dir, 'job-dead.json'), JSON.stringify({ ...base, id: 'job-dead', pid: 2_000_000_000 }))
    writeFileSync(join(dir, 'job-live.json'), JSON.stringify({ ...base, id: 'job-live', pid: process.ppid }))
    assert.equal(mine.get('job-dead').status, 'interrupted')
    assert.match(mine.get('job-dead').detail, /server that ran this job ended/)
    assert.equal(mine.get('job-live').status, 'running')
    assert.deepEqual(mine.list({ session: 's2' }), [])
    assert.equal(mine.list({ session: 's1' }).length, 2)
  })

  test('closeAll kills what this process still runs', async () => {
    const jobs = createJobs({ dir: join(root, 'f') })
    const job = jobs.create({ kind: 'k' })
    await jobs.closeAll('bye')
    assert.equal(jobs.get(job.id).status, 'killed')
    assert.equal(jobs.get(job.id).detail, 'bye')
  })
})

describe('upstream runAsJob over this service', { skip: !HAVE_UP }, () => {
  let runAsJob
  before(async () => ({ runAsJob } = await import(pathToFileURL(join(UP, 'job-runner.js')).href)))

  test('the call waits for the job and the value comes back with the job id', async () => {
    const jobs = createJobs({ dir: join(root, 'g') })
    const v = await runAsJob({ jobs }, { callId: 'c1' }, { kind: 'k', label: 'l', timeoutMs: 5000 }, async job => { job.append('x'); job.updateProgress('50%'); return { answer: 42, status: 'ok' } })
    assert.equal(v.answer, 42)
    assert.match(v.job_id, /^job-/)
    assert.equal(jobs.get(v.job_id).detail, 'ok')
  })

  test('a failing job rejects the call; a call that outlives its time is killed with a message', async () => {
    const jobs = createJobs({ dir: join(root, 'h') })
    await assert.rejects(runAsJob({ jobs }, { callId: 'c2' }, { kind: 'k', timeoutMs: 5000 }, async () => { throw new Error('boom') }), /boom/)
    await assert.rejects(runAsJob({ jobs }, { callId: 'c3' }, { kind: 'k', noun: 'thing', timeoutMs: 60 }, (job, signal) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))))), /thing timed out/)
  })
})

/** A stand-in for `claude`: prints a result object, after FAKE_SLEEP ms; logs argv and stdin. */
function fakeClaude(name) {
  const file = join(root, name)
  writeFileSync(file, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
let stdin = ''
for await (const c of process.stdin) stdin += c
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: process.argv.slice(2), stdin, maxTokens: process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ?? null }) + '\\n')
if (process.env.FAKE_SLEEP) await new Promise(r => setTimeout(r, Number(process.env.FAKE_SLEEP)))
if (process.env.FAKE_RAW) { process.stdout.write(process.env.FAKE_RAW); process.exit(Number(process.env.FAKE_EXIT ?? 0)) }
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: process.env.FAKE_TEXT ?? 'hello', stop_reason: process.env.FAKE_STOP ?? 'end_turn', total_cost_usd: Number(process.env.FAKE_COST ?? 0.01), usage: { input_tokens: 3, cache_creation_input_tokens: 100, cache_read_input_tokens: 7, output_tokens: 5 } }))
`)
  chmodSync(file, 0o755)
  return file
}
const collect = async it => { const out = []; for await (const c of it) out.push(c); return out }

describe('model route', () => {
  let bin
  before(() => { bin = fakeClaude('fake-claude.mjs') })
  const llm = (o = {}) => createLlm({ bin, cwd: root, ...o, env: { ...process.env, ...(o.env ?? {}) } })

  test('a single user message is sent as it is; a longer exchange keeps its roles', () => {
    assert.equal(promptFrom([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]), 'hi')
    assert.equal(promptFrom([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]), '[user]\na\n\n[assistant]\nb')
    assert.equal(promptFrom([]), '')
  })

  test('parseResult finds the result object even after other lines', () => {
    assert.equal(parseResult('noise\n{"type":"result","result":"x"}').result, 'x')
    assert.equal(parseResult('not json'), null)
  })

  test('chunks: text, usage with the cache tokens counted, finish stop; flags are the safe ones', async () => {
    const log = join(root, 'llm1.log')
    const m = llm({ env: { FAKE_LOG: log, FAKE_TEXT: 'the answer' }, model: 'haiku' })
    const chunks = await collect(m.stream({ system: 'SYS', messages: [{ role: 'user', content: [{ type: 'text', text: 'question?' }] }], maxTokens: 321 }))
    assert.deepEqual(chunks.map(c => c.type), ['text-delta', 'usage', 'finish'])
    assert.equal(chunks[0].text, 'the answer')
    assert.deepEqual([chunks[1].usage.inputTokens, chunks[1].usage.outputTokens, chunks[1].usage.totalTokens], [110, 5, 115])
    assert.deepEqual(chunks[2].reason, { kind: 'stop' })
    const seen = JSON.parse(readFileSync(log, 'utf8').trim())
    for (const flag of ['-p', '--safe-mode', '--no-session-persistence']) assert.ok(seen.argv.includes(flag), flag)
    assert.equal(seen.argv[seen.argv.indexOf('--tools') + 1], '')
    assert.equal(seen.argv[seen.argv.indexOf('--model') + 1], 'haiku')
    assert.equal(seen.argv[seen.argv.indexOf('--system-prompt') + 1], 'SYS')
    assert.equal(seen.stdin, 'question?')
    assert.equal(seen.maxTokens, '321')
    assert.equal(m.stats().calls, 1)
  })

  test('max_tokens finishes as max-tokens; spend is counted and the cap stops the next call with a message', async () => {
    const m = llm({ env: { FAKE_STOP: 'max_tokens', FAKE_COST: '0.6' }, budgetUsd: 1 })
    const first = await collect(m.stream({ messages: [{ role: 'user', content: 'x' }] }))
    assert.equal(first.at(-1).reason.kind, 'max-tokens')
    await collect(m.stream({ messages: [{ role: 'user', content: 'x' }] }))
    const third = await collect(m.stream({ messages: [{ role: 'user', content: 'x' }] }))
    assert.equal(third.length, 1)
    assert.equal(third[0].reason.kind, 'error')
    assert.match(third[0].reason.failure.message, /budget for this server is used up/)
    assert.equal(m.stats().calls, 2)
  })

  test('a child that fails, prints nothing useful, or is missing finishes with an error that says why', async () => {
    const empty = await collect(llm({ env: { FAKE_RAW: 'garbage', FAKE_EXIT: '3' } }).stream({ messages: [{ role: 'user', content: 'x' }] }))
    assert.equal(empty.at(-1).reason.kind, 'error')
    assert.match(empty.at(-1).reason.failure.message, /exited 3 with no result/)
    const isErr = await collect(llm({ env: { FAKE_RAW: JSON.stringify({ type: 'result', is_error: true, result: 'rate limited', total_cost_usd: 0, usage: {} }) } }).stream({ messages: [{ role: 'user', content: 'x' }] }))
    assert.match(isErr.at(-1).reason.failure.message, /rate limited/)
    const missing = await collect(createLlm({ bin: join(root, 'no-such-claude') }).stream({ messages: [{ role: 'user', content: 'x' }] }))
    assert.match(missing.at(-1).reason.failure.message, /was not found on PATH/)
  })

  test('an aborted signal finishes as aborted and does not wait for the child', async () => {
    const m = llm({ env: { FAKE_SLEEP: '5000' } })
    const c = new AbortController()
    const t = Date.now()
    const p = collect(m.stream({ messages: [{ role: 'user', content: 'x' }], signal: c.signal }))
    setTimeout(() => c.abort('stop'), 100)
    const chunks = await p
    assert.equal(chunks.at(-1).reason.kind, 'aborted')
    assert.ok(Date.now() - t < 3000)
  })

  test('no more children run at once than the concurrency limit', async () => {
    const m = llm({ env: { FAKE_SLEEP: '250' }, concurrency: 2 })
    const t = Date.now()
    await Promise.all([1, 2, 3, 4].map(() => collect(m.stream({ messages: [{ role: 'user', content: 'x' }] }))))
    assert.ok(Date.now() - t >= 450, 'four calls of 250 ms through two slots take at least two rounds')
  })
})

describe('detached calls', { skip: !HAVE_UP }, () => {
  let bindParentJob
  let runAsJob
  before(async () => ({ bindParentJob, runAsJob } = await import(pathToFileURL(join(UP, 'job-runner.js')).href)))

  function hostWith(work, { foreground = 100, dir = 'x' } = {}) {
    const registry = new Registry()
    const jobs = createJobs({ dir: join(root, 'host', dir), session: 'sess' })
    const ctx = createContext(registry, { services: { jobs } })
    // a tool shaped like deep_research: runs its work through runAsJob, which adopts the host's job
    ctx.tools.register({ name: 'deep_research', description: 'd', parameters: { query: { type: 'string' } }, async execute(args, exec) { return runAsJob(ctx, exec, { kind: 'deep_research', label: 'x', timeoutMs: 10_000, noun: 'deep research' }, work) } })
    return hostOver(registry, { env: { AH_JOB_FOREGROUND_MS: String(foreground), CLAUDE_CODE_SESSION_ID: 'sess' }, cwd: root, jobs, bindParentJob })
  }
  const text = r => r.content.map(c => c.text).join('\n')

  test('work that ends inside the foreground window answers the call as usual', async () => {
    const host = hostWith(async job => { job.append('step 1\n'); return { status: 'done', report: 'REPORT' } }, { foreground: 2000, dir: 'quick' })
    const r = await host.call('deep_research', { query: 'q' }, { callId: 'toolu_1' })
    assert.equal(r.isError, undefined)
    assert.match(text(r), /REPORT/)
    const [rec] = host.jobs.list()
    assert.equal(rec.status, 'completed')
    assert.equal(rec.delivered, true, 'a result given inline needs no notice')
    assert.match(rec.result, /REPORT/)
  })

  test('work that outlives it answers with the job id, goes on, and job_wait returns the result', async () => {
    const host = hostWith(async job => { job.updateProgress('10% start'); job.append('began\n'); await sleep(400); return { status: 'done', report: 'LATE REPORT' } }, { foreground: 50, dir: 'slow' })
    const first = await host.call('deep_research', { query: 'a long question' }, { callId: 'toolu_2' })
    assert.match(text(first), /running as job (job-\S+)/)
    const id = /job-[^\s)]+/.exec(text(first))[0]
    assert.equal(host.jobs.get(id).delivered, undefined, 'a detached job still owes a notice')
    const status = await host.call('job_status', { job_id: id })
    assert.match(text(status), /running/)
    assert.match(text(status), /10% start/)
    const waited = await host.call('job_wait', { job_id: id, seconds: 5 })
    assert.match(text(waited), /completed/)
    assert.equal(host.jobs.get(id).delivered, true, 'a result read with job_wait needs no notice')
    assert.match(text(waited), /LATE REPORT/)
    assert.match(text(await host.call('job_log', { job_id: id })), /began/)
    assert.match(text(await host.call('job_status', {})), new RegExp(id))
  })

  test('job_kill stops it: the tool sees an aborted signal and the job ends killed', async () => {
    let sawAbort = false
    const host = hostWith((job, signal) => new Promise((_, reject) => { signal.addEventListener('abort', () => { sawAbort = true; reject(new Error('stopped')) }) }), { foreground: 30, dir: 'kill' })
    const first = await host.call('deep_research', { query: 'q' }, { callId: 'toolu_3' })
    const id = /job-[^\s)]+/.exec(text(first))[0]
    const killed = await host.call('job_kill', { job_id: id, reason: 'no longer needed' })
    assert.match(text(killed), /killed/)
    assert.equal(sawAbort, true)
    assert.equal(host.jobs.get(id).status, 'killed')
  })

  test('cancelling the call inside the foreground window kills the job', async () => {
    const host = hostWith((job, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')))), { foreground: 5000, dir: 'cancel' })
    const c = new AbortController()
    const p = host.call('deep_research', { query: 'q' }, { callId: 'toolu_4', signal: c.signal })
    setTimeout(() => c.abort(), 80)
    const r = await p
    assert.equal(r.isError, true)
    assert.equal(host.jobs.list()[0].status, 'killed')
  })

  test('a failing tool is an error result and a failed job', async () => {
    const host = hostWith(async () => { throw new Error('the model route is down') }, { foreground: 2000, dir: 'fail' })
    const r = await host.call('deep_research', { query: 'q' }, { callId: 'toolu_5' })
    assert.equal(r.isError, true)
    assert.match(text(r), /model route is down/)
    assert.equal(host.jobs.list()[0].status, 'failed')
  })

  test('job tools reject a missing or unknown id with a clear error', async () => {
    const host = hostWith(async () => ({}), { dir: 'ids' })
    assert.match(text(await host.call('job_wait', {})), /job_id is required/)
    assert.match(text(await host.call('job_status', { job_id: 'job-nope' })), /no job job-nope/)
  })
})
