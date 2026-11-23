# Tools, skills and agents

## Tools

The `ah` MCP server serves 124 research tools plus its own `job_status`, `job_wait`, `job_log`, `job_kill` and `doctor` (129 in all); with a search provider's key set it serves up to 10 more ([search providers](#search-providers-and-the-web-tools)). They are named `mcp__plugin_academic-harness_ah__<tool>` and are deferred: Claude finds one with `ToolSearch` before its first use. The `tool_areas` setting trims the set; the number is the tools in each area.

| Area | Tools | What they are for |
|---|---|---|
| `search` | 12 | `literature_search` (the one-shot entry: OpenAlex and Semantic Scholar, plus PubMed, arXiv and others by topic, merged and ranked), `openalex_search`, `s2_search`, `pubmed_search`, `arxiv_search`, `crossref_lookup`, `journal_search`, `domain_search`, `core_search`, `database_catalog`, `jina_read`, `zvec_index` (builds the index for zvec-grep's semantic search; asks before it indexes) |
| `papers` | 10 | `paper_resolve`, `paper_get`, `paper_context`, `paper_download`, `pdf_to_markdown`, `openalex_citations`, `integrity_check`, `citation`, `manuscript_citations`, `reference_library` |
| `notebook` | 1 | `notebook`, the living lab notebook |
| `skills` | 2 | `skill_search`, `skill_load`: the way to the 700 bundled skills that are not listed |
| `writing` | 39 | The `ah_*` tools of the writing engine, for projects with an `ah.yaml`; the guard sits on them; and `ah_rsi`, which shows and steers the lessons the self-improvement loop has learned |
| `reviews` | 2 | `review` (systematic and scoping reviews), `meta_analysis` |
| `tournament` | 3 | `coscientist`, `coscientist_rank`, `coscientist_verify`: hypothesis tournaments |
| `analysis` | 8 | `analysis_run`, `experiment_log`, `ablation`, `data_profile`, `stat_audit`, `power_analysis`, `causal_dag`, `reporting_check` |
| `provenance` | 6 | `provenance_audit`, `authorship`, `repro_package`, `numbers_audit`, `repo_audit`, `figure_audit` |
| `study` | 9 | `preregister`, `design`, `ethics_protocol`, `deidentify`, `dmp`, `grant_budget`, `grant_search`, `funder_policy`, `journal_policy` |
| `data` | 17 | Datasets and science toolkits (`dataset_get`, `science_source`, `chem_toolkit`, `seq_toolkit`, ...), registries (`clinicaltrials`, `openfda`, `patent_search`, `openreview`), `literature_watch`, `paper_recommend`, `citation_network`, `futurehouse_agent` |
| `submission` | 7 | `submission_pack`, `manuscript_diff`, `rebuttal`, `presentation_build`, `paper_artifacts`, `paper_fold`, `mermaid_render` |
| `deep` | 2 | `deep_research`, `deep_review`: long, model-calling, run as background jobs |
| `compute` | 3 | `modal_run`, `runpod_run`, `vastai_run`: rented hardware, asks you every time |
| `figures` | 1 | `image_generate` |
| `memory` | 2 | `paper_backfill` (and the consolidation pass that runs shortly after the server starts), and `paper_mcp`, which registers a Paper2MCP server in the project's `.mcp.json` after you confirm |

**Left out on purpose (12):** result cards, reply folding and prompt templates for a chat box, a LaTeX wrapper, and the search providers that are off until their key is set (`web_search` and `web_extract` choose among those that are on). Each has a reason in [the fit review](../design/fit-review.md); the rest come back by name with the `restore_tools` setting ([Settings](settings.md)). `zvec_index`, `paper_mcp` and `ah_rsi` were left out first and are served again ([brought back](../design/fit-review.md#brought-back)).

### Search providers and the web tools

Eight search and fetch tools are served only when their key is set (`brave_search`, `tavily_search`, `exa_search`, `perplexity_search`, `parallel_search`, `parallel_extract`, `consensus_search`, `elicit_search`; [save a key](keys.md)). Each has one job, and the guide `search-providers` says which. When any is on, two more tools exist that choose for you:

- **`web_search`** picks the best provider that is on for the kind of search (`general`, `semantic`, `fresh`, `news`, `excerpts`, or `claim`, which asks two independent indexes and marks what both found), falls to the next when one fails or finds nothing, and says which answered. The listing is fenced as untrusted text.
- **`web_extract`** reads up to 10 URLs with Firecrawl first, then Parallel Extract, then Jina Reader (keyless), and says which read each; a URL none could read is listed and `WebFetch` is the next step.

With no key at all neither tool exists: Claude uses `WebSearch`, `WebFetch` and any search or scrape connector you have signed in to. `/academic doctor` says which providers are on.

### The self-improvement loop and `paper_mcp`

**`ah_rsi`** is the control for a local loop that notes your corrections and what tools returned, learns short lessons, and (in `auto` mode) adds the ones that fit the task to your prompts. It is off by default. You turn it on with the `rsi_mode` setting (`observe` records only, `auto` also adds lessons) or `AH_RSI` (which wins); it then runs only in a folder with an `ah.yaml` and only with a person at the prompt, never in a headless run. `ah_rsi action=forget` retracts a lesson and the doctor shows the mode. Lessons are guidance, never evidence.

**`paper_mcp`** registers a generated Paper2MCP server in the project's `.mcp.json`. It asks you first, showing the program that will run and the variables it names (never their values), and Claude Code asks again before it starts a project server; where nobody can answer (`claude -p`) it is refused.

**Long tools.** `deep_research`, `deep_review` and `analysis_run` answer after about 30 seconds with a job id and go on in the background. `job_status`, `job_wait`, `job_log` and `job_kill` follow them. In an interactive session you are told when one ends and the model reads the result on its own; in a non-interactive run the job ends with the session.

**Paid compute** (`modal_run`, `runpod_run`, `vastai_run`) shows the provider, instance, time limit, cost ceiling and your session budget, and always waits for you. A run that cannot fit under the session cap is refused with the numbers.

**The model route.** Tools that call a model (deep research and review, the tournament, rebuttal checks) run headless Claude Code calls under your login, on `llm_model` and capped by `llm_budget_usd`. They bill your own account.

**PaperMemory** is a second server, `mcp__plugin_academic-harness_papermemory__*`, with 14 tools over the shared library.

## Skills

59 core skills are listed as `academic-harness:<name>` (Claude loads one with `Skill`), plus `academic-harness:research-guides`, which holds 27 longer per-area guides and is read on demand. About 700 more skills are bundled and not listed; `skill_search` finds one and `skill_load` reads it. Seventeen of the core ones (such as `openfda`, `scanpy`, `pytorch-lightning`) are among the on-demand ones, to keep the always-loaded list short; 15 more are not built because Claude Code or Anthropic already ships them (Word, PDF, PowerPoint and Excel files, a browser tool, provider documentation) or because an agent carries the same brief. Skills with non-commercial, GPL or unknown licences are left out of the repository (decision D5).

## Agents

21 specialists, used as the `subagent_type` of `Agent`. They keep a manuscript or a literature out of the main conversation's context.

- **16 cannot edit files.** Reviewers and checkers: `academic-harness:peer-reviewer`, `statistical-reviewer`, `methodology-reviewer`, `citation-checker`, `fact-checker`, `ml-auditor`, `reproducibility-auditor`, `ethics-reviewer`, `simulation-reviewer`, `math-checker`, `code-reviewer`, `data-validator`, `results-interpreter`. Researchers and designers: `literature-researcher`, `hypothesis-generator`, `experiment-designer`.
- **5 can.** Writers and builders: `manuscript-editor`, `abstract-writer`, `protocol-writer`, `data-visualizer`, `paper-agent-builder`.

Next: [Settings](settings.md).
