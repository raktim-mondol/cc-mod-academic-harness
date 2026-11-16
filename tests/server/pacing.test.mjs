import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { S2_KEYED_INTERVAL_MS, s2Interval, seedPacing } from '../../server/src/pacing.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('no key, nothing is seeded', () => {
  assert.equal(s2Interval({}), null)
  assert.equal(s2Interval({ S2_API_KEY: '  ' }), null)
})

test('a key gives 0.5 requests a second, below the key\'s 1 a second', () => {
  assert.equal(s2Interval({ S2_API_KEY: 'k' }), S2_KEYED_INTERVAL_MS)
  assert.ok(S2_KEYED_INTERVAL_MS >= 1100)
})

test('the override is honoured but never reaches the limit', () => {
  assert.equal(s2Interval({ S2_API_KEY: 'k', AH_S2_MIN_INTERVAL_MS: '3000' }), 3000)
  assert.equal(s2Interval({ S2_API_KEY: 'k', AH_S2_MIN_INTERVAL_MS: '500' }), 1100)
  assert.equal(s2Interval({ S2_API_KEY: 'k', AH_S2_MIN_INTERVAL_MS: 'soon' }), S2_KEYED_INTERVAL_MS)
})

test('the seeded limiter is the first one made, so a tool asking for 1000 ms gets 2000 ms', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-pacing-'))
  try {
    writeFileSync(join(dir, 'search-http.js'), 'const m = new Map()\nexport function getLimiter(n, o = {}) { if (!m.has(n)) m.set(n, { minIntervalMs: o.minIntervalMs }); return m.get(n) }\n')
    assert.deepEqual(await seedPacing(dir, { S2_API_KEY: 'k' }), { s2: 2000 })
    const { getLimiter } = await import(pathToFileURL(join(dir, 'search-http.js')).href)
    assert.equal(getLimiter('s2', { minIntervalMs: 1000 }).minIntervalMs, 2000)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('without a key or without the module it seeds nothing and does not throw', async () => {
  assert.deepEqual(await seedPacing(join(tmpdir(), 'no-such-upstream'), { S2_API_KEY: 'k' }), {})
  assert.deepEqual(await seedPacing(root, {}), {})
})

test('against the real upstream: paper_resolve\'s 1000 ms request no longer sets the gap', { skip: !existsSync(join(root, 'upstream', 'search-http.js')) }, async () => {
  const up = join(root, 'upstream')
  await seedPacing(up, { S2_API_KEY: 'k' })
  const { getLimiter } = await import(pathToFileURL(join(up, 'search-http.js')).href)
  assert.equal(getLimiter('s2', { minIntervalMs: 1000 }).minIntervalMs, 2000)
})
