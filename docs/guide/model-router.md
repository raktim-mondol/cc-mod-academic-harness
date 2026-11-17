# The model router

Picks the model for each prompt, so planning gets the strongest model, code and everyday questions the middle one, and academic writing the smallest.

| The prompt asks for | Model |
|---|---|
| Initial planning: a plan, design, roadmap, strategy or approach worked out before the work is done | `opus` |
| Code: writing, changing, running, debugging, build and install problems, git, scripts | `sonnet` |
| Academic writing: an abstract, an introduction, a literature review, a rebuttal, a cover letter, proofreading and polishing scholarly prose | `haiku` |
| Anything else, and anything the router is not sure about | `sonnet` |

## Turn it on

Either one:

- `/model-router on` for this session (and `/model-router off`). Nothing else to set.
- The plugin option `model_router` set to `on`, for every session. It is `off` by default, because it changes which model answers and so what a prompt costs.

`/model-router status` says whether it is on, which model each kind of prompt gets, what is reading the prompts, what the session's model is, and what the last prompt got and why. `/model-router explain <prompt>` shows what a prompt would get without sending it to the model. While the router is on, the status line says so (`router on`, then `router → opus` after a prompt), and a toast appears when the model changes.

To choose for one prompt yourself, start it with `[opus]`, `[sonnet]` or `[haiku]`. That beats the router for that prompt, and the tag anywhere but the start is just words.

## How it decides

When you send a prompt, the router reads it once, picks a model, and puts that model on **every request of the turn**, so a turn that runs tools stays on one model from its first request to its last. It decides in this order:

1. **A tag** (`[haiku] ...`) at the start of the prompt.
2. **Plan mode.** When Claude Code's plan mode is on, the prompt goes to the planning model whatever the words are.
3. **Not a new task.** A finished job's notice, a message from another session, a turn that continues with no prompt: the route of the previous prompt stays, except that a plan is never kept (the step after a plan is carrying it out).
4. **The classifier**, which is Jev when a TypeSafe key is saved and keyword rules when it is not.

**Jev** is TypeSafe's System One model. One request carries two questions about your prompt: a choice between planning, coding, writing and other, which answers with a probability for each, and whether the prompt is only a go-ahead (`yes`, `continue`, `looks good, do it`). Jev supplies probabilities; the choice of model is the plugin's, in code (`hooks/router-core.ts`):

- Planning wins from 40%, even when coding is as likely: any prompt that needs a plan goes to the strongest model.
- Another route needs at least 50%, or the prompt is general work.
- The smallest model is used only when academic writing is at least 60% and coding under 25%. A prompt that is half writing and half code goes to the middle model.
- A go-ahead (80% or more) keeps coding or writing, and never keeps planning.

**Keyword rules** answer when there is no TypeSafe key, when `router_engine` is `rules`, and when Jev does not answer. They are English only and coarse on purpose, and they fall the safe way: what they cannot read goes to the middle model, never to the smallest or the strongest. The status says which one decided, and why Jev did not (`no TypeSafe key`, `timeout`, `auth_failed`, `http_500`, `malformed_response`).

## What it leaves alone

| Case | What happens |
|---|---|
| A subagent | Runs the model its own definition names. Only the main conversation is routed |
| A session on a model that is not Claude's (a gateway or another provider) | Left alone: the router's names would mean nothing there. `/model-router status` says so |
| A request already on the target model | Not changed, so nothing happens to the prompt cache |
| A long-context session (`[1m]`) | Keeps its window: `opus[1m]` for `opus` |
| A model name that is not a model name (a setting with spaces or shell characters) | Ignored; the default is used |
| Jev slow, down or refusing the key | The prompt waits up to 2.5 seconds, then the rules answer. Jev is then left alone for a minute (ten for a refused key), so a dead service does not cost every prompt its timeout |
| A prompt typed while a turn is running | Joins that turn, which stays on the model it had; the next turn is routed on its own |
| Anything inside the router that fails | The turn runs on the session's own model. The router can never stop a turn |

## What it costs

Routing changes **which model's prompt cache a request reads**, and a cache belongs to one model. The first request to a model in a session (and the first after the cache's lifetime has gone) writes the whole prompt prefix, the system prompt and every tool definition, to that model's cache at a higher price; after that the prefix is read at about a tenth.

Measured with this plugin on the machine it was built on, which loads 687 tools: one request to Opus on a cold cache wrote 67,561 tokens and cost $0.54. The same request on a model whose cache is warm costs a few cents. So:

- A session that plans once and then works on Sonnet pays the Opus write once.
- A session that bounces between planning and coding pays a read, not a write, on the second visit, while the cache lasts.
- `router_plan_model` set to `sonnet` turns the Opus leg off and keeps the rest.
- Fewer tools loaded (`tool_areas`, other plugins) means a smaller prefix and a cheaper first request on every model.

Jev itself costs no model tokens in your session: it is a call to TypeSafe's API, billed to your TypeSafe key.

## What leaves your machine

Nothing, unless a TypeSafe key is saved and `router_engine` is `auto`. Then each prompt that gets classified sends TypeSafe the start (1,200 characters) and the end (400) of the prompt, with the key, over HTTPS to `api.typesafe.ai`: no file, path, session id or conversation. Set `router_engine` to `rules` to keep every prompt on the machine. `/model-router explain` says whether it sent anything.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `model_router` | `off` | `on` routes every session; `/model-router on\|off` overrides it for one |
| `router_engine` | `auto` | `auto`: Jev when a TypeSafe key is saved, rules otherwise or when Jev fails. `rules`: always the rules; nothing is sent |
| `router_plan_model` | `opus` | Model for planning |
| `router_code_model` | `sonnet` | Model for coding |
| `router_write_model` | `haiku` | Model for academic writing |
| `router_fallback_model` | `sonnet` | Model for everything else and for anything uncertain |
| `typesafe_api_key` | empty | The key Jev needs ([Keys](keys.md)); the `TYPESAFE_API_KEY` variable also works |

A model setting is an alias (`opus`, `sonnet`, `haiku`) or a full model id; use an id when your plan has no access to an alias.

## Checking and tuning it

The thresholds are numbers at the top of `hooks/router-core.ts`. They were chosen from how Jev's probabilities behave in general, not measured on your prompts, and the keyword rules are a stand-in for Jev, not a measure of it. To see how it routes yours, put labelled prompts in `tests/fixtures/router-prompts.json` and run `TYPESAFE_API_KEY=... node tests/live/router.mjs real`: it prints each prompt Jev routed differently from its label, with the probabilities. [Testing](../maintain/testing.md) says what the other tests cover.

## Limits

- It routes the prompt, not the work: a prompt that says "fix the typo" and turns out to need a redesign stays on the model it started with.
- A TypeSafe that takes the request and never answers holds that prompt for 2.5 seconds, then the rules answer. The request itself cannot be cancelled and runs to Claude Code's own limit (about 30 seconds), so a headless `claude -p` ends that much later than its answer; an interactive session is not held.
- It cannot see that a model is unavailable on your plan. A request to a model you cannot use fails as it would if you had chosen it; set that route's model setting to one you can.
- The keyword rules read English. Jev reads other languages, but its thresholds have not been checked on them.
- Planning is chosen from how the prompt reads, so a prompt that carries out an existing plan ("implement the plan we agreed on") is coding, and one that asks for a plan while naming code is planning.

Next: [State and privacy](state-and-privacy.md).
