// The six non-commercial skills in core/ and the switch that keeps them out of what the plugin serves (AH_EXCLUDE_NONCOMMERCIAL=1). The switch is
// the core's own (core/skill-index.js); what is tested here is that it holds through this plugin's host, because NOTICE tells people to rely on it.
// Each case runs in a process of its own, as a server does: the core builds its skill index once per process, from the environment it starts in.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { modRoot } from '../../server/src/paths.mjs'

const scratch = join(homedir(), '.cache', 'ah-test-homes')
mkdirSync(scratch, { recursive: true })
const home = mkdtempSync(join(scratch, 'nc-'))
after(() => rmSync(home, { recursive: true, force: true }))

const NON_COMMERCIAL = ['deep-research', 'intro-drafter', 'paper-polish', 'paper-writer', 'rebuttal-guidance', 'what-if-oracle']
const url = file => pathToFileURL(join(modRoot(), file)).href

const probe = join(home, 'probe.mjs')
before(() => {
  writeFileSync(probe, `
import { prepareEnv } from ${JSON.stringify(url('server/src/env.mjs'))}
import { createHost } from ${JSON.stringify(url('server/src/host.mjs'))}
prepareEnv(process.env, { areas: [] })
const host = await createHost({ upstream: ${JSON.stringify(join(modRoot(), 'core'))}, areas: 'skills', cwd: process.cwd() })
const text = r => (r.content ?? []).map(c => c.text ?? '').join('\\n')
const out = { search: text(await host.call('skill_search', { query: 'paper writer academic' })).split('\\n')[0], loads: {} }
for (const name of [...${JSON.stringify(NON_COMMERCIAL)}, 'literature-review']) out.loads[name] = !/unknown or not bundled/.test(text(await host.call('skill_load', { name })))
process.stdout.write(JSON.stringify(out))
process.exit(0)
`)
})

function run(switchValue) {
  const r = spawnSync(process.execPath, [probe], { encoding: 'utf8', timeout: 120_000, env: { ...process.env, AH_MOD_HOME: home, AH_EXCLUDE_NONCOMMERCIAL: switchValue } })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

describe('the non-commercial skills', () => {
  test('by default every bundled skill is searchable and loadable, the six included', () => {
    const r = run('')
    assert.match(r.search, /of 791 bundled skills/)
    for (const [name, loaded] of Object.entries(r.loads)) assert.equal(loaded, true, name)
  })
  test('with AH_EXCLUDE_NONCOMMERCIAL=1 the search covers 785, and loading any of the six is refused', () => {
    const r = run('1')
    assert.match(r.search, /of 785 bundled skills/)
    for (const name of NON_COMMERCIAL) assert.equal(r.loads[name], false, `${name} must be refused`)
    assert.equal(r.loads['literature-review'], true, 'a permissive skill is still served')
  })
})
