# Wrap-up after P6

What was done after the last phase, so nothing of the plan stays open apart from the live runs. 2026-11-16.

| Item | What was done |
|---|---|
| Install from the marketplace | `.claude-plugin/marketplace.json` makes the repository its own marketplace (`/plugin install academic-harness --marketplace raktim-mondol/cc-mod-academic-harness`). An installed copy has no snapshot, so the server fetches it on first start: `server/src/bootstrap.mjs` fetches the locked commit from GitHub into `<home>/upstream/<commit>`, verifies it against the lock and runs `npm ci`; `late-host.mjs` lets the server answer `initialize` with the `doctor` tool at once and swap in the full list, with `tools/list_changed`, when it is done. Two servers that start together (the PaperMemory launcher too) share one fetch through an exclusive state file |
| `literature_watch` on a schedule | `/ah-watch` runs the saved searches that are due and prints what is new; `/loop 1d /ah-watch` makes it regular. The `research-monitoring` skill says so |
| The three `coscientist` tools | Kept as three. Decided, not deferred: the split follows upstream's two halves of the action set, one tool would mean editing upstream's code, and each description says which half it is |
| Documentation | Restructured into a guide, design notes, maintenance notes and history, each folder with its own index; a README in each hand-written component folder; a test that every link resolves and every page is reachable ([docs index](../README.md)) |
| `CHANGELOG.md` | Added |
| Version | 0.4.0, not tagged |

## Written but not run

The live scripts for the new work are written and have not been run, as agreed; run them before tagging ([Releasing](../maintain/releasing.md)):

- `node tests/live/install.mjs first_start`: the server on its own, no copy of the snapshot, a real fetch from GitHub and `npm ci`.
- `node tests/live/install.mjs marketplace`: installed from a local marketplace into a scratch configuration.
- The earlier live scripts (`p1` to `p6`, `fit`) last passed before these changes; `p3` and `p5` exercise the paths that changed most (the server's startup, the commands).

What is covered without them: the fetch with a throw-away repository standing in for GitHub and a stand-in for npm, the state file and two servers, the host swap over in-memory streams, `/ah-watch` through the hooks tests, the marketplace file through `claude plugin validate`.
