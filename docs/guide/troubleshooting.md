# Troubleshooting

Start with `/academic doctor` (outside a session: `node server/bin/ah-doctor.mjs`). It checks Node, the source snapshot against the lock, the dependencies, the writing engine, the Claude Code CLI, `uv`, PaperMemory's CLI and library, TextFold, the Python helpers, LaTeX, which keys are set (names only), the jobs folder, and what this server loaded or failed to load. Each gap comes with the command that fixes it. `--online` also asks GitHub whether Academic Harness has moved on.

| Symptom | Cause and fix |
|---|---|
| Only the `doctor` tool is there, and it says the snapshot is "being set up" | The first start is fetching the source and installing dependencies (a minute). The rest appears by itself |
| The doctor says the first-start fetch failed | It shows the step and the error (no network, GitHub or npm down, a disk problem). `node scripts/setup.mjs` shows the whole error; the next start tries again |
| The `ah` server shows as failed in `/mcp` | With `AH_BOOTSTRAP=0` or `AH_UPSTREAM` set and no snapshot or dependencies: `node scripts/setup.mjs` |
| `ah_*` tools say the engine is "being installed" or "missing" | The engine's environment builds in the background on first start (about a minute). `node scripts/install-engine.mjs` builds it now |
| `paper_fold` says TextFold is not ready | It installs when the notebook or submission tools load; check `AH_MANAGED_INSTALLS` and the network. The doctor shows whether it is there |
| A write in a project is refused with a reason | That is the guard. Read the reason, do not look for another way, and hand the question to the author with `ah_decision_request` |
| A write is refused and the reason says the guard could not run | The engine is missing or broke: it fails closed for writes and shell, and reads still work. Fix the engine as above. To work without the guard meanwhile, start Claude Code with `AH_NO_ENFORCE=1` in the shell |
| `literature_search` reports `s2: ... 429` | Semantic Scholar's keyless pool is shared and throttled. Set `S2_API_KEY`; the other sources still answer |
| A `deep_research` run stopped when the session ended | Jobs belong to the session. `deep_research` resumes from its own store (`action: resume`) |
| A headless `claude -p "/ah-research ..."` returns with the job unfinished | The command ends the session when it returns. Set `AH_JOB_FOREGROUND_MS` high so the run finishes inside it |
| A data or statistics tool says an import is missing | `node scripts/install-helpers.mjs`, or install the package it names |
| `/ah-papers` and the other commands say a file is not found | Paths are relative to the session folder and must stay inside it |
| A tool the guidance names is not found | It is one of the 15 left out ([fit review](../design/fit-review.md)); `restore_tools` brings back most of them |
| The doctor says the snapshot "is not what the lock says" | It was edited or came from another commit. `node scripts/setup.mjs` restores the locked one |
| A skill names a tool you do not have | Skills loaded on demand are written generally and may name a tool this plugin leaves out. Claude says so and uses the nearest one |

Still stuck: `claude --debug` shows plugin and hook problems; the server's own messages go to its stderr, prefixed `[academic-harness]`; the guard logs each decision to `<project>/.ah/claude-hooks.jsonl`.
