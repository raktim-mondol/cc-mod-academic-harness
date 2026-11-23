// The self-improvement loop's mode, and the one rule that decides it.
//
// The loop is off unless a person turns it on. Where the mode comes from, strongest first:
//
//   1. a headless run (`AH_RSI_INTERACTIVE=0`, which the hooks module sets from the session): always off. A scripted run has no person
//      correcting it, and lessons added to its prompts would make it irreproducible;
//   2. the `AH_RSI` variable the person exported;
//   3. the `rsi_mode` plugin option (it reaches the server as `AH_RSI_SETTING`, and the hook bridge the same way);
//   4. off.
//
// A value that is not a mode is off, never on: a typo must not switch on a loop that changes what the model is told. hooks/rsi-core.ts has the
// same rule for the hooks module (it cannot import this file), and tests/scripts/rsi-mode.test.mjs runs both over one table.

export const RSI_MODES = ['off', 'observe', 'auto']

const AUTO = new Set(['auto', '1', 'true', 'on', 'yes'])
const OFF = new Set(['off', '0', 'false', 'no'])

/** One source's value as a mode, or null when the source says nothing (unset or blank). */
export function normalizeRsiMode(value) {
  const s = String(value ?? '').trim().toLowerCase()
  if (!s) return null
  if (AUTO.has(s)) return 'auto'
  if (s === 'observe') return 'observe'
  if (OFF.has(s)) return 'off'
  return 'off'
}

/** The mode for an environment (the shell's, with the plugin option as AH_RSI_SETTING, and AH_RSI_INTERACTIVE from the hooks module). */
export function rsiMode(env = process.env) {
  if (String(env.AH_RSI_INTERACTIVE ?? '').trim() === '0') return 'off'
  return normalizeRsiMode(env.AH_RSI) ?? normalizeRsiMode(env.AH_RSI_SETTING) ?? 'off'
}
