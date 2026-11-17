# Commands, the pane and the status line

## `/academic`

| Command | What it does |
|---|---|
| `/academic` | Opens the pane (below). With no word it also says the research mode |
| `/academic on`, `off`, `auto` | Research mode for this session. `auto` (the default) is on in a folder that has, or sits under, an `ah.yaml`. While on, a research section (about 2,900 tokens) is added to the system prompt. The setting `research_mode` changes the default |
| `/academic status` | The mode, and why |
| `/academic usage [--all]` | Which tools, skills, agents and commands have been used, how often, and which never have, and the tools that were called with arguments their schema refuses (names and numbers only). `--all` lists every name instead of the most used and the first of the never used. Turn counting off with the `usage_counts` setting |
| `/academic doctor` | What is ready and what is not, including whether the hooks module loaded in this session and whether the Claude Code running it is a version the mod was seen working on. `--online` also asks GitHub whether Academic Harness has moved past the commit the plugin holds |

## Task commands

Seven research tasks as slash commands. Each starts the tool the task needs, with the arguments its effort level implies, in one line and with no model call of its own.

| Command | Tool it starts | Takes |
|---|---|---|
| `/ah-research` | `deep_research` (start, then run) | a research question |
| `/ah-review` | `deep_review` | a manuscript path, `--` and what the reviewers should focus on |
| `/ah-papers` | `literature_search` | a search query |
| `/ah-references` | `citation` (audit) | a bibliography path, `--` and a manuscript path |
| `/ah-write` | `manuscript_diff` | the earlier manuscript, `--`, the revised one |
| `/ah-analyze` | `analysis_run` (plan) | an optional slug and `--`, then the question |
| `/ah-hypotheses` | `coscientist` (start) | an optional slug and `--`, then the research goal |

The effort comes first: `--effort low|medium|high` (also `--effort=`, `-e`, `effort=`). A bare first word is part of the prompt (`low rank adaptation` is a topic). ` -- ` is the line break of a two-line task: `/ah-review --effort high paper.tex -- focus on the statistics`. Paths are relative to the session folder and must stay inside it, also where a symbolic link leads: a link in the folder that points outside it is refused, and the file is copied into the folder to use it. The names carry `ah-` because `/analyze` already belongs to another plugin.

A long task goes on as a background job: the command waits about 30 seconds per step, then says the job id, and you are told when it ends (`job_notices`).

## `/model-router`

| Command | What it does |
|---|---|
| `/model-router on`, `off` | The [model router](model-router.md) for this session: planning on Opus, coding on Sonnet, academic writing on Haiku, anything else on Sonnet. The setting `model_router` changes the default (off) |
| `/model-router` or `status` | Whether it is on, the model for each kind of prompt, what reads the prompts (Jev or keyword rules), and what the last prompt got and why |
| `/model-router explain <prompt>` | What a prompt would get, without sending it to the model (with a TypeSafe key, the prompt goes to Jev; the answer says so) |

A prompt that starts with `[opus]`, `[sonnet]` or `[haiku]` uses that model whatever the router would choose.

## `/ah-watch`

Runs the saved literature searches that are due (`literature_watch`) and prints what is new since the last digest. `--all` runs every watch, `--preview` leaves the digest's "since" cut where it was. Watches are saved by asking for one (`literature_watch`, action `add`). To make it regular while a session is open: `/loop 1d /ah-watch`.

## `/fold [level]`

Folds your last reply for you to read: `full`, `brief` (the default), `points`, `outline`, `gist`, or 1 to 5. It only deletes sentences; it never rewrites.

## The pane

`/academic` opens it. Four parts: **Project** (the writing engine's state card: bibliography, outline, the gate and its first findings), **Jobs** (this session's running jobs, then the last three that ended), **Notebook** (the last five entries), **Library** (the PaperMemory counts). One column when the pane is narrow, two (the project on the left) from 96 columns. At 200 columns a docked pane is about 90 wide, so it is one column there; an inline pane in a terminal under 110 columns gets the whole width. While it is open a timer keeps it fresh: the files every 5 seconds, the engine side every 30. It has no buttons; `/academic` again refreshes it.

## The status line

One line under the prompt, `research mode on · 1 job running · gate FAIL (5 blocking)`: the mode, this session's running jobs, and in an `ah.yaml` project the engine's gate (read again after each turn). While the [model router](model-router.md) is on, the line ends with `router on`, and after a prompt with the model it chose, `router → opus`. Claude Code shows it as `⚠ academic-harness: ...`.

Next: [Tools, skills and agents](tools-skills-agents.md).
