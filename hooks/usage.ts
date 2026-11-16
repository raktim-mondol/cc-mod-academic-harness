import type { EngineInterface, On, PluginOptions } from 'claude-code'

import { modHomeOf } from './jobs-core'
import { seenName } from './seen'

// Usage counts, the hooks module's part (the `ah` server counts its own tools: server/src/usage.mjs, which says what is kept and where).
//
// This module sees what the server cannot: the plugin's skills and agents that the model starts (the `Skill` and `Agent` tools), and the
// slash commands run. It keeps names and counts only, in `<mod home>/usage/hook-<session>.json`, the same shape the server's files have, and
// never an argument, a path or a prompt. Off with the usage_counts setting.
//
// Helpers here take `$` as a parameter and call it in full: the engine reads this source statically and refuses an aliased `$`.

export const PLUGIN_NAME = 'academic-harness'
export const USAGE_TOOLS = /^(Skill|Agent|Task)$/
/** Most distinct names kept per kind (server/src/usage.mjs MAX_NAMES). */
export const MAX_NAMES = 500

export type Kind = 'skills' | 'agents' | 'commands'
type Entry = { calls: number; errors: number; last: number }

export const usageOn = (options: PluginOptions): boolean => String(options['usage_counts'] ?? 'on').trim().toLowerCase() !== 'off'

/**
 * The plugin's skill or agent that a tool call starts, or null for anything else (another plugin's skill, a built-in agent). The `Skill` tool
 * names a plugin's skill `<plugin>:<skill>`, and the `Agent` tool names its agent type the same way.
 */
export function observe(e: Record<string, unknown>): { kind: 'skills' | 'agents'; name: string } | null {
  const prefix = `${PLUGIN_NAME}:`
  const take = (v: unknown): string | null => (typeof v === 'string' && v.startsWith(prefix) && v.length > prefix.length ? v.slice(prefix.length).trim() : null)
  const tool = String(e['tool'] ?? '')
  if (tool === 'Skill') {
    const name = take(e['skill'])
    return name ? { kind: 'skills', name } : null
  }
  if (tool === 'Agent' || tool === 'Task') {
    const name = take(e['subagent_type'])
    return name ? { kind: 'agents', name } : null
  }
  return null
}

export function usageFile(modHome: string | undefined, home: string | undefined, session: string): string | null {
  const base = modHomeOf(modHome, home)
  return base ? `${base}/usage/hook-${seenName(session)}` : null
}

const sessions = new Map<string, { startedAt: number; counts: Record<Kind, Record<string, Entry>> }>()

/** Count one use. Never throws and never waits for more than the one write: a count that cannot be kept must not fail what it counts. */
export async function count($: EngineInterface, options: PluginOptions, kind: Kind, name: string): Promise<void> {
  if (!usageOn(options)) return
  try {
    const session = await $.session.id()
    const file = usageFile(await $.env.get('AH_MOD_HOME'), await $.env.get('HOME'), session)
    if (!file) return
    const now = await $.clock.now()
    let held = sessions.get(session)
    if (!held) {
      held = { startedAt: now, counts: { skills: {}, agents: {}, commands: {} } }
      sessions.set(session, held)
    }
    const group = held.counts[kind]
    if (!group[name] && Object.keys(group).length >= MAX_NAMES) return
    const entry = (group[name] ??= { calls: 0, errors: 0, last: 0 })
    entry.calls++
    entry.last = now
    await $.fs.write(file, `${JSON.stringify({ v: 1, id: `hook-${session}`, startedAt: held.startedAt, updatedAt: now, tools: {}, ...held.counts })}\n`)
  } catch {
    // not counted
  }
}

/** A hook that counts the plugin's skills and agents as the model starts them, and lets the call go on unchanged. */
export function registerUsage(on: On, options: PluginOptions): void {
  on('classic.PreToolUse', { tool: USAGE_TOOLS }, async ($, e, next) => {
    const seen = observe(e as Record<string, unknown>)
    if (seen) await count($, options, seen.kind, seen.name)
    return next(e)
  })
}
