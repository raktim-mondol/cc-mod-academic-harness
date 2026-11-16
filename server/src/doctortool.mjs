// The host's own `doctor` tool: what is ready and what is not, as the running server sees it (its environment, with the keys the person
// saved in the plugin's options, and the modules it loaded or could not load). Read-only, and it never prints a key's value.
import { diagnose, format } from './doctor.mjs'

export function doctorTool({ env = process.env, loaded = [], failed = [] } = {}) {
  return {
    name: 'doctor',
    description: 'Check what is ready in the academic-harness plugin: the source snapshot, tool dependencies, the writing engine, PaperMemory, TextFold, the Python helpers, LaTeX, the Claude Code CLI the model route uses, which keys are set (names only), and which tool modules this server loaded or failed to load. Use it when a tool says something is not installed or not ready, or before a long run.',
    parameters: { online: { type: 'boolean', description: 'Also ask GitHub whether the Academic Harness source has moved past the commit this plugin holds. Default false.' } },
    async execute({ online } = {}) {
      const report = await diagnose({ env, online: online === true })
      const byArea = {}
      for (const m of loaded) byArea[m.area] = (byArea[m.area] ?? 0) + m.tools
      const areas = Object.entries(byArea).map(([a, n]) => `${a} ${n}`).join(', ')
      const lines = [format(report), '', `This server loaded ${loaded.length} tool modules (${areas || 'none'}).`]
      if (failed.length) lines.push(`${failed.length} did not load:`, ...failed.map(f => `  ${f.file}: ${f.error}`))
      return lines.join('\n')
    },
  }
}
