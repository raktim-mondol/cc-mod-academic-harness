# Architecture

The mod ports Academic Harness (written for DeepSeek Harness, "DSH") into Claude Code without changing it. A Claude Code mod's hooks module has no Node and no DOM and reaches the outside only through the engine interface `$`, so the mod has two halves that talk through processes and MCP.

```
Claude Code session
│
├── hooks module (hooks/register.tsx)              inside the engine; no Node
│     research mode and the system-prompt section
│     slash commands: /academic, /ah-*, /fold, /ah-watch
│     status line, pane, completion notices
│     the writing-engine guard, approvals (tool.check)
│     └── $.process.run ──► node server/bin/ah-{hook,approve,ui,doctor}.mjs
│
├── MCP server "ah"  (server/bin/ah-mcp.mjs)       one Node process, stdio
│     loads Academic Harness's tool modules from the snapshot through a small context shim
│     121 tools + job_* + doctor, deferred behind ToolSearch
│     jobs service, model route (headless claude -p)
│     fetches the snapshot itself on first start (bootstrap.mjs)
│
├── MCP server "papermemory"  (server/bin/papermemory-mcp.mjs)   launcher → `papermemory mcp`
├── skills/    54 core skills + the guides   (generated)
└── agents/    21 specialists                (generated)
```

## The source snapshot

Academic Harness's source is never modified and never edited here. `upstream/` is a snapshot of an allow-listed part of it at one commit (`UPSTREAM.lock.json`): the tool modules, the prompt, the skills, the vendored writing engine, PaperMemory and the deep-review engine. It is not committed; `scripts/sync-upstream.mjs` takes it from a checkout (`git archive`) or from GitHub and checks a digest of its files against the lock. See [Building](../maintain/building.md) and [Updating](../maintain/updating-upstream.md).

## The tool host (`server/`)

Upstream's modules register tools against a `ctx` object. The host gives them one:

| File | Role |
|---|---|
| `manifest.mjs` | Which modules to load, by area; which are host-only; which are left out (`fit.mjs`) |
| `context.mjs` | The `ctx` shim: `tools` (a registry), `get` for optional services, `plugin` (refused: nothing is mounted), subscriptions. A service the mod has not ported throws a named error |
| `host.mjs` | `createHost` loads the modules and runs a call; `serve` is the stdio MCP loop (initialize, tools/list, tools/call, cancellation, `roots/list` for `/cd`) |
| `exec.mjs`, `schema.mjs` | The per-call `exec` (call id, abort signal, session id, working folder) and parameters to JSON schema |
| `render.mjs` | Output blocks to MCP content; a result over 40,000 characters is cut with the whole text in `<project>/.dsh/tool-output/`; wording rules for text that names DSH |
| `jobs.mjs`, `jobtools.mjs` | Long tools (`deep_research`, `deep_review`, `analysis_run`) detach after a foreground window and run as jobs kept on disk; `job_status/wait/log/kill` |
| `llm.mjs` | The model route: `ctx.llm` answered by a headless `claude -p --safe-mode --tools ""`, no key, capped |
| `engine*.mjs` | Where the writing engine's environment is, whether it is ready, how it is built |
| `bootstrap*.mjs`, `late-host.mjs`, `snapshot.mjs` | The first start without a snapshot: answer at once, fetch, swap the host |
| `doctor.mjs`, `doctortool.mjs` | What is ready, as a report and as a tool |
| `panel.mjs` | Project state and library counts for the pane |
| `env.mjs`, `paths.mjs`, `fit.mjs` | The environment upstream modules see, where things are, what is left out |

Modules are loaded in-process from the snapshot, unchanged. The one thing the mod never does is call upstream's `index.js` `apply()`, which seeds skills and patches DSH profiles.

## The hooks module (`hooks/`)

| File | Role |
|---|---|
| `register.tsx` | The one `session.start` hook (the engine refuses two with no matcher) and every other registration |
| `mode.ts` | Research mode, and `showStatus`, the only writer of the one status line |
| `guard.ts`, `guard-core.ts` | The four classic events run the engine's `ah hook` through `ah-hook.mjs` in an `ah.yaml` project; fail closed for writes and shell |
| `approvals.ts` | `tool.check`: `ah_author` and `ah_migrate apply` ask, paid compute always asks |
| `notices.ts`, `jobs-core.ts` | Job completion notices |
| `tasks.ts`, `tasks-core.ts` | The task commands, `/ah-watch`, `/fold` |
| `ui.tsx`, `ui-core.ts` | The pane and the status line's parts |
| `doctor.ts` | `/academic doctor` |
| `generated/` | The research-mode text, upstream's task catalogue and fold |

The `-core.ts` files are pure (no `$`, no Node), so node tests import them as they are.

## How the pieces meet

- **A tool call.** The model finds a tool with `ToolSearch` and calls `mcp__plugin_academic-harness_ah__<tool>`; the host runs the upstream module with a fresh `exec` and renders the result.
- **A guarded write.** In a folder with an `ah.yaml`, `classic.PreToolUse` runs `ah-hook.mjs pre`, which runs the engine's `ah hook pre` and returns its verdict (about 0.14 s). No answer means no write.
- **A task command.** The command hook checks the line the way upstream's task code does, then `$.tool.call`s the tool. A tool call from a hook needs no permission rule: only a deny rule, a hook's `ask` or an organization's ask refuse it.
- **A long job.** The tool answers after about 30 seconds with a job id; the record on disk is read by a timer in the hooks module, which notifies and, by default, prompts the model to read the result.
- **The pane and the status line.** A timer reads the job records and, through `ah-ui.mjs`, the engine's state card and the PaperMemory counts; the pane draws what was last stored.
- **The first start.** See [Getting started](../guide/getting-started.md).

## What the mod adds to Academic Harness, and what it leaves out

The mod adds what only Claude Code has (commands, a pane, the guard on Claude's own tools, approvals through Claude Code's dialogs, the model route under your login). It leaves out what Claude Code already does ([the fit review](fit-review.md)), and rewrites guidance written for another host ([`scripts/adapt.mjs`](../maintain/building.md)).

## Licences

Code written for the mod is MIT (`LICENSE`). Upstream is MIT (Copyright 2026 ResearchCraft); its `NOTICE`, which lists the third-party skill catalogues and their licences, applies to every skill copied from it and is carried with them. Skills under non-commercial, GPL or unknown licences are not built into the repository (decision D5), and the snapshot, which holds all of upstream's skills, is not committed. Upstream's own legal review of those licences (its decision D09) is still open; settle it before making the repository public or shipping a snapshot.
