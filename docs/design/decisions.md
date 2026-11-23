# Decisions

The decisions made while building the plugin, and what each came to. The reasoning is in the page each row points to.

| # | Decision | Outcome |
|---|---|---|
| D1 | Where the plugin lives | `~/cc-mod-academic-harness`, its own git repository, private on GitHub, loaded with `--plugin-dir` or installed from its own marketplace file |
| D2 | Name | `academic-harness` |
| D3 | Where the engine code comes from | Committed in this repository as `core/` (decided 2026-11-17, superseding the pinned snapshot: nothing is fetched and nothing follows Academic Harness). Installed dependencies and the engine's environment are built from it, in place in a clone or in a working copy in the mod's home ([Building](../maintain/building.md)) |
| D4 | Which skills are listed | The core skills minus excluded licences, minus what is left out or put on demand: 59, plus the guides skill |
| D5 | Which licences are excluded | Non-commercial, GPL and unknown. A local build flag keeps them for personal use; never commit that build |
| D6 | How much prompt is always on | A short section written for Claude Code (about 3,500 tokens, at most 14,000 characters), with the per-area guidance, and the routing of the search providers, as on-demand guides |
| D7 | The model route for tools that call a model | A headless `claude -p --safe-mode --tools ""` child, a budget cap, no key (2 s a call) |
| D8 | Tool definitions | The server passes the research modules' own definitions through its context shim |
| D9 | One server or several | One server `ah`, with `tool_areas` to trim it; PaperMemory is its own server |
| D10 | Self-improvement loop | Left out at first because it injects lessons nobody approved; **served again at the person's request** (decided 2026-11-23) and **off by default** (decided 2026-11-24): `ah_rsi` and its loop, driven by the guard bridge and two hooks (`PostToolBatch`, `PostToolUseFailure`), only in `ah.yaml` folders, only with a person at the prompt (a headless run is never recorded, so scripted runs stay reproducible), with the `rsi_mode` setting (`off`, `observe`, `auto`; `AH_RSI` wins; a value that is not a mode is off), a store that stays bounded, and the mode shown by the doctor |
| | The model router | Decide once per prompt at `turn.start`, put the model on every `turn.step` of the turn (a turn never changes model half way, and a cache is per model). Jev gives probabilities in one request (a Choice over four routes and a Noul for "only a go-ahead"); code owns the model names and thresholds. Planning wins at 40%; the smallest model only for clear academic writing with no code; anything unsure goes to the middle model; what the rules cannot read goes there too. Off by default, because it changes what a prompt costs. The wait for Jev is `$.clock.sleep`, the hook's own time, which the docs say a hook may wait on; `$.clock.after` calls back as a dispatch of its own. A live run against a stand-in that never answers measured the prompt held 2.5 s and the model chosen by the rules at once; the abandoned request cannot be cancelled (`$.http.fetch` takes no signal), so a headless `claude -p` ends about 27 s later than the answer. A child process with a real timeout would end it, at the price of a process per prompt: not done |
| | Commands named | Prefixed `ah-` (`/analyze` belongs to another plugin) |
| | Task effort | A leading `--effort`, because a trailing word cannot be told from the topic |
| | Long tools | Detach after 30 seconds and run as jobs, because a session that cannot talk for 20 minutes is worse than one that is told when the job ends |
| | Paid compute | Always asks, in every folder, with the cost ceiling |
| | The guard fails closed | If the writing engine cannot answer, writes and shell calls are refused and reads go through |
| | What to leave out | Whatever Claude Code or a connector already does, or that only makes sense in a chat box of another kind: 12 tools, 10 skills, 1 agent ([what is left out and why](fit-review.md)) |
| | A workspace-indexing daemon, `pro` and vision agents, an esbuild bundle | Not built, with reasons in [P6](../history/p6-results.md). (`zvec_index` is served since 2026-11-23, but it drives the `zg` you already have; there is still no daemon of the plugin's own) |
| | Search providers | Each of the eight is served once its key is set, with one job each (the guide `search-providers`); `web_search` and `web_extract` choose among those that are on and fall back, so a missing key is never a dead end (decided 2026-11-23) |
| | `paper_mcp` | Registers the server in the project's `.mcp.json` instead of mounting it, because Claude Code cannot start a server mid-session; asks first with a `tool.check` (refused where nobody can answer), and Claude Code asks again before it starts the server (decided 2026-11-23) |
| | Three `coscientist` tools stay three | They split the action set by half; one tool would mean editing the module, and the descriptions already say which half is which |
| | The engine code is fetched, not committed | It would put every bundled skill, with its licence, into this repository; the lock and a digest make a fetch exact |
