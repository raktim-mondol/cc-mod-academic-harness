// The environment the upstream modules run in. Called once, before any of them is imported.
import { mkdirSync } from 'node:fs'
import { isDevMode, modHome } from './paths.mjs'

export const KEY_ENV_PREFIX = 'AH_KEY_'

/** Installers switched off in development mode and for modules the host does not load yet. */
const SKIP_FLAGS = ['ACADEMIC_HARNESS_SKIP_INSTALL', 'ACADEMIC_HARNESS_MODAL_SKIP_INSTALL', 'TEXTFOLD_SKIP_INSTALL', 'PAPERMEMORY_SKIP_INSTALL', 'ZVEC_GREP_SKIP_INSTALL']

/**
 * Plugin userConfig reaches the server as AH_KEY_<NAME> (an unset field arrives as ""). Copy each
 * non-empty value to <NAME> unless the shell already set <NAME>: upstream's resolveEnv() reads
 * process.env first and treats an empty string as unset, and a key the person exported must not be
 * masked by an empty config field. Returns the names that were set, never the values.
 */
export function applyKeyEnv(env) {
  const set = []
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith(KEY_ENV_PREFIX)) continue
    const name = k.slice(KEY_ENV_PREFIX.length)
    const value = typeof v === 'string' ? v.trim() : ''
    if (name && value && !env[name]?.trim()) { env[name] = value; set.push(name) }
  }
  return set
}

export function prepareEnv(env = process.env) {
  const home = modHome(env)
  mkdirSync(home, { recursive: true })
  env.DSH_HOME = home
  for (const flag of SKIP_FLAGS) env[flag] ??= '1'
  if (isDevMode(env)) env.AH_DEV_MODE = '1'
  return applyKeyEnv(env)
}
