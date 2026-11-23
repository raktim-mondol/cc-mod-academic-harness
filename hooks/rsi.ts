import type { EngineInterface, On, PluginOptions } from 'claude-code'

import { projectOf, runEngine } from './guard'
import { clipFailure, clipInput, reduceBatch, rsiInteractive, rsiMode } from './rsi-core'

// The self-improvement loop (ah_rsi), the part that needs hooks of its own: what the tools returned.
//
// The guard's PostToolUse handler runs for the few tools that edit, and drops the result. The loop needs the outcome of every call (did it
// fail, what did it find). PostToolBatch fires once after all the calls of a step have resolved, so the loop is handed a step's calls in one
// process rather than one process a call; PostToolUseFailure covers the calls that failed. Both hand server/bin/ah-hook.mjs the calls, cut to
// a bounded size, on stdin: nothing is written to disk but what the loop derives (names, hashes, finding ids).
//
// The loop runs only when all of these hold, and otherwise these handlers do nothing at all, not even start a process:
//   - a person is at the prompt (a headless run is not recorded, and gets no lessons);
//   - the mode is not off (off is the default; the AH_RSI variable wins over the `rsi_mode` setting);
//   - the folder is an Academic Harness project (an ah.yaml above it).
// The loop's other two events, the prompt and the end of the turn, ride on the guard's own UserPromptSubmit and Stop calls. It is advisory: a
// failure here changes nothing about the turn.
//
// Helpers here take `$` as a parameter and call it in full: the engine reads this source statically and refuses an aliased `$`.

/** Whether the loop is on for this session: a person is at the prompt and the mode is not off. */
async function loopOn($: EngineInterface, options: PluginOptions): Promise<boolean> {
  if (!rsiInteractive()) return false
  return rsiMode(await $.env.get('AH_RSI'), options['rsi_mode']) !== 'off'
}

export function registerRsi(on: On, options: PluginOptions): void {
  on('classic.PostToolBatch', async ($, e, next) => {
    const downstream = await next(e)
    try {
      if (!(await loopOn($, options))) return downstream
      const cwd = e.cwd || (await $.session.cwd())
      if (!(await projectOf($, cwd))) return downstream
      const calls = reduceBatch(e.tool_calls)
      if (calls.length === 0) return downstream
      await runEngine($, options, 'rsi-batch', { session_id: e.session_id, cwd, tool_calls: calls })
    } catch {
      // the loop is advisory: nothing here may change the turn
    }
    return downstream
  })

  on('classic.PostToolUseFailure', async ($, e, next) => {
    const downstream = await next(e)
    try {
      if (e.is_interrupt === true) return downstream // an interrupted call is the person stopping it, not a tool failing
      if (!(await loopOn($, options))) return downstream
      const cwd = e.cwd || (await $.session.cwd())
      if (!(await projectOf($, cwd))) return downstream
      await runEngine($, options, 'rsi-fail', { session_id: e.session_id, cwd, tool_name: e.tool_name, tool_input: clipInput(e.tool_input), error: clipFailure(e.error) })
    } catch {
      // the loop is advisory
    }
    return downstream
  })
}
