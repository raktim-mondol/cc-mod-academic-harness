// Request pacing the upstream tools cannot get right on their own.
//
// Semantic Scholar's key allows one request per second, counted across every endpoint. The upstream tools share one limiter named
// `s2`, but the first tool to touch it fixes its gap for all of them: paper_resolve, paper_recommend and bibtex_resolve ask for 1000 ms,
// literature_search for 2000 ms with a key. Whichever ran first would win, and a 1000 ms gap is exactly the limit, not below it.
// `getLimiter` keeps the first instance it makes, so the host creates the limiter here, before any upstream module loads.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Gap between Semantic Scholar requests when a key is set: 0.5 per second, half the key's limit (the gap literature_search already uses). */
export const S2_KEYED_INTERVAL_MS = 2000

/** The gap to seed, or null when nothing should be seeded (no key). `AH_S2_MIN_INTERVAL_MS` overrides; never below 1100 ms, so the key's limit is never reached. */
export function s2Interval(env = process.env) {
  if (!env.S2_API_KEY?.trim()) return null
  const asked = Number(env.AH_S2_MIN_INTERVAL_MS?.trim())
  return Number.isFinite(asked) && asked > 0 ? Math.max(1100, asked) : S2_KEYED_INTERVAL_MS
}

/** Create the shared limiters. Returns what it seeded, for the log. Call after prepareEnv (the key is in the environment) and before the first upstream import. */
export async function seedPacing(upstream, env = process.env) {
  const seeded = {}
  const file = join(upstream, 'search-http.js')
  const s2 = s2Interval(env)
  if (s2 === null || !existsSync(file)) return seeded
  const { getLimiter } = await import(pathToFileURL(file).href)
  getLimiter('s2', { minIntervalMs: s2 })
  seeded.s2 = s2
  return seeded
}
