import type { Register } from 'claude-code'

// Phase P0: an empty mod. Its only job is to show that it loaded, by putting an
// entry on the status line when a session starts. Later phases add research
// mode, the writing-engine guard and the interface (see IMPLEMENTATION_PLAN.md).
//
// One session.start hook only: the engine refuses two with no matcher.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.ui.status('academic-harness 0.1.0 loaded')
    return next(e)
  })
}
