// The skills and agents this build lists: the folders under the plugin's skills/ directory, the files under agents/.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { modRoot } from './paths.mjs'

export function listedSkills(dir = join(modRoot(), 'skills')) {
  try {
    return new Set(existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) : [])
  } catch {
    return new Set()
  }
}

/** The agents this build lists: the `.md` files under the plugin's agents/ directory, by name. */
export function listedAgents(dir = join(modRoot(), 'agents')) {
  try {
    return new Set(existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile() && d.name.endsWith('.md')).map(d => d.name.slice(0, -3)) : [])
  } catch {
    return new Set()
  }
}
