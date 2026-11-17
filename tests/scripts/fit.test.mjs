// What the mod leaves out of Academic Harness (server/src/fit.mjs) and the host wording rules (scripts/adapt.mjs): the lists are sound,
// the cuts are real in every output, and nothing built still tells the model to use a tool that is not served.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { adapt, RULES, TARGETS } from '../../scripts/adapt.mjs'
import { DROPPED_AGENTS, DROPPED_KEY_FIELDS, DROPPED_SKILLS, DROPPED_TOOLS, EXTRA_KEY_FIELDS, ON_DEMAND_SKILLS, restoreList } from '../../server/src/fit.mjs'
import { classify, discover, plan } from '../../server/src/manifest.mjs'
import { coreDir } from '../../server/src/paths.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const UP = coreDir()
const HAVE_UP = existsSync(join(UP, 'node_modules', 'ah-dsh-tools'))
const read = (...p) => readFileSync(join(root, ...p), 'utf8')

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile() && /\.(md|ts|json)$/.test(e.name) && statSync(p).size < 2_000_000) out.push(p)
  }
  return out
}

describe('the tools left out', () => {
  test('each has a reason, a module and an area', () => {
    for (const [name, t] of Object.entries(DROPPED_TOOLS)) {
      assert.ok(t.why.length > 20, name)
      assert.match(t.module, /\.js$/, name)
      assert.ok(t.area, name)
    }
  })
  test('each module is one upstream registers, and the manifest calls it dropped', { skip: !HAVE_UP }, () => {
    const entries = discover(UP)
    for (const [name, t] of Object.entries(DROPPED_TOOLS)) {
      const entry = entries.find(e => e.file === t.module)
      assert.ok(entry, `${name}: ${t.module} is not a module upstream applies`)
      assert.deepEqual({ tier: classify(entry).tier, tool: classify(entry).tool }, { tier: 'dropped', tool: name })
    }
  })
  test('the plan does not load them, and loads them when the setting asks', { skip: !HAVE_UP }, () => {
    const files = plan(UP).load.map(e => e.file)
    for (const t of Object.values(DROPPED_TOOLS)) assert.ok(!files.includes(t.module), t.module)
    const back = plan(UP, undefined, { restore: ['brave_search', 'latex_compile'] }).load.map(e => e.file)
    assert.ok(back.includes('brave-search.js') && back.includes('latex-compile.js'))
    assert.ok(!back.includes('tavily-search.js'))
  })
  test('the restore list reads names, and says which it cannot bring back', () => {
    assert.deepEqual(restoreList('brave_search, exa_search nonsense paper_mcp'), { restore: ['brave_search', 'exa_search'], unknown: ['nonsense', 'paper_mcp'] })
    assert.deepEqual(restoreList(''), { restore: [], unknown: [] })
    assert.deepEqual(restoreList(undefined), { restore: [], unknown: [] })
  })
  test('a restored tool is served by the host; a dropped one is not', { skip: !HAVE_UP }, async () => {
    const { createHost } = await import('../../server/src/host.mjs')
    const scratchRoot = join(homedir(), '.cache', 'ah-test-homes')
    mkdirSync(scratchRoot, { recursive: true })
    const home = mkdtempSync(join(scratchRoot, 'fit-'))
    const saved = { ...process.env }
    process.env.DSH_HOME = home
    for (const f of ['ACADEMIC_HARNESS_SKIP_INSTALL', 'ACADEMIC_HARNESS_MODAL_SKIP_INSTALL', 'TEXTFOLD_SKIP_INSTALL', 'PAPERMEMORY_SKIP_INSTALL', 'ZVEC_GREP_SKIP_INSTALL']) process.env[f] = '1'
    const hosts = []
    try {
      const without = await createHost({ upstream: UP, areas: 'search', cwd: home, logger: () => {}, env: { ...process.env, AH_MOD_HOME: home } })
      const withIt = await createHost({ upstream: UP, areas: 'search', cwd: home, logger: () => {}, env: { ...process.env, AH_MOD_HOME: home, AH_RESTORE_TOOLS: 'brave_search', AH_RESTORE_TOOLS_SETTING: '' } })
      const bySetting = await createHost({ upstream: UP, areas: 'search', cwd: home, logger: () => {}, env: { ...process.env, AH_MOD_HOME: home, AH_RESTORE_TOOLS_SETTING: 'tavily_search' } })
      hosts.push(without, withIt, bySetting)
      assert.ok(bySetting.list().some(t => t.name === 'tavily_search'), 'the plugin setting works too')
      assert.ok(!without.list().some(t => t.name === 'brave_search'))
      assert.ok(withIt.list().some(t => t.name === 'brave_search'))
      assert.ok(without.list().some(t => t.name === 'literature_search'), 'the unified search stays')
    } finally {
      for (const h of hosts) await h.dispose()
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
      Object.assign(process.env, saved)
      rmSync(home, { recursive: true, force: true })
    }
  })
  test('every key a tool can use has a plugin option: restorable tools\' keys and the extras are offered, a tool that cannot come back is not', () => {
    const manifest = JSON.parse(read('.claude-plugin', 'plugin.json'))
    for (const [tool, t] of Object.entries(DROPPED_TOOLS)) {
      for (const key of t.keys ?? []) {
        const field = manifest.userConfig[key.toLowerCase()]
        if (t.restorable === false) assert.equal(field, undefined, `${key}: ${tool} cannot come back`)
        else { assert.equal(field?.sensitive, true, `${key}: ${tool} can be restored, so its key is offered`); assert.equal(manifest.mcpServers.ah.env[`AH_KEY_${key}`], `\${user_config.${key.toLowerCase()}}`) }
      }
    }
    for (const key of Object.keys(EXTRA_KEY_FIELDS)) assert.equal(manifest.userConfig[key.toLowerCase()]?.sensitive, true, key)
  })
  test('the settings only they read are not offered, and the restore setting is', () => {
    const manifest = JSON.parse(read('.claude-plugin', 'plugin.json'))
    for (const f of DROPPED_KEY_FIELDS) assert.equal(manifest.userConfig[f.toLowerCase()], undefined, f)
    for (const kept of ['parallel_api_key', 'consensus_api_key', 'jina_api_key']) assert.ok(manifest.userConfig[kept], `${kept}: still a source of a served tool`)
    assert.ok(manifest.userConfig.restore_tools)
    assert.equal(manifest.mcpServers.ah.env.AH_RESTORE_TOOLS_SETTING, '${user_config.restore_tools}')
  })
})

describe('the skills and agents left out', () => {
  const core = JSON.parse(read('core', 'skills-core.json'))
  test('every name is a core skill, so a typo cannot hide a skill', { skip: !HAVE_UP }, () => {
    for (const n of [...Object.keys(DROPPED_SKILLS), ...Object.keys(ON_DEMAND_SKILLS)]) assert.ok(core.includes(n), n)
  })
  test('none is built into the plugin; the on-demand ones are still bundled for skill_search', { skip: !HAVE_UP }, () => {
    for (const n of [...Object.keys(DROPPED_SKILLS), ...Object.keys(ON_DEMAND_SKILLS)]) assert.equal(existsSync(join(root, 'skills', n)), false, n)
    for (const n of Object.keys(ON_DEMAND_SKILLS)) assert.ok(existsSync(join(UP, 'skills', n, 'SKILL.md')), `${n} is not in the on-demand pack`)
  })
  test('a skill and an agent are never the same brief twice', () => {
    const skills = new Set(readdirSync(join(root, 'skills')))
    for (const f of readdirSync(join(root, 'agents'))) assert.ok(!skills.has(f.replace(/\.md$/, '')), f)
    for (const n of Object.keys(DROPPED_AGENTS)) assert.equal(existsSync(join(root, 'agents', `${n}.md`)), false, n)
  })
  test('the catalogue stays small: descriptions cost context on every turn', () => {
    const info = JSON.parse(read('skills', '.build-info.json'))
    assert.ok(info.descriptionChars <= 22_000, `${info.descriptionChars} characters of skill descriptions`)
    assert.ok(info.included.length <= 56, `${info.included.length} skills`)
  })
})

describe('host wording', () => {
  test('every rule that must match has its target built', () => {
    for (const target of TARGETS) {
      const [kind, rest] = target.split(':')
      const file = kind === 'guide' ? join(root, 'skills', 'research-guides', 'references', `${rest}.md`) : kind === 'agent' ? join(root, 'agents', `${rest}.md`) : join(root, 'skills', ...rest.split('/'))
      assert.ok(existsSync(file), `${target}: ${file} is not built, so its rule can never run`)
    }
  })
  test('a rule whose text is gone throws, naming the target; an optional one does not', () => {
    assert.throws(() => adapt('guide:literature-and-the-web', 'nothing the rules look for'), /guide:literature-and-the-web: the text this rule rewrites is gone/)
    assert.equal(adapt('skill:anything/SKILL.md', 'nothing to change'), 'nothing to change')
    assert.equal(adapt('skill:x/SKILL.md', 'ask `ask_user_question` first'), 'ask `AskUserQuestion` first')
    assert.equal(adapt('agent:data-validator', 'with the sandbox Python environment (`uv run`) and in the sandbox'), 'with the project\'s Python environment (`uv run`) and locally')
  })
  test('the literature researcher no longer forbids WebSearch and WebFetch or asks for tools that are not served', () => {
    const t = read('agents', 'literature-researcher.md')
    assert.doesNotMatch(t, /parallel_search|parallel_extract|consensus_search|firecrawl_scrape|WEB_PROVIDER_UNAVAILABLE/)
    assert.match(t, /`literature_search`/)
    assert.match(t, /`WebSearch`/)
  })
  test('no built skill, guide or agent sends the model to a tool this build does not serve', () => {
    const named = Object.keys(DROPPED_TOOLS)
    // The ledgers' own text still mentions a result card as one kind of link; it names no call to make.
    const concept = new Set(['skills/experiment-tracking/SKILL.md', 'skills/provenance-audit/SKILL.md'])
    const hits = []
    for (const dir of ['skills', 'agents']) {
      for (const f of walk(join(root, dir))) {
        const rel = f.slice(root.length + 1)
        if (rel.endsWith('.build-info.json')) continue
        const text = readFileSync(f, 'utf8')
        for (const n of named) if (new RegExp(`\\b${n}\\b`).test(text) && !(concept.has(rel) && n === 'scientific_result')) hits.push(`${rel}: ${n}`)
      }
    }
    assert.deepEqual(hits, [])
  })
  test('the rules are all used by something that is built', () => {
    assert.ok(RULES.length >= 10)
    assert.ok(read('skills', 'research-guides', 'references', 'literature-and-the-web.md').includes('`WebSearch`'))
  })
})

describe('the research-mode text', () => {
  const text = read('hooks', 'generated', 'prompt.ts')
  test('is about 3,000 tokens, down from 4,700, and names the tools it says are not here', () => {
    const prompt = JSON.parse(/PROMPT_TEXT = (".*")\n/.exec(text)[1])
    assert.ok(prompt.length < 14_000, String(prompt.length))
    for (const n of ['scientific_result', 'research_template', 'fold_text', 'paper_mcp', 'latex_compile']) assert.match(prompt, new RegExp(n))
    assert.match(prompt, /AskUserQuestion/)
    assert.doesNotMatch(prompt, /DeepSeek|\bDSH\b|another host|written for another/, 'the research-mode text stands on its own')
  })
  test('nothing the model reads names the other chat host', () => {
    const hits = []
    for (const dir of ['skills', 'agents']) {
      for (const f of walk(join(root, dir))) {
        const rel = f.slice(root.length + 1)
        // a reference table of other models' writing tells names models; it is about writing, not about this plugin
        if (rel.endsWith('.build-info.json') || rel === 'skills/remove-ai-signs/references/signs.md') continue
        for (const m of readFileSync(f, 'utf8').matchAll(/DeepSeek|\bDSH\b(?!_HOME)|\bPi is not required/g)) hits.push(`${rel}: ${m[0]}`)
      }
    }
    assert.deepEqual(hits, [])
  })
  test('lists only guides that exist', () => {
    const prompt = JSON.parse(/PROMPT_TEXT = (".*")\n/.exec(text)[1])
    const slugs = [...prompt.matchAll(/^- ([a-z-]+): /gm)].map(m => m[1])
    const files = new Set(readdirSync(join(root, 'skills', 'research-guides', 'references')).map(f => f.replace(/\.md$/, '')))
    assert.ok(slugs.length >= 20, 'the guide index is in the prompt')
    for (const s of slugs) assert.ok(files.has(s), `the prompt lists a guide with no file: ${s}`)
  })
})

describe('the keys page', () => {
  test('names every key and address option of the plugin, and no option that does not exist', () => {
    const manifest = JSON.parse(read('.claude-plugin', 'plugin.json'))
    const page = read('docs', 'guide', 'keys.md')
    const options = Object.entries(manifest.mcpServers.ah.env).filter(([k]) => k.startsWith('AH_KEY_')).map(([, v]) => /user_config\.([a-z0-9_]+)/.exec(v)[1])
    // Keys, tokens and addresses belong on the page; tool tuning (co_scientist_*, deep_review_*, ...) is in settings.md.
    const wanted = options.filter(o => manifest.userConfig[o].sensitive || /_(email|mailto)$/.test(o))
    for (const o of wanted) assert.ok(page.includes(`\`${o}\``), `${o} is not on docs/guide/keys.md`)
    const tableNames = [...page.matchAll(/^\| ((?:`[a-z0-9_]+`(?:, )?)+) \|/gm)].flatMap(m => [...m[1].matchAll(/`([a-z0-9_]+)`/g)].map(x => x[1]))
    for (const n of tableNames) assert.ok(manifest.userConfig[n], `${n} is on the page but is not a plugin option`)
    assert.ok(tableNames.length >= wanted.length)
  })
})
