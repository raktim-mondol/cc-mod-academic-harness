// The host's own tools for the jobs it runs: job_status, job_wait, job_log, job_kill.
//
// A long tool (deep_research, deep_review, analysis_run) answers its call after a short foreground window and goes on as a
// job. These four are how the model, and the person through the model, reads or stops it. They are not upstream tools.
import { clip } from './render.mjs'
import { FINISHED, RUNNING } from './jobs.mjs'

export const MAX_WAIT_S = 120
export const DEFAULT_WAIT_S = 60

const ago = ms => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`
}

export function describe(record, now = Date.now()) {
  const end = record.endedAt ?? now
  const lines = [`${record.id}  ${record.status}  ${record.kind}  (${ago(end - record.startedAt)}${RUNNING.has(record.status) ? ' so far' : ''})`, `  ${record.label}`]
  if (record.progress && RUNNING.has(record.status)) lines.push(`  progress: ${record.progress}`)
  if (record.detail && record.status !== 'completed') lines.push(`  ${record.detail}`)
  return lines.join('\n')
}

export function jobTools({ jobs, sessionId = null, cwd = process.cwd(), maxChars = 40_000 }) {
  const need = id => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('job_id is required (job_status with no job_id lists this session\'s jobs)')
    const record = jobs.get(id.trim())
    if (!record) throw new Error(`no job ${id}`)
    return record
  }
  const withResult = (record, now) => {
    const head = describe(record, now)
    if (!FINISHED.has(record.status)) return head
    jobs.deliver(record.id)
    if (!record.result) return head
    const { content } = clip([{ type: 'text', text: record.result }], { maxChars, cwd, tool: `job-${record.id}`, callId: record.id })
    return `${head}\n\nResult:\n${content.map(c => c.text).join('\n')}`
  }
  return [
    {
      name: 'job_status',
      description: 'Status of a background job started by a long tool (deep_research, deep_review, analysis_run). With a job_id: its state and, once it has ended, its result. With none: this session\'s jobs, newest first.',
      parameters: { job_id: { type: 'string', description: 'The job id the long tool returned (job-...). Omit to list.' } },
      async execute({ job_id: id } = {}) {
        if (id) return withResult(need(id))
        const list = jobs.list({ session: sessionId ?? undefined })
        return list.length ? list.slice(0, 20).map(r => describe(r)).join('\n') : 'No jobs in this session.'
      },
    },
    {
      name: 'job_wait',
      description: `Wait for a background job, at most ${MAX_WAIT_S} seconds (default ${DEFAULT_WAIT_S}). Returns as soon as it ends, with its result; otherwise its progress, and you may call again. In an interactive session you are also told when a job ends.`,
      parameters: {
        job_id: { type: 'string', required: true, description: 'The job id.' },
        seconds: { type: 'number', description: `How long to wait, 1 to ${MAX_WAIT_S}.` },
      },
      async execute({ job_id: id, seconds } = {}, exec) {
        const record = need(id)
        const s = Math.min(MAX_WAIT_S, Math.max(1, Number.isFinite(Number(seconds)) ? Number(seconds) : DEFAULT_WAIT_S))
        if (!FINISHED.has(record.status)) await jobs.wait(record.id, s * 1000, null, exec?.signal)
        return withResult(jobs.get(record.id))
      },
    },
    {
      name: 'job_log',
      description: 'The tail of a background job\'s log: its steps, model calls and warnings as it ran.',
      parameters: {
        job_id: { type: 'string', required: true, description: 'The job id.' },
        tail_chars: { type: 'number', description: 'How much of the end to return (default 6000).' },
      },
      async execute({ job_id: id, tail_chars: tail } = {}) {
        const record = need(id)
        const text = jobs.log(record.id, { tail: Math.min(60_000, Math.max(200, Number(tail) || 6000)) })
        return `${describe(record)}\n\n${text || '(no log yet)'}`
      },
    },
    {
      name: 'job_kill',
      description: 'Stop a running background job. Work already paid for (model calls) is not refunded; partial results the tool saved stay on disk.',
      parameters: {
        job_id: { type: 'string', required: true, description: 'The job id.' },
        reason: { type: 'string', description: 'Why, for the log.' },
      },
      async execute({ job_id: id, reason } = {}) {
        const record = need(id)
        if (FINISHED.has(record.status)) return `${describe(record)}\n\nAlready ended.`
        if (!jobs.get(record.id) || record.pid !== process.pid) return `${describe(record)}\n\nThis job belongs to another server process and cannot be stopped from here.`
        jobs.kill(record.id, null, reason || 'killed by request')
        await jobs.wait(record.id, 5000)
        return describe(jobs.get(record.id))
      },
    },
  ]
}
