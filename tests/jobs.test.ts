import { expect, mock, test } from 'claude-code/testing'

import { jobsDir, noticeLine, noticeMode, noticePrompt, toAnnounce } from '../hooks/jobs-core'

// Completion notices (P4): the pure parts, then the timer through the hooks module.

const rec = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, status, session: 'sess-1', kind: 'deep_research', label: 'deep_research: RAG', endedAt: 100, ...extra })

test('only this session\'s ended, unannounced jobs are announced, oldest first', () => {
  const rs = [rec('a', 'running'), rec('b', 'completed', { endedAt: 300 }), rec('c', 'failed', { endedAt: 200 }), rec('d', 'completed', { session: 'other' }), rec('e', 'completed')]
  expect(toAnnounce(rs, 'sess-1', ['e']).map(r => r.id)).toEqual(['c', 'b'])
  expect(toAnnounce([rec('f', 'completed', { delivered: true })], 'sess-1', [])).toEqual([])
})

test('the notice says what ended and how; a failure carries its reason', () => {
  expect(noticeLine(rec('job-1', 'completed'))).toBe('Background job job-1 finished: deep_research: RAG')
  expect(noticeLine(rec('job-2', 'failed', { detail: 'the model route is down' }))).toContain('failed: deep_research: RAG (the model route is down)')
  expect(noticeLine(rec('job-3', 'interrupted'))).toContain('was interrupted')
  expect(noticePrompt([rec('job-1', 'completed')])).toContain('job_status (job_id job-1)')
})

test('settings and folders', () => {
  expect(noticeMode(undefined)).toBe('prompt')
  expect(noticeMode('NOTIFY')).toBe('notify')
  expect(noticeMode('nonsense')).toBe('prompt')
  expect(jobsDir('/m', '/home/u')).toBe('/m/jobs')
  expect(jobsDir(undefined, '/home/u/')).toBe('/home/u/.local/share/cc-mod-academic-harness/home/jobs')
  expect(jobsDir('', undefined)).toBeNull()
})

function world(on: any, opts: { records?: Record<string, unknown> } = {}) {
  const prompts: string[] = []
  const notes: string[] = []
  const files = opts.records ?? {}
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'AH_MOD_HOME' ? '/mod' : e.name === 'HOME' ? '/home/u' : undefined }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/p' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', (_: unknown, e: { path: string }) => ({ value: e.path === '/mod/jobs' ? Object.keys(files).map(n => ({ name: n, kind: 'file', size: 1, mtimeMs: 1, isLink: false })) : [] }))
  on('fs.read', (_: unknown, e: { path: string }) => ({ value: JSON.stringify(files[e.path.split('/').pop()!]) }))
  const clock = mock.clock(on)
  on('ui.notify', (_: unknown, e: { text: string }) => { notes.push(e.text); return { value: { isSent: true, channel: 'terminal' } } })
  on('prompt.submit', (_: unknown, e: { text: string }) => { prompts.push(e.text); return { text: e.text } })
  on('ui.status', () => ({ value: undefined }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  return { clock, prompts, notes, files }
}

test('an ended job raises a notice and queues a prompt once; a running one waits', async ($, on) => {
  const w = world(on, { records: { 'job-1.json': rec('job-1', 'running') } })
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await w.clock.advance(4000)
  expect(w.notes).toEqual([])
  w.files['job-1.json'] = rec('job-1', 'completed')
  await w.clock.advance(4000)
  expect(w.notes).toEqual(['Background job job-1 finished: deep_research: RAG'])
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('job_status (job_id job-1)')
  await w.clock.advance(8000)
  expect(w.prompts.length).toBe(1)
})

test('notify mode raises the notice and queues nothing; off starts no timer', { options: { job_notices: 'notify' } }, async ($, on) => {
  const w = world(on, { records: { 'job-2.json': rec('job-2', 'completed') } })
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await w.clock.advance(4000)
  expect(w.notes.length).toBe(1)
  expect(w.prompts.length).toBe(0)
})

test('off starts no timer', { options: { job_notices: 'off' } }, async ($, on) => {
  const w = world(on, { records: { 'job-8.json': rec('job-8', 'completed') } })
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await w.clock.advance(20_000)
  expect(w.notes.length + w.prompts.length).toBe(0)
})

test('a non-interactive run starts no timer', async ($, on) => {
  const w = world(on)
  w.files['job-9.json'] = rec('job-9', 'completed')
  await $.session.start({ cwd: '/p', surface: null, isInteractive: false })
  await w.clock.advance(20_000)
  expect(w.notes.length + w.prompts.length).toBe(0)
})
