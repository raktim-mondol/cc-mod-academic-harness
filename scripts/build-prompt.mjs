#!/usr/bin/env node
// Build the always-on prompt section and the on-demand area guides from upstream's prompt.js.
//
//   node scripts/build-prompt.mjs
//
// core/prompt.js is one 97,000-character system prompt in about forty `##` sections. Decision D6
// keeps a short part always on (target 8,000 tokens or less, enforced below as 32,000 characters) and
// turns the rest into guides read on demand. Every section is assigned in SECTIONS. Output:
//   hooks/generated/prompt.ts                       the always-on text (host notes + chosen sections + guide index)
//   skills/research-guides/SKILL.md + references/   one file per guide
//
// The guides are upstream's text, with the passages that are wrong for Claude Code rewritten by scripts/adapt.mjs. The always-on part is
// written for Claude Code in scripts/research-mode.md (the sections marked `own` below are what it was written from). The build fails if a
// section named here is missing from prompt.js, which is how upstream drift is caught; it also says when an `own` section's upstream text
// has changed since it was last reviewed (scripts/prompt-reviewed.json; `--accept-upstream` records the current text as reviewed).
// A section it does not know is added to the guides and reported, so nothing is dropped silently.
// Never edit the outputs by hand (ground rule 5).

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { adapt } from './adapt.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const GUIDES_SKILL = 'research-guides'
export const SECTION_ID = 'academic-harness:research'
export const MAX_ALWAYS_ON_CHARS = 32_000

// where: 'own' (written for Claude Code in research-mode.md) | 'guide' (upstream's text, adapted) | 'drop'. A guide has a file slug and a one-line "load when" hint.
export const SECTIONS = {
  'How you work': { where: 'own' },
  'Research discipline': { where: 'own' },
  'Local learning (RSI)': { where: 'drop', why: 'ah_rsi is not ported (decision D10, deferred to P6)' },
  'Writing quality': { where: 'guide', slug: 'writing-quality', hint: 'editing a finished draft that reads machine-generated' },
  'Paper lifecycle (Supervisor-Skills)': { where: 'guide', slug: 'paper-lifecycle', hint: 'outside an ah.yaml project: idea evaluation, drafting, pre-submission review' },
  'Python': { where: 'own' },
  'Lab notebook': { where: 'own' },
  'Scientific results': { where: 'drop', why: 'scientific_result draws a card in DSH\'s chat; here the answer is the reply' },
  'Reproducible analysis': { where: 'guide', slug: 'reproducible-analysis', hint: 'running or rerunning an analysis that will be reported' },
  'Provenance audit': { where: 'guide', slug: 'provenance-audit', hint: 'tracing where a number, figure or claim came from' },
  'Deep research': { where: 'guide', slug: 'deep-research', hint: 'a survey-grade, multi-source investigation' },
  'Specialists': { where: 'guide', slug: 'specialists', hint: 'delegating review, research or design work to a specialist agent' },
  'Literature and the web': { where: 'guide', slug: 'literature-and-the-web', hint: 'finding papers, databases, journals, or web sources' },
  'Reading papers at the right level': { where: 'guide', slug: 'reading-papers', hint: 'reading, downloading or converting papers; clinical evidence; data and journal policy; paper integrity' },
  'Paper memory': { where: 'own' },
  'Reference library': { where: 'guide', slug: 'reference-library', hint: 'managing a project\'s reference library and BibTeX' },
  'Systematic reviews': { where: 'guide', slug: 'systematic-reviews', hint: 'protocols, screening, extraction, PRISMA' },
  'Meta-analysis': { where: 'guide', slug: 'meta-analysis', hint: 'pooling effect sizes' },
  'GRADE certainty': { where: 'guide', slug: 'grade-certainty', hint: 'rating certainty of evidence' },
  'Reporting checklists': { where: 'guide', slug: 'reporting-checklists', hint: 'CONSORT, PRISMA, STROBE and similar checklists' },
  'Deep review': { where: 'guide', slug: 'deep-review', hint: 'a multi-pass engine review of a manuscript' },
  'Study planning': { where: 'guide', slug: 'study-planning', hint: 'designing a study, power, sampling, pre-registration' },
  'Study conduct, ethics, and grants': { where: 'guide', slug: 'study-conduct-and-grants', hint: 'ethics applications, data management, grant writing' },
  'Hypothesis tournaments': { where: 'guide', slug: 'hypothesis-tournaments', hint: 'ranked, multi-round hypothesis generation' },
  'Identity, funding, and local audits': { where: 'guide', slug: 'identity-and-audits', hint: 'ORCID, funders, authorship and local audits' },
  'References and citation': { where: 'guide', slug: 'references-and-citation', hint: 'formatting, resolving and checking citations' },
  'Submission and communication': { where: 'guide', slug: 'submission', hint: 'cover letters, rebuttals, response to reviewers, submission packages' },
  'Figures': { where: 'guide', slug: 'figures', hint: 'making or checking figures and diagrams' },
  'Scientific databases and toolkits': { where: 'guide', slug: 'databases-and-toolkits', hint: 'domain databases and science toolkits' },
  'Discovery and reference checks': { where: 'guide', slug: 'discovery-and-reference-checks', hint: 'checking that references exist and say what is claimed' },
  'Scientific files': { where: 'guide', slug: 'scientific-files', hint: 'reading or writing scientific file formats' },
  'Academic Harness (LaTeX papers, grants, theses)': { where: 'guide', slug: 'latex-projects', hint: 'a workspace with ah.yaml, or starting a paper, grant or thesis in LaTeX' },
  'LaTeX': { where: 'guide', slug: 'latex', hint: 'compiling or fixing LaTeX' },
  'Remote compute': { where: 'guide', slug: 'remote-compute', hint: 'paid GPU or cloud compute (always ask first)' },
  'Workspace search': { where: 'drop', why: 'the zvec tools come from the global zvec-grep integration; research-mode.md carries the routing' },
  'Workflow templates': { where: 'drop', why: 'research_template is not served; skills and the task commands do that job' },
  'Files': { where: 'drop', why: 'covered by research-mode.md' },
  'Safety': { where: 'own' },
}

/** Split the evaluated prompt into [{ heading, text }] on top-level `## ` sections; the lead-in is dropped. */
export function splitSections(prompt) {
  const parts = String(prompt).split(/\n(?=## )/)
  return parts
    .filter(p => p.startsWith('## '))
    .map(text => ({ heading: text.split('\n')[0].slice(3).trim(), text: text.trimEnd() }))
}

function slugify(heading) {
  return heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
}

/** @returns {{ own: Array<{heading, text}>, guides: Array<{heading, slug, hint, text}>, dropped: Array<{heading, why}>, unknown: string[] }} */
export function classify(sections, responseShape) {
  const known = new Set(Object.keys(SECTIONS))
  const present = new Set(sections.map(s => s.heading))
  const missing = [...known].filter(h => !present.has(h))
  if (missing.length) throw new Error(`prompt.js no longer has these sections: ${missing.join('; ')}. Upstream changed: review SECTIONS in scripts/build-prompt.mjs.`)

  const own = []
  const guides = []
  const dropped = []
  const unknown = []
  for (const s of sections) {
    const rule = SECTIONS[s.heading]
    if (!rule) {
      unknown.push(s.heading)
      guides.push({ ...s, slug: slugify(s.heading), hint: s.heading })
    } else if (rule.where === 'own') own.push(s)
    else if (rule.where === 'guide') guides.push({ ...s, slug: rule.slug, hint: rule.hint })
    else dropped.push({ heading: s.heading, why: rule.why })
  }
  own.push({ heading: 'RESPONSE_SHAPE', text: String(responseShape).trimEnd() })
  return { own, guides, dropped, unknown }
}

export function guideIndex(guides) {
  return [
    '## Guides on demand',
    '',
    `Load the skill \`academic-harness:${GUIDES_SKILL}\` when the task falls in one of these areas, then read the one file it names:`,
    '',
    ...guides.map(g => `- ${g.slug}: ${g.hint}`),
  ].join('\n')
}

export function assemble({ researchMode, guides }) {
  return [researchMode.trimEnd(), guideIndex(guides)].join('\n\n') + '\n'
}

/** The digest `prompt-reviewed.json` and the update report use for a section's text. */
export const sha = text => createHash('sha256').update(String(text)).digest('hex').slice(0, 16)

function guideFile(g) {
  return [
    `<!-- Generated by scripts/build-prompt.mjs from upstream prompt.js, section "${g.heading}", with scripts/adapt.mjs. Do not edit. -->`,
    '',
    `Names in this guide: \`subagent\` is \`Agent\`, \`skill\` is \`Skill\`, and \`mcp__papermemory__*\` is \`mcp__plugin_academic-harness_papermemory__*\`. If a tool named below is not in your tool list, say so.`,
    '',
    adapt(`guide:${g.slug}`, g.text),
    '',
  ].join('\n')
}

function guidesSkill(guides) {
  const rows = guides.map(g => `| \`references/${g.slug}.md\` | ${g.hint} |`)
  return [
    '---',
    `name: ${GUIDES_SKILL}`,
    'description: "Longer Academic Harness guidance by area: literature search, systematic reviews, meta-analysis, deep research and review, reference library, figures, submission, LaTeX paper projects (ah.yaml), remote compute, and more. Load when a research task falls in one of these areas, then read the one reference file that matches."',
    '---',
    '',
    '# Academic Harness guides',
    '',
    'Each file under `references/` is one area of guidance. Read only the file for the area you are working in.',
    '',
    '| File | Read when |',
    '|---|---|',
    ...rows,
    '',
    'Tool-name mapping and what to do when a named tool is missing are in the research mode notes and at the top of each file.',
    '',
  ].join('\n')
}

const REVIEWED = join(root, 'scripts', 'prompt-reviewed.json')

/** The `own` sections whose upstream text differs from what research-mode.md was written against. `accept` records the current text. */
export function reviewUpstream(own, { accept = false, file = REVIEWED } = {}) {
  const now = Object.fromEntries(own.map(s => [s.heading, sha(s.text)]))
  const before = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  const changed = before ? Object.keys(now).filter(h => before[h] !== now[h]) : []
  if (accept || !before) writeFileSync(file, JSON.stringify(now, null, 2) + '\n')
  return changed
}

export async function build({ upstream = join(root, 'core'), hooksOut = join(root, 'hooks', 'generated'), skillsOut = join(root, 'skills'), accept = false } = {}) {
  const mod = await import(pathToFileURL(join(upstream, 'prompt.js')).href)
  const sections = splitSections(mod.ACADEMIC_HARNESS_PROMPT)
  const { own, guides, dropped, unknown } = classify(sections, mod.RESPONSE_SHAPE)
  const researchMode = readFileSync(join(root, 'scripts', 'research-mode.md'), 'utf8')
  const text = assemble({ researchMode, guides })
  const changed = reviewUpstream(own, { accept })
  if (text.length > MAX_ALWAYS_ON_CHARS) {
    throw new Error(`always-on section is ${text.length} characters, over the ${MAX_ALWAYS_ON_CHARS} limit (decision D6). Move a section to the guides in SECTIONS.`)
  }
  const coreVersion = JSON.parse(readFileSync(join(upstream, 'package.json'), 'utf8')).version

  mkdirSync(hooksOut, { recursive: true })
  writeFileSync(join(hooksOut, 'prompt.ts'), [
    `// Generated by scripts/build-prompt.mjs from core ${coreVersion}. Do not edit.`,
    `export const SECTION_ID = ${JSON.stringify(SECTION_ID)}`,
    `export const PLUGIN_ROOT_TOKEN = '{{PLUGIN_ROOT}}'`,
    `export const PROMPT_TEXT = ${JSON.stringify(text)}`,
    '',
  ].join('\n'))

  const dir = join(skillsOut, GUIDES_SKILL)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'references'), { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), guidesSkill(guides))
  for (const g of guides) writeFileSync(join(dir, 'references', `${g.slug}.md`), guideFile(g))

  return { chars: text.length, tokensEstimate: Math.round(text.length / 4), own: own.length, guides: guides.length, dropped, unknown, changed }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await build({ accept: process.argv.includes('--accept-upstream') })
  console.log(`prompt: always-on ${r.chars} characters (about ${r.tokensEstimate} tokens), written for Claude Code from ${r.own} upstream sections, ${r.guides} guides`)
  if (r.changed.length) console.log(`  UPSTREAM CHANGED since scripts/research-mode.md was reviewed: ${r.changed.join('; ')}. Read them, update research-mode.md, then run with --accept-upstream`)
  for (const d of r.dropped) console.log(`  dropped "${d.heading}": ${d.why}`)
  if (r.unknown.length) console.log(`  NEW upstream sections added to the guides, review them: ${r.unknown.join('; ')}`)
}
