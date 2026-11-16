# Changelog

## 0.4.0 (not tagged)

- **Install from the marketplace.** The repository is its own marketplace (`/plugin install academic-harness --marketplace raktim-mondol/cc-mod-academic-harness`). An installed copy, or a clone nobody set up, fetches the Academic Harness snapshot on first start, verified against `UPSTREAM.lock.json`; until it is done the server offers the `doctor` tool and then swaps in the full list.
- **`/ah-watch`** runs the saved literature searches that are due and prints what is new (`/loop 1d /ah-watch` to schedule).
- **Documentation** in a guide, design notes, maintenance notes and history, with a README per folder and a test that the links resolve.

## 0.3.0

- **Fresh clone with no source checkout**: `node scripts/setup.mjs` downloads the pinned commit from GitHub and verifies it against a digest in the lock. `server/src/snapshot.mjs`.
- **`/academic doctor`** and a `doctor` tool: what is ready, what is not, key names never values.
- **`node scripts/update-upstream.mjs`**: reports what a newer Academic Harness commit changes for the mod, and applies it.
- **Fit review.** 15 tools, 15 skills and 1 agent that Claude Code already covers are left out (`restore_tools` brings most tools back); 17 skills moved to on-demand; the research-mode text rewritten for Claude Code (about 2,900 tokens, from 4,700); passages of the guides and briefs that gave DeepSeek Harness advice rewritten.
- **Task commands** `/ah-research`, `/ah-review`, `/ah-papers`, `/ah-references`, `/ah-write`, `/ah-analyze`, `/ah-hypotheses`; `/fold`; a status line; a pane (`/academic`).
- Fixed: the writing engine's stamp never matched after the installer built it; PaperMemory's build output made the snapshot look edited.

## 0.2.0

- The tool host (134 of Academic Harness's 136 tools), the writing-engine guard and approvals, background jobs and the model route, completion notices, paid-compute approval. Audit of the first four phases.

## 0.1.0

- Skills, research mode, PaperMemory and the specialist agents.
