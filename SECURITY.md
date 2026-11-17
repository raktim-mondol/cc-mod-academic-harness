# Security policy

## Supported versions

The latest release in the `0.4.x` line is supported. The mod is Linux only and needs Node.js 22 or newer; a report against an older release may be answered with "upgrade first".

## Reporting a vulnerability

**Do not open a public issue, a discussion or a pull request** for a vulnerability. Use GitHub's private security advisory for this repository:

<https://github.com/raktim-mondol/cc-mod-academic-harness/security/advisories/new>

If that is not available to you, contact the repository owner directly. A useful report has:

- the version (`/academic doctor` shows it) and the Claude Code and Node.js versions;
- the smallest reproduction, with the project layout and the command or call that triggers it;
- what the impact is, and whether a secret, a paid run or a file outside the project is exposed;
- the relevant part of `/academic doctor`, with **no key values** in it.

The owner will acknowledge the report, confirm the impact, and coordinate a fix and a disclosure date. This is a small project without a bounty.

## In scope

- A way past the writing-engine guard in an `ah.yaml` project: a protected file changed, a unit anchor dropped, an author-only act run without the author, or a guarded call that fails open.
- A path that escapes the session folder through the task commands, a tool, a symbol link, or the copy of the core made on first start.
- A key or a token printed, logged, written to a job record, or sent anywhere it should not go.
- `modal_run`, `runpod_run` or `vastai_run` started without the approval dialog, or past the session cap.
- A way to make the MCP server, the hooks module or an installer write outside its documented folders, or to make the doctor or the status line report a secret.
- Prompt injection that makes the model perform an author-only act, a paid run or a destructive shell command; the guard and the approvals are meant to stop it even when the model is fooled.

## Out of scope

- A vulnerability in a package the code depends on (an npm or Python package that `npm ci` or the engine's environment installs), or in a project vendored in `core/vendor/` that is not this repository's own (PaperMemory, Open Deep Review, Supervisor-Skills): report it to that project too. If this repository ships a version with a known vulnerability, that is in scope here, and so is the code in `core/` itself.
- A vulnerability in **Claude Code**, the model, GitHub, or a search or compute provider.
- A person with a shell account on the machine reading the files they already own, or a key they exported themselves appearing in their own process environment.
- The cost of a run the person approved, or a result the model got wrong. Correctness is a research concern, not a security one.

## Design guarantees

| Promise | Where it is enforced | Where it is described |
|---|---|---|
| Keys are names only in output; a key from the plugin's settings never masks one exported in the shell | `server/src/env.mjs`, `server/src/doctor.mjs` | [State and privacy](docs/guide/state-and-privacy.md) |
| The guard fails closed for writes and shell calls in an `ah.yaml` project | `hooks/guard.ts`, `hooks/guard-core.ts` | [State and privacy](docs/guide/state-and-privacy.md) |
| Paid compute always asks, and a run that cannot fit the session cap is refused | `hooks/approvals.ts`, `server/bin/ah-approve.mjs` | [Settings](docs/guide/settings.md) |
| Tools stay inside the session folder; a symbol link out of it is refused | `server/src/render.mjs`, `hooks/tasks.ts` | [State and privacy](docs/guide/state-and-privacy.md) |
| `~/.dsh` and a local Academic Harness checkout are never written | `server/src/env.mjs`, `server/src/paths.mjs` | [Architecture](docs/design/architecture.md) |

The guard is not a sandbox: it checks Claude's `Write`, `Edit`, `MultiEdit`, `NotebookEdit` and `Bash` calls in a project with an `ah.yaml`. A tool with its own write path is expected to enforce the same rules itself; say so in a report if one does not.

## Secrets

The plugin's settings hold API keys as environment variables for the tool server. They are not committed and the doctor reports their names, never their values. Job records hold a call's arguments and its result, as the tool returned it; never paste a record into a report without checking it. If a key is exposed, revoke it with the provider; rotating it in the plugin settings is enough, because nothing else stores it.
