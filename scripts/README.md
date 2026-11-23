# scripts/

Node scripts for setting the mod up, building what is generated, and checking it. Run from the repository root.

| Script | What it does |
|---|---|
| `setup.mjs` | Makes a clone work: dependencies, the engine, a check. The first thing to run |
| `install-deps.mjs`, `install-engine.mjs`, `install-helpers.mjs` | `npm ci` in `core/`; the writing engine's environment; the optional Python helpers |
| `ci-matrix.mjs` | The Claude Code versions the CI workflow tests on: the tested ones, then `latest` |
| `make-icon.py` | Draws `.claude-plugin/icon.png` (Python, Pillow); the picture is committed, this only exists to change it |
| `build-all.mjs` | Runs `build-skills`, `build-prompt`, `build-agents`, `build-ui` |
| `build-skills.mjs`, `build-prompt.mjs`, `build-agents.mjs`, `build-ui.mjs` | Produce `skills/`, `hooks/generated/prompt.ts` and the guides, `agents/`, `hooks/generated/task-modes.ts` and `fold-core.ts` |
| `build-manifest.mjs` | Writes the generated part of `.claude-plugin/plugin.json` (`--check` to verify) |
| `adapt.mjs` | The rewrites of the core's text for Claude Code, used by the builds |
| `research-mode.md`, `prompt-reviewed.json` | Hand-written: the research-mode text, and the text of `core/prompt.js` it was written against |
| `guides/` | Hand-written guides for `research-guides` (today [`search-providers.md`](guides/search-providers.md), the routing of the keyed search providers), built next to the ones from the core's prompt |
| `measure-surface.mjs` | The host's tools against what the core registers |
| `check.mjs` | The gates CI runs, in one command: `npm run check` (add `-- --types` for the hooks module's type check) |
| `test-core.mjs`, `test-engine.mjs` | The core's own tests, and the writing engine's own suite, in `core/` |
| `probe-run.mjs`, `probe-report.py` | The platform probes behind the [platform notes](../docs/design/platform-notes.md) |

What is generated and what is not: [Building](../docs/maintain/building.md).
