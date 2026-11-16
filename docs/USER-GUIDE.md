# User guide

How to set the mod up, what it adds to Claude Code, where it keeps things, and what to do when something does not work. Linux only, as upstream is.

## Set up

```
git clone https://github.com/raktim-mondol/cc-mod-academic-harness
cd cc-mod-academic-harness
node scripts/setup.mjs
claude --plugin-dir "$PWD"
```

`setup.mjs` needs Node.js 22 or newer, `npm` and `tar`; `uv` is used when present (otherwise `python -m venv`). It does five things, each skipped when it is already done:

1. **The snapshot.** Academic Harness's source at the commit in `UPSTREAM.lock.json`, into `upstream/` (gitignored, about 56 MB). From the checkout at `~/academic-harness` (or `AH_SOURCE`) when that has the commit; otherwise downloaded from GitHub (the repository is public) and checked against the digest in the lock. A download that is not the locked bytes is refused. `--github` forces the download.
2. **Dependencies.** `npm ci` inside `upstream/` (about 115 MB).
3. **The writing engine.** A Python environment inside `upstream/vendor/academic-harness`, for the `ah_*` tools and the guard. `--no-engine` leaves it to the server, which builds it in the background the first time it starts.
4. **The Python helpers**, only with `--helpers` (about 800 MB): the data, statistics and science toolkits fall back to `python3` without them.
5. **A check**: `plugin.json` against the snapshot, and the doctor's report.

To have the mod in every session, export `CLAUDE_CODE_PLUGIN_DIRS=/path/to/cc-mod-academic-harness` instead of passing `--plugin-dir`. Installing it from a marketplace is not set up: the snapshot is not part of the repository, and publishing is left until you ask for it.

First use also installs, into `~/.local/share/cc-mod-academic-harness/home/`, PaperMemory's CLI (about a second with a warm `uv` cache) and, when a session loads the tools that use it, TextFold. `AH_MANAGED_INSTALLS=0` turns the second off.

## What it adds

| | |
|---|---|
| **Research mode** | `/academic on \| off \| auto \| status`. `auto` is on in a folder that has, or sits under, an `ah.yaml`. While on, a research section (about 2,900 tokens) is added to the system prompt |
| **The pane** | `/academic` with no word. Project state, this session's jobs, the notebook's last entries, the PaperMemory counts. One column when narrow, two from 96 columns |
| **The status line** | `research mode on · 1 job running · gate FAIL (5 blocking)` |
| **Doctor** | `/academic doctor` (`--online` also asks GitHub whether upstream has moved). The `doctor` tool gives the same report to the model |
| **Task commands** | `/ah-research`, `/ah-review`, `/ah-papers`, `/ah-references`, `/ah-write`, `/ah-analyze`, `/ah-hypotheses`. Effort first: `--effort low\|medium\|high`. ` -- ` is the line break of a two-line task: `/ah-review --effort high paper.tex -- focus on the statistics` |
| **`/fold [level]`** | Folds your last reply: `full`, `brief`, `points`, `outline`, `gist` (or 1 to 5) |
| **Tools** | 121 of Academic Harness's 136 plus the host's `job_*` and `doctor`, as `mcp__plugin_academic-harness_ah__<tool>`, found with `ToolSearch`. 15 are left out on purpose: `docs/FIT-REVIEW.md` |
| **Skills and agents** | 54 core skills as `academic-harness:<name>`, about 700 more through `skill_search` and `skill_load`, 21 specialist agents such as `academic-harness:peer-reviewer` |
| **The guard** | In a folder with an `ah.yaml`: protected files, unit anchors and author-only acts are enforced on every `Write`, `Edit`, `NotebookEdit` and `Bash` call |
| **PaperMemory** | Its 14 tools, as `mcp__plugin_academic-harness_papermemory__*`, over `~/.local/share/papermemory/papermemory.db` (shared with DeepSeek Harness, opened read-only by the pane) |

Long tools (`deep_research`, `deep_review`, `analysis_run`) answer after about 30 seconds with a job id and go on in the background; you are told when one ends. Paid compute (`modal_run`, `runpod_run`, `vastai_run`) asks you first, every time.

## Settings

Set them where Claude Code configures plugin options. A variable exported in the shell wins over a saved key.

| Setting | Default | What it does |
|---|---|---|
| `research_mode` | `auto` | `auto`, `on` or `off` |
| `tool_areas` | `all` | Which tool groups load: search, papers, notebook, skills, writing, reviews, tournament, analysis, provenance, study, data, submission, deep, compute, figures, memory |
| `restore_tools` | empty | Left-out tools to bring back by name (the shell variable `AH_RESTORE_TOOLS` does the same) |
| `llm_model`, `llm_budget_usd` | `sonnet`, `5` | The model route of the tools that call a model (headless Claude Code under your login), and the most it spends in one server run |
| `job_notices` | `prompt` | When a job ends: notify and prompt the model, only notify, or neither |
| `evidence_check` | `skip` | `run` makes the stop gate check, with a model, the sources a turn's paragraphs cite |
| `compute_session_cap_usd` | empty | Cap on rented compute in a session |
| About 30 key fields | empty | Worth setting first: `S2_API_KEY` (a dedicated Semantic Scholar rate limit), `UNPAYWALL_EMAIL`, `CROSSREF_MAILTO` |

Keys are never printed: the doctor lists the names that are set.

Environment switches: `AH_AUTO_INSTALL=0` (do not build the engine in the background), `AH_MANAGED_INSTALLS=0` (no TextFold or Modal install), `AH_JOB_FOREGROUND_MS` (how long a long tool holds the call before going on as a job; a headless `claude -p "/ah-research ..."` ends the session when the command returns, so set it high there), `AH_MOD_HOME` (the mod's home), `AH_SOURCE` (the checkout `setup` and `update-upstream` read), `AH_UPSTREAM` (development mode: read a checkout as the snapshot, read-only, with every installer off).

## Where things live

| What | Where |
|---|---|
| The snapshot, its dependencies, the engine environment | `<plugin>/upstream/` |
| PaperMemory's CLI, TextFold, job records and logs, the compute ledger | `~/.local/share/cc-mod-academic-harness/home/` |
| The PaperMemory library | `~/.local/share/papermemory/papermemory.db` |
| A project's notebook and research ledgers | `<project>/.dsh/` (shared with DeepSeek Harness) |
| The writing engine's state and the guard's log | `<project>/.ah/` (`claude-hooks.jsonl`) |
| A tool result longer than 40,000 characters, in full | `<project>/.dsh/tool-output/` |

Nothing is written in `~/.dsh`, and the Academic Harness source checkout is only read.

## When something does not work

Run `/academic doctor` first. It says what is missing and the command that fixes it.

| Symptom | Cause and fix |
|---|---|
| The `ah` server shows as failed in `/mcp` | The snapshot or its dependencies are missing: `node scripts/setup.mjs` |
| `ah_*` tools say the engine is "being installed" or "missing" | The engine's environment builds in the background on first start (a minute). `node scripts/install-engine.mjs` does it now |
| `paper_fold` says TextFold is not ready | It installs on first load of the notebook or submission tools; check `AH_MANAGED_INSTALLS` and network. `doctor` shows whether it is there |
| A write in a project is refused with a reason | That is the guard. Read the reason; do not look for another way; hand the question to the author with `ah_decision_request` |
| `literature_search` reports `s2: ... 429` | Semantic Scholar's keyless pool is shared and throttled. Set `S2_API_KEY`; the other sources still answer |
| A `deep_research` run stopped when the session ended | Jobs belong to the session. `deep_research` resumes from its own store (`action: resume`) |
| A data or statistics tool says an import is missing | `node scripts/install-helpers.mjs`, or install the package it names |
| `/ah-papers` and the other commands say a file is not found | Paths are relative to the session folder and must stay inside it |
| A tool the guidance names is not found | It is one of the 15 left out (`docs/FIT-REVIEW.md`); `restore_tools` brings back most of them |

## Keeping up with Academic Harness

`node scripts/update-upstream.mjs` compares the newest upstream commit with the one the mod holds, in a scratch folder, and reports: tools added, removed or changed, prompt sections, core skills, settings fields, and anything nobody has decided about yet (a new tool, an unclassified module). `--commit <sha>` picks the commit; `--apply` takes it (sync, dependencies, engine, build, `plugin.json`, the parity check and the tests) and stops first if a decision is needed. A new tool is served by adding its module to `TIER1` in `server/src/manifest.mjs`, or left out with a reason in `server/src/fit.mjs`. After applying, review `git diff`, run `claude plugin test .` and `tests/live/*`, then commit.
