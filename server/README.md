# server/

Node code the plugin runs as processes. Two MCP servers, and the helpers the hooks module runs because it has no Node itself.

## `bin/`

| Process | What it is |
|---|---|
| `ah-mcp.mjs` | **The `ah` MCP server**: loads Academic Harness's tool modules from the snapshot and serves them over stdio. On a first start with no snapshot it answers with `doctor` alone, fetches it, and swaps in the full list |
| `ah-bootstrap.mjs` | The first-start fetch itself, started detached by `ah-mcp.mjs` so that it finishes even when the session that started it has ended. Silent; its progress is in `<home>/bootstrap.json` |
| `papermemory-mcp.mjs` | **The PaperMemory server**: a launcher that installs the CLI into the mod's home if needed and runs `papermemory mcp` |
| `ah-hook.mjs` | The guard bridge: runs the engine's `ah hook <event>` for the hooks module, exit 3 when there is no engine, 124 on a time-out |
| `ah-approve.mjs` | The approval text for a paid-compute call (provider, instance, ceiling, session cap) |
| `ah-ui.mjs` | The data for the pane and the status line: the engine's state card, the PaperMemory counts |
| `ah-doctor.mjs` | What is ready and what is not (`/academic doctor` outside a session) |

## `src/`

The host, in the order a request meets it: `host.mjs` (the stdio loop and the call), `manifest.mjs` (which modules, by area), `context.mjs` (the `ctx` upstream's modules expect), `exec.mjs`, `schema.mjs`, `validate.mjs` (the arguments of a call checked against the tool's schema before it runs), `render.mjs`; `jobs.mjs`, `jobtools.mjs`, `llm.mjs` for long tools and the model route; `engine*.mjs` for the writing engine's environment; `bootstrap*.mjs`, `late-host.mjs`, `snapshot.mjs` for the first start; `doctor.mjs`, `doctortool.mjs`, `compat.mjs` (the Claude Code versions the mod was seen on, and the record the hooks module leaves), `usage.mjs` (usage counts); `panel.mjs`; `env.mjs`, `paths.mjs`; and `fit.mjs`, the list of what the mod leaves out. Each file has a header comment saying what it is for.

**Argument validation.** Before a tool runs (and before a long tool is started as a job), the host checks the call's arguments against the tool's input schema: `type`, `required`, `properties`, `items`, `enum` and `oneOf`; any other keyword is ignored, and a property the schema does not declare is never refused. `null` for an optional field counts as not given. `AH_VALIDATE_TOOL_ARGS` sets what happens to a call that fails the check: `enforce` (the default) refuses it with an error result such as `Invalid arguments for literature_search: "query" is required; "max_results" must be a number.`; `warn` runs it and writes one line to standard error naming the tool and the field paths; `off` does not check. Messages name fields, never values. Either way the call is counted as invalid in the usage counts, and `/academic usage` shows it.

Rules: standard output belongs to the protocol (everything else goes to stderr); `DSH_HOME` is the mod's own home before any upstream module is imported, never `~/.dsh`; keys are never printed.

Tests: `tests/server/*.test.mjs` and `tests/scripts/*.test.mjs`. Design: [Architecture](../docs/design/architecture.md).
