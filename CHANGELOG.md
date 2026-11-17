# Changelog

## 0.5.0 (2026-11-17)

- **A model router.** `/model-router on` (or the `model_router` setting) picks the model for each prompt: planning goes to Opus, coding to Sonnet, academic writing to Haiku, everything else and anything uncertain to Sonnet. One Jev request (TypeSafe) gives the probabilities and the plugin's own thresholds pick the model; without a TypeSafe key, or when Jev is slow, refusing or malformed, keyword rules decide. It routes the main conversation only and keeps a turn on one model; leaves subagents, non-Claude sessions and `[1m]` windows alone; follows plan mode; keeps the route through a go-ahead or a job's notice; and `[opus]`, `[sonnet]` or `[haiku]` at the start of a prompt overrides it. Off by default (it changes what a prompt costs: the first request to each model in a session writes the whole prompt prefix to that model's cache, $0.54 on Opus with 687 tools). `router_engine rules` keeps every prompt on the machine. See `docs/guide/model-router.md`.
- **One place for every key.** Each credential a tool can read is a plugin option, saved with `claude plugin configure` and kept in Claude Code's secure store; `docs/guide/keys.md` says how to save one, where it is stored, what wins over what, and what every key unlocks, and a test keeps the page in step with `plugin.json`. The keys of the restorable left-out tools (Brave, Tavily, Exa, Perplexity, Elicit) and three the engine's list did not name (`GITHUB_TOKEN`, `OSF_TOKEN`, `IMAGE_API_KEY`) are now offered too.
- Semantic Scholar requests are paced at one every two seconds across all tools when a key is set, under the key's one per second (`AH_S2_MIN_INTERVAL_MS` raises the gap). Before, the first tool to call Semantic Scholar set the gap, and three of them asked for exactly the limit.
- Fixed: `tests/live/p2-config.mjs` failed for anyone with a key exported in the shell.
- The diagrams in the documentation are Mermaid sources in `docs/assets/` rendered with Pele: the architecture page and the mod-anatomy page use colour diagrams, and the history page's two text diagrams became a colour diagram and a tree. The README has a colour architecture diagram (`docs/assets/architecture.mmd`, rendered to SVG with Pele), says the repository is public, and the copyright holder is named Academic Harness (formerly ResearchCraft) in `LICENSE`, `NOTICE` and the architecture page. The getting-started page and `CONTRIBUTING.md` no longer say the repository is private.

## 0.4.0 (2026-11-16)

- **Licence review, with the repository made public.** `NOTICE` now credits what is copied from other projects: the K-Dense MIT skills with their copyright lines, three Supervisor-Skills skills under CC BY 4.0 (with their changes), and the one reference file adapted from Wikipedia under CC BY-SA 4.0, and says what the plugin downloads on first start and under whose licences. The README and the architecture page say the same, and `tests/scripts/repo.test.mjs` fails when a copied skill's licence is not one the build allows or is missing from `NOTICE`.
- **One check command.** `npm run check` runs the node suites, the `plugin.json` check and the served-tool-surface check in one place; CI runs the same gate. `npm run typecheck`, `npm run test:plugin`, `npm run build` and `npm run doctor` cover the steps that need the engine's types or a real session.
- **Tool arguments are checked on the server.** Before a tool runs, `ah` checks the call's arguments against the tool's schema (`server/src/validate.mjs`, no dependency). `AH_VALIDATE_TOOL_ARGS=enforce` (the default) refuses a call whose arguments the schema refuses, with a message that names fields, never values, and starts no job for it; `warn` runs the call anyway, notes the field paths on standard error and counts it as invalid, which `/academic usage` shows; `off` does not check. The default moved from `warn` to `enforce` after the live scripts (`p1`, `p4`, `p5`, `fit`) made 19 counted tool calls across 9 server runs, none of them invalid.
- Fixed: the first-start fetch of an installed copy ran inside the `ah` server, so a session that ended before the download did (a headless `claude -p`, over in seconds) cut it short, and a run of such sessions never got the tools. The fetch is now a detached process (`server/bin/ah-bootstrap.mjs`) that outlives the session; the next server waits for it. Found by the `install marketplace` live script.
- Fixed: the background build of the writing engine's environment ran inside the `ah` server too, so a session shorter than the build cut it short and the next one started it again from nothing. It is now a detached process (`server/bin/ah-engine-install.mjs`); the guard says "being installed" from the moment it starts.
- **Repository settings are written down.** `docs/maintain/releasing.md` lists the rules for `main` (no required approval while there is one maintainer, the four required checks and how a `TESTED_VERSIONS` change renames one), and the tag ruleset; private vulnerability reporting is on now that the repository is public. Live-script results go in the release notes.
- **Pinned CI actions.** Every action in the workflows is pinned to a commit SHA, a repository test fails on a tag, and Dependabot proposes updates in one grouped weekly PR.
- **Repository hygiene.** `CONTRIBUTING.md`, `SECURITY.md`, `.editorconfig`, issue forms, a pull request template and `CODEOWNERS`; `package.json` carries the scripts, the Node 22 floor and one version number that a test keeps equal to `plugin.json`, the README and this file.
- Fixed: the task commands' workspace check refused every path when the session folder was the filesystem root, and research mode's project search stopped at a fixed 64 folder levels.
- Fixed: a missing or corrupt `UPSTREAM.lock.json` made `/academic doctor` throw instead of reporting what to restore.
- Fixed: the guard reads its reply through warning or log lines, skips a JSON log line that is not a reply, and accepts both the wrapped and plain settings-hook forms.
- The pane shows why a failed, killed or interrupted job ended, reads its stored state once per refresh, and gives its rows stable keys.
- A job record that cannot be written no longer throws: the job still runs, and a restart marks an unfinished record interrupted. A cancellation that arrives after the job ended is ignored rather than thrown from an abort listener.
- The unit suites keep their scratch files in a folder named for the process, so two runs on one machine no longer overwrite each other's fixtures.
- The scripts no longer import the same module twice, and the host says why it checks `process.env` rather than the config object for a safe `DSH_HOME`.
- Documentation: the release page no longer says CI runs no checks; the testing page and the scripts index name the new gate.
- **Usage counts, and `/academic usage`.** The mod keeps a count per tool, skill, agent and command (names and numbers only, on this machine; the `usage_counts` setting turns it off) and shows what is used and what never is, as input for the next review of what to leave out. `/academic doctor` gives one line.
- **A weekly watch on Academic Harness** (`.github/workflows/upstream-watch.yml`): when its newest commit is past the one the plugin holds, one issue is opened with the report of what it changes; nothing is applied.
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
