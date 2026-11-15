import type { Register } from 'claude-code'

import { registerApprovals } from './approvals'
import { registerGuard } from './guard'
import { startNotices } from './notices'
import { addSection, run, showStatus } from './mode'

// P1: research mode. P3: the writing-engine guard and the author-only approvals. Later phases add the
// interface (see IMPLEMENTATION_PLAN.md). One session.start hook only: the engine refuses two with no
// matcher, so everything that must happen at start is called from it.
export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await showStatus($, options)
    await startNotices($, options, e.isInteractive === true)
    try {
      await $.command.register({ name: 'academic', description: 'Research mode: on, off, auto or status' })
    } catch {
      // A built-in or another plugin already has the name: carry on without the command.
    }
    return next(e)
  })

  on('command.run', { command: 'academic' }, async ($, e) => ({ text: await run($, options, e.args) }))

  registerGuard(on, options)
  registerApprovals(on, options)

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { sections: await addSection($, options, composed.sections) }
  })
}
