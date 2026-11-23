# hooks/

The Claude Code side of the mod: a hooks module the engine loads from `hooks.json` → `register.tsx`. It has no Node and no DOM, and reaches the outside only through the engine interface `$` (and, for anything that needs Node, through a process it runs: `server/bin/ah-*.mjs`). One `session.start` hook only: the engine refuses two with no matcher, so everything that must happen at start is called from it.

| File | What it does |
|---|---|
| `register.tsx` | Every registration, in one place |
| `mode.ts` | Research mode (`/academic on\|off\|auto\|status`), the research section of the system prompt, and `showStatus`, the only writer of the one status line |
| `guard.ts`, `guard-core.ts` | The writing-engine guard: the four classic events run `ah hook` through `server/bin/ah-hook.mjs` in an `ah.yaml` project; fails closed for writes and shell |
| `rsi.ts`, `rsi-core.ts` | `classic.PostToolUse` for every tool in an `ah.yaml` project: hands the result (bounded in size by the pure `rsi-core.ts`) to the self-improvement loop (`ah-hook.mjs rsi-post`); advisory, never blocks |
| `approvals.ts` | `tool.check`: `ah_author` and `ah_migrate apply` ask; paid compute always asks |
| `notices.ts`, `jobs-core.ts` | Job completion notices: a timer reads the job records and notifies, and prompts the model |
| `tasks.ts`, `tasks-core.ts` | `/ah-research` and the other task commands, `/ah-watch`, `/fold` |
| `ui.tsx`, `ui-core.ts` | The pane, and the parts of the status line |
| `router.ts`, `router-core.ts` | The model router: `turn.start` decides the model of a prompt, `turn.step` puts it on every request of the turn; `/model-router`. The core holds the policy, the keyword rules and the Jev request |
| `doctor.ts` | `/academic doctor` |
| `usage.ts` | Usage counts of the plugin's skills, agents and commands, for `/academic usage` |
| `seen.ts` | At session start, leaves a record that this module loaded, with the Claude Code version, for the doctor |
| `generated/` | **Generated; do not edit.** The research-mode text (`prompt.ts`), the task catalogue and the fold, copied from the engine code (`task-modes.ts`, `fold-core.ts`) |

Rules this code follows:

- A helper takes `$` as a parameter and calls it in full (`$.fs.read(...)`). The engine reads the source statically and refuses an aliased `$`.
- The `*-core.ts` files are pure and written in the erasable subset of TypeScript (no enums, no parameter properties), so node tests import them as they are (`tests/helpers/ts-resolve.mjs`).
- The state the module keeps lives in `$.state`, declared in [`types/index.d.ts`](../types/README.md).

Tests: `claude plugin test .` runs `tests/*.test.ts(x)`; see [Testing](../docs/maintain/testing.md). How the pieces meet: [Architecture](../docs/design/architecture.md).
