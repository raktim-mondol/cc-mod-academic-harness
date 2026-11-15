# Phase P2 results

Tool host and tier-1 tools. Measured on Claude Code 2.1.325 against upstream `a3f17eb` (0.54.1) on 2026-11-16.

## What was built

| Piece | Where | Notes |
|---|---|---|
| Tool host | `server/src/host.mjs`, `server/bin/ah-mcp.mjs` | Stdio MCP server, newline-delimited JSON-RPC, no SDK. `initialize`, `ping`, `tools/list`, `tools/call`, `notifications/cancelled` (aborts the call's `AbortSignal`). Calls run concurrently. A tool's own failure is an `isError` result, never a protocol error. Per-tool time limit from the definition's `timeoutMs`, else `AH_TOOL_TIMEOUT_MS`, else 10 minutes. `--list` prints what would be served |
| Context for `apply()` | `server/src/context.mjs` | `tools.register/get/resolve/execute`, `on` (recorded, never fired), `effect`, `logger`, `get` (answers undefined). Any other service, for example `ctx.llm` or `ctx.jobs`, throws `UnportedServiceError` naming the service and the module |
| Per-call context | `server/src/exec.mjs` | `callId` is `_meta["claudecode/toolUseId"]`, session id is `CLAUDE_CODE_SESSION_ID`, cwd is the server's cwd (all from S3) |
| Schema | `server/src/schema.mjs` | A copy of `parameters`, which `defineTool` already compiles to JSON Schema. A DSL branch handles a plain-object definition |
| Output | `server/src/render.mjs` | `output.render` blocks to MCP text. Over 40,000 characters (`AH_MAX_RESULT_CHARS`) the head is returned and the whole text goes to `<cwd>/.dsh/tool-output/<tool>-<callId>.txt`, named in the reply. DSH's "Settings -> Academic Harness API keys" wording is replaced |
| Module discovery | `server/src/manifest.mjs` | From `index.js` (its `applyX(ctx)` calls) and the preset's `academic-harness/<module>` rows. 109 entries: 34 tier 1, 66 later, 9 host-only |
| Environment | `server/src/env.mjs`, `server/src/paths.mjs` | `DSH_HOME` is the mod's home before any upstream import. Installers are off unless the person sets them. Keys: see below |
| Dependencies | `scripts/install-deps.mjs` | `npm ci --omit=dev` inside `upstream/` (59 packages, about 114 MB, 1 s from a warm npm cache). `sync-upstream.mjs` keeps `node_modules` when `package-lock.json` is unchanged |
| Manifest | `scripts/build-manifest.mjs` | Writes the `ah` server entry and 32 key and address fields from upstream's `KEY_FIELDS` as `userConfig`, plus `tool_areas`. `--check` fails when `plugin.json` is stale |
| Parity | `scripts/measure-surface.mjs` | See below |
| Snapshot integrity | `scripts/test-upstream.mjs` | Runs 25 of upstream's own test scripts against `upstream/` |
| Snapshot | `scripts/sync-upstream.mjs` | Allow-list grew to every root `.js`, plus `scripts`, `docs`, `client`, `.github` and the asset folders. 244 paths, 167 MB with dependencies |

35 tools are served, in four areas (`AH_TOOL_AREAS` or the `tool_areas` setting trims them):

- **search** (19 modules): `literature_search`, `openalex_search`, `s2_search`, `pubmed_search`, `arxiv_search`, `crossref_lookup`, `journal_search`, `domain_search`, `database_catalog`, `core_search`, `consensus_search`, `elicit_search`, `parallel_search`, `parallel_extract`, `brave_search`, `tavily_search`, `exa_search`, `perplexity_search`, `jina_read`
- **papers**: `paper_resolve`, `paper_get`, `paper_context`, `paper_download`, `openalex_citations`, `integrity_check`, `citation`, `manuscript_citations`, `reference_library`, `pdf_to_markdown`
- **notebook**: `notebook`, `scientific_result`, `fold_text`, `research_template`
- **skills**: `skill_search`, `skill_load`

## Verification

| Check | Result |
|---|---|
| `node --test 'tests/server/*.test.mjs' 'tests/scripts/*.test.mjs'` | 61 tests pass (31 of them are new: schema, context, manifest, render, env, exec, the stdio server, five in-process protocol cases, parity) |
| Surface parity | Upstream registers 136 tools. The manifest's modules register the same 136, and so does upstream's own `collectToolDefinitions()`. The host serves 35, each with the same description and parameters as upstream. The other 101 are in modules classified `later`. Nothing is served from a module that is not tier 1 |
| Upstream's own tests (`scripts/test-upstream.mjs`) | 25 of 25 pass in `upstream/` |
| Live, nested `claude -p` Haiku, `tests/live/p2.mjs search` | `ah` connected. The model found the tools with `ToolSearch`, called `openalex_search` twice, then `notebook log`. The entry's id is the tool-use id, and it is in `<cwd>/.dsh/notebook/<session id>.jsonl` with three DOIs. $0.02 |
| Live, key through plugin config, `tests/live/p2.mjs key` | A fake `s2_api_key` set in `pluginConfigs` reached the server, `database_catalog` reported `S2_API_KEY: configured`, and the value is in no output line. $0.02 |
| `claude plugin validate .`, `claude plugin test .`, `tsc -p . --noEmit` | Pass (9 plugin tests) |
| Source checkout and `~/.dsh` | `scripts/check-upstream-clean.mjs`: clean after the unit tests, the upstream tests and both live runs |

## Decisions taken in P2

1. **`index.js` is not run.** Its `apply()` calls `seed()` (copies about 90 skills into `DSH_HOME` and patches profiles) and `registerKeysSettings()` (binds a DSH settings service). The mod needs neither. The manifest reads index.js's component calls instead, so a component upstream adds still appears as a drift line.
2. **Real `defineTool`.** The package imports cleanly outside DSH (D8). It also validates arguments, so a bad call comes back as `invalid arguments: "action" must be one of [...]`.
3. **Keys travel as `AH_KEY_<NAME>`.** An unset `userConfig` field arrives as `""`. Passing it as `<NAME>` would replace a variable the person exported with an empty string. The host copies `AH_KEY_<NAME>` to `<NAME>` only when that is empty, so the shell still wins, as `resolveEnv` has it.
4. **Key fields are limited to what is served.** Fields for compute, image generation, subagent routes, zvec and the long-running tools stay out of `userConfig` until their tools exist (`NOT_YET` in `build-manifest.mjs`).
5. **`.dsh/tool-output/`** is a new location the DSH host does not use. It holds the full text of a clipped result.
6. **`papermemory_library` stays hidden** (P1 decision 3). `reference_library` is now served here, with the right cwd.
7. **Host notes** now name `skill_search` and `skill_load`, and say which tool groups are not served yet.

## Costs the user will see

- Tool schemas: 35 tools are about 70,000 characters (roughly 17,500 tokens). They are deferred, so a session pays only for the names (about 1,700 characters) until it loads one. Loading `citation` costs about 6,600 characters.
- Startup: `--list` loads all 35 tools in 0.2 s.
- Disk: `upstream/` is 167 MB with its dependencies, none of it committed.
- Always-on research section: 4,227 tokens (was 4,100), from the added notes.

## Open items

- **Interactive secure storage for `sensitive` fields.** The key test uses `pluginConfigs` through `--settings`, the S4 route. The config menu of an interactive session, which stores sensitive values in the keychain, was not tried. It is the one P2 exit item not shown by a run.
- **Dependencies are installed by a script.** A fresh clone has no `upstream/`, no `node_modules`, and the server exits with a message saying to run `scripts/install-deps.mjs`. P6 bundles the code and installs native dependencies on first use.
- **The server's cwd is fixed at start.** It is the session directory (S3). `roots/list` is not consulted, so a session that changes directory keeps the original.
- **`skill_search` marks the 86 listed skills and the 6 excluded ones alike as "in the session catalogue"**, because it reads upstream's core list. Harmless, and wrong for the six.
- **arXiv: a multi-word query is an exact phrase.** `arxiv_search` with `retrieval augmented generation survey` returned 0 results, and `all:retrieval augmented generation` returned 1,037,547. That is upstream's documented behaviour (`buildSearchQuery`), not the host. The model can read it in the tool description.
- **`on` subscriptions are recorded, not fired.** No tier-1 module registers one. P4 modules that do (`paper-mcp.js`, `papermemory-dream.js`) need a decision.
- **Not run:** upstream's whole suite (`--all`, needs the engine venv), and the keyed providers (Scopus, Web of Science, Elicit, Consensus, Parallel and the other web-search tools) with a real key: their request code is covered by upstream's tests, but no call was made.
