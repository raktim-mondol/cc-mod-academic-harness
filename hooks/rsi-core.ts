// The pure part of the self-improvement loop's hooks (hooks/rsi.ts): whether the loop is on, and how much of a tool's arguments and result it is
// handed. No `$`, no Node, so node tests import it as it is.
//
// The mode rule is the same as server/src/rsi-mode.mjs (the server and the hook bridge use that one; the hooks module cannot import it), and
// tests/scripts/rsi-mode.test.mjs runs both over one table. The loop is off unless a person turns it on; a value that is not a mode is off.

export type RsiMode = 'off' | 'observe' | 'auto'

const AUTO = new Set(['auto', '1', 'true', 'on', 'yes'])
const OFF = new Set(['off', '0', 'false', 'no'])

/** One source's value as a mode, or null when the source says nothing (unset or blank). */
export function normalizeRsiMode(value: unknown): RsiMode | null {
  const s = String(value ?? '').trim().toLowerCase()
  if (!s) return null
  if (AUTO.has(s)) return 'auto'
  if (s === 'observe') return 'observe'
  if (OFF.has(s)) return 'off'
  return 'off'
}

/** The mode: the variable the person exported (AH_RSI) wins over the plugin option (`rsi_mode`); neither is off. */
export function rsiMode(shell: unknown, setting: unknown): RsiMode {
  return normalizeRsiMode(shell) ?? normalizeRsiMode(setting) ?? 'off'
}

// Whether a person is at the prompt, as session.start said. A headless run (`claude -p`, the SDK) has nobody correcting it, so the loop
// neither records it nor adds anything to its prompts: lessons in a scripted run would make it irreproducible. Until session.start has
// said, the answer is no.
let interactive = false

export function setRsiInteractive(value: boolean): void {
  interactive = value === true
}

export function rsiInteractive(): boolean {
  return interactive
}

// How much of a tool call the loop is handed, through stdin and nothing is kept: the loop reads names, whether a call failed, the findings it
// reported and hashes, never the text, but it has to be given the text to find them.
export const MAX_RESPONSE_CHARS = 30_000
export const MAX_INPUT_CHARS = 20_000
export const MAX_FAILURE_CHARS = 2_000
export const MAX_BATCH_CALLS = 40

/** A value as text, cut at `max` characters. */
function clip(value: unknown, max: number): string {
  let text: string
  if (typeof value === 'string') text = value
  else {
    try {
      text = JSON.stringify(value ?? '')
    } catch {
      text = String(value)
    }
  }
  return text.length > max ? text.slice(0, max) : text
}

/** The tool's result as text, cut at MAX_RESPONSE_CHARS. */
export function clipResponse(response: unknown): string {
  return clip(response, MAX_RESPONSE_CHARS)
}

/** The tool's arguments: as they came when they are small, as cut text when they are not (a Write carries a whole file). */
export function clipInput(input: unknown): unknown {
  if (input === null || typeof input !== 'object') return clip(input, MAX_INPUT_CHARS)
  const text = clip(input, MAX_INPUT_CHARS + 1)
  return text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : input
}

/** A failed call's error message, cut. */
export function clipFailure(error: unknown): string {
  return clip(error, MAX_FAILURE_CHARS)
}

export type BatchCall = { tool_name: string; tool_input: unknown; tool_response: string }

/** The calls of a PostToolBatch as the loop is handed them: at most MAX_BATCH_CALLS, each cut. Anything that is not a call is dropped. */
export function reduceBatch(calls: unknown): BatchCall[] {
  if (!Array.isArray(calls)) return []
  const out: BatchCall[] = []
  for (const c of calls) {
    if (out.length >= MAX_BATCH_CALLS) break
    if (c === null || typeof c !== 'object') continue
    const call = c as Record<string, unknown>
    if (typeof call['tool_name'] !== 'string' || call['tool_name'] === '') continue
    out.push({ tool_name: call['tool_name'], tool_input: clipInput(call['tool_input']), tool_response: clipResponse(call['tool_response']) })
  }
  return out
}
