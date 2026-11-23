// What the mod leaves out of Academic Harness, and why. One place, read by the tool manifest, the skill and agent builds, the prompt
// build and the tests, so a cut is a line here and nothing else.
//
// The question asked of every piece: in Claude Code, is it useful, or does Claude Code (or a connector the person already has) already do it?
//
//   drop        redundant with something Claude Code ships, or only meaningful in DSH's own UI. Not served, not built.
//   on-demand   a skill for a library, a service or a niche field. Left out of the session catalogue (which costs context every
//               session) but still bundled: `skill_search` finds it and `skill_load` reads it.
//
// Nothing here removes a tool for being unusual. A researcher's tools (search, citation, ledgers, the writing engine, reviews, compute)
// stay. `restore_tools` (setting) / AH_RESTORE_TOOLS brings a dropped tool back by name, for a person who has the key and wants it.

/** Tools not served. `module` is the upstream file that registers it (one tool each), `area` the tool area it came from (for `restore_tools`), `keys` the settings fields only it reads (offered, so the key can be saved before the tool is brought back with `restore_tools`; withheld only when `restorable: false`), `provider` the environment variable that holds the key of a search provider: such a tool is served on its own once that key is set (see `autoProviders`) and is routed by the research-mode text, `restorable: false` when the machinery it needed is gone too, `why` the reason shown in the report and the docs. */
export const DROPPED_TOOLS = {
  brave_search: { module: 'brave-search.js', area: 'search', provider: 'BRAVE_API_KEY', keys: ['BRAVE_API_KEY'], why: 'General web search: Claude Code has WebSearch, and a paid key buys nothing it lacks.' },
  tavily_search: { module: 'tavily-search.js', area: 'search', provider: 'TAVILY_API_KEY', keys: ['TAVILY_API_KEY'], why: 'General web search: Claude Code has WebSearch.' },
  exa_search: { module: 'exa-search.js', area: 'search', provider: 'EXA_API_KEY', keys: ['EXA_API_KEY'], why: 'General web search: Claude Code has WebSearch (Exa also publishes its own MCP server).' },
  perplexity_search: { module: 'perplexity-search.js', area: 'search', provider: 'PERPLEXITY_API_KEY', keys: ['PERPLEXITY_API_KEY'], why: 'General web search: Claude Code has WebSearch.' },
  parallel_search: { module: 'parallel-search.js', area: 'search', provider: 'PARALLEL_API_KEY', why: 'General web search: Claude Code has WebSearch. `parallel` stays a keyed source inside `literature_search`.' },
  parallel_extract: { module: 'parallel-extract.js', area: 'search', provider: 'PARALLEL_API_KEY', why: 'Page fetch: Claude Code has WebFetch; `jina_read` covers JavaScript pages and PDFs.' },
  consensus_search: { module: 'consensus-search.js', area: 'search', provider: 'CONSENSUS_API_KEY', why: 'A vendor search API. `literature_search` keeps `consensus` as a keyed source; Consensus publishes its own MCP server for the full tool.' },
  elicit_search: { module: 'elicit-search.js', area: 'search', provider: 'ELICIT_API_KEY', keys: ['ELICIT_API_KEY'], why: 'A vendor search API; Elicit publishes its own MCP server.' },
  scientific_result: { module: 'scientific-result.js', area: 'notebook', why: 'Draws a result card in DSH\'s chat. In Claude Code the answer is the reply (a Markdown table).' },
  fold_text: { module: 'fold-text.js', area: 'notebook', why: 'Folding a reply is `/fold` here; a model has no use for folding text it can summarise.' },
  research_template: { module: 'workflows.js', area: 'notebook', why: 'A catalogue of one-click prompts for DSH\'s chat boxes. Here the skills and the task commands do that job.' },
  latex_compile: { module: 'latex-compile.js', area: 'submission', why: 'A latexmk wrapper: Bash does it, and `ah_build` covers Academic Harness projects.' },
}

/** Settings fields not offered as plugin options: DSH's custom subagent routes (a Claude Code subagent takes a `model` instead) and zvec_index's own settings, which it reads from the environment (ZVEC_GREP_CLI, ZVEC_GREP_EMBEDDING). */
export const NOT_OFFERED_KEY_FIELDS = [/^SUBAGENT_/, /^ZVEC_/]

/** Skills not built into the plugin and not offered on demand either. */
export const DROPPED_SKILLS = {
  docx: 'Word files: Anthropic ships a docx skill.',
  pdf: 'PDF files: Anthropic ships a pdf skill, and Read opens PDFs.',
  pptx: 'PowerPoint files: Anthropic ships a pptx skill.',
  xlsx: 'Excel files: Anthropic ships an xlsx skill.',
  // the same brief exists as an agent (agents/<name>.md): the agent keeps it, in its own context
  'abstract-writer': 'The agent of the same name has the same brief.',
  'citation-checker': 'The agent of the same name has the same brief.',
  'literature-researcher': 'The agent of the same name has the same brief.',
  'manuscript-editor': 'The agent of the same name has the same brief.',
  'peer-reviewer': 'The agent of the same name has the same brief.',
  'statistical-reviewer': 'The agent of the same name has the same brief.',
}

/** Skills kept out of the session catalogue (each description is context on every turn) and left to `skill_search` / `skill_load`. */
export const ON_DEMAND_SKILLS = {
  'using-science-superpowers': 'Its description tells the model to load a skill before every response, which would apply to every session; it is read on request with skill_load.',
  openfda: 'Tool `openfda` describes itself.',
  clinicaltrials: 'Tool `clinicaltrials` describes itself.',
  gget: 'A bioinformatics CLI.',
  scanpy: 'A library the model knows.',
  'pytorch-lightning': 'A library the model knows.',
  'hyperparameter-optimization': 'A niche workflow.',
  'drawio-reconstruction': 'A niche workflow.',
  'diagram-design': 'Large and general (diagrams), not academic-specific.',
  'markdown-mermaid-writing': 'General documentation style.',
  'scientific-visualization': 'Overlaps `scientific-figure-making` and `figure-designer`.',
  'benchmark-paper-template': 'A template for one paper type.',
  'tech-paper-template': 'A template for one paper type.',
  'vibe-research-workflow': 'A general workflow.',
  'agentic-data-science-pipeline': 'DSH\'s plan-review-implement loop; Claude Code has plan mode and subagents.',
  paper2agent: 'The Paper2Agent product; the `paper-agent-builder` agent carries it.',
  paper2skill: 'The Paper2Agent product.',
  paper2mcp: 'The Paper2Agent product.',
}

/** Agents not built. */
export const DROPPED_AGENTS = {
  'pipeline-engineer': 'Builds pipelines: ordinary coding, which Claude Code\'s own agent does.',
}

/** The setting that brings dropped tools back: a comma list of tool names. Unknown names are returned apart. */
export function restoreList(value) {
  const names = String(value ?? '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
  const can = n => Object.hasOwn(DROPPED_TOOLS, n) && DROPPED_TOOLS[n].restorable !== false
  return { restore: names.filter(can), unknown: names.filter(n => !can(n)) }
}

/**
 * Search providers that serve themselves: a dropped tool with a `provider` key is brought back when that key is set (in the shell, or as a
 * plugin option, which arrives as AH_KEY_<NAME>), so a person who pays for a provider does not also have to name it in `restore_tools`, and a
 * provider with no key is not offered to a model that could only be told "key_missing". `AH_AUTO_PROVIDERS=0` turns this off.
 */
export function autoProviders(env = process.env) {
  if (env.AH_AUTO_PROVIDERS?.trim() === '0') return []
  const has = k => Boolean(env[k]?.trim() || env[`AH_KEY_${k}`]?.trim())
  return Object.entries(DROPPED_TOOLS).filter(([, t]) => t.provider && t.restorable !== false && has(t.provider)).map(([n]) => n)
}

/** Settings fields that only a tool which cannot come back reads: not offered. A restorable tool's key is offered, so it can be saved ahead of `restore_tools`. */
export const DROPPED_KEY_FIELDS = new Set(Object.values(DROPPED_TOOLS).filter(t => t.restorable === false).flatMap(t => t.keys ?? []))

/**
 * Credentials a served tool reads that Academic Harness's own settings list (settings-keys.js KEY_FIELDS) does not name, so a person could
 * only export them in a shell. Offered here as plugin options, empty until set, so every key a tool can use has a place in the plugin's
 * secure store. Each one is read from the environment by the tool named.
 */
export const EXTRA_KEY_FIELDS = {
  GITHUB_TOKEN: 'GitHub token for repo_audit: raises the API rate limit and reaches private repositories. Leave empty to use the GITHUB_TOKEN environment variable, or none.',
  OSF_TOKEN: 'Open Science Framework token for preregistration (OSF). Leave empty to use the OSF_TOKEN environment variable, or none.',
  IMAGE_API_KEY: 'Key for an OpenAI-compatible Images API, used by image_generate with IMAGE_PROVIDER=openai (the default Gemini path uses the Gemini key). Leave empty to use the IMAGE_API_KEY environment variable, or none.',
}
