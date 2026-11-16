# Documentation

Four sections. Each has an index of its own; this page is the map.

| Section | For | Pages |
|---|---|---|
| [Guide](guide/README.md) | Using the mod in Claude Code | [Getting started](guide/getting-started.md) · [Commands, the pane and the status line](guide/commands.md) · [Tools, skills and agents](guide/tools-skills-agents.md) · [Settings, keys and switches](guide/settings.md) · [State and privacy](guide/state-and-privacy.md) · [Troubleshooting](guide/troubleshooting.md) |
| [Design](design/README.md) | Why it is the way it is | [Architecture](design/architecture.md) · [Decisions](design/decisions.md) · [Fit review](design/fit-review.md) · [Platform notes](design/platform-notes.md) · [How Claude Code mods work](design/how-claude-code-mods-work.md) |
| [Maintenance](maintain/README.md) | Changing, updating and releasing it | [Building](maintain/building.md) · [Updating Academic Harness](maintain/updating-upstream.md) · [Testing](maintain/testing.md) · [Releasing](maintain/releasing.md) · [What to do next](maintain/next-steps.md) |
| [History](history/README.md) | How it was built | [Plan](history/implementation-plan.md) · [P1](history/p1-results.md) · [P2](history/p2-results.md) · [P3](history/p3-results.md) · [P4](history/p4-results.md) · [Audit](history/audit-p0-p4.md) · [P5](history/p5-results.md) · [P6](history/p6-results.md) · [Wrap-up](history/wrap-up.md) |

Beside the code, one short README per component: [hooks](../hooks/README.md) · [server](../server/README.md) · [scripts](../scripts/README.md) · [tests](../tests/README.md) · [types](../types/README.md). The [changelog](../CHANGELOG.md) and the [repository README](../README.md) are at the root.

## Conventions

- A page answers one question and says which. Where another page has the detail, it links rather than repeats.
- Generated parts are not documented by hand; the build that makes them is ([Building](maintain/building.md)).
- Records in [History](history/README.md) describe the moment they were written. When they disagree with the guide or the design pages, those are later.
- A new page is added to the index of its folder; `tests/scripts/docs.test.mjs` fails when a link breaks or a page is not reachable from here.
