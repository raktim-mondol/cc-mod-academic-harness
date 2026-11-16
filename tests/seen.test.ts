import { expect, mock, test } from 'claude-code/testing'

import { seenFile, seenName } from '../hooks/seen'

// The record the hooks module leaves for the doctor (hooks/seen.ts). What the doctor makes of it is tested by tests/scripts/doctor.test.mjs.

test('the file name keeps a session id readable and drops what a path cannot hold', () => {
  expect(seenName('0a1b2c3d-4e5f-6789-abcd-ef0123456789')).toBe('0a1b2c3d-4e5f-6789-abcd-ef0123456789.json')
  expect(seenName('../../etc/passwd')).toBe('.._.._etc_passwd.json')
  expect(seenFile('/mod', '/home/u', 's1')).toBe('/mod/mod-seen/s1.json')
  expect(seenFile(undefined, '/home/u/', 's1')).toBe('/home/u/.local/share/cc-mod-academic-harness/home/mod-seen/s1.json')
  expect(seenFile('', undefined, 's1')).toBeNull()
})

function world(on: any, opts: { version?: unknown; failWrite?: boolean } = {}) {
  const writes: { path: string; text: string }[] = []
  mock.clock(on)
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'AH_MOD_HOME' ? '/mod' : e.name === 'HOME' ? '/home/u' : undefined }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/p' }))
  on('session.version', () => ({ value: opts.version ?? { version: '2.1.325', base: '2.1.325' } }))
  on('fs.exists', () => ({ value: false }))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    if (opts.failWrite) throw new Error('EACCES')
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  return { writes }
}

test('session start leaves a record with the session, the running Claude Code version and the time', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: false })
  expect(w.writes.length).toBe(1)
  expect(w.writes[0]!.path).toBe('/mod/mod-seen/sess-1.json')
  const rec = JSON.parse(w.writes[0]!.text)
  expect(rec).toMatchObject({ session: 'sess-1', version: '2.1.325', base: '2.1.325' })
  expect(typeof rec.at).toBe('number')
})

test('a record that cannot be written, or a version that cannot be read, never fails the start', async ($, on) => {
  world(on, { failWrite: true })
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: false })
  const r = await $.command.run({ command: 'academic', args: 'status', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(r.text).toContain('Research mode is')
})
