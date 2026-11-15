// The task commands against upstream's own composer tasks. The same request (task, prompt, effort) goes through upstream's
// submitAcademicTask with a recording context, and through planTask; the tool calls must be the same. Also the pure helpers.
import '../helpers/ts-resolve.mjs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { upstreamDir } from '../../server/src/paths.mjs'

const UP = upstreamDir()
const HAVE_UP = existsSync(join(UP, 'node_modules', 'ah-dsh-tools'))
const core = await import('../../hooks/tasks-core.ts')
const root = join(homedir(), '.cache', 'ah-cc-p5', 'unit')

before(() => {
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  for (const f of ['paper.tex', 'refs.bib', 'v1.tex', 'v2.tex']) writeFileSync(join(root, f), 'x\n')
})
after(() => rmSync(root, { recursive: true, force: true }))

describe('command line', () => {
  test('a leading effort flag is taken in four spellings; the rest is the prompt, verbatim', () => {
    for (const raw of ['--effort low what is X', '--effort=low what is X', '-e low what is X', 'effort=low what is X', '  --effort LOW   what is X  ']) {
      assert.deepEqual(core.parseCommandArgs(raw), { effort: 'low', prompt: 'what is X' }, raw)
    }
    assert.deepEqual(core.parseCommandArgs('low rank adaptation'), { effort: 'auto', prompt: 'low rank adaptation' }, 'a first word "low" is a topic')
    assert.deepEqual(core.parseCommandArgs('why --effort high is a flag here'), { effort: 'auto', prompt: 'why --effort high is a flag here' })
    assert.deepEqual(core.parseCommandArgs(''), { effort: 'auto', prompt: '' })
  })
  test('an unknown effort is refused with upstream\'s wording', () => {
    assert.deepEqual(core.parseCommandArgs('--effort extreme x'), { error: 'effort must be auto, low, medium, or high' })
  })
  test('the two-line tasks take " -- " as the line break; a real newline wins', () => {
    assert.equal(core.lines('a.tex -- focus here'), 'a.tex\nfocus here')
    assert.equal(core.lines('a.tex\nb -- c'), 'a.tex\nb -- c')
  })
  test('every task has a distinct ah- command and a usage line', () => {
    const names = Object.values(core.TASK_COMMANDS)
    assert.equal(new Set(names).size, 7)
    assert.ok(names.every(n => n.startsWith('ah-')))
    for (const id of core.TASK_IDS) assert.ok(core.TASK_USAGE[id].includes('--effort'))
  })
})

describe('pure helpers', () => {
  test('sha256Hex agrees with node, for ascii, multi-byte text, the empty string and long input', () => {
    for (const s of ['', 'abc', 'Is the mean of 1..10 equal to 5.5?', 'héllo wörld — 日本語 🙂', 'x'.repeat(1000), 'y'.repeat(55), 'z'.repeat(56), 'w'.repeat(64)]) {
      assert.equal(core.sha256Hex(s), createHash('sha256').update(s).digest('hex'), JSON.stringify(s.slice(0, 20)))
    }
  })
  test('insideWorkspace keeps paths in the workspace and refuses the rest', () => {
    assert.deepEqual(core.insideWorkspace('/p', 'a/b.tex'), { ok: true, abs: '/p/a/b.tex' })
    assert.deepEqual(core.insideWorkspace('/p/', '/p/a.tex'), { ok: true, abs: '/p/a.tex' })
    assert.deepEqual(core.insideWorkspace('/p', 'a/../b.tex'), { ok: true, abs: '/p/b.tex' })
    assert.equal(core.insideWorkspace('/p', '../q.tex').ok, false)
    assert.equal(core.insideWorkspace('/p', '/etc/passwd').ok, false)
    assert.equal(core.insideWorkspace('/p', '/pp/a.tex').ok, false, '/pp is not under /p')
  })
  test('an empty prompt names what to enter, per task', () => {
    assert.deepEqual(core.planTask('deep_review', '  ', 'auto'), { error: 'enter a manuscript path first' })
    assert.deepEqual(core.planTask('deep_research', '', 'auto'), { error: 'enter a research question first' })
    assert.deepEqual(core.planTask('write_revise', '', 'auto'), { error: 'enter the two manuscript paths first' })
  })
})

/** Upstream's submitAcademicTask with a context that records the tool calls it makes. */
async function upstreamCalls(task, prompt, effort) {
  const mod = await import(pathToFileURL(join(UP, 'academic-task.js')).href)
  const calls = []
  const ctx = {
    planMode: { get: () => ({ active: false, pending: false }) },
    tools: {
      get: () => ({}),
      resolve: () => ({}),
      async execute({ calls: batch }) {
        const out = []
        for (const c of batch) {
          const args = JSON.parse(c.arguments)
          calls.push({ name: c.name, args })
          const value = c.name === 'deep_research' && args.action === 'start' ? { run_id: 'dr-0001', effort: args.effort ?? 'medium', expectation: '' } : c.name === 'literature_search' ? { papers: [] } : {}
          out.push({ result: { value } })
        }
        return { results: out }
      },
    },
    jobs: {
      start({ run }) {
        const handle = run({ append() {}, updateProgress() {} })
        ctx.last = handle.done
        return 'job-1'
      },
    },
  }
  const agent = { id: `agent-${Math.random().toString(36).slice(2)}`, session: { header: { cwd: root } } }
  const request = { version: 1, request_id: `req-${Math.random().toString(36).slice(2)}-0123456789`, task, prompt, options: { effort } }
  const reply = mod.submitAcademicTask(ctx, { agent, signal: new AbortController().signal, rawInput: JSON.stringify(request), attachments: [] })
  if (reply.kind === 'error') return { error: reply.text }
  await ctx.last
  return { calls }
}

const CASES = [
  ['deep_research', 'What is retrieval-augmented generation?'],
  ['deep_review', 'paper.tex'],
  ['deep_review', 'paper.tex\nfocus on the statistics and the baselines'],
  ['find_papers', 'retrieval augmented generation for science'],
  ['check_references', 'refs.bib'],
  ['check_references', 'refs.bib\npaper.tex'],
  ['write_revise', 'v1.tex\nv2.tex'],
  ['analyze_data', 'Is the mean of 1..10 equal to 5.5?'],
  ['analyze_data', 'my-analysis\nIs the mean of 1..10 equal to 5.5?'],
  ['generate_hypotheses', 'Find a cause of the batch effect in these samples'],
  ['generate_hypotheses', 'batch-effect\nFind a cause of the batch effect in these samples'],
]

describe('upstream parity: the same tool calls', { skip: !HAVE_UP }, () => {
  for (const [task, prompt] of CASES) {
    for (const effort of ['auto', 'low', 'medium', 'high']) {
      test(`${task} ${JSON.stringify(prompt.slice(0, 28))} at ${effort}`, async () => {
        const up = await upstreamCalls(task, prompt, effort)
        assert.equal(up.error, undefined, up.error)
        const plan = core.planTask(task, prompt, effort)
        assert.equal(plan.error, undefined, plan.error)
        let previous
        const mine = plan.steps.map(step => {
          const s = core.withRunId(step, previous)
          previous = s.tool === 'deep_research' && s.args.action === 'start' ? { run_id: 'dr-0001' } : undefined
          return { name: s.tool, args: s.args }
        })
        assert.deepEqual(mine, up.calls)
      })
    }
  }

  test('the one-line form gives the same calls as the two-line form', async () => {
    const a = core.planTask('deep_review', 'paper.tex -- focus on the statistics', 'low')
    const b = core.planTask('deep_review', 'paper.tex\nfocus on the statistics', 'low')
    assert.deepEqual(a, b)
  })

  test('upstream refuses the same prompts, with the same words', async () => {
    const bad = [
      ['deep_review', 'x'.repeat(5) + '\n' + 'f'.repeat(4001)],
      ['check_references', 'a.bib\nb.tex\nc.tex'],
      ['check_references', 'paper.tex'],
      ['write_revise', 'v1.tex'],
      ['write_revise', 'v1.tex\nv1.tex'],
      ['write_revise', 'v1.tex\nv2.pdf'],
      ['analyze_data', 'a'.repeat(8001)],
      ['find_papers', 'q'.repeat(2001)],
    ]
    for (const [task, prompt] of bad) {
      const up = await upstreamCalls(task, prompt, 'auto')
      const mine = core.planTask(task, prompt, 'auto')
      assert.ok(up.error, `upstream accepted ${task} ${prompt.slice(0, 20)}`)
      assert.equal(mine.error, up.error, `${task}: ${prompt.slice(0, 24)}`)
    }
  })

  test('a file that is missing is refused by upstream; the plan lists it so the command can say the same', async () => {
    const up = await upstreamCalls('deep_review', 'missing.tex', 'auto')
    assert.match(up.error, /file not found: missing\.tex/)
    assert.deepEqual(core.planTask('deep_review', 'missing.tex', 'auto').files, ['missing.tex'])
    assert.deepEqual(core.planTask('write_revise', 'v1.tex\nv2.tex', 'auto').files, ['v1.tex', 'v2.tex'])
    assert.deepEqual(core.planTask('check_references', 'refs.bib\npaper.tex', 'auto').files, ['refs.bib', 'paper.tex'])
  })
})
