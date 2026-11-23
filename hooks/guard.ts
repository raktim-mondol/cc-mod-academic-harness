import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, PluginOptions } from 'claude-code'

import { findProject } from './mode'
import {
  caughtReason,
  engineAnswered,
  failClosedReason,
  forTools,
  gateDecision,
  GUARDED_MATCH,
  parseEngineStdout,
  POST_MATCH,
  postToolPayload,
  preToolPayload,
  t3Mode,
  withFooter,
} from './guard-core'

// The writing-engine guard (P3). In a tree with an ah.yaml it runs the engine's `ah hook` for the four
// classic events, through server/bin/ah-hook.mjs:
//
//   UserPromptSubmit  paper-state card and findings baseline
//   PreToolUse        protected paths, unit-anchor loss, author-only shell commands  (fails closed)
//   PostToolUse       the post-edit note
//   Stop              keeps the turn going while this turn's edits introduced blockers, then hands off
//
// Outside an ah.yaml tree every hook returns at once and no process is started. A failing PreToolUse
// check refuses Write, Edit, MultiEdit, NotebookEdit and Bash and lets everything else through.
//
// Helpers here take `$` as a parameter and call it in full: the engine reads this source statically and
// refuses an aliased `$`.

const handedOff = atom({ plugin: 'academic-harness', key: 'handedOff' } as const, [] as string[])
const t3Steered = atom({ plugin: 'academic-harness', key: 't3Steered' } as const, [] as string[])

const HOOK_TIMEOUT_MS = 120_000

type Run = { exitCode: number; stdout: string; stderr: string }

/** The nearest ah.yaml folder at or above `cwd`. A found root is remembered; a miss is not, since ah_init can create one. */
const roots = new Map<string, string>()
export async function projectOf($: EngineInterface, cwd: string): Promise<string | null> {
  const hit = roots.get(cwd)
  if (hit && (await $.fs.exists(`${hit}/ah.yaml`))) return hit
  roots.delete(cwd)
  const found = await findProject($, cwd)
  if (found) roots.set(cwd, found)
  return found
}

/** Run `ah-hook.mjs <event>` with the payload on stdin. Rejects when the process cannot start or overruns. */
export async function runEngine($: EngineInterface, options: PluginOptions, event: string, payload: Record<string, unknown>): Promise<Run> {
  const env: Record<string, string> = { AH_T3_MODE: t3Mode(options['evidence_check']) }
  const rsi = String(options['rsi_mode'] ?? '').trim()
  if (rsi) env['AH_RSI_SETTING'] = rsi
  let model = ''
  try {
    model = await $.session.model()
  } catch {
    model = ''
  }
  if (model) env['AH_MODEL'] = model
  return $.process.run(['node', `${$.plugin.root}/server/bin/ah-hook.mjs`, event], {
    cwd: String(payload['cwd'] ?? ''),
    stdin: `${JSON.stringify(payload)}\n`,
    env,
    timeoutMs: HOOK_TIMEOUT_MS,
  })
}

function brief(r: Run): string {
  const text = (r.stderr || r.stdout || '').trim().replace(/\s+/g, ' ')
  return `the engine exited ${r.exitCode}${text ? `: ${text.slice(0, 140)}` : ''}`
}

export function registerGuard(on: On, options: PluginOptions): void {
  // PreToolUse: the call is the envelope { tool, tool_use_id, ...arguments }.
  on('classic.PreToolUse', { tool: GUARDED_MATCH }, async ($, e, next) => {
    const cwd = await $.session.cwd()
    if (!(await projectOf($, cwd))) return next(e)
    const payload = preToolPayload(e as Record<string, unknown>, { id: await $.session.id(), cwd })
    let r: Run
    try {
      r = await runEngine($, options, 'pre', payload)
    } catch (error) {
      return { deny: caughtReason(String(e.tool), error) }
    }
    if (!engineAnswered(r.exitCode, r.stdout)) return { deny: failClosedReason(String(e.tool), brief(r)) }
    const out = parseEngineStdout(r.stdout)
    if (out?.deny) return { deny: forTools(out.reason || 'blocked by the Academic Harness guard') }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: caughtReason(String(e.tool), next.error) }))

  on('classic.PostToolUse', { tool_name: POST_MATCH }, async ($, e, next) => {
    const downstream = await next(e)
    const cwd = e.cwd || (await $.session.cwd())
    if (!(await projectOf($, cwd))) return downstream
    let r: Run
    try {
      r = await runEngine($, options, 'post', { ...postToolPayload(e as Record<string, unknown>), cwd })
    } catch {
      return downstream // advisory: a note that could not be made must not stop the turn
    }
    if (!engineAnswered(r.exitCode, r.stdout)) return downstream
    const note = parseEngineStdout(r.stdout)?.additionalContext
    if (!note) return downstream
    return { ...downstream, additionalContext: [forTools(note), ...(downstream.additionalContext ?? [])] }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const downstream = await next(e)
    const cwd = e.cwd || (await $.session.cwd())
    if (!(await projectOf($, cwd))) return downstream
    await update($, handedOff, list => list.filter(s => s !== e.session_id))
    await update($, t3Steered, list => list.filter(s => s !== e.session_id))
    let r: Run
    try {
      r = await runEngine($, options, 'userprompt', { ...(e as Record<string, unknown>), cwd })
    } catch {
      return downstream
    }
    if (!engineAnswered(r.exitCode, r.stdout)) return downstream
    const card = parseEngineStdout(r.stdout)?.additionalContext
    if (!card) return downstream
    return { ...downstream, additionalContext: [...(downstream.additionalContext ?? []), withFooter(card)] }
  })

  on('classic.Stop', async ($, e, next) => {
    const downstream = await next(e)
    const cwd = e.cwd || (await $.session.cwd())
    if (!(await projectOf($, cwd))) return downstream
    const sid = e.session_id
    let r: Run
    try {
      r = await runEngine($, options, 'stop', { ...(e as Record<string, unknown>), cwd })
    } catch {
      return downstream
    }
    if (!engineAnswered(r.exitCode, r.stdout)) return downstream
    const decision = gateDecision(parseEngineStdout(r.stdout), {
      alreadyHandedOff: (await read($, handedOff)).includes(sid),
      alreadyT3: (await read($, t3Steered)).includes(sid),
    })
    if (decision.kind === 'none') return downstream
    if (decision.kind === 'handoff') await update($, handedOff, list => [...list, sid])
    if (decision.kind === 't3') await update($, t3Steered, list => [...list, sid])
    return { ...downstream, block: decision.text }
  })
}

export { failClosedReason }
