# Phase P1 results

Skills, research mode, PaperMemory and agents. Measured on Claude Code 2.1.325 against upstream `a3f17eb` (0.54.1) on 2026-11-16.

## What was built

| Piece | Where | Notes |
|---|---|---|
| Snapshot | `scripts/sync-upstream.mjs`, `UPSTREAM.lock.json`, `upstream/` (not committed) | `git archive` of 10 allow-listed paths. Same bytes on a second run (archive SHA-256 `3426673f...`). 791 skills, matching the plan's count |
| Core skill pack | `scripts/build-skills.mjs`, `skills/` | 86 of the 92 core skills. Excluded by D5: `deep-research`, `intro-drafter`, `paper-polish`, `paper-writer`, `rebuttal-guidance` (CC-BY-NC-SA-4.0) and `bioservices` (GPL label). No core skill is labelled "Unknown". 26 have no licence line and are kept as the source's own text |
| Always-on prompt | `scripts/build-prompt.mjs`, `scripts/host-notes.md`, `hooks/generated/prompt.ts` | 16,524 characters, about 4,100 tokens (budget 8,000). Host notes written for Claude Code, then 8 upstream sections verbatim, then an index of the guides |
| Guides | `skills/research-guides/` | 29 reference files, one per remaining upstream section, read on demand |
| Research mode | `hooks/mode.ts`, `hooks/register.tsx` | `/academic on\|off\|auto\|status`, `research_mode` setting, `prompt.compose` hook, status entry |
| PaperMemory | `server/src/papermemory.mjs`, `server/bin/papermemory-mcp.mjs`, manifest `mcpServers.papermemory` | Launcher with install, lock and fail-loud rules |
| Agents | `scripts/build-agents.mjs`, `agents/` | 22 specialists, read from the Specialists section so drift is caught. 16 read-only, 6 may edit |

## Verification

| Check | Result |
|---|---|
| `claude plugin validate .` | Passes (icon warning only) |
| `tsc -p . --noEmit` | Passes |
| `claude plugin test .` | 9 tests: auto/on/off, the setting, ancestor `ah.yaml`, placeholder substitution, a taken command name |
| `node --test tests/scripts tests/server` | 29 tests: licence decision, drift detection, agent permissions, launcher resolution, installs racing each other, live server |
| Live (nested `claude -p`, Haiku) | Research section absent without `ah.yaml`, present with it, present from the setting. `/academic status` names the detected project. Core skill loads by name. The guides skill reads a reference file. `peer-reviewer` reports no Edit, Write or NotebookEdit. PaperMemory answered `papermemory_recap` on a scratch store |
| First-run install in a real session | A fresh home installed PaperMemory during the same session start, and the server connected (14 tools). About 1 s with a warm `uv` cache. A cold cache that must download `pypdf` was not timed |
| Real PaperMemory store | Size and mtime unchanged across the live server test |
| Source and `~/.dsh` | `scripts/check-upstream-clean.mjs`: clean |

## Decisions taken in P1

1. **Skill exclusion rule.** D5 says non-commercial, GPL and Unknown. The build also excludes any other label that is not a clear permissive licence (a link, "proprietary", a bare "BSD"), and keeps a skill with no licence line. None of the core skills hit the extra rule today.
2. **Guides are one skill with reference files**, `academic-harness:research-guides`, not 29 skills. That keeps 29 descriptions out of the skill list.
3. **PaperMemory library tool stays hidden**, as upstream does (14 tools, not 15). In Claude Code the server's working directory is the session's (S3), so the reason upstream hides it does not hold; revisit when `reference_library` arrives in P2.
4. **The launcher never initialises or migrates an existing store.** Upstream's `ensurePaperMemoryDb` runs `init`, and a migration with a backup, on the shared store. This mod leaves that to the user, because the store is also the live library for DeepSeek Harness. A missing store is created by the server on first use.
5. **`AH_UPSTREAM` is a read-only development mode.** It disables every install.
6. **`/academic` is a bare command name** (S7). No collision exists today (checked in the init event's command list). Revisit if another plugin takes it.
7. **Dropped from the prompt:** "Local learning (RSI)" (D10) and "Files" (covered by the host notes).

## Costs the user will see

- Skill list: the 86 descriptions add up to about 30,100 characters (roughly 7,500 tokens) in every session, research mode or not. This is the cost of D4 (list the core pack). Options if it is too much: list a smaller pack, or shorten descriptions in the build.
- Research mode: about 4,100 tokens added to the system prompt while it is on.
- `prompt.compose` runs a few `fs.exists` calls per request to find `ah.yaml`. Not measured.

## Open items

- A fresh clone has no `upstream/`. The PaperMemory install and the on-demand skill fallback need it until P6 bundles the vendored package (620 KB of code) and the skills.
- Until P2 there is no `skill_search`. The host notes tell the model to search `upstream/skills/` with Grep instead.
- Interactive checks of `/academic` in the terminal were not repeated for P1; the `-p` runs exercise the same hooks. The status entry from P0 was seen interactively.
- Closed by the audit (`docs/history/audit-p0-p4.md`, item 9): the no-`uv` install is a test now and passes; the P1 live checks are `tests/live/p1.mjs`. Earlier text: not tested: PaperMemory install with no `uv` (the `python -m venv` fallback), and a store that needs migration.
