// The model router's pure parts: no `$`, no Node, so a test can drive them directly.
//
// What it decides: which model the main loop uses for one prompt.
//
//   planning (the first design of a piece of work)   -> opus
//   coding                                           -> sonnet
//   academic writing                                 -> haiku
//   anything else, or not sure                       -> sonnet
//
// Two classifiers feed one policy. Jev (TypeSafe's System One model) answers two questions in one request: a Choice over the four routes
// and a Noul for "is this only a go-ahead". Keyword rules answer when there is no key, when the person chose `rules`, or when Jev was slow,
// refused or malformed. Code owns the policy (`decide`): Jev supplies probabilities, never the model name.
//
// Written in the erasable subset of TypeScript (no enums, no parameter properties) so Node can run it as it is in a test.

export const ROUTER_COMMAND = 'model-router'

export type Route = 'plan' | 'code' | 'write' | 'other'
export const ROUTES: readonly Route[] = ['plan', 'code', 'write', 'other']
export type Models = Record<Route, string>
export type Probabilities = Record<Route, number>
export type Via = 'jev' | 'rules' | 'directive' | 'plan-mode' | 'continuation' | 'carry'

/** What a decision records: the route, the model it maps to, who decided and why in a few words. */
export type Decision = { route: Route; model: string; via: Via; why: string; p?: Probabilities }

export const DEFAULT_MODELS: Models = { plan: 'opus', code: 'sonnet', write: 'haiku', other: 'sonnet' }
export const ROUTE_LABEL: Record<Route, string> = { plan: 'planning', code: 'coding', write: 'academic writing', other: 'general' }

// ---- the policy: the thresholds are about the probabilities Jev returns, and are the numbers to tune against real prompts ----

/** Planning wins from this probability: a prompt that needs a plan goes to the strongest model even when coding is as likely. */
export const PLAN_MIN = 0.4
/** Any other route needs at least this much, or the prompt is "general". */
export const TOP_MIN = 0.5
/** The smallest model writes only when academic writing is clearly the task and coding is clearly not. */
export const WRITE_MIN = 0.6
export const WRITE_CODE_MAX = 0.25
/** A message that is only a go-ahead ("yes", "continue") keeps the route of the one before it from this probability. */
export const CONTINUATION_MIN = 0.8

/** The most of a prompt sent to Jev: the head carries the request, the tail often the instruction after a paste. */
export const JEV_HEAD = 1200
export const JEV_TAIL = 400

// ---- settings ----

export type Setting = 'on' | 'off'
export type Engine = 'auto' | 'rules'

export function routerSetting(options: Readonly<Record<string, unknown>>): Setting {
  return String(options['model_router'] ?? '').trim().toLowerCase() === 'on' ? 'on' : 'off'
}

/** `auto` uses Jev when a TypeSafe key is set; `rules` never sends the prompt anywhere. */
export function engineSetting(options: Readonly<Record<string, unknown>>): Engine {
  return String(options['router_engine'] ?? '').trim().toLowerCase() === 'rules' ? 'rules' : 'auto'
}

/** An alias (`opus`), a full id (`claude-opus-5-5`) or either with `[1m]`. Anything else is not passed on to the engine. */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}(\[[0-9a-z]{1,6}\])?$/

export function cleanModel(value: unknown, fallback: string): string {
  const v = typeof value === 'string' ? value.trim() : ''
  return MODEL_NAME.test(v) ? v : fallback
}

export function modelsFrom(options: Readonly<Record<string, unknown>>): Models {
  return {
    plan: cleanModel(options['router_plan_model'], DEFAULT_MODELS.plan),
    code: cleanModel(options['router_code_model'], DEFAULT_MODELS.code),
    write: cleanModel(options['router_write_model'], DEFAULT_MODELS.write),
    other: cleanModel(options['router_fallback_model'], DEFAULT_MODELS.other),
  }
}

// ---- the models a request names ----

/** True for a Claude model's id, alias or display name. A session on another provider's model is left alone. */
export function isClaudeModel(model: unknown): boolean {
  return /\b(claude|opus|sonnet|haiku|fable)\b|claude-/i.test(String(model ?? ''))
}

export function familyOf(model: string): 'opus' | 'sonnet' | 'haiku' | 'fable' | null {
  const m = /opus|sonnet|haiku|fable/i.exec(model)
  return m ? (m[0].toLowerCase() as 'opus' | 'sonnet' | 'haiku' | 'fable') : null
}

/**
 * The model to put on a request that names `current`, or null to leave the request alone: it is not a Claude model, or it already is
 * the target (the same id, or the target is a family alias and `current` is in that family). A long-context session keeps its window:
 * `[1m]` on the current model is put on the target too.
 */
export function applyModel(current: string, target: string): string | null {
  if (!isClaudeModel(current)) return null
  if (current === target) return null
  const bare = /^(opus|sonnet|haiku|fable)$/i.test(target)
  if (bare && familyOf(current) === target.toLowerCase()) return null
  const long = /\[1m\]$/i.test(current) && !/\[/.test(target)
  return long ? `${target}[1m]` : target
}

// ---- the person's own override: a leading [opus], [sonnet] or [haiku] ----

const DIRECTIVE = /^\s*\[(opus|sonnet|haiku)\]\s*/i

/** The model a prompt names for itself, or null. The tag stays in the prompt; it is harmless to the model. */
export function parseDirective(text: string): string | null {
  const m = DIRECTIVE.exec(String(text ?? ''))
  return m ? m[1]!.toLowerCase() : null
}

// ---- what Jev is sent ----

/** The prompt cut to what Jev needs, so a pasted log or a whole file does not travel. */
export function forJev(text: string): string {
  const t = String(text ?? '').trim()
  if (t.length <= JEV_HEAD + JEV_TAIL) return t
  return `${t.slice(0, JEV_HEAD)}\n[... ${t.length - JEV_HEAD - JEV_TAIL} characters left out ...]\n${t.slice(-JEV_TAIL)}`
}

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
/** Pinned: the thresholds above were chosen against one model, and an alias would move them without a word. */
export const JEV_MODEL = 'jev-1.14.0'
export const JEV_TIMEOUT_MS = 2500
/** The least time worth waiting for Jev; with less left in the hook's budget the rules answer at once. */
export const JEV_MIN_WAIT_MS = 800
/** Kept back from the hook's budget for everything after the answer. */
export const JEV_SPARE_MS = 700

/** How long to wait for Jev given the hook's remaining budget, or null when there is too little time to ask at all. */
export function jevWait(remainingMs: number | undefined): number | null {
  const wait = Math.min(JEV_TIMEOUT_MS, (remainingMs ?? Infinity) - JEV_SPARE_MS)
  return wait >= JEV_MIN_WAIT_MS ? wait : null
}

const ROUTE_QUESTION = {
  type: 'choice',
  instructions:
    'What kind of work is the person asking an AI assistant to do in `message`? Judge the request itself, not the topic it mentions. If it asks for a plan, design or approach to be worked out first, it is planning even when it names code or a paper.',
  criteria: {
    plan: 'Initial planning: asks to work out, propose or choose a plan, roadmap, strategy, architecture, system or study design, research design or approach BEFORE the work is done; asks how to structure or break down a large or open-ended task; compares options and trade-offs to decide what to build or do. Not this: carrying out a step of a plan that already exists.',
    code: 'Programming: write, change, run, test, debug, review or explain code, scripts, queries, configuration, build or install problems, errors and stack traces, git, command-line work, data-analysis code.',
    write: 'Academic or scientific prose: write, rewrite, edit, shorten, expand, summarise, proofread or polish an abstract, introduction, literature review, discussion, conclusion, paper section, thesis chapter, grant text, cover letter, rebuttal, reviewer response or other scholarly text.',
    other: 'Everything else: a factual question, a short lookup, an explanation of a concept, file or folder chores, a quick reply, small talk.',
  },
} as const

const CONTINUATION_QUESTION = {
  type: 'noul',
  instructions:
    'Is `message` only a short go-ahead, acknowledgement or request to carry on with what was already being done ("yes", "go ahead", "continue", "looks good, do it", "thanks"), with no new task, topic or detail of its own?',
} as const

export function jevRequest(text: string): Record<string, unknown> {
  return { model: JEV_MODEL, state: { message: forJev(text) }, questions: { route: ROUTE_QUESTION, continuation: CONTINUATION_QUESTION } }
}

export type Judgment = { ok: true; p: Probabilities; continuation: number; model: string } | { ok: false; reason: string }

const inUnit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1

/** The route probabilities and the go-ahead probability from Jev's JSON. Anything that does not fit is `malformed_response`, never a guess. */
export function parseJev(body: unknown): Judgment {
  const answers = (body as { answers?: Record<string, { probabilities?: Record<string, unknown>; noul?: unknown }> } | null)?.answers
  const probabilities = answers?.['route']?.probabilities
  const continuation = answers?.['continuation']?.noul
  if (!probabilities || !inUnit(continuation)) return { ok: false, reason: 'malformed_response' }
  const p = {} as Probabilities
  for (const route of ROUTES) {
    const v = probabilities[route]
    if (!inUnit(v)) return { ok: false, reason: 'malformed_response' }
    p[route] = v
  }
  const model = (body as { model?: unknown }).model
  return { ok: true, p, continuation, model: typeof model === 'string' ? model : JEV_MODEL }
}

/** Why a failed request failed, in one word that the status can show. */
export function failureReason(status: number | null, error?: string): string {
  if (status === 401 || status === 403) return 'auth_failed'
  if (status === 429) return 'rate_limited'
  if (status) return `http_${status}`
  return error === 'timeout' ? 'timeout' : 'network_error'
}

/** After a failure Jev is left alone for a while, so a dead service does not cost every prompt its timeout. A refused key waits longer. */
export function pauseFor(reason: string): number {
  return reason === 'auth_failed' ? 10 * 60_000 : 60_000
}

// ---- the policy ----

const argmax = (p: Probabilities): Route => ROUTES.reduce((best, r) => (p[r] > p[best] ? r : best), 'plan' as Route)

/**
 * The route for Jev's probabilities. `previous` is the route of the last prompt, used only for a go-ahead: it keeps coding or writing,
 * and never keeps planning (the step after a plan is carrying it out, which is general work for the middle model).
 */
export function decide(p: Probabilities, continuation: number, previous: Route | null): { route: Route; via: Via; why: string } {
  if (continuation >= CONTINUATION_MIN && previous) {
    return previous === 'plan'
      ? { route: 'other', via: 'continuation', why: 'a go-ahead after planning' }
      : { route: previous, via: 'continuation', why: `a go-ahead, so ${ROUTE_LABEL[previous]} carries on` }
  }
  if (p.plan >= PLAN_MIN) return { route: 'plan', via: 'jev', why: `planning ${pct(p.plan)}` }
  const top = argmax(p)
  if (p[top] < TOP_MIN) return { route: 'other', via: 'jev', why: `no clear match (best: ${top} ${pct(p[top])})` }
  if (top === 'write' && !(p.write >= WRITE_MIN && p.code < WRITE_CODE_MAX)) {
    return { route: 'other', via: 'jev', why: `writing ${pct(p.write)} but not clear enough for the smallest model` }
  }
  return { route: top, via: 'jev', why: `${ROUTE_LABEL[top]} ${pct(p[top])}` }
}

const pct = (v: number): string => `${Math.round(v * 100)}%`

// ---- the rules: used without a key, and when Jev does not answer. English only, and coarse on purpose ----

const PLAN_RULES: readonly RegExp[] = [
  // A verb that makes something, then what it makes. Not "explain the architecture" or "understand the approach", and not "write a grant
  // proposal" (that is writing): the nouns are the ones that only ever name a plan.
  /\b(make|create|draft|write|come up with|propose|prepare|put together|give me|need|want|develop|outline|sketch|work out|devise|help me (?:with|make|create|draw up))\b[^.\n]{0,40}\b(plan|roadmap|strategy|blueprint|research design|study design|experimental design|design for|architecture (?:for|proposal)|migration plan)\b/i,
  /\bplan (?:out|for how)\b/i,
  /\bhow (?:should|would|could|do|can) (?:we|i|you)\b[^.?\n]{0,60}\b(approach|structure|organi[sz]e|architect|tackle|go about|break (?:this|it) down)\b/i,
  /\b(?:think (?:this|it) through|break (?:this|it|the (?:task|problem|project)) (?:down|into)|trade-?offs?|pros and cons|before (?:we|you|i) (?:start|begin|code|implement|write))\b/i,
  /\b(?:system design|high-level design|design doc(?:ument)?)\b/i,
  /\bhelp me (?:design|plan)\b|\b(?:design|plan) (?:the|a|an|our|my) (?:study|experiments?|project|pipeline|system|survey|trial|thesis|evaluation|architecture)\b/i,
]

const CODE_RULES: readonly RegExp[] = [
  /```/,
  /\b[\w./-]+\.(?:py|ts|tsx|js|jsx|mjs|rs|go|java|c|cc|cpp|h|hpp|cs|rb|php|sh|sql|ya?ml|toml|json|ipynb|jl|css|html)\b/i,
  /\b(?:implement|refactor|debug|bugs?|stack ?trace|traceback|exception|segfault|compil(?:e|er|ation)|syntax error|type ?error|unit tests?|pytest|npm|pip install|cargo|git (?:commit|rebase|merge|diff|push|pull|stash)|function|method|class|variable|regex|endpoint|dockerfile|script|lint|runtime error|import error|exit code)\b/i,
  /\b(?:fix|write|add|create|make) (?:a |an |the )?(?:failing )?(?:test|function|script|class|endpoint|query|migration|component|hook)\b/i,
]

const WRITE_VERBS = /\b(?:write|rewrite|draft|polish|proofread|edit|improve|shorten|expand|summari[sz]e|paraphrase|revise|tighten|reword|rephrase|copy-?edit)\b/i
const WRITE_NOUNS =
  /\b(?:abstract|introduction|related work|literature review|background section|discussion|conclusion|manuscript|paper|thesis|dissertation|cover letter|rebuttal|response to (?:the )?reviewers?|reviewer comments?|grant (?:application|proposal|text)|specific aims|personal statement|paragraph|acknowledg(?:e)?ments|caption|essay)\b/i
const WRITE_STRONG = /\b(?:proofread|paraphrase|rephrase|reword|copy-?edit|polish (?:this|my|the)|improve the (?:flow|wording|writing|prose)|more (?:concise|formal|academic))\b/i

// A go-ahead is made of nothing else: "yes", "ok thanks", "looks good, do it". One more word of content and it is a new request.
const GO_AHEAD_WORDS = '(?:y(?:es|ep|eah)?|ok(?:ay)?|sure|go(?: ahead| on)?|continue|proceed|carry on|do it|please do|next|thanks?(?: you)?|thx|sounds good|looks good|lgtm|great|perfect)'
const GO_AHEAD = new RegExp(`^\\s*(?:${GO_AHEAD_WORDS}\\b[\\s,.!;:-]*)+$`, 'i')

/** The route by keywords. Planning first (any prompt that needs a plan), then code, then writing; a prompt with both code and prose is code. */
export function rulesRoute(text: string, previous: Route | null): { route: Route; via: Via; why: string } {
  const t = String(text ?? '')
  if (GO_AHEAD.test(t) && previous) {
    return previous === 'plan'
      ? { route: 'other', via: 'continuation', why: 'a go-ahead after planning' }
      : { route: previous, via: 'continuation', why: `a go-ahead, so ${ROUTE_LABEL[previous]} carries on` }
  }
  if (PLAN_RULES.some(re => re.test(t))) return { route: 'plan', via: 'rules', why: 'asks for a plan or design' }
  if (CODE_RULES.some(re => re.test(t))) return { route: 'code', via: 'rules', why: 'mentions code' }
  if (WRITE_STRONG.test(t) || (WRITE_VERBS.test(t) && WRITE_NOUNS.test(t))) return { route: 'write', via: 'rules', why: 'asks for academic writing' }
  return { route: 'other', via: 'rules', why: 'nothing specific' }
}

// ---- what the person reads ----

export function statusPart(isOn: boolean, last: { model: string } | null): string | null {
  if (!isOn) return null
  return last ? `router → ${last.model}` : 'router on'
}

export function describe(d: Decision, jevNote?: string): string {
  const how = d.via === 'directive' ? 'you asked for it' : d.via === 'plan-mode' ? 'plan mode is on' : d.why
  const by = d.via === 'jev' ? 'Jev' : d.via === 'rules' ? `keyword rules${jevNote ? ` (Jev: ${jevNote})` : ''}` : d.via
  return `${d.model} · ${ROUTE_LABEL[d.route]} · ${how} · by ${by}`
}
