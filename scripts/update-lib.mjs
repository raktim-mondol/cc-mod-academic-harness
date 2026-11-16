// Comparing two snapshots of Academic Harness: what a newer commit changes for this mod. Pure functions here; scripts/update-upstream.mjs
// takes the snapshots and prints the result.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { classify, discover } from '../server/src/manifest.mjs'
import { DROPPED_SKILLS, ON_DEMAND_SKILLS } from '../server/src/fit.mjs'
import { sha as sectionSha, splitSections } from './build-prompt.mjs'
import { recordUpstream } from './measure-surface.mjs'

const sha = text => createHash('sha256').update(String(text)).digest('hex').slice(0, 12)

/**
 * What the mod depends on in a snapshot, as plain data.
 * `{ version, tools: { name: { module, digest } }, modules: [{ file, fn, tier }], sections: { heading: digest }, coreSkills, keyFields, packageLock }`
 * Loads the snapshot's tool modules in a child process (measure-surface.mjs), so its dependencies must be resolvable from `dir`.
 */
export async function describeSnapshot(dir) {
  const read = rel => readFileSync(join(dir, rel), 'utf8')
  const recorded = recordUpstream(dir)
  const tools = {}
  for (const entry of recorded.perEntry) for (const t of entry.tools) tools[t.name] = { module: entry.file, digest: sha(`${t.description}\n${JSON.stringify(t.parameters)}`) }
  const prompt = await import(pathToFileURL(join(dir, 'prompt.js')).href)
  const sections = Object.fromEntries(splitSections(prompt.ACADEMIC_HARNESS_PROMPT).map(s => [s.heading, sectionSha(s.text)]))
  sections.RESPONSE_SHAPE = sectionSha(String(prompt.RESPONSE_SHAPE).trimEnd())
  const keys = await import(pathToFileURL(join(dir, 'settings-keys.js')).href)
  return {
    version: JSON.parse(read('package.json')).version,
    tools,
    modules: discover(dir).map(e => ({ ...e, tier: classify(e).tier })),
    sections,
    coreSkills: JSON.parse(read('skills-core.json')),
    keyFields: [...keys.KEY_FIELDS],
    packageLock: existsSync(join(dir, 'package-lock.json')) ? sha(read('package-lock.json')) : null,
    loadErrors: recorded.perEntry.filter(e => e.error).map(e => `${e.file}: ${e.error}`),
  }
}

const added = (a, b) => b.filter(x => !a.includes(x))

/** The difference between two descriptions (`from` is what the mod holds, `to` the candidate), with what the mod has to decide. */
export function diffDescriptions(from, to, { reviewed = {} } = {}) {
  const fromTools = Object.keys(from.tools)
  const toTools = Object.keys(to.tools)
  const toolsAdded = added(fromTools, toTools)
  const toolsRemoved = added(toTools, fromTools)
  const toolsChanged = toTools.filter(n => from.tools[n] && from.tools[n].digest !== to.tools[n].digest)
  const fromSections = Object.keys(from.sections)
  const toSections = Object.keys(to.sections)
  const known = new Set(from.modules.map(m => `${m.file}#${m.fn}`))
  const newModules = to.modules.filter(m => !known.has(`${m.file}#${m.fn}`))
  return {
    versions: { from: from.version, to: to.version },
    toolsAdded: toolsAdded.map(n => ({ name: n, module: to.tools[n].module })),
    toolsRemoved,
    toolsChanged,
    sectionsAdded: added(fromSections, toSections),
    sectionsRemoved: added(toSections, fromSections),
    sectionsChanged: toSections.filter(h => from.sections[h] && from.sections[h] !== to.sections[h]),
    // the parts of the prompt that scripts/research-mode.md was written from: a change there means that text may need a look
    ownChanged: toSections.filter(h => reviewed[h] && to.sections[h] && reviewed[h] !== to.sections[h]),
    coreSkillsAdded: added(from.coreSkills, to.coreSkills),
    coreSkillsRemoved: added(to.coreSkills, from.coreSkills),
    keyFieldsAdded: added(from.keyFields, to.keyFields),
    keyFieldsRemoved: added(to.keyFields, from.keyFields),
    dependenciesChanged: from.packageLock !== to.packageLock,
    // modules nobody has classified (not loaded, not host-only, not dropped): each is a decision for server/src/manifest.mjs or fit.mjs
    unclassified: newModules.filter(m => m.tier === 'later').map(m => m.file),
    loadErrors: to.loadErrors.filter(e => !from.loadErrors.includes(e)),
  }
}

/** True when nothing in the diff needs a person before the candidate can be applied. */
export function needsDecision(d) {
  return d.unclassified.length > 0 || d.toolsAdded.length > 0 || d.sectionsAdded.length > 0 || d.loadErrors.length > 0
}

const list = (items, fmt = x => x) => (items.length ? items.map(fmt).join(', ') : 'none')

/** The report as text. */
export function formatDiff(d) {
  const lines = [
    `Academic Harness ${d.versions.from} -> ${d.versions.to}`,
    '',
    `tools added:     ${list(d.toolsAdded, t => `${t.name} (${t.module})`)}`,
    `tools removed:   ${list(d.toolsRemoved)}`,
    `tools changed:   ${list(d.toolsChanged)} (description or parameters)`,
    `prompt sections added: ${list(d.sectionsAdded)}; removed: ${list(d.sectionsRemoved)}; changed: ${list(d.sectionsChanged)}`,
    `research-mode.md was written from: ${d.ownChanged.length ? `${list(d.ownChanged)} CHANGED, read them and update scripts/research-mode.md` : 'sections that did not change'}`,
    `core skills added: ${list(d.coreSkillsAdded)}; removed: ${list(d.coreSkillsRemoved)}`,
    `key fields added: ${list(d.keyFieldsAdded)}; removed: ${list(d.keyFieldsRemoved)}`,
    `npm dependencies: ${d.dependenciesChanged ? 'CHANGED (npm ci runs on apply)' : 'unchanged'}`,
  ]
  if (d.unclassified.length) lines.push('', `modules nobody has classified: ${d.unclassified.join(', ')}. Add each to TIER1 or HOST_ONLY in server/src/manifest.mjs, or to DROPPED_TOOLS in server/src/fit.mjs.`)
  if (d.toolsAdded.length) lines.push('', `new tools: serve them (their module goes in TIER1), or leave them out with a reason in server/src/fit.mjs. Ask of each: does Claude Code already do this?`)
  if (d.coreSkillsAdded.length) lines.push('', `new core skills are built into the catalogue unless they are named in DROPPED_SKILLS or ON_DEMAND_SKILLS (server/src/fit.mjs): ${d.coreSkillsAdded.filter(n => !DROPPED_SKILLS[n] && !ON_DEMAND_SKILLS[n]).join(', ') || 'all already decided'}.`)
  if (d.loadErrors.length) lines.push('', `modules that did not load in the candidate: ${d.loadErrors.join('; ')}`)
  lines.push('', needsDecision(d) ? 'A person has to decide something before this is applied (above).' : 'Nothing needs a decision: applying it rebuilds and runs the checks.')
  return lines.join('\n')
}
