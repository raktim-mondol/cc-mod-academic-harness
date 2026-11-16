// The model route (decision D7, candidate A): `ctx.llm.stream(...)` answered by a headless Claude Code child.
//
//   claude -p --safe-mode --tools "" --model <m> --system-prompt <s> --output-format json --no-session-persistence
//
// `--safe-mode` starts with no plugins, hooks, MCP servers or skills, so the child cannot call this mod back, and
// `--tools ""` leaves it nothing to do but answer. It runs under the person's own Claude Code login (no key), about two
// seconds a call. Candidate B (the Anthropic API with ANTHROPIC_API_KEY) was not built: a call here costs the same
// tokens and the login route needs no setup.
//
// What upstream's callers consume (deep-research-steps.js `createLlmRunner`, deep-review.js `startLlmBridge`):
//   for await (const chunk of ctx.llm.stream({ provider, model, system, messages, temperature, maxTokens, signal }))
//     { type: 'text-delta', text }  { type: 'usage', usage: { inputTokens, outputTokens, totalTokens } }
//     { type: 'finish', reason: { kind: 'stop' | 'max-tokens' | 'error' | 'aborted', failure?: { message } } }
//   messages: [{ role, content: [{ type: 'text', text }] }]
// `temperature` has no flag in the child and is not applied; `maxTokens` goes to CLAUDE_CODE_MAX_OUTPUT_TOKENS.
//
// Spend is counted here (the child reports `total_cost_usd`). `budgetUsd` caps the total for this server process and
// each call is capped with `--max-budget-usd`. A call reserves its cap before it starts, so calls that run at the same time can never
// together be allowed more than is left: one that finds nothing left waits for those in flight, and fails with a message that says so
// only when none is in flight and the budget is used up.
//
// A long system prompt goes to the child as a file (`--system-prompt-file`), not as an argument: Linux refuses an argument over 128 KB.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { modHome } from './paths.mjs'

export const DEFAULT_MODEL = 'sonnet'
export const DEFAULT_BUDGET_USD = 5
export const DEFAULT_CALL_BUDGET_USD = 1
export const DEFAULT_CONCURRENCY = 4
/** The smallest cap worth starting a call with. */
export const MIN_CALL_USD = 0.01
/** A system prompt longer than this many characters goes by file (at most 4 bytes a character, so under the 128 KB limit of one argument). */
export const SYSTEM_ARG_LIMIT = 30_000

const text = content => (typeof content === 'string' ? content : Array.isArray(content) ? content.map(p => (typeof p === 'string' ? p : typeof p?.text === 'string' ? p.text : '')).join('') : String(content ?? ''))

/** One prompt from a message list. A single user message is sent as it is; a longer exchange keeps its roles. */
export function promptFrom(messages) {
  const list = (Array.isArray(messages) ? messages : []).map(m => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', text: text(m?.content) })).filter(m => m.text)
  if (list.length === 1 && list[0].role === 'user') return list[0].text
  return list.map(m => `[${m.role}]\n${m.text}`).join('\n\n')
}

export function parseResult(stdout) {
  const t = String(stdout ?? '').trim()
  const i = t.lastIndexOf('\n{')
  const candidates = [t, ...(i >= 0 ? [t.slice(i + 1)] : [])]
  for (const c of candidates) {
    try {
      const j = JSON.parse(c)
      if (j && typeof j === 'object' && j.type === 'result') return j
    } catch { /* try the next */ }
  }
  return null
}

export function createLlm({ bin = process.env.AH_CLAUDE_BIN?.trim() || 'claude', model = DEFAULT_MODEL, budgetUsd = DEFAULT_BUDGET_USD, callBudgetUsd = DEFAULT_CALL_BUDGET_USD, concurrency = DEFAULT_CONCURRENCY, cwd = process.cwd(), env = process.env, spawnFn = spawn } = {}) {
  let spent = 0
  let calls = 0
  let inTokens = 0
  let outTokens = 0
  let active = 0
  let reserved = 0
  const queue = []
  const waiting = []

  const acquire = () => (active < concurrency ? (active++, Promise.resolve()) : new Promise(resolve => queue.push(resolve)))
  const release = () => { const next = queue.shift(); if (next) next(); else active-- }

  /**
   * Set aside up to one call's cap from what is left. Resolves the amount; 0 when the budget is used up and no call in flight can free
   * any; null when `signal` aborted while waiting for a call in flight to end.
   */
  async function reserve(signal) {
    for (;;) {
      const left = budgetUsd - spent - reserved
      if (left >= MIN_CALL_USD) {
        const cap = Math.min(callBudgetUsd, left)
        reserved += cap
        return cap
      }
      if (reserved <= 0) return 0
      await new Promise(resolve => {
        const done = () => { signal?.removeEventListener?.('abort', done); resolve() }
        waiting.push(done)
        signal?.addEventListener?.('abort', done, { once: true })
      })
      if (signal?.aborted) return null
    }
  }
  const unreserve = cap => {
    reserved = Math.max(0, reserved - cap)
    for (const wake of waiting.splice(0)) wake()
  }

  function runChild({ system, prompt, modelName, maxTokens, signal, cap }) {
    return new Promise(resolve => {
      const args = ['-p', '--safe-mode', '--tools', '', '--model', modelName, '--output-format', 'json', '--no-session-persistence', '--max-budget-usd', cap.toFixed(4)]
      let systemFile = null
      if (system && system.length > SYSTEM_ARG_LIMIT) {
        try {
          const dir = join(modHome(env), 'tmp')
          mkdirSync(dir, { recursive: true })
          systemFile = join(dir, `system-${randomUUID()}.txt`)
          writeFileSync(systemFile, system, { mode: 0o600 })
          args.push('--system-prompt-file', systemFile)
        } catch (error) {
          return resolve({ error: `could not write the system prompt for the model child: ${error.message}` })
        }
      } else if (system) args.push('--system-prompt', system)
      const removeSystemFile = () => { if (systemFile) rmSync(systemFile, { force: true }) }
      const childEnv = { ...env }
      if (Number.isFinite(maxTokens) && maxTokens > 0) childEnv.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(Math.floor(maxTokens))
      let child
      try {
        child = spawnFn(bin, args, { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] })
      } catch (error) {
        removeSystemFile()
        return resolve({ error: `could not start ${bin}: ${error.message}` })
      }
      let out = ''
      let err = ''
      let settled = false
      const finish = r => { if (!settled) { settled = true; signal?.removeEventListener?.('abort', onAbort); removeSystemFile(); resolve(r) } }
      const onAbort = () => {
        try { child.kill('SIGTERM') } catch { /* gone */ }
        setTimeout(() => { try { child.kill('SIGKILL') } catch { /* gone */ } }, 3000).unref?.()
        finish({ aborted: true })
      }
      child.stdout.on('data', d => { out += d })
      child.stderr.on('data', d => { err += d })
      child.on('error', error => finish({ error: error.code === 'ENOENT' ? `${bin} was not found on PATH. The model route needs Claude Code (or set AH_CLAUDE_BIN).` : `could not run ${bin}: ${error.message}` }))
      child.on('close', code => finish({ code, out, err }))
      child.stdin.on('error', () => {})
      child.stdin.end(prompt)
      if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }) }
    })
  }

  async function* stream({ model: requested, system, messages, maxTokens, signal } = {}) {
    if (spent >= budgetUsd) {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: `the model budget for this server is used up ($${spent.toFixed(2)} of $${budgetUsd}). Raise the llm_budget_usd setting to go on.` } } }
      return
    }
    await acquire()
    let cap = 0
    try {
      if (signal?.aborted) { yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'cancelled' } } }; return }
      const got = await reserve(signal)
      if (got === null) { yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'cancelled' } } }; return }
      if (got === 0) {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: `the model budget for this server is used up ($${spent.toFixed(2)} of $${budgetUsd}). Raise the llm_budget_usd setting to go on.` } } }
        return
      }
      cap = got
      const modelName = model || requested
      const r = await runChild({ system: text(system), prompt: promptFrom(messages), modelName, maxTokens, signal, cap })
      calls++
      if (r.aborted) { yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'cancelled' } } }; return }
      if (r.error) { yield { type: 'finish', reason: { kind: 'error', failure: { message: r.error } } }; return }
      const j = parseResult(r.out)
      if (!j) {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: `the model child exited ${r.code} with no result${r.err ? `: ${r.err.trim().slice(0, 200)}` : ''}` } } }
        return
      }
      const cost = Number(j.total_cost_usd)
      if (Number.isFinite(cost)) spent += cost
      const u = j.usage ?? {}
      const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
      const output = u.output_tokens ?? 0
      inTokens += input
      outTokens += output
      if (j.is_error) {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: String(j.result || j.subtype || 'the model call failed').slice(0, 300) } } }
        return
      }
      if (typeof j.result === 'string' && j.result) yield { type: 'text-delta', text: j.result }
      yield { type: 'usage', usage: { inputTokens: input, outputTokens: output, totalTokens: input + output, costUsd: Number.isFinite(cost) ? cost : null } }
      yield { type: 'finish', reason: { kind: j.stop_reason === 'max_tokens' ? 'max-tokens' : 'stop' } }
    } finally {
      if (cap > 0) unreserve(cap)
      release()
    }
  }

  return { stream, stats: () => ({ calls, spentUsd: Number(spent.toFixed(6)), budgetUsd, reservedUsd: Number(reserved.toFixed(6)), inputTokens: inTokens, outputTokens: outTokens }), model }
}
