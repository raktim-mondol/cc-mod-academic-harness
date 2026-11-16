# cc-mod-academic-harness

A Claude Code mod that brings the [Academic Harness](https://github.com/raktim-mondol/academic-harness) research tooling into Claude Code: literature search across the scholarly APIs, citation and integrity checks, deep research and deep review as background jobs, a PaperMemory library, 54 research skills and 21 specialist agents, hypothesis tournaments, study design and reproducibility ledgers, and a guard for writing papers in LaTeX projects (`ah.yaml`). It is a port, not a fork: Academic Harness is read at a pinned commit and never modified, and what Claude Code already does is left out.

**Version 0.4.0.** Linux only. Private repository.

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

## What you get

| | |
|---|---|
| **Research mode** | A research section in the system prompt, on automatically in a folder with an `ah.yaml` (`/academic on\|off\|auto`) |
| **Tools** | 121 of Academic Harness's 136 plus `job_*` and `doctor`: search, papers, notebook, the writing engine, reviews, tournaments, analysis, provenance, study design, datasets, submission, deep research and review, paid compute |
| **Skills and agents** | 54 core skills, about 700 more on demand, 21 specialists such as `academic-harness:peer-reviewer` |
| **Commands** | `/ah-research`, `/ah-review`, `/ah-papers`, `/ah-references`, `/ah-write`, `/ah-analyze`, `/ah-hypotheses`, `/ah-watch`, `/fold`, `/academic` |
| **Interface** | A status line (`research mode on · 1 job running · gate FAIL (5 blocking)`) and a pane (project state, jobs, notebook, library) |
| **Guard** | In a folder with an `ah.yaml`: protected files, unit anchors and author-only acts enforced on every write and shell call |
| **Safety** | Paid compute always asks. Keys are never printed. `~/.dsh` and the Academic Harness checkout are never written |

## Documentation

Every folder has its own index; start from [the documentation index](docs/README.md).

| For | Start at |
|---|---|
| **Using it** | [User guide](docs/guide/README.md): [getting started](docs/guide/getting-started.md), [commands](docs/guide/commands.md), [tools, skills and agents](docs/guide/tools-skills-agents.md), [settings](docs/guide/settings.md), [state and privacy](docs/guide/state-and-privacy.md), [troubleshooting](docs/guide/troubleshooting.md) |
| **Understanding it** | [Design](docs/design/README.md): [architecture](docs/design/architecture.md), [decisions](docs/design/decisions.md), [what was left out and why](docs/design/fit-review.md) |
| **Changing it** | [Maintenance](docs/maintain/README.md): [building](docs/maintain/building.md), [updating Academic Harness](docs/maintain/updating-upstream.md), [testing](docs/maintain/testing.md), [releasing](docs/maintain/releasing.md) |
| **How it was built** | [History](docs/history/README.md), and the [changelog](CHANGELOG.md) |

## The repository

| Folder | What is in it | Notes |
|---|---|---|
| [`hooks/`](hooks/README.md) | The Claude Code side: research mode, the guard, approvals, commands, the pane | TypeScript, run by the engine |
| [`server/`](server/README.md) | The tool host (`ah` MCP server), the PaperMemory launcher and the helper processes the hooks run | Node |
| [`scripts/`](scripts/README.md) | Setup, sync, builds, updates, checks | Node |
| `skills/`, `agents/` | The skills and agents Claude Code loads | Generated; do not edit ([Building](docs/maintain/building.md)) |
| [`tests/`](tests/README.md) | Plugin tests, node suites, live scripts | |
| [`types/`](types/README.md) | The `$.state` contract of the hooks module | |
| `upstream/` | The snapshot of Academic Harness (not committed) | Fetched by `setup` |
| `.claude-plugin/` | The manifest and the marketplace file | `plugin.json` is partly generated |
| `UPSTREAM.lock.json` | The Academic Harness commit and a digest of its files | |

## Licence

MIT, for the code written here (`LICENSE`). Academic Harness is MIT too; its `NOTICE`, with the third-party skill catalogues and their licences, applies to the skills copied from it (`NOTICE`). Skills under non-commercial, GPL or unknown licences are not in this repository.
