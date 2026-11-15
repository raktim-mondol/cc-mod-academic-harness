// node --test "tests/scripts/*.test.mjs"
// Needs upstream/ (node scripts/sync-upstream.mjs) and the built outputs.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { agentFile, EDITORS, specialistNames } from '../../scripts/build-agents.mjs'
import { assemble, classify, MAX_ALWAYS_ON_CHARS, SECTIONS, splitSections } from '../../scripts/build-prompt.mjs'
import { decide, frontmatter } from '../../scripts/build-skills.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const upstream = join(root, 'upstream')
const lic = await import(pathToFileURL(join(upstream, 'skill-licenses.js')).href)
const prompt = await import(pathToFileURL(join(upstream, 'prompt.js')).href)

describe('licence decision (D5)', () => {
  const d = raw => decide(raw, lic)
  test('permissive labels are kept', () => {
    for (const raw of ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'CC-BY-4.0', 'BSD-2-Clause']) assert.equal(d(raw).include, true, raw)
  })
  test('no licence line is the source\'s own text and is kept', () => assert.equal(d(null).include, true))
  test('non-commercial is excluded in every spelling', () => {
    for (const raw of ['CC-BY-NC-SA-4.0', 'cc by-nc-sa 4.0', 'CC-BY-NC-4.0']) assert.deepEqual([d(raw).include, d(raw).reason], [false, 'non-commercial'], raw)
  })
  test('GPL, Unknown and unresolved labels are excluded', () => {
    assert.equal(d('GPLv3 license').include, false)
    assert.equal(d('GPL-3.0').include, false)
    assert.deepEqual([d('Unknown').include, d('Unknown').reason], [false, 'Unknown'])
    assert.equal(d('Proprietary. LICENSE.txt has complete terms').include, false)
    assert.equal(d('https://github.com/x/y/blob/main/LICENSE').include, false)
  })
})

describe('frontmatter', () => {
  test('reads quoted, bare and folded values', () => {
    const fm = frontmatter('---\nname: a-b\ndescription: "Does a thing."\nlicense: MIT\nmetadata:\n  x: 1\n---\nbody')
    assert.equal(fm.name, 'a-b'); assert.equal(fm.description, 'Does a thing.'); assert.equal(fm.license, 'MIT')
    assert.equal(frontmatter('no front matter'), null)
    assert.equal(frontmatter('---\nname: x\ndescription: >\n  folded\n  text\n---\n').description, 'folded text')
  })
})

describe('built skills', () => {
  const info = JSON.parse(readFileSync(join(root, 'skills', '.build-info.json'), 'utf8'))
  test('the committed pack is not a restricted-licence build', () => assert.equal(info.restricted, false))
  test('every included skill is on disk with its SKILL.md; every excluded one is absent', () => {
    for (const s of info.included) assert.ok(existsSync(join(root, 'skills', s.name, 'SKILL.md')), s.name)
    for (const s of info.excluded) assert.equal(existsSync(join(root, 'skills', s.name)), false, s.name)
    assert.equal(info.included.length + info.excluded.length, info.coreListed)
  })
  test('no skill folder holds a restricted licence', () => {
    for (const s of info.included) {
      const raw = lic.readLicense(readFileSync(join(root, 'skills', s.name, 'SKILL.md'), 'utf8'))
      assert.equal(decide(raw, lic).include, true, `${s.name}: ${raw}`)
    }
  })
  test('the guides skill is present and indexes every reference file', () => {
    const body = readFileSync(join(root, 'skills', 'research-guides', 'SKILL.md'), 'utf8')
    const files = readdirSync(join(root, 'skills', 'research-guides', 'references'))
    assert.ok(files.length >= 20)
    for (const f of files) assert.ok(body.includes(`references/${f}`), f)
  })
})

describe('prompt build', () => {
  const sections = splitSections(prompt.ACADEMIC_HARNESS_PROMPT)
  test('every section the table names exists upstream (drift check)', () => {
    assert.doesNotThrow(() => classify(sections, prompt.RESPONSE_SHAPE))
  })
  test('a removed upstream section fails the build with its name', () => {
    assert.throws(() => classify(sections.filter(s => s.heading !== 'Safety'), ''), /Safety/)
  })
  test('a new upstream section goes to the guides and is reported, not dropped', () => {
    const r = classify([...sections, { heading: 'Brand new area', text: '## Brand new area\n\nx' }], '')
    assert.deepEqual(r.unknown, ['Brand new area'])
    assert.ok(r.guides.some(g => g.heading === 'Brand new area'))
  })
  test('every upstream section is accounted for exactly once', () => {
    const r = classify(sections, '')
    assert.equal(r.always.length - 1 + r.guides.length + r.dropped.length, sections.length)
  })
  test('the always-on text is within the D6 budget and holds the safety rule', () => {
    const r = classify(sections, prompt.RESPONSE_SHAPE)
    const text = assemble({ hostNotes: readFileSync(join(root, 'scripts', 'host-notes.md'), 'utf8'), always: r.always, guides: r.guides })
    assert.ok(text.length <= MAX_ALWAYS_ON_CHARS, String(text.length))
    assert.match(text, /untrusted-source/)
    assert.match(text, /Do not fabricate experimental results/)
    assert.ok(Object.keys(SECTIONS).length >= 38)
  })
  test('hooks/generated/prompt.ts carries the host notes and the placeholder', () => {
    const t = readFileSync(join(root, 'hooks', 'generated', 'prompt.ts'), 'utf8')
    assert.ok(t.includes('Research mode is on'))
    assert.ok(t.includes('{{PLUGIN_ROOT}}'))
  })
})

describe('agents', () => {
  const names = specialistNames(prompt.ACADEMIC_HARNESS_PROMPT)
  test('22 specialists are found in the Specialists section', () => assert.equal(names.length, 22))
  test('every editor name is a real specialist', () => { for (const n of EDITORS) assert.ok(names.includes(n), n) })
  test('a reviewer cannot edit; an editor can', () => {
    const skill = n => readFileSync(join(upstream, 'skills', n, 'SKILL.md'), 'utf8')
    assert.match(agentFile('peer-reviewer', skill('peer-reviewer')), /disallowedTools: Edit, Write, NotebookEdit/)
    assert.doesNotMatch(agentFile('manuscript-editor', skill('manuscript-editor')), /disallowedTools/)
  })
  test('the host-specific delegation line is gone from every built agent', () => {
    for (const f of readdirSync(join(root, 'agents'))) {
      const t = readFileSync(join(root, 'agents', f), 'utf8')
      assert.doesNotMatch(t, /DeepSeek Harness delegates/, f)
      assert.match(t, /^---\nname: /, f)
    }
    assert.equal(readdirSync(join(root, 'agents')).length, names.length)
  })
  test('a brief without the delegation line fails loudly', () => {
    assert.throws(() => agentFile('x', '---\nname: x\ndescription: d\n---\n\nbody only'), /delegation line/)
  })
})
