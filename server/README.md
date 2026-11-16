# server/

Node code the plugin runs as processes. Two MCP servers, and the helpers the hooks module runs because it has no Node itself.

## `bin/`

| Process | What it is |
|---|---|
| `ah-mcp.mjs` | **The `ah` MCP server**: loads Academic Harness's tool modules from the snapshot and serves them over stdio. On a first start with no snapshot it answers with `doctor` alone, fetches it, and swaps in the full list |
| `papermemory-mcp.mjs` | **The PaperMemory server**: a launcher that installs the CLI into the mod's home if needed and runs `papermemory mcp` |
| `ah-hook.mjs` | The guard bridge: runs the engine's `ah hook <event>` for the hooks module, exit 3 when there is no engine, 124 on a time-out |
| `ah-approve.mjs` | The approval text for a paid-compute call (provider, instance, ceiling, session cap) |
| `ah-ui.mjs` | The data for the pane and the status line: the engine's state card, the PaperMemory counts |
| `ah-doctor.mjs` | What is ready and what is not (`/academic doctor` outside a session) |

## `src/`

The host, in the order a request meets it: `host.mjs` (the stdio loop and the call), `manifest.mjs` (which modules, by area), `context.mjs` (the `ctx` upstream's modules expect), `exec.mjs`, `schema.mjs`, `render.mjs`; `jobs.mjs`, `jobtools.mjs`, `llm.mjs` for long tools and the model route; `engine*.mjs` for the writing engine's environment; `bootstrap*.mjs`, `late-host.mjs`, `snapshot.mjs` for the first start; `doctor.mjs`, `doctortool.mjs`, `compat.mjs` (the Claude Code versions the mod was seen on, and the record the hooks module leaves); `panel.mjs`; `env.mjs`, `paths.mjs`; and `fit.mjs`, the list of what the mod leaves out. Each file has a header comment saying what it is for.

Rules: standard output belongs to the protocol (everything else goes to stderr); `DSH_HOME` is the mod's own home before any upstream module is imported, never `~/.dsh`; keys are never printed.

Tests: `tests/server/*.test.mjs` and `tests/scripts/*.test.mjs`. Design: [Architecture](../docs/design/architecture.md).
