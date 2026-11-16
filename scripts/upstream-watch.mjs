#!/usr/bin/env node
// Tell the owner when Academic Harness has moved past the commit this plugin holds, as one GitHub issue.
//
//   node scripts/upstream-watch.mjs                    compare GitHub's newest commit with UPSTREAM.lock.json; open, update or close the issue
//   node scripts/upstream-watch.mjs --commit <sha>     compare that commit instead (a full sha)
//   node scripts/upstream-watch.mjs --dry-run          print the issue and what would be done; call nothing on GitHub
//
// Run weekly by .github/workflows/upstream-watch.yml, which gives it GH_TOKEN. When the plugin is behind, it takes the snapshot (setup.mjs)
// and runs `update-upstream.mjs --commit <sha>` for the report of what the newer commit changes, and puts that report in the issue. One issue
// at a time, labelled `upstream-update`: none open opens one; one open for an older candidate is updated; one open for this candidate is left
// alone (no mail every week); when the plugin holds the newest commit again the issue is closed. Nothing is applied: the owner decides.
//
// Output for people goes to standard error; standard output stays empty, so a workflow may redirect it as it likes.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkSnapshot } from '../server/src/snapshot.mjs'

export const LABEL = 'upstream-update'
export const MAX_REPORT_CHARS = 50_000

const short = sha => String(sha).slice(0, 7)

export const titleFor = (current, candidate) => `Academic Harness moved: ${short(current)} → ${short(candidate)}`
export const compareUrl = (source, from, to) => `https://${source}/compare/${from}...${to}`

/** The report as text that stays inside a code fence, cut to fit an issue (GitHub allows 65,536 characters in one). */
export function fenced(report, limit = MAX_REPORT_CHARS) {
  const text = String(report ?? '').replace(/```/g, "'''").trim()
  return text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} more characters; run the command below to read all of it)` : text
}

export function issueBody({ lock, candidate, report, needsDecision }) {
  return [
    '# Academic Harness has a newer commit',
    '',
    `This plugin holds Academic Harness **${lock.version}** (\`${short(lock.commit)}\`). Its newest commit is \`${short(candidate)}\` ([what changed](${compareUrl(lock.source, lock.commit, candidate)})).`,
    '',
    needsDecision
      ? '**Some of it needs a decision before it can be taken**: a new tool or skill, or a prompt section the research-mode text was written from. The report says which.'
      : '**Nothing in it needs a decision**: it can be taken as it is, and the checks run after.',
    '',
    '## What it changes for the plugin',
    '',
    '```',
    fenced(report),
    '```',
    '',
    '## To take it',
    '',
    '```',
    `node scripts/update-upstream.mjs --commit ${candidate}            # this report again`,
    `node scripts/update-upstream.mjs --commit ${candidate} --apply    # take it, then run the checks`,
    '```',
    '',
    'What each line of the report means and how to decide: `docs/maintain/updating-upstream.md`. After it is applied, run the live scripts in `docs/maintain/next-steps.md` before a release.',
    '',
    `_Opened by the weekly workflow \`upstream-watch\`. It is updated when Academic Harness moves again and closed when the plugin holds the newest commit._`,
  ].join('\n')
}

/**
 * What to do about the issue. `open` is the open issues with the label, as { number, title }.
 *   none    nothing to say (up to date with no issue, or this candidate already reported)
 *   create  behind, and no issue is open
 *   update  behind, and the open one names an older candidate: it gets the new title and body; any others are closed
 *   close   up to date: every open one is closed
 */
export function decide({ behind, candidate, open }) {
  if (!behind) return open.length ? { action: 'close', numbers: open.map(i => i.number) } : { action: 'none' }
  const same = open.find(i => String(i.title).endsWith(`→ ${short(candidate)}`))
  if (same) return { action: 'none', number: same.number, reason: 'this commit is already reported' }
  if (open.length) return { action: 'update', number: open[0].number, close: open.slice(1).map(i => i.number) }
  return { action: 'create' }
}

/** Carry the decision out. `gh(args)` runs the GitHub CLI and returns its standard output; it throws when `gh` fails. */
export function act(plan, { title, bodyFile, candidate, lock, gh }) {
  const say = text => process.stderr.write(`upstream-watch: ${text}\n`)
  if (plan.action === 'none') return say(plan.reason ?? 'up to date, nothing open')
  if (plan.action === 'close') {
    for (const n of plan.numbers) gh(['issue', 'close', String(n), '--reason', 'completed', '--comment', `The plugin holds the newest Academic Harness commit again (\`${short(lock.commit)}\`).`])
    return say(`closed ${plan.numbers.map(n => `#${n}`).join(', ')}`)
  }
  gh(['label', 'create', LABEL, '--color', '0e8a16', '--description', 'Academic Harness has a newer commit than the plugin holds', '--force'])
  if (plan.action === 'create') {
    const url = gh(['issue', 'create', '--title', title, '--body-file', bodyFile, '--label', LABEL]).trim()
    return say(`opened ${url}`)
  }
  gh(['issue', 'edit', String(plan.number), '--title', title, '--body-file', bodyFile])
  for (const n of plan.close) gh(['issue', 'close', String(n), '--reason', 'not planned', '--comment', `Replaced by #${plan.number} (\`${short(candidate)}\`).`])
  say(`updated #${plan.number}${plan.close.length ? `, closed ${plan.close.map(n => `#${n}`).join(', ')}` : ''}`)
}

// ---- the command ----

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function ghCli(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 24 })
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} failed (exit ${r.status}): ${(r.stderr || r.stdout || '').trim().slice(0, 300)}`)
  return r.stdout
}

function newestCommit(source) {
  const r = spawnSync('git', ['ls-remote', `https://${source}.git`, 'HEAD'], { encoding: 'utf8', timeout: 60_000 })
  const head = r.stdout?.split(/\s+/)[0]
  if (!/^[0-9a-f]{40}$/.test(head ?? '')) throw new Error(`GitHub did not say what ${source}'s newest commit is${r.stderr ? `: ${r.stderr.trim().slice(0, 200)}` : ''}`)
  return head
}

/** The report needs the current snapshot and its dependencies; a fresh runner has neither. */
function ensureSnapshot(lock) {
  const have = checkSnapshot(join(root, 'upstream'), lock).state === 'ok' && existsSync(join(root, 'upstream', 'node_modules', 'ah-dsh-tools'))
  if (have) return
  process.stderr.write('upstream-watch: taking the snapshot first (setup.mjs)\n')
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'setup.mjs'), '--github', '--no-engine'], { cwd: root, stdio: ['ignore', 2, 2] })
  if (r.status !== 0) throw new Error('setup.mjs could not take the snapshot (see above)')
}

async function main() {
  const args = process.argv.slice(2)
  const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
  const dryRun = args.includes('--dry-run')
  const lock = JSON.parse(readFileSync(join(root, 'UPSTREAM.lock.json'), 'utf8'))
  const want = opt('--commit')
  if (want !== undefined && !/^[0-9a-f]{40}$/.test(want)) throw new Error('--commit needs the full 40-character sha')
  const candidate = want ?? newestCommit(lock.source)
  const behind = candidate !== lock.commit
  process.stderr.write(`upstream-watch: the plugin holds ${short(lock.commit)} (${lock.version}); newest is ${short(candidate)}${behind ? '' : ' - up to date'}\n`)

  let report = ''
  let needsDecision = false
  if (behind) {
    ensureSnapshot(lock)
    const r = spawnSync(process.execPath, [join(root, 'scripts', 'update-upstream.mjs'), '--commit', candidate], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 })
    report = `${r.stdout ?? ''}${r.stderr ? `\n${r.stderr}` : ''}`
    // 0: nothing to decide; 2: a decision is needed. Anything else is the report itself failing.
    if (r.status !== 0 && r.status !== 2) throw new Error(`the update report failed (exit ${r.status}):\n${report.trim().split('\n').slice(-12).join('\n')}`)
    needsDecision = r.status === 2
  }

  const title = titleFor(lock.commit, candidate)
  const body = behind ? issueBody({ lock, candidate, report, needsDecision }) : ''
  const scratch = join(process.env.RUNNER_TEMP || join(homedir(), '.cache'), 'ah-upstream-watch')
  mkdirSync(scratch, { recursive: true })
  const bodyFile = join(scratch, 'issue.md')
  writeFileSync(bodyFile, body)

  if (dryRun) {
    process.stderr.write(`upstream-watch: dry run, nothing is called on GitHub. ${behind ? `Would open or update: ${title}` : 'Would close any open issue.'}\n`)
    if (behind) process.stderr.write(`\n${body}\n`)
    return
  }
  const open = JSON.parse(ghCli(['issue', 'list', '--label', LABEL, '--state', 'open', '--json', 'number,title', '--limit', '20']) || '[]')
  act(decide({ behind, candidate, open }), { title, bodyFile, candidate, lock, gh: ghCli })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`upstream-watch: ${error.message}\n`); process.exit(1) })
