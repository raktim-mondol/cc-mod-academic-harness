# Changelog

## 0.4.0 (not tagged)

- **CI on GitHub** (`.github/workflows/ci.yml`): the node suites on Node 22 and 24 after a fresh `setup.mjs --github` (no source checkout), the manifest and tool-parity checks, and `claude plugin validate --strict` and `claude plugin test` on each Claude Code version the mod was seen on (which must pass) and on `latest` (which only reports).
- **The doctor checks the hooks module and the Claude Code version.** The module leaves a small record at session start; the doctor says whether it loaded in this session, which Claude Code is running, and warns when that is older than the oldest version the mod was seen working on (2.1.325) or when the module never reported.
- Fixed, found by the first CI run: a tool call's time limit used a timer that does not keep the process alive, so on Node 22 a process with nothing else pending was ended before a hung tool's limit. The limit is now an ordinary timer, cleared when the call ends.
- **Hardening after the review.** The model budget is held exactly (calls that run together reserve their caps, so together they cannot pass `llm_budget_usd`). A long system prompt goes to the model child by file, not as an argument. A source snapshot that an update left behind is removed a week after its last use (`AH_SNAPSHOT_KEEP_DAYS`), and clipped tool output after 30 days (`AH_TOOL_OUTPUT_KEEP_DAYS`). The task commands refuse a link that leads outside the session folder. The plugin has an icon.

- **Install from the marketplace.** The repository is its own marketplace (`/plugin install academic-harness --marketplace raktim-mondol/cc-mod-academic-harness`). An installed copy, or a clone nobody set up, fetches the engine code on first start, verified against `UPSTREAM.lock.json`; until it is done the server offers the `doctor` tool and then swaps in the full list.
- **`/ah-watch`** runs the saved literature searches that are due and prints what is new (`/loop 1d /ah-watch` to schedule).
- Fixed after a review of the whole repository:
  - A download that does not match the lock is now refused before anything is replaced. It used to become the snapshot first and fail afterwards, so a clone that already had its dependencies would load it on the next start.
  - The first-start fetch failed on a machine with no `~/.cache` folder, and a download that hung never ended (it now gives up after five minutes).
  - The fetch refuses to run with `AH_UPSTREAM` set: the folder it replaces would be a source checkout.
  - `AH_NO_ENFORCE=1`, which the guard's own refusal names as the way to work without it, did nothing when the engine was not built: every edit stayed refused.
  - `/academic doctor` kept reporting an old failed fetch after `node scripts/setup.mjs` had repaired the snapshot.
  - Job records and logs were kept for ever, and the status line and the notices read all of them every few seconds. Those that ended more than 30 days ago are removed when a server starts (`AH_JOBS_KEEP_DAYS`).
  - The server now reports the plugin's version from `plugin.json` (it was a second copy of the number), says at start when the snapshot is from another version than the lock, and reads a PaperMemory database whose path holds `?`, `#` or `%`. `/academic doctor  --online` with extra spaces works.
- **Documentation** in a guide, design notes, maintenance notes and history, with a README per folder and a test that the links resolve.

## 0.3.0

- **Fresh clone with no source checkout**: `node scripts/setup.mjs` downloads the pinned commit from GitHub and verifies it against a digest in the lock. `server/src/snapshot.mjs`.
- **`/academic doctor`** and a `doctor` tool: what is ready, what is not, key names never values.
- **`node scripts/update-upstream.mjs`**: reports what a newer Academic Harness commit changes for the mod, and applies it.
- **Fit review.** 15 tools, 15 skills and 1 agent that Claude Code already covers are left out (`restore_tools` brings most tools back); 17 skills moved to on-demand; the research-mode text rewritten for Claude Code (about 2,900 tokens, from 4,700); passages of the guides and briefs that gave advice wrong for Claude Code rewritten.
- **Task commands** `/ah-research`, `/ah-review`, `/ah-papers`, `/ah-references`, `/ah-write`, `/ah-analyze`, `/ah-hypotheses`; `/fold`; a status line; a pane (`/academic`).
- Fixed: the writing engine's stamp never matched after the installer built it; PaperMemory's build output made the snapshot look edited.

## 0.2.0

- The tool host (134 of Academic Harness's 136 tools), the writing-engine guard and approvals, background jobs and the model route, completion notices, paid-compute approval. Audit of the first four phases.

## 0.1.0

- Skills, research mode, PaperMemory and the specialist agents.
