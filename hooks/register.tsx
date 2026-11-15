import type { Register } from 'claude-code'

import { addSection, run, showStatus } from './mode'

// Phase P1: research mode. Later phases add the writing-engine guard and the interface
// (see IMPLEMENTATION_PLAN.md). One session.start hook only: the engine refuses two with no
// matcher, so everything that must happen at start is called from it.
export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await showStatus($, options)
    try {
      await $.command.register({ name: 'academic', description: 'Research mode: on, off, auto or status' })
    } catch {
      // A built-in or another plugin already has the name: carry on without the command.
    }
    return next(e)
  })

  on('command.run', { command: 'academic' }, async ($, e) => ({ text: await run($, options, e.args) }))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { sections: await addSection($, options, composed.sections) }
  })
}
