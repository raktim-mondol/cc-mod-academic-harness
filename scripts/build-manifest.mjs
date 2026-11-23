#!/usr/bin/env node
// Write the generated parts of .claude-plugin/plugin.json from the snapshot:
//   userConfig   one field per API key or address the loaded tools read (from settings-keys.js KEY_FIELDS)
//   mcpServers.ah  the tool host, with each field passed as AH_KEY_<NAME>
//
//   node scripts/build-manifest.mjs           write
//   node scripts/build-manifest.mjs --check   exit 1 if plugin.json differs from what would be written
//
// Why AH_KEY_<NAME> and not <NAME>: an unset userConfig field reaches the server as "" (S4). Passing it as
// <NAME> would overwrite a variable the person exported in their shell with an empty string. (The restore_tools setting
// arrives as AH_RESTORE_TOOLS_SETTING for the same reason; the host reads it together with AH_RESTORE_TOOLS.) The host copies
// AH_KEY_<NAME> to <NAME> only when <NAME> is empty (server/src/env.mjs).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DROPPED_KEY_FIELDS, DROPPED_TOOLS, EXTRA_KEY_FIELDS, NOT_OFFERED_KEY_FIELDS } from '../server/src/fit.mjs'
import { NETWORK_HOSTS } from '../server/src/hosts.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, '.claude-plugin', 'plugin.json')

const DESCRIPTIONS = {
  ...EXTRA_KEY_FIELDS,
  UNPAYWALL_EMAIL: 'Contact address sent to Unpaywall. Unpaywall asks for one; it is not a secret.',
  CROSSREF_MAILTO: 'Contact address for Crossref\'s polite pool (faster, steadier). Not a secret.',
  NCBI_EMAIL: 'Contact address NCBI asks for with PubMed requests. Not a secret.',
}

/** The model router (hooks/router.ts). Off by default: it changes which model answers, and so what a prompt costs. */
export const ROUTER_OPTIONS = {
  model_router: {
    type: 'string',
    title: 'Model router',
    description: 'on picks the model for each prompt: planning on Opus, coding on Sonnet, academic writing on Haiku, anything else on Sonnet. /model-router on or off overrides it for one session. off leaves the model you chose.',
    default: 'off',
    options: ['off', 'on'],
  },
  router_engine: {
    type: 'string',
    title: 'What the router reads prompts with',
    description: 'auto asks Jev (TypeSafe) when a TypeSafe key is saved, which sends the start and end of each prompt to TypeSafe, and uses keyword rules when there is no key or Jev does not answer. rules always uses keyword rules on this machine and sends nothing.',
    default: 'auto',
    options: ['auto', 'rules'],
  },
  router_plan_model: {
    type: 'string',
    title: 'Router: model for planning',
    description: 'An alias (opus, sonnet, haiku) or a full model id, for prompts that ask for a plan, design or approach first.',
    default: 'opus',
  },
  router_code_model: {
    type: 'string',
    title: 'Router: model for coding',
    description: 'An alias or a full model id, for prompts about code, scripts, errors and builds.',
    default: 'sonnet',
  },
  router_write_model: {
    type: 'string',
    title: 'Router: model for academic writing',
    description: 'An alias or a full model id, for prompts that write, edit or polish scholarly prose. Used only when the writing is clearly the task and code is not.',
    default: 'haiku',
  },
  router_fallback_model: {
    type: 'string',
    title: 'Router: model for everything else',
    description: 'An alias or a full model id, for prompts that fit none of the above and for any prompt the router is unsure about.',
    default: 'sonnet',
  },
}

const pretty = name => name.replace(/_/g, ' ').toLowerCase().replace(/\b(api|id|ads|wos|ncbi|s2|core|ieee|ocr)\b/g, m => m.toUpperCase()).replace(/^./, c => c.toUpperCase())

export async function keyFields(upstream = join(root, 'core')) {
  const mod = await import(pathToFileURL(join(upstream, 'settings-keys.js')).href)
  // A field only a tool that cannot come back reads is not offered (server/src/fit.mjs); the keys of restorable tools are, so they can be saved ahead of `restore_tools`.
  const own = mod.KEY_FIELDS.filter(f => !NOT_OFFERED_KEY_FIELDS.some(re => re.test(f)) && !DROPPED_KEY_FIELDS.has(f)).map(name => ({ name, secret: mod.SECRET_FIELDS.has(name) }))
  // Keys a served tool reads that the snapshot's list does not name (fit.mjs EXTRA_KEY_FIELDS): every one is a credential.
  const extra = Object.keys(EXTRA_KEY_FIELDS).filter(name => !own.some(f => f.name === name)).map(name => ({ name, secret: true }))
  return [...own, ...extra]
}

export async function build(manifest) {
  const fields = await keyFields()
  const userConfig = { ...manifest.userConfig }
  // Drop the fields a previous run generated: the ones the ah server's env refers to.
  for (const v of Object.values(manifest.mcpServers?.ah?.env ?? {})) {
    const m = /^\$\{user_config\.([a-z0-9_]+)\}$/.exec(v)
    if (m) delete userConfig[m[1]]
  }
  // Re-added below in a fixed place, so the file does not change shape from one run to the next.
  delete userConfig.tool_areas
  delete userConfig.restore_tools
  delete userConfig.evidence_check
  delete userConfig.llm_model
  delete userConfig.llm_budget_usd
  delete userConfig.job_notices
  delete userConfig.usage_counts
  delete userConfig.rsi_mode
  for (const name of Object.keys(ROUTER_OPTIONS)) delete userConfig[name]
  userConfig.tool_areas = {
    type: 'string',
    title: 'Tool areas',
    description: 'Which tool groups the academic-harness server offers: search, papers, notebook, skills, writing, reviews, tournament, analysis, provenance, study, data, submission, deep, compute, figures, memory, or all. Comma separated.',
    default: 'all',
  }
  userConfig.restore_tools = {
    type: 'string',
    title: 'Tools to bring back',
    description: `Tools this plugin leaves out because Claude Code already does the job (see docs/design/fit-review.md): ${Object.entries(DROPPED_TOOLS).filter(([, t]) => t.restorable !== false).map(([n]) => n).join(', ')}. Comma separated; the tool's API key is then read from its environment variable.`,
    default: '',
  }
  userConfig.llm_model = {
    type: 'string',
    title: 'Model for tools that call a model',
    description: 'deep_research, deep_review and the other tools that call a model run it through a headless Claude Code call under your login. The alias or id passed to --model (sonnet, opus, haiku, or a full model id).',
    default: 'sonnet',
  }
  userConfig.llm_budget_usd = {
    type: 'string',
    title: 'Model spend cap per server run (USD)',
    description: 'The most the model route spends while the academic-harness server runs. A call past it fails with a message that says so. Each single call is also capped at 1 USD.',
    default: '5',
  }
  userConfig.job_notices = {
    type: 'string',
    title: 'When a background job ends',
    description: 'deep_research, deep_review and analysis_run go on as background jobs. prompt: notify you and prompt the model to read the result and carry on. notify: notify only. off: neither (job_status and job_wait still work). Interactive sessions only.',
    default: 'prompt',
    options: ['prompt', 'notify', 'off'],
  }
  userConfig.evidence_check = {
    type: 'string',
    title: 'Evidence check at the end of a turn',
    description: 'In a project with an ah.yaml, the stop gate can run an advisory check: a verifier model reads the sources cited by the paragraphs the turn changed (one model call per paragraph, and it only advises). skip never runs it; run runs it once per turn.',
    default: 'skip',
    options: ['skip', 'run'],
  }
  userConfig.usage_counts = {
    type: 'string',
    title: 'Count which tools, skills and commands are used',
    description: 'on keeps a count per tool, skill, agent and command (names and numbers only, never what they were used for) in the plugin\'s home folder, so /academic usage can show what is used and what never is. Nothing leaves this machine. off counts nothing.',
    default: 'on',
    options: ['on', 'off'],
  }
  userConfig.rsi_mode = {
    type: 'string',
    title: 'Self-improvement loop',
    description: 'Off unless you turn it on. In a folder with an ah.yaml, in a session with a person at the prompt (never a headless run), a local loop learns short lessons from your corrections and from what tools returned. observe: it records and adds nothing to your prompts. auto: it also adds the lessons that fit the task to your prompts (ah_rsi shows and forgets them). The AH_RSI environment variable wins when set.',
    default: 'off',
    options: ['off', 'observe', 'auto'],
  }
  // The model router's settings are read by the hooks module (hooks/router-core.ts), not the server, so they carry no AH_ variable.
  Object.assign(userConfig, ROUTER_OPTIONS)
  const env = { AH_TOOL_AREAS: '${user_config.tool_areas}', AH_RESTORE_TOOLS_SETTING: '${user_config.restore_tools}', AH_LLM_MODEL: '${user_config.llm_model}', AH_LLM_BUDGET_USD: '${user_config.llm_budget_usd}', AH_USAGE_SETTING: '${user_config.usage_counts}', AH_RSI_SETTING: '${user_config.rsi_mode}' }
  for (const { name, secret } of fields) {
    const key = name.toLowerCase()
    userConfig[key] = {
      type: 'string',
      title: pretty(name),
      description: DESCRIPTIONS[name] ?? (secret ? `Key or token for ${pretty(name).replace(/ (API key|token)$/i, '')}. Leave empty to use the ${name} environment variable, or none.` : `Optional. The ${name} environment variable wins when it is set.`),
      sensitive: secret,
      required: false,
    }
    env[`AH_KEY_${name}`] = `\${user_config.${key}}`
  }
  return {
    ...manifest,
    userConfig,
    // The hosts the plugin reaches, for everything it ships (server/src/hosts.mjs): the author's word, shown to whoever installs it and read by the directory.
    network: { hosts: NETWORK_HOSTS },
    mcpServers: {
      ...manifest.mcpServers,
      ah: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server/bin/ah-mcp.mjs'], env },
    },
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const current = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const next = JSON.stringify(await build(current), null, 2) + '\n'
  if (process.argv.includes('--check')) {
    if (next !== readFileSync(manifestPath, 'utf8')) { console.error('plugin.json is out of date: run node scripts/build-manifest.mjs'); process.exit(1) }
    console.log('plugin.json is up to date')
  } else {
    writeFileSync(manifestPath, next)
    console.log(`wrote ${Object.keys(JSON.parse(next).userConfig).length} userConfig fields and the ah server`)
  }
}
