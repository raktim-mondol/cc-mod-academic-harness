# Testing

Two kinds. The **unit and integration suites** need no account and no network and take a few seconds; run them after every change. The **live scripts** drive a real Claude Code (and sometimes the network, tmux, a model, rented-compute dialogs); they cost cents and run when you choose to.

Every run of either kind ends with `node scripts/check-upstream-clean.mjs`, after `--record` before it: the Academic Harness source checkout and `~/.dsh` must be unchanged.

## Every change

| Command | Covers |
|---|---|
| `npm run check` | The node suites, `build-manifest.mjs --check` and `measure-surface.mjs` in one command. This is the gate CI runs; `node scripts/check.mjs` is the same script |
| `npx --yes -p typescript@5.6.3 tsc -p . --noEmit` | Types of the hooks module (`npm run typecheck`) |
| `claude plugin validate .` | The manifest, the marketplace file and the hooks module as the engine reads them |
| `claude plugin test .` | The hooks (see below), with every engine call stood in for |
| `node --test "tests/scripts/*.test.mjs" "tests/server/*.test.mjs"` | The builds, the tool host, the guard bridge, jobs, the model route, the snapshot and the first start |
| `node scripts/build-manifest.mjs --check` | `plugin.json` matches what the snapshot would generate |
| `node scripts/measure-surface.mjs` | The host serves what upstream registers, minus what is left out on purpose, and each tool is identical |

`node --test` needs the globs quoted (Node 24). The type check needs the engine's types, which exist only after a real Claude Code session has loaded the mod, so it is a local step and not part of CI. Three tests in `tests/server/papermemory.test.mjs` build real environments (`uv`, or `python -m venv` and `pip`) and need the network (PyPI): they fail on a machine with neither.

## CI

`.github/workflows/ci.yml` runs on every push to `main`, every pull request and by hand, with no account and no model:

| Job | Runs | Covers |
|---|---|---|
| `node` (Node 22 and 24) | `node scripts/setup.mjs --github`, then `npm run check` | The builds, the tool host, the guard bridge, the snapshot and first start from a download with no source checkout, the manifest, the served surface against upstream's, and that the claimed minimum Node works |
| `versions` | `scripts/ci-matrix.mjs` | Reads `TESTED_VERSIONS` (`server/src/compat.mjs`) and hands the versions to the next job |
| `claude-code` (each tested version, then `latest`) | Installs that Claude Code, `claude plugin validate . --strict`, `claude plugin test .` | The manifests and the hooks module as the engine reads them, on the versions the mod was seen on and on the newest |

On `claude-code`, a tested version must pass; a failure on `latest` is shown but does not fail the workflow, because it means a newer Claude Code changed something, not that the commit is wrong. Actions are pinned to a commit SHA (the version is kept as a comment), and a repository test fails on a tag; Dependabot proposes the updates in one grouped PR a week, reviewed like any other change. The live scripts are not run in CI.

`.github/workflows/upstream-watch.yml` is a second, weekly workflow: it opens an issue when Academic Harness moves ([Updating](updating-upstream.md)). It is not a check of this repository; `tests/scripts/upstream-watch.test.mjs` tests its decisions and calls with a stand-in for `gh`.

Adding a Claude Code version: run the live scripts on it ([What to do next](next-steps.md)), then add it to `TESTED_VERSIONS`. The doctor then calls it a version the mod was seen on, and CI tests it. The tests under `tests/server` and `tests/scripts` that touch the snapshot are skipped when it is absent.

### The plugin tests (`tests/*.test.ts`, `*.test.tsx`)

| File | What it checks |
|---|---|
| `mode.test.ts` | Research mode: auto, on, off, the setting, the section added to the prompt, a taken command name |
| `guard.test.ts` | The writing-engine guard and the approvals: deny, allow, fail closed, the stop gate, `ah_author`, paid compute |
| `jobs.test.ts` | Completion notices, through the mock clock |
| `tasks.test.ts` | The task commands, `/ah-watch` and `/fold`: tools and arguments, file checks, refusals |
| `ui.test.tsx` | The status line, and the pane at 40 and 120 columns |
| `doctor.test.ts` | `/academic doctor`, with the server, without it, and with nothing |
| `usage.test.ts` | Which of the plugin's skills and agents are observed and which are not, that commands are counted, that nothing is written with the setting off and a failed write never fails a call, and `/academic usage` |
| `seen.test.ts` | The record the module leaves at session start: its name and content, and that a failure to write it never fails the start |

### The node suites

| File | What it checks |
|---|---|
| `tests/scripts/build.test.mjs` | The skills, prompt and agent builds, and their drift checks |
| `tests/scripts/tasks.test.mjs` | The task mapping against upstream's own `submitAcademicTask`, for 11 prompts at 4 efforts |
| `tests/scripts/ui-core.test.mjs` | The status text, the pane's parts and layouts, the readers of jobs and the notebook |
| `tests/scripts/fit.test.mjs` | What is left out, the restore setting, the wording rules, that nothing built names a tool that is not served |
| `tests/scripts/sync.test.mjs` | The snapshot digest, and fetching without a checkout (a throw-away repository stands in for GitHub) |
| `tests/scripts/doctor.test.mjs` | The doctor's report, including the hooks module and the Claude Code version, and that it never prints a key |
| `tests/scripts/usage.test.mjs` | The recorder, the invalid-call count, the files added up, the report, that arguments are never kept, the host that counts its calls, the doctor's line, and that the hooks module and the server agree on the files and the command list |
| `tests/scripts/compat.test.mjs` | Which versions are ok, warned about or only said; that the hooks module and the server name the record the same way; the CI matrix |
| `tests/scripts/update.test.mjs` | The update report's comparison |
| `tests/scripts/docs.test.mjs` | Every markdown link and path resolves, and every page is reachable from the indexes |
| `tests/server/host.test.mjs` | The protocol, the registry, schemas, the context, rendering, the server over stdio, and the three modes of argument validation at the host |
| `tests/server/validate.test.mjs` | The argument check's rules, that no message holds a value, and every served tool's schema against it |
| `tests/server/parity.test.mjs` | The served surface against upstream's |
| `tests/server/guard.test.mjs` | The guard bridge (with a stand-in engine and the real one), engine status, the sync keep rule |
| `tests/server/jobs.test.mjs` | The jobs service, upstream's `runAsJob` over it, the model route against a stand-in `claude` |
| `tests/server/papermemory.test.mjs` | The PaperMemory launcher, with installs into a scratch folder |
| `tests/server/detached.test.mjs` | A worker that outlives the process that started it, and the writing engine's build run that way (a shell script stands in for uv) |
| `tests/server/bootstrap.test.mjs` | Where the snapshot is looked for, the first-start fetch, two servers starting together, the swapped host |

## Upstream's own tests

`node scripts/test-upstream.mjs --all` runs every upstream test against the snapshot (125 of 125; six about DeepSeek Harness's own client and release tarball are excluded by name). `node scripts/test-engine.mjs --all` runs the writing engine's own suite in a scratch environment under `~/.cache` (519).

## Live scripts (`tests/live/`)

All write under `~/.cache/ah-cc-*`, use Haiku, and cap spending per run. They need a working `claude` login unless noted.

| Script | What it shows | Cost |
|---|---|---|
| `p1.mjs` | The agents, skills, `/academic`, both servers connected; research mode off outside a project and on inside; a skill loads; PaperMemory answers | cents |
| `p2.mjs`, `p2-config.mjs` | The tool host from a real session; a key saved with `claude plugin configure` reaches an installed copy's server (scratch configuration, no login needed) | cents |
| `p3.mjs` | The guard: 15 scenarios, each a nested session that tries to get past it | about 30 cents |
| `p3-tui.mjs` | The guard and the approvals with Claude Code's own dialogs, in tmux (6 checks) | cents |
| `p4.mjs`, `p4-tui.mjs` | Jobs, the model route, compute approval, a deep research run; in tmux, a job ends and the model reports with no polling | about 10 cents |
| `p5.mjs` | The task commands headless (no model turn), errors, `/fold`, a deep research run from `/ah-research` | cents |
| `p5-tui.mjs` | The status line, the pane docked, wide and narrow, a job from start to notice (tmux) | about 10 cents |
| `p6.mjs` | `/academic doctor` in a session; a fresh clone with no source checkout set up from GitHub; the update procedure to a different commit and back (network) | cents |
| `fit.mjs` | The catalogue (skills, agents, tools), `restore_tools`, papers searched with `literature_search`, an on-demand skill | cents |
| `install.mjs` | The first start of an installed copy: the doctor answers at once, the snapshot is fetched, the list changes (`first_start`: network, no Claude); installed from a local marketplace into a scratch configuration (`marketplace`) | cents, network |

A live script prints `name: ok: ...` or `name: FAIL ...` per scenario and exits 1 if any failed. `tests/live/p3.mjs` also prints `name: BLOCKED ...`: not a verdict, because the environment stopped the run (no login, the account's usage limit, a killed child) or the model declined to make the call, so the guard was never exercised. Rerun a blocked scenario; p3 exits 2 when some were blocked and none failed. Run one by name: `node tests/live/p5.mjs papers errors`.

## Writing a test

- A hooks test stands in for the engine with `on('event', ...)` hooks registered *before* the first call on `$`; a call on `$` is answered `{ value }`, an event by its own result; `mock.clock(on)` drives timers; `mock.env(on, vars)` the environment. `$.classic.X` stamps its own `cwd`, so pass one.
- A server test spawns `server/bin/ah-mcp.mjs` with `AH_MOD_HOME` under `~/.cache` and kills what it spawned when the file ends; a failing test must not leave a server running (`node --test` waits for it).
- A test that needs a model or the network is a live script, not a unit test.
