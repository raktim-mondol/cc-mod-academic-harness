import type { Register } from 'claude-code'

import { registerApprovals } from './approvals'
import { registerGuard } from './guard'
import { startNotices } from './notices'
import { doctorText, usageText } from './doctor'
import { addSection, run, showStatus } from './mode'
import { recordSeen } from './seen'
import { registerRsi } from './rsi'
import { setRsiInteractive } from './rsi-core'
import { registerRouter, registerRouterCommand, startRouter } from './router'
import { registerTaskCommands, registerTasks } from './tasks'
import { openPane, registerUi, startUi } from './ui'
import { count, registerUsage } from './usage'

// P1: research mode. P3: the writing-engine guard and the author-only approvals. P4: completion notices. P5: the task commands,
// /fold, the status line and the pane. The model router (router.ts): the model each prompt runs on.
// One session.start hook only: the engine refuses two with no matcher, so everything that must happen at start is called from it.
export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    setRsiInteractive(e.isInteractive === true) // first, so nothing below can leave it unset: the loop never runs in a headless session
    await startRouter($, options)
    await showStatus($, options)
    await recordSeen($)
    await startNotices($, options, e.isInteractive === true)
    try {
      await $.command.register({ name: 'academic', description: 'Research mode and the pane: on, off, auto, status, doctor, usage; bare opens the pane' })
    } catch {
      // A built-in or another plugin already has the name: carry on without the command.
    }
    await registerTaskCommands($)
    await registerRouterCommand($)
    await startUi($, options, e.isInteractive === true)
    return next(e)
  })

  on('command.run', { command: 'academic' }, async ($, e) => {
    const word = (e.args ?? '').trim().toLowerCase()
    await count($, options, 'commands', 'academic')
    if (/^doctor(\s|$)/.test(word)) return { text: await doctorText($, word) }
    if (/^usage(\s|$)/.test(word)) return { text: await usageText($, word) }
    const text = await run($, options, e.args)
    return { text: word === '' || word === 'pane' ? `${text}\n${await openPane($, options)}` : text }
  })

  registerTasks(on, options)
  registerRouter(on, options)
  registerUsage(on, options)
  registerUi(on)
  registerGuard(on, options)
  registerApprovals(on, options)
  registerRsi(on, options)

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { sections: await addSection($, options, composed.sections) }
  })
}
