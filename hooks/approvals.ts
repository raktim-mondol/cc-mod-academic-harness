import type { On, PluginOptions } from 'claude-code'

import { AUTHOR_ASK_REASON, AUTHOR_HEADLESS_HINT, AUTHOR_TOOL, authorCheck, bareTool, COMPUTE_FALLBACK_REASON, COMPUTE_MATCH, computeVerdict, MIGRATE_TOOL, PAPER_MCP_HEADLESS_HINT, PAPER_MCP_TOOL, paperMcpCheck } from './guard-core'

// Author-only acts, risky rewrites and paid compute, asked about through tool.check.
//
//   ah_author                      ask. The person sees the reason and chooses. Where nobody can answer (claude -p, the Agent SDK)
//                                  an ask is a refusal, so the reason then says how to proceed.
//   ah_migrate apply, no confirm   deny
//   paper_mcp register / approve   ask, with the program that will run: the entry is written to .mcp.json and Claude Code starts it
//                                  when the project next loads. Where nobody can answer, an ask is a refusal.
//   modal_run, runpod_run, vastai_run   always ask, in any folder, with the provider, instance, time limit, cost ceiling and the session
//                                  budget in the reason (upstream's own text, from server/bin/ah-approve.mjs). A run that cannot fit under
//                                  the session cap is refused here with the numbers. The tools enforce the cap again when they run.
export function registerApprovals(on: On, options: PluginOptions): void {
  on('tool.check', { tool: [AUTHOR_TOOL, MIGRATE_TOOL] }, async ($, e, next) => {
    const verdict = authorCheck(String(e.tool), e.input)
    if (!verdict) return next(e)
    if (verdict.decision === 'ask') return { decision: 'ask', reason: e.approver === 'person' ? AUTHOR_ASK_REASON : AUTHOR_ASK_REASON + AUTHOR_HEADLESS_HINT }
    return { decision: 'deny', reason: verdict.reason }
  })

  on('tool.check', { tool: PAPER_MCP_TOOL }, async ($, e, next) => {
    const verdict = paperMcpCheck(String(e.tool), e.input)
    if (!verdict) return next(e)
    return { decision: 'ask', reason: e.approver === 'person' ? verdict.reason : verdict.reason + PAPER_MCP_HEADLESS_HINT }
  })

  on('tool.check', { tool: COMPUTE_MATCH }, async ($, e) => {
    let stdout = ''
    try {
      const cap = String(options['compute_session_cap_usd'] ?? '').trim()
      const r = await $.process.run(['node', `${$.plugin.root}/server/bin/ah-approve.mjs`], {
        cwd: await $.session.cwd(),
        stdin: `${JSON.stringify({ tool: bareTool(String(e.tool)), input: e.input, session_id: await $.session.id(), cwd: await $.session.cwd() })}\n`,
        env: cap ? { AH_KEY_COMPUTE_SESSION_CAP_USD: cap } : {},
        timeoutMs: 30_000,
      })
      stdout = r.stdout
    } catch {
      stdout = ''
    }
    return computeVerdict(stdout, e.approver)
    // never `next(e)`: whatever else says, rented hardware asks
  }).catch((_$, e) => ({ decision: 'ask', reason: e.approver === 'person' ? COMPUTE_FALLBACK_REASON : COMPUTE_FALLBACK_REASON + ' Nobody is available to confirm in a non-interactive session, so the call is refused.' }))
}
