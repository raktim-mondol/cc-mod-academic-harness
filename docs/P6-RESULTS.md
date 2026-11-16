# Phase P6 results

P6 as planned was "remaining surface, packaging, release". Each item was asked the same question as in the fit review (`docs/FIT-REVIEW.md`): does it make the mod better for the person using it, or only repeat what Claude Code already does? Two items went, three were not built, and the rest made the mod reproducible and maintainable. 2026-11-16, Claude Code 2.1.325, upstream `a3f17eb` (0.54.1).

## Decided

| Plan item | Decision | Why |
|---|---|---|
| `zvec_index` and the zvec-grep daemon | **Dropped** | An HTTP MCP server with its own lifecycle, an embedding provider, a first-run package install and background indexing. Claude Code searches with Grep and Glob, PaperMemory indexes the papers, and the folders a researcher keeps do not warrant a daemon. Its `workspace-search` guide went in the fit review |
| `ah_rsi` and the self-improvement hooks (D10) | **Dropped** | It records turns, writes its own lessons and injects them into later turns without asking. Claude Code has memory and `CLAUDE.md`, which the person controls, and `papermemory_lesson` keeps writing rules on request |
| `academic-harness:pro` and a vision agent | **Not built** | A Claude Code agent takes a `model` of its own, and the session model reads images with `Read` |
| esbuild bundle of the server | **Not built** | The server answers `initialize` at once and lists its tools in under a second; a bundle would need to follow dynamic imports of 100 modules and native dependencies to save nothing a person can feel. Dependencies are 115 MB, installed once |
| Marketplace entry, a release | **Not done** | Sharing is for when you ask. A marketplace install would also need the snapshot to be fetched into a persistent folder at first use; `scripts/setup.mjs` is that step for a clone, and the rest waits for the ask |

After this, nothing in Academic Harness's 136 tools is waiting for a later phase: 121 are served, 15 are left out on purpose, each with a reason (`server/src/fit.mjs`).

## Built

| Piece | Where | Notes |
|---|---|---|
| Fresh clone with no source checkout | `scripts/setup.mjs`, `scripts/sync-upstream.mjs` | `setup` takes the snapshot (from the checkout when it has the commit, else downloaded from GitHub, which is public), installs the dependencies and the engine, checks `plugin.json`, and prints the doctor's report. `--helpers`, `--no-engine`, `--github` |
| A digest of the snapshot | `server/src/snapshot.mjs`, `UPSTREAM.lock.json` (`treeSha256`, `fileCount`) | One digest over the path and content of every file, without what installers generate (`node_modules`, `.venv`, `__pycache__`, the engine's stamps, PaperMemory's build output). A download of the locked commit must match it or it is refused, and the lock is left alone. **The real download of `a3f17eb` holds the same 3,276 files and the same digest as `git archive`** |
| `/academic doctor`, the `doctor` tool | `server/src/doctor.mjs`, `doctortool.mjs`, `server/bin/ah-doctor.mjs`, `hooks/doctor.ts` | Node, the snapshot against the lock, dependencies, the engine, the Claude Code CLI, `uv`, PaperMemory's CLI and library, TextFold, the helpers, LaTeX, which keys are set (names only), jobs, what is left out, and with `--online` whether upstream has moved. The command asks the running server (so it sees the keys saved in the plugin's options and which modules loaded or failed) and falls back to a fresh process when the server is not there |
| The update procedure | `scripts/update-upstream.mjs`, `scripts/update-lib.mjs` | Takes a candidate commit in a scratch folder, loads its tools with the current dependencies and compares: tools added, removed, changed; prompt sections, and whether the ones `research-mode.md` was written from changed; core skills; settings fields; dependencies; modules nobody has classified. `--apply` stops when a decision is needed, else syncs, installs, builds, checks parity and runs the tests |
| Docs | `docs/USER-GUIDE.md`, `README.md` | Set up, what it adds, settings and switches, where things live, troubleshooting, updating |
| Version | `plugin.json` 0.3.0 | |

## Verification

| Check | Result |
|---|---|
| `node --test` (scripts and server) | 212 pass. New: `sync.test.mjs` (6: the digest, and a download of a throw-away repository equals `git archive`'s snapshot, is refused when the digest differs, needs a full commit, re-records the lock for a newer commit), `doctor.test.mjs` (7), `update.test.mjs` (5) |
| `claude plugin test .` | 74 pass (6 new in `doctor.test.ts`) |
| `validate`, `tsc`, `build-manifest --check`, surface parity | pass; 136 registered, 121 served, 15 left out, none waiting |
| Live, `tests/live/p6.mjs doctor` | `claude -p "/academic doctor"`: the server's own report, snapshot verified, a key named and its value not shown, no model turn |
| Live, `p6.mjs fresh` (the phase's exit) | A copy of the repository's files with no `upstream/`, `AH_SOURCE` pointing at nothing: `setup.mjs` downloaded the pinned commit from GitHub, matched it to the lock, installed 59 packages and built the engine; a session loaded it, the `ah` server connected with **126 tools**, `/academic doctor` and `/ah-papers` answered, and PaperMemory's CLI and TextFold installed themselves into the scratch home. Cost 0 |
| Live, `p6.mjs update` | In that clone, from 0.54.1 down to 0.54.0 and up again to the newer 0.54.1 (the checkout holds no commit newer than the pinned one, so the older commit was the way to have a newer one to apply): report, apply, parity ok, and all tests pass; 16 s for the second apply, from GitHub |
| Earlier live suites | `p1` (21 agents, 55 skills, 126 tools), `fit`, `p3` (15 scenarios), `p5`, `p5-tui` pass |
| Source checkout and `~/.dsh` | `check-upstream-clean.mjs` clean |

## What running it found

- **The engine's stamp never matched after a build by the installer.** The marker file that holds a running build's pid was inside the hash when the stamp was written, so a fresh install read as "the engine changed since its environment was built" and the server would have rebuilt it on every start. Missed until a clone was built from nothing. The marker is outside the hash now (`engine.mjs`), with a regression test.
- **Installing PaperMemory leaves `build/` and `*.egg-info` in `vendor/papermemory` of the snapshot.** They are not part of what upstream shipped, so the digest ignores them; without that, every snapshot that had run a session reported itself as edited.
- **A failing server test left its server running, and `node --test` waited for it for eleven minutes.** The server tests now kill what they spawned when the file ends.
- **A key reaches the server as `AH_KEY_<NAME>` from the plugin's options, and the options' own empty value replaces a shell variable of that name.** So the new `restore_tools` setting arrives as `AH_RESTORE_TOOLS_SETTING` and the host reads it together with `AH_RESTORE_TOOLS` (found by the live `restore` check, fixed in the fit review).
- The terminal check of `/ah-papers` depended on the first line of a long result being on screen; it now waits for the last.

## Known limits

- A marketplace install is not supported: the snapshot is fetched by `setup.mjs`, not at first use. When you want to share the mod, the first start of the server could fetch it into the plugin's persistent data folder; that is the one piece left, and it comes with the ask.
- `setup` downloads about 17 MB from GitHub and 115 MB of npm packages the first time; the engine and the helpers need PyPI.
- The update report loads the candidate's tools with the current dependencies; a changed `package-lock.json` is reported, and `--apply` installs it, so a tool that needs a new package shows as a load error in the report until then.
- Linux only, as upstream.
