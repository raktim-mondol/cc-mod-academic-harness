#!/usr/bin/env node
// Build skills/ from the upstream snapshot: the core skill pack, minus restricted licences.
//
//   node scripts/build-skills.mjs [--include-restricted]
//
// Reads upstream/skills-core.json (92 names) and upstream/skills/<name>/. Copies each
// skill folder whole into skills/<name>/ unless its licence is restricted (decision D5):
// non-commercial (CC-BY-NC*), GPL, "Unknown", or any other label that is not a clear
// permissive licence. A skill with no `license:` line is the source's own text and is
// kept. The other 700 or so skills stay in upstream/skills/ for on-demand lookup.
//
// `--include-restricted` (or AH_INCLUDE_RESTRICTED=1) keeps everything: a local build for
// personal use. Do not commit or share the result of such a build; skills/.build-info.json
// records `restricted: true` so a release check can refuse it.
//
// skills/research-guides/ belongs to build-prompt.mjs and is left alone.
// Never edit skills/ by hand (ground rule 5).

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DROPPED_SKILLS, ON_DEMAND_SKILLS } from '../server/src/fit.mjs'
import { adapt } from './adapt.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const GUIDES_DIR = 'research-guides'

/** Parse the frontmatter fields the build needs, without a YAML dependency. */
export function frontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return null
  const out = {}
  let key = null
  for (const line of m[1].split(/\r?\n/)) {
    const top = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (top) {
      key = top[1]
      const v = top[2].trim()
      out[key] = /^[>|][+-]?$/.test(v) ? '' : v.replace(/^["']|["']$/g, '') // a block-scalar marker has no text of its own
    } else if (key && /^\s+\S/.test(line)) {
      out[key] = (out[key] + ' ' + line.trim()).trim() // folded or block scalar continuation
    }
  }
  return out
}

/**
 * D5. `readLicense` and `normalize` come from upstream's skill-licenses.js.
 * @returns {{ include: boolean, reason: string }}
 */
export function decide(rawLicense, { normalize, isNonCommercial }) {
  if (rawLicense == null) return { include: true, reason: 'no licence line (the source\'s own text)' }
  if (isNonCommercial(rawLicense)) return { include: false, reason: 'non-commercial' }
  const n = normalize(rawLicense)
  if (n.spdx) return { include: true, reason: n.spdx }
  if (/GPL/.test(n.unresolved)) return { include: false, reason: 'GPL' }
  if (/Unknown/.test(n.unresolved)) return { include: false, reason: 'Unknown' }
  return { include: false, reason: `unresolved: ${n.unresolved}` }
}

/** Host wording (scripts/adapt.mjs) over the text files of a copied skill. */
export function adaptFolder(dir, name, rel = '') {
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) adaptFolder(dir, name, path)
    else if (entry.isFile() && /\.md$/i.test(entry.name)) {
      const file = join(dir, path)
      if (statSync(file).size > 2_000_000) continue
      const text = readFileSync(file, 'utf8')
      const next = adapt(`skill:${name}/${path}`, text)
      if (next !== text) writeFileSync(file, next)
    }
  }
}

export async function build({ upstream = join(root, 'upstream'), out = join(root, 'skills'), includeRestricted = false } = {}) {
  const lic = await import(join(upstream, 'skill-licenses.js'))
  const core = JSON.parse(readFileSync(join(upstream, 'skills-core.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(join(root, 'UPSTREAM.lock.json'), 'utf8'))

  mkdirSync(out, { recursive: true })
  for (const entry of readdirSync(out, { withFileTypes: true })) {
    if (entry.name === GUIDES_DIR) continue
    rmSync(join(out, entry.name), { recursive: true, force: true })
  }

  const included = []
  const excluded = []
  const left = []
  const unknownLeft = [...Object.keys(DROPPED_SKILLS), ...Object.keys(ON_DEMAND_SKILLS)].filter(n => !core.includes(n))
  if (unknownLeft.length) throw new Error(`server/src/fit.mjs names skills that are not in the core list: ${unknownLeft.join(', ')}`)
  const problems = []
  for (const name of core) {
    if (DROPPED_SKILLS[name]) { left.push({ name, kind: 'dropped', why: DROPPED_SKILLS[name] }); continue }
    if (ON_DEMAND_SKILLS[name]) { left.push({ name, kind: 'on demand', why: ON_DEMAND_SKILLS[name] }); continue }
    const dir = join(upstream, 'skills', name)
    const file = join(dir, 'SKILL.md')
    if (!existsSync(file)) { problems.push(`${name}: listed in skills-core.json but ${file} is missing`); continue }
    const text = readFileSync(file, 'utf8')
    const fm = frontmatter(text)
    if (!fm) { problems.push(`${name}: no frontmatter`); continue }
    if (fm.name !== name) problems.push(`${name}: frontmatter name is "${fm.name}"`)
    if (!fm.description) problems.push(`${name}: no description`)
    const raw = lic.readLicense(text)
    const verdict = decide(raw, lic)
    if (!verdict.include && !includeRestricted) {
      excluded.push({ name, license: raw, reason: verdict.reason })
      continue
    }
    cpSync(dir, join(out, name), { recursive: true, dereference: false, filter: src => !/(^|\/)(__pycache__|\.git)(\/|$)/.test(src) })
    adaptFolder(join(out, name), name)
    included.push({ name, license: raw ?? null, reason: verdict.reason, description: fm.description.length })
  }
  if (problems.length) throw new Error('skill problems:\n  ' + problems.join('\n  '))

  const info = {
    commit: lock.commit,
    restricted: includeRestricted,
    coreListed: core.length,
    included: included.map(s => ({ name: s.name, license: s.license })),
    excluded,
    left,
    descriptionChars: included.reduce((n, s) => n + s.description, 0),
  }
  writeFileSync(join(out, '.build-info.json'), JSON.stringify(info, null, 2) + '\n')
  return info
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const includeRestricted = process.argv.includes('--include-restricted') || process.env.AH_INCLUDE_RESTRICTED === '1'
  const info = await build({ includeRestricted })
  console.log(`skills: ${info.included.length} of ${info.coreListed} core skills copied` + (info.restricted ? ' (RESTRICTED LICENCES INCLUDED: local build only)' : ''))
  for (const e of info.excluded) console.log(`  excluded ${e.name}: ${e.reason}${e.license ? ` (${e.license})` : ''}`)
  console.log(`  left out of the catalogue: ${info.left.filter(l => l.kind === 'dropped').length} dropped, ${info.left.filter(l => l.kind === 'on demand').length} on demand (server/src/fit.mjs)`)
  console.log(`  description text: ${info.descriptionChars} characters across the pack`)
}
