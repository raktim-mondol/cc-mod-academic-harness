# scripts/

Node scripts for setting the mod up, keeping it in step with Academic Harness, building what is generated, and checking it. Run from the repository root.

| Script | What it does |
|---|---|
| `setup.mjs` | Makes a clone work: the snapshot, dependencies, the engine, a check. The first thing to run |
| `sync-upstream.mjs` | Takes the snapshot at the commit in `UPSTREAM.lock.json` (or `--commit`): from the checkout with `git archive`, else from GitHub, verified |
| `update-upstream.mjs`, `update-lib.mjs` | Reports what a newer Academic Harness commit changes for the mod; `--apply` takes it |
| `install-deps.mjs`, `install-engine.mjs`, `install-helpers.mjs` | `npm ci` in the snapshot; the writing engine's environment; the optional Python helpers |
| `ci-matrix.mjs` | The Claude Code versions the CI workflow tests on: the tested ones, then `latest` |
| `make-icon.py` | Draws `.claude-plugin/icon.png` (Python, Pillow); the picture is committed, this only exists to change it |
| `build-all.mjs` | Runs `build-skills`, `build-prompt`, `build-agents`, `build-ui` |
| `build-skills.mjs`, `build-prompt.mjs`, `build-agents.mjs`, `build-ui.mjs` | Produce `skills/`, `hooks/generated/prompt.ts` and the guides, `agents/`, `hooks/generated/task-modes.ts` and `fold-core.ts` |
| `build-manifest.mjs` | Writes the generated part of `.claude-plugin/plugin.json` (`--check` to verify) |
| `adapt.mjs` | The rewrites of upstream's text for Claude Code, used by the builds |
| `research-mode.md`, `prompt-reviewed.json` | Hand-written: the research-mode text, and the upstream text it was written against |
| `measure-surface.mjs` | The host's tools against what upstream registers |
| `check-upstream-clean.mjs` | Proves the Academic Harness checkout and `~/.dsh` were not changed (`--record` before a run) |
| `test-upstream.mjs`, `test-engine.mjs` | Upstream's own tests, and the writing engine's own suite, against the snapshot |
| `probe-run.mjs`, `probe-report.py` | The platform probes behind the [platform notes](../docs/design/platform-notes.md) |

What is generated and what is not: [Building](../docs/maintain/building.md). Updating: [Updating Academic Harness](../docs/maintain/updating-upstream.md).
