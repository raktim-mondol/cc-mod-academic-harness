# Decisions

The numbered decisions of the plan, and what became of each; the later ones the work added. The reasoning is in the page each row points to.

| # | Decision | Outcome |
|---|---|---|
| D1 | Where the mod lives | `~/cc-mod-academic-harness`, its own git repository, private on GitHub, loaded with `--plugin-dir` |
| D2 | Name | `academic-harness` |
| D3 | How the mod gets the source | A snapshot at a pinned commit, from `git archive` or, with no checkout, from GitHub, verified by a digest in the lock ([Building](../maintain/building.md)) |
| D4 | Which skills are listed | The core skills minus excluded licences, minus what the fit review left out or put on demand: 54, plus the guides skill |
| D5 | Which licences are excluded | Non-commercial, GPL and unknown. A local build flag keeps them for personal use; never commit that build |
| D6 | How much prompt is always on | A short section written for Claude Code (about 2,900 tokens), with the per-area guidance as on-demand guides ([fit review](fit-review.md)) |
| D7 | The model route for tools that call a model | A headless `claude -p --safe-mode --tools ""` child, a budget cap, no key (2 s a call) |
| D8 | `defineTool` | The host passes upstream's own definitions through its context shim |
| D9 | One server or several | One server `ah`, with `tool_areas` to trim it; PaperMemory is its own server |
| D10 | Local self-improvement (RSI) | Dropped: it injects lessons nobody approved; memory and `papermemory_lesson` cover it |
| | Commands named | Prefixed `ah-` (`/analyze` belongs to another plugin) |
| | Task effort | A leading `--effort`, because a trailing word cannot be told from the topic |
| | Long tools | Detach after 30 seconds and run as jobs, because a session that cannot talk for 20 minutes is worse than one that is told when the job ends |
| | Paid compute | Always asks, in every folder, with the cost ceiling |
| | The guard fails closed | If the engine cannot answer, writes and shell calls are refused and reads go through |
| | What to leave out of Academic Harness | Whatever Claude Code or a connector already does, or that exists only for DSH's own UI: 15 tools, 15 skills, 1 agent ([fit review](fit-review.md)) |
| | An `ah_rsi`, zvec, `pro` and vision agents, an esbuild bundle | Not built, with reasons in [P6](../history/p6-results.md) |
| | Three `coscientist` tools stay three | They split upstream's actions by half; one tool would mean editing upstream's code, and the descriptions already say which half is which |
| | The snapshot is fetched, not committed | It would put every upstream skill, with its licence, into this repository; the lock and a digest make a fetch exact |
