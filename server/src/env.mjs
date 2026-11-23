// The environment the upstream modules run in. Called once, before any of them is imported.
import { mkdirSync } from 'node:fs'
import { isDevMode, modHome } from './paths.mjs'
import { rsiMode } from './rsi-mode.mjs'

export const KEY_ENV_PREFIX = 'AH_KEY_'

/** Installers that stay off: the engine's (the mod builds it itself, engine-install.mjs), PaperMemory's (its launcher installs it) and zvec-grep's (zvec_index drives the `zg` you already have and never installs a package behind your back). */
const ALWAYS_SKIP = ['ACADEMIC_HARNESS_SKIP_INSTALL', 'PAPERMEMORY_SKIP_INSTALL', 'ZVEC_GREP_SKIP_INSTALL']
/**
 * Installers that run in the background, into the mod's home, when a module that needs them is loaded (plan P2 step 6):
 * flag -> the areas whose modules read it. `AH_MANAGED_INSTALLS=0` switches them off (tests, offline use).
 */
export const MANAGED_INSTALLS = {
  TEXTFOLD_SKIP_INSTALL: ['notebook', 'submission'],
  ACADEMIC_HARNESS_MODAL_SKIP_INSTALL: ['compute'],
}

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

/**
 * `areas` are the tool areas the host will load. Given, the managed installers of those areas are left on; without it
 * (a tool that only reads, a test) every installer is off. A flag the person set always wins.
 */
export function prepareEnv(env = process.env, { areas } = {}) {
  const home = modHome(env)
  mkdirSync(home, { recursive: true })
  env.DSH_HOME = home
  const managed = Array.isArray(areas) && env.AH_MANAGED_INSTALLS?.trim() !== '0' && !isDevMode(env)
  for (const flag of ALWAYS_SKIP) env[flag] ??= '1'
  for (const [flag, needed] of Object.entries(MANAGED_INSTALLS)) {
    if (env[flag] !== undefined) continue
    if (!(managed && needed.some(a => areas.includes(a)))) env[flag] = '1'
  }
  // The self-improvement loop's mode, settled once for the core (rsi-store.js reads AH_RSI): the shell's variable, else the plugin option (AH_RSI_SETTING),
  // else off. A value that is not a mode is off (rsi-mode.mjs).
  env.AH_RSI = rsiMode(env)
  if (isDevMode(env)) env.AH_DEV_MODE = '1'
  return applyKeyEnv(env)
}
