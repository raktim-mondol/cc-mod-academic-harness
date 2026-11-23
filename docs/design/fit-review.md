# What is left out, and why

Every tool, skill, agent and line of guidance in the plugin was asked one question: in Claude Code, is this useful, or does Claude Code (or a connector the person already has) already do it? Claude Code has web search and fetch, a skill loader, MCP management, subagents and a task list; a chat box of another kind has result cards, one-click prompts and a sandbox. What Claude Code already does is left out, and what only suits another kind of chat box is rewritten or dropped. 2026-11-16, Claude Code 2.1.325.

The decisions are in one file, `server/src/fit.mjs` (what is left out, with a reason each), and the rewrites of the engine code's text are in `scripts/adapt.mjs` (each fails the build if the text it rewrites changes). Nothing is deleted from the engine code: a left-out skill is still bundled, and a left-out tool comes back by name.

## What it came to

| | Count | Notes |
|---|---|---|
| Research tools in the engine code | 136 | 124 served, 12 left out on purpose |
| Tools served by the `ah` server | 129 | The 124, four `job_*` tools and `doctor`; 269,000 characters of descriptions and schemas, deferred behind `ToolSearch`, so little is in context at once |
| Skills in the always-loaded list | 59 (21,186 characters of descriptions), plus `research-guides` | The part that costs context every turn |
| Agents | 21 | |
| Research-mode text in the system prompt | about 2,900 tokens | Includes the index of 27 guides |
| Settings fields | 53, plus `restore_tools` | |

## Tools left out (12)

| Tool | Why |
|---|---|
| `brave_search`, `tavily_search`, `exa_search`, `perplexity_search`, `parallel_search` | General web search behind a paid key. Claude Code has `WebSearch`; Exa, Parallel, Tavily and Firecrawl also publish MCP servers. `parallel` stays a keyed *source* inside `literature_search` |
| `parallel_extract` | Fetching a page: `WebFetch`, and `jina_read` (kept) for JavaScript pages and PDFs |
| `consensus_search`, `elicit_search` | Vendor search APIs that need a key. `literature_search` keeps `consensus` as a keyed source; Elicit and Consensus publish their own MCP servers |
| `scientific_result` | Draws a result card in a chat box. Here the answer is the reply |
| `fold_text` | The person folds with `/fold`; a model has no use for folding text it can summarise |
| `research_template` | A catalogue of one-click prompts for a chat box. Skills and the task commands do that job |
| `latex_compile` | A `latexmk` wrapper: Bash does it, and `ah_build` covers Academic Harness projects |

The keys only these read (`BRAVE_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY`, `PERPLEXITY_API_KEY`, `ELICIT_API_KEY`) are not offered as settings.

**Search providers are no longer all left out.** Eight of the tools above (`brave_search`, `tavily_search`, `exa_search`, `perplexity_search`, `parallel_search`, `parallel_extract`, `consensus_search`, `elicit_search`) are served as soon as their key is set, because separate indexes find different things; the guide `search-providers` gives each one a job so they do not repeat each other. See `autoProviders` in `server/src/fit.mjs`.

**Bring one back:** the `restore_tools` setting, or `AH_RESTORE_TOOLS=brave_search,latex_compile` in the shell (both count). The tool's key is then read from its environment variable. 

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
| Ledgers (`review`, `meta_analysis`, `coscientist*`, `analysis_run`, `experiment_log`, `ablation`, `preregister`, `rebuttal`, `submission_pack` ...) | Frozen plans, immutable run manifests and audit trails Claude Code does not have. `coscientist_rank` and `coscientist_verify` stay separate tools: merging them would mean editing the module for no gain |
| `deep_research`, `deep_review`, job tools | The long investigations, run as background jobs |
| `modal_run`, `runpod_run`, `vastai_run` | Rented hardware, with the cost ceiling, the session cap and an approval every time |
| `image_generate`, `mermaid_render`, `data` toolkits, `clinicaltrials`, `openfda`, `patent_search`, `science_source` | Capabilities Claude Code lacks. They sit behind `ToolSearch`, so unused ones cost nothing per turn |
| `literature_watch` | Saved searches with de-duplication; `/ah-watch` runs them and `/loop` schedules that |

## Brought back

Three tools and five skills were left out in the first review and are served again, because the person asked for them.

| What | How it works here |
|---|---|
| `zvec_index` | Served as it was: it drives the `zg` CLI you already have (it never installs one, so no package is fetched behind your back) and asks before it indexes. It sits beside zvec-grep's own `zvec_grep_index`; use either. `ZVEC_GREP_CLI` and `ZVEC_GREP_EMBEDDING` are read from the environment. |
| `paper_mcp` | The same four actions (`status`, `register`, `approve`, `unregister`) and the same registry (`<project>/.dsh/paper-mcps.json`), but "mount" is now "write the server into the project's `.mcp.json`" (`server/src/mcpjson.mjs`): Claude Code has no call to start a server mid-session. `register` and `approve` ask you first (a `tool.check` in `hooks/approvals.ts` that shows the program, its folder and the variables; refused where nobody can answer, such as `claude -p`), then Claude Code asks again before it starts the server and you reload with `/mcp`. Only variable *names* are written (`${NAME}`), never values. A registry that came with a cloned folder writes nothing by itself. |
| `ah_rsi` and its loop | The tool shows and steers the lessons. The loop itself (capture a turn, learn lessons, add them to later prompts) was DSH's host events; here it runs from the guard bridge (`server/src/rsi-bridge.mjs`, `server/bin/ah-hook.mjs`), one hook event at a time with the open turn kept in a file under a lock, fed by two hooks (`hooks/rsi.ts`: `PostToolBatch` for a step's calls, `PostToolUseFailure` for a failed call, so a step costs one process and the loop sees failures). **It is off by default**, runs only in a folder with an `ah.yaml` and with a person at the prompt (never headless), is switched by the `rsi_mode` setting or `AH_RSI`, and keeps its store bounded (`server/src/rsi-retention.mjs`). |
| `agent-browser`, `modal`, `runpod`, `vastai`, `using-science-superpowers` | Built into `skills/` with their host wording rewritten (`scripts/adapt.mjs`). `using-science-superpowers` is rewritten to be need-based: load the skill that fits the task, without being asked, and none for a greeting or a one-line answer (upstream said a skill before every response, even at 1%). |

## Skills and agents

**Not built (10 skills).** `docx`, `pdf`, `pptx`, `xlsx` (Anthropic ships these), and six skills that were the *same brief* as an agent already built: `abstract-writer`, `citation-checker`, `literature-researcher`, `manuscript-editor`, `peer-reviewer`, `statistical-reviewer`. The agent keeps each, in its own context.

**On demand (17 skills).** Left out of the list, still bundled, found with `skill_search` and read with `skill_load`: `openfda`, `clinicaltrials`, `gget`, `scanpy`, `pytorch-lightning`, `hyperparameter-optimization`, `drawio-reconstruction`, `diagram-design`, `markdown-mermaid-writing`, `scientific-visualization`, `benchmark-paper-template`, `tech-paper-template`, `vibe-research-workflow`, `agentic-data-science-pipeline`, `paper2agent`, `paper2skill`, `paper2mcp`. A library the model already knows, a niche workflow, or a skill whose tool describes itself.

**Agent not built (1).** `pipeline-engineer`: ordinary coding, which Claude Code's own agent does. The other 21 are reviewers, checkers and researchers whose value is a separate context.

## Written for Claude Code

- **The research-mode text** (`scripts/research-mode.md`) names the real tools, puts `literature_search` before `WebSearch`, states paid compute and the guard once, drops any rule about how to run Python beyond "use the project's environment", and reduces PaperMemory to eight rules plus a pointer to its skill. The sections of the engine code's own prompt it was written from are tracked: the build says when one changes (`scripts/prompt-reviewed.json`, `--accept-upstream`).
- **The 27 guides** are the engine code's text with the wrong passages rewritten (`scripts/adapt.mjs`): the whole web-tool block of `literature-and-the-web` (it told the model not to use a web search and to use Parallel and Firecrawl), `latex`, the Modal SDK note, and several one-line mentions. The `workspace-search` guide is not built, and `workflow-templates` went with `research_template`.
- **Agent briefs.** `literature-researcher` no longer forbids `WebSearch` and `WebFetch` or asks for Parallel and Firecrawl. `paper-agent-builder` tells the user how to connect a generated server instead of calling `paper_mcp`. "The sandbox Python environment" is "the project's Python environment" in eight briefs.
- **Tool descriptions and results** go through wording rules in `server/src/render.mjs` (a description that sent the model to `consensus_search`, `web_fetch`, `scientific_result` or the `agent-browser` skill). The surface check compares after the rules.
- **Names.** `AskUserQuestion` replaces `ask_user_question` in every built skill, guide and brief; text that named the engine code's original chat host now says Claude Code or says nothing.

## Checked

| Check | Result |
|---|---|
| `tests/scripts/fit.test.mjs` | Every left-out module is a real module of the engine code and classed as dropped; the plan loads none of them and loads a restored one; the server serves a restored tool and not a dropped one (by the shell variable and by the setting); no left-out skill or agent is built and the on-demand ones are still bundled; every rewrite has its target built and a rule whose text is gone throws; no built skill, guide or brief names a tool that is not served or the other chat host; the catalogue stays under 22,000 characters of descriptions |
| Surface parity (`measure-surface.mjs`) | 136 registered, 124 served, 12 left out |
| `claude plugin test .`, `validate`, `tsc` | Pass |
| Live (`tests/live/fit.mjs`) | `catalogue`: 60 skills, 21 agents, 129 `ah` tools, none of the 12 left out; `restore`: the setting serves exactly the named tool; `search_route`: asked for papers, the model calls `literature_search` and not `WebSearch`; `on_demand`: `skill_search` finds `openfda` and `skill_load` reads it |

## The next review

`/academic usage` lists, from counts kept on this machine (names and numbers only), which tools, skills, agents and commands were used and which never were. A name that was never used over a few weeks of real work is a candidate for the left-out lists or for on demand; one that is used a lot and sits on a list is a candidate to bring back. It is evidence for a decision, not the decision: some tools are for rare jobs.

## Decided, not built

- **An `academic-harness:pro` agent and a vision agent.** A Claude Code agent takes a `model` of its own, and the session model reads images with `Read`.
- **An esbuild bundle of the server.** The server answers `initialize` at once and lists its tools in under a second after start; a bundle would have to follow dynamic imports of 100 modules and native dependencies to save nothing a person can feel.
- **Merging `coscientist`, `coscientist_rank` and `coscientist_verify`.** They split the tournament's actions by half; the descriptions say which half is which.
