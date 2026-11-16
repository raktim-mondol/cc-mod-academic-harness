// What is ready and what is not: the checks behind `/academic doctor` and `node server/bin/ah-doctor.mjs`.
//
// Read-only. Nothing is installed, no key value is read out (names only), and no network call is made unless `online` is asked for.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { assessVersion, readSeen, TESTED_VERSIONS } from './compat.mjs'
import { listedAgents, listedSkills } from './skills-list.mjs'
import { KNOWN_COMMANDS, readUsage, summaryLine, usageDir, usageEnabled } from './usage.mjs'
import { engineDir, engineStatus } from './engine.mjs'
import { DROPPED_TOOLS } from './fit.mjs'
import { installDir, installedStamp, wantStamp } from './papermemory.mjs'
import { isDevMode, modHome, modRoot, upstreamDir } from './paths.mjs'
import { libraryCounts } from './panel.mjs'
import { readState } from './bootstrap-state.mjs'
import { checkSnapshot } from './snapshot.mjs'

/** Keys that change what a researcher gets the most; the rest are listed by count. */
const WORTH_SETTING = [
  ['S2_API_KEY', 'Semantic Scholar: a dedicated rate limit instead of a shared, throttled pool'],
  ['UNPAYWALL_EMAIL', 'Unpaywall: open-access PDFs for paper_download'],
  ['CROSSREF_MAILTO', 'Crossref: the faster, steadier "polite" pool'],
]

const tryRun = (command, args) => {
  try { return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }).trim() } catch { return null }
}

/**
 * @returns {{ checks: Array<{ id: string, state: 'ok'|'warn'|'missing'|'info', label: string, detail: string, fix?: string }>, blocking: number }}
 * `missing` means something the mod cannot work without; `warn` something that makes a feature fail until it is set up; `info` an optional extra.
 */
export async function diagnose({ env = process.env, online = false, root = modRoot(), upstream = upstreamDir(env), home = modHome(env), served } = {}) {
  const checks = []
  const add = (id, state, label, detail, fix) => checks.push({ id, state, label, detail, ...(fix ? { fix } : {}) })
  const lock = existsSync(join(root, 'UPSTREAM.lock.json')) ? JSON.parse(readFileSync(join(root, 'UPSTREAM.lock.json'), 'utf8')) : null

  const major = Number(process.versions.node.split('.')[0])
  add('node', major >= 22 ? 'ok' : 'missing', 'Node.js', `v${process.versions.node}${major >= 22 ? '' : ' (22 or newer is needed for node:sqlite)'}`, major >= 22 ? undefined : 'install a current Node.js')

  // A fetch that failed leaves its error behind until a server fetches again. Once the snapshot is usable (`node scripts/setup.mjs` after
  // the failure, say) no server needs to fetch, so the old error would stay for ever: it is only reported while the snapshot is unusable.
  const usable = existsSync(join(upstream, 'node_modules', 'ah-dsh-tools'))
  const state = isDevMode(env) ? null : readState(env)
  const fetching = state?.error && usable ? null : state
  if (fetching && !fetching.error) {
    add('snapshot', 'info', 'Source snapshot', `being set up by the server (started ${Math.max(0, Math.round((Date.now() - fetching.startedAt) / 1000))} s ago): ${fetching.step}. The other tools appear when it is done`)
  } else if (fetching?.error) {
    add('snapshot', 'missing', 'Source snapshot', `the first-start fetch failed at "${fetching.step}": ${fetching.error}`, 'node scripts/setup.mjs (it shows the whole error)')
  } else if (isDevMode(env)) {
    add('snapshot', 'info', 'Source snapshot', `development mode: reading ${upstream} (AH_UPSTREAM), read-only`)
  } else {
    const s = checkSnapshot(upstream, lock)
    if (s.state === 'ok') add('snapshot', 'ok', 'Source snapshot', `Academic Harness ${s.version}, commit ${String(s.commit).slice(0, 7)}, ${s.fileCount} files, digest matches the lock`)
    else if (s.state === 'missing') add('snapshot', 'missing', 'Source snapshot', s.detail, 'node scripts/setup.mjs (it downloads the pinned commit from GitHub; no source checkout is needed)')
    else add('snapshot', s.state === 'differs' ? 'warn' : 'info', 'Source snapshot', `${s.version ?? '?'}: ${s.detail}`, s.state === 'differs' ? 'node scripts/sync-upstream.mjs' : undefined)
  }

  const deps = existsSync(join(upstream, 'node_modules', 'ah-dsh-tools'))
  let depsCurrent = deps
  if (deps && existsSync(join(upstream, 'package-lock.json')) && !isDevMode(env)) {
    const want = createHash('sha256').update(readFileSync(join(upstream, 'package-lock.json'))).digest('hex')
    const stamp = join(upstream, 'node_modules', '.ah-lock-sha256')
    depsCurrent = existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === want
  }
  add('deps', deps ? (depsCurrent ? 'ok' : 'warn') : 'missing', 'Tool dependencies', deps ? (depsCurrent ? 'installed, match package-lock.json' : 'installed, but package-lock.json has changed since') : 'upstream/node_modules is missing, so the ah server cannot start', deps && depsCurrent ? undefined : 'node scripts/install-deps.mjs')

  const engine = engineStatus(env, engineDir(upstream))
  add('engine', engine.ok ? 'ok' : 'warn', 'Writing engine (ah_* tools, the guard)', engine.ok ? `ready (${engine.how})` : String(engine.why), engine.ok ? undefined : 'node scripts/install-engine.mjs (the server also builds it in the background on first start)')

  const claude = tryRun('claude', ['--version'])
  add('claude', claude ? 'ok' : 'warn', 'Claude Code CLI (the model route of deep_research, deep_review, coscientist)', claude ?? 'not on PATH: tools that call a model fail', claude ? undefined : 'put `claude` on PATH')

  // The hooks module (research mode, the guard, the commands, the pane) and the Claude Code it runs in. It leaves a record at session start
  // (hooks/seen.ts); this session's is the proof that it loaded, and carries the version that is really running.
  const mod = 'Hooks module (research mode, guard, commands, pane)'
  const session = env.CLAUDE_CODE_SESSION_ID?.trim()
  if (!session) {
    const onPath = claude ? assessVersion(claude) : null
    add('mod', 'info', mod, `not checked: this report is not from inside a session; /academic doctor checks it.${onPath ? ` The Claude Code on PATH is ${onPath.detail}` : ''}`)
  } else {
    const seen = readSeen(home, session)
    if (!seen) {
      add('mod', 'warn', mod, `has not reported in this session, so Claude Code probably did not load it: /academic, the status line, the guard and the approvals are not working. It needs a Claude Code with the mod platform (seen working on ${TESTED_VERSIONS.join(', ')})`, 'update Claude Code, then start a new session; `claude --debug` shows why a hooks module did not load')
    } else {
      const a = assessVersion(seen.version)
      add('mod', a.state, mod, `loaded in this session, Claude Code ${a.detail}`, a.state === 'warn' ? 'update Claude Code' : undefined)
    }
  }

  const uv = tryRun('uv', ['--version'])
  add('uv', uv ? 'ok' : 'warn', 'uv (installs the engine and PaperMemory quickly)', uv ?? 'not found: the installers fall back to python -m venv', uv ? undefined : 'https://docs.astral.sh/uv/')

  const have = installedStamp(env)
  add('papermemory', have && have === wantStamp(env) ? 'ok' : 'info', 'PaperMemory CLI', have ? `installed in ${installDir(env)} (${have})` : 'not installed yet: the first session that starts its server installs it (about a second with a warm uv cache)')

  const counts = await libraryCounts(env)
  add('library', counts && !counts.error ? 'ok' : 'info', 'PaperMemory library', counts ? (counts.error ? counts.error : `${counts.papers} papers (${counts.citable} citable), ${counts.claims} claims, ${counts.notes} notes in ${counts.path}`) : 'no library yet; the first ingest creates it')

  const textfold = existsSync(join(home, 'textfold'))
  add('textfold', textfold ? 'ok' : 'info', 'TextFold (paper_fold)', textfold ? `installed in ${join(home, 'textfold')}` : 'installs into the mod\'s home the first time a session loads the notebook or submission tools', textfold ? undefined : 'AH_MANAGED_INSTALLS=0 turns this off')

  const helpers = existsSync(join(upstream, 'python-helpers', '.venv'))
  add('helpers', helpers ? 'ok' : 'info', 'Python helpers (data, statistics and science toolkits; about 800 MB)', helpers ? 'installed' : 'not installed: those tools use python3 and say which import they lack', helpers ? undefined : 'node scripts/install-helpers.mjs')

  const latex = tryRun('latexmk', ['-v']) ? 'latexmk' : tryRun('pdflatex', ['--version']) ? 'pdflatex' : null
  add('latex', latex ? 'ok' : 'info', 'LaTeX (ah_build, manuscript_diff, presentation_build)', latex ? `${latex} found` : 'not found: LaTeX projects cannot be built here')

  const named = Object.keys(env).filter(k => k.startsWith('AH_KEY_') && env[k]?.trim()).map(k => k.slice(7))
  const shell = WORTH_SETTING.map(([name]) => name).filter(n => env[n]?.trim())
  const set = [...new Set([...named, ...shell])]
  const unset = WORTH_SETTING.filter(([n]) => !set.includes(n))
  add('keys', unset.length ? 'info' : 'ok', 'Keys and addresses', `${set.length} set${set.length ? ` (${set.sort().join(', ')})` : ''}. Names only, never values.${unset.length ? ` Worth setting: ${unset.map(([n, why]) => `${n} (${why})`).join('; ')}` : ''}`, unset.length ? 'set them where Claude Code configures plugin options, or export them in the shell' : undefined)

  const jobsDir = join(home, 'jobs')
  if (existsSync(jobsDir)) {
    const records = readdirSync(jobsDir).filter(n => n.endsWith('.json'))
    add('jobs', 'info', 'Background jobs', `${records.length} record${records.length === 1 ? '' : 's'} in ${jobsDir}`)
  }

  // Usage counts (usage.mjs): names and numbers only. The full report is /academic usage.
  if (!usageEnabled(env)) add('usage', 'info', 'Usage counts', 'off (the usage_counts setting, or AH_USAGE=0): nothing is counted')
  else add('usage', 'info', 'Usage counts', summaryLine(readUsage(usageDir(home)), { ...(served ? { tools: served } : {}), skills: [...listedSkills()], agents: [...listedAgents()], commands: KNOWN_COMMANDS }))

  const dropped = Object.keys(DROPPED_TOOLS)
  const restored = `${env.AH_RESTORE_TOOLS ?? ''},${env.AH_RESTORE_TOOLS_SETTING ?? ''}`.split(/[\s,]+/).filter(n => dropped.includes(n))
  add('surface', 'info', 'Tools', `areas: ${env.AH_TOOL_AREAS?.trim() || 'all'}; ${dropped.length} Academic Harness tools are left out on purpose${restored.length ? ` (restored: ${restored.join(', ')})` : ''}: docs/design/fit-review.md`)

  if (online && lock) {
    const out = tryRun('git', ['ls-remote', `https://${lock.source}.git`, 'HEAD'])
    const head = out?.split(/\s+/)[0]
    if (!head) add('upstream', 'info', 'Upstream', 'could not reach GitHub')
    else if (head === lock.commit) add('upstream', 'ok', 'Upstream', `the snapshot is the current head of ${lock.source} (${head.slice(0, 7)})`)
    else add('upstream', 'info', 'Upstream', `${lock.source} has moved on: the snapshot is ${lock.commit.slice(0, 7)}, the head is ${head.slice(0, 7)}`, 'node scripts/update-upstream.mjs reports what changed')
  }

  return { checks, blocking: checks.filter(c => c.state === 'missing').length }
}

const MARK = { ok: '✔', warn: '!', missing: '✘', info: '·' }

/** The report as text. */
export function format({ checks, blocking }) {
  const lines = checks.map(c => `${MARK[c.state]} ${c.label}: ${c.detail}${c.fix ? `\n    fix: ${c.fix}` : ''}`)
  const warn = checks.filter(c => c.state === 'warn').length
  lines.push('', blocking ? `${blocking} thing${blocking === 1 ? '' : 's'} the mod cannot work without.` : warn ? `Ready, with ${warn} feature${warn === 1 ? '' : 's'} to set up (marked !).` : 'Ready.')
  return lines.join('\n')
}

