# What to do next

Everything that can be done without a live session is done. What is left is running the live scripts, trying the mod on real work, and tagging. This page is the order to do them in, with what to expect and what to do if one fails. Tick the table at the bottom as you go.

## Plugin or mod? (both, and it works)

In Claude Code a **plugin** is the package: a folder with `.claude-plugin/plugin.json`. A **mod** is a plugin that also carries a hooks module (`hooks/hooks.json` with `"modules": ["./register.tsx"]`): code that runs inside Claude Code and can add commands, draw a pane and a status line, and guard tool calls. This repository is one plugin with five kinds of part, and "mod" is the name of the part that is code in Claude Code's own process:

| Part | What it is | Where |
|---|---|---|
| The mod | Research mode, the guard, approvals, the commands, the pane and the status line | `hooks/` |
| MCP servers | The research tools (`ah`) and PaperMemory | `server/` |
| Skills and agents | Instructions and specialists | `skills/`, `agents/` |
| The manifest | Settings, the servers, the version | `.claude-plugin/plugin.json` |

So there is nothing to choose between: loading the plugin loads the mod. It has been seen working, in Claude Code 2.1.325, from `--plugin-dir`: the commands answer, the status line and the pane draw (also in a real terminal under tmux), the guard refuses protected writes, and the servers connect with their tools. See [How Claude Code mods work](../design/how-claude-code-mods-work.md).

**Not yet seen:** the mod part of a copy *installed from the marketplace* (step 4 below), and any Claude Code version other than 2.1.325 (`/academic doctor` says which version is running and whether the mod was seen on it; after running the live scripts on another, add it to `TESTED_VERSIONS` in `server/src/compat.mjs`, see [Testing](testing.md)). The servers, skills and agents are ordinary plugin parts; the hooks module needs a Claude Code that has the mod platform.

## Before you start

```
cd ~/cc-mod-academic-harness
node scripts/setup.mjs                  # once, if core/ has no node_modules
node scripts/test-engine.mjs            # once: the engine's test environment, which p3 and the tmux scripts use
```

You need a working `claude` login, `tmux` for the `-tui` scripts, and the network for step 4 (`npm`) and step 5. Each script writes under `~/.cache` and caps its own spending. `~/.dsh` must be unchanged at the end.

## The order

| # | Run | You should see | Cost |
|---|---|---|---|
| 1 | `node tests/live/p1.mjs` | `init`: 21 agents, 59 skills, `/academic`, 129 tools; `mode`: no research section outside a project, one inside; `skill`; `papermemory` | cents |
| 2 | `node tests/live/p5.mjs papers errors status fold` then `node tests/live/fit.mjs` | The commands answer with no model turn; the catalogue is 55 skills and 21 agents; `search_route` uses `literature_search`, not `WebSearch` | cents |
| 3 | `node tests/live/p3.mjs` | 15 scenarios `ok`: each way past the guard is refused | about 30 cents |
| 4 | `node tests/live/install.mjs first_start`, then `install.mjs marketplace` | The server answers with the `doctor` tool alone, copies the core and installs its dependencies, then lists 129 tools; the installed copy sets itself up and its next session has every tool and `/ah-papers` works. **This is the step that shows the mod works from a marketplace install** | cents, network |
| 5 | `node tests/live/p6.mjs` | `doctor`, `fresh` (a clone set up from a copy of this repository, with nothing else) | cents, network |
| 6 | `node tests/live/p5-tui.mjs`, `p3-tui.mjs`, `p4-tui.mjs` | The status line, the pane at three widths, a job from start to notice, the permission dialogs | about 20 cents |
| 7 | `node tests/live/p4.mjs`, `p2.mjs`, `p2-config.mjs` | The model route, deep research and review, a saved key reaching an installed copy | cents |

A script prints `name: ok: ...` or `name: FAIL ...` per scenario, with the screen for the terminal ones. If something fails, read `/academic doctor` first, then `claude --debug`, then `<project>/.ah/claude-hooks.jsonl` for the guard; the script's own output usually names the cause. Fix it, or keep the output and bring it back.

## Things only you can check

These need your keys or accounts, so no script can:

- **Paid compute.** One tiny run on the provider you use (`modal_run`, `runpod_run` or `vastai_run`, a few seconds, a low `compute_session_cap_usd`). Check the dialog shows the provider, the ceiling and the cap, and that the ledger records the spend.
- **A key that changes results.** Set `S2_API_KEY`; the `429` in `literature_search` should go away. If you have Consensus, Scite or Firecrawl keys, name them in `sources` once.
- **`image_generate`** with a Gemini key, and **`evidence_check=run`** on a small `ah.yaml` project.
- **A deep research run on a real question** with `llm_model` as you would use it; compare what it spends with the `llm_budget_usd` you set.

## Then use it

Use it for a few days on real work, for example `/ah-papers`, then `/ah-review` on a draft, then a real `deep_research`. Notice: does Claude reach for `literature_search` rather than the web; is the pane worth opening; is `/ah-research` holding the prompt too long (`AH_JOB_FOREGROUND_MS`); which skills never load (candidates for on-demand) and which tools it never finds. `/academic usage` answers the last two from counts instead of memory (after a few weeks, it is the input for the next review in [the fit review](../design/fit-review.md)). The hooks module's part of it, the skills and agents, has been seen working only against a stand-in: in a live session, start a skill and an agent and check that `/academic usage` lists them. Write what annoys you in the changelog under a new heading. That is the input for the next round, and it is worth more than another test.

## When it is green

```
git tag -a v0.4.0 -m "0.4.0"
git push origin v0.4.0
```

Then update [the changelog](../../CHANGELOG.md) (remove "not tagged") and [Releasing](releasing.md) has the rest. Sharing the repository beyond the people you invite is a separate decision: the licences of what a public repository would ship need the review noted in [the architecture page](../design/architecture.md).

## Log

| Date | Step | Result | Notes |
|---|---|---|---|
| | 1 | | |
| | 2 | | |
| | 3 | | |
| | 4 | | |
| | 5 | | |
| | 6 | | |
| | 7 | | |
| | Keys, compute, real use | | |
