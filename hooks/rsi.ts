import type { On, PluginOptions } from 'claude-code'

import { projectOf, runEngine } from './guard'

// The self-improvement loop (ah_rsi), the part that needs a hook of its own: what each tool returned.
//
// The guard's PostToolUse handler runs for the few tools that edit, and drops the result. The loop needs the outcome of every tool
// (did it fail, what did it find), so this one runs for all of them, in an ah.yaml tree only, and hands server/bin/ah-hook.mjs the
// result, cut to a size the loop can read. The loop's other two events (the prompt, the end of the turn) ride on the guard's own
// UserPromptSubmit and Stop calls. It is advisory: a failure here changes nothing about the turn.

const MAX_RESPONSE_CHARS = 30_000

/** The tool's result as text, cut at MAX_RESPONSE_CHARS. */
export function clipResponse(response: unknown): string {
  let text: string
  if (typeof response === 'string') text = response
  else {
    try {
      text = JSON.stringify(response ?? '')
    } catch {
      text = String(response)
    }
  }
  return text.length > MAX_RESPONSE_CHARS ? text.slice(0, MAX_RESPONSE_CHARS) : text
}

export function registerRsi(on: On, options: PluginOptions): void {
  on('classic.PostToolUse', async ($, e, next) => {
    const downstream = await next(e)
    const cwd = e.cwd || (await $.session.cwd())
    if (!(await projectOf($, cwd))) return downstream
    try {
      await runEngine($, options, 'rsi-post', { ...(e as Record<string, unknown>), tool_response: clipResponse((e as Record<string, unknown>)['tool_response']), cwd })
    } catch {
      // the loop is advisory
    }
    return downstream
  })
}
