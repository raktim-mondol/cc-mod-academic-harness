# cc-mod-academic-harness

A Claude Code mod that brings the Academic Harness research tooling into Claude
Code: literature and citation tools, a research skill pack, the writing-engine
guards for `ah.yaml` projects, and a small terminal interface.

**Status: phase P1 done** (skills, research mode, PaperMemory, agents). The
literature tools (P2) and the writing-engine guard (P3) are not built yet. The plan is in
`IMPLEMENTATION_PLAN.md`; platform answers are in `docs/PLATFORM-NOTES.md`; what P1
built and measured is in `docs/P1-RESULTS.md`.

## What works now

- **Research mode.** `/academic on | off | auto | status`. `auto` (the default) is on in a
  folder that has, or sits under, an `ah.yaml`. While on, a research section (about 4,000
  tokens) is added to the system prompt. The `research_mode` setting changes the default.
- **86 core skills**, listed as `academic-harness:<name>`, plus `academic-harness:research-guides`,
  which holds the longer per-area guidance (29 files) and is read on demand.
- **22 specialist agents** such as `academic-harness:peer-reviewer`. Reviewers cannot edit files.
- **PaperMemory**: its 14 tools, as `mcp__plugin_academic-harness_papermemory__*`. The first
  session installs the CLI into `~/.local/share/cc-mod-academic-harness/home/` (about a second
  with a warm `uv` cache). The library is `~/.local/share/papermemory/papermemory.db`, shared with
  DeepSeek Harness. The mod creates a missing store and never migrates an existing one.

## Set up from a clone

The generated parts (`upstream/`) come from a local checkout of the Academic Harness source,
read with `git archive` at a pinned commit and never written:

```
node scripts/sync-upstream.mjs        # needs ~/academic-harness (or AH_SOURCE=<path>)
node scripts/build-all.mjs            # skills/, hooks/generated/, agents/
claude --plugin-dir ~/cc-mod-academic-harness
```

`skills/`, `agents/` and `hooks/generated/` are committed, so the skills and agents load without
the sync. `upstream/` is not committed; the PaperMemory install and the on-demand skills need it
until the packaging phase (P6).

Skills with non-commercial, GPL or unknown licences are left out (decision D5). A local build can
keep them with `node scripts/build-all.mjs --include-restricted`; do not commit or share that build.

## Tests

```
claude plugin validate .
npx --yes -p typescript@5.6.3 tsc -p . --noEmit
claude plugin test .                                   # hooks: research mode
node --test "tests/scripts/*.test.mjs" "tests/server/*.test.mjs"   # builds, PaperMemory launcher
```

The script tests need `upstream/`. The launcher tests install into a scratch folder under
`~/.cache` and check that the real PaperMemory store is unchanged.

## Rules this repository follows

The Academic Harness source checkout is read, never written. The real DSH home
(`~/.dsh`) is never touched. `node scripts/check-upstream-clean.mjs --record`
before a test run and `node scripts/check-upstream-clean.mjs` after it prove
both. Scratch directories live under `~/.cache`, not `/tmp`.

## Licence

MIT, as upstream. See `LICENSE` and `NOTICE`.
