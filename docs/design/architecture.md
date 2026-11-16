# Architecture

The plugin gives Claude Code the Academic Harness research toolkit: its tools, skills, a writing engine and a library of papers. A Claude Code mod's hooks module has no Node and no DOM and reaches the outside only through the engine interface `$`, so the plugin has two halves that talk through processes and MCP.

```
Claude Code session
│
├── hooks module (hooks/register.tsx)              inside Claude Code; no Node
│     research mode and the system-prompt section
│     slash commands: /academic, /ah-*, /fold, /ah-watch
│     status line, pane, completion notices
│     the writing-engine guard, approvals (tool.check)
│     └── $.process.run ──► node server/bin/ah-{hook,approve,ui,doctor}.mjs
│
├── MCP server "ah"  (server/bin/ah-mcp.mjs)       one Node process, stdio
│     loads the research tool modules from the engine code through a small context shim
│     121 tools + job_* + doctor, deferred behind ToolSearch
│     jobs service, model route (headless claude -p)
│     fetches the engine code itself on first start (bootstrap.mjs)
│
├── MCP server "papermemory"  (server/bin/papermemory-mcp.mjs)   launcher → `papermemory mcp`
├── skills/    54 core skills + the guides   (generated)
└── agents/    21 specialists                (generated)
```

## The engine code

The tool modules, the prompt the skills and guides come from, the skills, the vendored writing engine (Python), PaperMemory and the deep-review engine live in `upstream/`, a snapshot of an allow-listed part of the Academic Harness source at one exact version (`UPSTREAM.lock.json`). It is not committed. `scripts/sync-upstream.mjs` takes it from a local checkout (`git archive`) or from GitHub and checks a digest of its files against the lock; the server fetches it itself on first start when it is missing. The plugin never edits it. See [Building](../maintain/building.md) and [Updating](../maintain/updating-upstream.md).

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
| `bootstrap*.mjs`, `late-host.mjs`, `snapshot.mjs` | The first start without the engine code: answer at once, fetch, swap the tool list |
| `doctor.mjs`, `doctortool.mjs` | What is ready, as a report and as a tool |
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
| `generated/` | The research-mode text, the task catalogue and the fold |

The `-core.ts` files are pure (no `$`, no Node), so node tests import them as they are.

## How the pieces meet

- **A tool call.** The model finds a tool with `ToolSearch` and calls `mcp__plugin_academic-harness_ah__<tool>`; the server runs the module with a fresh `exec` and renders the result.
- **A guarded write.** In a folder with an `ah.yaml`, `classic.PreToolUse` runs `ah-hook.mjs pre`, which runs the writing engine's `ah hook pre` and returns its verdict (about 0.14 s). No answer means no write.
- **A task command.** The command hook checks the line, then `$.tool.call`s the tool. A tool call from a hook needs no permission rule: only a deny rule, a hook's `ask` or an organization's ask refuse it.
- **A long job.** The tool answers after about 30 seconds with a job id; the record on disk is read by a timer in the hooks module, which notifies and, by default, prompts the model to read the result.
- **The pane and the status line.** A timer reads the job records and, through `ah-ui.mjs`, the writing engine's state card and the PaperMemory counts; the pane draws what was last stored.
- **The first start.** See [Getting started](../guide/getting-started.md).

## What the plugin adds, and what it leaves out

It adds what only Claude Code has: commands, a pane and a status line, the guard on Claude's own tools, approvals through Claude Code's dialogs, and a model route under your login. It leaves out what Claude Code already does ([what is left out and why](fit-review.md)), and rewrites the passages of its skills and guides that give advice wrong for Claude Code ([`scripts/adapt.mjs`](../maintain/building.md)).

## Licences

Code written for the plugin is MIT (`LICENSE`). The research engine, tools and skills it runs come from Academic Harness, also MIT (Copyright 2026 ResearchCraft); its `NOTICE`, which lists the third-party skill catalogues and their licences, applies to every skill copied from it and is carried with them. Skills under non-commercial, GPL or unknown licences are not built into the repository (decision D5), and the engine code, which holds all of them, is not committed. A review of those licences is still open; settle it before making the repository public or shipping the engine code.
