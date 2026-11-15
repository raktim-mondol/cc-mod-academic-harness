# Phase P4 results

The rest of the tool surface, long-running work and the model route. Measured on Claude Code 2.1.325 against upstream `a3f17eb` (0.54.1) on 2026-11-16.

## What was built

| Piece | Where | Notes |
|---|---|---|
| Remaining modules | `server/src/manifest.mjs` (new areas) | `reviews`, `tournament`, `analysis`, `provenance`, `study`, `data`, `submission`, `deep`, `compute`, `figures`. The host serves **134 of 136** upstream tools, plus 4 of its own (`job_status`, `job_wait`, `job_log`, `job_kill`). Not served: `zvec_index` (P6, a mount) and `ah_rsi` (D10, P6) |
| Jobs service | `server/src/jobs.mjs` | The shape `job-runner.js` expects (`start`, `wait`, `kill`; a job with `append` and `updateProgress`), kept on disk: `<home>/jobs/<id>.json` and `.log`. A record names its session and folder. A running record whose server has gone reads as `interrupted`. Upstream's `runAsJob` runs over it unchanged |
| Detached calls | `server/src/host.mjs` | `deep_research`, `deep_review` and `analysis_run` run as a job the host owns (`bindParentJob`, upstream's own adoption path). The call waits `AH_JOB_FOREGROUND_MS` (30 s), then answers with the job id and the work goes on. Cancelling the call inside the window kills the job. A result handed to the model (inline, `job_status`, `job_wait`) is marked delivered and gets no notice |
| Job tools | `server/src/jobtools.mjs` | `job_status` (one job with its result, or this session's list), `job_wait` (at most 120 s a call), `job_log`, `job_kill` |
| Model route | `server/src/llm.mjs` | Decision D7, candidate A: `ctx.llm.stream` answered by `claude -p --safe-mode --tools "" --output-format json --no-session-persistence`. No key, about 2 s a call, no plugin, hook or MCP server in the child (so it cannot call this mod back). Chunks are the ones upstream reads: `text-delta`, `usage`, `finish`. Spend is counted from the child's own cost report; each call is capped at $1 and the server run at `llm_budget_usd` ($5) |
| Paid compute | `hooks/approvals.ts`, `server/bin/ah-approve.mjs` | `tool.check` on `modal_run`, `runpod_run`, `vastai_run`: always `ask`, with upstream's `computeApprovalReason` (provider, instance, time limit, cost ceiling, session budget). A run over the session cap is `deny` with the numbers. If the approval script fails the call still asks. The tools enforce the cap again themselves (`compute-ledger.js`, under the mod's home) |
| Completion notices | `hooks/notices.ts`, `hooks/jobs-core.ts` | Interactive sessions only. A timer reads this session's job records every 4 s. An ended one raises a notification and, with `job_notices=prompt` (default), queues a one-line prompt so the model reads the result and carries on |
| Python helpers | `scripts/install-helpers.mjs` | `uv sync --frozen --no-dev` in `upstream/python-helpers` (772 MB). Optional: without it a tool uses `python3` and says which import it lacks. A sync keeps the venv when `uv.lock` and `pyproject.toml` are unchanged |
| Settings | `llm_model` (sonnet), `llm_budget_usd` (5), `job_notices` (prompt), and the key fields for compute, image, Gemini, FutureHouse, TypeSafe, co-scientist, deep review and rebuttal | `NOT_YET` now holds only the subagent and zvec fields (P6) |
| Tests | `scripts/test-upstream.mjs --all` | Every upstream test except six about DSH's own client and release tarball: 125 of 125 pass |

## Verification

| Check | Result |
|---|---|
| `node --test 'tests/server/*.test.mjs' 'tests/scripts/*.test.mjs'` | 98 pass (21 new in `jobs.test.mjs`: the service, upstream's `runAsJob` over it, the model route against a stand-in `claude`, detached calls, kill, cancel, delivered results) |
| `claude plugin test .` | 41 pass (7 new: compute asks, denies over the cap, still asks when the script fails or cannot start, passes the cap setting, leaves other tools alone; 5 for the notices through the mock clock) |
| `claude plugin validate .`, `tsc`, `build-manifest.mjs --check` | Pass |
| Surface parity | upstream registers 136; the host serves 134 of them, identical descriptions and parameters (after the wording fix); the 2 left are named above |
| Upstream's tests, `--all` | 125 of 125 (the 6 DSH-only ones excluded by name in `test-upstream.mjs`) |
| Direct, real model route, low-effort deep research on Haiku | start, run and wait: 6 model calls, 2 minutes, **$0.017**, a cited report on disk. 246 sources swept, cite check 16 cited, 1 challenged |
| Live, nested `claude -p` (`tests/live/p4.mjs`) | `deep_research` (the model starts and runs it, follows the job with `job_wait`, the report is on disk, every job record `completed`; $0.024 for the session, the model route's calls are extra), `compute_ask` (refused under `-p` with the approval text, no ledger entry), `power` (a tool from a new area: 64 per group), `job_surface` (all six names found by `ToolSearch`) |
| Live, interactive terminal in tmux (`tests/live/p4-tui.mjs`) | start, run and show each went on as a job; each ended with the notification and the prompt "Background job job-... finished"; the model read the result and gave the answer (RAG, Lewis et al. 2020, arXiv:2005.11401) **with no `job_wait`**. This is the plan's start-to-notice-to-report exit |
| Source checkout and `~/.dsh` | `check-upstream-clean.mjs` clean |

## Decisions taken in P4

1. **D7: the model route is a headless Claude Code child** (candidate A). The spike: 2.1 s for a one-word answer, $0.0001, no key. Candidate B (the Anthropic API) was not built; it needs a key the user may not have, and costs the same tokens.
2. **A long call detaches instead of blocking.** DSH holds the tool call for the whole run. Here the call answers after 30 seconds, because a session that cannot talk for 20 minutes is worse than one that is told when the job ends. Set `AH_JOB_FOREGROUND_MS` high to get DSH's behaviour, which is what a non-interactive run wants.
3. **The host adopts the job** with upstream's `bindParentJob` rather than answering `ctx.jobs.start`, so `runAsJob` never waits on, or kills, a job the host is detaching. `ctx.jobs` is still a full service for any module that starts its own.
4. **Jobs belong to the server process.** A job ends with the session (the server is killed with it). A record that says `running` whose process is gone reads as `interrupted`; deep research resumes from its own store (`action: resume`), so work is not lost, only the process.
5. **Compute asks in every folder.** The reason text and the cap are upstream's, produced by a script in the mod (the hooks module has no Node). The cap setting is the only key field passed to the hook, since it is not a secret.
6. **Notices only in interactive sessions**, and never for a result the model already has.
7. **Python helpers are optional**, because they are large.

## Costs the user will see

- 136 tools: names are about 6,250 characters always visible (about 1,600 tokens); their schemas are about 297,000 characters (about 74,000 tokens) and load only when a tool is looked up with `ToolSearch`. Server start 0.3 s.
- Always-on research section: 4,627 tokens (was 4,423), from the added notes about jobs and compute.
- Disk: `upstream/` is about 975 MB with the helper venv (772 MB); none of it is committed.
- Model calls from deep tools: a low-effort deep research run is about 2 cents on Haiku. The default model is Sonnet, so expect several times that; `llm_model` and `llm_budget_usd` change it.

## Open items

- **A job dies with its session.** The notice path needs the session open. Closing Claude Code mid-run ends the job; `deep_research` `resume` continues from the store, but nothing resumes it by itself.
- **`deep_review` was not run live.** Its engine bridge (an HTTP front end on `ctx.llm`) was not exercised; upstream's own tests for it pass. `analysis_run` and the compute tools with real keys and money were not run either.
- **The model route ignores `temperature`** (the child has no flag) and takes `maxTokens` through `CLAUDE_CODE_MAX_OUTPUT_TOKENS`.
- **The prompt queued by a notice appears as "Prompt from the academic-harness plugin"** and the model may reply that a job it already read about is a duplicate. Delivered results are not announced, but a notice for a job read a moment earlier can still land.
- **Plan mode, subagent-started jobs and several concurrent sessions** sharing one mod home were not tried. Records carry the session id, so notices stay per session.
- **Descriptions still say DSH in places** (kept identical to upstream for the parity check).
- **`zvec_index`, `ah_rsi`** are P6. (`paper_mcp`, `paper_backfill` and the dream pass were added by the audit, `docs/AUDIT-P0-P4.md`.)
