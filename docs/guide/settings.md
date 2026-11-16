# Settings, keys and switches

Set the settings where Claude Code configures plugin options (they are the plugin's `userConfig`), or under `pluginConfigs` in a settings file. A variable exported in the shell wins over a saved key: a key reaches the server as `AH_KEY_<NAME>` and is copied to `<NAME>` only when the shell has not set `<NAME>`.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `research_mode` | `auto` | `auto`, `on` or `off`. `/academic on\|off\|auto` overrides it for a session |
| `tool_areas` | `all` | Which tool groups load; see [Tools](tools-skills-agents.md) for the names |
| `restore_tools` | empty | Tools the plugin leaves out, to bring back by name. The shell variable `AH_RESTORE_TOOLS` does the same. A restored tool reads its key from its environment variable. `paper_mcp`, `zvec_index` and `ah_rsi` cannot come back: their machinery is gone |
| `llm_model` | `sonnet` | The model of the tools that call a model (the alias or id passed to `--model`) |
| `llm_budget_usd` | `5` | The most the model route spends in one server run; one call is also capped at 1 USD |
| `job_notices` | `prompt` | When a background job ends: `prompt` notifies you and prompts the model to read the result, `notify` only notifies, `off` neither (`job_status` and `job_wait` still work). Interactive sessions only |
| `evidence_check` | `skip` | `run` makes the stop gate, in an `ah.yaml` project, check with a model the sources the turn's paragraphs cite (one call per paragraph, advisory) |
| `compute_session_cap_usd` | empty | Cap on rented compute in one session |
| `image_model`, `deep_review_*`, `co_scientist_*`, `rebuttal_max_tasks` | empty | Tool tuning, passed on to the tool that reads it |

## Keys

About 30 optional key and address fields, all sensitive ones stored in Claude Code's secure store. None is needed to start. Worth setting first:

| Field | Why |
|---|---|
| `S2_API_KEY` | A dedicated Semantic Scholar rate limit; without it the shared keyless pool is often throttled (`429`) |
| `UNPAYWALL_EMAIL` | Open-access PDFs for `paper_download` (an address, not a secret) |
| `CROSSREF_MAILTO` | Crossref's faster, steadier pool (an address) |

The others unlock one source or tool each: Consensus, Scite and Firecrawl as sources of `literature_search`, Parallel, TypeSafe (routing and reranking), Gemini (`image_generate`), the rented-compute providers, FutureHouse, and so on. `/academic doctor` lists which names are set, never the values.

## Environment switches

| Variable | Effect |
|---|---|
| `AH_MOD_HOME` | The mod's home (default `~/.local/share/cc-mod-academic-harness/home`). Never `~/.dsh` |
| `AH_AUTO_INSTALL=0` | Do not build the writing engine in the background |
| `AH_MANAGED_INSTALLS=0` | Do not install TextFold or the Modal SDK |
| `AH_BOOTSTRAP=0` | Do not fetch the source snapshot on first start; the server exits and says what to run |
| `AH_JOB_FOREGROUND_MS` | How long a long tool holds the call before going on as a job. A headless `claude -p "/ah-research ..."` ends the session when the command returns, so set it high there |
| `AH_LLM_MODEL`, `AH_LLM_BUDGET_USD` | The model route, from the shell |
| `AH_SOURCE` | A local Academic Harness checkout that `setup` and `update-upstream` read before going to GitHub (default `~/academic-harness`) |
| `AH_UPSTREAM` | Development mode: run from a checkout of the engine code, read-only, with every installer off |
| `AH_KEYS_REPORT=<file>` | Diagnostic: write the name, length and a short hash of each key the server received. Never a value |

Next: [State and privacy](state-and-privacy.md).
