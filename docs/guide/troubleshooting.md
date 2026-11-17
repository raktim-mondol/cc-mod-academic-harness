# Troubleshooting

Start with `/academic doctor` (outside a session: `node server/bin/ah-doctor.mjs`). It checks Node, the core, the dependencies, the writing engine, the Claude Code CLI, `uv`, PaperMemory's CLI and library, TextFold, the Python helpers, LaTeX, which keys are set (names only), the jobs folder, and what this server loaded or failed to load. Each gap comes with the command that fixes it. `--online` also asks GitHub whether Academic Harness has moved on.

| Symptom | Cause and fix |
|---|---|
| Only the `doctor` tool is there, and it says the core is "being set up" | The first start is copying the core and installing dependencies (a minute). The rest appears by itself. The setup runs in a process of its own, so it finishes even if you close the session; the next session has the tools |
| The doctor says the first-start setup failed | It shows the step and the error (no network for `npm ci`, npm down, a disk problem). `node scripts/setup.mjs` shows the whole error; the next start tries again |
| The `ah` server shows as failed in `/mcp` | With `AH_BOOTSTRAP=0` or `AH_CORE` set and no installed dependencies: `node scripts/setup.mjs` |
| `ah_*` tools say the engine is "being installed" or "missing" | The engine's environment builds in the background on first start (about a minute). `node scripts/install-engine.mjs` builds it now |
| `paper_fold` says TextFold is not ready | It installs when the notebook or submission tools load; check `AH_MANAGED_INSTALLS` and the network. The doctor shows whether it is there |
| A write in a project is refused with a reason | That is the guard. Read the reason, do not look for another way, and hand the question to the author with `ah_decision_request` |
| A write is refused and the reason says the guard could not run | The engine is missing or broke: it fails closed for writes and shell, and reads still work. Fix the engine as above. To work without the guard meanwhile, start Claude Code with `AH_NO_ENFORCE=1` in the shell |
| `literature_search` reports `s2: ... 429` | Semantic Scholar's keyless pool is shared and throttled. Set `S2_API_KEY`; the other sources still answer |
| A `deep_research` run stopped when the session ended | Jobs belong to the session. `deep_research` resumes from its own store (`action: resume`) |
| A headless `claude -p "/ah-research ..."` returns with the job unfinished | The command ends the session when it returns. Set `AH_JOB_FOREGROUND_MS` high so the run finishes inside it |
| A data or statistics tool says an import is missing | `node scripts/install-helpers.mjs`, or install the package it names |
| `/ah-papers` and the other commands say a file is not found | Paths are relative to the session folder and must stay inside it |
| The doctor says the hooks module "has not reported in this session" | Claude Code did not load it: `/academic`, the status line, the guard and the approvals are then absent, while the tools, skills and agents still work. It needs a Claude Code with the mod platform (the doctor names the version the mod was seen on). Update Claude Code, start a new session, and `claude --debug` shows why a hooks module did not load |
| The doctor says the Claude Code version "has not been tried with the mod" | Only the versions it lists were seen working. Others are expected to work; if a command, the status line or the guard misbehaves, report it with the version |
| A tool the guidance names is not found | It is one of the 15 left out ([fit review](../design/fit-review.md)); `restore_tools` brings back most of them |
| The router is on but every prompt stays on one model | `/model-router status` says why. The session may be on a model that is not Claude's (the router leaves it alone), the request may already be on the model the router chose, or the router is off (`/model-router on`) |
| `/model-router status` says Jev did not decide: `no TypeSafe key`, `auth_failed`, `timeout`, `http_5xx` or `malformed_response` | The keyword rules decided instead, and the route is still sound but coarser. Save a valid `typesafe_api_key`; after a failure Jev is left alone for a minute (ten after a refused key), then asked again |
| A prompt is sent to the wrong model | `/model-router explain <prompt>` shows what it would get and why. Start the prompt with `[opus]`, `[sonnet]` or `[haiku]` to choose, or change the thresholds ([the model router](model-router.md#checking-and-tuning-it)) |
| A prompt fails after the router chose a model | The model may not be on your plan. Set that route's model (`router_plan_model` and the others) to one you can use |
| A skill names a tool you do not have | Skills loaded on demand are written generally and may name a tool this plugin leaves out. Claude says so and uses the nearest one |

Still stuck: `claude --debug` shows plugin and hook problems; the server's own messages go to its stderr, prefixed `[academic-harness]`; the guard logs each decision to `<project>/.ah/claude-hooks.jsonl`.
