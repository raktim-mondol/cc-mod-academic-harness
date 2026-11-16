import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, PromptComposeSection } from 'claude-code'

import type { ModeOverride } from '../types'
import { PLUGIN_ROOT_TOKEN, PROMPT_TEXT, SECTION_ID } from './generated/prompt'
import { composeStatus, live, statusKey } from './ui-core'

// Research mode: while it is on, a prompt.compose hook adds the Academic Harness section.
//
//   /academic on | off | auto | status
//
// `auto` is on in a folder that has (or sits under) an `ah.yaml`, off elsewhere. The setting
// `research_mode` (auto | on | off, default auto) is what a session follows until /academic
// overrides it. The override lives in $.state, so it survives a reload of the mod.
//
// Helpers here take `$` as a parameter and call it in full: the engine reads this source
// statically and refuses an aliased `$`.

export type Setting = 'auto' | 'on' | 'off'
export type Verdict = { isOn: boolean; why: string }

const override = atom({ plugin: 'academic-harness', key: 'override' } as const, null as ModeOverride)

export function settingFrom(options: PluginOptions): Setting {
  const v = options['research_mode']
  return v === 'on' || v === 'off' ? v : 'auto'
}

/** The nearest folder at or above `cwd` that holds an ah.yaml, or null. */
export async function findProject($: EngineInterface, cwd: string): Promise<string | null> {
  let dir = cwd.replace(/\/+$/, '') || '/'
  for (let i = 0; i < 64; i++) {
    if (await $.fs.exists(`${dir === '/' ? '' : dir}/ah.yaml`)) return dir
    if (dir === '/' || dir === '') return null
    dir = dir.slice(0, dir.lastIndexOf('/')) || '/'
  }
  return null
}

export async function verdict($: EngineInterface, options: PluginOptions): Promise<Verdict> {
  const chosen = await read($, override)
  const mode: Setting = chosen ?? settingFrom(options)
  const source = chosen ? 'set with /academic' : 'from the research_mode setting'
  if (mode === 'on') return { isOn: true, why: `on (${source})` }
  if (mode === 'off') return { isOn: false, why: `off (${source})` }
  const project = await findProject($, await $.session.cwd())
  return project
    ? { isOn: true, why: `on (auto: ah.yaml in ${project})` }
    : { isOn: false, why: 'off (auto: no ah.yaml here)' }
}

export async function showStatus($: EngineInterface, options: PluginOptions): Promise<Verdict> {
  const v = await verdict($, options)
  // The one status line of the mod: the mode, the jobs running and the gate (hooks/ui-core.ts, refreshed by hooks/ui.tsx).
  $.ui.status(composeStatus(v.isOn, live.jobs, live.gate))
  live.shownKey = statusKey(live.jobs, live.gate)
  return v
}

/** Add the research section to the composed system prompt when the mode is on. */
export async function addSection($: EngineInterface, options: PluginOptions, sections: readonly PromptComposeSection[]): Promise<readonly PromptComposeSection[]> {
  if (!(await verdict($, options)).isOn) return sections
  const text = PROMPT_TEXT.split(PLUGIN_ROOT_TOKEN).join($.plugin.root)
  return [...sections.filter(s => s.id !== SECTION_ID), { id: SECTION_ID, text, scope: 'session' }]
}

export const USAGE = 'Usage: /academic [on | off | auto | status | pane | doctor]  (bare /academic opens the pane)'

/** The /academic command. Returns the text to show. */
export async function run($: EngineInterface, options: PluginOptions, args: string): Promise<string> {
  const word = (args ?? '').trim().toLowerCase()
  if (word === 'on' || word === 'off' || word === 'auto') {
    await update($, override, () => word)
  } else if (word !== '' && word !== 'status' && word !== 'pane') {
    return `Unknown argument "${word}". ${USAGE}`
  }
  const v = await showStatus($, options)
  return `Research mode is ${v.why}. ${USAGE}`
}
