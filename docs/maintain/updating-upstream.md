# Updating to a newer Academic Harness

Academic Harness is released often; the mod holds one commit of it (`UPSTREAM.lock.json`). `node scripts/update-upstream.mjs` says what a newer commit changes for the mod and takes it when you say so.

## Being told

`.github/workflows/upstream-watch.yml` runs every Monday (and by hand: Actions, "Upstream watch", "Run workflow"). It asks GitHub for Academic Harness's newest commit and compares it with `UPSTREAM.lock.json`. When the plugin is behind, it takes the snapshot, runs the report below and opens one issue, labelled `upstream-update`, that holds the report and the two commands to read it again and to take it. Nothing is applied.

- An issue that already names the newest commit is left alone, so there is no mail every week. If Academic Harness moves again, the open issue is updated; when the plugin holds the newest commit again, it is closed.
- By hand, two inputs: a full commit sha to compare against instead of the newest, and a dry run that prints the issue in the log and opens nothing.
- The workflow can write issues and nothing else. `node scripts/upstream-watch.mjs --dry-run` does the same from a clone, calling nothing on GitHub.

## The report

```
node scripts/update-upstream.mjs                  # against the newest commit (the checkout's HEAD, else GitHub's)
node scripts/update-upstream.mjs --commit <sha>   # against that commit (a full sha when there is no checkout)
```

It takes the candidate into a scratch folder beside the real snapshot (which it does not touch), loads the candidate's tools with the current dependencies, and compares the two:

| Line | Meaning |
|---|---|
| tools added, removed, changed | Names in the tool registry; "changed" is the description or parameters |
| prompt sections added, removed, changed | `prompt.js`'s `##` sections, which `build-prompt.mjs` sorts into the research-mode text, the guides and what is dropped |
| `research-mode.md` was written from | Whether any section that text was written from has changed since it was reviewed |
| core skills, key fields | Added or removed |
| npm dependencies | `package-lock.json` changed: `--apply` runs `npm ci` |
| modules nobody has classified | A module that is not loaded, not host-only and not left out; each is a decision |

## What needs a decision

- **A new tool.** Ask of it what the fit review asked of every tool: does Claude Code already do this? If not, add its module to `TIER1` in `server/src/manifest.mjs`. If yes, add it to `DROPPED_TOOLS` in `server/src/fit.mjs` with the reason.
- **A new core skill.** It is built into the catalogue unless `DROPPED_SKILLS` or `ON_DEMAND_SKILLS` names it. Descriptions cost context on every turn: put niche ones on demand.
- **A changed prompt section the research-mode text was written from.** Read it, update `scripts/research-mode.md`, then `node scripts/build-prompt.mjs --accept-upstream`.
- **A new prompt section.** The build adds it to the guides and says so; check it for DeepSeek Harness advice that is wrong here and add an `adapt.mjs` rule.

`--apply` stops when any of these is open (`--force` goes on anyway and lets the parity check speak).

## Applying

```
node scripts/update-upstream.mjs --commit <sha> --apply
```

It syncs (the checkout when it has the commit, else GitHub, verified against the digest it then records), installs the dependencies and the engine, runs the builds and `build-manifest`, runs the surface parity check and the node tests, and tells you what is left: review `git diff`, run `claude plugin test .` and the [live checks](testing.md), commit. It has been run end to end from a clone with no checkout, from 0.54.1 down to 0.54.0 and up again.

## Without the script

`node scripts/sync-upstream.mjs --commit <sha>`, then `node scripts/install-deps.mjs`, `node scripts/build-all.mjs`, `node scripts/build-manifest.mjs`, `node scripts/measure-surface.mjs`, and the tests. The script is these steps in order with the report in front.
