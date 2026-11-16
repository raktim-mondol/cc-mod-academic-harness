// The update report (scripts/update-lib.mjs): what two snapshots differ in, and what that asks of a person. The snapshots here are descriptions
// made by hand; describeSnapshot itself is exercised by scripts/update-upstream.mjs against real commits (docs/history/p6-results.md).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { diffDescriptions, formatDiff, needsDecision } from '../../scripts/update-lib.mjs'

const tool = (module, digest = 'd1') => ({ module, digest })
const base = () => ({
  version: '0.54.1',
  tools: { literature_search: tool('literature-search.js'), notebook: tool('notebook.js'), brave_search: tool('brave-search.js') },
  modules: [{ file: 'literature-search.js', fn: 'apply', tier: 1 }, { file: 'notebook.js', fn: 'applyNotebook', tier: 1 }, { file: 'brave-search.js', fn: 'apply', tier: 'dropped' }],
  sections: { 'How you work': 'a1', Safety: 'b1', RESPONSE_SHAPE: 'c1', 'Literature and the web': 'e1' },
  coreSkills: ['academic-search', 'peer-reviewer'],
  keyFields: ['S2_API_KEY', 'BRAVE_API_KEY'],
  packageLock: 'p1',
  loadErrors: ['subagent-list-compat.js: Cannot find module x'],
})

describe('the comparison', () => {
  test('two identical snapshots differ in nothing and need no decision', () => {
    const d = diffDescriptions(base(), base())
    assert.deepEqual([d.toolsAdded, d.toolsRemoved, d.toolsChanged, d.sectionsAdded, d.sectionsRemoved, d.coreSkillsAdded, d.unclassified, d.loadErrors], [[], [], [], [], [], [], [], []])
    assert.equal(d.dependenciesChanged, false)
    assert.equal(needsDecision(d), false)
    assert.match(formatDiff(d), /Nothing needs a decision/)
  })
  test('a new tool and a module nobody classified are decisions; a changed description is not', () => {
    const to = base()
    to.tools.new_tool = tool('new-tool.js')
    to.tools.notebook = tool('notebook.js', 'd2')
    to.modules.push({ file: 'new-tool.js', fn: 'apply', tier: 'later' })
    const d = diffDescriptions(base(), to)
    assert.deepEqual(d.toolsAdded, [{ name: 'new_tool', module: 'new-tool.js' }])
    assert.deepEqual(d.toolsChanged, ['notebook'])
    assert.deepEqual(d.unclassified, ['new-tool.js'])
    assert.equal(needsDecision(d), true)
    const text = formatDiff(d)
    assert.match(text, /tools added:\s+new_tool \(new-tool\.js\)/)
    assert.match(text, /does Claude Code already do this/)
    assert.match(text, /nobody has classified: new-tool\.js/)
    const onlyChanged = base()
    onlyChanged.tools.notebook = tool('notebook.js', 'd2')
    assert.equal(needsDecision(diffDescriptions(base(), onlyChanged)), false)
  })
  test('removed tools, sections and skills are listed; a new prompt section is a decision', () => {
    const to = base()
    delete to.tools.brave_search
    to.sections['Brand new'] = 'n1'
    delete to.sections['Literature and the web']
    to.coreSkills = ['academic-search', 'brand-new-skill']
    const d = diffDescriptions(base(), to)
    assert.deepEqual(d.toolsRemoved, ['brave_search'])
    assert.deepEqual(d.sectionsAdded, ['Brand new'])
    assert.deepEqual(d.sectionsRemoved, ['Literature and the web'])
    assert.deepEqual(d.coreSkillsAdded, ['brand-new-skill'])
    assert.deepEqual(d.coreSkillsRemoved, ['peer-reviewer'])
    assert.equal(needsDecision(d), true)
  })
  test('the sections research-mode.md was written from are flagged only when they differ from what was reviewed', () => {
    const to = base()
    to.sections['How you work'] = 'a2'
    to.sections['Literature and the web'] = 'e2'
    const reviewed = { 'How you work': 'a1', Safety: 'b1', RESPONSE_SHAPE: 'c1' }
    const d = diffDescriptions(base(), to, { reviewed })
    assert.deepEqual(d.ownChanged, ['How you work'])
    assert.deepEqual(d.sectionsChanged.sort(), ['How you work', 'Literature and the web'])
    assert.match(formatDiff(d), /How you work CHANGED/)
  })
  test('settings fields, dependencies and new load errors are reported', () => {
    const to = base()
    to.keyFields = ['S2_API_KEY', 'NEW_KEY']
    to.packageLock = 'p2'
    to.loadErrors = [...to.loadErrors, 'x.js: boom']
    const d = diffDescriptions(base(), to)
    assert.deepEqual([d.keyFieldsAdded, d.keyFieldsRemoved], [['NEW_KEY'], ['BRAVE_API_KEY']])
    assert.equal(d.dependenciesChanged, true)
    assert.deepEqual(d.loadErrors, ['x.js: boom'])
    assert.equal(needsDecision(d), true)
    assert.match(formatDiff(d), /CHANGED \(npm ci runs on apply\)/)
  })
})
