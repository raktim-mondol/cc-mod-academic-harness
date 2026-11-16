import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions } from 'claude-code'

import { jobsDir, noticeLine, noticeMode, noticePrompt, toAnnounce } from './jobs-core'
import type { JobRecord } from './jobs-core'

// Completion notices (P4). A long tool (deep_research, deep_review, analysis_run) goes on as a job of the tool host and
// leaves a record under the mod's home. In an interactive session a timer reads this session's records; when one has ended
// it raises a notification and, with the job_notices setting `prompt` (the default), queues a one-line prompt so the model
// reads the result and carries on. `notify` only notifies; `off` does neither.
// In a non-interactive run (claude -p) nothing is queued: the session ends with the turn, so the model polls with job_wait.
//
// Helpers here take `$` as a parameter and call it in full: the engine reads this source statically and refuses an aliased `$`.

const noticed = atom({ plugin: 'academic-harness', key: 'noticed' } as const, [] as string[])
const PERIOD_MS = 4000
let timer: { cancel: () => void } | null = null

export async function records($: EngineInterface, dir: string): Promise<JobRecord[]> {
  let names: { name: string; kind: string }[] = []
  try {
    names = await $.fs.list(dir)
  } catch {
    return [] // no jobs folder yet
  }
  const out: JobRecord[] = []
  for (const n of names) {
    if (n.kind !== 'file' || !n.name.endsWith('.json')) continue
    try {
      const text = await $.fs.read(`${dir}/${n.name}`)
      const parsed = JSON.parse(typeof text === 'string' ? text : String((text as { text?: string }).text ?? ''))
      if (parsed && typeof parsed === 'object') out.push(parsed as JobRecord)
    } catch {
      // a record being rewritten: the next period reads it
    }
  }
  return out
}

export async function startNotices($: EngineInterface, options: PluginOptions, isInteractive: boolean): Promise<void> {
  const mode = noticeMode(options['job_notices'])
  if (mode === 'off' || !isInteractive) return
  let dir: string | null
  let session: string
  try {
    dir = jobsDir(await $.env.get('AH_MOD_HOME'), await $.env.get('HOME'))
    session = await $.session.id()
  } catch {
    return // notices are a convenience: a session that cannot say where it is gets none, and starts as usual
  }
  if (!dir) return
  timer?.cancel?.()
  let busy = false
  timer = $.clock.every(PERIOD_MS, async () => {
    if (busy) return
    busy = true
    try {
      const seen = await read($, noticed)
      const fresh = toAnnounce(await records($, dir), session, seen)
      if (fresh.length === 0) return
      await update($, noticed, list => [...list, ...fresh.map(r => r.id)])
      for (const r of fresh) await $.ui.notify(noticeLine(r), { title: 'academic-harness' })
      if (mode === 'prompt') await $.prompt.submit({ text: noticePrompt(fresh) })
    } catch {
      // a notice that cannot be shown is retried next period only if it was not recorded; never break the session
    } finally {
      busy = false
    }
  })
}

export function stopNotices(): void {
  timer?.cancel?.()
  timer = null
}
