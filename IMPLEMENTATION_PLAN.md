# cc-mod-academic-harness: implementation plan

Status: **P0 and P1 done** (2026-11-16). P0: the scaffold loads and the eight platform checks are answered in `docs/PLATFORM-NOTES.md`. P1: skills, research mode, PaperMemory and agents, results in `docs/P1-RESULTS.md`. P2 has not started. Sections below are unchanged from the plan as written, except where a P0 result corrected them (marked "P0 result").

| | |
|---|---|
| Source | `/home/raktim/academic-harness` at commit `a3f17eb` (release 0.54.1) |
| Target | `/home/raktim/cc-mod-academic-harness` (this folder), a Claude Code mod named `academic-harness` |
| Written | 2026-11-15 |
| Platform | Linux only, as upstream |

## 1. Goal

Make Academic Harness usable inside Claude Code as a mod: the research tools, the skills, the writing-engine guards, the research persona, and a small terminal UI. The source repository is read and never written.

Not goals:

- Rewriting tool logic. The mod runs the upstream modules as they are.
- Reproducing the DSH web UI. The React client is replaced by a status line, a pane and slash commands.
- Replacing DSH. Both hosts can work on the same project folder and share its ledgers.

## 2. Ground rules

These hold in every phase.

1. **Never write inside `/home/raktim/academic-harness`.** That includes gitignored paths such as `vendor/academic-harness/.venv` and `python-helpers/.venv`. The checkout is linked live into the daily DSH profile, so a change there reaches DSH on its next restart. The mod reads the source with `git archive` of a named commit.
2. **Never touch the real DSH home (`~/.dsh`) or the DSH running on port 3080.** The tool host sets `DSH_HOME` to the mod's own home before it imports any upstream module. It never calls `index.js` `apply()`, because that seeds skills and patches DSH profiles.
3. **Keys are never printed or logged.** They reach tools as environment variables.
4. **Scratch and test directories live under `~/.cache`,** not `/tmp` (tmpfs quota).
5. **Generated files are never edited by hand:** `upstream/`, `skills/`, `hooks/generated/`, `server/dist/`.
6. **Stop processes by PID,** never by name pattern.
7. **Nested `claude` test runs drop the `CLAUDE_*` session variables** (the `ENV_DROP` list in `scripts/claude-plugin-check/run.mjs`).

Every test run ends with `scripts/check-upstream-clean.mjs`, which compares the source repository's `HEAD` and `git status --porcelain` with the values recorded before the run.

## 3. What was measured in the source

Each line says how it was established.

| Fact | Value | How |
|---|---|---|
| Registered tools | 136, with 301,109 characters of schema (about 75k tokens) | Ran `scripts/measure-tool-surface.mjs`. One module was not measured (`subagent-list-compat.js`). |
| Tool modules that need only the tool registry | 84 of 98 | Grep of `export const inject`. The other 14 are listed in section 4.3. |
| What tools read from the call context | The session working directory (48 uses) and the abort signal (39 uses) | Grep of `exec.` |
| Skills | 791 folders, 92 in the core list `skills-core.json` | Counted |
| Skill licences | 634 MIT, 19 BSD-3-Clause, 19 Apache-2.0, 12 Unknown, 8 CC-BY-4.0, 6 CC-BY-NC-SA-4.0, 2 GPL-3.0, 2 GPL-2.0 | Grep of `license:` lines, top eight values only |
| System prompt | `prompt.js`, 100,503 characters in about 40 `##` sections | Counted |
| Claude Code support in the writing engine | `ah hook userprompt\|pre\|post\|stop`, `ah hooks-config`, and a stdio MCP front `ah/mcp_server.py` | Read `vendor/academic-harness/ah/hooks.py`, `cli.py`, `mcp_server.py` |
| An MCP adapter already exists | `scripts/claude-plugin-check/skill-mcp.mjs` serves two real tool definitions over stdio in 45 lines, using the real `defineTool` outside DSH | Read |
| A recording context already exists | `recordingContext` and `collectToolDefinitions` in `scripts/measure-tool-surface.mjs`; `fakeHost`, `fakeJobs`, `fakeApproval` in `scripts/helpers/fake-host.mjs` | Read |
| On-demand skills already exist | `skill_search` and `skill_load` in `skill-on-demand.js`, over `skill-index.js` | Read |
| Local tools | node v24.15.0, `uv`, `claude` on PATH | Checked |

## 4. Architecture

A mod's hooks module has no Node and no DOM. It reaches the outside only through the engine interface (`$`). So the mod has two halves.

```
Claude Code session
│
├── hooks module (hooks/register.tsx)           runs inside the engine
│     research mode, prompt section, slash commands
│     guard bridge  ──────── $.process.run ───►  node server/bin/ah-hook.mjs ──► ah hook <event>
│     approvals (tool.check)
│     status line, pane, notifications  ◄── $.fs reads job records
│
├── MCP server "ah" (server/)                   one Node process, stdio
│     loads upstream tool modules through a small context shim
│     136 tools, deferred behind ToolSearch
│     jobs service, model route
│
├── MCP server "papermemory"                    launcher → `papermemory mcp`
│
├── skills/        core pack, listed
└── agents/        specialist definitions
```

### 4.1 How each DSH piece maps

| DSH piece | In the mod | Phase |
|---|---|---|
| 136 tools (`ctx.tools.register(defineTool(...))`) | One stdio MCP server that loads the upstream modules unchanged | P2, P4 |
| 791 skills | 92-skill core pack listed by Claude Code. The rest reached through `skill_search` / `skill_load`, as upstream does (decision D39 there) | P1 |
| Preset persona and prompt (`prompt.js`, `prompt-section.js`) | A research mode. When on, a `prompt.compose` hook adds a short always-on section. Longer per-area guidance is loaded on demand | P1 |
| Writing-engine guards (`academic-harness-hooks.js`) | Function hooks on the classic hook events that call `ah hook <event>` | P3 |
| DSH approval for `ah_author` and paid compute | A `tool.check` hook that returns `ask` | P3, P4 |
| PaperMemory mount (`papermemory.js`) | An MCP server entry with a launcher script | P1 |
| Background jobs (`ctx.jobs`) | A jobs service inside the tool host, with status tools and completion notices | P4 |
| Model calls (`ctx.llm.stream`) | A model route in the tool host (see D7) | P4 |
| Task chips with effort | Slash commands that take an effort argument | P5 |
| Settings → API keys page | `userConfig` fields in the manifest, passed to the server as environment variables | P2 |
| Web UI panels, reply folding | Status line, a pane, `/fold` | P5 |
| Specialist briefs and `subagent_pro` | `agents/*.md` definitions | P1, P6 |
| Firecrawl and Scite connectors (`mcp-connectors.js`) | Not ported. Use the connectors already attached to Claude Code | none |
| React client (`client/`) | Not ported | none |

### 4.2 Why the tools go through MCP

The mod API can register tools itself (`$.tool.register`), but the answer has to come from the hooks module, which cannot import Node code. The upstream tools use the filesystem, child processes, SQLite and Python. They need a real Node process, so they run in an MCP server that the plugin declares.

Claude Code defers MCP tools behind ToolSearch. The model sees tool names and loads a schema when it needs one. That removes the 75k-token schema cost that DSH pays on every step.

### 4.3 The modules that need more than the tool registry

| Module | Needs | Plan |
|---|---|---|
| `deep-research.js`, `deep-review.js`, `papermemory-dream.js` | model calls, jobs | P4, through the jobs service and the model route |
| `analysis-run.js` | jobs | P4 |
| `academic-task.js` | commands, jobs, plan mode | P5, reimplemented as slash commands; the mapping constants are reused |
| `academic-harness-hooks.js` | host interceptors | P3, replaced by the guard bridge |
| `papermemory.js`, `zvec-grep.js` | mount MCP servers | P1 and P6, replaced by manifest entries with launchers |
| `prompt-section.js` | system prompt | P1, replaced by `prompt.compose` |
| `subagent-models.js`, `subagent-list-compat.js` | DSH subagent registry | P6, replaced by agent definitions |
| `rsi-hooks.js` | host events | P6, decide then (D10) |
| `mcp-connectors.js`, `client/index.js` | host services | Not ported |

## 5. Folder layout

```
cc-mod-academic-harness/
├── IMPLEMENTATION_PLAN.md
├── README.md
├── UPSTREAM.lock.json            source commit, version, archive hash
├── .claude-plugin/plugin.json    name, version, types, userConfig, mcpServers
├── hooks/
│   ├── hooks.json                { "modules": ["./register.tsx"] }
│   ├── register.tsx              wires the modules below
│   ├── mode.ts                   research mode, /academic, prompt.compose
│   ├── guard.ts                  ah hook bridge
│   ├── approvals.ts              tool.check asks
│   ├── tasks.ts                  task commands
│   ├── ui.tsx                    status line, pane, notices
│   └── generated/                prompt text, task constants, fold-core (built)
├── types/index.d.ts              the $.state contract
├── server/
│   ├── src/host.mjs              MCP loop
│   ├── src/context.mjs           the context given to upstream apply()
│   ├── src/exec.mjs              per-call context (cwd, session id, signal)
│   ├── src/schema.mjs            DSH parameter DSL → JSON Schema
│   ├── src/manifest.mjs          which upstream modules load, by area
│   ├── src/jobs.mjs              jobs service
│   ├── src/llm.mjs               model route
│   ├── bin/ah-hook.mjs           runs `ah hook <event>`
│   ├── bin/papermemory-mcp.mjs   launcher
│   └── dist/                     bundle (built, P6)
├── upstream/                     snapshot of the source at the pinned commit (built)
├── skills/                       core pack (built)
├── agents/                       specialist definitions
├── scripts/
│   ├── sync-upstream.mjs
│   ├── build-skills.mjs
│   ├── build-prompt.mjs
│   ├── build-server.mjs
│   ├── measure-surface.mjs
│   └── check-upstream-clean.mjs
├── tests/
│   ├── *.test.ts                 run by `claude plugin test`
│   ├── server/*.test.mjs         run by `node --test`
│   └── live/                     nested-claude scenarios
└── docs/PLATFORM-NOTES.md        results of the P0 checks
```

State outside the folder:

| Path | Contents | Shared with DSH |
|---|---|---|
| `~/.local/share/cc-mod-academic-harness/home/` | Stand-in for `DSH_HOME`: managed PaperMemory, TextFold and zvec-grep installs | No |
| `~/.local/share/cc-mod-academic-harness/jobs/` | Job records and logs | No |
| `<cwd>/.dsh/**` | Notebook and all research ledgers | Yes, on purpose. `store-lock.js` guards writes |
| `<cwd>/.ah/` | Writing-engine session state | Yes |
| `~/.local/share/papermemory/papermemory.db` | Paper library | Yes, on purpose. Override with `PAPERMEMORY_DB` |

## 6. Decisions

Each has a default. Change any of them before the phase that uses it.

| # | Decision | Default | Used in |
|---|---|---|---|
| D1 | Where the mod lives | `/home/raktim/cc-mod-academic-harness`, its own git repository, loaded with `claude --plugin-dir` | P0 |
| D2 | Mod name | `academic-harness` | P0 |
| D3 | How the mod gets the source | A snapshot in `upstream/`, taken with `git archive` at a pinned commit and recorded in `UPSTREAM.lock.json`. A development mode can point at a checkout through `AH_UPSTREAM`, read-only, with all installers disabled | P1 |
| D4 | Which skills are listed | The 92 core skills, minus excluded licences. Everything else on demand | P1 |
| D5 | Which licences are excluded by default | Non-commercial, GPL and Unknown. A local build flag includes them for personal use. Upstream's legal opinion D09 is still outstanding | P1, P6 |
| D6 | How much prompt is always on | A short section, target 8k tokens or less: research discipline, safety, notebook, the tool-name map, a compact tool index. Per-area guidance from `prompt.js` becomes on-demand guides | P1 |
| D7 | Model route for tools that call a model | Decide after a spike in P4. Candidate A: a headless `claude -p` child with no tools and a budget cap. Candidate B: the Anthropic API when `ANTHROPIC_API_KEY` is set | P4 |
| D8 | `defineTool` | Use the real one from `@deepseek-ai/dsh-tools` if it bundles cleanly, since `skill-mcp.mjs` shows it works outside DSH. Otherwise a shim that returns the definition object | P2 |
| D9 | One server or several | One server named `ah`, with a `toolAreas` setting to trim areas | P2 |
| D10 | Local self-improvement (RSI) | Deferred to P6, then port or drop | P6 |

## 7. Phases

The first release is P0 to P3. Sizes are rough: S is days, M is about a week, L is longer.

### P0. Scaffold and platform checks (S)

**Goal:** an empty mod that loads, and written answers to the platform questions the later phases depend on.

Work:

1. Initialise the folder as its own git repository. Add `.gitignore`, `LICENSE` (MIT, as upstream) and a `NOTICE` that points at upstream's.
2. Write `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx` and `types/index.d.ts`. The first hook sets a status-line entry at `session.start`, as visible proof of loading.
3. Write `scripts/check-upstream-clean.mjs`.
4. Run the checks below and record each result in `docs/PLATFORM-NOTES.md`.

| Check | Question |
|---|---|
| S1 | Do `skills/`, `agents/` and `commands/` load from a folder that also has a hooks module? |
| S2 | Does a manifest `mcpServers` entry (or `.mcp.json`) start a stdio server? What prefix do its tools get? Is `${CLAUDE_PLUGIN_ROOT}` substituted? Is there a persistent data directory variable? |
| S3 | What is the server's working directory? Is `CLAUDE_CODE_SESSION_ID` in its environment? Does the client answer `roots/list`? |
| S4 | Does a sensitive `userConfig` field reach the server's environment through `${user_config.NAME}`? |
| S5 | Do function hooks on `classic.PreToolUse`, `classic.PostToolUse`, `classic.UserPromptSubmit` and `classic.Stop` fire when no settings hook is configured? What do `deny` and `block` do? |
| S6 | What does a `tool.check` answer of `ask` do in default, acceptEdits and auto modes? |
| S7 | What does the user type for a command registered with `$.command.register`? Is it namespaced? |
| S8 | How long does `ah hook pre` take through `$.process.run` on a call it allows? |

**Exit:** `claude plugin validate` and `tsc -p` pass. The mod loads with `claude --plugin-dir`. All eight checks have a recorded result. The upstream-clean check passes.

**P0 result:** met. S1 to S6 pass as assumed, S7 and S8 gave numbers. Four follow-ups for later phases are listed at the end of `docs/PLATFORM-NOTES.md` (guard input shape, bare command names, empty `userConfig` values, tool-name prefix).

**If a check fails:** S1 or S2 failing changes the layout (skills or the server would move to a companion plugin). S5 failing moves the guard to `tool.call`, `prompt.submit` and `turn.complete` hooks, or to command hooks printed by `ah hooks-config`.

### P1. Skills, research mode, PaperMemory, agents (M)

**Goal:** useful without the tool host.

Work:

1. `scripts/sync-upstream.mjs`: `git archive` of the pinned commit into `upstream/`, with a path allow-list. Write `UPSTREAM.lock.json`.
2. `scripts/build-skills.mjs`: copy the core skills into `skills/`, minus excluded licences. Reuse `coreSkillNames` (`skill-index.js`) and `readLicense` / `isNonCommercial` (`skill-licenses.js`). Leave the rest under `upstream/skills/` for `skill_search`.
3. `scripts/build-prompt.mjs`: take an allow-list of `##` sections from `upstream/prompt.js` and write `hooks/generated/prompt.ts`. Prepend host notes written for Claude Code: the tool-name map, how to find tools, where state lives. Turn the remaining sections into on-demand area guides. The build fails if an expected heading is missing, which catches upstream drift.
4. `hooks/mode.ts`: research mode in `$.state`. `/academic on|off|status`. Mode turns on by itself in a tree that has `ah.yaml`, or when a setting says so. A `prompt.compose` hook adds the section while the mode is on.
5. `server/bin/papermemory-mcp.mjs`: resolve the PaperMemory CLI as `papermemory-cli.js` does, install it into the mod's home if missing, then run `papermemory mcp`. If it cannot be resolved the launcher exits with a clear message, which keeps upstream's fail-loud rule. `PAPERMEMORY_CLI` reuses an existing install.
6. `agents/*.md`: specialist definitions from the `## Specialists` section of `prompt.js` and the matching skills.

**Tests:** build-script unit tests. `tests/mode.test.ts` under `claude plugin test`. One nested-claude run that loads a core skill by name.

**Exit:** `/academic on` adds the section and `/academic off` removes it. The core skills are listed. The 14 PaperMemory tools are callable. Agents are offered. `~/.dsh` and the source are untouched.

**P1 result:** met. 86 of 92 core skills are listed (6 excluded by D5), the always-on section is about 4,100 tokens, 14 PaperMemory tools answer, 22 agents are offered, and the source and `~/.dsh` are untouched. Deviations and costs are in `docs/P1-RESULTS.md`.

### P2. Tool host and tier-1 tools (L)

**Goal:** search, papers, citation and notebook tools callable from Claude Code.

Work:

1. `server/src/host.mjs`: stdio MCP server with `initialize`, `tools/list`, `tools/call` and cancellation mapped to an `AbortSignal`. Start from `scripts/claude-plugin-check/skill-mcp.mjs`. Use the official MCP SDK if it bundles cleanly.
2. `server/src/context.mjs`: the object passed to each module's `apply`. It provides `tools.register/get/resolve/execute`, `logger`, `on`, `effect`, `get`. Start from `recordingContext` and `fakeHost`. Unlike the recording proxy, access to a service that is not provided must fail with a named error, so a tool that needs an unported service says so.
3. `server/src/exec.mjs`: build the per-call context: `name`, `arguments`, `callId`, `signal`, and `agent.session.header.{id, cwd}` from the answers to S3.
4. `server/src/schema.mjs`: convert the DSH parameter DSL to JSON Schema. Start from `inputSchema()` in `skill-mcp.mjs` and extend it to nested objects, arrays, `oneOf` and `json`. Use the package's own converter if it exports one.
5. `server/src/manifest.mjs`: discover modules from `index.js`'s bundle functions and from the preset rows in `presets/academic-harness/agent.cordis.yml`, with the same pattern `measure-tool-surface.mjs` uses. Keep a deny-list for the host-only modules in section 4.3.
6. Set `DSH_HOME` to the mod's home before the first import. Managed installs go there, in the background.
7. Pass keys as environment variables. `resolveEnv` (`credential-env.js`) reads `process.env` first, so no key shim is needed. Declare the fields of `KEY_FIELDS` (`settings-keys.js`) as `userConfig`.
8. Map `output.render` blocks to MCP content. Clip very large results and write the full text to a file under `<cwd>/.dsh/`.

Tier 1: `literature_search`, the OpenAlex, Semantic Scholar, PubMed, arXiv and Crossref tools, `paper_resolve`, `paper_get`, `paper_context`, `paper_download`, `integrity_check`, `database_catalog`, `journal_search`, `domain_search`, the citation tools, `reference_library`, `notebook`, `scientific_result`, `fold_text`, `research_template`, `pdf_to_markdown`, `skill_search`, `skill_load`, and the keyed web-search tools.

**Tests:**

- Schema unit tests.
- **Surface parity:** `tools/list` from the host equals `collectToolDefinitions()` from upstream for names, descriptions and parameter sets.
- **Snapshot integrity:** run upstream's own `scripts/test-*.mjs` for the tier-1 modules against `upstream/`.
- **Live:** a nested Haiku run that finds three papers on a topic and writes a notebook entry. Assert the tool calls and the `.dsh/notebook/*.jsonl` file.

**Exit:** tier-1 tools work in a research-mode session. Parity is green. A key set in `userConfig` reaches a tool and appears in no log. `~/.dsh` is untouched.

**Risks:** modules find assets through `import.meta.url`. Unbundled, that works from `upstream/`. Bundled, the bundle must sit at the snapshot root (P6).

### P3. Writing engine and guards (M)

**Goal:** an `ah.yaml` project is protected in Claude Code the way it is in DSH.

Work:

1. Load `academic-harness.js` in the host for the `ah_*` tools. The engine's Python environment is created inside the mod's snapshot, never in the source checkout.
2. `server/bin/ah-hook.mjs`: resolve the engine with the functions in `academic-harness-cli.js` and run `ah hook <event>`, passing stdin through.
3. `hooks/guard.ts`: function hooks on the four classic events. With no `ah.yaml` above the working directory, pass straight through with no process started. Otherwise send the event to `ah-hook.mjs` with `$.process.run` and translate the reply: a `deny` decision refuses the call, `additionalContext` becomes context, a stop `block` keeps the turn going.
4. Fail closed. If the engine errors or times out, refuse `Write`, `Edit`, `MultiEdit`, `NotebookEdit` and `Bash`, and let reads through. A failing guard hook is skipped by the engine by default, so the hook needs an explicit catch that denies.
5. `hooks/approvals.ts`: a `tool.check` hook that answers `ask` for `ah_author`, with the act named in the reason.

**Tests:**

- `tests/guard.test.ts` with upstream's `scripts/helpers/fake-ah-engine.mjs`.
- The engine's own `tests/test_claude_adapter.py` in the mod's environment.
- The live matrix from `scripts/claude-host-test/` (`mkproj.py`, `scenarios.py`), pointed at the mod instead of settings hooks: a protected write is denied, an author-only shell command is denied, the post-edit note appears, the stop gate continues the turn and then hands off.

**Exit:** the scenarios pass. With the engine deliberately broken, mutating calls are denied and reads pass. Outside an `ah.yaml` tree the guard starts no process.

**First release ends here.**

### P4. Ledgers and long-running work (L)

**Goal:** the rest of the tool surface, including tools that run for minutes or call a model.

Work:

1. `server/src/jobs.mjs`: the `ctx.jobs` shape that `job-runner.js` (`runAsJob`) expects, modelled on `fakeJobs`. Persist records and logs under the mod's home. Add `job_status`, `job_wait` (bounded), `job_log` and `job_kill` tools.
2. `server/src/llm.mjs`: read the call sites (`deep-review.js:337`, `deep-research-steps.js:162`), write down the chunk shape they consume, then build the route chosen in D7.
3. Load the remaining modules by area: reviews and meta-analysis, deep review, deep research, hypothesis tournaments, analysis and experiments, provenance, study conduct and grants, datasets and science toolkits, audits, submission tools, figures and file formats.
4. Python helpers: `uv sync` for `python-helpers` inside the snapshot.
5. Paid compute (`modal_run`, `runpod_run`, `vastai_run`): always `ask` through `tool.check`, with the text from `computeApprovalReason` (`compute-approval.js`). Enforce the session budget from `compute-ledger.js` inside the host.
6. Completion notices: a timer in the hooks module reads job records, raises a notification when one finishes, and can queue a one-line prompt so the model picks the result up, as DSH's completion notice does.

**Tests:** upstream's test scripts per area against the snapshot. Jobs unit tests. One live low-effort deep research run with a budget cap.

**Exit:** surface parity for all 136 tools minus a documented exclusion list. A deep research run goes from start to notice to report in a live session. Compute tools always ask.

**Risks:** a job dies with the server process when the session ends. Whether deep research can resume from its store needs reading before this phase is sized.

### P5. Terminal UI and task commands (M)

Work:

1. Status line: mode, running jobs, open blockers in an `ah` project.
2. A pane with four parts: project state (`ah state`), jobs, notebook tail, library counts. `/academic` opens it.
3. Task commands for the seven upstream tasks (`/research`, `/review`, `/papers`, `/references`, `/write`, `/analyze`, `/hypotheses`), each with an effort argument. Reuse the constants in `task-modes.js`, which is browser-safe, by copying it into `hooks/generated/`. Follow the mapping in `academic-task.js`. Prefix the names if S7 shows a collision.
4. `/fold <level>` using `fold-core.js`, which is pure and can be copied the same way.

**Tests:** `claude plugin test` in the pattern of the mod examples. A table test that each task and effort produces the same tool arguments as upstream.

**Exit:** the pane draws at wide and narrow widths. Every task command starts the right tool with the right arguments.

### P6. Remaining surface, packaging, release (M)

Work:

1. Agents: an `academic-harness:pro` definition with model and effort from settings. Decide whether a vision agent is needed, given that the session model reads images.
2. zvec-grep: a launcher entry that is absent when `zg` is not installed, keeping upstream's fail-soft rule.
3. Decide RSI (D10) and `paper_mcp`.
4. Bundle: one file from esbuild, placed at the snapshot root so asset lookups hold. Audit native dependencies (`@firecrawl/pdf-inspector`, the `pdfjs-dist` canvas) and install those on first use into the mod's home.
5. Licences: default pack as D5. Carry upstream's `NOTICE` and `docs/legal`.
6. Update procedure: `sync-upstream --commit <sha>`, build, parity test, then a drift report listing new and removed tools, prompt headings and core skills.
7. Documentation: install, modes, commands, keys, state locations, troubleshooting.
8. Sharing, only when asked for: marketplace file and a secret scan first.

**Exit:** a fresh clone works with `claude --plugin-dir` and no source checkout present. The update procedure has been run once against a newer upstream commit.

## 8. Verification summary

| Layer | Tool | When |
|---|---|---|
| Manifest and hooks source | `claude plugin validate` | Every change |
| Types | `tsc -p` | Every change |
| Hooks behaviour | `claude plugin test` | Every change to `hooks/` |
| Tool host | `node --test tests/server` | Every change to `server/` |
| Surface parity with upstream | parity test | Every sync and every manifest change |
| Snapshot integrity | upstream's own test scripts | Every sync |
| Real sessions | nested `claude -p --plugin-dir`, small model, budget cap, scratch directory under `~/.cache` | End of each phase |
| Source untouched | `scripts/check-upstream-clean.mjs` | After every test run |
| DSH home untouched | listing and modification times of `~/.dsh` before and after | End of each phase |

## 9. Risks

| Risk | Effect | Handling |
|---|---|---|
| The mod API is early access and changes between releases | Hooks stop loading after a Claude Code update | Keep the hooks module small. Record the Claude Code version in `docs/PLATFORM-NOTES.md`. Rerun the P0 checks after an update |
| Tool names differ from the bare names in the prompt and in 791 skills | The model looks for a tool under the wrong name | Tool-name map in the always-on section. Check in the live tests |
| Prompt size | 100k characters cannot all be always on | D6: short core plus on-demand guides. Measure the section size in the build |
| Stop gate behaves differently at Claude Code's turn end | Turns end with blockers open, or loop | Live scenarios in P3. The engine caps its own gate loops |
| Session id and working directory are not what the tools expect | Notebook entries land in the wrong file or folder | S3 in P0, before any tool is ported |
| Long tools exceed MCP timeouts | Calls fail midway | Jobs service in P4. Until then, tier-1 tools are short |
| Both hosts write the same project at once | Ledger conflicts | Upstream's `store-lock.js` already guards the ledgers. Do not add a second lock |
| Upstream moves on | Snapshot goes stale | Pinned commit, parity test, drift report |
| Licences | Public sharing of excluded skills | D5. Excluded by default until upstream's legal opinion is in |

## 10. Not yet verified

These are assumptions from reading the mod documentation and types. P0 tests each one.

- A mod folder can carry `skills/`, `agents/` and an MCP server declaration next to its hooks module. The reference says `commands/` and `skills/` load and that `agents/*.md` declare agent types, and `$.mcp.connect` takes "a key of the caller's manifest".
- Plugin MCP tools are named `mcp__plugin_<plugin>_<server>__<tool>`. Other plugins in the current session follow that pattern.
- `${CLAUDE_PLUGIN_ROOT}` and `${user_config.NAME}` are substituted in the server's command and environment.
- The classic hook events can be hooked by a function hook with no settings hook configured.
- `$.process.run` allows 120 seconds for a hook call. Its documented default is 30 seconds and its maximum ten minutes.
- The tool count of 136 excludes one unmeasured module, and the licence counts cover only the eight most common values.

## 11. First steps

1. Confirm or change the defaults in section 6, at least D1 to D6.
2. Run P0.
3. Review `docs/PLATFORM-NOTES.md` together before starting P1, because S1, S2 and S5 can change the layout.
