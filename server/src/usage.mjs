// Which tools, skills, agents and commands are used, as names and counts only, so the next review of what the plugin leaves out can start from
// data (docs/design/fit-review.md). Nothing leaves this machine, and no argument, path, prompt or result is ever recorded.
//
// Where it is kept: `<home>/usage/`, one small file per writer, so concurrent sessions never write the same file:
//   srv-<pid>-<start>.json    the `ah` server: every tool call it answers, and the skills read with skill_load
//   hook-<session>.json       the hooks module (hooks/usage.ts): the plugin's skills and agents the model starts, and the commands run
// Each holds { v, id, startedAt, updatedAt, tools, skills, agents, commands }, each of the four being { name: { calls, errors, last } }.
// `readUsage` adds the files up. A file untouched for a year (AH_USAGE_KEEP_DAYS) is removed when a server starts.
//
// Off with the `usage_counts` setting (AH_USAGE_SETTING) or AH_USAGE=0.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const KINDS = ['tools', 'skills', 'agents', 'commands']
export const DEFAULT_KEEP_DAYS = 365
/** Most distinct names kept per kind in one file: a name the model makes up (a mistyped skill) must not grow a file for ever. */
export const MAX_NAMES = 500
/** The slash commands the hooks module registers (hooks/tasks-core.ts TASK_COMMANDS, hooks/tasks.ts, hooks/register.tsx); a test keeps this list equal to them. */
export const KNOWN_COMMANDS = ['academic', 'ah-research', 'ah-review', 'ah-papers', 'ah-references', 'ah-write', 'ah-analyze', 'ah-hypotheses', 'ah-watch', 'fold']

export const usageDir = home => join(home, 'usage')

/** The setting arrives as AH_USAGE_SETTING ("on" or "off"; empty when unset), the shell switch as AH_USAGE=0. */
export function usageEnabled(env = process.env) {
  return env.AH_USAGE?.trim() !== '0' && env.AH_USAGE_SETTING?.trim().toLowerCase() !== 'off'
}

const clean = name => (typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) : '')

/**
 * A recorder for one writer. `record(kind, name, { error })` counts one use; the file is written a few seconds after the last change and by
 * `flush()`. Nothing here throws: a count that cannot be kept must never fail the work it counts.
 */
export function createUsage({ dir, id, now = () => Date.now(), flushMs = 5000 }) {
  const data = { v: 1, id, startedAt: now(), updatedAt: now(), tools: {}, skills: {}, agents: {}, commands: {} }
  let dirty = false
  let timer = null

  function flush() {
    if (timer) { clearTimeout(timer); timer = null }
    if (!dirty) return
    dirty = false
    try {
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `${id}.json`)
      writeFileSync(`${file}.tmp`, `${JSON.stringify(data)}\n`)
      renameSync(`${file}.tmp`, file)
    } catch { /* not kept this time; the next change tries again */ }
  }

  function record(kind, name, { error = false } = {}) {
    try {
      const key = clean(name)
      if (!KINDS.includes(kind) || !key) return
      const group = data[kind]
      if (!group[key] && Object.keys(group).length >= MAX_NAMES) return
      const entry = (group[key] ??= { calls: 0, errors: 0, last: 0 })
      entry.calls++
      if (error) entry.errors++
      entry.last = now()
      data.updatedAt = entry.last
      dirty = true
      if (!timer) { timer = setTimeout(flush, flushMs); timer.unref?.() }
    } catch { /* see above */ }
  }

  return { record, flush, data }
}

/** Every writer's file added up: { files, since, last, tools, skills, agents, commands } with { calls, errors, last } per name. Never throws. */
export function readUsage(dir) {
  const out = { files: 0, since: null, last: null, tools: {}, skills: {}, agents: {}, commands: {} }
  let names = []
  try { names = existsSync(dir) ? readdirSync(dir).filter(n => n.endsWith('.json')) : [] } catch { return out }
  for (const n of names) {
    let d
    try { d = JSON.parse(readFileSync(join(dir, n), 'utf8')) } catch { continue }
    if (!d || typeof d !== 'object') continue
    out.files++
    if (Number.isFinite(d.startedAt)) out.since = out.since === null ? d.startedAt : Math.min(out.since, d.startedAt)
    if (Number.isFinite(d.updatedAt)) out.last = out.last === null ? d.updatedAt : Math.max(out.last, d.updatedAt)
    for (const kind of KINDS) {
      for (const [name, e] of Object.entries(d[kind] && typeof d[kind] === 'object' ? d[kind] : {})) {
        if (!e || typeof e !== 'object') continue
        const into = (out[kind][name] ??= { calls: 0, errors: 0, last: 0 })
        into.calls += Number(e.calls) || 0
        into.errors += Number(e.errors) || 0
        into.last = Math.max(into.last, Number(e.last) || 0)
      }
    }
  }
  return out
}

/**
 * Used and never used, per kind. `known` is what exists ({ tools, skills, agents, commands }: arrays of names; a kind left out has no "never"
 * list). `used` is most-called first; `other` are names that were counted but are not in `known` (a skill read on demand, a tool since removed).
 */
export function summarize(usage, known = {}) {
  const out = {}
  for (const kind of KINDS) {
    const counted = Object.entries(usage[kind] ?? {}).map(([name, e]) => ({ name, ...e })).sort((a, b) => b.calls - a.calls || (a.name < b.name ? -1 : 1))
    const have = Array.isArray(known[kind]) ? new Set(known[kind]) : null
    const used = have ? counted.filter(e => have.has(e.name)) : counted
    out[kind] = {
      calls: counted.reduce((n, e) => n + e.calls, 0),
      errors: counted.reduce((n, e) => n + e.errors, 0),
      used,
      other: have ? counted.filter(e => !have.has(e.name)) : [],
      never: have ? [...have].filter(n => !(usage[kind] ?? {})[n]).sort() : null,
      known: have ? have.size : null,
    }
  }
  return out
}

const day = ms => new Date(ms).toISOString().slice(0, 10)
const list = (names, limit) => (names.length > limit ? `${names.slice(0, limit).join(', ')} and ${names.length - limit} more (all of them: --all)` : names.join(', '))

/** The one line the doctor shows. */
export function summaryLine(usage, known = {}) {
  if (usage.files === 0) return 'no counts yet; they build up as tools, skills and commands are used. /academic usage shows them'
  const s = summarize(usage, known)
  const neverTools = s.tools.never ? `; ${s.tools.never.length} of ${s.tools.known} tools never called` : ''
  const skills = s.skills.known ? `; ${s.skills.used.length} of ${s.skills.known} skills used` : ''
  return `since ${day(usage.since)}: ${s.tools.calls} tool call${s.tools.calls === 1 ? '' : 's'} across ${s.tools.used.length + s.tools.other.length} tool${s.tools.used.length + s.tools.other.length === 1 ? '' : 's'}${neverTools}${skills}. /academic usage lists what was used and what never was`
}

/** The full report as text. `all` lists every name; otherwise the most used and the first of the never used. */
export function formatReport(usage, known = {}, { all = false } = {}) {
  if (usage.files === 0) return 'No usage has been counted yet. Counts build up as tools, skills, agents and commands are used; they are names and numbers only and stay on this machine.'
  const s = summarize(usage, known)
  const top = all ? Infinity : 12
  const never = all ? Infinity : 40
  const lines = [`Usage since ${day(usage.since)} (last ${day(usage.last ?? usage.since)}; ${usage.files} writer file${usage.files === 1 ? '' : 's'}). Names and counts only; nothing leaves this machine. Counting is off with the usage_counts setting or AH_USAGE=0.`]
  const section = (label, kind, noun) => {
    const k = s[kind]
    lines.push('', `${label}: ${k.calls} ${kind === 'commands' ? 'run' : 'use'}${k.calls === 1 ? '' : 's'}${k.errors ? `, ${k.errors} failed` : ''}${k.known ? `; ${k.used.length} of ${k.known} ${noun} used` : ''}`)
    if (k.used.length) lines.push(`  most used: ${k.used.slice(0, top).map(e => `${e.name} ${e.calls}${e.errors ? ` (${e.errors} failed)` : ''}`).join(' · ')}${k.used.length > top ? ` · and ${k.used.length - top} more` : ''}`)
    if (k.other.length) lines.push(`  counted, not in this build's list: ${list(k.other.map(e => `${e.name} ${e.calls}`), top)}`)
    if (k.never?.length) lines.push(`  never used (${k.never.length}): ${list(k.never, never)}`)
  }
  section('Tools', 'tools', 'tools')
  section('Skills', 'skills', 'skills')
  section('Agents', 'agents', 'agents')
  section('Commands', 'commands', 'commands')
  lines.push('', 'A name that was never used is a question for the next review of what the plugin leaves out (docs/design/fit-review.md), not a verdict: some are for rare jobs, and counting only started on the date above.')
  return lines.join('\n')
}
