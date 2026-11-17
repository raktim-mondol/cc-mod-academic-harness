#!/usr/bin/env node
// Rebuild every generated output from core/: skills/, hooks/generated/ (the prompt, the task catalogue, the fold), agents/.
//   (the core is committed in core/; nothing to take first)
//   node scripts/build-all.mjs          then this
// Pass --include-restricted for a local build that keeps non-commercial and GPL skills (never commit it).
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const extra = process.argv.slice(2)
for (const [script, args] of [['build-skills.mjs', extra], ['build-prompt.mjs', []], ['build-agents.mjs', []], ['build-ui.mjs', []]]) {
  process.stdout.write(execFileSync(process.execPath, [join(here, script), ...args], { encoding: 'utf8' }))
}
