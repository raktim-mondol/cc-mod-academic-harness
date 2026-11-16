# State and privacy

What the mod reads, what it writes and where, and what it can spend.

## Where things live

| What | Where |
|---|---|
| The source snapshot, its dependencies and the writing engine's environment | `<plugin>/upstream/` in a set-up clone, or `<home>/upstream/<commit>/` in an installed copy (the folder of an earlier commit goes a week after its last use) |
| PaperMemory's CLI, TextFold, job records and logs, the compute ledger, the first-start state | `~/.local/share/cc-mod-academic-harness/home/` (`AH_MOD_HOME`) |
| The PaperMemory library | `~/.local/share/papermemory/papermemory.db`, shared by every tool on this machine that uses PaperMemory |
| A project's notebook and research ledgers | `<project>/.dsh/` (the folder name is fixed by the tools) |
| The writing engine's state, and the guard's log | `<project>/.ah/` (`claude-hooks.jsonl`) |
| A tool result longer than 40,000 characters, in full | `<project>/.dsh/tool-output/`, removed after 30 days (`AH_TOOL_OUTPUT_KEEP_DAYS`) |
| Usage counts: per tool, skill, agent and command, how often and when last, one small file per server run and per session | `<home>/usage/`, removed after a year (`AH_USAGE_KEEP_DAYS`) |
| A small record that the hooks module loaded (session id, Claude Code version, time), one per session | `<home>/mod-seen/`, removed after a week |
| A system prompt over 30,000 characters, while a model call that needs it runs | `<home>/tmp/`, removed when the call ends |
| The `/academic on\|off` override, the pane's data, which job notices were shown | Claude Code's plugin state for the session; nothing of the mod's on disk |

## Usage counts

So that the next review of what the plugin leaves out can start from what is used and not from guesses, the mod counts, for each tool, skill, agent and command, how many times it was used, how many of those failed, how many were called with arguments the tool's schema refuses (a count, never the arguments), and when it was last used. That is all: no argument, path, prompt, query or result is ever kept, and nothing is sent anywhere. The files are in `<home>/usage/`; deleting that folder resets the counts. `/academic usage` shows them, with the names that were never used; `/academic doctor` gives one line.

The server counts its tools. The hooks module counts this plugin's skills and agents as Claude starts them, and the commands you run. A skill you start yourself by typing its name, and a skill that Claude Code loads without the `Skill` tool, are not seen. Turn it off with the `usage_counts` setting or `AH_USAGE=0`.

## What it reads

- **A local Academic Harness checkout**, if there is one, only at setup or update, only with `git archive` against its object database, and never written. `node scripts/check-upstream-clean.mjs` proves it untouched (its HEAD, its working-tree status and `~/.dsh`).
- **The PaperMemory database**, opened read-only and immutable (`?immutable=1`) by the pane, so not even a `-shm` or `-wal` file appears beside it. The PaperMemory tools themselves write to it, as they always did.
- **Keys**: from the plugin's options and the environment, into the server's environment. The doctor and the diagnostics print names, never values.

## What it never touches

- **`~/.dsh`**, the data folder other Academic Harness tools keep. The server refuses to run if its home would be that folder, and the tests check it is unchanged.
- **A local checkout's working tree.**
- **Anything outside the project folder**, by the tools that take paths: they refuse a path that leaves the session folder.

## What it can cost

| Source | When | Bounded by |
|---|---|---|
| Tools that call a model (`deep_research`, `deep_review`, `coscientist`, ...) | They run headless `claude -p` calls under your login | `llm_model`, `llm_budget_usd` (default 5 USD a server run, 1 USD a call) |
| `evidence_check=run` | One model call per paragraph a turn changed, at the end of the turn | The same budget |
| Rented compute | `modal_run`, `runpod_run`, `vastai_run` | An approval every time, the cost ceiling in it, `compute_session_cap_usd`, and a ledger |
| Keyed search and image APIs | Only with a key | The provider's own limits |

Task commands themselves (`/ah-papers`, `/fold`, `/ah-watch`, `/academic ...`) make no model call.

## What the guard does

In a folder with an `ah.yaml` (and nowhere else), every `Write`, `Edit`, `NotebookEdit` and `Bash` call is checked by the writing engine before it runs (about 0.14 s): protected files cannot be changed, unit anchors cannot be dropped, and the author-only acts (waive, approve, accept) cannot be run from the shell. If the guard cannot run, those calls are refused and reads still work. `ah_author` and `ah_migrate` apply ask you first. Outside such a folder nothing runs.

## Text that is not an instruction

Search results, abstracts and paper text are wrapped in `<untrusted-source>` and the research-mode text tells the model to read them as claims, never as instructions.

Next: [Troubleshooting](troubleshooting.md).
