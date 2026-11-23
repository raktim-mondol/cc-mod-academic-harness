// The pure part of the self-improvement loop's hook (hooks/rsi.ts): how much of a tool's arguments and result the loop is handed.
// No `$`, no Node, so node tests import it as it is.

export const MAX_RESPONSE_CHARS = 30_000
export const MAX_INPUT_CHARS = 20_000

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
