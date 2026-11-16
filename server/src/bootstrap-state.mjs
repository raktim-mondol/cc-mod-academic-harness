// What the first-start fetch of the source snapshot is doing, as a small file the doctor can read while the server works.
//
//   <home>/bootstrap.json   { pid, step, startedAt, error? }   written when a server starts the fetch, removed when it succeeds
//
// A file whose pid is dead and that carries no error is stale (the server was killed mid-fetch): it counts as no fetch running.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { modHome } from './paths.mjs'

export const stateFile = (env = process.env) => join(modHome(env), 'bootstrap.json')

export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error?.code === 'EPERM' }
}

/** The state, or null when no fetch is running and none failed. */
export function readState(env = process.env) {
  const file = stateFile(env)
  if (!existsSync(file)) return null
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'))
    if (!s.error && !alive(s.pid)) return null
    return s
  } catch {
    return null
  }
}

export function writeState(state, env = process.env) {
  const file = stateFile(env)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(state)}\n`)
}

/**
 * Take the fetch for this process, atomically: the file is created only if absent, so two servers that start together do not both fetch.
 * Returns false when another live process holds it. A stale file (its process is gone), a failed one and one of ours are taken over.
 */
export function claim(state, env = process.env) {
  const file = stateFile(env)
  mkdirSync(dirname(file), { recursive: true })
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(file, `${JSON.stringify(state)}\n`, { flag: 'wx' })
      return true
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const current = readState(env)
      if (current && !current.error && current.pid !== process.pid) return false
      rmSync(file, { force: true })
    }
  }
  return false
}

export const clearState = (env = process.env) => rmSync(stateFile(env), { force: true })
