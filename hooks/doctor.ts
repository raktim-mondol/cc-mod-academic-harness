import type { EngineInterface } from 'claude-code'

import { toolName } from './tasks-core'

// `/academic doctor`: what is ready and what is not. The question goes to the running `ah` server (its `doctor` tool), which knows the
// keys the person saved in the plugin's options and which tool modules it loaded. If the server is not there (the snapshot is missing, so
// it exited), the same report is made by server/bin/ah-doctor.mjs, which needs nothing from the snapshot to say what is missing.
//
// Helpers here take `$` as a parameter and call it in full: the engine reads this source statically and refuses an aliased `$`.
export async function doctorText($: EngineInterface, args: string): Promise<string> {
  try {
    const answered = (await $.tool.call({ tool: toolName('doctor') })) as { text?: string; deny?: string; isError?: boolean }
    if (typeof answered.text === 'string' && !answered.isError && answered.deny === undefined) return answered.text
  } catch {
    // no such tool: the server is not running
  }
  try {
    const r = await $.process.run(['node', `${$.plugin.root}/server/bin/ah-doctor.mjs`], { cwd: await $.session.cwd(), timeoutMs: 60_000 })
    const text = (r.stdout || r.stderr || '').trim()
    if (text) return `${text}\n\n(The academic-harness server is not connected, so this is the report from a fresh process; keys saved in the plugin's options are not visible to it.)`
  } catch {
    // fall through
  }
  return 'The doctor could not run: the academic-harness server is not connected and `node server/bin/ah-doctor.mjs` did not answer. Run `node scripts/setup.mjs` in the plugin folder.'
}

/**
 * `/academic usage`: which tools, skills, agents and commands were used and which never were. Asked of the running server (it knows which tools
 * it offers); without it, server/bin/ah-doctor.mjs reads the same counts from disk and cannot name the tools that were never called.
 */
export async function usageText($: EngineInterface, args: string): Promise<string> {
  const all = /(^|\s)--?all\b/.test(args)
  try {
    const answered = (await $.tool.call({ tool: toolName('doctor'), usage: true, ...(all ? { all: true } : {}) })) as { text?: string; deny?: string; isError?: boolean }
    if (typeof answered.text === 'string' && !answered.isError && answered.deny === undefined) return answered.text
  } catch {
    // no such tool: the server is not running
  }
  try {
    const r = await $.process.run(['node', `${$.plugin.root}/server/bin/ah-doctor.mjs`, '--usage', ...(all ? ['--all'] : [])], { cwd: await $.session.cwd(), timeoutMs: 60_000 })
    const text = (r.stdout || r.stderr || '').trim()
    if (text) return `${text}\n\n(The academic-harness server is not connected, so the tools that were never called are not listed.)`
  } catch {
    // fall through
  }
  return 'The usage report could not run: the academic-harness server is not connected and `node server/bin/ah-doctor.mjs --usage` did not answer.'
}
