# Architecture

The plugin gives Claude Code the Academic Harness research toolkit: its tools, skills, a writing engine and a library of papers. A Claude Code mod's hooks module has no Node and no DOM and reaches the outside only through the engine interface `$`, so the plugin has two halves that talk through processes and MCP.

![How the plugin is built: the hooks module, the ah and papermemory MCP servers, skills and agents, the bundled core and the writing engine](../assets/architecture.svg)

Blue is code that runs inside Claude Code's hooks, green the MCP servers and background jobs, purple the writing engine, orange stored data, yellow skills and agents, and grey what is outside the plugin. The source is `docs/assets/architecture.mmd`, rendered with Pele.

| Part | Where | What it does |
|---|---|---|
| Hooks module | `hooks/register.tsx` | Runs inside Claude Code, with no Node. Research mode and the system-prompt section; the slash commands `/academic`, `/ah-*`, `/fold`, `/ah-watch`; the status line, pane and completion notices; the writing-engine guard and approvals (`tool.check`). It reaches the outside with `$.process.run`, which starts `node server/bin/ah-{hook,approve,ui,doctor}.mjs` |
| MCP server `ah` | `server/bin/ah-mcp.mjs` | One Node process over stdio. Loads the research tool modules from the engine code through a small context shim; 121 tools plus the `job_*` tools and `doctor`, deferred behind ToolSearch; the jobs service and the model route (headless `claude -p`); fetches the engine code itself on first start (`bootstrap.mjs`) |
| MCP server `papermemory` | `server/bin/papermemory-mcp.mjs` | A launcher for `papermemory mcp` |
| Skills | `skills/` | 58 core skills and the guides (generated) |
| Agents | `agents/` | 21 specialists (generated) |

## The engine code

The tool modules, the prompt the skills and guides come from, the skills, the vendored writing engine (Python), PaperMemory and the deep-review engine are in `core/`, committed in this repository (about 3,300 files, 44 MB). It began as a copy of Academic Harness at one commit (0.54.1) and is this repository's own source now: nothing follows that project, and nothing is fetched. What is built from it (`node_modules`, the engine's Python environment) is not committed; `scripts/setup.mjs` installs it in place, and an installed copy of the plugin gets a working copy of `core/` in the mod's home on first start (`server/src/bootstrap.mjs`), so an update of the plugin replaces the code and leaves the installed dependencies alone when the core did not change. See [Building](../maintain/building.md).

## The tool server (`server/`)

The research tool modules register tools against a `ctx` object. The server gives them one:

| File | Role |
|---|---|
| `manifest.mjs` | Which modules to load, by area; which are not loaded; which are left out (`fit.mjs`) |
| `context.mjs` | The `ctx` shim: `tools` (a registry), `get` for optional services, subscriptions. A service the plugin does not provide throws a named error |
| `host.mjs` | `createHost` loads the modules and runs a call; `serve` is the stdio MCP loop (initialize, tools/list, tools/call, cancellation, `roots/list` so `/cd` is followed) |
| `exec.mjs`, `schema.mjs` | The per-call `exec` (call id, abort signal, session id, working folder) and parameters to JSON schema |
| `render.mjs` | Output blocks to MCP content; a result over 40,000 characters is cut with the whole text in `<project>/.dsh/tool-output/`; wording rules for text that names something this plugin does not have |
| `jobs.mjs`, `jobtools.mjs` | Long tools (`deep_research`, `deep_review`, `analysis_run`) detach after a foreground window and run as jobs kept on disk; `job_status/wait/log/kill` |
| `llm.mjs` | The model route: `ctx.llm` answered by a headless `claude -p --safe-mode --tools ""`, no key, capped |
| `engine*.mjs` | Where the writing engine's environment is, whether it is ready, how it is built |
| `bootstrap*.mjs`, `late-host.mjs`, `snapshot.mjs` | The first start with nothing installed: answer at once, copy the core and install its dependencies, swap the tool list |
| `doctor.mjs`, `doctortool.mjs` | What is ready, as a report and as a tool |
| `usage.mjs` | Usage counts: a recorder per writer, the files added up, the report. Names and numbers only |
| `compat.mjs` | The Claude Code versions the mod was seen working on; reads the record the hooks module leaves at session start, so the doctor can say whether that module loaded and on which version |
| `panel.mjs` | Project state and library counts for the pane |
| `env.mjs`, `paths.mjs`, `fit.mjs` | The environment the modules see, where things are, what is left out |

The modules are loaded in-process from the engine code, unchanged. The plugin does not run the engine code's own start-up routine, which would seed skills and patch profiles outside this plugin.

## The hooks module (`hooks/`)

| File | Role |
|---|---|
| `register.tsx` | The one `session.start` hook (Claude Code refuses two with no matcher) and every other registration |
| `mode.ts` | Research mode, and `showStatus`, the only writer of the one status line |
| `guard.ts`, `guard-core.ts` | The four classic events run the writing engine's `ah hook` through `ah-hook.mjs` in an `ah.yaml` project; fail closed for writes and shell |
| `approvals.ts` | `tool.check`: `ah_author` and `ah_migrate apply` ask, paid compute always asks |
| `notices.ts`, `jobs-core.ts` | Job completion notices |
| `tasks.ts`, `tasks-core.ts` | The task commands, `/ah-watch`, `/fold` |
| `ui.tsx`, `ui-core.ts` | The pane and the status line's parts |
| `doctor.ts` | `/academic doctor` |
| `seen.ts` | The record that the module loaded, for the doctor |
| `usage.ts` | Counts the plugin's skills and agents as Claude starts them (a `classic.PreToolUse` hook that changes nothing) and the commands run |
| `generated/` | The research-mode text, the task catalogue and the fold |

The `-core.ts` files are pure (no `$`, no Node), so node tests import them as they are.

## How the pieces meet

- **A tool call.** The model finds a tool with `ToolSearch` and calls `mcp__plugin_academic-harness_ah__<tool>`; the server checks the arguments against the tool's schema (`server/src/validate.mjs`), runs the module with a fresh `exec` and renders the result.
- **A guarded write.** In a folder with an `ah.yaml`, `classic.PreToolUse` runs `ah-hook.mjs pre`, which runs the writing engine's `ah hook pre` and returns its verdict (about 0.14 s). No answer means no write.
- **A task command.** The command hook checks the line, then `$.tool.call`s the tool. A tool call from a hook needs no permission rule: only a deny rule, a hook's `ask` or an organization's ask refuse it.
- **A long job.** The tool answers after about 30 seconds with a job id; the record on disk is read by a timer in the hooks module, which notifies and, by default, prompts the model to read the result.
- **The pane and the status line.** A timer reads the job records and, through `ah-ui.mjs`, the writing engine's state card and the PaperMemory counts; the pane draws what was last stored.
- **The first start.** See [Getting started](../guide/getting-started.md).

## What the plugin adds, and what it leaves out

It adds what only Claude Code has: commands, a pane and a status line, the guard on Claude's own tools, approvals through Claude Code's dialogs, and a model route under your login. It leaves out what Claude Code already does ([what is left out and why](fit-review.md)), and rewrites the passages of its skills and guides that give advice wrong for Claude Code ([`scripts/adapt.mjs`](../maintain/building.md)).

## Licences

Code written for the plugin is MIT (`LICENSE`), and so is Academic Harness's own code in `core/` (Copyright 2026 Academic Harness, formerly ResearchCraft, the same author). **`core/` is not all MIT.** It carries the third-party material that Academic Harness bundles, each under its own licence, and `NOTICE` and `core/NOTICE` list it. Decision, 2026-11-17: the repository stands alone and commits all of `core/`, including the skills and vendored projects whose licences are non-commercial or GPL, with that said in the README and `NOTICE` and not by leaving them out. The consequence to know: someone who uses this repository commercially has to read `NOTICE` and leave out what its licence does not allow.

What the build lets into `skills/` (the 58 core skills, plus the guides, that Claude Code lists) is narrower, and unchanged from the review settled on 2026-11-16:

- Skills under non-commercial, GPL or unknown licences are left out of `skills/` by the build (decision D5), and `skills/.build-info.json` records each with its licence. The 54 that are copied name MIT, CC-BY-4.0 or nothing (the source's own text).
- Eight skills come from K-Dense (MIT): their copyright lines are in `NOTICE`.
- Three come from Supervisor-Skills with `license: CC-BY-4.0` in their own frontmatter and are credited in `NOTICE` with their changes. That repository as a whole is CC BY-NC-SA 4.0, and `core/vendor/supervisor-skills` holds it.
- `remove-ai-signs/references/signs.md` is adapted from a Wikipedia essay (CC BY-SA 4.0), and `NOTICE` says it is not under the MIT licence.
- A skill the model loads on demand from `core/skills` can be under a non-commercial licence; each skill's `license:` line says.

`tests/scripts/repo.test.mjs` fails when a skill is copied whose licence is not one the build allows, or when a licence other than MIT has no entry in `NOTICE`.

