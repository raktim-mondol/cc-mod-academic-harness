import type { On, PluginOptions } from 'claude-code'

import { projectOf, runEngine } from './guard'
import { clipInput, clipResponse } from './rsi-core'

// The self-improvement loop (ah_rsi), the part that needs a hook of its own: what each tool returned.
//
// The guard's PostToolUse handler runs for the few tools that edit, and drops the result. The loop needs the outcome of every tool
// (did it fail, what did it find), so this one runs for all of them, in an ah.yaml tree only, and hands server/bin/ah-hook.mjs the
// result, cut to a size the loop can read. The loop's other two events (the prompt, the end of the turn) ride on the guard's own
// UserPromptSubmit and Stop calls. It is advisory: a failure here changes nothing about the turn.

export function registerRsi(on: On, options: PluginOptions): void {
  on('classic.PostToolUse', async ($, e, next) => {
    const downstream = await next(e)
    try {
      const cwd = e.cwd || (await $.session.cwd())
      if (!(await projectOf($, cwd))) return downstream
      const event = e as Record<string, unknown>
      await runEngine($, options, 'rsi-post', { ...event, tool_input: clipInput(event['tool_input']), tool_response: clipResponse(event['tool_response']), cwd })
    } catch {
      // the loop is advisory: nothing here may change the turn
    }
    return downstream
  })
}
