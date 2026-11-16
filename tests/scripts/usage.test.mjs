// Usage counts (server/src/usage.mjs and its wiring): what is recorded and what never is, how files add up, the report, the host that counts its
// calls, the doctor's line, and that the hooks module's files and command list agree with the server's.
import '../helpers/ts-resolve.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { Registry } from '../../server/src/context.mjs'
import { diagnose } from '../../server/src/doctor.mjs'
import { doctorTool } from '../../server/src/doctortool.mjs'
import { hostOver } from '../../server/src/host.mjs'
import { listedAgents, listedSkills } from '../../server/src/skills-list.mjs'
import { createUsage, formatReport, KINDS, KNOWN_COMMANDS, MAX_NAMES, readUsage, summarize, summaryLine, usageDir, usageEnabled } from '../../server/src/usage.mjs'

const hooks = await import('../../hooks/usage.ts')
const tasks = await import('../../hooks/tasks-core.ts')
const scratch = join(homedir(), '.cache', 'ah-test-homes')
mkdirSync(scratch, { recursive: true })
const root = mkdtempSync(join(scratch, 'usage-'))
after(() => rmSync(root, { recursive: true, force: true }))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const read = file => JSON.parse(readFileSync(file, 'utf8'))

describe('the recorder', () => {
  test('a use is counted with its failures and its time; the file is written on flush, whole, with no temporary left', () => {
    const dir = join(root, 'a')
    let t = 1000
    const u = createUsage({ dir, id: 'srv-1', now: () => t++, flushMs: 60_000 })
    u.record('tools', 'literature_search')
    u.record('tools', 'literature_search', { error: true })
    u.record('skills', 'citation-management')
    assert.equal(existsSync(dir), false, 'nothing is written before a flush')
    u.flush()
    const d = read(join(dir, 'srv-1.json'))
    assert.equal(d.v, 1)
    // the clock ticks once for each of startedAt and updatedAt (1000, 1001), then once per use
    assert.deepEqual(d.tools.literature_search, { calls: 2, errors: 1, last: 1003 })
    assert.equal(d.skills['citation-management'].calls, 1)
    assert.deepEqual(readdirSync(dir), ['srv-1.json'])
    u.flush()
    assert.equal(readdirSync(dir).length, 1, 'a flush with nothing new writes nothing')
  })
  test('the file is written by itself a little after the last change', async () => {
    const dir = join(root, 'b')
    const u = createUsage({ dir, id: 'srv-2', flushMs: 30 })
    u.record('commands', 'ah-papers')
    await sleep(120)
    assert.equal(read(join(dir, 'srv-2.json')).commands['ah-papers'].calls, 1)
  })
  test('a name is cleaned, an unknown kind or an empty name is ignored, and a file cannot grow without bound', () => {
    const u = createUsage({ dir: join(root, 'c'), id: 'srv-3', flushMs: 60_000 })
    u.record('tools', `  evil\u0000name\n${'x'.repeat(200)}`)
    u.record('nonsense', 'a')
    u.record('tools', '')
    u.record('tools', 42)
    assert.deepEqual(Object.keys(u.data.tools).length, 1)
    const [name] = Object.keys(u.data.tools)
    assert.ok(name.length <= 80 && !/[\u0000-\u001f]/.test(name))
    for (let i = 0; i < MAX_NAMES + 20; i++) u.record('skills', `s${i}`)
    assert.equal(Object.keys(u.data.skills).length, MAX_NAMES)
    u.record('skills', 's0')
    assert.equal(u.data.skills.s0.calls, 2, 'a name already kept still counts')
  })
  test('a folder that cannot be written is not an error', () => {
    const file = join(root, 'not-a-folder')
    writeFileSync(file, 'x')
    const u = createUsage({ dir: join(file, 'usage'), id: 'srv-4', flushMs: 60_000 })
    u.record('tools', 'a')
    assert.doesNotThrow(() => u.flush())
  })
  test('the switches', () => {
    assert.equal(usageEnabled({}), true)
    assert.equal(usageEnabled({ AH_USAGE_SETTING: 'on' }), true)
    assert.equal(usageEnabled({ AH_USAGE_SETTING: 'off' }), false)
    assert.equal(usageEnabled({ AH_USAGE_SETTING: ' OFF ' }), false)
    assert.equal(usageEnabled({ AH_USAGE: '0' }), false)
    assert.equal(usageEnabled({ AH_USAGE: '1', AH_USAGE_SETTING: '' }), true)
  })
})

describe('adding the files up', () => {
  const dir = join(root, 'sum')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'srv-a.json'), JSON.stringify({ v: 1, startedAt: 100, updatedAt: 500, tools: { a: { calls: 3, errors: 1, last: 400 } }, skills: {}, agents: {}, commands: {} }))
  writeFileSync(join(dir, 'srv-b.json'), JSON.stringify({ v: 1, startedAt: 50, updatedAt: 900, tools: { a: { calls: 2, errors: 0, last: 800 }, b: { calls: 1, errors: 0, last: 10 } }, skills: { s: { calls: 4, errors: 0, last: 5 } }, agents: {}, commands: {} }))
  writeFileSync(join(dir, 'hook-x.json'), JSON.stringify({ v: 1, startedAt: 70, updatedAt: 600, tools: {}, skills: { s: { calls: 1, errors: 0, last: 600 } }, agents: { g: { calls: 2, errors: 0, last: 1 } }, commands: { fold: { calls: 1, errors: 0, last: 2 } } }))
  writeFileSync(join(dir, 'broken.json'), '{not json')
  writeFileSync(join(dir, 'odd.json'), '"a string"')
  writeFileSync(join(dir, 'readme.txt'), 'ignored')

  test('counts and times are summed across writers; a damaged or foreign file is skipped', () => {
    const u = readUsage(dir)
    assert.equal(u.files, 3)
    assert.deepEqual([u.since, u.last], [50, 900])
    assert.deepEqual(u.tools.a, { calls: 5, errors: 1, last: 800 })
    assert.equal(u.skills.s.calls, 5)
    assert.equal(u.agents.g.calls, 2)
    assert.equal(u.commands.fold.calls, 1)
  })
  test('a missing folder reads as nothing', () => {
    assert.deepEqual(readUsage(join(root, 'nowhere')), { files: 0, since: null, last: null, tools: {}, skills: {}, agents: {}, commands: {} })
  })
  test('used and never used, most used first, with what was counted but is not in the list apart', () => {
    const s = summarize(readUsage(dir), { tools: ['a', 'b', 'c', 'd'], skills: ['s', 't'] })
    assert.deepEqual(s.tools.used.map(e => e.name), ['a', 'b'])
    assert.deepEqual(s.tools.never, ['c', 'd'])
    assert.equal(s.tools.calls, 6)
    assert.deepEqual(s.skills.never, ['t'])
    assert.equal(s.agents.never, null, 'with no list, nothing is called unused')
    assert.deepEqual(s.agents.used.map(e => e.name), ['g'])
    const withOther = summarize(readUsage(dir), { tools: ['a'] })
    assert.deepEqual(withOther.tools.other.map(e => e.name), ['b'])
  })
})

describe('the report', () => {
  const dir = join(root, 'rep')
  mkdirSync(dir, { recursive: true })
  const names = Array.from({ length: 60 }, (_, i) => `tool_${String(i).padStart(2, '0')}`)
  writeFileSync(join(dir, 'srv-a.json'), JSON.stringify({ v: 1, startedAt: Date.UTC(2026, 10, 16), updatedAt: Date.UTC(2026, 10, 17), tools: { tool_00: { calls: 9, errors: 2, last: 1 }, tool_01: { calls: 1, errors: 0, last: 1 } }, skills: {}, agents: {}, commands: {} }))
  const known = { tools: names, skills: ['one', 'two'], agents: [], commands: KNOWN_COMMANDS }
  test('says what was used, what never was, and that nothing leaves the machine', () => {
    const text = formatReport(readUsage(dir), known)
    assert.match(text, /^Usage since 2026-11-16 \(last 2026-11-17; 1 writer file\)\. Names and counts only; nothing leaves this machine\./)
    assert.match(text, /Tools: 10 uses, 2 failed; 2 of 60 tools used/)
    assert.match(text, /most used: tool_00 9 \(2 failed\) · tool_01 1/)
    assert.match(text, /never used \(58\): tool_02, /)
    assert.match(text, /and 18 more \(all of them: --all\)/, 'the never-used list is cut at 40')
    assert.match(text, /Skills: 0 uses; 0 of 2 skills used\n {2}never used \(2\): one, two/)
    assert.match(text, /not a verdict/)
  })
  test('--all lists every name', () => {
    const text = formatReport(readUsage(dir), known, { all: true })
    assert.ok(text.includes('tool_59'))
    assert.doesNotMatch(text, /more \(all of them/)
  })
  test('with nothing counted it says so; the doctor line is short and points here', () => {
    assert.match(formatReport(readUsage(join(root, 'empty')), known), /^No usage has been counted yet/)
    assert.match(summaryLine(readUsage(join(root, 'empty'))), /^no counts yet/)
    assert.match(summaryLine(readUsage(dir), known), /^since 2026-11-16: 10 tool calls across 2 tools; 58 of 60 tools never called; 0 of 2 skills used\. \/academic usage lists/)
  })
  test('no argument, path or prompt can be in it: only names and numbers are kept at all', () => {
    const u = createUsage({ dir: join(root, 'priv'), id: 'srv-p', flushMs: 60_000 })
    u.record('tools', 'literature_search')
    u.flush()
    const raw = readFileSync(join(root, 'priv', 'srv-p.json'), 'utf8')
    assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['agents', 'commands', 'id', 'skills', 'startedAt', 'tools', 'updatedAt', 'v'])
  })
})

describe('the host counts its calls', () => {
  function host(extra = {}) {
    const registry = new Registry()
    registry.register({ name: 'fine', execute: async () => 'ok' })
    registry.register({ name: 'broken', execute: async () => { throw new Error('boom') } })
    registry.register({ name: 'skill_load', execute: async args => `loaded ${args.name}` })
    const dir = join(root, `host-${Math.random().toString(36).slice(2, 8)}`)
    const usage = createUsage({ dir, id: 'srv-h', flushMs: 60_000 })
    return { h: hostOver(registry, { env: { AH_MOD_HOME: root, ...extra }, usage }), dir, usage }
  }
  test('each call, whether it failed, a skill read on demand by name; an unknown tool is not a tool', async () => {
    const { h, dir } = host()
    await h.call('fine', { query: 'a private question' })
    await h.call('fine', {})
    await h.call('broken', { path: '/secret/thing.pdf' })
    await h.call('skill_load', { name: 'gget' })
    await h.call('no_such_tool', {})
    await h.dispose()
    const d = read(join(dir, 'srv-h.json'))
    assert.deepEqual(d.tools.fine, { calls: 2, errors: 0, last: d.tools.fine.last })
    assert.equal(d.tools.broken.errors, 1)
    assert.equal(d.tools.skill_load.calls, 1)
    assert.equal(d.skills.gget.calls, 1)
    assert.equal(d.tools.no_such_tool, undefined)
    const raw = readFileSync(join(dir, 'srv-h.json'), 'utf8')
    assert.ok(!raw.includes('private question') && !raw.includes('/secret/'), 'arguments are never kept')
  })
  test('a host with no recorder counts nothing and works as before', async () => {
    const registry = new Registry()
    registry.register({ name: 'fine', execute: async () => 'ok' })
    const h = hostOver(registry, { env: { AH_MOD_HOME: root } })
    assert.equal(h.usage, null)
    assert.equal((await h.call('fine', {})).isError, undefined)
  })
})

describe('the doctor', () => {
  const home = join(root, 'doc-home')
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, AH_MOD_HOME: home }
  mkdirSync(usageDir(home), { recursive: true })
  writeFileSync(join(usageDir(home), 'srv-d.json'), JSON.stringify({ v: 1, startedAt: Date.UTC(2026, 10, 16), updatedAt: Date.UTC(2026, 10, 16), tools: { fine: { calls: 3, errors: 0, last: 1 } }, skills: {}, agents: {}, commands: {} }))

  test('the tool shows the report with the tools this server offers, and --all through `all`', async () => {
    const tool = doctorTool({ env, served: () => ['fine', 'never_called'] })
    assert.ok(tool.parameters.usage && tool.parameters.all)
    const text = await tool.execute({ usage: true })
    assert.match(text, /Tools: 3 uses; 1 of 2 tools used/)
    assert.match(text, /never used \(1\): never_called/)
    assert.match(text, new RegExp(`Skills: 0 uses; 0 of ${listedSkills().size} skills used`))
    assert.match(text, new RegExp(`Agents: 0 uses; 0 of ${listedAgents().size} agents used`))
  })
  test('it flushes this server\'s own counts first, so a report includes the call just made', async () => {
    let flushed = 0
    await doctorTool({ env, flush: () => { flushed++ } }).execute({ usage: true })
    assert.equal(flushed, 1)
  })
  test('off: the report says so and still shows what was kept earlier', async () => {
    const text = await doctorTool({ env: { ...env, AH_USAGE: '0' } }).execute({ usage: true })
    assert.match(text, /^Usage counting is off .*nothing new is counted\. Counts kept earlier/)
    assert.match(text, /Tools: 3 uses/)
  })
  test('the report has one line, with the count of tools never called when the server says which it offers', async () => {
    const clone = join(root, 'doc-clone')
    mkdirSync(clone, { recursive: true })
    const withServed = await diagnose({ env, root: clone, upstream: join(clone, 'none'), home, served: ['fine', 'a', 'b'] })
    assert.match(withServed.checks.find(c => c.id === 'usage').detail, /^since 2026-11-16: 3 tool calls across 1 tool; 2 of 3 tools never called; 0 of \d+ skills used/)
    const off = await diagnose({ env: { ...env, AH_USAGE_SETTING: 'off' }, root: clone, upstream: join(clone, 'none'), home })
    assert.match(off.checks.find(c => c.id === 'usage').detail, /^off \(the usage_counts setting/)
  })
  test('without a server, the script reads the same counts and says what it cannot list', () => {
    const out = execFileSync(process.execPath, [join(import.meta.dirname, '..', '..', 'server', 'bin', 'ah-doctor.mjs'), '--usage'], { env, encoding: 'utf8' })
    assert.match(out, /Tools: 3 uses\n {2}most used: fine 3/)
    assert.doesNotMatch(out, /Tools:.*\n.*never used/, 'the tools a server offers are not known without it')
  })
})

describe('the hooks module and the server agree', () => {
  test('the commands the server lists are the ones the hooks module registers', () => {
    const registered = new Set([...Object.values(tasks.TASK_COMMANDS), tasks.WATCH_COMMAND, 'academic', 'fold'])
    assert.deepEqual([...KNOWN_COMMANDS].sort(), [...registered].sort())
  })
  test('a file the hooks module writes is read by the server, and its kinds are the server\'s', () => {
    assert.deepEqual(KINDS, ['tools', 'skills', 'agents', 'commands'])
    const dir = join(root, 'hookfile')
    mkdirSync(dir, { recursive: true })
    const file = hooks.usageFile(root, undefined, 'sess-9')
    assert.equal(file, `${root}/usage/hook-sess-9.json`)
    writeFileSync(join(dir, 'hook-sess-9.json'), `${JSON.stringify({ v: 1, id: 'hook-sess-9', startedAt: 5, updatedAt: 9, tools: {}, skills: { x: { calls: 2, errors: 0, last: 9 } }, agents: {}, commands: {} })}\n`)
    assert.equal(readUsage(dir).skills.x.calls, 2)
    assert.equal(hooks.MAX_NAMES, MAX_NAMES)
  })
  test('the setting is declared, reaches the server, and is on by default', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '.claude-plugin', 'plugin.json'), 'utf8'))
    assert.deepEqual([manifest.userConfig.usage_counts.default, manifest.userConfig.usage_counts.options], ['on', ['on', 'off']])
    assert.equal(manifest.mcpServers.ah.env.AH_USAGE_SETTING, '${user_config.usage_counts}')
  })
})

describe('old counts', () => {
  test('files untouched for a year go when a host starts', async () => {
    const { existsSync: ex } = await import('node:fs')
    const UP = (await import('../../server/src/paths.mjs')).upstreamDir()
    if (!ex(join(UP, 'node_modules', 'ah-dsh-tools'))) return
    const { createHost } = await import('../../server/src/host.mjs')
    const home = join(root, 'prune-home')
    const dir = usageDir(home)
    mkdirSync(dir, { recursive: true })
    const aged = (name, days) => { const f = join(dir, name); writeFileSync(f, '{}'); const t = new Date(Date.now() - days * 86_400_000); utimesSync(f, t, t) }
    aged('srv-old.json', 400)
    aged('srv-recent.json', 100)
    const saved = { ...process.env }
    process.env.DSH_HOME = home
    for (const f of ['ACADEMIC_HARNESS_SKIP_INSTALL', 'ACADEMIC_HARNESS_MODAL_SKIP_INSTALL', 'TEXTFOLD_SKIP_INSTALL', 'PAPERMEMORY_SKIP_INSTALL', 'ZVEC_GREP_SKIP_INSTALL']) process.env[f] = '1'
    let host
    try {
      host = await createHost({ upstream: UP, areas: 'skills', cwd: home, logger: () => {}, env: { ...process.env, AH_MOD_HOME: home } })
      assert.equal(existsSync(join(dir, 'srv-old.json')), false)
      assert.equal(existsSync(join(dir, 'srv-recent.json')), true)
      assert.ok(host.usage, 'counting is on by default')
    } finally {
      await host?.dispose()
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
      Object.assign(process.env, saved)
    }
  })
})

describe('invalid calls', () => {
  test('a tool with arguments its schema refuses carries a count, stored only when it is not zero, added across files and shown in the report', () => {
    const dir = join(root, 'inv')
    const a = createUsage({ dir, id: 'srv-a', flushMs: 60_000 })
    a.record('tools', 'literature_search', {})
    a.record('tools', 'literature_search', { invalid: true })
    a.record('tools', 'literature_search', { error: true, invalid: true })
    a.record('tools', 'fine', {})
    a.flush()
    const b = createUsage({ dir, id: 'srv-b', flushMs: 60_000 })
    b.record('tools', 'literature_search', { invalid: true })
    b.flush()
    assert.equal(a.data.tools.fine.invalid, undefined)
    const u = readUsage(dir)
    assert.deepEqual(u.tools.literature_search, { calls: 4, errors: 1, last: u.tools.literature_search.last, invalid: 3 })
    assert.equal(u.tools.fine.invalid, undefined)
    assert.equal(summarize(u, { tools: ['literature_search', 'fine'] }).tools.invalid, 3)
    const report = formatReport(u, { tools: ['literature_search', 'fine'] })
    assert.match(report, /3 with arguments the schema refuses/)
    assert.match(report, /literature_search 4 \(1 failed\) \(3 invalid\)/)
    assert.ok(!/invalid|refuses/.test(formatReport(readUsage(join(root, 'a')), {})), 'a report with none says nothing of it')
  })
})
