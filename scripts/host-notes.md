# Academic Harness research mode

Research mode is on. The guidance below is Academic Harness's own, written for another host (DeepSeek Harness). These notes say how it maps onto Claude Code. Where the notes and the guidance differ, follow the notes.

## Tool names

The guidance uses Academic Harness's bare tool names. In this session:

- `ask_user_question` is `AskUserQuestion`. `skill` is `Skill`. `subagent` and `subagent_fork` are `Agent`. `read_image` is `Read` on the image file. `bash`, `fs` and file tools are `Bash`, `Read`, `Write`, `Edit`. `todo` is the task list tool you have. `subagent_pro` has no equivalent: for hard reasoning use `Agent` with a stronger `model`.
- Academic Harness's own tools (`notebook`, `scientific_result`, `literature_search`, `paper_*`, `reference_library`, `research_template`, and the rest) are served by this plugin's `ah` MCP server and are named `mcp__plugin_academic-harness_ah__<name>`. PaperMemory's tools are `mcp__plugin_academic-harness_papermemory__<name>`; the guidance calls them `mcp__papermemory__<name>`. MCP tools are deferred: find one with `ToolSearch` before its first use.
- **This build serves nearly every Academic Harness tool**: search, papers, notebook, skills, the writing engine (`ah_*`), reviews and meta-analysis, hypothesis tournaments, analysis, provenance, study design and grants, datasets and science toolkits, submission tools, figures, deep research and deep review, and paid compute. Not served: `zvec_index`, `paper_mcp`, `paper_backfill` and `ah_rsi`. If the guidance names a tool that `ToolSearch` cannot find, say so and do the step by hand.
- **Long tools run as background jobs.** `deep_research`, `deep_review` and `analysis_run` answer after about 30 seconds with a job id when the work is not done, and go on in the background. In an interactive session you are told when the job ends: read the result with `job_status`, then carry on. In a non-interactive run, call `job_wait` (at most 120 seconds a call) until the job ends, because it stops when the session does. `job_log` shows its steps and `job_kill` stops it. Tools that call a model use headless Claude Code calls under the user's login, capped by the `llm_budget_usd` setting.
- **Paid compute (`modal_run`, `runpod_run`, `vastai_run`) always asks the person first**, with the provider, instance, time limit and cost ceiling. A refusal is final; do not retry it from a non-interactive run.
- **In a project with an `ah.yaml`, there is no `ah` command in your shell.** Wherever the guidance shows `ah ...`, use the `ah_*` tool of the same name (`ah finding decide` is `ah_decision_request`, `ah facts list` is `ah_fact` with `action=list`). A guard checks every Write, Edit and Bash call there: a denial is final, so read its reason, do not look for another way, and hand the question to the author with `ah_decision_request`. The author-only acts (`ah_author`) run only when the human asked for them in their message, and Claude Code asks them to confirm.
- `mcp__firecrawl__*`, `mcp__scite__*` and `mcp__zvec_grep__*` are not served by this plugin. Use whatever Firecrawl, Scite or search connectors this session already has, under their own names.
- **If a tool the guidance names is not in your tool list, say so.** Do not describe an action as done that you could not do. For example, with no `notebook` tool, write the entry to a Markdown file in the project and tell the user that is what you did.

## Skills and specialists

- Core skills are in the skill list as `academic-harness:<name>`. When the guidance says "load `x`", call `Skill` with `academic-harness:x`.
- About 700 more skills are bundled and not listed. Find one with `skill_search` (the `ah` server), then read it with `skill_load` using the exact name. Skills listed as `academic-harness:<name>` load with `Skill` as usual. If `skill_search` is not in your tool list, search the `description:` lines under `{{PLUGIN_ROOT}}/upstream/skills/` with `Grep` and `Read` the `SKILL.md`.
- A few skills with non-commercial or GPL licences are not shipped in this build (for example `deep-research`, `paper-writer`, `paper-polish`, `intro-drafter`, `rebuttal-guidance`, `bioservices`). If the guidance names a skill you cannot find, say so and carry on without it.
- Specialist briefs are agent types: `academic-harness:peer-reviewer`, `academic-harness:citation-checker`, and so on. Name the specialist as the `subagent_type` of `Agent`.

## Where things live

- The project's notebook and research ledgers are under `<project>/.dsh/`, shared with DeepSeek Harness. Writing-engine state is under `<project>/.ah/`. The PaperMemory library is `~/.local/share/papermemory/papermemory.db`.
- Write outputs (plots, tables, reports, `.tex`) into the project directory.
- Longer guidance by area is in the skill `academic-harness:research-guides`. Load it when a task falls in one of the areas listed at the end of this section, then read the one file it points to. Do not load all of them.
