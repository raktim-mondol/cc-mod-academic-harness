# Phase P3 results

Writing engine and guards. Measured on Claude Code 2.1.325 against upstream `a3f17eb` (0.54.1) on 2026-11-16.

## What was built

| Piece | Where | Notes |
|---|---|---|
| Engine in the snapshot | `scripts/sync-upstream.mjs` (allow-list `vendor/academic-harness`), `scripts/install-engine.mjs`, `server/src/engine.mjs` | The Python engine (`ah`) is synced like the rest. Its venv is built **inside** `upstream/vendor/academic-harness/.venv` (upstream's own layout, found by `academic-harness-cli.js` with no setting), by `node scripts/install-engine.mjs` (uv, else `python -m venv`; 0.5 s warm). A stamp holds the SHA-256 of the engine's files. A sync keeps the venv when the engine is byte-identical, and drops it when it changed. In development mode (`AH_UPSTREAM`) nothing is ever built in a checkout |
| `ah_*` tools | `server/src/manifest.mjs` (new area `writing`: `academic-harness.js`) | 38 tools. The host now serves 73 of 136. They run the engine's CLI in the project (`<cwd>/.ah/`). With no engine, a call says to run `install-engine.mjs` |
| Guard bridge | `server/bin/ah-hook.mjs` | `node ah-hook.mjs <userprompt\|pre\|post\|stop>`: payload on stdin, the engine's stdout and exit code back unchanged. Resolves the engine with upstream's `resolveAhLaunch`, `findAhRoot`, `ahEnv`, `run`. Exit 3 when there is no engine, 124 when the engine overran (110 s). Logs to `<project>/.ah/claude-hooks.jsonl`, apart from DSH's `dsh-hooks.jsonl`. About 0.14 s a call; 0.03 s outside a project |
| Guard | `hooks/guard.ts`, `hooks/guard-core.ts` | Function hooks on `classic.UserPromptSubmit`, `classic.PreToolUse`, `classic.PostToolUse`, `classic.Stop` |
| Approvals | `hooks/approvals.ts` | `tool.check`: `ah_author` asks (the act is named in the reason; under `-p` the reason adds "run it from an interactive session"). `ah_migrate` with `apply` and no `confirm` is denied |
| Setting | `evidence_check` (`skip` default, `run`) | The advisory evidence check at the end of a turn calls a verifier model once per changed paragraph. It is off unless chosen |

### How the guard behaves

- **Outside an `ah.yaml` tree**: every hook returns at once, no process is started. A found project root is remembered; a miss is not, since `ah_init` can create one.
- **PreToolUse** runs for `Write`, `Edit`, `MultiEdit`, `NotebookEdit` and `Bash` only. The envelope `{ tool, tool_use_id, ...arguments }` is rebuilt into the settings-hook payload (`tool_name`, `tool_input`, `session_id`, `cwd`). An engine `deny` becomes `{ deny }`; otherwise `next(e)` (never `allow`, which would skip the permission prompt).
- **Fails closed.** The engine's own Python wrapper already denies a mutating call when it crashes. On top of that, the hooks module denies when the process cannot start, overruns, exits non-zero, or prints something that is not JSON, and a `.catch` handler denies when the hook itself throws (it starts no process, within its one-second budget). The denial text says what to do (`node scripts/install-engine.mjs`, or `AH_NO_ENFORCE=1`). Reads pass.
- **PostToolUse** adds the engine's note as `additionalContext`. A failing post check never blocks (it is advisory, and the stop gate recomputes from file hashes).
- **UserPromptSubmit** adds the paper-state card. The card's "commands run in your shell as `ah ...`" sentence is dropped, and a footer names the `ah_*` tools (Claude Code has no `ah` on the shell's path). In the engine's denials, `` `ah finding decide ...` `` reads as the `ah_decision_request` tool.
- **Stop** maps the engine's answer: a `block` keeps the turn going (up to the engine's own cap, 3); the give-up message is delivered once as a final block ending "STOP. Report these findings to the author", then the turn ends. "Delivered once" is kept in `$.state` per session and cleared by the next prompt.

## Verification

| Check | Result |
|---|---|
| `node --test 'tests/server/*.test.mjs' 'tests/scripts/*.test.mjs'` | 77 pass (16 new: the bridge with a stand-in engine and with the real one, engine status and hash, the sync keep rule) |
| `claude plugin test .` | 28 pass (19 new in `tests/guard.test.ts`: outside a project no process; the payload shape; deny; allow; fail closed on exit 3, on a throw, on non-JSON output for Write, Edit, NotebookEdit and Bash with a Read passing; post note; failing post; prompt card; stop block, handoff once, then quiet; `evidence_check`; `ah_author`; `ah_migrate`) |
| `claude plugin validate .`, `tsc -p . --noEmit`, `build-manifest.mjs --check` | Pass |
| The engine's own tests, in a throw-away venv under `~/.cache/ah-cc-p3/engine-test` (`scripts/test-engine.mjs`) | `test_claude_adapter.py`: 25 pass. Whole suite (`--all`): 519 pass in 53 s. The script refuses to run if the tests would import the snapshot's source tree instead of the installed copy |
| Upstream's 25 tier-1 test scripts (`scripts/test-upstream.mjs`) | 25 of 25 pass, with the engine in the snapshot |
| Surface parity (`scripts/measure-surface.mjs`) | ok: 136 registered upstream, 73 served, identical descriptions and parameters; the 63 not served are `later` |
| Live, nested `claude -p` Haiku, the mod loaded, a copy of the engine's own fixture project (`tests/live/p3.mjs`) | 11 of 11, about $0.20 in all (below) |
| P2 live scenarios rerun | search and key still pass |
| Source checkout and `~/.dsh` | `check-upstream-clean.mjs`: clean after every run |

Live scenarios (`node tests/live/p3.mjs`):

| Scenario | What was asserted | Cost |
|---|---|---|
| `protected_edit` | Edit or Write of `facts/facts.yaml` is denied ("protected"); file byte-identical | $0.019 |
| `protected_shell` | `echo >> ah.yaml` denied; file byte-identical | $0.018 |
| `author_shell` | `ah finding waive ...` denied ("only the author") | $0.016 |
| `anchor_loss` | a Write that drops `%% @unit` anchors denied ("anchor"); file byte-identical | $0.018 |
| `clean_edit` | a plain edit goes through, the post-edit check runs, the gate stays quiet | $0.021 |
| `gate_loop` | no MCP tool allowed, so the model cannot hand the finding over: the unbound number is caught by the post-edit note, the stop gate holds the turn 3 times, hands off once, and the turn ends (5 stop passes) | $0.030 |
| `gate_decision` | with the MCP tools allowed the model follows the card and calls `ah_decision_request`; the finding is `decision-needed` in the ledger and the gate stands down | $0.021 |
| `state_card` | the paper-state card reaches the model, which quotes its first line | $0.011 |
| `outside` | outside a project the write goes through and `.ah/` is never created | $0.016 |
| `broken_engine` | `ACADEMIC_HARNESS_CLI` pointing nowhere: Write refused with "could not be checked", the file not created, Read of `ah.yaml` allowed | $0.016 |
| `author_tool` | `ah_author` under `-p`: refused, reason names the act and says to run it interactively | $0.018 |

## Decisions taken in P3

1. **The engine's venv stays where upstream puts it**, `upstream/vendor/academic-harness/.venv`, so `academic-harness-cli.js` and the `ah_*` tools find it unchanged, and it is inside the snapshot (gitignored with the rest of `upstream/`). The mod adds a content stamp so a changed engine is never run from a stale venv.
2. **No install on first use.** The installer flags stay on (`ACADEMIC_HARNESS_SKIP_INSTALL=1`), so a hook or tool call never starts a five-minute build. A missing venv is a clear message and a fail-closed guard. P6 decides when the install runs.
3. **Hooks never answer `allow`.** A passing check calls `next(e)`, so the person's permission rules and modes still apply.
4. **The evidence check is off by default** (setting `evidence_check`). DSH asks the person before it spends model calls; there is no equivalent ask from a Stop hook here, so it is `skip` or `run`.
5. **Matchers are regular expressions** (`^(Write|Edit|MultiEdit|NotebookEdit|Bash)$`): `MultiEdit` is not a built-in tool of this Claude Code release, and the typed matcher refuses the name. The engine still handles it.
6. **`ah_migrate`'s rule moved to `tool.check`** (a deny there is the same refusal as DSH's `tools/pre-execute`).

## Costs the user will see

- 0.14 s per Write, Edit, NotebookEdit or Bash call in an `ah.yaml` project; 0.03 s for the first look and nothing for other tools. Nothing outside a project.
- `ah_*` tool names add about 1,700 characters to the always-visible tool list (the schemas stay deferred).
- Always-on research section: 4,423 tokens (was 4,227), from the added notes about the writing tools and the guard.
- Disk: the engine venv is small (pyyaml and the engine).

## Open items

- **Closed by the audit (`docs/history/audit-p0-p4.md`, item 8):** `tests/live/p3-tui.mjs` runs the interactive checks and `p3.mjs` now has all 15 scenarios. Earlier text: **The interactive terminal matrix** (`scripts/claude-host-test/tui_matrix.py`: the approval dialog for an allowed edit, no dialog for a protected one, the author's `!` waiver) was not run. Its pieces are covered separately: `tool.check` ask in a real dialog (P0, S6), the guard and gate in `-p` (here).
- **`evidence_check=run`** was only tested as far as the engine receiving `AH_T3_MODE=run`. A real verifier call needs a configured backend (`ah.yaml`, the `claude` CLI or a key) and costs per paragraph.
- **Plan mode with the `ah_author` ask** and subagents' tool calls were not tried. The PreToolUse envelope carries no `agentId` to the engine.
- **Closed by the audit (item 3):** the server builds the engine's venv in the background when it is missing. Earlier text: **The engine is not installed by a fresh clone.** `node scripts/sync-upstream.mjs`, `node scripts/install-deps.mjs` and `node scripts/install-engine.mjs` are the steps. P6 bundles them.
- **The guard sees the session's directory**, not a shell `cd`. A Bash command that `cd`s out of the project and writes relative paths is judged against the session directory, as in DSH.
- **`ah` is not on the shell's path.** The model is told to use the tools; a person who wants the CLI can run the venv's `ah` (`upstream/vendor/academic-harness/.venv/bin/ah`).
- **Descriptions still say DSH in places** (for example `ah_author`'s parameter text). Error text is adapted; descriptions are kept identical to upstream for the parity check.
