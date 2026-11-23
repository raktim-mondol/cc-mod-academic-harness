// The host's own web tools: `web_search` and `web_extract`.
//
// The search providers (brave, tavily, exa, perplexity, parallel) and the extractors (Firecrawl, Parallel, Jina) each need their own key, and a
// person has some of them, not all. These two tools are the orchestration in code rather than in prose: they look at which providers are
// actually available in this server, pick the one whose job matches, fall back to the next when one fails or answers nothing, and say which
// provider answered. A provider with no key is never tried. When none is available they say so, and the model uses what Claude Code has
// (`WebSearch`, `WebFetch`, or a connector the person signed in to).
//
// They are not upstream tools: they call the provider tools through the registry, so a provider's own limits, pacing and key handling stay
// where they are.

/** Web providers by how well each does a kind of search, best first. Only the ones that are served are tried. */
export const SEARCH_ORDER = {
  general: ['perplexity_search', 'tavily_search', 'brave_search', 'exa_search', 'parallel_search'],
  semantic: ['exa_search', 'parallel_search', 'perplexity_search', 'tavily_search', 'brave_search'],
  fresh: ['perplexity_search', 'tavily_search', 'brave_search', 'exa_search', 'parallel_search'],
  news: ['tavily_search', 'perplexity_search', 'brave_search', 'exa_search', 'parallel_search'],
  excerpts: ['parallel_search', 'exa_search', 'tavily_search', 'perplexity_search', 'brave_search'],
}
export const INTENTS = [...Object.keys(SEARCH_ORDER), 'claim']

/** For `claim`: one provider from each group, so the two checks do not share an index or a ranking. */
export const CLAIM_GROUPS = [
  ['exa_search', 'parallel_search'],
  ['brave_search', 'perplexity_search', 'tavily_search'],
]

/** Extractors in the order tried: Firecrawl, then Parallel, then Jina (keyless). */
export const EXTRACT_ORDER = ['firecrawl', 'parallel_extract', 'jina_read']

const RECENCY = { day: { brave: 'pd', tavily: 'day', perplexity: 'day' }, week: { brave: 'pw', tavily: 'week', perplexity: 'week' }, month: { brave: 'pm', tavily: 'month', perplexity: 'month' }, year: { brave: 'py', tavily: 'year', perplexity: 'year' } }
const DAYS = { day: 1, week: 7, month: 31, year: 366 }
const FIRECRAWL_SCRAPE = 'https://api.firecrawl.dev/v2/scrape'
const PER_URL_CHARS = 6000
const FULL_CHARS = 20_000

const hasKey = (env, name) => Boolean(env[name]?.trim() || env[`AH_KEY_${name}`]?.trim())
const text = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

/** One result shape for every provider: { title, url, snippet, date, provider }. Rows without a URL are dropped. */
export function normalizeResults(provider, value) {
  const rows = Array.isArray(value?.results) ? value.results : []
  const out = []
  for (const r of rows) {
    const url = text(r?.url)
    if (!/^https?:\/\//i.test(url)) continue
    const excerpts = Array.isArray(r.excerpts) ? r.excerpts.map(text).filter(Boolean).join(' ') : ''
    const extra = Array.isArray(r.snippets) ? r.snippets.map(text).filter(Boolean).join(' ') : ''
    const snippet = (text(r.abstract) || excerpts || text(r.content) || text(r.snippet) || text(r.description) || extra).slice(0, 600)
    out.push({ title: text(r.title) || url, url, snippet, date: text(r.publish_date) || (r.year ? String(r.year) : ''), provider })
  }
  return out
}

/** The arguments each provider's own tool takes for a plain query. Parallel wants an objective, queries and a mode. */
export function providerArgs(tool, { query, count, recency }) {
  const n = Math.max(1, Math.min(Number(count) || 8, 20))
  switch (tool) {
    case 'brave_search': return { query, count: n, ...(recency ? { freshness: RECENCY[recency].brave } : {}) }
    case 'tavily_search': return { query, max_results: n, ...(recency ? { time_range: RECENCY[recency].tavily } : {}) }
    case 'perplexity_search': return { query, max_results: n, ...(recency ? { search_recency_filter: RECENCY[recency].perplexity } : {}) }
    case 'exa_search': return { query, num_results: n, include_highlights: true, ...(recency ? { start_published_date: new Date(Date.now() - DAYS[recency] * 864e5).toISOString().slice(0, 10) } : {}) }
    case 'parallel_search': return { objective: query, search_queries: [query], mode: 'fast' }
    default: return { query }
  }
}

/** Merge lists of results by URL (ignoring a trailing slash and a fragment), keeping each provider that found one. */
export function mergeResults(lists) {
  const byUrl = new Map()
  for (const list of lists) {
    for (const r of list) {
      const key = r.url.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase()
      const seen = byUrl.get(key)
      if (seen) { if (!seen.providers.includes(r.provider)) seen.providers.push(r.provider); if (!seen.snippet && r.snippet) seen.snippet = r.snippet } else byUrl.set(key, { ...r, providers: [r.provider] })
    }
  }
  return [...byUrl.values()].sort((a, b) => b.providers.length - a.providers.length)
}

/** The listing is third-party text (titles and snippets of pages nobody here chose), so it goes inside the untrusted-source fence; the header and the note, which are ours, stay outside it. */
const renderSearch = ({ query, intent, tried, results, note }, fence) => {
  const head = `web_search "${query}" (${intent}): ${results.length} result${results.length === 1 ? '' : 's'}${tried.length ? `, via ${tried.map(t => `${t.provider}${t.ok ? '' : ` (${t.why})`}`).join(' -> ')}` : ''}`
  const lines = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.date ? `  (${r.date})` : ''}${r.providers.length > 1 ? `  [found by ${r.providers.join(' and ')}]` : `  [${r.providers[0]}]`}${r.snippet ? `\n   ${r.snippet}` : ''}`)
  return [head, note, lines.length ? fence(lines.join('\n'), { source: 'web search results', kind: 'web-search' }) : ''].filter(Boolean).join('\n')
}

/**
 * `registry` is the host's; `env` is the server's environment; `fence` wraps untrusted page text (untrusted-fence.js in the core).
 * Returns the tools that make sense for what is served: none when nothing is keyed, so the default surface is unchanged.
 */
export function webTools({ registry, env = process.env, fence = (body, meta) => `<untrusted-source source="${meta?.source ?? ''}">\n${body}\n</untrusted-source>`, fetchImpl = globalThis.fetch } = {}) {
  const served = name => registry.tools.has(name)
  const tools = []

  const providersServed = () => new Set(Object.values(SEARCH_ORDER).flat().filter(served))
  if (providersServed().size) {
    tools.push({
      name: 'web_search',
      description: 'Search the web through whichever keyed provider is available here (Perplexity, Tavily, Brave, Exa, Parallel), choosing by the kind of search and falling back to the next provider when one fails or finds nothing. The result says which provider answered. intent: general (default), semantic (find pages by meaning), fresh (recent), news, excerpts (answer-bearing excerpts), claim (checks with two independent indexes and marks what both found). Not for papers: use literature_search. If no provider is available it says so; then use WebSearch.',
      parameters: {
        query: { type: 'string', required: true, description: 'What to search for.' },
        intent: { type: 'string', enum: INTENTS, description: 'The kind of search. Default general.' },
        count: { type: 'number', description: 'Results wanted, 1-20. Default 8.' },
        recency: { type: 'string', enum: Object.keys(RECENCY), description: 'Only results from the last day, week, month or year (not every provider can filter).' },
        provider: { type: 'string', description: 'Force one provider by tool name (for example exa_search). It is used if served; otherwise the usual order applies.' },
      },
      async execute({ query, intent = 'general', count, recency, provider } = {}, exec) {
        const q = text(query)
        if (!q) throw new Error('query is required')
        if (!INTENTS.includes(intent)) throw new Error(`intent must be one of ${INTENTS.join(', ')}`)
        const available = providersServed()
        if (!available.size) return `web_search: no search provider is available (none has a key). Use WebSearch, or a search connector you have signed in to.`
        const tried = []
        const call = async tool => {
          try {
            const value = await registry.tools.get(tool).execute(providerArgs(tool, { query: q, count, recency }), exec)
            if (value?.error) { tried.push({ provider: tool, ok: false, why: value.code ?? String(value.error).slice(0, 60) }); return null }
            const results = normalizeResults(tool, value)
            if (!results.length) { tried.push({ provider: tool, ok: false, why: 'no results' }); return null }
            tried.push({ provider: tool, ok: true })
            return results
          } catch (error) {
            tried.push({ provider: tool, ok: false, why: String(error?.message ?? error).slice(0, 60) })
            return null
          }
        }

        if (intent === 'claim' && !provider) {
          // One provider per group, tried in parallel; a group whose first choice fails falls to its next.
          const lists = await Promise.all(CLAIM_GROUPS.map(async group => {
            for (const tool of group.filter(t => available.has(t))) { const r = await call(tool); if (r) return r }
            return null
          }))
          const got = lists.filter(Boolean)
          const results = mergeResults(got).slice(0, Math.max(1, Math.min(Number(count) || 8, 20)))
          const note = got.length === 2 ? 'Two independent indexes answered; [found by A and B] marks what both returned. A page both found is a lead, not proof: read it.' : got.length === 1 ? 'Only one independent index answered, so this is not a cross-check.' : ''
          if (!results.length) return `${renderSearch({ query: q, intent, tried, results: [], note: '' }, fence)}\nNo provider answered. Use WebSearch.`
          return renderSearch({ query: q, intent, tried, results, note }, fence)
        }

        const order = [...(provider && available.has(provider) ? [provider] : []), ...SEARCH_ORDER[intent === 'claim' ? 'general' : intent]].filter((t, i, a) => available.has(t) && a.indexOf(t) === i)
        for (const tool of order.slice(0, 3)) {
          const results = await call(tool)
          if (results) return renderSearch({ query: q, intent, tried, results: mergeResults([results]).slice(0, Math.max(1, Math.min(Number(count) || 8, 20))), note: '' }, fence)
        }
        return `${renderSearch({ query: q, intent, tried, results: [], note: '' }, fence)}\nNo provider answered. Use WebSearch.`
      },
    })
  }

  const firecrawlKey = () => env.FIRECRAWL_API_KEY?.trim() || env.AH_KEY_FIRECRAWL_API_KEY?.trim() || ''
  if (hasKey(env, 'FIRECRAWL_API_KEY') || served('parallel_extract')) {
    tools.push({
      name: 'web_extract',
      description: 'Read the text of up to 10 URLs you already have, trying Firecrawl first (it renders JavaScript pages and reads PDFs), then Parallel Extract, then Jina Reader (keyless), and saying which one read each URL. A URL no provider could read is listed, and WebFetch is the next step. This reads pages; it does not find them: use web_search or literature_search for that.',
      parameters: {
        urls: { type: 'array', items: { type: 'string' }, required: true, description: 'HTTP(S) URLs, 1-10.' },
        objective: { type: 'string', description: 'One sentence on what you need from the pages. Parallel uses it to pick excerpts; the others return the page text.' },
        full_content: { type: 'boolean', description: 'Return more of each page (up to about 20,000 characters) instead of the first 6,000. Default false.' },
      },
      async execute({ urls, objective, full_content: full } = {}, exec) {
        const list = [...new Set((Array.isArray(urls) ? urls : []).map(u => String(u).trim()).filter(Boolean))]
        if (!list.length) throw new Error('urls must contain at least one URL')
        if (list.length > 10) throw new Error('urls accepts at most 10 URLs')
        const bad = list.find(u => !/^https?:\/\//i.test(u))
        if (bad) throw new Error(`not an HTTP(S) URL: ${bad}`)
        const cap = full ? FULL_CHARS : PER_URL_CHARS
        const done = new Map()
        const why = new Map()
        const take = (url, provider, title, body) => { const t = String(body ?? '').trim(); if (t) { done.set(url, { provider, title: text(title), body: t.length > cap ? `${t.slice(0, cap).trimEnd()}\n… [truncated]` : t }); return true } return false }
        const pending = () => list.filter(u => !done.has(u))

        // 1. Firecrawl, one scrape per URL (a synchronous endpoint), two at a time.
        const key = firecrawlKey()
        if (key && fetchImpl) {
          const queue = [...list]
          const worker = async () => {
            for (let url = queue.shift(); url; url = queue.shift()) {
              try {
                const res = await fetchImpl(FIRECRAWL_SCRAPE, { method: 'POST', signal: exec?.signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }) })
                const data = await res.json().catch(() => null)
                if (!res.ok || data?.success === false) { why.set(url, `firecrawl ${res.status}`); continue }
                if (!take(url, 'firecrawl', data?.data?.metadata?.title, data?.data?.markdown)) why.set(url, 'firecrawl returned no text')
              } catch (error) { why.set(url, `firecrawl ${error?.name === 'AbortError' ? 'cancelled' : 'unreachable'}`) }
            }
          }
          await Promise.all([worker(), worker()])
        }
        // 2. Parallel Extract for what Firecrawl did not read.
        if (pending().length && served('parallel_extract')) {
          try {
            const value = await registry.tools.get('parallel_extract').execute({ urls: pending(), ...(objective ? { objective } : {}), ...(full ? { full_content: true } : {}) }, exec)
            if (value?.error) for (const u of pending()) why.set(u, `parallel ${value.status ?? 'error'}`)
            else for (const r of value?.results ?? []) take(String(r.url), 'parallel_extract', r.title, r.full_content || (r.excerpts ?? []).join('\n\n'))
          } catch (error) { for (const u of pending()) why.set(u, 'parallel unreachable') }
        }
        // 3. Jina Reader for the rest, one at a time (its keyless limit is low).
        if (pending().length && served('jina_read')) {
          for (const url of pending()) {
            try {
              const value = await registry.tools.get('jina_read').execute({ mode: 'read', url }, exec)
              if (value?.error) why.set(url, `jina ${value.status ?? 'error'}`)
              else take(url, 'jina_read', '', value?.content)
            } catch { why.set(url, 'jina unreachable') }
          }
        }

        const blocks = list.map(url => {
          const r = done.get(url)
          if (!r) return `FAILED ${url}\n  no provider could read it (${why.get(url) ?? 'none available'}). Try WebFetch.`
          return `${r.title ? `${r.title}\n` : ''}${url}  [read by ${r.provider}]\n${fence(r.body, { source: url, kind: `web-extract-${r.provider}` })}`
        })
        const ok = list.filter(u => done.has(u)).length
        return [`web_extract: ${ok} of ${list.length} URL${list.length === 1 ? '' : 's'} read${objective ? ` (looking for: ${text(objective).slice(0, 120)})` : ''}`, ...blocks].join('\n\n')
      },
    })
  }
  return tools
}
