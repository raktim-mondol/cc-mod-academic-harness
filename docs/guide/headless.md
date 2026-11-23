# Running headless

For `claude -p`, scripts, CI and the Agent SDK: nobody is at the prompt, so nothing can be asked and nothing is drawn. This page says what the plugin does then, what Claude Code does that you should know about, and how to run it safely. Every claim here was checked with `tests/live/headless.mjs` and `tests/live/rsi.mjs` on Claude Code 2.1.330 (the evidence for each release is in its notes).

## What the plugin does when nobody can answer

| | In an interactive session | Headless |
|---|---|---|
| Author-only acts (`ah_author`) | Claude Code asks you | **Refused**, with the reason: "Nobody is available to confirm in a non-interactive session, so the call is refused: run it from an interactive session." |
| Applying a migration without `confirm` (`ah_migrate`) | Refused (pass `confirm=true` after the author agrees) | The same |
| Paid compute (`modal_run`, `runpod_run`, `vastai_run`) | Asks, with the cost ceiling and your session cap | **Refused**; nothing is rented and nothing is recorded |
| Registering a Paper2MCP server (`paper_mcp`) | Asks, and Claude Code asks again before it starts the server | **Refused**; nothing is written to `.mcp.json` |
| The writing guard (a folder with an `ah.yaml`) | Checks every write and shell call | The same, and it fails closed: if the engine cannot answer, writes are refused and reads still work |
| The self-improvement loop | Off unless you turn it on | **Never**: a headless run is not recorded and gets no lessons, whatever `AH_RSI` says, so a scripted run stays reproducible |
| The model router | Off unless you turn it on | The same setting |
| Background jobs | You are told when one ends | Nothing is queued, and the run ends when the command returns: use `job_wait` (at most 120 seconds a call) or set `AH_JOB_FOREGROUND_MS` high |
| Status line, pane, notices | Drawn | Not drawn |

The refusals hold under `--permission-mode bypassPermissions` too: that mode skips Claude Code's own prompts, not the plugin's. Do not set `AH_NO_ENFORCE=1` in CI: it switches the guard off.

## A folder you did not write

Claude Code asks before it starts a project's MCP servers (`.mcp.json`) and runs the hooks in a project's `.claude/settings.json`. In `claude -p` it does not ask. We saw both happen: a server registered in a folder's `.mcp.json` connected, and the folder's `SessionStart` hook ran, with no prompt. So running headless in a clone, a pull request or a downloaded archive runs that folder's programs.

`/academic doctor` (and `node server/bin/ah-doctor.mjs` in the folder) says so in a **Project startups** line, with names and never a command.

**Run a folder you did not write with `--restricted`.** In our checks it:

- ignores the user, project and local settings files, so the folder's `.mcp.json` servers and hooks did not start;
- removes the built-in tools that run commands or code (`Bash` and the others) and `WebFetch`, unless `--tools` names them, and confines the file tools to the working directories;
- removed `Bash` and `WebFetch` and kept `WebSearch`, and left the plugin's 129 tools, its 60 skills, its task commands (`/ah-papers` answered with no model call) and the writing guard working (the guard refused a write to a protected file) with the plugin given as below.

Under `--restricted` the user settings that enable installed plugins are ignored, so **give the plugin with `--plugin-dir <path to a checkout or an installed copy>`**; an installed plugin without it is not loaded.

**Flags that break the plugin** (each left it with no tools in our checks):

- `--bare` skips hooks and plugin loading: no guard, no tools.
- `--strict-mcp-config` on its own drops the plugin's own servers. With `--mcp-config` you would have to name them.

## A pattern for CI

```yaml
# .github/workflows/research.yml (shape only: pin your own versions and trim the tools to what the task needs)
permissions:
  contents: read            # nothing else: the job writes to its own workspace
jobs:
  analyse:
    runs-on: ubuntu-24.04   # a fresh machine for every run
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@<commit sha>
        with:
          persist-credentials: false
      - run: npm install -g @anthropic-ai/claude-code@<the version you tested>
      - run: node scripts/setup.mjs            # in a checkout of this plugin; installs its dependencies
      - name: Preflight
        run: node server/bin/ah-doctor.mjs       # exit 1 when the plugin cannot work; it also names what the folder starts on its own
        working-directory: paper
      - name: Run
        working-directory: paper
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          S2_API_KEY: ${{ secrets.S2_API_KEY }}   # only the keys the task uses
        run: |
          claude -p "/ah-papers --effort low sparse autoencoders" \
            --plugin-dir "$GITHUB_WORKSPACE/plugin" \
            --restricted \
            --allowedTools "mcp__plugin_academic-harness_ah__literature_search" \
            --max-budget-usd 2 \
            --no-session-persistence \
            --output-format json > result.json
```

Points that matter more than the syntax:

- one task, an explicit `--allowedTools` list, a `--max-budget-usd`, and no `--dangerously-skip-permissions`;
- secrets as environment variables of the one step that needs them, not of the job;
- tools that call a model use your login or key under `llm_budget_usd` (default 5 USD a server run); rented compute is refused here, so a CI run cannot spend on it;
- the guard's log is `<project>/.ah/claude-hooks.jsonl`: keep it as an artifact when a run was refused something.

## Keys

Export the provider's variable (`S2_API_KEY`, `BRAVE_API_KEY`, `FIRECRAWL_API_KEY` and so on; [Keys and credentials](keys.md)) or save the plugin option beforehand with `claude plugin configure`. A provider whose key is not set is simply not offered: Claude uses `WebSearch`, `WebFetch` (removed under `--restricted`) and `literature_search`.

## When a run was refused

The model receives the refusal and the run goes on; read it in the transcript (`--output-format stream-json` shows each tool result). A refusal that says "Nobody is available to confirm" is the plugin working as designed: do that step in an interactive session.

Next: [Troubleshooting](troubleshooting.md).
