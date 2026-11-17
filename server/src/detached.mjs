// Run one of the mod's own scripts as a process that outlives this one.
//
// Why: the server does two long jobs on a first start (setting up the core, building the writing engine's environment). A session can be
// over in seconds (`claude -p`), and work that lives in the server is cut short when the session ends; a run of such sessions would never finish
// it. A detached worker goes on, and the next server finds it running (each job leaves its pid in a file) or finds the work done.
import { spawn } from 'node:child_process'

/**
 * Start `script` with this Node, detached and silent. Resolves its exit code when it ends, or null when it could not be started; never rejects.
 * `onStart(pid)` is called once the process exists, before it has run a line: the place to leave its pid where others look for it.
 */
export function runDetached(script, { env = process.env, args = [], onStart } = {}) {
  return new Promise(resolve => {
    let settled = false
    // The worker is unref'd so that it never holds this process open by itself; this timer holds it until the worker has ended. Without it a
    // process with nothing else pending (a test, on Node 22) ends before the promise is settled. The server's own exit is explicit, so it is not delayed.
    const hold = setInterval(() => {}, 60_000)
    const finish = code => { if (settled) return; settled = true; clearInterval(hold); resolve(code) }
    let child
    try {
      child = spawn(process.execPath, [script, ...args], { detached: true, stdio: 'ignore', env })
    } catch {
      finish(null)
      return
    }
    child.on('error', () => finish(null))
    child.on('exit', code => finish(code ?? 1))
    child.unref()
    try { if (Number.isInteger(child.pid)) onStart?.(child.pid) } catch { /* the worker leaves its own word */ }
  })
}
