// The skills this build lists: the folders under the plugin's skills/ directory.
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
