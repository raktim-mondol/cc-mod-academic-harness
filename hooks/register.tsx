import type { Register } from 'claude-code'

import { registerApprovals } from './approvals'
import { registerGuard } from './guard'
import { startNotices } from './notices'
import { doctorText } from './doctor'
import { addSection, run, showStatus } from './mode'
import { registerTaskCommands, registerTasks } from './tasks'
import { openPane, registerUi, startUi } from './ui'

// P1: research mode. P3: the writing-engine guard and the author-only approvals. P4: completion notices. P5: the task commands,
// /fold, the status line and the pane. One session.start hook only: the engine refuses two with no matcher, so everything that must
// happen at start is called from it.
export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await showStatus($, options)
    await startNotices($, options, e.isInteractive === true)
    try {
      await $.command.register({ name: 'academic', description: 'Research mode and the pane: on, off, auto, status, doctor; bare opens the pane' })
    } catch {
      // A built-in or another plugin already has the name: carry on without the command.
    }
    await registerTaskCommands($)
    await startUi($, options, e.isInteractive === true)
    return next(e)
  })

  on('command.run', { command: 'academic' }, async ($, e) => {
    const word = (e.args ?? '').trim().toLowerCase()
    if (word === 'doctor' || word === 'doctor --online') return { text: await doctorText($, word) }
    const text = await run($, options, e.args)
    return { text: word === '' || word === 'pane' ? `${text}\n${await openPane($, options)}` : text }
  })

  registerTasks(on)
  registerUi(on)
  registerGuard(on, options)
  registerApprovals(on, options)

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { sections: await addSection($, options, composed.sections) }
  })
}
