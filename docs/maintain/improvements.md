# Improvements to make

What came out of the review of the whole repository on 2026-11-16 and was not fixed in it. Nothing here is broken today. The eight defects that review did fix are in [the changelog](../../CHANGELOG.md). Tick an item when it is done.

## Small, code only (done)

Done together, each with a test. The rows stay as a record of what was changed and why.

| # | Done | What | Why | Where |
|---|---|---|---|---|
| 1 | [x] | Hold the model budget exactly: reserve each call's cap before it starts | Up to four model calls run at once and each is capped at $1, so a run can pass `llm_budget_usd` by a few dollars before it stops | `server/src/llm.mjs` |
| 2 | [x] | Remove old snapshots at server start: any `<home>/upstream/<commit>` that is not the locked commit | After an update the previous folder stays, about 170 MB plus the engine's environment | `server/src/bootstrap.mjs`, `server/bin/ah-mcp.mjs` |
| 3 | [x] | Remove clipped tool output after 30 days | Files under `<project>/.dsh/tool-output/` are written and never cleaned up | `server/src/render.mjs`, `server/src/host.mjs` |
| 4 | [x] | Send the system prompt to the model child by file or standard input | It goes as a command-line argument, and one over about 128 KB would stop the child from starting. Today's prompts are far below that | `server/src/llm.mjs` |
| 5 | [x] | Resolve symbolic links in the task commands' file check | A link inside the session folder that points outside it passes the check | `hooks/tasks.ts` |
| 6 | [x] | Add a plugin icon | It is the one warning `claude plugin validate .` still gives | `.claude-plugin/icon.png`, `scripts/make-icon.py` |

## Worth adding

| # | Done | What | Why |
|---|---|---|---|
| 7 | [ ] | CI on GitHub: on every push run `node scripts/setup.mjs --github`, the node suites, the type check and `node scripts/build-manifest.mjs --check` | These checks run today only when someone remembers to |
| 8 | [ ] | A Claude Code version check in the doctor: show the running version, warn when it is not one that was tested or when the hooks module did not load | The mod part has only been seen working on 2.1.325 |
| 9 | [ ] | A weekly upstream check: a scheduled workflow that runs the `node scripts/update-upstream.mjs` report and opens an issue when Academic Harness has moved | Academic Harness is released often, and nothing says so unless someone asks (`/academic doctor --online`) |
| 10 | [ ] | Local usage counts: which tools and skills are called, as names and counts only, kept in the mod's home and shown by the doctor | It turns "which skills never load" into data for the next review of what to leave out |

## Only the owner can do

| # | Done | What | Why |
|---|---|---|---|
| 11 | [ ] | The live runs in [What to do next](next-steps.md), above all step 4, the marketplace install | It is the largest unknown left, and no code change replaces it |
| 12 | [ ] | The licence review noted in [the architecture page](../design/architecture.md) | Needed before the repository is shared beyond the people invited to it |

## Order

Items 1 to 6 are done. Then 7 and 8, then 9 and 10. Items 11 and 12 do not wait on any of them.

## Not read line by line

The review read the server, the hooks module and the setup scripts in full. These were left to their tests: the build and update scripts (`scripts/adapt.mjs`, `scripts/update-lib.mjs` and the `build-` scripts), `hooks/ui-core.ts`, and the generated skills and agents. A second pass would start there.
