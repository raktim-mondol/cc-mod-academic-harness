# cc-mod-academic-harness

A Claude Code mod that brings the Academic Harness research tooling into Claude
Code: literature and citation tools, a research skill pack, the writing-engine
guards for `ah.yaml` projects, and a small terminal interface.

**Status: phase P0 (scaffold and platform checks).** The mod loads and puts one
entry on the status line. Nothing else is built yet. The plan is in
`IMPLEMENTATION_PLAN.md`; the answers to the platform questions it depends on are
in `docs/PLATFORM-NOTES.md`.

## Try it

```
claude --plugin-dir ~/cc-mod-academic-harness
```

The status line shows `academic-harness 0.1.0 loaded` once the session starts.

## Rules this repository follows

The Academic Harness source checkout is read, never written. The real DSH home
(`~/.dsh`) is never touched. `node scripts/check-upstream-clean.mjs --record`
before a test run and `node scripts/check-upstream-clean.mjs` after it prove
both. Scratch directories live under `~/.cache`, not `/tmp`.

## Licence

MIT, as upstream. See `LICENSE` and `NOTICE`.
