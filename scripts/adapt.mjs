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
    why: 'name the shipped agent-browser skill and the other browsers Claude Code can have',
    find: /When a task needs a real rendered browser rather than a text fetch[\s\S]*?report that limitation instead of guessing\./,
    to: 'When a task needs a real rendered browser rather than a text fetch (logging in, filling a form, clicking through to a dataset download, checking that a page renders), load the skill `academic-harness:agent-browser` (the `agent-browser` CLI), or use a browser tool this session has: Claude Code\'s built-in browser or Claude in Chrome. For a chart or a layout, `Read` the screenshot file. If none of these is available, say so instead of guessing.',
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
  {
    target: 'skill:research-monitoring/SKILL.md',
    why: 'Claude Code has a scheduler (/loop) and the mod has /ah-watch, so "you run a watch" can be made regular',
    find: /timer: you run a watch, then read the digest\./,
    to: 'timer: you run a watch, then read the digest. In Claude Code `/ah-watch` does both in one line (it runs the watches that are due and prints what is new), and `/loop 1d /ah-watch` makes it daily while the session is open.',
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
    why: 'the agent-browser skill is shipped as academic-harness:agent-browser',
    find: /open it with `agent-browser` only if the user asks/,
    to: 'open it with the `academic-harness:agent-browser` skill only if the user asks',
  },
  {
    target: 'guide:identity-and-audits',
    why: 'the agent-browser skill is shipped as academic-harness:agent-browser',
    find: /open the forum with `agent-browser`/,
    to: 'open the forum with the `academic-harness:agent-browser` skill',
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
  // ---- the skills that came back (agent-browser, modal, runpod, vastai, using-science-superpowers) ----
  {
    target: 'skill:agent-browser/SKILL.md',
    why: 'DSH\'s web tool names, and its image reader',
    find: /`web_search`\/`web_fetch` and `mcp__firecrawl__\*` cover plain pages and search/,
    to: '`web_search` and `web_extract` (or `WebSearch` and `WebFetch`) and a Firecrawl connector cover plain pages and search',
  },
  { target: 'skill:agent-browser/SKILL.md', why: 'DSH\'s web tool names', find: /when web_search\/web_fetch can't reach/g, to: 'when web_search and web_extract (or WebSearch and WebFetch) cannot reach', optional: true },
  { target: 'skill:agent-browser/SKILL.md', why: 'Claude Code reads an image with Read (the description)', find: /Inspect screenshots with read_image on an image-capable model/, to: 'Inspect screenshots with Read on an image-capable model' },
  { target: 'skill:agent-browser/SKILL.md', why: 'Claude Code reads an image with Read', find: /with `read_image` on an image-capable session model\. The host checks whether the active route supports images\./, to: 'with `Read` on the image file; the session model must accept images.' },
  {
    target: 'skill:modal/SKILL.md',
    why: 'the other host\'s SDK install path (`dsh plugin ... add modal`, a profile, pnpm build policy)',
    find: /- `modal_run` loads the `modal` npm SDK from the profile when present\.[\s\S]*?- A failed managed install surfaces as/,
    to: '- `modal_run` fetches its SDK into the plugin\'s home on first use and loads it at once; there is nothing to add to a profile and no restart.\n- `ACADEMIC_HARNESS_MODAL_SKIP_INSTALL=1` disables that managed install; then install the `modal` npm SDK yourself.\n- A failed managed install surfaces as',
  },
  { target: 'skill:modal/SKILL.md', why: 'the other host\'s tool names', find: /via the `bash` tool and/g, to: 'through Bash and', optional: true },
  { target: 'skill:runpod/SKILL.md', why: 'the other host\'s tool names', find: /via the `bash` tool and/g, to: 'through Bash and', optional: true },
  { target: 'skill:vastai/SKILL.md', why: 'the other host\'s tool names', find: /via the `bash` tool and/g, to: 'through Bash and', optional: true },
  { target: 'skill:runpod/SKILL.md', why: 'the other host\'s tool names', find: /`runpodctl` via `bash`/g, to: '`runpodctl` through Bash', optional: true },
  { target: 'skill:vastai/SKILL.md', why: 'the other host\'s tool names', find: /`vastai` CLI via `bash`/g, to: '`vastai` CLI through Bash', optional: true },
  {
    target: 'skill:using-science-superpowers/SKILL.md',
    why: 'the description told the model to load a skill before every response; it should load the one that fits the task, when there is one',
    find: /^description: .*$/m,
    to: 'description: "Use when a research task begins (an analysis, a paper, a review, a literature search, a result that looks wrong) to find the skill that fits it and load it before acting. Not for greetings, one-line factual questions or edits the person fully specified."',
  },
  {
    target: 'skill:using-science-superpowers/SKILL.md',
    why: 'the absolute rule (a skill before ANY response, even at 1%) replaced by a need-based one',
    find: /<EXTREMELY-IMPORTANT>[\s\S]*?<\/EXTREMELY-IMPORTANT>/,
    to: 'When a task matches a skill\'s description, load that skill with the `Skill` tool before you act on the task, without waiting to be asked: the person will not name skills. If nothing matches, or the message is a greeting, a one-line factual question or a small edit that is fully specified, answer it directly. Do not load a skill "to be safe".',
  },
  {
    target: 'skill:using-science-superpowers/SKILL.md',
    why: 'the rule restated without "any response" and "1%"',
    find: /\*\*Invoke relevant or requested skills BEFORE any response or action\.\*\* Even a 1% chance a skill might apply means that you should invoke the skill to check\. If an invoked skill turns out to be wrong for the situation, you don't need to use it\./,
    to: '**Load the skill that fits the task before you act on it.** Decide from the skill descriptions you can see; if one clearly covers what you are about to do, load it. If a loaded skill turns out to be wrong for the situation, drop it.',
  },
  {
    target: 'skill:using-science-superpowers/SKILL.md',
    why: 'the diagram edge "yes, even 1%"',
    find: /\[label="yes, even 1%"\]/g,
    to: '[label="yes, it matches"]',
  },
  {
    target: 'skill:using-science-superpowers/SKILL.md',
    why: 'the red-flag table argued for a skill on every thought; keep the research ones that matter',
    find: /## Red Flags[\s\S]*?(?=## Skill Priority)/,
    to: `## Red Flags

These thoughts, on a research task a skill covers, mean stop and load it:

| Thought | Reality |
|---------|---------|
| "This is just a quick data peek" | A peek can poison a confirmatory analysis. Load the skill that says when looking is safe. |
| "I'll frame the question after I explore" | Framing comes before exploration. |
| "Let me just run the analysis" | The skill says how to run it honestly. |
| "The skill is overkill" | Simple analyses become p-hacked papers. |
| "I remember this skill" | Skills evolve. Read the current version. |

A greeting, a one-line factual answer or a fully specified small edit is not a research task: no skill is needed.

`,
  },
  // ---- the other host's name, and what it did that the plugin does now ----
  { target: '*', why: 'names the other host', find: /Academic Harness on DeepSeek Harness\. Native `ah_\*` tools\. Pi is not required\./g, to: 'Native `ah_*` tools.', optional: true },
  { target: '*', why: 'names the other host', find: /DeepSeek Harness is the chat\. Pi is not required\./g, to: 'Claude Code is the chat.', optional: true },
  { target: '*', why: 'names the other host', find: /Academic Harness on DeepSeek Harness/g, to: 'Academic Harness', optional: true },
  { target: '*', why: 'names the other host', find: /## What DSH already does in this session/g, to: '## What the plugin already does in this session', optional: true },
  { target: '*', why: 'names the other host', find: /\(DSH will ask them to confirm\)/g, to: '(Claude Code will ask them to confirm)', optional: true },
  { target: '*', why: 'names the other host', find: /; DSH confirms\)/g, to: '; Claude Code confirms)', optional: true },
  { target: '*', why: 'the ah_* tools are MCP tools here, and there is no Pi', find: /Native `ah_\*` tools \(not MCP, not Pi\)\./g, to: 'The `ah_*` tools are served by this plugin\'s MCP server.', optional: true },
  { target: '*', why: 'there is no Pi', find: /Use native `ah_\*` tools\. Do not require Pi\. /g, to: 'Use the `ah_*` tools. ', optional: true },
  { target: '*', why: 'names the other host', find: /and do not install it into DSH;/g, to: 'and do not install it separately;', optional: true },
  {
    target: 'guide:remote-compute',
    why: 'the Modal SDK install path of the other host (`dsh plugin ... add modal`, a profile, a pnpm workaround)',
    find: /`modal_run` fetches its SDK into `\$DSH_HOME\/modal-sdk` on first use \(no restart\)[\s\S]*?before editing profile config\./,
    to: '`modal_run` fetches its SDK into the plugin\'s home on first use (no restart). If it returns `sdk_missing` or `sdk_install_failed`, use `runpod_run` or `vastai_run`, or ask the user to install the Modal SDK themselves.',
  },
  {
    target: 'guide:reading-papers',
    why: 'names the other host\'s model',
    find: /never assume DSH's model is available to it/,
    to: 'never assume the session\'s model is available to it',
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
