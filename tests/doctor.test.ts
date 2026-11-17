import { expect, test } from 'claude-code/testing'

// /academic doctor (P6). Nothing sits beneath the plugin in a test: the tool.call hook stands for the running `ah` server, process.run for
// server/bin/ah-doctor.mjs. The report's own content is tested by tests/scripts/doctor.test.mjs.

const DOCTOR = 'mcp__plugin_academic-harness_ah__doctor'

type Mode = { tool: 'answers' | 'absent' | 'error'; process?: 'answers' | 'fails' }

function world(on: any, mode: Mode) {
  const calls: Record<string, unknown>[] = []
  const runs: string[][] = []
  on('session.cwd', () => ({ value: '/p' }))
  on('fs.exists', () => ({ value: false }))
  on('ui.status', () => ({ value: undefined }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('tool.call', (_: unknown, e: Record<string, unknown>) => {
    calls.push(e)
    if (mode.tool === 'absent') throw new Error(`unknown tool ${String(e['tool'])}`)
    if (mode.tool === 'error') return { isError: true, result: 'boom', text: 'the server failed' }
    return { result: {}, text: '✔ Node.js: v24\n✔ Core: Academic Harness 0.54.1, in the plugin folder\n\nReady.' }
  })
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    runs.push(e.argv)
    if (mode.process === 'fails') throw new Error('could not start')
    return { value: { exitCode: 0, stdout: '✘ Core: core/ is missing\n    fix: node scripts/setup.mjs\n\n1 thing the mod cannot work without.\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { calls, runs }
}

const academic = ($: any, args: string) => $.command.run({ command: 'academic', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
const start = ($: any) => $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: false })

test('doctor asks the running server and shows its report', async ($, on) => {
  const w = world(on, { tool: 'answers' })
  await start($)
  const r = await academic($, 'doctor')
  expect(r.text).toContain('Core: Academic Harness 0.54.1, in the plugin folder')
  expect(r.text).toContain('Ready.')
  expect(w.calls.length).toBe(1)
  expect(w.calls[0]!['tool']).toBe(DOCTOR)
  expect(w.calls[0]!['online']).toBeUndefined()
  expect(w.runs.length).toBe(0)
})

test('there is no --online any more: nothing asks GitHub whether anything has moved, and the word is not passed on', async ($, on) => {
  const w = world(on, { tool: 'answers' })
  await start($)
  await academic($, 'doctor --online')
  expect(w.calls.length).toBe(1)
  expect(w.calls[0]!['online']).toBeUndefined()
})

test('with no server the report comes from a fresh process, and says what it cannot see', async ($, on) => {
  const w = world(on, { tool: 'absent', process: 'answers' })
  await start($)
  const r = await academic($, 'doctor')
  expect(w.runs.length).toBe(1)
  expect(w.runs[0]!.some(a => a.endsWith('server/bin/ah-doctor.mjs'))).toBe(true)
  expect(r.text).toContain("core/ is missing")
  expect(r.text).toContain('node scripts/setup.mjs')
  expect(r.text).toContain('keys saved in the plugin\'s options are not visible')
})

test('a server that answers with an error is treated as absent', async ($, on) => {
  const w = world(on, { tool: 'error', process: 'answers' })
  await start($)
  const r = await academic($, 'doctor')
  expect(w.runs.length).toBe(1)
  expect(r.text).toContain('fresh process')
})

test('when nothing answers the person is told what to run', async ($, on) => {
  world(on, { tool: 'absent', process: 'fails' })
  await start($)
  const r = await academic($, 'doctor')
  expect(r.text).toContain('could not run')
  expect(r.text).toContain('node scripts/setup.mjs')
})

test('the other /academic words are not taken for doctor', async ($, on) => {
  const w = world(on, { tool: 'answers' })
  await start($)
  const r = await academic($, 'status')
  expect(r.text).toContain('Research mode is')
  expect(w.calls.length).toBe(0)
})
