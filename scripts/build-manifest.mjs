#!/usr/bin/env node
// Write the generated parts of .claude-plugin/plugin.json from the snapshot:
//   userConfig   one field per API key or address the loaded tools read (from settings-keys.js KEY_FIELDS)
//   mcpServers.ah  the tool host, with each field passed as AH_KEY_<NAME>
//
//   node scripts/build-manifest.mjs           write
//   node scripts/build-manifest.mjs --check   exit 1 if plugin.json differs from what would be written
//
// Why AH_KEY_<NAME> and not <NAME>: an unset userConfig field reaches the server as "" (S4). Passing it as
// <NAME> would overwrite a variable the person exported in their shell with an empty string. The host copies
// AH_KEY_<NAME> to <NAME> only when <NAME> is empty (server/src/env.mjs).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, '.claude-plugin', 'plugin.json')

/** Fields whose tools the host does not load yet. Each phase removes lines from here. */
export const NOT_YET = [
  /^SUBAGENT_/, // P6: agent definitions
  /^ZVEC_/, // P6: the zvec-grep mount
]

const DESCRIPTIONS = {
  UNPAYWALL_EMAIL: 'Contact address sent to Unpaywall. Unpaywall asks for one; it is not a secret.',
  CROSSREF_MAILTO: 'Contact address for Crossref\'s polite pool (faster, steadier). Not a secret.',
  NCBI_EMAIL: 'Contact address NCBI asks for with PubMed requests. Not a secret.',
}

const pretty = name => name.replace(/_/g, ' ').toLowerCase().replace(/\b(api|id|ads|wos|ncbi|s2|core|ieee|ocr)\b/g, m => m.toUpperCase()).replace(/^./, c => c.toUpperCase())

export async function keyFields(upstream = join(root, 'upstream')) {
  const mod = await import(pathToFileURL(join(upstream, 'settings-keys.js')).href)
  return mod.KEY_FIELDS.filter(f => !NOT_YET.some(re => re.test(f))).map(name => ({ name, secret: mod.SECRET_FIELDS.has(name) }))
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
  delete userConfig.evidence_check
  delete userConfig.llm_model
  delete userConfig.llm_budget_usd
  delete userConfig.job_notices
  userConfig.tool_areas = {
    type: 'string',
    title: 'Tool areas',
    description: 'Which tool groups the academic-harness server offers: search, papers, notebook, skills, writing, reviews, tournament, analysis, provenance, study, data, submission, deep, compute, figures, memory, or all. Comma separated.',
    default: 'all',
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
  const env = { AH_TOOL_AREAS: '${user_config.tool_areas}', AH_LLM_MODEL: '${user_config.llm_model}', AH_LLM_BUDGET_USD: '${user_config.llm_budget_usd}' }
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
