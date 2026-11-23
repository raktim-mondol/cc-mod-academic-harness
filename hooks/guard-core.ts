// The guard's pure parts: no `$`, no process, so tests can drive them directly.
//
// The engine (`ah hook <event>`) speaks the settings-hook JSON of Claude Code. The hooks module speaks
// function-hook results. This file translates between the two and holds the fail-closed rules.

/** The built-in tools the engine's `pre` check reads. Everything else passes with no process started. */
export const GUARDED_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'] as const
/** Tools after which the engine's `post` check looks at the prose. NotebookEdit cannot write a LaTeX file. */
export const POST_TOOLS = ['Write', 'Edit', 'MultiEdit', 'Bash'] as const

/** Matchers for the hooks. MultiEdit is not a built-in of this Claude Code release, so a regular expression names it without a type error. */
export const GUARDED_MATCH = new RegExp(`^(${GUARDED_TOOLS.join('|')})$`)
export const POST_MATCH = new RegExp(`^(${POST_TOOLS.join('|')})$`)

export const PLUGIN_PREFIX = 'mcp__plugin_academic-harness_ah__'

export type EngineReply = {
  additionalContext?: string
  deny: boolean
  reason?: string
  decision?: string
  systemMessage?: string
  raw: Record<string, unknown>
}

const REPLY_KEYS = [
  'hookSpecificOutput', 'decision', 'additionalContext', 'systemMessage', 'reason',
  // The other fields of Claude Code's settings-hook result: a reply that only carries one of them is still a reply.
  'continue', 'stopReason', 'suppressOutput', 'hookEventName', 'permissionDecision', 'permissionDecisionReason',
]

/** The first complete JSON object in a stream that looks like a hook reply, even when a warning or a log line shares it. */
function firstReplyObject(text: string): unknown {
  let from = 0
  for (;;) {
    const start = text.indexOf('{', from)
    if (start === -1) return null
    let depth = 0
    let inString = false
    let escaped = false
    let end = -1
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{') depth++
      else if (ch === '}' && --depth === 0) { end = i; break }
    }
    if (end === -1) return null
    try {
      const parsed = JSON.parse(text.slice(start, end + 1))
      // A JSON log line is not the reply: skip it whole and keep looking. An empty object is the engine saying "no decision".
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (Object.keys(parsed).length === 0 || REPLY_KEYS.some(k => k in parsed))) return parsed
    } catch { /* not JSON at this brace: try the next */ }
    from = end + 1
  }
}

/** The engine's reply in its stdout, or null when stdout is empty or holds no reply-shaped object. */
export function parseEngineStdout(stdout: string): EngineReply | null {
  const text = String(stdout ?? '').trim()
  if (!text) return null
  const parsed = firstReplyObject(text) as Record<string, any> | null
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  // The engine usually wraps its fields in hookSpecificOutput; a plain result on its own is read the same way.
  const spec = parsed.hookSpecificOutput && typeof parsed.hookSpecificOutput === 'object' ? parsed.hookSpecificOutput : parsed
  const additionalContext: string | undefined = spec.additionalContext || (typeof parsed.additionalContext === 'string' ? parsed.additionalContext : undefined)
  const deny = spec.permissionDecision === 'deny' || parsed.decision === 'block' || parsed.decision === 'deny'
  const reason: string | undefined = spec.permissionDecisionReason || parsed.reason || (deny ? additionalContext : undefined)
  return { additionalContext, deny, reason, decision: parsed.decision, systemMessage: parsed.systemMessage, raw: parsed }
}

/** Did the engine process answer (exit 0) with output that is empty or a JSON object? Anything else is a failure. */
export function engineAnswered(exitCode: number, stdout: string): boolean {
  if (exitCode !== 0) return false
  const text = String(stdout ?? '').trim()
  return text === '' || parseEngineStdout(text) !== null
}

// ---- wording: the engine writes for a model that has `ah` in its shell; here it has the ah_* tools ----

const SHELL_SENTENCE = /^Harness commands run in your shell as `ah \.\.\.`[^\n]*\n?/m
const DECIDE_COMMAND = /`ah finding decide[^`]*`/g

export const STATE_FOOTER = `In Claude Code there is no \`ah\` command in your shell. Use the ah_* tools of the academic-harness server instead (load them with ToolSearch; their full names start with ${PLUGIN_PREFIX}): ah_state, ah_check, ah_audit, ah_inventory, ah_units, ah_fact (action list|build|check), ah_source and ah_source_search, ah_claims, ah_claims_sync, ah_claims_bind, ah_bind, ah_pack, ah_brief_new, ah_plan, ah_sweep, ah_build, ah_findings, ah_decision_request, ah_review, ah_review_set, ah_review_respond, ah_fact_propose, ah_snapshot, ah_provenance, ah_disclosure, ah_external, ah_rubric, ah_precision, ah_rule_propose, ah_triage, ah_done, ah_profile, ah_config, ah_catalogue, ah_init, ah_migrate.
Where the text above shows a shell command, use the tool: \`ah finding decide <id> --reason "..."\` is ah_decision_request (fingerprint, question); \`ah facts list\` is ah_fact with action=list; \`ah check\` is ah_check; \`ah pack <brief>\` is ah_pack.
You cannot waive findings, approve briefs or plans, accept or reject fact proposals, verify claims, decline a review item, fill provenance, approve a disclosure, or admit a rubric criterion. Call ah_decision_request and stop. If the human explicitly asked for one of these acts in this message, ah_author runs it and Claude Code asks them to confirm.
Numbers from data are \\fact{id}. Cite only registered sources. Keep every "%% @unit" line with its paragraph. Done means coverage is complete and this turn introduced no open blocker or major.`

/** The paper-state card with the shell sentence removed and the tool footer added. */
export function withFooter(text: string): string {
  const body = String(text ?? '').replace(SHELL_SENTENCE, '').trim()
  return body ? `${body}\n\n${STATE_FOOTER}` : STATE_FOOTER
}

/** A denial or note from the engine, with its one shell command named as the tool that does the same. */
export function forTools(text: string): string {
  return String(text ?? '').replace(DECIDE_COMMAND, 'the ah_decision_request tool (fingerprint, question)')
}

// ---- the PreToolUse envelope becomes the settings-hook payload ----

export type Session = { id: string; cwd: string; transcript?: string }

/** `e` of classic.PreToolUse is `{ tool, tool_use_id, ...arguments }`. The engine wants `tool_name` and `tool_input`. */
export function preToolPayload(e: Record<string, unknown>, session: Session): Record<string, unknown> {
  const { tool, tool_use_id, ...args } = e
  return {
    hook_event_name: 'PreToolUse',
    session_id: session.id,
    cwd: session.cwd,
    transcript_path: session.transcript ?? '',
    tool_name: tool,
    tool_input: args,
    tool_use_id,
  }
}

/** The post-edit event, without the tool's response (it can be large and the engine does not read it). */
export function postToolPayload(e: Record<string, any>): Record<string, unknown> {
  const { tool_response: _dropped, ...rest } = e
  void _dropped
  return rest
}

// ---- failing closed ----

/** What the model reads when a mutating call could not be checked. It says what to do, not only what went wrong. */
export function failClosedReason(tool: string, why: string): string {
  return `AH guard: this ${tool} call could not be checked (${why}), so it was not run. This project has an ah.yaml and its protected files must not change unchecked. `
    + 'Reading still works. Tell the author the guard is unavailable; to repair it run `node scripts/install-engine.mjs` in the academic-harness plugin folder, or set AH_NO_ENFORCE=1 to work without the guard.'
}

/** The text for the `.catch` handler of a gating hook. It must not start a process (its budget is one second). */
export function caughtReason(tool: string, error: unknown): string {
  const why = error instanceof Error ? error.message : typeof error === 'string' ? error : 'the guard hook failed'
  return failClosedReason(tool, why.slice(0, 160))
}

// ---- the stop gate ----

export function isHandoffMessage(text: string): boolean {
  const s = String(text ?? '')
  return /AH gate: stop(?:ping|ped) after /i.test(s) || /The author decides what to do next/.test(s)
}

export type GateDecision =
  | { kind: 'none' }
  | { kind: 'continue'; text: string }
  | { kind: 'handoff'; text: string }
  | { kind: 't3'; text: string }

/**
 * What the engine's stop answer means for this turn.
 *   continue  the edits introduced blockers: keep the model working on them
 *   handoff   the engine gave up after its attempts: one more turn for the model to report them to the author
 *   t3        an advisory evidence-check note, shown once
 */
export function gateDecision(out: EngineReply | null, state: { alreadyHandedOff?: boolean; alreadyT3?: boolean } = {}): GateDecision {
  const text = out?.reason || out?.systemMessage || out?.additionalContext
  if (!text) return { kind: 'none' }
  if (out?.decision === 'block' || (out?.deny && !isHandoffMessage(text))) return { kind: 'continue', text: forTools(text) }
  if (isHandoffMessage(text)) {
    if (state.alreadyHandedOff) return { kind: 'none' }
    return { kind: 'handoff', text: `${forTools(text)}\n\nSTOP. Report these findings to the author. Do not edit further. You cannot waive them.` }
  }
  if (state.alreadyT3) return { kind: 'none' }
  return { kind: 't3', text: `${forTools(text)}\nThis note is advisory and does not block. Read flagged clauses against the sources before you rely on them.` }
}

/** AH_T3_MODE for the engine: the evidence check calls a verifier model per changed paragraph, so it is off unless chosen. */
export function t3Mode(setting: unknown): 'run' | 'skip' {
  return String(setting ?? '').trim().toLowerCase() === 'run' ? 'run' : 'skip'
}

// ---- author-only acts ----

export const AUTHOR_TOOL = `${PLUGIN_PREFIX}ah_author`
export const MIGRATE_TOOL = `${PLUGIN_PREFIX}ah_migrate`

export const AUTHOR_ASK_REASON = 'Author-only Academic Harness act (waive, accept or reject a fact, approve a brief or plan, verify a claim, decline a review item, fill provenance, approve a disclosure, admit a rubric criterion). Confirm to run it. If you did not ask for this, choose No.'
export const AUTHOR_HEADLESS_HINT = ' Nobody is available to confirm in a non-interactive session, so the call is refused: run it from an interactive session.'

export const MIGRATE_REASON = 'AH guard: applying migrate rewrites the tree. Pass confirm=true after the author agrees, or run a dry plan first.'

/** The two upstream rules for the ah_* tools themselves, as a check result or null when the call may go on. */
export function authorCheck(tool: string, input: any): { decision: 'ask' | 'deny'; reason: string } | null {
  if (tool === AUTHOR_TOOL) return { decision: 'ask', reason: AUTHOR_ASK_REASON }
  if (tool === MIGRATE_TOOL && input?.apply && !input?.confirm) return { decision: 'deny', reason: MIGRATE_REASON }
  return null
}

// ---- Paper2MCP servers ----

export const PAPER_MCP_TOOL = `${PLUGIN_PREFIX}paper_mcp`
export const PAPER_MCP_HEADLESS_HINT = ' Nobody is available to confirm in a non-interactive session, so the call is refused: register the server from an interactive session.'

/** What the person is shown before paper_mcp writes a server into the project's .mcp.json: the program that will run, where, and which variables it can read. */
export function paperMcpReason(input: any): string {
  const name = String(input?.serverName ?? '').slice(0, 64) || '(no name)'
  const cmd = [input?.command, ...(Array.isArray(input?.args) ? input.args : [])].map(v => String(v ?? '')).filter(Boolean).join(' ').slice(0, 400)
  const env = Array.isArray(input?.envNames) && input.envNames.length ? ` It can read these variables from your shell: ${input.envNames.map((n: unknown) => String(n)).join(', ').slice(0, 200)}.` : ' It is given no secret variables.'
  const what = input?.action === 'approve'
    ? `Approve the Paper2MCP server "${name}" that is already in this project's .dsh/paper-mcps.json and write it into .mcp.json.`
    : `Register the Paper2MCP server "${name}" in this project's .mcp.json: ${cmd || '(no command)'}${input?.cwd ? ` in ${String(input.cwd).slice(0, 200)}` : ''}.`
  return `${what}${env} Claude Code will ask again before it starts the server. Confirm only if you asked for this and recognise the program.`
}

/** register and approve write something that runs a program the next time the project loads, so they ask. status and unregister do not. */
export function paperMcpCheck(tool: string, input: any): { decision: 'ask'; reason: string } | null {
  if (tool !== PAPER_MCP_TOOL) return null
  if (input?.action !== 'register' && input?.action !== 'approve') return null
  return { decision: 'ask', reason: paperMcpReason(input) }
}

// ---- paid compute ----

export const COMPUTE_TOOLS = ['modal_run', 'runpod_run', 'vastai_run'] as const
export const COMPUTE_MATCH = new RegExp(`^${PLUGIN_PREFIX}(${COMPUTE_TOOLS.join('|')})$`)
export const COMPUTE_FALLBACK_REASON = 'This starts a paid run on rented hardware, which bills by the hour. Confirm to start it.'
export const COMPUTE_HEADLESS_HINT = ' Nobody is available to confirm in a non-interactive session, so the call is refused: run it from an interactive session.'

export type Verdict = { decision: 'ask' | 'deny'; reason: string }

/** What server/bin/ah-approve.mjs printed, as a verdict. It never allows: anything unreadable asks, with the plain reason. */
export function computeVerdict(stdout: string, approver: unknown): Verdict {
  let parsed: any = null
  try {
    parsed = JSON.parse(String(stdout ?? '').trim().split('\n').pop() ?? '')
  } catch {
    parsed = null
  }
  const reason = typeof parsed?.reason === 'string' && parsed.reason ? parsed.reason : COMPUTE_FALLBACK_REASON
  if (parsed?.decision === 'deny') return { decision: 'deny', reason }
  return { decision: 'ask', reason: approver === 'person' ? reason : reason + COMPUTE_HEADLESS_HINT }
}

/** The tool a check names, without the plugin prefix. */
export function bareTool(tool: string): string {
  return tool.startsWith(PLUGIN_PREFIX) ? tool.slice(PLUGIN_PREFIX.length) : tool
}
