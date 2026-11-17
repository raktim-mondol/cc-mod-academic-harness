import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, PluginOptions } from 'claude-code'

import type { RouterLast, RouterOverride } from '../types'
import { showStatus } from './mode'
import {
  applyModel,
  decide,
  describe,
  engineSetting,
  failureReason,
  isClaudeModel,
  JEV_URL,
  jevRequest,
  jevWait,
  modelsFrom,
  parseDirective,
  parseJev,
  pauseFor,
  ROUTE_LABEL,
  ROUTER_COMMAND,
  routerSetting,
  rulesRoute,
  statusPart,
} from './router-core'
import type { Decision, Judgment, Models, Route } from './router-core'
import { live } from './ui-core'
import { count } from './usage'

// The model router: the model the main loop uses for each prompt.
//
//   /model-router on | off | status | explain <prompt>
//
// A `turn.start` hook (the main loop only) reads the prompt once and decides; a `turn.step` hook puts that decision's model on every request
// of the turn, so a turn that calls tools stays on one model from its first request to its last. Subagents are left alone: they run the model
// their own definition names. The classifier is Jev when a TypeSafe key is set (one request, two questions), and keyword rules when there is
// no key, when the person chose `rules`, or when Jev does not answer in time. router-core.ts holds the policy and the rules.
//
// Nothing here may stop a turn: every failure ends in "leave the request as it was".
//
// Helpers here take `$` as a parameter and call it in full: the engine reads this source statically and refuses an aliased `$`.

export const USAGE = 'Usage: /model-router [on | off | status | explain <prompt>]'

const override = atom({ plugin: 'academic-harness', key: 'router' } as const, null as RouterOverride)
const last = atom({ plugin: 'academic-harness', key: 'routerLast' } as const, null as RouterLast | null, { shape: 'router-last-1' })

/** The decisions of the turns in flight, by turn id. A reload mid-turn empties it and that turn finishes on the model it had. */
const decisions = new Map<string, Decision>()
const MAX_HELD = 32
/** Jev is left alone until this time after a failure, for the key that failed: a new key is tried at once. */
let pause: { until: number; reason: string; key: string } | null = null
/** What the last submission said about itself, to tell a person's prompt from a notification. */
let submitted: { text: string; origin: string } | null = null
/** The text of a prompt sent in plan mode, until its turn starts. */
let planPrompt: string | null = null

/** Origins that are a new task from a person or a schedule. Every other origin is the session going on (a job finished, a peer replied). */
const NEW_TASK = ['composer', 'bridge', 'sdk', 'channel', 'slack-ping', 'scheduled-trigger']

export type Switch = { isOn: boolean; why: string }

export async function routerSwitch($: EngineInterface, options: PluginOptions): Promise<Switch> {
  const chosen = await read($, override)
  const mode = chosen ?? routerSetting(options)
  const source = chosen ? 'set with /model-router' : 'from the model_router setting'
  return { isOn: mode === 'on', why: `${mode} (${source})` }
}

/** Show the router in the status line: the model the last prompt got, or just "on". */
async function refreshLine($: EngineInterface, options: PluginOptions): Promise<void> {
  const sw = await routerSwitch($, options)
  live.router = statusPart(sw.isOn, await read($, last))
  await showStatus($, options)
}

export async function startRouter($: EngineInterface, options: PluginOptions): Promise<void> {
  decisions.clear()
  pause = null
  submitted = null
  planPrompt = null
  try {
    const sw = await routerSwitch($, options)
    live.router = statusPart(sw.isOn, await read($, last))
  } catch {
    live.router = null
  }
}

export async function registerRouterCommand($: EngineInterface): Promise<void> {
  try {
    await $.command.register({ name: ROUTER_COMMAND, description: 'Pick the model for each prompt: planning on Opus, coding on Sonnet, academic writing on Haiku', argumentHint: '[on | off | status | explain <prompt>]' })
  } catch {
    // a built-in or another plugin already has the name: carry on without the command
  }
}

// ---- Jev ----

async function jevKey($: EngineInterface, options: PluginOptions): Promise<string> {
  if (engineSetting(options) === 'rules') return ''
  const saved = String(options['typesafe_api_key'] ?? '').trim()
  if (saved) return saved
  return String((await $.env.get('TYPESAFE_API_KEY')) ?? '').trim()
}

/** The address, or a loopback address a test points it at (AH_ROUTER_JEV_URL): the prompt and the key never go to any other host. */
async function jevUrl($: EngineInterface): Promise<string> {
  const given = String((await $.env.get('AH_ROUTER_JEV_URL')) ?? '').trim()
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(given) ? given : JEV_URL
}

/** What the turn.start hook hands down: its dispatch's signal and how much of its own time is left (`next.signal`, `next.budget`). */
export type Dispatch = { signal?: AbortSignal; remainingMs?: number }

async function askJev($: EngineInterface, key: string, text: string, dispatch: Dispatch): Promise<Judgment> {
  const now = await $.clock.now()
  if (pause && pause.key === key && now < pause.until) return { ok: false, reason: `paused_after_${pause.reason}` }
  const wait = jevWait(dispatch.remainingMs)
  if (wait === null) return { ok: false, reason: 'no_time' }
  try {
    const sent = $.http.fetch(await jevUrl($), { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(jevRequest(text)) })
    // The wait is `$.clock.sleep`, the hook's own time (its doc says so, and a live run against a stand-in that never answers measured the
    // prompt held for 2.5 s). When the dispatch is over, the engine aborts its signal and the sleep ends by itself. A request that has
    // been given up on cannot be cancelled: it runs to the engine's own limit (about 30 s), which only delays the end of a headless process.
    const sleep = $.clock.sleep(wait, dispatch.signal ? { signal: dispatch.signal } : undefined).then(() => 'timeout' as const, () => 'timeout' as const)
    const answer = await Promise.race([sent.then(v => v, () => 'error' as const), sleep])
    if (answer === 'timeout' || answer === 'error') {
      const reason = failureReason(null, answer)
      pause = { until: now + pauseFor(reason), reason, key }
      return { ok: false, reason }
    }
    if (!answer.ok) {
      const reason = failureReason(answer.status)
      pause = { until: now + pauseFor(reason), reason, key }
      return { ok: false, reason }
    }
    let body: unknown
    try {
      body = JSON.parse(answer.text)
    } catch {
      return { ok: false, reason: 'malformed_response' }
    }
    return parseJev(body)
  } catch {
    return { ok: false, reason: 'network_error' }
  }
}

// ---- the decision ----

type Classified = { decision: Decision; note: string }

/** Classify one prompt. Never throws. `note` says why Jev was not the one that decided, or is empty when it was. */
async function classify($: EngineInterface, options: PluginOptions, text: string, previous: Route | null, models: Models, dispatch: Dispatch): Promise<Classified> {
  let note = ''
  const key = await jevKey($, options)
  if (key) {
    const j = await askJev($, key, text, dispatch)
    if (j.ok) {
      const d = decide(j.p, j.continuation, previous)
      return { decision: { ...d, model: models[d.route], p: j.p }, note: '' }
    }
    note = j.reason
  } else {
    note = engineSetting(options) === 'rules' ? 'rules chosen' : 'no TypeSafe key'
  }
  const r = rulesRoute(text, previous)
  return { decision: { ...r, model: models[r.route] }, note }
}

async function decideFor($: EngineInterface, options: PluginOptions, turnId: string, rawText: string, dispatch: Dispatch): Promise<void> {
  if (!(await routerSwitch($, options)).isOn) return
  const models = modelsFrom(options)
  const text = rawText.trim()
  const before = await read($, last)
  const previous: Route | null = before?.route ?? null
  const origin = submitted && submitted.text === text ? submitted.origin : 'composer'
  const wasPlanMode = planPrompt !== null && planPrompt === text
  planPrompt = null
  submitted = null

  let decision: Decision
  let note = ''
  const forced = parseDirective(text)
  if (forced) {
    decision = { route: 'other', model: forced, via: 'directive', why: `[${forced}] at the start of the prompt` }
  } else if (wasPlanMode) {
    decision = { route: 'plan', model: models.plan, via: 'plan-mode', why: 'plan mode is on' }
  } else if (text === '' || !NEW_TASK.includes(origin)) {
    // No new task: a continued turn, a finished job's notice, a peer's message. The route stays what it was, and a plan is not kept.
    const route: Route = previous && previous !== 'plan' ? previous : 'other'
    decision = { route, model: models[route], via: 'carry', why: text === '' ? 'no new prompt' : `a ${origin} message, not a new task` }
  } else {
    const c = await classify($, options, text, previous, models, dispatch)
    decision = c.decision
    note = c.note
  }

  decisions.set(turnId, decision)
  while (decisions.size > MAX_HELD) decisions.delete(decisions.keys().next().value as string)

  const changed = before?.model !== decision.model
  const at = await $.clock.now()
  await update($, last, () => ({ route: decision.route, model: decision.model, via: decision.via, why: decision.why, note, at }))
  await refreshLine($, options)
  if (changed) {
    try {
      $.ui.toast(`router → ${decision.model} (${decision.route === 'other' && decision.via === 'directive' ? 'your choice' : ROUTE_LABEL[decision.route]})`)
    } catch {
      // no place to draw it (a headless run): the status line and /model-router status say it
    }
  }
}

// ---- the command ----

async function statusText($: EngineInterface, options: PluginOptions): Promise<string> {
  const sw = await routerSwitch($, options)
  const m = modelsFrom(options)
  const key = await jevKey($, options)
  const engine = key ? 'Jev (TypeSafe key found), keyword rules when Jev does not answer' : engineSetting(options) === 'rules' ? 'keyword rules (router_engine is rules: no prompt leaves this machine)' : 'keyword rules (no TypeSafe key; set typesafe_api_key to use Jev)'
  let session = ''
  try {
    const model = await $.session.model()
    session = isClaudeModel(model) ? `Session model: ${model}.` : `Session model: ${model}, which is not a Claude model, so the router leaves it alone.`
  } catch {
    // not known: leave the line out
  }
  const l = await read($, last)
  const lines = [
    `Model router is ${sw.why}.`,
    `Planning → ${m.plan} · coding → ${m.code} · academic writing → ${m.write} · everything else → ${m.other}.`,
    `Classifier: ${engine}.`,
    session,
    l ? `Last prompt: ${l.model} · ${ROUTE_LABEL[l.route]} · ${l.why}${l.note ? ` (Jev did not decide: ${l.note})` : ''}.` : 'No prompt routed yet.',
    'Start a prompt with [opus], [sonnet] or [haiku] to choose the model for that prompt yourself.',
    USAGE,
  ]
  return lines.filter(Boolean).join('\n')
}

async function explainText($: EngineInterface, options: PluginOptions, prompt: string): Promise<string> {
  if (prompt === '') return `Say which prompt to explain: /model-router explain <prompt>. ${USAGE}`
  const forced = parseDirective(prompt)
  const l = await read($, last)
  const models = modelsFrom(options)
  if (forced) return `${forced} · your choice · [${forced}] at the start of the prompt (nothing was sent anywhere).`
  const c = await classify($, options, prompt, l?.route ?? null, models, {})
  const sent = c.decision.via === 'jev' ? ' The prompt was sent to Jev (TypeSafe).' : ' Nothing was sent anywhere.'
  return `Would use ${describe(c.decision, c.note || undefined)}.${sent}${c.decision.p ? `\nJev: ${(Object.entries(c.decision.p) as [Route, number][]).map(([r, v]) => `${r} ${Math.round(v * 100)}%`).join(' · ')}` : ''}`
}

export async function routerCommand($: EngineInterface, options: PluginOptions, args: string): Promise<string> {
  await count($, options, 'commands', ROUTER_COMMAND)
  const raw = (args ?? '').trim()
  const word = raw.split(/\s+/)[0]?.toLowerCase() ?? ''
  if (word === 'on' || word === 'off') {
    await update($, override, () => word)
    await refreshLine($, options)
    return `Model router ${word === 'on' ? 'on' : 'off'}.\n${await statusText($, options)}`
  }
  if (word === 'explain') return explainText($, options, raw.slice(word.length).trim())
  if (word === '' || word === 'status') return statusText($, options)
  return `Unknown argument "${word}". ${USAGE}`
}

// ---- the hooks ----

export function registerRouter(on: On, options: PluginOptions): void {
  on('command.run', { command: ROUTER_COMMAND }, async ($, e) => ({ text: await routerCommand($, options, e.args ?? '') }))

  // What the submission was, so a finished job's notice is not taken for a new task. Used only where its text is the turn's.
  on('prompt.submit', async ($, e, next) => {
    submitted = { text: String(e.text ?? '').trim(), origin: String(e.origin?.kind ?? 'composer') }
    return next(e)
  })

  // Plan mode is a fact the settings hooks carry. The matcher keeps this hook to plan mode alone, beside the guard's own hook.
  on('classic.UserPromptSubmit', { permission_mode: /^plan$/ }, async ($, e, next) => {
    planPrompt = String((e as { prompt?: unknown }).prompt ?? '').trim()
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      try {
        await decideFor($, options, e.turnId, e.text, { signal: next.signal, remainingMs: next.budget.remainingMs })
      } catch {
        // a router that fails routes nothing, and the turn runs on the session's model
      }
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const held = e.agentId === undefined ? decisions.get(e.turnId) : undefined
    const model = held ? applyModel(e.model, held.model) : null
    if (!model) return yield* next(e)
    return yield* next({ ...e, model })
  })
}
