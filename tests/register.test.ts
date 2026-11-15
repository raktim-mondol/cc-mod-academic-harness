import { expect, test } from 'claude-code/testing'

// P0: the mod's one visible behaviour is a status-line entry at session start.
test('session.start puts the loaded entry on the status line', async ($, on) => {
  const shown: (string | undefined)[] = []
  // Nothing sits beneath the plugin: each hook here stands for the engine.
  on('ui.status', (_, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(shown).toEqual(['academic-harness 0.1.0 loaded'])
})
