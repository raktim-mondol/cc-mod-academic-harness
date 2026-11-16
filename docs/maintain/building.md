# Building: what is generated, what is written by hand

The mod is two kinds of file: ones a person writes, and ones a script produces from the Academic Harness snapshot. The second kind is committed (so the skills and agents load without the snapshot) and is never edited by hand: a rebuild would overwrite it.

## Generated

| Output | Made by | From |
|---|---|---|
| `upstream/` (gitignored) | `scripts/sync-upstream.mjs` | The Academic Harness source at the commit in `UPSTREAM.lock.json`: the allow-listed paths only |
| `skills/<name>/` | `scripts/build-skills.mjs` | `upstream/skills`, for the core list minus the restricted licences (D5) and minus what `server/src/fit.mjs` leaves out. `scripts/adapt.mjs` rewrites the passages that are wrong for Claude Code |
| `skills/research-guides/` | `scripts/build-prompt.mjs` | The sections of upstream's prompt that became guides, adapted |
| `hooks/generated/prompt.ts` | `scripts/build-prompt.mjs` | `scripts/research-mode.md` (written by hand) plus the guide index |
| `hooks/generated/task-modes.ts`, `fold-core.ts` | `scripts/build-ui.mjs` | Upstream's `task-modes.js` and `fold-core.js`, copied under a header. The script refuses a source that gains an import |
| `agents/<name>.md` | `scripts/build-agents.mjs` | The specialist briefs among upstream's skills, with the delegation line replaced and `scripts/adapt.mjs` applied |
| `.claude-plugin/plugin.json` (the `userConfig` and the `ah` server entry) | `scripts/build-manifest.mjs` | Upstream's settings fields (`KEY_FIELDS`), minus those only a left-out tool reads |
| `UPSTREAM.lock.json` | `scripts/sync-upstream.mjs` | The commit, the allow-list, the archive digest and a digest of the snapshot's files |

`node scripts/build-all.mjs` runs the skills, prompt, agents and interface builds in order; `node scripts/build-manifest.mjs [--check]` does `plugin.json`. A build fails, rather than guessing, when upstream changed something it depends on: a prompt section that is gone, a passage an adaptation rule rewrites, a task-catalogue file that gained an import.

## Written by hand

| File | What it is |
|---|---|
| `scripts/research-mode.md` | The research-mode text added to the system prompt. Written for Claude Code from upstream's sections; `scripts/prompt-reviewed.json` records the upstream text it was written against, and the build says when that changes |
| `server/src/fit.mjs` | What the mod leaves out of Academic Harness, each with a reason: tools (with a module, an area and the keys only they read), skills not built, skills left to on-demand, agents not built |
| `scripts/adapt.mjs` | The rewrites of upstream's text for Claude Code. Each names its target and fails the build if the text it rewrites is gone |
| `server/src/manifest.mjs` | Which upstream modules the server loads, by area |
| `hooks/*.ts`, `hooks/register.tsx` | The Claude Code side: see [the hooks README](../../hooks/README.md) |
| `server/**` | The tool host: see [the server README](../../server/README.md) |

## Ground rules

1. Never write inside the Academic Harness source checkout, not even gitignored paths. It is linked live into the daily DeepSeek Harness profile. Read it with `git archive` of a named commit.
2. Never touch `~/.dsh` or the DeepSeek Harness running on its port. The server sets `DSH_HOME` to the mod's own home before importing any upstream module and refuses to run otherwise. It never calls upstream's `index.js` `apply()`.
3. Keys are never printed or logged. They reach tools as environment variables.
4. Scratch and test directories live under `~/.cache`, not `/tmp`.
5. Generated files are not edited by hand: `upstream/`, `skills/`, `agents/`, `hooks/generated/`.
6. Stop processes by PID, never by name pattern.
7. A test run ends with `node scripts/check-upstream-clean.mjs`, which compares the source repository's HEAD and `git status`, and `~/.dsh`, with what `--record` saw before.

## Type checking

`npx --yes -p typescript@5.6.3 tsc -p . --noEmit` (the engine writes `.claude-plugin/types/` and a `tsconfig.json` when it loads the mod; both are gitignored). `claude plugin validate .` reads the manifests and the hooks module as the engine will.
