// Find the writing engine's launcher the way upstream does (academic-harness-cli.js) and say what is wrong when there is none.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { engineDir, engineStatus } from './engine.mjs'
import { installing } from './engine-install.mjs'
import { coreDir } from './paths.mjs'

/** { cli, launch } with upstream's helpers and the command to run, or { error } worded for a person. */
export async function loadEngine(env = process.env) {
  env.ACADEMIC_HARNESS_SKIP_INSTALL = '1'
  const status = engineStatus(env, undefined, { verify: false })
  if (!status.ok) return { error: installing(engineDir(coreDir(env))) ? 'the engine is being installed (it takes under a minute)' : status.why }
  const cliFile = join(coreDir(env), 'academic-harness-cli.js')
  if (!existsSync(cliFile)) return { error: `${cliFile} is missing; run node scripts/setup.mjs` }
  const cli = await import(pathToFileURL(cliFile).href)
  const launch = cli.resolveAhLaunch()
  return launch ? { cli, launch } : { error: 'the engine launcher resolved nothing' }
}
