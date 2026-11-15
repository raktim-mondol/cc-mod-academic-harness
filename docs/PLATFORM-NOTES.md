# Platform notes (phase P0)

Results of the eight platform checks from `IMPLEMENTATION_PLAN.md` section 7, P0. Each result says how it was observed. Nothing here is taken from documentation alone unless marked **[docs]**.

| | |
|---|---|
| Claude Code | 2.1.325 (the mods API is early access and may change; rerun these checks after an update) |
| Run on | 2026-11-16, Linux, Haiku 5.5 for the nested runs |
| Probe | `tests/probe/` (a throwaway plugin named `ahprobe`; not part of the shipped mod) |
| Runner | `scripts/probe-run.mjs`, report `scripts/probe-report.py`. Raw output is under `~/.cache/ah-cc-p0/out/<scenario>/` |
| Interactive | one tmux session on a private socket (`tmux -L ahp`), killed afterwards |

## Summary

| Check | Result | Changes the plan? |
|---|---|---|
| S1 skills, agents, commands next to a hooks module | **Pass.** All three load | No |
| S2 manifest `mcpServers` | **Pass.** Starts a stdio server. Tools are `mcp__plugin_<plugin>_<server>__<tool>`. `${CLAUDE_PLUGIN_ROOT}` is substituted | One correction to tool-name matchers (below) |
| S3 server cwd, session id, roots | **Pass.** cwd is the session directory. `CLAUDE_CODE_SESSION_ID` is in the server environment. `roots/list` is answered | No |
| S4 `userConfig` to the server environment | **Pass** for sensitive and plain fields, with a caveat on secure storage | Launchers must treat `""` as unset |
| S5 function hooks on classic events | **Pass.** All four fire with no settings hook configured. `deny`, `block` and `additionalContext` work | The `classic.PreToolUse` input is not the settings-hook JSON (below) |
| S6 `tool.check` answering `ask` | **Pass.** A person gets a dialog in default, acceptEdits and auto. With nobody to ask, it becomes a deny | No. The wording in the plan was right |
| S7 command names | A command from `$.command.register` is **bare** (`/probe`). Files in `commands/` are namespaced (`/ahprobe:probe-cmd`) | P5: prefix the task command names |
| S8 `ah hook pre` through `$.process.run` | **About 105 to 111 ms** per call, warm | No. A 120 s timeout is generous |

S1 and S2 passing means the single-plugin layout holds. S5 passing means the guard stays on classic function hooks, not on `tool.call`.

## S1. Skills, agents and commands beside a hooks module

Observed in the `system/init` event of `claude -p --plugin-dir tests/probe`, then by using each one:

- `plugins` lists `ahprobe` (source `ahprobe@inline`) and `academic-harness` side by side.
- `skills` has `ahprobe:probe-skill`. Loading it with the Skill tool returned the skill's text (`PROBE-SKILL-LOADED`).
- `agents` has `ahprobe:probe-agent`. The Agent tool with that `subagent_type` ran it (`PROBE-AGENT-LOADED`).
- `slash_commands` has `ahprobe:probe-cmd` from `commands/probe-cmd.md`. Running `/ahprobe:probe-cmd` returned the file's text. A skill is also a slash command (`ahprobe:probe-skill`).

Skills, agents and commands are namespaced with the plugin name.

## S2. A manifest `mcpServers` entry

- `plugin.json` `mcpServers.probe` with `command: "node"` and `args: ["${CLAUDE_PLUGIN_ROOT}/server.mjs"]` started. The init event lists the server as `plugin:ahprobe:probe`, status `connected`.
- The server's own report shows `CLAUDE_PLUGIN_ROOT` substituted in `args` and in `env` (`/home/raktim/cc-mod-academic-harness/tests/probe`).
- Tool names are `mcp__plugin_ahprobe_probe__probe_env`. A plugin whose name has a hyphen keeps it: a copy named `academic-harness` with a server `ah` gave `mcp__plugin_academic-harness_ah__probe_env`. So the matcher for this mod is `/^mcp__plugin_academic-harness_ah__/`, and `$.mcp.connect` and any `mcp__` text in the prompt must use that prefix.
- MCP tools are deferred. The model reached them through `ToolSearch` (`select:<full name>`) before calling.
- A persistent per-plugin data directory exists: `CLAUDE_PLUGIN_DATA`, which was `~/.claude/plugins/data/ahprobe-inline` for the `--plugin-dir` plugin (the folder is created empty). `CLAUDE_PROJECT_DIR` is also set. The plan keeps its own home under `~/.local/share/cc-mod-academic-harness/` and does not need these, but `CLAUDE_PLUGIN_DATA` is the natural place if the mod is later installed rather than loaded by `--plugin-dir`.

## S3. Server working directory, session id, roots

- `process.cwd()` in the server is the session's working directory (`~/.cache/ah-cc-p0/work/<scenario>`), not the plugin folder.
- `CLAUDE_CODE_SESSION_ID` is in the server's environment and equals the `session_id` in the init event and the id the hooks module reads with `$.session.id()`. (The nested runs drop that variable from the parent environment, so this is Claude Code setting it for the child.)
- The client advertises `roots: { listChanged: true }` and answers `roots/list` with the session directory as a `file://` URI.
- Other variables the server gets: `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_EFFORT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PROJECT_DIR`, `CLAUDECODE`.
- The per-call `tools/call` carries `_meta["claudecode/toolUseId"]`. P2 can use it as `callId`.

Design consequence: `exec.agent.session.header.cwd` can come from `process.cwd()` at startup, checked against `roots/list`, and the session id from the environment. No tool needs the hooks module to pass them in.

## S4. `userConfig` to the server environment

With a sensitive field and a plain field declared in `plugin.json` and referenced as `"${user_config.probe_secret}"` and `"${user_config.probe_plain}"` in the server's `env`:

- Values supplied through `--settings` (`pluginConfigs["ahprobe@inline"].options`) reached the server. The server reported only length and a SHA-256 prefix, and both matched the expected values (23 and 16 characters).
- The secret value appears nowhere in the stream output or the probe log (searched for it).
- With no value configured, the variable is **set to the empty string**, not absent. Launchers and `resolveEnv` must treat `""` as unset.

Not tested: the secure-storage path a real install uses for sensitive fields (the type docs say sensitive options live in secure storage). The `--settings` route may not match it. P2 should repeat this once with a value entered through the config menu in an interactive session.

## S5. Function hooks on classic events

With no settings hook configured, in `claude -p`:

| Hook | Observed |
|---|---|
| `classic.UserPromptSubmit` | Fires. `additionalContext: ['PROBE-PROMPT-CONTEXT']` reached the model, shown as `UserPromptSubmit hook additional context: PROBE-PROMPT-CONTEXT` |
| `classic.PreToolUse` | Fires for built-in and MCP tools, and for `ToolSearch`. `{ deny: '...' }` refused a Bash call: the tool result was an error carrying the reason text, the command never ran, and the run's `permission_denials` lists it |
| `classic.PostToolUse` | Fires after a tool that ran (not after a denied one). `additionalContext` reached the model |
| `classic.Stop` | Fires. `{ block: '...' }` kept the turn going: the reason reached the model, which answered `AGAIN`. The next Stop event had `stop_hook_active: true`, so the hook can tell it is the second pass |

**The `classic.PreToolUse` input is the `tool.call` envelope, not the settings-hook stdin JSON.** `e.tool` is the tool name and the tool's own arguments are flattened onto `e` (`e.command` for Bash, plus `e.tool_use_id`). The other classic events keep the stdin shape (`e.tool_name`, `e.stop_hook_active`, ...). The P3 guard bridge must rebuild `{ hook_event_name, tool_name, tool_input, session_id, cwd, transcript_path }` for `ah hook pre` from the envelope, taking `cwd` and the session id from `$.session`. This is stated in the type declarations too (`classic.PreToolUse alone differs: its e is ToolCallEnvelope`).

Failure behaviour:

- A `tool.call` hook on Bash that **throws, with no `.catch`**: the hook was skipped and the command ran (`THROWTEST` came back). A gating hook without `.catch` fails open.
- A `classic.PreToolUse` hook that throws, with a `.catch` that returns `{ deny }` when `next.called` is false: the Bash call was refused with the `.catch` reason, and the catch ran once. This is the fail-closed pattern P3 needs.

Not tested here: a hook that times out (as opposed to throwing), and a `.catch` that itself exceeds its 1 s limit. P3 must keep the catch handler free of `$.process` calls.

## S6. `tool.check` answering `ask`

A `tool.check` hook on the probe tool returning `{ decision: 'ask', reason }`.

Under `claude -p` (nobody to ask, `approver` is `null`):

| Mode | Allow rule for the tool | Result |
|---|---|---|
| default | yes (`--allowedTools`) | Denied: `Permission to use <tool> denied by plugin ahprobe: PROBE-ASK from tool.check`. The hook tightened the rule |
| default | no | Denied, same text |
| acceptEdits | yes | Denied, same text |
| auto | yes | Denied, same text |
| default, hook not asking (control) | yes | Ran |

In an interactive session (tmux), `approver` was `"person"` and the same hook produced a confirmation dialog in **auto**, **manual (default)** and **accept edits**:

```
plugin:ahprobe:probe — Probe Noop Tool: (MCP)
Hook tool.check requires confirmation for this tool:
PROBE-ASK from tool.check [plugin:ahprobe]
Do you want to proceed?   1. Yes   2. No
```

Answering Yes ran the tool. Answering No ended the call with `Interrupted · What should Claude do instead?`. The footer cycles manual, accept edits, plan, auto with Shift+Tab. This user's default interactive mode is auto.

Consequences:

- `tool.check` is the right place for `ah_author` and paid compute. The change proposed in `HOW-CLAUDE-CODE-MODS-WORK.md` section 17 (move the ask to `$.ui.ask` in `tool.call`) is **not needed**.
- Under `-p` and the Agent SDK an `ask` is a refusal. The reason text is what the model reads, so it must say how to proceed (for example, run the call from an interactive session).
- Plan mode was not tried with the ask.

## S7. Command names

- `$.command.register({ name: 'probe' })` in `session.start`, answered by a `command.run` hook: the user types `/probe`. It is **not** namespaced. The init event's `slash_commands` lists it as plain `probe`. Output is shown prefixed by the plugin: `ahprobe: PROBE-COMMAND-RAN`.
- A file `commands/probe-cmd.md` is `/ahprobe:probe-cmd`.
- `$.command.register` throws on a name a built-in already has, and bare names can collide with another plugin's.

For P5: prefix registered commands (`/ah-research`, ...), or use `commands/*.md` files where a prompt is enough. `/academic` is fine until another plugin claims it; check `slash_commands` at P1.

## S8. `ah hook pre` through `$.process.run`

The engine was installed in a private venv built from `git archive a3f17eb vendor/academic-harness` under `~/.cache/ah-cc-p0/snap` (the source checkout was not written). Called from a `classic.PreToolUse` hook with `$.process.run([ah, 'hook', 'pre'], { stdin, timeoutMs: 120000 })` on an allowed call (a Read of a path outside any `ah.yaml` tree):

- Two calls in one session: 111 ms and 104 ms, exit 0, empty stdout, empty stderr (an allow prints nothing).
- Directly from the shell, `ah hook pre` took 0.20 s wall time including the shell's own startup.

Per guarded tool call, the guard adds about 0.1 s. Outside an `ah.yaml` tree the plan skips the process entirely.

## Other findings

- **Status line.** `$.ui.status(text)` shows in the interactive footer as `⚠ academic-harness: <text>`: a warning mark and the plugin name are added. For P5's status line, expect that framing.
- **Types.** An interactive load writes `.claude-plugin/types/` and a `tsconfig.json` into the mod folder (both gitignored here). `tsc` is not installed; `npx --yes -p typescript@5.6.3 tsc -p . --noEmit` works.
- **Contract file.** `types/index.d.ts` may not contain a bare `export {}`: validate refuses it ("a contract exports types and nothing else"). `export type` plus `declare module 'claude-code'` is accepted.
- **`claude plugin test`.** An `ui.status` hook in a test must return `{ value: undefined }`; returning nothing fails the test with "returned no result".
- **`session.start` input.** In `claude -p` it is `{ cwd, surface: null, isInteractive: false }`. A mod can use `isInteractive` to skip drawing.
- **Nested runs** reported $0.01 to $0.02 each on Haiku (about 20 `-p` runs). The interactive tmux session's cost was not totalled.

## What changes in the plan

1. P3 step 3: the guard translates the `classic.PreToolUse` envelope, not stdin JSON. (Already implied; now confirmed.)
2. P5: registered commands are bare. Prefix them.
3. P2: treat empty `userConfig` environment values as unset. Repeat S4 once through the interactive config menu.
4. The tool-name matcher and the prompt's tool-name map use `mcp__plugin_academic-harness_ah__`.
5. `HOW-CLAUDE-CODE-MODS-WORK.md` section 17 row on `tool.check`: corrected.
