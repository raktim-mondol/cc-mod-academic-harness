# cc-mod-academic-harness

A Claude Code mod that brings the Academic Harness research tooling into Claude
Code: literature and citation tools, a research skill pack, the writing-engine
guards for `ah.yaml` projects, and a small terminal interface.

**Status: phases P0 to P6 done, with a fit review** (tool host serving 121 of Academic Harness's 136 tools plus the host's own,  the
writing-engine guard, background jobs and a model route, the task commands, `/fold`, a status line and a pane). The fit review
dropped what Claude Code already does and rewrote the guidance for it: `docs/FIT-REVIEW.md`. P6 made a fresh clone work with no source checkout (`node scripts/setup.mjs`), added `/academic doctor` and an update procedure (`docs/P6-RESULTS.md`, `docs/USER-GUIDE.md`). The plan is in `IMPLEMENTATION_PLAN.md`; the audit of P0 to P4 is `docs/AUDIT-P0-P4.md`; platform answers are in
`docs/PLATFORM-NOTES.md`; what P1 to P5 built and measured is in `docs/P1-RESULTS.md` to `docs/P5-RESULTS.md`.

## What works now

- **Research mode.** `/academic on | off | auto | status`. `auto` (the default) is on in a
  folder that has, or sits under, an `ah.yaml`. While on, a research section (about 4,000
  tokens) is added to the system prompt. The `research_mode` setting changes the default.
- **Task commands**, the seven task chips of Academic Harness as slash commands, each running the same tool with the same arguments
  as upstream's `submitAcademicTask` (checked against upstream's own code): `/ah-research`, `/ah-review`, `/ah-papers`,
  `/ah-references`, `/ah-write`, `/ah-analyze` and `/ah-hypotheses`. Put the effort first (`--effort low|medium|high`), and write
  ` -- ` where the task takes a second line: `/ah-review --effort high paper.tex -- focus on the statistics`. The command itself
  makes no model call; a long task goes on as a background job. **`/fold [full|brief|points|outline|gist]`** folds the model's last reply.
  The `ah-` prefix is there because `/analyze` already belongs to another plugin.
- **Status line and pane.** One line under the prompt, `research mode on · 1 job running · gate FAIL (5 blocking)`: the mode, this
  session's running jobs and, in an `ah.yaml` project, the engine's gate (read again after each turn). `/academic` with no word opens a
  pane with the project's state, this session's jobs, the notebook's last entries and the PaperMemory counts; it is one column when
  narrow and two when the pane is 96 columns or wider, and it refreshes itself while it is open.
- **54 core skills**, listed as `academic-harness:<name>`, plus `academic-harness:research-guides`,
  which holds the longer per-area guidance (27 files) and is read on demand. About 700 more are bundled and found with
  `skill_search` (17 of the core ones, such as `openfda` and `scanpy`, are among them to keep the always-loaded list short).
- **21 specialist agents** such as `academic-harness:peer-reviewer`. Reviewers cannot edit files.
- **Research tools** from the `ah` MCP server, named `mcp__plugin_academic-harness_ah__<tool>` and
  found with `ToolSearch`: `literature_search`, `openalex_search`, `s2_search`, `pubmed_search`,
  `arxiv_search`, `crossref_lookup`, `jina_read`, `paper_resolve`, `paper_get`, `paper_context`,
  `paper_download`, `citation`, `integrity_check`, `reference_library`, `notebook`,
  `skill_search` and `skill_load`, among others. They are Academic Harness's own code, loaded unchanged.
  Thirteen are left out because Claude Code does the job (general web search and fetch, result cards, reply folding, prompt
  templates, MCP mounting, a LaTeX wrapper): the list, the reasons and `restore_tools` are in `docs/FIT-REVIEW.md`.
  The notebook goes to `<project>/.dsh/notebook/<session id>.jsonl`. A result over 40,000 characters is
  cut and the whole text saved under `<project>/.dsh/tool-output/`.
- **Writing engine and guard** for projects with an `ah.yaml`. 38 `ah_*` tools (`ah_state`, `ah_check`,
  `ah_audit`, `ah_fact`, `ah_claims`, `ah_plan`, `ah_decision_request`, `ah_author`, and the rest) run the
  engine's CLI. In such a project a guard checks every `Write`, `Edit`, `NotebookEdit` and `Bash` call
  (about 0.14 s each): protected files (`facts/facts.yaml`, `ah.yaml`, `sources/**`, ...) cannot be changed,
  unit anchors cannot be dropped, and the author-only acts (waive, approve, accept) cannot be run from the
  shell. The paper-state card is added to each prompt, an edit that introduces a blocker is noted, and the
  turn is held (up to 3 times) until it is fixed or handed to the author. If the guard cannot run, those
  calls are refused and reads still work. `ah_author` asks you first. Outside an `ah.yaml` tree nothing
  runs. Builds its engine once (`node scripts/install-engine.mjs`), or let the server build it in the background on first start (`AH_AUTO_INSTALL=0` turns that off). The `evidence_check` setting (`skip` or `run`) controls
  the advisory source check at the end of a turn; it is off by default because it calls a model.
- **The rest of the tool surface** (reviews and meta-analysis, hypothesis tournaments, analysis, provenance,
  study design and grants, datasets and science toolkits, submission tools, figures). **Long tools run as
  background jobs**: `deep_research`, `deep_review` and `analysis_run` answer after about 30 seconds with a job
  id; `job_status`, `job_wait`, `job_log` and `job_kill` follow them, and in an interactive session you are
  notified when one ends and the model reads the result on its own (`job_notices`). Tools that call a model
  (deep research and review) use headless Claude Code calls under your login, on `llm_model` (sonnet) and capped
  by `llm_budget_usd` ($5 a server run). **Paid compute** (`modal_run`, `runpod_run`, `vastai_run`) always asks
  first, with the cost ceiling and your session budget. `node scripts/install-helpers.mjs` builds the optional
  Python helper environment (about 770 MB) for the data and statistics tools.
- **PaperMemory's own tools.** `paper_backfill` fills the library from the papers in a project, and a consolidation pass
  runs shortly after the server starts (at most hourly). The server follows `/cd` (it asks the client for the session
  folder). An MCP server generated from a paper (Paper2MCP) is added the Claude Code way, `claude mcp add` or `.mcp.json`.
- **API keys** are the plugin's `userConfig` fields (set them where Claude Code configures plugin options, or in `pluginConfigs`). A variable exported in the
  shell wins over a setting. `tool_areas` (search, papers, notebook, skills, writing, reviews, tournament, analysis, provenance, study, data, submission, deep, compute, figures, memory, or all) trims the tool set, and `restore_tools` brings a left-out tool back by name.
- **PaperMemory**: its 14 tools, as `mcp__plugin_academic-harness_papermemory__*`. The first
  session installs the CLI into `~/.local/share/cc-mod-academic-harness/home/` (about a second
  with a warm `uv` cache). The library is `~/.local/share/papermemory/papermemory.db`, shared with
  DeepSeek Harness. The mod creates a missing store and never migrates an existing one.

## Set up from a clone

```
node scripts/setup.mjs                # the snapshot, dependencies, the writing engine, a check
claude --plugin-dir "$PWD"
```

No source checkout is needed: `setup` downloads Academic Harness's source at the pinned commit from GitHub (the repository is public)
and checks it against the digest in `UPSTREAM.lock.json`; when `~/academic-harness` has the commit, it reads that instead, with `git
archive`, and never writes in it. `--helpers` adds the optional Python helper environment (about 800 MB). `docs/USER-GUIDE.md` covers the
settings, where things live and troubleshooting; `/academic doctor` says what is ready. `node scripts/update-upstream.mjs` reports what a
newer upstream commit changes, and `--apply` takes it.

`skills/`, `agents/` and `hooks/generated/` are committed, so they load without the snapshot; the `ah` server, the PaperMemory install and
the on-demand skills need it. Skills with non-commercial, GPL or unknown licences are left out (decision D5). A local build can keep them
with `node scripts/build-all.mjs --include-restricted`; do not commit or share that build.

## Tests

```
claude plugin validate .
npx --yes -p typescript@5.6.3 tsc -p . --noEmit
claude plugin test .                                   # hooks: research mode, the guard, approvals
node --test "tests/scripts/*.test.mjs" "tests/server/*.test.mjs"   # builds, launcher, tool host, parity
node scripts/measure-surface.mjs                       # host tools against what upstream registers
node server/bin/ah-doctor.mjs                          # what is ready and what is not (also /academic doctor)
node scripts/update-upstream.mjs                       # what a newer upstream commit changes for the mod
node scripts/test-upstream.mjs [--all]                  # upstream's own tests (--all: every one but six about DSH itself)
node scripts/test-engine.mjs [--all]                   # the engine's own pytest suite, in a venv under ~/.cache
node tests/live/p2.mjs                                 # nested claude -p runs, about 4 cents
node tests/live/p3.mjs                                 # the guard matrix, 15 nested runs, about 30 cents
node tests/live/p4.mjs                                 # jobs, the model route, compute approval, a deep research run
node tests/live/p4-tui.mjs                             # tmux: a job ends, the notice appears, the model reports (about 10 cents)
node tests/live/p3-tui.mjs                             # tmux: the guard and approvals with Claude Code's own dialogs (6 checks)
node tests/live/p5.mjs                                 # task commands, errors, /fold, one deep research run from /ah-research
node tests/live/p6.mjs                                 # the doctor in a session, a fresh clone with no checkout (network), the update procedure
node tests/live/p5-tui.mjs                             # tmux: status line, the pane at three widths, a job from start to notice
node tests/live/p1.mjs                                 # agents, skills, research mode, PaperMemory
node tests/live/fit.mjs                                # the catalogue, restore_tools, papers searched with literature_search, an on-demand skill
node tests/live/p2-config.mjs                          # a key saved with `claude plugin configure` reaches an installed copy's server
```

The script tests need `upstream/`. The launcher tests install into a scratch folder under
`~/.cache` and check that the real PaperMemory store is unchanged.

## Rules this repository follows

The Academic Harness source checkout is read, never written. The real DSH home
(`~/.dsh`) is never touched. `node scripts/check-upstream-clean.mjs --record`
before a test run and `node scripts/check-upstream-clean.mjs` after it prove
both. Scratch directories live under `~/.cache`, not `/tmp`.

## Licence

MIT, as upstream. See `LICENSE` and `NOTICE`.
