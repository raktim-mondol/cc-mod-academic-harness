# Audit of phases P0 to P4

Before P5 every work item and every exit criterion of P0 to P4 in `docs/history/implementation-plan.md` was checked against the code and
against a run, not against the earlier summaries. 2026-11-16, Claude Code 2.1.325, upstream `a3f17eb` (0.54.1).

The audit found work that had been reported as done and was not, and work the plan lists that had been skipped. All of it is
now built and shown by a run. What is left belongs to P5 and P6 by the plan's own assignment and is listed at the end.

## What the audit found and what was done

| # | Found | Why it mattered | Done |
|---|---|---|---|
| 1 | **`deep_review` could not run.** The engine it wraps, `vendor/open-deepreview`, was never in the snapshot (the allow-list stopped at `vendor/academic-harness` and `vendor/papermemory`). The P4 live run covered `deep_research` only, and the tool loaded, so parity was green | The tool answered with a missing-engine error | `vendor/open-deepreview` and `vendor/supervisor-skills` added to the sync. Live: a real manuscript review on the model route, 14 to 17 comments, about 50 s, under 2 cents on Haiku (`tests/live/p4.mjs deep_review`) |
| 2 | **Managed installs were off.** P2 set every installer flag to "skip", so TextFold (`paper_fold`) and the Modal SDK never installed. The plan says managed installs go to the mod's home, in the background | `paper_fold` answered "TextFold is not installed" | The flags stay on for the areas that need them (`notebook`/`submission` for TextFold, `compute` for Modal) and off for the engine, PaperMemory and zvec, which the mod installs itself. TextFold installed in 3 s into the mod's home and `paper_fold` reported ready. `AH_MANAGED_INSTALLS=0` turns it off |
| 3 | **The writing engine needed a manual step**, and a fresh install denied every mutating call with no way to tell why | A silent first-run failure | The server builds the engine's venv in the background when the writing area is loaded and the venv is missing (`server/src/engine-install.mjs`). While it builds, the guard says "being installed" instead of "missing". `AH_AUTO_INSTALL=0` turns it off |
| 4 | **Four tools were not served and nothing said why**: `paper_mcp`, `paper_backfill`, the PaperMemory dream pass, and (P6) `zvec_index`, `ah_rsi` | "Load the remaining modules by area" (P4 step 3) | New `memory` area. `paper_backfill` loads. The dream pass runs 20 s after the server starts (upstream runs it at session end, which a killed MCP server cannot do) and is hourly-stamped. `paper_mcp` works end to end: `server/src/mounts.mjs` is a small stdio MCP client that mounts a generated server and registers its tools, and the person's approval is an MCP elicitation form (`elicitation` is advertised by Claude Code; under `-p` it answers cancel, which is a refusal). Unit tests with a stand-in server, and a real terminal run: register, form, Accept, tool list refreshed, the model called the mounted tool. *Later dropped, with its machinery, in the fit review (`docs/design/fit-review.md`): Claude Code adds MCP servers itself* |
| 5 | **`roots/list` was never consulted** although S3 says the client answers it. After `/cd`, tools kept writing to the old folder | Notebook and ledgers in the wrong place | The server asks at start and on `notifications/roots/list_changed` and follows the answer. Tested over stdio, both ways |
| 6 | **Nothing stopped the host loading modules with `DSH_HOME` unset or pointing at `~/.dsh`**, which would have installed into the user's real DSH | Ground rule 2 was kept by habit | `createHost` refuses both. The parity script, which loaded every module in-process, now gives itself a scratch home |
| 7 | **The interactive sensitive-config path was never exercised** (the one P2 exit item shown only through `--settings`) | `--settings` may not match what a person's install does | `tests/live/p2-config.mjs`: the mod is installed from a scratch marketplace into a scratch Claude Code config, a fake key is saved with `claude plugin configure --values-stdin`, and a session's server receives it (length and hash match). On Linux the secure store is `.credentials.json` (0600): the value is there and in neither `settings.json` nor `.claude.json`, and in no output. The real config was untouched |
| 8 | **P3's live matrix covered 6 of upstream's 10 guard scenarios** and none of the interactive checks. The plan also names upstream's `fake-ah-engine.mjs` for the bridge tests | The exit says "the scenarios pass" | Added `new_acts`, `pty_trick`, `explicit_pty`, `hook_settings` and the ledger check to `author_shell` (15 scenarios in all). Added `tests/live/p3-tui.mjs`, the mod's counterpart of `tui_matrix.py`: a protected write gets no dialog; an allowed edit asks, No leaves the file, Yes writes it and the post-edit check runs; `ah_author` asks with the act named (No waives nothing; Yes waives the finding); `modal_run` asks with the cost ceiling and the session cap. The bridge is also tested with upstream's scripted engine |
| 9 | **P1's live checks were typed by hand, not kept**, and two P1 open items were never tried | A test that cannot be rerun is a claim | `tests/live/p1.mjs` (init, mode, skill, PaperMemory). The PaperMemory install without `uv` (the `python -m venv` fallback) is a test now and passes |
| 10 | **`deep_review` and `analysis_run` had no live run; paid compute had been shown only as a refusal under `-p`** | P4 exit: "compute tools always ask" | `analysis` and `deep_review` live scenarios pass. The compute approval was shown in a real dialog (`p3-tui.mjs compute_no`) |
| 11 | **Wording that was wrong for this host**: `skill_search` marked the six skills left out of the build "in the session catalogue"; descriptions said "DSH will ask"; a mounted server's tools were named without the plugin prefix | The model is told things that are false here | `skill_search` now says how to load a listed skill (`academic-harness:<name>`) and that a left-out one is left out. Descriptions and results go through the same wording fix, and the parity check compares after it |

## Work items and exit criteria

Each line is a plan item, the evidence, and where to rerun it.

### P0

| Item | State | Evidence |
|---|---|---|
| Git repository, `.gitignore`, `LICENSE`, `NOTICE` | done | repository on GitHub (private), files present |
| `plugin.json`, `hooks.json`, `register.tsx`, `types/index.d.ts`; a status entry at `session.start` | done | `claude plugin validate .`, `tsc`, `tests/mode.test.ts` |
| `scripts/check-upstream-clean.mjs` | done | run after every test in this audit: clean |
| S1 to S8 recorded | done | `docs/design/platform-notes.md`; S4's storage path completed by `tests/live/p2-config.mjs` (audit item 7), S3's `roots/list` by item 5 |
| Exit | met | validate, tsc, loads with `--plugin-dir` |

### P1

| Item | State | Evidence |
|---|---|---|
| `sync-upstream.mjs`, `UPSTREAM.lock.json` | done | 248 paths at `a3f17eb`; keeps the three venvs when their inputs are unchanged (`tests/server/guard.test.mjs`) |
| `build-skills.mjs` | done | 87 skills listed, 6 left out by D5; `tests/scripts/build.test.mjs` |
| `build-prompt.mjs`, on-demand guides, fails on drift | done | 29 guides; drift tests; always-on section 4,680 tokens |
| `hooks/mode.ts`, `/academic`, `prompt.compose` | done | `tests/mode.test.ts` (9); `tests/live/p1.mjs mode` |
| `papermemory-mcp.mjs` launcher, `PAPERMEMORY_CLI` | done | 14 tools; install without `uv` (audit item 9) |
| `agents/*.md` | done | 22 agents; `tests/live/p1.mjs init` |
| Tests: build unit tests, `mode.test.ts`, a nested run loading a core skill | done | `tests/scripts`, `tests/mode.test.ts`, `tests/live/p1.mjs skill` |
| Exit | met | |

### P2

| Item | State | Evidence |
|---|---|---|
| 1 `host.mjs`: initialize, tools/list, tools/call, cancellation | done | `tests/server/host.test.mjs`. Written without the MCP SDK (decision: the protocol surface is small; the SDK v2 in the dependencies was not needed) |
| 2 `context.mjs`, with named errors for unported services | done | context tests; `plugin`, `get`, `jobs`, `llm` are now real services |
| 3 `exec.mjs` | done | callId from `_meta`, session id from the environment, cwd now from `roots/list` |
| 4 `schema.mjs` | done | schema tests |
| 5 `manifest.mjs`, deny-list of host-only modules | done | 109 discovered modules; 15 areas |
| 6 `DSH_HOME` set before the first import; managed installs in the background | done after the audit | items 2, 3 and 6 |
| 7 Keys as environment variables, `userConfig` from `KEY_FIELDS` | done | 57 fields; delivered through `--settings` and through `claude plugin configure` (item 7) |
| 8 Render blocks, clip, full text to `<cwd>/.dsh/` | done | render tests |
| Tier-1 tools, tests, exit | met | parity (134 of 136 identical after the wording fix), upstream's tests 125 of 125, live search and key |

### P3

| Item | State | Evidence |
|---|---|---|
| 1 `ah_*` tools; the engine's venv inside the snapshot | done | 38 tools; `install-engine.mjs` and the background install |
| 2 `ah-hook.mjs` | done | 17 bridge tests, including the real engine and upstream's scripted engine |
| 3 `guard.ts`, four classic events, no process outside a project | done | 25 plugin tests for the guard and the approvals (paid compute included) |
| 4 Fail closed, with an explicit catch | done | exit 3, 124, throw and non-JSON cases; `broken_engine` live |
| 5 `approvals.ts` | done | `ah_author` asks, `ah_migrate` apply denied; dialog shown in a terminal |
| Tests: `guard.test.ts`, the engine's own adapter tests, the live matrix | done after the audit | engine suite 519; 15 scenarios; 6 terminal checks |
| Exit | met | |

### P4

| Item | State | Evidence |
|---|---|---|
| 1 Jobs service and `job_*` tools | done | 21 tests; upstream's `runAsJob` runs over it |
| 2 Model route; the chunk shape written down | done | `server/src/llm.mjs` header; D7 decided |
| 3 The remaining modules by area | done after the audit | 134 of 136; `memory` and the deep review engine added |
| 4 Python helpers | done | `install-helpers.mjs`, venv kept across syncs |
| 5 Paid compute: always ask; session budget | done | `tool.check` ask; refused over the cap; live dialog; the tools enforce the cap again |
| 6 Completion notices | done | notices tested with the mock clock; shown in a terminal |
| Tests: per-area upstream tests, jobs tests, one live deep research | done | 125 of 125; `tests/live/p4.mjs` (6 scenarios), `p4-tui.mjs` |
| Exit | met | |

## Left, and why it is not in P0 to P4

These are assigned to later phases by the plan itself (section 4.3 and phases P5 and P6). None is a P0 to P4 work item.

| What | Phase | Note |
|---|---|---|
| `zvec_index` and the zvec-grep daemon (an HTTP MCP server with a lifecycle) | P6 | `mounts.mjs` speaks stdio only |
| `ah_rsi` and the local self-improvement hooks | P6, decision D10 | port or drop is the user's call |
| `server/dist` bundle, `build-server.mjs`, installing dependencies on first use | P6 | a fresh clone needs `sync-upstream`, `install-deps`; the engine installs itself |
| Task commands, status line, pane, `/fold` (`hooks/tasks.ts`, `hooks/ui.tsx`) | P5 | |
| `/academic` in an interactive terminal | covered here only by `-p` and the plugin tests | it is a P5 surface |

Known limits, unchanged: a job ends with its session; the model route ignores `temperature`; `deep_research` with no
arguments at all hits a TypeError inside upstream's code (a model always passes an action).
