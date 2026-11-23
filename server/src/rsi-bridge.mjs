// The local self-improvement loop (`ah_rsi`), driven by Claude Code's hook events.
//
// Upstream runs the loop inside one long-lived process, with a turn kept in memory (core/rsi-hooks.js). Claude Code starts a fresh
// process per hook event, so the turn is kept in a small file per session under the mod's home, and this module is the same loop in
// four steps:
//
//   userprompt   close the turn before, open this one, record a stated preference or a "forget that", pick the lessons for this
//                task class and return them as extra context
//   post         one tool's outcome (its name, whether it failed, the findings it reported), added to the open turn
//   stop         close the turn: write the episode, update the lessons it touched, diagnose every few episodes
//
// Everything is fail-soft: the loop must never stop a turn or hold one up, so a problem is returned as `{ error }` and the caller
// ignores it. The store, the lessons and the rules are upstream's own (rsi-store.js, rsi-core.js); nothing here edits code, the
// engine or the project. `AH_RSI=off` stops all of it; `observe` records but injects nothing.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const STATE_KEEP_MS = 7 * 24 * 3600 * 1000

/** JSON that keeps Maps and Sets. */
const replacer = (_k, v) => (v instanceof Map ? { __map: [...v] } : v instanceof Set ? { __set: [...v] } : v)
const reviver = (_k, v) => (v && typeof v === 'object' && Array.isArray(v.__map) ? new Map(v.__map) : v && typeof v === 'object' && Array.isArray(v.__set) ? new Set(v.__set) : v)

/** Claude Code names an MCP tool mcp__<server>__<tool>; the loop knows the bare name. */
export const bareName = name => String(name ?? '').replace(/^mcp__.*__/, '')

const safe = id => String(id || 'default').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)

export async function loadRsi(coreDir) {
  const at = f => import(pathToFileURL(join(coreDir, f)).href)
  const [store, core] = await Promise.all([at('rsi-store.js'), at('rsi-core.js')])
  return { store, core }
}

function newTurn(core, store, state, text) {
  const task = core.classifyTask(text)
  const inherited = task.class === 'general-research' && (text || '').length < 60 && state.lastTaskClass
  if (!inherited && task.class !== 'general-research') state.lastTaskClass = task.class
  return {
    index: state.turnIndex++, startedAt: new Date().toISOString(), startedAtMs: Date.now(),
    promptHash: text ? store.sha1(text, 12) : null, taskClass: inherited || task.class, taskTags: inherited ? [] : task.tags,
    userChars: (text || '').length, turns: 1, toolCounts: {}, errors: 0, corrections: 0, blockingFindings: 0, latestFindingCount: 0,
    correctionMarkers: [], findings: new Map(), signals: new Set(), injectedLessonIds: new Set(), injectedTokens: 0, injectedActions: new Map(),
    reachedLessonIds: new Set(), controlLessonIds: new Set(), eligibleLessonIds: new Set(), toolSignatures: new Set(), gate: null, gateHistory: [],
    qualitySignals: {}, integrityIssue: false, citationIssue: false, statIssue: false, figureIssue: false, repoIssue: false, substantive: false, finalized: false,
  }
}

const clearSignals = (turn, prefix) => { for (const s of [...turn.signals]) if (s.startsWith(prefix)) turn.signals.delete(s) }

/** One tool outcome into the open turn (the same bookkeeping as upstream's tools/post-execute handler). */
export function addTool(turn, summary, args = {}) {
  turn.toolCounts[summary.name] = (turn.toolCounts[summary.name] || 0) + 1
  if (!['AskUserQuestion', 'ask_user_question', 'todo', 'TodoWrite'].includes(summary.name)) turn.substantive = true
  if (summary.is_error) turn.errors += 1
  for (const check of summary.findings || []) { turn.findings.set(check, (turn.findings.get(check) || 0) + 1); turn.signals.add(`finding:${check}`) }
  if (summary.name === 'ah_check' || summary.name === 'ah_audit') {
    turn.blockingFindings = Number(summary.blocking_findings) || (summary.gate_passed === false ? 1 : 0)
    turn.latestFindingCount = Number(summary.finding_count) || 0
  }
  if (summary.error_signature) turn.signals.add(`error:${summary.name}:${summary.error_signature}`)
  if (summary.verdict) {
    const verdict = summary.verdict.toLowerCase()
    clearSignals(turn, 'integrity:')
    if (verdict !== 'clean') turn.signals.add(`integrity:${verdict}`)
    turn.integrityIssue = ['retracted', 'expression_of_concern', 'unknown', 'not_found', 'ambiguous'].includes(verdict)
  }
  const flag = (names, prefix, key, signal) => { if (names.includes(summary.name)) { clearSignals(turn, prefix); turn[key] = summary.issue_count > 0; if (turn[key]) turn.signals.add(signal) } }
  flag(['manuscript_citations', 'citation', 'pdf_references'], 'citation_gap:', 'citationIssue', 'citation_gap:manuscript_citations')
  flag(['stat_audit'], 'stat_flag:', 'statIssue', 'stat_flag:stat_audit')
  flag(['figure_audit'], 'figure_flag:', 'figureIssue', 'figure_flag:figure_audit')
  flag(['repo_audit'], 'repo_flag:', 'repoIssue', 'repo_flag:repo_audit')
  if (summary.compile_ok === false) { turn.qualitySignals.compiled = false; turn.signals.add(`error:${summary.name}:compile`) } else if (summary.compile_ok === true) turn.qualitySignals.compiled = true
  if (summary.gate_passed != null) turn.qualitySignals.gatePassed = summary.gate_passed
  let argsText = ''
  try { argsText = JSON.stringify(args ?? {}) } catch { /* unprintable arguments */ }
  for (const [lessonId, action] of turn.injectedActions || []) {
    if (!action) continue
    if (summary.name === action) turn.reachedLessonIds.add(lessonId)
    else if (['Skill', 'skill', 'skill_load'].includes(summary.name) && argsText.includes(action)) turn.reachedLessonIds.add(lessonId)
  }
  const signature = `${summary.name}|${summary.args_hash}`
  if (turn.toolSignatures.has(signature)) turn.signals.add(`retry:${summary.name}`)
  else turn.toolSignatures.add(signature)
}

/**
 * Handle one hook event. `ctx` is { event, payload, root, home, env, rsi } where `rsi` is { store, core } from loadRsi.
 * Returns { additionalContext? } or { error }. It awaits everything it starts, because the process ends when this returns.
 */
export async function rsiEvent({ event, payload, root, home, rsi }) {
  const { store, core } = rsi
  const dir = store.defaultStoreDir()
  let config
  try { config = store.effectiveConfig(dir) } catch (error) { return { error: `store unavailable: ${error?.message ?? error}` } }
  if (config.mode === 'off') return {}
  store.ensureStore(dir)

  const sessions = join(home, 'rsi-sessions')
  mkdirSync(sessions, { recursive: true })
  const file = join(sessions, `${safe(payload.session_id)}.json`)
  let state = null
  if (existsSync(file)) { try { state = JSON.parse(readFileSync(file, 'utf8'), reviver) } catch { state = null } }
  state ??= { sessionId: payload.session_id || 'default', agentKind: 'main', project: store.projectInfo(root), model: process.env.AH_MODEL || null, turnIndex: 0, lastTaskClass: null, currentTurn: null }
  const save = () => { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(state, replacer)); renameSync(tmp, file) }

  const close = async reason => {
    const turn = state.currentTurn
    if (!turn || turn.finalized) return
    turn.finalized = true
    const episode = core.computeTurnOutcome(turn, { sessionId: state.sessionId, agentKind: state.agentKind, project: state.project, model: state.model, reason })
    state.currentTurn = null
    store.appendEpisode(dir, episode)
    if (episode.substantive) {
      await core.updateLessonsForEpisode({ dir, episode, config }).catch(() => {})
      await core.maybeDiagnose({ dir, config }).catch(() => {})
    }
  }

  try {
    if (event === 'userprompt') {
      const text = String(payload.prompt ?? '')
      await close('new_turn')
      state.currentTurn = newTurn(core, store, state, text)
      const turn = state.currentTurn
      const hash = text ? store.sha1(text, 12) : null
      const preference = core.extractPreference(text)
      const forget = !preference && core.detectForget(text)
      const correction = preference ? { corrected: false, marker: null } : core.detectCorrection(text)
      if (preference) await core.recordExplicitPreference({ dir, text: preference.text, taskClass: preference.taskClass, model: state.model }).catch(() => {})
      if (forget) await core.retireSimilarLessons({ dir, text, config }).catch(() => {})
      if (correction.corrected) { turn.corrections += 1; turn.correctionMarkers.push(correction.marker) }
      core.appendTurnEvent(dir, { type: 'user_turn', session_id: state.sessionId, agent_kind: state.agentKind, project: state.project, turn_number: turn.index, task_class: turn.taskClass, task_tags: turn.taskTags, user_chars: turn.userChars, message_hash: hash, correction: correction.corrected, preference: Boolean(preference), forget: Boolean(forget) })
      let additionalContext
      if (config.mode === 'auto') {
        const selection = core.selectLessonsForTurn({ lessons: store.currentLessons(dir), taskClass: turn.taskClass, sessionId: state.sessionId, turnHash: `${turn.index}:${hash}`, config })
        turn.eligibleLessonIds = new Set(selection.eligible)
        turn.controlLessonIds = new Set(selection.control)
        turn.injectedLessonIds = new Set(selection.injected.map(l => l.id))
        turn.injectedTokens = selection.tokens
        turn.injectedActions = new Map(selection.injected.map(l => [l.id, l.action || null]))
        const message = core.formatLessonMessage(selection.injected)
        if (message) {
          core.appendTurnEvent(dir, { type: 'lesson_injected', session_id: state.sessionId, turn_number: turn.index, task_class: turn.taskClass, lesson_ids: selection.injected.map(l => l.id), control_ids: selection.control, tokens: selection.tokens })
          additionalContext = message
        }
      }
      save()
      return additionalContext ? { additionalContext } : {}
    }

    if (event === 'post') {
      const turn = state.currentTurn
      const name = bareName(payload.tool_name)
      if (!turn || turn.finalized || !name || name === 'ah_rsi') return {}
      const summary = core.summarizeToolResult(name, payload.tool_input, payload.tool_response)
      addTool(turn, summary, payload.tool_input)
      core.appendTurnEvent(dir, { type: 'tool', session_id: state.sessionId, task_class: turn.taskClass, tool: summary.name, is_error: summary.is_error, finding_count: summary.finding_count, findings: summary.findings, verdict: summary.verdict, gate_passed: summary.gate_passed, result_size: summary.result_size, result_hash: summary.text_hash })
      save()
      return {}
    }

    if (event === 'stop') {
      await close('stop')
      save()
      // Old session files go (a session that ended without a stop leaves one).
      try { for (const f of readdirSync(sessions)) { const p = join(sessions, f); if (Date.now() - statSync(p).mtimeMs > STATE_KEEP_MS) rmSync(p, { force: true }) } } catch { /* housekeeping */ }
      return {}
    }
    return {}
  } catch (error) {
    return { error: String(error?.message ?? error) }
  }
}

/** Put the loop's lessons into the engine's reply, which is nothing, one JSON object, or text the caller cannot merge into. Returns the text to print. */
export function mergeReply(engineOut, additionalContext) {
  if (!additionalContext) return engineOut
  const trimmed = String(engineOut ?? '').trim()
  if (!trimmed) return `${JSON.stringify({ additionalContext })}\n`
  let doc
  try { doc = JSON.parse(trimmed) } catch { return engineOut }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return engineOut
  const spec = doc.hookSpecificOutput && typeof doc.hookSpecificOutput === 'object' ? doc.hookSpecificOutput : doc
  spec.additionalContext = [spec.additionalContext, additionalContext].filter(Boolean).join('\n\n')
  return `${JSON.stringify(doc)}\n`
}
