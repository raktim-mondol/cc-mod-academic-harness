// Host wording: the places where Academic Harness's text tells the model to do something that is wrong, or impossible, in Claude Code.
//
// The skills, agent briefs and guides are upstream's own text, copied by the build. Most of it needs nothing: it is about research. A few
// passages name DSH's own web tools, DSH's sandbox, or a tool this mod does not serve (server/src/fit.mjs), and those are rewritten here.
//
// Each rule names the file it applies to (a target) and the text it finds. A rule whose text is not found throws: upstream changed the
// passage, and the rule has to be looked at again. A target the build does not produce is skipped (its rules sit unused).
//
// Targets:  guide:<slug>   a file of skills/research-guides/references/
//           agent:<name>   agents/<name>.md (the brief)
//           skill:<name>/<path inside the skill folder>

/** `find` is a RegExp (one match is enough); `to` the replacement. `why` says what was wrong. */
export const RULES = [
  // ---- the web: Claude Code has WebSearch and WebFetch, and no DSH search provider to apologise for ----
  {
    target: 'guide:literature-and-the-web',
    why: 'DSH\'s web tools and their keys (Parallel, Brave, Tavily, Exa, Perplexity, Firecrawl) replaced by what Claude Code has',
    find: /Built-in `web_search` works on this profile[\s\S]*?None of these is a literature index; use the academic database tools for papers\./,
    to: [
      'Find papers with the academic tools below, not with a web search: `literature_search` is the one-shot entry (OpenAlex and Semantic Scholar, plus PubMed, arXiv and others by topic, merged and ranked), and the single-source tools are for a second query with another angle. Claude Code\'s own `WebSearch` is for what is not scholarship (news, a product, a regulation, a lab\'s page), and `WebFetch` reads a page once you have its URL. `jina_read` (key optional) reads pages `WebFetch` cannot (JavaScript, PDFs). If the session has Firecrawl, Scite, Consensus or Elicit connectors, they are extra indexes under their own names; use them for what they add (Scite: supporting and contrasting citations), not as the only search.',
      '',
      'Ingest papers you will cite into PaperMemory (`paper_download` does this automatically; otherwise `mcp__plugin_academic-harness_papermemory__papermemory_ingest`) and cite only keys those memory tools return. Prefer primary literature over blogs. Mark unverifiable references as unverifiable, never as fine.',
    ].join('\n'),
  },
  {
    target: 'guide:literature-and-the-web',
    why: 'elicit_search is not served; Elicit has its own MCP server',
    find: / `elicit_search` \(`ELICIT_API_KEY`, Pro plan\)[\s\S]*?do not fan out\./,
    to: '',
  },
  {
    target: 'guide:literature-and-the-web',
    why: 'the agent-browser skill is not shipped; say what to use',
    find: /When a task needs a real rendered browser rather than a text fetch[\s\S]*?report that limitation instead of guessing\./,
    to: 'When a task needs a real rendered browser rather than a text fetch (logging in, filling a form, clicking through to a dataset download, checking that a page renders), use a browser tool this session has: Claude Code\'s built-in browser or Claude in Chrome, or the `agent-browser` CLI if it is installed. For a chart or a layout, `Read` the screenshot file. If none of these is available, say so instead of guessing.',
  },
  {
    target: 'agent:literature-researcher',
    why: 'the brief tells the model to use parallel_search, consensus_search and Firecrawl, and not to use web_search or web_fetch',
    find: /Prefer both `consensus_search` and `parallel_search`[\s\S]*?`parallel_extract`\./,
    to: [
      'Start with `literature_search` (OpenAlex and Semantic Scholar, plus PubMed or arXiv by topic; merged and ranked), then add `openalex_search`, `s2_search`, `pubmed_search` or `arxiv_search` with a different angle instead of repeating one query.',
      'Use `paper_get` for one authoritative record and `paper_context` for the passage that supports a claim. Use `WebSearch` only for what is not a paper (news, a product, a regulation),',
      'and read a page with `WebFetch`, or `jina_read` when it needs JavaScript or is a PDF.',
    ].join('\n'),
  },
  {
    target: 'guide:latex',
    why: 'latex_compile is not served (Bash and ah_build do it); read_image is Read on the image',
    find: /Use `latex_compile` to compile[\s\S]*$/,
    to: 'Compile with `latexmk -pdf` (or `xelatex`/`lualatex` if the document needs them) from Bash; it handles bibtex and biber. In an Academic Harness project prefer `ah_build` so errors map back to units. A clean compile does not mean the page layout is right: render pages (`pdftoppm`) and `Read` the images rather than assuming the log is enough.',
  },
  // ---- tools this mod does not serve ----
  {
    target: 'guide:reproducible-analysis',
    why: 'research_template is not served',
    find: /The `research_template` catalogue supplies `limitation-mining`, `subset-first-eval`, `ablation-plan`, `rebuttal-plan`, `review-round-diff`, and `research-cycle` \(a stepwise guide through scope, prior art, baseline, pilot, comparison, review, and export\); these are prompt templates, not automatic executors, and a general request/,
    to: 'A general request',
  },
  {
    target: 'guide:specialists',
    why: 'pipeline-engineer is not built',
    find: /reproducibility-auditor, pipeline-engineer, data-visualizer/,
    to: 'reproducibility-auditor, data-visualizer',
  },
  {
    target: 'skill:co-scientist-tournament/references/briefs.md',
    why: 'consensus_search, parallel_search and parallel_extract are not served',
    find: /Use `consensus_search` \*\*and\*\*\n`parallel_search` \(`advanced` for a survey\) with the queries above, then\n`parallel_extract`, or `paper_download`/,
    to: 'Use `literature_search` (and `openalex_search` or `s2_search` with another angle) with the queries above, then `WebFetch` or `jina_read`, or `paper_download`',
  },
  {
    target: 'skill:generating-scientific-hypotheses/SKILL.md',
    why: 'consensus_search and parallel_search are not served',
    find: /`consensus_search` \*\*and\*\* `parallel_search` \(`advanced` for a survey\); `mcp__papermemory__papermemory_search`/,
    to: '`literature_search` (add `pubmed_search` or `arxiv_search` for a survey); `mcp__plugin_academic-harness_papermemory__papermemory_search`',
  },
  {
    target: 'skill:generating-scientific-hypotheses/references/hypothesis-card.md',
    why: 'consensus_search and parallel_search are not served',
    find: /consensus_search \+ parallel_search `advanced` for/,
    to: 'literature_search for',
  },
  {
    target: 'guide:literature-and-the-web',
    why: 'consensus_search and parallel_search are not served (consensus and parallel remain keyed sources of literature_search)',
    find: /Use `consensus_search` when you need study-design filters or per-paper takeaways, and `parallel_search` \(`basic`\/`advanced`\) for web \+ literature excerpts\./,
    to: 'Name `consensus` in `literature_search`\'s `sources` when you need Consensus\'s per-paper takeaways (it needs `CONSENSUS_API_KEY`).',
  },
  {
    target: 'guide:reading-papers',
    why: 'the agent-browser skill is not shipped',
    find: /open it with `agent-browser` only if the user asks/,
    to: 'open it in a browser tool only if the user asks',
  },
  {
    target: 'guide:identity-and-audits',
    why: 'the agent-browser skill is not shipped',
    find: /open the forum with `agent-browser`/,
    to: 'open the forum in a browser tool',
  },
  {
    target: 'skill:co-scientist-tournament/references/briefs.md',
    why: 'consensus_search is not served',
    find: /`consensus_search` \/ `s2_search` for claim support/,
    to: '`literature_search` / `s2_search` for claim support',
  },
  {
    target: 'agent:paper-agent-builder',
    why: 'paper_mcp is not served: Claude Code adds MCP servers itself, with its own approval',
    find: /Connect a generated server with `paper_mcp` only when asked\./,
    to: 'Do not connect a generated server yourself; tell the user how (`claude mcp add`, or an entry in `.mcp.json`) when they ask.',
  },
  // ---- DSH's sandbox and tool names ----
  { target: 'agent:*', why: 'DSH\'s sandbox is the project here', find: /\bthe sandbox (?:uv |Python )?environment\b/g, to: 'the project\'s Python environment', optional: true },
  { target: 'agent:*', why: 'DSH\'s sandbox is the project here', find: /\bsandbox Python environment\b/g, to: 'project Python environment', optional: true },
  { target: 'agent:*', why: 'DSH\'s sandbox is the project here', find: /\bin the sandbox\b/g, to: 'locally', optional: true },
  { target: 'agent:*', why: 'DSH\'s sandbox is the project here', find: /\bthe sandbox working directory\b/g, to: 'the working directory', optional: true },
  { target: '*', why: 'Claude Code\'s question tool', find: /\bask_user_question\b/g, to: 'AskUserQuestion', optional: true },
]

/** The rules that apply to `target`: its own, and the ones written for every target of its kind (`agent:*`) or for all (`*`). */
function rulesFor(target) {
  const kind = target.split(':')[0]
  return RULES.filter(r => r.target === target || r.target === `${kind}:*` || r.target === '*')
}

/** Apply them. A rule that is not optional and finds nothing throws, naming the target. */
export function adapt(target, text) {
  let out = String(text)
  for (const rule of rulesFor(target)) {
    const probe = new RegExp(rule.find.source, rule.find.flags.replace('g', ''))
    if (!probe.test(out)) {
      if (rule.optional) continue
      throw new Error(`adapt: ${target}: the text this rule rewrites is gone (${rule.why}). Upstream changed it: review the rule in scripts/adapt.mjs.`)
    }
    out = out.replace(rule.find, rule.to)
  }
  return out
}

/** Every target a non-optional rule names, for a test that checks each one is built. */
export const TARGETS = [...new Set(RULES.filter(r => !r.optional).map(r => r.target))]
