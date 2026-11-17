# cc-mod-academic-harness

A Claude Code plugin for academic research and writing. It adds literature search across the scholarly APIs, citation and integrity checks, deep research and deep review that run as background jobs, a PaperMemory library, 54 research skills and 21 specialist agents, hypothesis tournaments, study-design and reproducibility ledgers, and a guard for writing papers in LaTeX projects (`ah.yaml`).

It is a Claude Code *mod*: next to its MCP tools, skills and agents it runs code inside Claude Code, which is what gives it slash commands, a status line, a pane and the guard ([what that means](docs/maintain/next-steps.md#plugin-or-mod-both-and-it-works)).

**Version 0.6.0.** Linux only. MIT licence.

## How it fits together

![How the plugin is built: the hooks module, the ah and papermemory MCP servers, the bundled core (the tools, skills and writing engine)](docs/assets/architecture.svg)

Blue is code that runs inside Claude Code's hooks, green the MCP servers and background jobs, purple the writing engine, orange stored data, yellow skills and agents, and grey what is outside the plugin. The diagram is `docs/assets/architecture.mmd`, rendered with [Pele](https://github.com/obsidianmd/pele) (`node scripts/render.mjs --static-colors architecture.mmd architecture.svg` in the pele skill). [Architecture](docs/design/architecture.md) explains each part.

## Requirements

| | |
|---|---|
| **OS** | Linux. The writing engine is Linux-only |
| **Node.js** | 22 or newer, with `npm` and `tar` |
| **Claude Code** | 2.1.325 or newer, the oldest version the mod was seen working on; `/academic doctor` reports the running version and whether the hooks module loaded |
| **Python** | 3.11 or newer for the writing engine. `uv` is used when present, otherwise `python -m venv` and pip |
| **Login** | a working `claude` login for the tools that call a model. They need no API key |

## Quick start

```
git clone https://github.com/raktim-mondol/cc-mod-academic-harness
cd cc-mod-academic-harness
node scripts/setup.mjs
claude --plugin-dir "$PWD"
```

or, installed from the marketplace (the first session sets itself up):

```
/plugin install academic-harness --marketplace raktim-mondol/cc-mod-academic-harness
```

Then, in a session: `/academic doctor` says what is ready. [Getting started](docs/guide/getting-started.md) has the details.

## In a session

In a folder with an `ah.yaml`, the status line keeps one line:

```
research mode on · 1 job running · gate FAIL (5 blocking)
```

`/academic` opens a pane with the paper state, this session's jobs, the notebook and the PaperMemory counts. `/ah-research`, `/ah-review` and the other task commands start long runs as background jobs and tell you when they end; `/academic usage` shows which tools and skills are actually used.

## What you get

| | |
|---|---|
| **Research mode** | A research section in the system prompt, on automatically in a folder with an `ah.yaml` (`/academic on\|off\|auto`) |
| **Tools** | 126 tools in 16 areas: search, papers, notebook, the writing engine, reviews, tournaments, analysis, provenance, study design, datasets, submission, deep research and review, paid compute |
| **Skills and agents** | 54 core skills, about 700 more on demand, 21 specialists such as `academic-harness:peer-reviewer` |
| **Commands** | `/ah-research`, `/ah-review`, `/ah-papers`, `/ah-references`, `/ah-write`, `/ah-analyze`, `/ah-hypotheses`, `/ah-watch`, `/fold`, `/academic`, `/model-router` |
| **Model router** | Off until you turn it on (`/model-router on`): planning goes to Opus, coding to Sonnet, academic writing to Haiku, everything else to Sonnet, decided by Jev (TypeSafe) or keyword rules ([the model router](docs/guide/model-router.md)) |
| **Interface** | A status line (`research mode on · 1 job running · gate FAIL (5 blocking)`) and a pane (project state, jobs, notebook, library) |
| **Guard** | In a folder with an `ah.yaml`: protected files, unit anchors and author-only acts enforced on every write and shell call |
| **Safety** | Paid compute always asks. Keys are never printed. Tools stay inside the project folder |

## Documentation

Every folder has its own index; start from [the documentation index](docs/README.md).

| For | Start at |
|---|---|
| **Using it** | [User guide](docs/guide/README.md): [getting started](docs/guide/getting-started.md), [commands](docs/guide/commands.md), [tools, skills and agents](docs/guide/tools-skills-agents.md), [settings](docs/guide/settings.md), [keys and credentials](docs/guide/keys.md), [state and privacy](docs/guide/state-and-privacy.md), [troubleshooting](docs/guide/troubleshooting.md) |
| **Understanding it** | [Design](docs/design/README.md): [architecture](docs/design/architecture.md), [decisions](docs/design/decisions.md), [what was left out and why](docs/design/fit-review.md) |
| **Changing it** | [Maintenance](docs/maintain/README.md): [building](docs/maintain/building.md), [testing](docs/maintain/testing.md), [releasing](docs/maintain/releasing.md), [what to do next](docs/maintain/next-steps.md) |
| **How it was built** | [History](docs/history/README.md), and the [changelog](CHANGELOG.md) |

## Development

`npm run check` runs the same checks CI runs: the node suites, `plugin.json` against the core, and the served tool surface. `npm run typecheck` adds the hooks module's types after a session has loaded the mod, and `npm run build` regenerates the skills, prompt, agents and interface from `core/`.

The ground rules, the test map and the release checklist are in [Maintaining the mod](docs/maintain/README.md); [CONTRIBUTING.md](CONTRIBUTING.md) is the short version.

## The repository

| Folder | What is in it | Notes |
|---|---|---|
| [`hooks/`](hooks/README.md) | The code that runs inside Claude Code: research mode, the guard, approvals, commands, the pane | TypeScript |
| [`server/`](server/README.md) | The tool server, the PaperMemory launcher and the helper processes the hooks run | Node |
| [`scripts/`](scripts/README.md) | Setup, builds, checks | Node |
| `skills/`, `agents/` | The skills and agents Claude Code loads | Generated; do not edit ([Building](docs/maintain/building.md)) |
| [`tests/`](tests/README.md) | Plugin tests, node suites, live scripts | |
| [`types/`](types/README.md) | The `$.state` contract of the hooks module | |
| `core/` | The research engine, tool code, writing engine and about 790 skills the plugin runs, with the licences they carry ([`core/NOTICE`](core/NOTICE)) | Committed, so the repository stands alone; `setup` installs what is built from it |
| `.claude-plugin/` | The manifest and the marketplace file | `plugin.json` is partly generated |

## Security

Keys reach the tools as environment variables and are reported by name, never by value. In an `ah.yaml` project the guard fails closed, and paid compute always asks. What is read, written and spent is in [state and privacy](docs/guide/state-and-privacy.md). Report a vulnerability privately through [SECURITY.md](SECURITY.md), never in an issue.

## Licence

MIT (`LICENSE`) for the code written for this mod and for Academic Harness's own code in `core/`. **`core/` also bundles other projects' material under their own licences, and the MIT licence does not relicense it:** 791 skills, of which 6 are CC BY-NC-SA 4.0 (non-commercial), 5 name a GPL licence and 12 say "Unknown", plus vendored projects such as Supervisor-Skills (CC BY-NC-SA 4.0 as a whole). `NOTICE` lists them and says what each needs; a skill's `license:` line names its licence. If you use this repository commercially, read `NOTICE` first, and set `AH_EXCLUDE_NONCOMMERCIAL=1` to keep the six non-commercial skills out of what the plugin serves. The 54 core skills in `skills/` are the ones the build lets in: only MIT, CC BY 4.0 and the source's own text; each outside MIT is credited, with its changes, in `NOTICE`. Contributions are under the same licence; see [CONTRIBUTING.md](CONTRIBUTING.md).
