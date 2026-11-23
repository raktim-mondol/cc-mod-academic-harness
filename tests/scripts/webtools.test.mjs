// web_search and web_extract: the provider chosen from what is served, the fallback when one fails, the cross-check, the extractor chain.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { CLAIM_GROUPS, mergeResults, normalizeResults, providerArgs, SEARCH_ORDER, webTools } from '../../server/src/webtools.mjs'

const row = (url, title = url, extra = {}) => ({ url, title, abstract: `about ${title}`, ...extra })
/** A registry holding fake provider tools: each answers with `reply` (a value, or a function of the call) and records its calls. */
function registryOf(replies) {
  const calls = []
  const tools = new Map(Object.entries(replies).map(([name, reply]) => [name, { name, async execute(args) { calls.push({ name, args }); const r = typeof reply === 'function' ? reply(args) : reply; if (r instanceof Error) throw r; return r } }]))
  return { registry: { tools }, calls }
}
const find = (tools, name) => tools.find(t => t.name === name)
const ok = (...rows) => ({ query: 'q', results: rows })

describe('which tools exist', () => {
  test('nothing is added when no provider is served and there is no Firecrawl key', () => {
    const { registry } = registryOf({ jina_read: { content: 'x' } })
    assert.deepEqual(webTools({ registry, env: {} }), [])
  })
  test('one search provider gives web_search only; a Firecrawl key or parallel_extract gives web_extract', () => {
    const a = webTools({ registry: registryOf({ exa_search: ok() }).registry, env: {} })
    assert.deepEqual(a.map(t => t.name), ['web_search'])
    const b = webTools({ registry: registryOf({ jina_read: {} }).registry, env: { AH_KEY_FIRECRAWL_API_KEY: 'k' } })
    assert.deepEqual(b.map(t => t.name), ['web_extract'])
    const c = webTools({ registry: registryOf({ parallel_extract: {} }).registry, env: {} })
    assert.deepEqual(c.map(t => t.name), ['web_extract'])
  })
})

describe('web_search', () => {
  test('uses the first served provider for the intent, and says which', async () => {
    const { registry, calls } = registryOf({ brave_search: ok(row('https://b.example/a')), tavily_search: ok(row('https://t.example/a')) })
    const search = find(webTools({ registry, env: {} }), 'web_search')
    const out = await search.execute({ query: 'solid state battery', intent: 'news' })
    assert.deepEqual(calls.map(c => c.name), ['tavily_search'], 'news prefers Tavily')
    assert.match(out, /via tavily_search/)
    assert.match(out, /https:\/\/t\.example\/a/)
  })
  test('falls to the next provider when one has no key, errors or finds nothing', async () => {
    const { registry, calls } = registryOf({ perplexity_search: { error: 'PERPLEXITY_API_KEY is not set', code: 'key_missing' }, tavily_search: ok(), brave_search: ok(row('https://b.example/x', 'X')) })
    const search = find(webTools({ registry, env: {} }), 'web_search')
    const out = await search.execute({ query: 'q' })
    assert.deepEqual(calls.map(c => c.name), ['perplexity_search', 'tavily_search', 'brave_search'])
    assert.match(out, /perplexity_search \(key_missing\) -> tavily_search \(no results\) -> brave_search/)
  })
  test('a provider that throws is skipped; the attempts are capped at three', async () => {
    const { registry, calls } = registryOf({ perplexity_search: new Error('boom'), tavily_search: { error: 'x' }, brave_search: ok(), exa_search: ok(row('https://e.example/')), parallel_search: ok(row('https://p.example/')) })
    const search = find(webTools({ registry, env: {} }), 'web_search')
    const out = await search.execute({ query: 'q' })
    assert.equal(calls.length, 3)
    assert.match(out, /No provider answered\. Use WebSearch\./)
  })
  test('with no provider answering, it says to use WebSearch instead of failing', async () => {
    const { registry } = registryOf({ exa_search: { error: 'Exa API error 401', status: 401 } })
    const out = await find(webTools({ registry, env: {} }), 'web_search').execute({ query: 'q' })
    assert.match(out, /Use WebSearch/)
  })
  test('a named provider goes first if it is served, and is ignored if it is not', async () => {
    const { registry, calls } = registryOf({ brave_search: ok(row('https://b.example/')), exa_search: ok(row('https://e.example/')) })
    const search = find(webTools({ registry, env: {} }), 'web_search')
    await search.execute({ query: 'q', provider: 'exa_search' })
    await search.execute({ query: 'q', provider: 'tavily_search' })
    assert.deepEqual(calls.map(c => c.name), ['exa_search', 'brave_search'])
  })
  test('a claim is checked by one provider from each independent group, and what both found is marked', async () => {
    const { registry, calls } = registryOf({ exa_search: ok(row('https://same.example/p/'), row('https://only-exa.example/')), brave_search: ok(row('https://SAME.example/p'), row('https://only-brave.example/')), tavily_search: ok(row('https://t.example/')) })
    const out = await find(webTools({ registry, env: {} }), 'web_search').execute({ query: 'does X cause Y', intent: 'claim' })
    assert.deepEqual(calls.map(c => c.name).sort(), ['brave_search', 'exa_search'], 'Tavily is not asked when Brave answered')
    assert.match(out, /\[found by exa_search and brave_search\]/)
    assert.ok(out.indexOf('same.example') < out.indexOf('only-exa.example'), 'what both found comes first')
    assert.match(out, /Two independent indexes answered/)
  })
  test('a claim with only one group served says it was not a cross-check', async () => {
    const { registry } = registryOf({ exa_search: ok(row('https://e.example/')) })
    const out = await find(webTools({ registry, env: {} }), 'web_search').execute({ query: 'q', intent: 'claim' })
    assert.match(out, /Only one independent index answered/)
  })
  test('rejects an empty query and an unknown intent', async () => {
    const search = find(webTools({ registry: registryOf({ exa_search: ok() }).registry, env: {} }), 'web_search')
    await assert.rejects(search.execute({ query: ' ' }), /query is required/)
    await assert.rejects(search.execute({ query: 'q', intent: 'nope' }), /intent must be one of/)
  })
  test('every provider in the orders and groups is a real dropped provider tool', async () => {
    const { DROPPED_TOOLS } = await import('../../server/src/fit.mjs')
    for (const name of [...Object.values(SEARCH_ORDER).flat(), ...CLAIM_GROUPS.flat()]) assert.ok(DROPPED_TOOLS[name]?.provider, name)
    for (const order of Object.values(SEARCH_ORDER)) assert.equal(new Set(order).size, 5, 'each order names every web provider once')
  })
})

describe('normalizing and merging', () => {
  test('paper-shaped rows and Parallel excerpts become one shape; rows without a URL are dropped', () => {
    const a = normalizeResults('brave_search', { results: [row('https://a.example/', 'A'), { title: 'no url' }] })
    assert.deepEqual(a.map(r => [r.url, r.title, r.snippet, r.provider]), [['https://a.example/', 'A', 'about A', 'brave_search']])
    const p = normalizeResults('parallel_search', { results: [{ url: 'https://p.example/', title: 'P', excerpts: ['one', 'two'], publish_date: '2026-01-02' }] })
    assert.deepEqual([p[0].snippet, p[0].date], ['one two', '2026-01-02'])
  })
  test('provider arguments follow each tool\'s own parameters', () => {
    assert.deepEqual(providerArgs('brave_search', { query: 'q', count: 5, recency: 'week' }), { query: 'q', count: 5, freshness: 'pw' })
    assert.deepEqual(providerArgs('tavily_search', { query: 'q', recency: 'day' }), { query: 'q', max_results: 8, time_range: 'day' })
    assert.deepEqual(providerArgs('perplexity_search', { query: 'q' }), { query: 'q', max_results: 8 })
    assert.equal(providerArgs('exa_search', { query: 'q', recency: 'year' }).start_published_date.length, 10)
    assert.deepEqual(providerArgs('parallel_search', { query: 'q' }), { objective: 'q', search_queries: ['q'], mode: 'fast' })
    assert.equal(providerArgs('brave_search', { query: 'q', count: 500 }).count, 20, 'the count is capped')
  })
  test('merge keeps one row per page and every provider that found it', () => {
    const merged = mergeResults([[{ url: 'https://a.example/x#top', title: 'A', snippet: '', provider: 'exa_search' }], [{ url: 'https://a.example/x/', title: 'A', snippet: 'text', provider: 'brave_search' }]])
    assert.equal(merged.length, 1)
    assert.deepEqual(merged[0].providers, ['exa_search', 'brave_search'])
    assert.equal(merged[0].snippet, 'text')
  })
})

describe('web_extract', () => {
  const fenceStub = (body, meta) => `[${meta.source}]\n${body}`
  const firecrawl = (table) => async (url, init) => {
    const target = JSON.parse(init.body).url
    assert.equal(url, 'https://api.firecrawl.dev/v2/scrape')
    assert.equal(init.headers.Authorization, 'Bearer fc-key')
    const hit = table[target]
    if (hit instanceof Error) throw hit
    if (!hit) return { ok: false, status: 402, json: async () => ({ success: false }) }
    return { ok: true, status: 200, json: async () => ({ success: true, data: { markdown: hit, metadata: { title: `T ${target}` } } }) }
  }

  test('Firecrawl reads what it can; Parallel then Jina read the rest; what none could read is listed', async () => {
    const { registry, calls } = registryOf({
      parallel_extract: a => ({ results: a.urls.filter(u => u.includes('p.example')).map(url => ({ url, title: 'P', excerpts: ['parallel text'] })) }),
      jina_read: a => (a.url.includes('j.example') ? { content: 'jina text' } : { error: 'Jina API error 404', status: 404 }),
    })
    const [extract] = webTools({ registry, env: { AH_KEY_FIRECRAWL_API_KEY: 'fc-key' }, fence: fenceStub, fetchImpl: firecrawl({ 'https://f.example/': '# firecrawl text' }) })
    const out = await extract.execute({ urls: ['https://f.example/', 'https://p.example/', 'https://j.example/', 'https://none.example/'] })
    assert.match(out, /3 of 4 URLs read/)
    assert.match(out, /https:\/\/f\.example\/  \[read by firecrawl\]\n\[https:\/\/f\.example\/\]\n# firecrawl text/)
    assert.match(out, /\[read by parallel_extract\]/)
    assert.match(out, /\[read by jina_read\]/)
    assert.match(out, /FAILED https:\/\/none\.example\/\n  no provider could read it \(jina 404\)\. Try WebFetch\./)
    assert.deepEqual(calls.filter(c => c.name === 'parallel_extract')[0].args.urls, ['https://p.example/', 'https://j.example/', 'https://none.example/'], 'Parallel is asked only for what Firecrawl did not read')
    assert.equal(calls.filter(c => c.name === 'jina_read').length, 2)
  })
  test('without a Firecrawl key it starts at Parallel; a network error falls through; the key never appears in the output', async () => {
    const { registry } = registryOf({ parallel_extract: { error: 'Parallel Extract API error 429', status: 429 }, jina_read: { content: 'jina text' } })
    const [extract] = webTools({ registry, env: {}, fence: fenceStub, fetchImpl: () => { throw new Error('should not be called') } })
    const out = await extract.execute({ urls: ['https://a.example/'] })
    assert.match(out, /\[read by jina_read\]/)
    const withKey = webTools({ registry, env: { FIRECRAWL_API_KEY: 'fc-key' }, fence: fenceStub, fetchImpl: firecrawl({ 'https://a.example/': new Error('down') }) })[0]
    const out2 = await withKey.execute({ urls: ['https://a.example/'] })
    assert.match(out2, /\[read by jina_read\]/)
    assert.doesNotMatch(out2, /fc-key/)
  })
  test('text is cut at 6,000 characters unless full_content is asked for; bad input is refused', async () => {
    const { registry } = registryOf({ jina_read: { content: 'x'.repeat(30_000) } })
    const [extract] = webTools({ registry, env: { FIRECRAWL_API_KEY: 'k' }, fence: fenceStub, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) })
    const short = await extract.execute({ urls: ['https://a.example/'] })
    const long = await extract.execute({ urls: ['https://a.example/'], full_content: true })
    assert.ok(short.length < 6500 && /… \[truncated\]/.test(short))
    assert.ok(long.length > 19_000 && long.length < 21_000)
    await assert.rejects(extract.execute({ urls: [] }), /at least one URL/)
    await assert.rejects(extract.execute({ urls: ['ftp://a'] }), /not an HTTP/)
    await assert.rejects(extract.execute({ urls: Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`) }), /at most 10/)
  })
})
