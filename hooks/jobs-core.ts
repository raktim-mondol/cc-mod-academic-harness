// Completion notices: the pure parts. No `$`, so tests can drive them directly.

export type JobRecord = { id: string; kind?: string; label?: string; status?: string; detail?: string | null; session?: string | null; startedAt?: number | null; endedAt?: number | null; progress?: string | null; delivered?: boolean }

export const FINISHED = ['completed', 'failed', 'killed', 'interrupted']
export const NOTICE_MODES = ['prompt', 'notify', 'off'] as const
export type NoticeMode = (typeof NOTICE_MODES)[number]

export function noticeMode(setting: unknown): NoticeMode {
  const v = String(setting ?? '').trim().toLowerCase()
  return (NOTICE_MODES as readonly string[]).includes(v) ? (v as NoticeMode) : 'prompt'
}

/** The folder the tool host keeps job records in: AH_MOD_HOME when set, else the default under the home directory. */
export function jobsDir(modHome: string | undefined, home: string | undefined): string | null {
  const base = modHome?.trim() || (home ? `${home.replace(/\/+$/, '')}/.local/share/cc-mod-academic-harness/home` : '')
  return base ? `${base.replace(/\/+$/, '')}/jobs` : null
}

/** Records of this session that have ended, were not announced and whose result the model has not already been given, oldest first. */
export function toAnnounce(records: readonly JobRecord[], session: string, noticed: readonly string[]): JobRecord[] {
  return records
    .filter(r => r && r.session === session && r.id && FINISHED.includes(String(r.status)) && !r.delivered && !noticed.includes(r.id))
    .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
}

const word: Record<string, string> = { completed: 'finished', failed: 'failed', killed: 'was stopped', interrupted: 'was interrupted' }

/** One line for the person (a notification). */
export function noticeLine(r: JobRecord): string {
  const what = r.label || r.kind || 'job'
  return `Background job ${r.id} ${word[String(r.status)] ?? r.status}: ${what}${r.status === 'completed' || !r.detail ? '' : ` (${String(r.detail).slice(0, 120)})`}`
}

/** One line for the model: what ended and what to do next. */
export function noticePrompt(rs: readonly JobRecord[]): string {
  const lines = rs.map(noticeLine)
  const ids = rs.map(r => r.id).join(', ')
  return `${lines.join('\n')}\nRead the result with job_status (job_id ${ids}) from the academic-harness server, then carry on with what the user asked for. Do not repeat work the job already did.`
}
