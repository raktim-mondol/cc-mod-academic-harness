# Settings, keys and switches

Set the settings where Claude Code configures plugin options (they are the plugin's `userConfig`), or under `pluginConfigs` in a settings file. A variable exported in the shell wins over a saved key: a key reaches the server as `AH_KEY_<NAME>` and is copied to `<NAME>` only when the shell has not set `<NAME>`.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `research_mode` | `auto` | `auto`, `on` or `off`. `/academic on\|off\|auto` overrides it for a session |
| `tool_areas` | `all` | Which tool groups load; see [Tools](tools-skills-agents.md) for the names |
| `restore_tools` | empty | Tools the plugin leaves out, to bring back by name. The eight search-provider tools (`brave_search`, `tavily_search`, `exa_search`, `perplexity_search`, `parallel_search`, `parallel_extract`, `consensus_search`, `elicit_search`) need no naming: each is served once its key is set (`AH_AUTO_PROVIDERS=0` turns that off). The shell variable `AH_RESTORE_TOOLS` does the same. A restored tool's key has its own option ([Keys](keys.md)).  |
| `llm_model` | `sonnet` | The model of the tools that call a model (the alias or id passed to `--model`) |
| `llm_budget_usd` | `5` | The most the model route spends in one server run; one call is also capped at 1 USD. Calls that run together reserve their caps, so together they can never be allowed more than is left |
| `job_notices` | `prompt` | When a background job ends: `prompt` notifies you and prompts the model to read the result, `notify` only notifies, `off` neither (`job_status` and `job_wait` still work). Interactive sessions only |
| `evidence_check` | `skip` | `run` makes the stop gate, in an `ah.yaml` project, check with a model the sources the turn's paragraphs cite (one call per paragraph, advisory) |
| `usage_counts` | `on` | `on` keeps a count per tool, skill, agent and command (names and numbers only, never what they were used for) so `/academic usage` can show what is used and what never is; `off` counts nothing. The shell switch `AH_USAGE=0` does the same. See [State and privacy](state-and-privacy.md) |
| `rsi_mode` | `off` | The self-improvement loop. `off` records nothing. `observe` records turns and tool results in folders with an `ah.yaml`, with a person at the prompt, and adds nothing to your prompts. `auto` also adds the lessons that fit the task. The `AH_RSI` variable wins when set, and a value that is not a mode is `off`. `ah_rsi` lists and forgets lessons; the doctor shows the mode |
| `model_router` | `off` | `on` picks the model for each prompt (planning Opus, coding Sonnet, academic writing Haiku, the rest Sonnet). `/model-router on\|off` overrides it for a session. See [the model router](model-router.md) |
| `router_engine` | `auto` | `auto` reads prompts with Jev when a TypeSafe key is saved (the start and end of each prompt go to TypeSafe) and with keyword rules otherwise; `rules` never sends a prompt anywhere |
| `router_plan_model`, `router_code_model`, `router_write_model`, `router_fallback_model` | `opus`, `sonnet`, `haiku`, `sonnet` | The model for planning, coding, academic writing, and everything else: an alias or a full model id |
| `compute_session_cap_usd` | empty | Cap on rented compute in one session |
| `image_model`, `deep_review_*`, `co_scientist_*`, `rebuttal_max_tasks` | empty | Tool tuning, passed on to the tool that reads it |

## Keys

Every key, token and address a tool can use is a plugin option, saved with `claude plugin configure academic-harness@academic-harness-mod` and kept in Claude Code's secure store. None is needed to start. [Keys and credentials](keys.md) has how to save one, where it is stored, and the full list. Worth setting first:

| Field | Why |
|---|---|
| `S2_API_KEY` | A dedicated Semantic Scholar rate limit; without it the shared keyless pool is often throttled (`429`) |
| `UNPAYWALL_EMAIL` | Open-access PDFs for `paper_download` (an address, not a secret) |
| `CROSSREF_MAILTO` | Crossref's faster, steadier pool (an address) |

`/academic doctor` lists which names are set, never the values.

## Environment switches

| Variable | Effect |
|---|---|
| `AH_MOD_HOME` | The mod's home (default `~/.local/share/cc-mod-academic-harness/home`). Never `~/.dsh` |
| `AH_AUTO_INSTALL=0` | Do not build the writing engine in the background |
| `AH_AUTO_PROVIDERS=0` | Do not serve a search provider's tool just because its key is set (name it in `restore_tools` instead) |
| `AH_RSI` | The same as the `rsi_mode` setting, and it wins over it. A headless run is never recorded, whatever it says. `AH_RSI_STORE` moves the loop's store; `AH_RSI_REMOTE=1` lets a model judge lessons |
| `AH_MANAGED_INSTALLS=0` | Do not install TextFold or the Modal SDK |
| `AH_BOOTSTRAP=0` | Do not set up the core on first start (copy it, install its dependencies); the server exits and says what to run |
| `AH_JOB_FOREGROUND_MS` | How long a long tool holds the call before going on as a job. A headless `claude -p "/ah-research ..."` ends the session when the command returns, so set it high there |
| `AH_JOBS_KEEP_DAYS` | How long the record and log of a job that has ended are kept (default 30 days; `0` keeps them all). Old ones are removed when a server starts |
| `AH_TOOL_OUTPUT_KEEP_DAYS` | How long the full text of a clipped tool result stays in `<project>/.dsh/tool-output/` (default 30 days; `0` keeps it all). Older files are removed when a new one is written |
| `AH_SNAPSHOT_KEEP_DAYS` | How long a working copy of the core that an update left in the mod's home is kept after its last use (default 7 days; `0` keeps them all). The one for the installed plugin is never removed. The folder releases before 0.6.0 fetched their snapshot into (`<home>/upstream/`) goes the same way |
| `AH_VALIDATE_TOOL_ARGS` | What the server does with a tool call whose arguments the tool's schema refuses: `enforce` (default) refuses it with an error naming the fields (never the values), and starts no job for it; `warn` runs it anyway, notes it on standard error and counts it as invalid in `/academic usage`; `off` does not check. Either way the refused call is counted as invalid |
| `AH_USAGE=0` | Count no usage, whatever the `usage_counts` setting says |
| `AH_USAGE_KEEP_DAYS` | How long a usage file is kept after it was last written (default 365 days; `0` keeps them all). Removed when a server starts |
| `AH_NO_ENFORCE=1` | Work in an `ah.yaml` project without the guard: edits and shell commands are not checked. Set it in the shell before starting Claude Code. It also holds when the engine cannot run |
| `AH_LLM_MODEL`, `AH_LLM_BUDGET_USD` | The model route, from the shell |
| `AH_EXCLUDE_NONCOMMERCIAL=1` | Leave the six non-commercial (CC BY-NC-SA) skills out of the skill search and refuse to load them; 785 skills are bundled instead of 791. For commercial use ([NOTICE](../../NOTICE)) |
| `AH_CORE` | Development mode: run from a folder of your own that holds the engine code, read-only, with every installer off |
| `AH_S2_MIN_INTERVAL_MS` | The gap between Semantic Scholar requests when a key is set (default 2000; never below 1100, so the key's one request per second is not reached) |
| `AH_KEYS_REPORT=<file>` | Diagnostic: write the name, length and a short hash of each key the server received. Never a value |

Next: [State and privacy](state-and-privacy.md).
