# Contributing

This repository is public and every change is reviewed by its owner. The notes below are the short version; the detailed rules live with the code.

## Read first

- [Architecture](docs/design/architecture.md): the two halves of the mod and how they meet.
- [Building](docs/maintain/building.md): what is generated, what is written by hand, and the ground rules.
- [Testing](docs/maintain/testing.md): which command checks what, and what the live scripts cost.

## Set up

```
node scripts/setup.mjs
claude --plugin-dir "$PWD"
```

There is no `npm install` at the repository root: the only dependencies are installed inside `upstream/` by setup. Node.js 22 or newer is required (`.nvmrc` names 22, the version CI tests alongside 24).

## Before you send a change

```
npm run check        # node suites, plugin.json, the served tool surface
npm run typecheck    # after a session has loaded the mod once (the engine writes its types)
npm run test:plugin  # the hooks module, with the engine stood in for
```

`npm run check` is the same gate CI runs. A change to the guard, the commands, the pane or the job notices also needs the relevant live script (`p1`, `p3`, `p5`, `p6`, `fit` or `install`); they need a signed-in Claude Code and are run by choice, not by CI.

A workflow change that adds or changes an action must pin it to a 40-character commit SHA (keep the version as a trailing comment); a test fails on a tag. Dependabot sends the updates.

A change to the argument check (`server/src/validate.mjs`) needs a unit test in `tests/server/validate.test.mjs` and a host test in `tests/server/host.test.mjs`; no message may ever hold an argument value.

## Ground rules

- **Never edit generated output:** `upstream/`, `skills/`, `agents/` and `hooks/generated/`. Change the build script and regenerate (`npm run build`), then review the diff.
- **Never edit the Academic Harness checkout.** The snapshot is taken with `git archive` and is read-only; `node scripts/check-upstream-clean.mjs` proves the checkout and `~/.dsh` were untouched.
- **Keep keys out of output.** The doctor and the build may name a key, never print its value. A test that needs a key uses a stand-in.
- **A fix comes with a test** and a line in [CHANGELOG.md](CHANGELOG.md) when someone using the mod would notice it. A bug fixes the cause, not the symptom.
- **A new documentation page goes in the index of its folder.** `tests/scripts/docs.test.mjs` fails when a link breaks or a page is unreachable from the [README](README.md).
- **A change to upstream's text goes through `scripts/adapt.mjs`.** A rewrite rule that no longer finds its passage fails the build on purpose: review the rule rather than loosening it.
- **Stop processes by PID, never by name pattern.** Scratch and test folders live under `~/.cache`.

## Where to change what

| Change | Start at |
|---|---|
| Research mode, the status line, the pane, commands, the guard, approvals | [`hooks/`](hooks/README.md) |
| MCP tools, jobs, the model route, the doctor, first-start setup | [`server/`](server/README.md) |
| Setup, builds, updates, checks | [`scripts/`](scripts/README.md) |
| What is left out and why | [`server/src/fit.mjs`](server/src/fit.mjs) |
| Tests | [`tests/`](tests/README.md) |

## Commits and pull requests

Use an imperative subject that says what changes (`Fix the workspace check at the filesystem root`), and explain why in the body when it is not obvious. A pull request states what was checked, calls out anything not checked, and notes any change to generated files. The pull request template asks for the same three things.

## Security

Do not report a vulnerability in an issue or a pull request. Follow [SECURITY.md](SECURITY.md).

## Licence

The mod is MIT ([LICENSE](LICENSE)). By contributing you agree that your change is released under the same licence. Third-party notices are in [NOTICE](NOTICE); do not add a skill or a file whose licence forbids redistribution.
