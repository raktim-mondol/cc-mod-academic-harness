// Which upstream modules the tool host loads.
//
// Upstream's `apply(ctx)` functions come from two places, and both are discovered from the
// snapshot rather than listed here, so a module upstream adds shows up as a drift line:
//   1. index.js: the bundle-level `applyX(ctx)` calls (notebook, fold_text, ...). index.js's own
//      apply() also runs seed() and registerKeysSettings(), which copy skills and patch profiles
//      under DSH_HOME and bind a settings service. The mod does neither, so the host calls the
//      component functions directly.
//   2. presets/academic-harness/agent.cordis.yml: the `academic-harness/<module>` rows.
//
// Each module is then classified:
//   tier 1      loaded in P2, in one of the areas below
//   host-only   needs the DSH host (system prompt, subagent registry, MCP mounts); never loaded here
//   dropped     left out on purpose (server/src/fit.mjs): Claude Code already does it, or it is DSH's own UI
//   later       nothing now; a module upstream adds that nobody has classified yet lands here, and the parity check says so
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DROPPED_TOOLS, restoreList } from './fit.mjs'
export { restoreList }

export const AREAS = ['search', 'papers', 'notebook', 'skills', 'writing', 'reviews', 'tournament', 'analysis', 'provenance', 'study', 'data', 'submission', 'deep', 'compute', 'figures', 'memory']

/** Tier-1 modules by area. The order is the registration order. */
export const TIER1 = {
  notebook: ['notebook.js'],
  skills: ['skill-on-demand.js'],
  // P3: the ah_* tools. They run the writing engine's CLI, so they need scripts/install-engine.mjs; without it each call says so.
  writing: ['academic-harness.js', 'rsi.js'],
  // P4, the modules that need only `tools`. Some shell out to an installed program (LaTeX, mermaid, rdkit); a call says what is missing.
  reviews: ['review.js', 'meta-analysis.js'],
  tournament: ['coscientist.js', 'coscientist-rank.js', 'coscientist-verify.js'],
  analysis: ['analysis-run.js', 'experiment-log.js', 'ablation.js', 'data-profile.js', 'stat-audit.js', 'power-analysis.js', 'causal-dag.js', 'reporting-check.js'],
  provenance: ['provenance-audit.js', 'authorship.js', 'repro-package.js', 'numbers-audit.js', 'repo-audit.js', 'figure-audit.js'],
  study: ['preregister.js', 'design.js', 'ethics-protocol.js', 'deidentify.js', 'dmp.js', 'grant-budget.js', 'grant-search.js', 'funder-policy.js', 'journal-policy.js'],
  data: [
    'dataset-get.js', 'dataset-search.js', 'science-source.js', 'chem-toolkit.js', 'seq-toolkit.js', 'structure-toolkit.js', 'sci-inspect.js',
    'clinicaltrials.js', 'openfda.js', 'patent-search.js', 'prior-art.js', 'author-lookup.js', 'openreview.js', 'literature-watch.js',
    'paper-recommend.js', 'citation-network.js', 'pdf-references.js', 'futurehouse-agent.js',
  ],
  // Long and model-calling: the host runs these as jobs (a detached call, job_status / job_wait / job_log / job_kill) and answers `ctx.llm` with the model route.
  deep: ['deep-research.js', 'deep-review.js'],
  // Rented hardware. Every call asks first (hooks/approvals.ts) and the session spend cap is upstream's own (compute-ledger.js).
  compute: ['modal-run.js', 'runpod-run.js', 'vastai-run.js'],
  figures: ['image-generate.js'],
  // PaperMemory's own modules: the backfill tool and a consolidation pass shortly after the server starts (upstream runs it when an agent is disposed).
  memory: ['papermemory-backfill.js', 'papermemory-dream.js', 'paper-mcp.js'],
  submission: ['submission-pack.js', 'manuscript-diff.js', 'rebuttal.js', 'presentation-build.js', 'paper-artifacts.js', 'paper-fold.js', 'mermaid-render.js'],
  search: [
    'literature-search.js', 'openalex-search.js', 'semantic-scholar-search.js', 'pubmed-search.js', 'arxiv-search.js',
    'crossref-lookup.js', 'journal-search.js', 'domain-search.js', 'academic-databases.js', 'core-search.js',
    'jina-reader.js', 'zvec-index.js',
  ],
  papers: [
    'paper-resolve.js', 'paper-get.js', 'paper-context.js', 'paper-download.js', 'openalex-cite.js', 'integrity-check.js',
    'citation.js', 'manuscript-citations.js', 'reference-library.js', 'pdf-to-markdown.js',
  ],
}

/** Modules that exist only because DSH has a host (plan section 4.3). Never loaded here. */
export const HOST_ONLY = {
  'academic-task.js': 'task modes are slash commands in P5',
  'prompt-section.js': 'the system prompt is the research-mode section (P1)',
  'subagent-models.js': 'subagent routing: a Claude Code agent takes a `model` of its own',
  'subagent-list-compat.js': 'DSH subagent registry',
  'mcp-connectors.js': 'Firecrawl and Scite connectors are attached to Claude Code directly',
  'zvec-grep.js': 'the zvec-grep MCP connector: zvec-grep installs its own Claude Code integration (zg install --target claude); zvec_index is served',
  'papermemory.js': 'mount MCP server, the manifest runs papermemory-mcp.mjs (P1)',
  'academic-harness-hooks.js': 'writing-engine guards are function hooks (P3)',
  'rsi-hooks.js': 'DSH host events of the self-improvement loop: the loop runs from the guard bridge instead (server/src/rsi-bridge.mjs, ah-hook.mjs)',
}

const toFile = rel => rel.replace(/^\.\//, '')

/** The component functions index.js calls inside apply(), as [{ file, fn }]. */
export function indexComponents(source) {
  const imports = new Map()
  for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/([^']+)'/g)) {
    for (const name of m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()).filter(Boolean)) imports.set(name, m[2])
  }
  const body = source.slice(source.indexOf('export function apply'))
  const out = []
  for (const m of body.matchAll(/\b(apply[A-Z]\w*)\s*\(\s*ctx\s*\)/g)) {
    const file = imports.get(m[1])
    if (file) out.push({ file, fn: m[1] })
  }
  return out
}

/** The `academic-harness/<module>` rows of the preset, as file names, via package.json `exports`. */
export function presetModules(yaml, exportsMap) {
  const out = []
  for (const m of yaml.matchAll(/name:\s*academic-harness\/([a-z0-9-]+)/g)) {
    out.push(toFile(exportsMap[`./${m[1]}`] ?? `./${m[1]}.js`))
  }
  return out
}

export function discover(upstream) {
  const read = rel => readFileSync(join(upstream, rel), 'utf8')
  const pkg = JSON.parse(read('package.json'))
  const entries = []
  const seen = new Set()
  const add = (file, fn) => {
    const key = `${file}#${fn}`
    if (seen.has(key)) return
    seen.add(key)
    entries.push({ file, fn })
  }
  for (const c of indexComponents(read('index.js'))) add(c.file, c.fn)
  const presetFile = 'presets/academic-harness/agent.cordis.yml'
  if (existsSync(join(upstream, presetFile))) for (const f of presetModules(read(presetFile), pkg.exports ?? {})) add(f, 'apply')
  return entries
}

export function classify(entry) {
  for (const [area, files] of Object.entries(TIER1)) if (files.includes(entry.file)) return { tier: 1, area }
  if (HOST_ONLY[entry.file]) return { tier: 'host-only', reason: HOST_ONLY[entry.file] }
  const dropped = Object.entries(DROPPED_TOOLS).find(([, t]) => t.module === entry.file)
  if (dropped) return { tier: 'dropped', tool: dropped[0], reason: dropped[1].why }
  return { tier: 'later' }
}

/** `areas` is a comma list or 'all'; unknown names are reported, not ignored. */
export function parseAreas(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw || raw === 'all' || raw === 'default') return { areas: [...AREAS], unknown: [] }
  const names = raw.split(/[\s,]+/).filter(Boolean)
  return { areas: names.filter(n => AREAS.includes(n)), unknown: names.filter(n => !AREAS.includes(n)) }
}

/** Entries to load, in tier-1 order. `restore` names dropped tools to load anyway (fit.mjs; the `restore_tools` setting), each in its own area. */
export function plan(upstream, areas = AREAS, { restore = [] } = {}) {
  const all = discover(upstream).map(e => ({ ...e, ...classify(e) }))
  const load = []
  for (const area of areas) {
    const back = restore.map(n => DROPPED_TOOLS[n]).filter(t => t && t.area === area).map(t => t.module)
    for (const file of [...(TIER1[area] ?? []), ...back]) {
      const e = all.find(x => x.file === file)
      if (e) load.push(e)
    }
  }
  const missing = []
  for (const area of areas) for (const file of TIER1[area] ?? []) if (!all.some(x => x.file === file)) missing.push(file)
  return { all, load, missing }
}
