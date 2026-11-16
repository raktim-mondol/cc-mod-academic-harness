# Fit review: what Claude Code already does, and what is worth keeping

After P5 every tool, skill, agent and line of guidance was asked one question: in Claude Code, is this useful, or does Claude Code (or a connector the person already has) already do it? Academic Harness was written for DeepSeek Harness (DSH), which has no web search provider, no skill loader the model trusts, no MCP management, a chat box with task chips and result cards, and a sandbox. Claude Code has most of those. 2026-11-16, Claude Code 2.1.325, upstream `a3f17eb`.

The decisions are in one file, `server/src/fit.mjs` (what is left out, with a reason each), and the rewrites of upstream's text are in `scripts/adapt.mjs` (each fails the build if the text it rewrites changes upstream). Nothing was deleted from the snapshot: a left-out skill is still bundled, and a left-out tool comes back by name.

## Result

| | Before | After |
|---|---|---|
| Tools served (`ah` server) | 138 (134 of upstream's 136, plus 4 job tools) | 125 (121 of 136, plus 4) |
| Tool descriptions and schemas, characters | 292,000 | 269,000 (deferred behind `ToolSearch`, so little of this is in context at once) |
| Skills in the always-loaded list | 86 (30,118 characters of descriptions) | 54 (20,314), plus `research-guides` |
| Agents | 22 | 21 |
| Research-mode text added to the system prompt | about 4,700 tokens | about 2,900 tokens, including the index of 27 guides |
| Settings fields | 57 | 53 plus `restore_tools` |

The skill list is the part that costs context every turn, so it is where the cut matters: about 10,000 characters (2,500 tokens) less, and the research-mode text another 1,800 tokens.

## Tools left out (13)

| Tool | Why |
|---|---|
| `brave_search`, `tavily_search`, `exa_search`, `perplexity_search`, `parallel_search` | General web search behind a paid key. Claude Code has `WebSearch`; Exa, Parallel, Tavily and Firecrawl also publish MCP servers. `parallel` stays a keyed *source* inside `literature_search` |
| `parallel_extract` | Fetching a page: `WebFetch`, and `jina_read` (kept) for JavaScript pages and PDFs |
| `consensus_search`, `elicit_search` | Vendor search APIs that need a key. `literature_search` keeps `consensus` as a keyed source; Elicit and Consensus publish their own MCP servers |
| `scientific_result` | Draws a result card in DSH's chat. Here the answer is the reply |
| `fold_text` | The person folds with `/fold`; a model has no use for folding text it can summarise |
| `research_template` | A catalogue of one-click prompts for DSH's chat boxes. Skills and the task commands do that job |
| `paper_mcp` | Mounts generated MCP servers mid-session (with `mounts.mjs`, an MCP client of its own, and an elicitation form). Claude Code adds servers itself (`claude mcp add`, `.mcp.json`) with its own approval, so the machinery went too (138 lines, plus a 164-line test) |
| `latex_compile` | A `latexmk` wrapper: Bash does it, and `ah_build` covers Academic Harness projects |

The keys only these read (`BRAVE_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY`, `PERPLEXITY_API_KEY`, `ELICIT_API_KEY`) are no longer offered as settings.

**Bring one back:** the `restore_tools` setting, or `AH_RESTORE_TOOLS=brave_search,latex_compile` in the shell (both count). The tool's key is then read from its environment variable. `paper_mcp` cannot come back; its machinery is gone.

## Tools considered and kept

| Tool or group | Why it stays |
|---|---|
| `literature_search`, `openalex_search`, `s2_search`, `pubmed_search`, `arxiv_search`, `crossref_lookup`, `domain_search`, `journal_search`, `core_search` | Scholarly APIs with DOIs, citation counts and merge and rank. Not what `WebSearch` returns. Mostly keyless |
| `jina_read` | Keyless, and reads what `WebFetch` cannot: JavaScript pages and PDFs |
| `pdf_to_markdown`, `paper_fold`, `paper_context`, `paper_download` | `Read` opens a PDF page by page and costs tokens; these give a whole paper as compact Markdown, or the section map, and feed PaperMemory |
| `notebook` | No Claude Code equivalent; the session's research record, shown in the pane |
| `skill_search`, `skill_load` | The only way to reach the 700 bundled skills that are not listed |
| `reference_library` and PaperMemory's 14 tools | Different jobs: a BibTeX and RIS manager against a memory of papers, claims and quotes |
| The 38 `ah_*` tools | The writing engine; the guard and approvals sit on them |
| Ledgers (`review`, `meta_analysis`, `coscientist*`, `analysis_run`, `experiment_log`, `ablation`, `preregister`, `rebuttal`, `submission_pack` ...) | Frozen plans, immutable run manifests and audit trails Claude Code does not have. `coscientist_rank` and `coscientist_verify` stay separate tools: merging them would fork upstream's code for no gain |
| `deep_research`, `deep_review`, job tools | The long investigations, run as background jobs |
| `modal_run`, `runpod_run`, `vastai_run` | Rented hardware, with the cost ceiling, the session cap and an approval every time |
| `image_generate`, `mermaid_render`, `data` toolkits, `clinicaltrials`, `openfda`, `patent_search`, `science_source` | Capabilities Claude Code lacks. They sit behind `ToolSearch`, so unused ones cost nothing per turn |
| `literature_watch` | Saved searches with de-duplication. It could be scheduled with `/loop`; left as is |

## Skills and agents

**Not built (15 skills).** `docx`, `pdf`, `pptx`, `xlsx` (Anthropic ships these), `agent-browser` (a browser tool of its own, not academic), `using-science-superpowers` (teaches DSH's "invoke the Skill tool first" mechanism), `modal`, `runpod`, `vastai` (provider documentation; the tools carry what they need), and six skills that were the *same brief* as an agent already built: `abstract-writer`, `citation-checker`, `literature-researcher`, `manuscript-editor`, `peer-reviewer`, `statistical-reviewer`. The agent keeps each, in its own context.

**On demand (17 skills).** Left out of the list, still bundled, found with `skill_search` and read with `skill_load`: `openfda`, `clinicaltrials`, `gget`, `scanpy`, `pytorch-lightning`, `hyperparameter-optimization`, `drawio-reconstruction`, `diagram-design`, `markdown-mermaid-writing`, `scientific-visualization`, `benchmark-paper-template`, `tech-paper-template`, `vibe-research-workflow`, `agentic-data-science-pipeline`, `paper2agent`, `paper2skill`, `paper2mcp`. A library the model already knows, a niche workflow, or a skill whose tool describes itself.

**Agent not built (1).** `pipeline-engineer`: ordinary coding, which Claude Code's own agent does. The other 21 are reviewers, checkers and researchers whose value is a separate context.

## Rewritten for Claude Code

- **The research-mode text** is written for Claude Code (`scripts/research-mode.md`) instead of upstream's prompt with a translation layer on top: the tool names are the real ones, `literature_search` comes before `WebSearch`, paid compute and the guard are stated once, DSH's "always `uv run`" rule and the result-card and template sections are gone, and PaperMemory's long section is eight rules plus a pointer to its skill. Upstream's text for those sections is still tracked: the build says when it changes (`scripts/prompt-reviewed.json`, `--accept-upstream`).
- **The 27 guides** are upstream's text with the wrong passages rewritten (`scripts/adapt.mjs`): the whole web-tool block of `literature-and-the-web` (it told the model not to use `web_search` and to use Parallel and Firecrawl), `latex`, and several one-line mentions. The `workspace-search` guide is not built until `zvec_index` is (P6), and `workflow-templates` went with `research_template`.
- **Agent briefs.** `literature-researcher` no longer forbids `WebSearch` and `WebFetch` (DSH had no provider; Claude Code does) or asks for Parallel and Firecrawl. `paper-agent-builder` tells the user how to connect a generated server instead of calling `paper_mcp`. "The sandbox Python environment" is "the project's Python environment" in eight briefs.
- **Tool descriptions and results** go through four more wording rules in `server/src/render.mjs` (a description that sent the model to `consensus_search`, `web_fetch`, `scientific_result` or the `agent-browser` skill). The surface check compares after the rules.
- `AskUserQuestion` replaces `ask_user_question` in every built skill, guide and brief.

## Checked

| Check | Result |
|---|---|
| `node --test` (scripts and server) | 194 pass; 17 new in `fit.test.mjs`: every left-out module is a real upstream module and classed as dropped, the plan loads none of them and loads a restored one, the host serves a restored tool and not a dropped one (by the shell variable and by the setting), no left-out skill or agent is built, the on-demand ones are still bundled, every rewrite has its target built, a rule whose text is gone throws, no built skill, guide or brief names a tool that is not served, the catalogue stays under 22,000 characters of descriptions |
| Surface parity (`measure-surface.mjs`) | ok: 136 registered, 121 served, 13 dropped, 2 later (`zvec_index`, `ah_rsi`) |
| `claude plugin test .`, `validate`, `tsc` | 68 pass; pass; pass |
| Live (`tests/live/fit.mjs`) | `catalogue`: 55 skills, 21 agents, 125 `ah` tools, none of the 13, ten of the dropped skills absent, `literature_search` present. `restore`: `AH_RESTORE_TOOLS=brave_search,paper_mcp,nonsense` serves `brave_search` and nothing else. `search_route`: asked for papers, Haiku called `literature_search` and no `WebSearch` (the new text works). `on_demand`: `skill_search` found `openfda`, `skill_load` read it |

## Not decided here

- **Merging `coscientist`, `coscientist_rank` and `coscientist_verify`.** They are three tools because of DSH's schema limits. Merging means editing upstream's modules, which breaks "loaded unchanged".
- **`literature_watch` on `/loop`.** A watch could run on a schedule instead of by hand. Worth doing once someone uses watches.
- **`zvec_index` and `ah_rsi`** stay in P6.
