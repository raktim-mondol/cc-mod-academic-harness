#!/usr/bin/env node
// The approval text for a paid-compute call, for the hooks module's tool.check.
//
//   echo '{"tool":"modal_run","input":{...},"session_id":"..."}' | node server/bin/ah-approve.mjs
//   -> {"decision":"ask","reason":"Modal will rent paid hardware: ..."}   or   {"decision":"deny","reason":"Session spend cap reached: ..."}
//
// It uses upstream's own compute-approval.js and compute-ledger.js, so the reason and the cap are the ones DSH shows.
// It reads the spend ledger and reserves nothing. It never answers allow: when anything goes wrong it still asks.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prepareEnv } from '../src/env.mjs'
import { makeExec } from '../src/exec.mjs'
import { adapt } from '../src/render.mjs'
import { coreDir } from '../src/paths.mjs'

const FALLBACK = 'This starts a paid run on rented hardware, which bills by the hour. Confirm to start it.'

async function readStdin() {
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text
}

export async function approve({ tool, input, session_id: sessionId, cwd }, env = process.env) {
  prepareEnv(env)
  try {
    const up = coreDir(env)
    const approval = await import(pathToFileURL(join(up, 'compute-approval.js')).href)
    if (!approval.PAID_COMPUTE_TOOLS.has(tool)) return null
    const ledger = await import(pathToFileURL(join(up, 'compute-ledger.js')).href)
    const exec = makeExec({ name: tool, args: input, callId: 'approve', cwd: cwd || process.cwd(), sessionId })
    let budget = null
    try { budget = await ledger.describeSessionBudget(exec, tool, input) } catch { /* the ledger is unreadable: ask without the numbers */ }
    if (budget?.wouldExceed) return { decision: 'deny', reason: adapt(ledger.refusalText(budget)) }
    return { decision: 'ask', reason: approval.computeApprovalReason(tool, input, budget) ?? FALLBACK }
  } catch {
    return { decision: 'ask', reason: FALLBACK }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  let payload = {}
  try { payload = JSON.parse((await readStdin()) || '{}') } catch { /* ask with the fallback */ }
  const out = (await approve(payload)) ?? { decision: 'ask', reason: FALLBACK }
  process.stdout.write(`${JSON.stringify(out)}\n`)
}
