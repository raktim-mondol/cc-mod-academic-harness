// The jobs service: what upstream's `ctx.jobs` is on DSH, kept on disk so a hook, a status tool and a later
// session can all read it.
//
// Two ways in:
//   start({ kind, label, owner, toolCall, run })   upstream's shape (job-runner.js `runAsJob`): `run(job)` returns
//                                                  { done, cancel }; `wait` and `kill` follow.
//   create(...) + settle(...)                      the host's own, for a tool call it runs detached
//
// A job is a record `<dir>/<id>.json` and a log `<dir>/<id>.log`. The record says which session and folder
// started it, so a hook can find the ones that are its own. A job belongs to the server process that runs it: when
// the process ends, its running jobs are marked `interrupted` the next time the folder is read.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const RUNNING = new Set(['running', 'stopping'])
export const FINISHED = new Set(['completed', 'failed', 'killed', 'interrupted'])
const LOG_LIMIT = 4 * 1024 * 1024
const RESULT_LIMIT = 200_000
export const DEFAULT_KEEP_DAYS = 30

const clipText = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n)}\n[clipped]` : String(s ?? ''))

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export function createJobs({ dir, session = null, cwd = null, pid = process.pid, now = () => Date.now(), onChange = null } = {}) {
  mkdirSync(dir, { recursive: true })
  const live = new Map() // id -> { record, done, cancel, waiters }
  let counter = 0

  const recordPath = id => join(dir, `${id}.json`)
  const logPath = id => join(dir, `${id}.log`)

  function save(record) {
    const tmp = `${recordPath(record.id)}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(record, null, 2))
    renameSync(tmp, recordPath(record.id))
    try { onChange?.(record) } catch { /* a listener must not break a job */ }
  }

  function view(record) {
    return { id: record.id, kind: record.kind, label: record.label, status: record.status, detail: record.detail ?? null, progress: record.progress ?? null, startedAt: record.startedAt, endedAt: record.endedAt ?? null, session: record.session ?? null, cwd: record.cwd ?? null }
  }

  /** Read one record from disk. A running job whose server is gone reads as `interrupted`. */
  function read(id) {
    const p = recordPath(id)
    if (!existsSync(p)) return null
    let record
    try { record = JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
    if (RUNNING.has(record.status) && !live.has(id) && !alive(record.pid)) {
      record = { ...record, status: 'interrupted', detail: 'the server that ran this job ended before it finished', endedAt: record.endedAt ?? now() }
      save(record)
    }
    return record
  }

  function create({ kind, label, owner, toolCall, tool, args } = {}) {
    const id = `job-${now().toString(36)}-${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const record = { id, kind: kind ?? 'job', label: label ?? kind ?? 'job', status: 'running', startedAt: now(), pid, session, cwd, owner: owner ?? null, toolCall: toolCall ?? null, tool: tool ?? null, args: args ?? null, progress: null, detail: null, result: null }
    save(record)
    const controller = new AbortController()
    const entry = { record, controller, waiters: new Set(), cancel: null }
    live.set(id, entry)
    const job = {
      id,
      signal: controller.signal,
      append(text, options) {
        try {
          const p = logPath(id)
          if (existsSync(p) && statSync(p).size > LOG_LIMIT) return
          const tag = options?.channel && options.channel !== 'log' ? `[${options.channel}] ` : ''
          appendFileSync(p, `${tag}${String(text)}`)
        } catch { /* a log that cannot be written must not stop the work */ }
      },
      updateProgress(label) {
        entry.record = { ...entry.record, progress: String(label).slice(0, 300) }
        save(entry.record)
      },
    }
    entry.job = job
    return job
  }

  function settle(id, outcome) {
    const entry = live.get(id)
    if (!entry || FINISHED.has(entry.record.status)) return null
    const status = FINISHED.has(outcome?.status) ? outcome.status : 'completed'
    entry.record = { ...entry.record, status, detail: outcome?.detail == null ? null : String(outcome.detail).slice(0, 2000), endedAt: now(), result: outcome?.result == null ? null : clipText(outcome.result, RESULT_LIMIT), progress: status === 'completed' ? null : entry.record.progress }
    save(entry.record)
    for (const w of entry.waiters) w()
    entry.waiters.clear()
    return entry.record
  }

  function kill(id, owner, reason) {
    const entry = live.get(id)
    if (!entry) {
      const r = read(id)
      if (!r) throw new Error(`no job ${id}`)
      return view(r)
    }
    if (FINISHED.has(entry.record.status)) return view(entry.record)
    entry.record = { ...entry.record, status: 'stopping', detail: reason ? String(reason).slice(0, 300) : 'kill requested' }
    save(entry.record)
    try { entry.cancel?.(reason || 'killed') } catch { /* the work is already gone */ }
    entry.controller.abort(reason || 'killed')
    return view(entry.record)
  }

  /** Resolve with the job's view once it ends, or after `timeoutMs`, whichever comes first. */
  async function wait(id, timeoutMs, owner, signal) {
    const entry = live.get(id)
    if (!entry) {
      const r = read(id)
      if (!r) throw new Error(`no job ${id}`)
      return view(r)
    }
    if (!FINISHED.has(entry.record.status)) {
      await new Promise((resolve, reject) => {
        const timer = Number.isFinite(timeoutMs) ? setTimeout(done, Math.max(0, timeoutMs)) : null
        function done() {
          if (timer) clearTimeout(timer)
          signal?.removeEventListener?.('abort', onAbort)
          entry.waiters.delete(done)
          resolve()
        }
        function onAbort() {
          if (timer) clearTimeout(timer)
          entry.waiters.delete(done)
          reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? 'aborted')))
        }
        if (signal?.aborted) return onAbort()
        signal?.addEventListener?.('abort', onAbort, { once: true })
        entry.waiters.add(done)
      })
    }
    return view(entry.record)
  }

  /** Upstream's `jobs.start`: `run(job)` returns `{ done: Promise<outcome>, cancel }`. */
  function start({ kind, label, owner, toolCall, run }) {
    const job = create({ kind, label, owner, toolCall })
    const entry = live.get(job.id)
    let handle
    try {
      handle = run(job)
    } catch (error) {
      settle(job.id, { status: 'failed', detail: error instanceof Error ? error.message : String(error) })
      throw error
    }
    entry.cancel = handle?.cancel ?? null
    Promise.resolve(handle?.done).then(outcome => settle(job.id, outcome), error => settle(job.id, { status: 'failed', detail: error instanceof Error ? error.message : String(error) }))
    return job.id
  }

  /** The model has been given this job's result (inline, or by job_status / job_wait): no notice is needed. */
  function deliver(id) {
    const entry = live.get(id)
    const record = entry ? entry.record : read(id)
    if (!record || record.delivered) return
    const next = { ...record, delivered: true }
    if (entry) entry.record = next
    save(next)
  }

  function get(id) {
    return live.get(id) ? { ...live.get(id).record } : read(id)
  }

  /** Records, newest first. `session` limits to one session's jobs. */
  function list({ session: only, status } = {}) {
    let names = []
    try { names = readdirSync(dir).filter(n => n.endsWith('.json')) } catch { return [] }
    const out = []
    for (const n of names) {
      const r = read(n.slice(0, -5))
      if (!r) continue
      if (only && r.session !== only) continue
      if (status && r.status !== status) continue
      out.push(r)
    }
    return out.sort((a, b) => b.startedAt - a.startedAt)
  }

  function log(id, { tail = 8000 } = {}) {
    const p = logPath(id)
    if (!existsSync(p)) return ''
    const text = readFileSync(p, 'utf8')
    return text.length > tail ? `[earlier output not shown]\n${text.slice(-tail)}` : text
  }

  /**
   * Remove the records and logs of jobs that ended more than `keepDays` ago. The folder is read whole by every status tool and, every few
   * seconds, by the notices and the status line, so it must not grow for ever. A running job is never removed, whoever runs it. Returns the count.
   */
  function prune({ keepDays = DEFAULT_KEEP_DAYS } = {}) {
    if (!(keepDays > 0)) return 0
    const cutoff = now() - keepDays * 24 * 60 * 60 * 1000
    let names = []
    try { names = readdirSync(dir).filter(n => n.endsWith('.json')) } catch { return 0 }
    let removed = 0
    for (const n of names) {
      const id = n.slice(0, -5)
      if (live.has(id)) continue
      const r = read(id)
      if (!r || !FINISHED.has(r.status) || !((r.endedAt ?? r.startedAt) < cutoff)) continue
      try { rmSync(recordPath(id), { force: true }); rmSync(logPath(id), { force: true }); removed++ } catch { /* another server is removing it too */ }
    }
    return removed
  }

  /** Kill every job this process still runs: the server is ending. */
  async function closeAll(reason = 'the server is shutting down') {
    for (const [id, entry] of live) if (!FINISHED.has(entry.record.status)) kill(id, null, reason)
    await Promise.all([...live.values()].map(e => (FINISHED.has(e.record.status) ? null : new Promise(resolve => { e.waiters.add(resolve); setTimeout(resolve, 3000) }))))
    for (const [id, entry] of live) if (!FINISHED.has(entry.record.status)) settle(id, { status: 'killed', detail: reason })
  }

  return { dir, start, wait, kill, create, settle, deliver, get, list, log, view, prune, closeAll, logPath, recordPath, running: () => [...live.values()].filter(e => RUNNING.has(e.record.status)).length }
}
