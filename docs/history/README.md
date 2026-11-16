# History

How the mod was built, phase by phase, with what was measured at each step. These are records: they describe the state when they were written, and where they disagree with the guide or the design notes, those are later.

| Page | What it records |
|---|---|
| [Implementation plan](implementation-plan.md) | The plan: goal, ground rules, what was measured in the source, architecture, decisions D1 to D10, phases P0 to P6, risks |
| [P1: skills, research mode, PaperMemory, agents](p1-results.md) | The first phase |
| [P2: the tool host](p2-results.md) | The MCP server, the context shim, the first 35 tools, keys as settings |
| [P3: the writing engine and the guard](p3-results.md) | The `ah_*` tools, the classic-event guard, approvals |
| [P4: long-running work and the model route](p4-results.md) | The rest of the tools, jobs, the model route, paid-compute approval, notices |
| [Audit of P0 to P4](audit-p0-p4.md) | Eleven gaps found by checking every item against a run, and their fixes |
| [P5: task commands and the interface](p5-results.md) | The seven commands, `/fold`, the status line and the pane |
| [P6: packaging and the last decisions](p6-results.md) | The fresh clone with no checkout, the doctor, the update procedure, what was dropped |
| [Wrap-up](wrap-up.md) | The marketplace install, `/ah-watch`, the docs, and what is left to run |

The platform findings behind several of these are in [Platform notes](../design/platform-notes.md); the reasoning about what to leave out is in [the fit review](../design/fit-review.md).
