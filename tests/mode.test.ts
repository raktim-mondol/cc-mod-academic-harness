import { expect, test } from 'claude-code/testing'

// Research mode (P1). Nothing sits beneath the plugin in a test: each hook below stands for the
// engine. A call on `$` is answered `{ value }`; an event by its own result.

function engine(on: any, opts: { cwd: string; files?: string[] }) {
  const files = new Set(opts.files ?? [])
  const status: (string | undefined)[] = []
  const commands: string[] = []
  on('session.cwd', () => ({ value: opts.cwd }))
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: files.has(e.path) }))
  on('ui.status', (_: unknown, e: { text: string | undefined }) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('command.register', (_: unknown, e: { name: string }) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base prompt', scope: 'shared' }] }))
  return { status, commands }
}

const ids = (r: { sections: readonly { id: string }[] }) => r.sections.map(s => s.id)

// $.prompt.compose in a test takes the whole input of the event.
const INPUT = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as const
const compose = ($: any) => $.prompt.compose(INPUT)
// $.command.run in a test takes the whole input of its event.
const academic = ($: any, args = '') =>
  $.command.run({ command: 'academic', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

test('outside an ah.yaml tree, auto mode is off: no section, status says off', async ($, on) => {
  const seen = engine(on, { cwd: '/home/u/notes' })
  await $.session.start({ cwd: '/home/u/notes', surface: 'terminal', isInteractive: true })

  expect(seen.status).toEqual(['research mode off'])
  expect(seen.commands).toEqual(['academic', 'ah-research', 'ah-review', 'ah-papers', 'ah-references', 'ah-write', 'ah-analyze', 'ah-hypotheses', 'fold'])
  expect(ids(await compose($))).toEqual(['intro'])
})

test('inside an ah.yaml tree, auto mode is on, even from a subfolder', async ($, on) => {
  const seen = engine(on, { cwd: '/home/u/paper/sections/intro', files: ['/home/u/paper/ah.yaml'] })
  await $.session.start({ cwd: '/home/u/paper/sections/intro', surface: 'terminal', isInteractive: true })

  expect(seen.status).toEqual(['research mode on'])
  const composed = await compose($)
  expect(ids(composed)).toEqual(['intro', 'academic-harness:research'])
  expect(composed.sections[1]?.scope).toBe('session')
})

test('the plugin folder replaces the placeholder in the section text', async ($, on) => {
  engine(on, { cwd: '/p', files: ['/p/ah.yaml'] })
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })

  const text = (await compose($)).sections.find((s: { id: string }) => s.id === 'academic-harness:research')?.text ?? ''
  expect(text.length).toBeGreaterThan(10_000)
  expect(text).not.toContain('{{PLUGIN_ROOT}}')
  expect(text).toContain('/upstream/skills/')
})

test('/academic on adds the section anywhere, off removes it, auto goes back to following ah.yaml', async ($, on) => {
  const seen = engine(on, { cwd: '/home/u/notes' })
  await $.session.start({ cwd: '/home/u/notes', surface: 'terminal', isInteractive: true })

  const turnedOn = await academic($, 'on')
  expect(turnedOn.text).toContain('Research mode is on (set with /academic)')
  expect(ids(await compose($))).toContain('academic-harness:research')

  await academic($, 'off')
  expect(ids(await compose($))).toEqual(['intro'])

  const auto = await academic($, 'auto')
  expect(auto.text).toContain('off (auto: no ah.yaml here)')
  expect(seen.status.at(-1)).toBe('research mode off')
})

test('/academic off wins inside an ah.yaml tree', async ($, on) => {
  engine(on, { cwd: '/p', files: ['/p/ah.yaml'] })
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await academic($, 'off')

  expect(ids(await compose($))).toEqual(['intro'])
})

test('/academic status and an unknown word change nothing', async ($, on) => {
  engine(on, { cwd: '/home/u/notes' })
  await $.session.start({ cwd: '/home/u/notes', surface: 'terminal', isInteractive: true })

  const status = await academic($)
  expect(status.text).toContain('Research mode is off')

  const bad = await academic($, 'maybe')
  expect(bad.text).toContain('Unknown argument "maybe"')
  expect(bad.text).toContain('Usage: /academic [on | off | auto | status | pane]')
  expect(ids(await compose($))).toEqual(['intro'])
})

test('the research_mode setting is followed until /academic overrides it', { options: { research_mode: 'on' } }, async ($, on) => {
  engine(on, { cwd: '/home/u/notes' })
  await $.session.start({ cwd: '/home/u/notes', surface: 'terminal', isInteractive: true })

  expect(ids(await compose($))).toContain('academic-harness:research')
  const r = await academic($, 'status')
  expect(r.text).toContain('on (from the research_mode setting)')

  await academic($, 'off')
  expect(ids(await compose($))).toEqual(['intro'])
})

test('the setting off keeps an ah.yaml tree off', { options: { research_mode: 'off' } }, async ($, on) => {
  engine(on, { cwd: '/p', files: ['/p/ah.yaml'] })
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })

  expect(ids(await compose($))).toEqual(['intro'])
})

test('a taken command name does not stop session start', async ($, on) => {
  const status: (string | undefined)[] = []
  on('session.cwd', () => ({ value: '/x' }))
  on('fs.exists', () => ({ value: false }))
  on('ui.status', (_: unknown, e: { text: string | undefined }) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('command.register', () => {
    throw new Error('command "academic" already exists')
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
  expect(status).toEqual(['research mode off'])
})

