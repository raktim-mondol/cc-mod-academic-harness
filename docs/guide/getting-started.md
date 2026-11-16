# Getting started

Linux only, as Academic Harness is. You need Node.js 22 or newer, `npm` and `tar`; `uv` is used when present (otherwise `python -m venv`); a working `claude` login for the tools that call a model.

There are three ways in. All of them end with the same plugin.

## From a clone (the usual way)

```
git clone https://github.com/raktim-mondol/cc-mod-academic-harness
cd cc-mod-academic-harness
node scripts/setup.mjs
claude --plugin-dir "$PWD"
```

`setup.mjs` does five things, each skipped when it is already done:

1. **The engine code.** The tools, skills and writing engine the plugin runs, at the exact version `UPSTREAM.lock.json` names, into `upstream/` (gitignored, about 56 MB). If a local checkout of Academic Harness at `~/academic-harness` (or `AH_SOURCE`) has that version, it is read from there and never written; otherwise it is downloaded from GitHub and checked against the digest in the lock, and a download that is not the locked bytes is refused. `--github` forces the download.
2. **Dependencies.** `npm ci` inside `upstream/` (about 115 MB).
3. **The writing engine.** A Python environment inside `upstream/vendor/academic-harness`, for the `ah_*` tools and the guard. `--no-engine` leaves it to the server, which builds it in the background on first start.
4. **The Python helpers**, only with `--helpers` (about 800 MB): the data, statistics and science toolkits fall back to `python3` without them.
5. **A check**: `plugin.json` against the snapshot, and the doctor's report.

`setup` is optional: a clone that was never set up fetches the snapshot itself on first start (see below).

To have the mod in every session, export `CLAUDE_CODE_PLUGIN_DIRS=/path/to/cc-mod-academic-harness` instead of passing `--plugin-dir`.

## From the marketplace

```
/plugin install academic-harness --marketplace raktim-mondol/cc-mod-academic-harness
```

The repository is public, so this works for anyone with Claude Code. The installed copy has no snapshot (it is not part of the repository), so the first session sets itself up; see "First start" below. The same marketplace file can be added from a folder: `claude plugin marketplace add <folder>`.

## First start without a snapshot

When the server starts and finds no engine code, it does not wait: it answers `initialize` at once with one tool, `doctor`, and fetches the snapshot in the background, into `~/.local/share/cc-mod-academic-harness/home/upstream/<commit>` (outside the plugin folder, which an update replaces). When the fetch and `npm ci` are done it sends `tools/list_changed` and the whole tool list appears, with no restart. `/academic doctor` says how far it has got:

```
! Source snapshot: being set up by the server (started 12 s ago): installing the tool dependencies (npm ci). The other tools appear when it is done
```

If it fails, the doctor shows the step and the error, and the next start tries again (`AH_BOOTSTRAP=0` turns the fetch off; the server then exits with the command to run). The PaperMemory server, which starts at the same moment and builds from the snapshot, joins the same fetch instead of failing.

## What else is installed, and when

| What | Where | When |
|---|---|---|
| PaperMemory's CLI | `~/.local/share/cc-mod-academic-harness/home/papermemory` | First session that starts its server (about a second with a warm `uv` cache) |
| TextFold (`paper_fold`) | the same home | First session that loads the notebook or submission tools. `AH_MANAGED_INSTALLS=0` turns it off |
| The writing engine | `upstream/vendor/academic-harness/.venv` | `setup`, or in the background on first start (`AH_AUTO_INSTALL=0` turns that off) |
| Python helpers | `upstream/python-helpers/.venv` | Only `setup --helpers` or `node scripts/install-helpers.mjs` |

## Keys

None is needed to start. To add one, run `claude plugin configure academic-harness@academic-harness-mod`: it lists every option, and saves keys in Claude Code's secure store. See [Keys and credentials](keys.md).

## Check it

`/academic doctor` inside a session, or `node server/bin/ah-doctor.mjs` outside one. It says what is ready and what is not, with the command that fixes each gap. See [Troubleshooting](troubleshooting.md).

Next: [Commands](commands.md).
