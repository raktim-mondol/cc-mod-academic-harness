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

`setup.mjs` does four things, each skipped when it is already done. Nothing is downloaded from GitHub: the source the plugin runs is in the clone (`core/`, about 44 MB).

1. **Dependencies.** `npm ci` inside `core/` (about 115 MB).
2. **The writing engine.** A Python environment inside `core/vendor/academic-harness`, for the `ah_*` tools and the guard. `--no-engine` leaves it to the server, which builds it in the background on first start.
3. **The Python helpers**, only with `--helpers` (about 800 MB): the data, statistics and science toolkits fall back to `python3` without them.
4. **A check**: `plugin.json` against the core, and the doctor's report.

`setup` is optional: a clone that was never set up copies its core and installs the dependencies itself on first start (see below).

To have the mod in every session, export `CLAUDE_CODE_PLUGIN_DIRS=/path/to/cc-mod-academic-harness` instead of passing `--plugin-dir`.

## From the marketplace

```
/plugin install academic-harness --marketplace raktim-mondol/cc-mod-academic-harness
```

The repository is public, so this works for anyone with Claude Code. The installed copy holds the whole source, but nothing is installed from it yet, so the first session sets itself up; see "First start" below. The same marketplace file can be added from a folder: `claude plugin marketplace add <folder>`.

## First start

When the server starts and finds the core's dependencies not installed, it does not wait: it answers `initialize` at once with one tool, `doctor`, and sets itself up in the background. It copies the plugin's `core/` to `~/.local/share/cc-mod-academic-harness/home/core/<version>-<fingerprint>` (outside the plugin folder, which an update replaces, so a plugin update that does not change the core keeps its installed dependencies) and runs `npm ci` there. When that is done it sends `tools/list_changed` and the whole tool list appears, with no restart. `/academic doctor` says how far it has got:

```
· Core: being set up by the server (started 12 s ago): installing the tool dependencies (npm ci). The other tools appear when it is done
```

If it fails, the doctor shows the step and the error, and the next start tries again (`AH_BOOTSTRAP=0` turns the setup off; the server then exits with the command to run). The PaperMemory server, which starts at the same moment and builds from the core, joins the same setup instead of failing. A clone that was set up with `setup.mjs` runs its own `core/` in place and copies nothing.

## What else is installed, and when

| What | Where | When |
|---|---|---|
| PaperMemory's CLI | `~/.local/share/cc-mod-academic-harness/home/papermemory` | First session that starts its server (about a second with a warm `uv` cache) |
| TextFold (`paper_fold`) | the same home | First session that loads the notebook or submission tools. `AH_MANAGED_INSTALLS=0` turns it off |
| The writing engine | `core/vendor/academic-harness/.venv` (in a working copy, the same path inside it) | `setup`, or in the background on first start (`AH_AUTO_INSTALL=0` turns that off) |
| Python helpers | `core/python-helpers/.venv` | Only `setup --helpers` or `node scripts/install-helpers.mjs` |

## Keys

None is needed to start. To add one, run `claude plugin configure academic-harness@academic-harness-mod`: it lists every option, and saves keys in Claude Code's secure store. See [Keys and credentials](keys.md).

## Check it

`/academic doctor` inside a session, or `node server/bin/ah-doctor.mjs` outside one. It says what is ready and what is not, with the command that fixes each gap. See [Troubleshooting](troubleshooting.md).

Next: [Commands](commands.md).
