# Phase P5 results

The seven task commands, `/fold`, a status line and a pane. Measured on Claude Code 2.1.325 against upstream `a3f17eb` (0.54.1) on 2026-11-16.

## What was built

| Piece | Where | Notes |
|---|---|---|
| Task catalogue and fold | `scripts/build-ui.mjs` → `hooks/generated/task-modes.ts`, `fold-core.ts` | Upstream's `task-modes.js` and `fold-core.js` copied byte for byte under a header and `// @ts-nocheck`. The script refuses a source that gains an import, so a sync that changes them either carries over or fails loudly. `build-all.mjs` runs it |
| Task planner | `hooks/tasks-core.ts` | Pure: `parseCommandArgs`, `planTask(task, prompt, effort)` → the steps (tool, arguments, progress line) and the files to check. A port of the prompt rules in `academic-task.js`, with the effort tables from the copied catalogue. No `$`, no Node, so a test imports it as it is |
| Task commands | `hooks/tasks.ts` | `/ah-research`, `/ah-review`, `/ah-papers`, `/ah-references`, `/ah-write`, `/ah-analyze`, `/ah-hypotheses`. The effort is a leading `--effort <low\|medium\|high\|auto>` (also `--effort=`, `-e`, `effort=`); a bare first word is a topic (`low rank adaptation` is a query, not an effort). A two-line task takes ` -- ` for the line break. The command checks the line and the files (inside the folder, a file, at most 50 MB: upstream's words), then runs each step with `$.tool.call`. `deep_research` is two steps: `start` with `run: false`, then `run` with the run id the first step gave. The output is the progress lines and the tool's answer |
| `/fold` | `hooks/tasks.ts` | `foldReply(last reply, level)` from upstream's `fold-core`, over `$.session.messages()`. Levels `full brief points outline gist` or `1` to `5`; brief by default; the first line says how many of how many words are shown |
| Status line | `hooks/ui-core.ts` `composeStatus`, `hooks/mode.ts` `showStatus` | One line per plugin, so every writer goes through `showStatus`: `research mode on · 1 job running · gate FAIL (5 blocking)`. The mode is as before; the job count comes from this session's records under the mod's home; the gate comes from the engine. The line is written again only when it would read differently |
| Pane | `hooks/ui.tsx`, `hooks/ui-core.ts` | Opened by `/academic` with no word (or `pane`; `on`, `off`, `auto` and `status` are as they were). Four parts: **Project** (the engine's state card cut to a pane: title, bibliography, outline, structure, the gate and its first findings), **Jobs** (this session's running jobs first, then the last three that ended), **Notebook** (the last five entries of this session's file), **Library** (papers, citable, claims and notes from PaperMemory's database). Narrow: one column. From 96 cells: two (the project on the left, the other three stacked on the right). A small pane gets a shorter project part and no blank rows when the rows would not fit |
| Data bridge | `server/bin/ah-ui.mjs`, `server/src/panel.mjs` | The hooks module has no Node, so one process answers: `panel <cwd>` (project state and library) or `gate <cwd>` (the gate alone). Read only: `ah state --project`, and the PaperMemory database opened `?immutable=1` so even the `-shm` and `-wal` files are never created beside the shared store |
| Refresh | `hooks/ui.tsx` | A 5 s timer reads the job records, and the notebook while the pane is open. The engine side is read when the session starts, after each turn (`turn.complete` marks it stale) and every 30 s while the pane is open. Interactive sessions only; a headless run has no line to keep |
| State | `types/index.d.ts` | New value `panel` (one shaped value, so a refresh is one write and every reader redraws) |

## Verification

| Check | Result |
|---|---|
| `node --test 'tests/scripts/*.test.mjs' 'tests/server/*.test.mjs'` | 186 pass. New: `tasks.test.mjs` (54: upstream's real `submitAcademicTask` against `planTask` for 11 prompts at 4 efforts, the tool calls compared, the refusals in the same words, the pure helpers) and `ui-core.test.mjs` (17: the status text and key, the gate and card parsing, the job and notebook readers, the pane's text at four widths, the two layouts and their sections, gaps, ages, the run id) |
| `claude plugin test .` | 68 pass (27 new). `tasks.test.ts` (14): the commands are declared, each task's tool and arguments, the two-step research with the run id taken from the first answer, a start without a run id stops there, a refusal and an error stop with the reason, empty line / bad effort / missing file / path outside / not a file / over 50 MB refused with the usage and no tool started, `/fold` at a level and by number. `ui.test.tsx` (13): the line with jobs and gate, the timer and no rewrite when nothing changed, the gate read again after a turn and not before, no gate outside a project, a bridge that cannot run, `/academic` opens the pane and `status` does not, a pane that cannot be placed says why, the pane at **40 and 120 columns** (the Box widths and the stacking of the parts are asserted from the drawn tree), before-anything-was-read and empty states, refresh while open, spacing by rows, and a render that is not the mod's left to the engine |
| `claude plugin validate .`, `tsc -p . --noEmit` | Pass |
| `node scripts/measure-surface.mjs` | parity ok: 134 of 136 served (unchanged) |
| Live, headless (`tests/live/p5.mjs`) | `papers`: `claude -p "/ah-papers --effort low ..."` runs `literature_search` from the command hook with **no permission rule, no model turn, cost $0.000**, and prints the results. `errors`: six refusals (empty line, bad effort, missing file, path outside, a one-path `/ah-write`, no bibliography), each with its reason, no tool started. `status`: one line, `research mode off` outside a project and `research mode on` inside. `fold`: a reply of about 220 words folded to the gist, 6 words, no model turn ($0.014 for the reply). `research`: framed and run to the end, the report on disk (a title and an abstract on retrieval-augmented generation), two job records `completed`, 2 min 25 s with `AH_JOB_FOREGROUND_MS=600000` |
| Live, a real terminal in tmux (`tests/live/p5-tui.mjs`) | `status`: the line under the prompt reads `⚠ academic-harness: research mode on · gate FAIL (5 blocking)` in an engine fixture project. `pane_wide` (104 columns, inline): two columns, Project on the left and Jobs, Notebook, Library stacked on the right. `pane_narrow` (72 columns): one column in order, nothing wider than the terminal. `pane_docked` (200 columns): docked at the right, about 90 columns wide, one column. `task`: `/ah-papers` printed the search with no dialog. `fold`: `/fold gist` after a reply, 15 of 249 words. `job`: `/ah-research` went on as a job; the line said `1 job running`; the pane listed `▶ job-... deep_research`; the notice `Background job job-... finished` arrived; the line dropped the job. This is the plan's exit, drawn |
| Source checkout and `~/.dsh` | `check-upstream-clean.mjs` clean. No stray files in the PaperMemory folder |

## Decisions taken in P5

1. **Prefix `ah-`** (S7: `analyze` is already `data:analyze` of another plugin, and the other six names are short enough to collide too). The names are in `TASK_COMMANDS`, one place.
2. **The effort is a leading flag, not a trailing word.** A trailing or bare word cannot be told from the topic (`low rank adaptation`), and DSH's chips set the effort with a separate control. Four spellings are accepted; everything after them is the prompt, verbatim. `deep_research` with effort `auto` leaves out `effort`, so a conflict is the tool's own `needs_input`, shown as it came.
3. **` -- ` for the second line.** A slash command is one line. A real newline in the arguments wins if there is one.
4. **No permission rule is added for the commands' tool calls.** A first design added a `tool.check` allow for the mod's own `$.tool.call`. It was not needed (the docs say only a deny rule, a hook's ask or an organization's ask refuse such a call, and the live run showed it) and it could have overridden another plugin's or an organization's ask, so it was removed with its test.
5. **One status line, composed in one place.** The engine takes one `$.ui.status` per plugin, so the mode, jobs and gate cannot each write their own. `ui-core.ts` holds the little shared state (`live`); `showStatus` is the only writer.
6. **The gate is read by a process the mod owns, not by the hooks module.** The hooks module has no Node and no file reads beyond `$.fs`; `ah state` is the engine's own answer, so the bridge asks it and nothing here re-derives the gate.
7. **The pane draws from stored data and starts nothing.** A render can run ten times a second; the refresh writes one atom and the readers redraw.
8. **The layout follows the pane, not the terminal.** `e.props.bodyColumns` is what a docked pane has (about 88 at 200 columns, so one column there) and what an inline pane has (the whole width under 110 columns, so two columns from 96). The sections go in the order a narrow pane would want, and a small pane is shortened rather than scrolled for the first read.

## Known limits

- A headless slash command ends the session when it returns, so a job it detached ends with it. `AH_JOB_FOREGROUND_MS` high makes the whole run finish inside the command (shown). Interactively, the default window applies to each step: the prompt box is busy for up to 30 s per step (`start`, then `run`) before the job continues in the background and the notice takes over.
- The pane has no buttons (no refresh or kill key): `/academic` reopens and refreshes it, and `job_kill` is a tool. An inline pane is capped at about half the terminal's rows and scrolls past that.
- The engine side (`ah state`) costs a Node process, about 0.2 to 0.5 s, once a turn and once every 30 s while the pane is open. Outside an `ah.yaml` project no process is started for the gate.
- The gate on the line can be one turn old until the turn ends; the Stop gate (P3) is still what holds a turn.
- Not done and not in the plan: opening the pane at session start (it is the person's to open), and a command for a task the user types by name.

## Left for P6

`zvec_index` and the grep daemon (a mount with a lifecycle), `ah_rsi` (D10), the `server/dist` bundle and installing dependencies on first use, the marketplace entry and release.
