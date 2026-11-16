# cc-mod-academic-harness

A Claude Code plugin for academic research and writing. It adds literature search across the scholarly APIs, citation and integrity checks, deep research and deep review that run as background jobs, a PaperMemory library, 54 research skills and 21 specialist agents, hypothesis tournaments, study-design and reproducibility ledgers, and a guard for writing papers in LaTeX projects (`ah.yaml`).

It is a Claude Code *mod*: next to its MCP tools, skills and agents it runs code inside Claude Code, which is what gives it slash commands, a status line, a pane and the guard ([what that means](docs/maintain/next-steps.md#plugin-or-mod-both-and-it-works)).

**Version 0.4.0.** Linux only. Private repository.

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
| **Commands** | `/ah-research`, `/ah-review`, `/ah-papers`, `/ah-references`, `/ah-write`, `/ah-analyze`, `/ah-hypotheses`, `/ah-watch`, `/fold`, `/academic` |
| **Interface** | A status line (`research mode on · 1 job running · gate FAIL (5 blocking)`) and a pane (project state, jobs, notebook, library) |
| **Guard** | In a folder with an `ah.yaml`: protected files, unit anchors and author-only acts enforced on every write and shell call |
| **Safety** | Paid compute always asks. Keys are never printed. Tools stay inside the project folder |

## Documentation

Every folder has its own index; start from [the documentation index](docs/README.md).

| For | Start at |
|---|---|
| **Using it** | [User guide](docs/guide/README.md): [getting started](docs/guide/getting-started.md), [commands](docs/guide/commands.md), [tools, skills and agents](docs/guide/tools-skills-agents.md), [settings](docs/guide/settings.md), [state and privacy](docs/guide/state-and-privacy.md), [troubleshooting](docs/guide/troubleshooting.md) |
| **Understanding it** | [Design](docs/design/README.md): [architecture](docs/design/architecture.md), [decisions](docs/design/decisions.md), [what was left out and why](docs/design/fit-review.md) |
| **Changing it** | [Maintenance](docs/maintain/README.md): [building](docs/maintain/building.md), [updating the engine code](docs/maintain/updating-upstream.md), [testing](docs/maintain/testing.md), [releasing](docs/maintain/releasing.md), [what to do next](docs/maintain/next-steps.md) |
| **How it was built** | [History](docs/history/README.md), and the [changelog](CHANGELOG.md) |

## Development

`npm run check` runs the same checks CI runs: the node suites, `plugin.json` against the snapshot, and the served tool surface. `npm run typecheck` adds the hooks module's types after a session has loaded the mod, and `npm run build` regenerates the skills, prompt, agents and interface from `upstream/`.

The ground rules, the test map and the release checklist are in [Maintaining the mod](docs/maintain/README.md); [CONTRIBUTING.md](CONTRIBUTING.md) is the short version.

## The repository

| Folder | What is in it | Notes |
|---|---|---|
| [`hooks/`](hooks/README.md) | The code that runs inside Claude Code: research mode, the guard, approvals, commands, the pane | TypeScript |
| [`server/`](server/README.md) | The tool server, the PaperMemory launcher and the helper processes the hooks run | Node |
| [`scripts/`](scripts/README.md) | Setup, updates, builds, checks | Node |
| `skills/`, `agents/` | The skills and agents Claude Code loads | Generated; do not edit ([Building](docs/maintain/building.md)) |
| [`tests/`](tests/README.md) | Plugin tests, node suites, live scripts | |
| [`types/`](types/README.md) | The `$.state` contract of the hooks module | |
| `upstream/` | The research engine and tool code the plugin runs | Not committed; `setup` fetches it |
| `.claude-plugin/` | The manifest and the marketplace file | `plugin.json` is partly generated |
| `UPSTREAM.lock.json` | The exact version of that code this release uses, with a digest of its files | |

## Security

Keys reach the tools as environment variables and are reported by name, never by value. In an `ah.yaml` project the guard fails closed, and paid compute always asks. What is read, written and spent is in [state and privacy](docs/guide/state-and-privacy.md). Report a vulnerability privately through [SECURITY.md](SECURITY.md), never in an issue.

## Licence

MIT (`LICENSE`) for the code written for this mod. A few skills copied into `skills/` come from other projects and keep their own licences: three are CC BY 4.0 and one reference file is CC BY-SA 4.0; each is credited, with its changes, in `NOTICE`, which also lists the MIT sources and what the plugin downloads on first start. Skills under non-commercial, GPL or unknown licences are not in this repository. The Academic Harness snapshot the plugin fetches carries its own `NOTICE`, and a skill the model loads on demand from it can be under a non-commercial licence: its `license:` line says. Contributions are under the same licence; see [CONTRIBUTING.md](CONTRIBUTING.md).
