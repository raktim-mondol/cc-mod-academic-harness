// Turn a tool's `output.render` blocks into MCP content, and keep very large results out of the context.
//
// Claude Code warns above 10k tokens of tool output and refuses above 25k by default
// (MAX_MCP_OUTPUT_TOKENS), so a result longer than `maxChars` is cut: the head stays in the reply and
// the whole text goes to a file under <cwd>/.dsh/tool-output/, named in the reply. The model can read
// the file with its own tools.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_MAX_CHARS = 40_000

const safe = s => String(s).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)

// Upstream error text names DSH's settings page. Say where the key goes in Claude Code instead.
const HOST_WORDING = [
  [/Settings -> Academic Harness API keys/g, 'the academic-harness plugin settings'],
  // the engine's missing-environment error: the fix here is the mod's installer, not an override variable alone
  [/Academic Harness engine venv is not ready inside this plugin \(vendor\/academic-harness\)\. Set ACADEMIC_HARNESS_CLI or AH_CMD to override\./g,
    'The Academic Harness engine is not installed for this plugin. Run `node scripts/install-engine.mjs` in the academic-harness plugin folder (or set ACADEMIC_HARNESS_CLI or AH_CMD to an existing `ah`).'],
  [/DSH will ask the human to confirm before it runs\./g, 'Claude Code will ask the human to confirm before it runs.'],
]
export const adapt = text => HOST_WORDING.reduce((t, [from, to]) => t.replace(from, to), text)

export function blocksToContent(blocks) {
  const out = []
  for (const b of Array.isArray(blocks) ? blocks : [blocks]) {
    if (b == null) continue
    if (typeof b === 'string') out.push({ type: 'text', text: adapt(b) })
    else if (b.type === 'text') out.push({ type: 'text', text: adapt(String(b.text ?? '')) })
    else if (b.type === 'image' && b.data && b.mimeType) out.push({ type: 'image', data: b.data, mimeType: b.mimeType })
    else out.push({ type: 'text', text: JSON.stringify(b) })
  }
  return out.length ? out : [{ type: 'text', text: '' }]
}

export function clip(content, { maxChars = DEFAULT_MAX_CHARS, cwd, tool, callId, now = Date.now() } = {}) {
  const textLen = content.reduce((n, c) => n + (c.type === 'text' ? c.text.length : 0), 0)
  if (!(maxChars > 0) || textLen <= maxChars) return { content, clipped: false }
  const full = content.filter(c => c.type === 'text').map(c => c.text).join('\n')
  const rest = content.filter(c => c.type !== 'text')
  let where
  try {
    const dir = join(cwd, '.dsh', 'tool-output')
    mkdirSync(dir, { recursive: true })
    where = join(dir, `${safe(tool)}-${safe(callId ?? now)}.txt`)
    writeFileSync(where, full)
  } catch { /* the head alone still answers; say the file could not be written */ }
  const head = full.slice(0, maxChars)
  const note = where
    ? `\n\n[output clipped: ${textLen} characters, showing the first ${maxChars}. The full text is in ${where}; read that file for the rest.]`
    : `\n\n[output clipped: ${textLen} characters, showing the first ${maxChars}. The full text could not be saved.]`
  return { content: [{ type: 'text', text: head + note }, ...rest], clipped: true, file: where }
}
