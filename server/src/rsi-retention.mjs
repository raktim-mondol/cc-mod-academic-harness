// Keeps the self-improvement loop's store bounded.
//
// The store is append-only files (core/rsi-store.js): an episode a turn, an event a tool call, and an upsert of a lesson every time its
// statistics change. Left alone they only grow, so once a day (at the end of a turn) this:
//
//   - rotates events, episodes and decisions that have passed their size limit: the file becomes `<name>.1` (replacing the generation before
//     it) and the next append starts a new one. A writer that appends while this runs opens the path afresh, so no line is lost; at most
//     two generations of a file exist, and the loop reads the current one;
//   - compacts the lessons file when it passes its limit, to one upsert per lesson as they stand now, under the store's own lock (every
//     writer of lessons takes it), through a temporary file and a rename, so a reader never sees half a file.
//
// The limits are generous (a year of daily use stays well inside them) and a test passes small ones.
import { renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_LIMITS = {
  events: 2 * 1024 * 1024,
  episodes: 1024 * 1024,
  decisions: 512 * 1024,
  lessons: 256 * 1024,
  everyMs: 24 * 60 * 60 * 1000,
}

/**
 * `store` is rsi-store.js, `lock` its `withStoreLock(dir, fn)`. Returns { skipped: true } when it ran in the last `everyMs`, else what it did.
 */
export async function housekeeping({ dir, store, lock, limits = {}, now = Date.now() }) {
  const lim = { ...DEFAULT_LIMITS, ...limits }
  const meta = store.readMeta(dir)
  if (now - Number(meta.housekeeping_at || 0) < lim.everyMs) return { skipped: true }
  const done = { rotated: [], compacted: false }

  for (const [name, max] of [['events.jsonl', lim.events], ['episodes.jsonl', lim.episodes], ['decisions.jsonl', lim.decisions]]) {
    const file = join(dir, name)
    try {
      if (statSync(file).size > max) { renameSync(file, `${file}.1`); done.rotated.push(name) }
    } catch { /* no such file yet */ }
  }

  const lessons = join(dir, 'lessons.jsonl')
  let big = false
  try { big = statSync(lessons).size > lim.lessons } catch { /* none yet */ }
  if (big) {
    await lock(dir, async () => {
      const rows = store.currentLessons(dir)
      const ts = new Date(now).toISOString()
      const text = rows.map(lesson => JSON.stringify({ v: store.RSI_VERSION ?? 1, ts, op: 'upsert', lesson, reason: 'compact' })).join('\n')
      const tmp = `${lessons}.${process.pid}.tmp`
      writeFileSync(tmp, rows.length ? `${text}\n` : '')
      renameSync(tmp, lessons)
    })
    done.compacted = true
  }

  store.updateMeta(dir, { housekeeping_at: now })
  return done
}
