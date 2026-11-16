// The host's own `doctor` tool: what is ready and what is not, as the running server sees it (its environment, with the keys the person
// saved in the plugin's options, and the modules it loaded or could not load). Read-only, and it never prints a key's value.
import { diagnose, format } from './doctor.mjs'
import { listedAgents, listedSkills } from './skills-list.mjs'
import { formatReport, KNOWN_COMMANDS, readUsage, usageDir, usageEnabled } from './usage.mjs'
import { modHome } from './paths.mjs'

/** `served` returns the names of the tools this server offers, `flush` writes the counts not yet written, so a report includes this server's own. */
export function doctorTool({ env = process.env, loaded = [], failed = [], served = () => undefined, flush = () => {} } = {}) {
  return {
    name: 'doctor',
    description: 'Check what is ready in the academic-harness plugin: the source snapshot, tool dependencies, the writing engine, PaperMemory, TextFold, the Python helpers, LaTeX, the Claude Code CLI the model route uses, which keys are set (names only), and which tool modules this server loaded or failed to load. Use it when a tool says something is not installed or not ready, or before a long run.',
    parameters: {
      online: { type: 'boolean', description: 'Also ask GitHub whether the Academic Harness source has moved past the commit this plugin holds. Default false.' },
      usage: { type: 'boolean', description: 'Instead of the report, show which tools, skills, agents and commands have been used and which never have (names and counts only). Default false.' },
      all: { type: 'boolean', description: 'With usage: list every name, not only the most used and the first of the never used. Default false.' },
    },
    async execute({ online, usage, all } = {}) {
      flush()
      if (usage === true) {
        if (!usageEnabled(env)) return 'Usage counting is off (the usage_counts setting, or AH_USAGE=0), so nothing new is counted. Counts kept earlier, if any:\n\n' + formatReport(readUsage(usageDir(modHome(env))), knownNames(served()), { all: all === true })
        return formatReport(readUsage(usageDir(modHome(env))), knownNames(served()), { all: all === true })
      }
      const report = await diagnose({ env, online: online === true, served: served() })
      const byArea = {}
      for (const m of loaded) byArea[m.area] = (byArea[m.area] ?? 0) + m.tools
      const areas = Object.entries(byArea).map(([a, n]) => `${a} ${n}`).join(', ')
      const lines = [format(report), '', `This server loaded ${loaded.length} tool modules (${areas || 'none'}).`]
      if (failed.length) lines.push(`${failed.length} did not load:`, ...failed.map(f => `  ${f.file}: ${f.error}`))
      return lines.join('\n')
    },
  }
}

/** What exists, for the "never used" lists: the tools this server serves, the skills and agents this build lists, the commands the hooks module registers. */
export const knownNames = tools => ({ ...(tools ? { tools } : {}), skills: [...listedSkills()], agents: [...listedAgents()], commands: KNOWN_COMMANDS })
