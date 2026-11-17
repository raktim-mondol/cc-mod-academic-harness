# Building: what is generated, what is written by hand

The mod is three kinds of file: ones a person writes, the engine's source in `core/` (committed, and edited like any other source: this repository is its home), and ones a script produces from `core/`. The third kind is committed (so the skills and agents load without installing anything) and is never edited by hand: a rebuild would overwrite it.

## Generated

| Output | Made by | From |
|---|---|---|
| `skills/<name>/` | `scripts/build-skills.mjs` | `core/skills`, for the core list minus the restricted licences (D5) and minus what `server/src/fit.mjs` leaves out. `scripts/adapt.mjs` rewrites the passages that are wrong for Claude Code |
| `skills/research-guides/` | `scripts/build-prompt.mjs` | The sections of `core/prompt.js` that became guides, adapted |
| `hooks/generated/prompt.ts` | `scripts/build-prompt.mjs` | `scripts/research-mode.md` (written by hand) plus the guide index |
| `hooks/generated/task-modes.ts`, `fold-core.ts` | `scripts/build-ui.mjs` | `core/task-modes.js` and `core/fold-core.js`, copied under a header. The script refuses a source that gains an import |
| `agents/<name>.md` | `scripts/build-agents.mjs` | The specialist briefs among `core/skills`, with the delegation line replaced and `scripts/adapt.mjs` applied |
| `.claude-plugin/plugin.json` (the `userConfig` and the `ah` server entry) | `scripts/build-manifest.mjs` | The core's settings fields (`KEY_FIELDS`), minus those only a left-out tool reads |

`node scripts/build-all.mjs` runs the skills, prompt, agents and interface builds in order; `node scripts/build-manifest.mjs [--check]` does `plugin.json`. A build fails, rather than guessing, when `core/` changed something a build depends on: a prompt section that is gone, a passage an adaptation rule rewrites, a task-catalogue file that gained an import.

## Diagrams

The diagrams in `docs/assets/` are Mermaid sources (`.mmd`) with the SVG rendered from each. Never edit an SVG: change the source and render it with the Pele skill that `core/` bundles, which pins Pele 1.6.0 and bakes the colours in so the picture shows in any viewer:

```
node core/skills/pele/scripts/render.mjs --static-colors docs/assets/architecture.mmd docs/assets/architecture.svg
```

The first run installs Pele inside `core/skills/pele` (`node_modules` is not committed). The committed SVGs are byte for byte what this command makes from their sources, so a render that changes a diagram you did not edit means the pin moved. `docs/assets/plan-architecture` and `docs/assets/repo-tree` belong to [the implementation plan](../history/implementation-plan.md) and show the plan as it was; leave them as they are.

## Written by hand

| File | What it is |
|---|---|
| `scripts/research-mode.md` | The research-mode text added to the system prompt. Written for Claude Code from the sections of `core/prompt.js`; `scripts/prompt-reviewed.json` records the text it was written against, and the build says when that changes |
| `server/src/fit.mjs` | What the mod leaves out of Academic Harness, each with a reason: tools (with a module, an area and the keys only they read), skills not built, skills left to on-demand, agents not built |
| `scripts/adapt.mjs` | The rewrites of the core's text for Claude Code. Each names its target and fails the build if the text it rewrites is gone |
| `server/src/manifest.mjs` | Which of the core's modules the server loads, by area |
| `hooks/*.ts`, `hooks/register.tsx` | The Claude Code side: see [the hooks README](../../hooks/README.md) |
| `server/**` | The tool host: see [the server README](../../server/README.md) |

## Ground rules

1. `core/` is this repository's own source. A change to it is a change to the plugin: it goes through a pull request and `npm run check`, and when it changes what a build reads (a skill, the prompt, the task catalogue), run `npm run build` and review the generated diff in the same change.
2. Never touch `~/.dsh` or the DeepSeek Harness running on its port. The server sets `DSH_HOME` to the mod's own home before importing any core module and refuses to run otherwise. It never calls the core's `index.js` `apply()`.
3. Keys are never printed or logged. They reach tools as environment variables.
4. Scratch and test directories live under `~/.cache`, not `/tmp`.
5. Generated files are not edited by hand: `skills/`, `agents/`, `hooks/generated/`.
6. Stop processes by PID, never by name pattern.
7. A test run leaves `~/.dsh` as it found it.

## Type checking

`npx --yes -p typescript@5.6.3 tsc -p . --noEmit` (the engine writes `.claude-plugin/types/` and a `tsconfig.json` when it loads the mod; both are gitignored). `claude plugin validate .` reads the manifests and the hooks module as the engine will.
