import { expect, mock, test } from 'claude-code/testing'

import { observe, usageFile, usageOn } from '../hooks/usage'

// Usage counts, the hooks module's part (hooks/usage.ts): which of the plugin's skills and agents the model starts and which commands run.
// Names and counts only. The server's part and the report are tested by tests/scripts/usage.test.mjs.

const DOCTOR = 'mcp__plugin_academic-harness_ah__doctor'

test('only the plugin\'s own skills and agents are observed, by the name the Skill and Agent tools give them', () => {
  expect(observe({ tool: 'Skill', skill: 'academic-harness:literature-review' })).toEqual({ kind: 'skills', name: 'literature-review' })
  expect(observe({ tool: 'Agent', subagent_type: 'academic-harness:code-reviewer', prompt: 'a long private prompt' })).toEqual({ kind: 'agents', name: 'code-reviewer' })
  expect(observe({ tool: 'Task', subagent_type: 'academic-harness:data-validator' })).toEqual({ kind: 'agents', name: 'data-validator' })
  expect(observe({ tool: 'Skill', skill: 'bio-research:start' })).toBeNull()
  expect(observe({ tool: 'Skill', skill: 'literature-review' })).toBeNull()
  expect(observe({ tool: 'Skill', skill: 'academic-harness:' })).toBeNull()
  expect(observe({ tool: 'Agent', subagent_type: 'Explore' })).toBeNull()
  expect(observe({ tool: 'Write', file_path: '/p/a.tex' })).toBeNull()
})

test('the file and the setting', () => {
  expect(usageFile('/mod', '/home/u', 'sess-1')).toBe('/mod/usage/hook-sess-1.json')
  expect(usageFile(undefined, '/home/u/', 's')).toBe('/home/u/.local/share/cc-mod-academic-harness/home/usage/hook-s.json')
  expect(usageFile('', undefined, 's')).toBeNull()
  expect(usageOn({})).toBe(true)
  expect(usageOn({ usage_counts: 'on' })).toBe(true)
  expect(usageOn({ usage_counts: 'OFF' })).toBe(false)
})

function world(on: any, opts: { failWrite?: boolean; doctor?: 'answers' | 'absent' } = {}) {
  const writes: { path: string; text: string }[] = []
  const toolCalls: Record<string, unknown>[] = []
  mock.clock(on)
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'AH_MOD_HOME' ? '/mod' : e.name === 'HOME' ? '/home/u' : undefined }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/p' }))
  on('session.messages', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    if (opts.failWrite) throw new Error('EACCES')
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('tool.call', (_: unknown, e: Record<string, unknown>) => {
    toolCalls.push(e)
    if (e['tool'] === DOCTOR) {
      if (opts.doctor === 'absent') throw new Error('unknown tool')
      return { result: {}, text: 'Usage since 2026-11-16 ...' }
    }
    return { result: 'RAN' }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'Usage from disk', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('classic.PostToolUse', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.Stop', () => ({}))
  on('tool.check', () => ({ decision: 'allow' }))
  return { writes, toolCalls }
}
const last = (w: { writes: { text: string }[] }) => JSON.parse(w.writes.at(-1)!.text)
const run = ($: any, command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

test('the plugin\'s skill is counted each time it is started, and the call goes on unchanged', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: false })
  w.writes.length = 0
  const r = await $.tool.call({ tool: 'Skill', skill: 'academic-harness:literature-review', args: 'a private topic' })
  expect(r).toMatchObject({ result: 'RAN' })
  await $.tool.call({ tool: 'Skill', skill: 'academic-harness:literature-review' })
  expect(w.writes.length).toBe(2)
  expect(w.writes.at(-1)!.path).toBe('/mod/usage/hook-sess-1.json')
  const rec = last(w)
  expect(rec).toMatchObject({ v: 1, id: 'hook-sess-1', skills: { 'literature-review': { calls: 2, errors: 0 } }, agents: {}, commands: {}, tools: {} })
  expect(JSON.stringify(rec)).not.toContain('private')
})

test('agents are counted; other plugins\' skills and built-in agents are not', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: false })
  w.writes.length = 0
  await $.tool.call({ tool: 'Agent', description: 'review', subagent_type: 'academic-harness:code-reviewer', prompt: 'x' })
  await $.tool.call({ tool: 'Agent', description: 'look', subagent_type: 'Explore', prompt: 'x' })
  await $.tool.call({ tool: 'Skill', skill: 'bio-research:start' })
  expect(w.writes.length).toBe(1)
  expect(last(w).agents['code-reviewer'].calls).toBe(1)
})

test('commands are counted, by their own name', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: false })
  w.writes.length = 0
  await run($, 'ah-papers', '')
  await run($, 'fold', '')
  await run($, 'academic', 'status')
  const rec = last(w)
  expect(Object.keys(rec.commands).sort()).toEqual(['academic', 'ah-papers', 'fold'])
  expect(rec.commands['ah-papers'].calls).toBe(1)
})

test('with the setting off nothing is written', { options: { usage_counts: 'off' } }, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: false })
  await $.tool.call({ tool: 'Skill', skill: 'academic-harness:literature-review' })
  await run($, 'academic', 'status')
  expect(w.writes.filter(x => x.path.includes('/usage/'))).toEqual([])
})

test('a count that cannot be written never fails the call or the command', async ($, on) => {
  world(on, { failWrite: true })
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: false })
  const r = await $.tool.call({ tool: 'Skill', skill: 'academic-harness:literature-review' })
  expect(r).toMatchObject({ result: 'RAN' })
  const c = await run($, 'academic', 'status')
  expect(c.text).toContain('Research mode is')
})

test('/academic usage asks the server, with --all when given, and falls back to the script on disk', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: false })
  const r = await run($, 'academic', 'usage')
  expect(r.text).toContain('Usage since 2026-11-16')
  const usageCalls = w.toolCalls.filter(c => c['tool'] === DOCTOR)
  expect(usageCalls[0]).toMatchObject({ usage: true })
  expect(usageCalls[0]!['all']).toBeUndefined()
  await run($, 'academic', 'usage --all')
  expect(w.toolCalls.filter(c => c['tool'] === DOCTOR)[1]).toMatchObject({ usage: true, all: true })
})

test('/academic usage without the server reads the counts from disk and says what it cannot list', async ($, on) => {
  world(on, { doctor: 'absent' })
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: false })
  const r = await run($, 'academic', 'usage')
  expect(r.text).toContain('Usage from disk')
  expect(r.text).toContain('tools that were never called are not listed')
})
