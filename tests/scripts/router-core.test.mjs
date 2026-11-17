// The model router's pure parts (hooks/router-core.ts): the policy that turns Jev's probabilities into a model, the keyword rules that answer
// without Jev, the model names, and the request and response of Jev. The hooks that use them are tested by tests/router.test.ts.
import '../helpers/ts-resolve.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const r = await import('../../hooks/router-core.ts')
const ui = await import('../../hooks/ui-core.ts')
const root = join(import.meta.dirname, '..', '..')

const p = (o) => ({ plan: 0, code: 0, write: 0, other: 0, ...o })

describe('the policy: Jev supplies probabilities, code picks the model', () => {
  const route = (probs, cont = 0.02, prev = null) => r.decide(p(probs), cont, prev).route
  test('a clear case goes to its own route', () => {
    assert.equal(route({ plan: 0.9, other: 0.1 }), 'plan')
    assert.equal(route({ code: 0.9, other: 0.1 }), 'code')
    assert.equal(route({ write: 0.9, other: 0.1 }), 'write')
    assert.equal(route({ other: 0.9, code: 0.1 }), 'other')
  })
  test('any prompt that needs a plan goes to the planning model, even when coding is as likely', () => {
    assert.equal(route({ plan: 0.45, code: 0.45, other: 0.1 }), 'plan')
    assert.equal(route({ plan: 0.4, code: 0.5, other: 0.1 }), 'plan')
    assert.equal(route({ plan: 0.39, code: 0.5, other: 0.11 }), 'code')
  })
  test('the smallest model writes only when writing is clear and coding is not', () => {
    assert.equal(route({ write: 0.6, other: 0.4 }), 'write')
    assert.equal(route({ write: 0.59, other: 0.41 }), 'other', 'not clear enough')
    assert.equal(route({ write: 0.7, code: 0.25, other: 0.05 }), 'other', 'code is too likely')
    assert.equal(route({ write: 0.7, code: 0.24, other: 0.06 }), 'write')
  })
  test('no clear winner is general work: the middle model', () => {
    assert.equal(route({ plan: 0.2, code: 0.3, write: 0.25, other: 0.25 }), 'other')
    assert.equal(route({ code: 0.49, other: 0.46, write: 0.05 }), 'other')
  })
  test('a go-ahead keeps coding or writing, and never keeps planning', () => {
    assert.deepEqual(r.decide(p({ other: 0.9 }), 0.95, 'code'), { route: 'code', via: 'continuation', why: 'a go-ahead, so coding carries on' })
    assert.equal(route({ other: 0.9 }, 0.8, 'write'), 'write')
    assert.equal(route({ other: 0.9 }, 0.95, 'plan'), 'other')
    assert.equal(route({ other: 0.9 }, 0.95, null), 'other', 'nothing came before it')
    assert.equal(route({ code: 0.9 }, 0.79, 'write'), 'code', 'not sure it is only a go-ahead: it is read as a request')
  })
  test('the reason is words a person can read', () => {
    assert.equal(r.decide(p({ plan: 0.92 }), 0, null).why, 'planning 92%')
    assert.match(r.decide(p({ write: 0.55, other: 0.45 }), 0, null).why, /writing 55% but not clear enough/)
  })
  test('every route has a default model and a name', () => {
    assert.deepEqual(r.DEFAULT_MODELS, { plan: 'opus', code: 'sonnet', write: 'haiku', other: 'sonnet' })
    for (const x of r.ROUTES) assert.ok(r.ROUTE_LABEL[x])
  })
})

describe('the keyword rules: used without a key, and when Jev does not answer', () => {
  const route = (text, prev = null) => r.rulesRoute(text, prev).route
  test('planning', () => {
    for (const t of [
      'Make a plan for migrating our data pipeline to Spark',
      'Draft a research plan for the new cohort study',
      'How should we structure the experiments for this ablation?',
      'Before we start coding, think this through: what are the trade-offs between Postgres and DuckDB?',
      'I need a roadmap for the thesis',
      'Come up with an architecture for the ingestion service',
      'Write a design doc for the cache layer',
      'Plan out the next three months of the project',
      'Help me design the study: what sample size, which controls?',
      'Create a plan to fix the bug in parser.py',
    ]) assert.equal(route(t), 'plan', t)
  })
  test('coding', () => {
    for (const t of [
      'Fix the failing test in tests/test_io.py',
      'Why does this raise a TypeError? ```python\nx = 1 + "a"\n```',
      'Refactor the parser into smaller functions',
      'npm install fails with ERESOLVE',
      'write a function that dedups a list',
      'add a --verbose flag to the CLI script',
      'git rebase keeps conflicting',
      'Implement the plan we agreed on',
      'Fix the LaTeX in my abstract, it will not compile',
    ]) assert.equal(route(t), 'code', t)
  })
  test('academic writing', () => {
    for (const t of [
      'Proofread this paragraph of my discussion section',
      'Rewrite my abstract to be under 150 words',
      'Polish the introduction of my paper',
      'Draft a cover letter for the journal submission',
      'Summarise the related work section into three sentences',
      'Write a response to reviewer 2 comment about sample size',
      'Make this more academic: "we did lots of tests"',
      'Write a grant proposal for the ARC Discovery scheme',
    ]) assert.equal(route(t), 'write', t)
  })
  test('everything else, and words that only look like a task', () => {
    for (const t of [
      'What is the capital of Australia?',
      'what does a p-value mean',
      'list the files in this folder',
      'Explain the architecture of this repo',
      'I want to understand the approach used in this paper',
      'Summarise the plan in plan.md',
    ]) assert.equal(route(t), 'other', t)
  })
  test('prose and code in one prompt is code: the smallest model is never given code to write', () => {
    assert.equal(route('Write the methods section and a python script that generates table 2'), 'code')
    assert.equal(route('Polish my abstract. ```tex\\begin{abstract}x\\end{abstract}```'), 'code')
  })
  test('what the rules cannot read goes to the middle model, never to the smallest or the strongest', () => {
    for (const t of ['Est-ce que tu peux faire un plan pour ma thèse ?', '请帮我写一个研究计划', 'review my paper for style', '']) assert.equal(route(t), 'other', t)
  })
  test('a go-ahead carries on, made of nothing else', () => {
    for (const t of ['yes', 'Go ahead.', 'continue', 'looks good, do it', 'ok thanks', 'LGTM!']) {
      assert.equal(route(t, 'code'), 'code', t)
      assert.equal(route(t, 'write'), 'write', t)
      assert.equal(route(t, 'plan'), 'other', `${t}: a plan is not kept`)
      assert.equal(route(t, null), 'other', `${t}: nothing came before it`)
    }
    assert.equal(route('yes, and also make a plan for the next stage', 'code'), 'plan', 'a go-ahead with more in it is a request')
    assert.equal(route('go through the proofs of lemma 2', 'code'), 'other')
  })
})

describe('the model a request names', () => {
  const a = r.applyModel
  test('another family is switched to, an alias as given', () => {
    assert.equal(a('claude-sonnet-5-5', 'opus'), 'opus')
    assert.equal(a('claude-opus-5-5', 'haiku'), 'haiku')
    assert.equal(a('claude-sonnet-5-5', 'claude-opus-5-5'), 'claude-opus-5-5')
  })
  test('the target already in use is left alone, so nothing changes for the cache', () => {
    assert.equal(a('claude-sonnet-5-5', 'sonnet'), null)
    assert.equal(a('claude-opus-5-5', 'claude-opus-5-5'), null)
    assert.equal(a('Opus 5.5', 'opus'), null)
  })
  test('a long-context session keeps its window', () => {
    assert.equal(a('claude-sonnet-5-5[1m]', 'opus'), 'opus[1m]')
    assert.equal(a('claude-sonnet-5-5[1m]', 'opus[1m]'), 'opus[1m]')
    assert.equal(a('claude-sonnet-5-5', 'opus'), 'opus')
  })
  test('a session on another provider\'s model is not touched', () => {
    for (const m of ['deepseek-chat', 'gpt-5', 'gemini-2.5-pro', 'llama-3', '']) assert.equal(a(m, 'opus'), null, m)
    assert.equal(r.isClaudeModel('claude-haiku-5-5'), true)
    assert.equal(r.isClaudeModel('Sonnet (1M context)'), true)
    assert.equal(r.isClaudeModel(undefined), false)
  })
  test('a setting that is not a model name falls back to the default', () => {
    assert.equal(r.cleanModel('opus', 'x'), 'opus')
    assert.equal(r.cleanModel(' claude-opus-5-5 ', 'x'), 'claude-opus-5-5')
    assert.equal(r.cleanModel('sonnet[1m]', 'x'), 'sonnet[1m]')
    for (const bad of ['', '   ', 'two words', 'a;b', '$(id)', '../x', 'x'.repeat(200), 7, null, undefined]) assert.equal(r.cleanModel(bad, 'dflt'), 'dflt', String(bad))
    assert.deepEqual(r.modelsFrom({}), r.DEFAULT_MODELS)
    assert.deepEqual(r.modelsFrom({ router_plan_model: 'claude-opus-5-5', router_write_model: 'oops oops' }), { ...r.DEFAULT_MODELS, plan: 'claude-opus-5-5' })
  })
  test('the person\'s own tag at the start of a prompt, and only there', () => {
    assert.equal(r.parseDirective('[opus] think hard about this'), 'opus')
    assert.equal(r.parseDirective('  [Haiku]proofread this'), 'haiku')
    assert.equal(r.parseDirective('[sonnet]'), 'sonnet')
    for (const t of ['think about [opus]', '[gpt] hi', '[opus-5] hi', '(opus) hi', '', 'opus']) assert.equal(r.parseDirective(t), null, t)
  })
})

describe('the settings', () => {
  test('the router is off unless it was turned on; rules are chosen only by name', () => {
    assert.equal(r.routerSetting({}), 'off')
    assert.equal(r.routerSetting({ model_router: 'on' }), 'on')
    assert.equal(r.routerSetting({ model_router: ' ON ' }), 'on')
    assert.equal(r.routerSetting({ model_router: 'yes' }), 'off')
    assert.equal(r.engineSetting({}), 'auto')
    assert.equal(r.engineSetting({ router_engine: 'rules' }), 'rules')
    assert.equal(r.engineSetting({ router_engine: 'jev' }), 'auto')
  })
  test('plugin.json offers each one, with these defaults and the router off', () => {
    const cfg = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).userConfig
    assert.equal(cfg.model_router.default, 'off')
    assert.deepEqual(cfg.model_router.options, ['off', 'on'])
    assert.equal(cfg.router_engine.default, 'auto')
    assert.deepEqual(cfg.router_engine.options, ['auto', 'rules'])
    assert.equal(cfg.router_plan_model.default, r.DEFAULT_MODELS.plan)
    assert.equal(cfg.router_code_model.default, r.DEFAULT_MODELS.code)
    assert.equal(cfg.router_write_model.default, r.DEFAULT_MODELS.write)
    assert.equal(cfg.router_fallback_model.default, r.DEFAULT_MODELS.other)
    for (const k of ['model_router', 'router_engine', 'router_plan_model', 'router_code_model', 'router_write_model', 'router_fallback_model']) assert.notEqual(cfg[k].sensitive, true, k)
  })
})

describe('what is sent to Jev, and what comes back', () => {
  test('one request, two questions, a pinned model, and only the message', () => {
    const body = r.jevRequest('Plan my thesis')
    assert.equal(body.model, r.JEV_MODEL)
    assert.match(r.JEV_MODEL, /^jev-\d+\.\d+\.\d+$/, 'pinned: an alias would move the thresholds without a word')
    assert.deepEqual(body.state, { message: 'Plan my thesis' })
    assert.deepEqual(Object.keys(body.questions).sort(), ['continuation', 'route'])
    assert.equal(body.questions.route.type, 'choice')
    assert.deepEqual(Object.keys(body.questions.route.criteria), [...r.ROUTES])
    assert.equal(body.questions.continuation.type, 'noul')
    for (const q of Object.values(body.questions)) assert.match(q.instructions, /`message`/, 'the question points at the state by its name')
  })
  test('a long prompt travels as its start and its end', () => {
    const long = `${'a'.repeat(r.JEV_HEAD)}${'MIDDLE'.repeat(5000)}${'z'.repeat(r.JEV_TAIL)}`
    const sent = r.forJev(long)
    assert.ok(sent.length < r.JEV_HEAD + r.JEV_TAIL + 100)
    assert.ok(sent.startsWith('a'.repeat(r.JEV_HEAD)) && sent.endsWith('z'.repeat(r.JEV_TAIL)))
    assert.doesNotMatch(sent, /MIDDLEMIDDLE/)
    assert.match(sent, /\d+ characters left out/)
    assert.equal(r.forJev('  short  '), 'short')
    assert.equal(r.forJev(undefined), '')
  })
  const good = { model: 'jev-1.14.0', answers: { route: { type: 'choice', choice: 'plan', confidence: 0.9, probabilities: { plan: 0.8, code: 0.1, write: 0.05, other: 0.05 } }, continuation: { type: 'noul', noul: 0.03 } } }
  test('Jev\'s answer is read into probabilities', () => {
    assert.deepEqual(r.parseJev(good), { ok: true, p: { plan: 0.8, code: 0.1, write: 0.05, other: 0.05 }, continuation: 0.03, model: 'jev-1.14.0' })
  })
  test('anything that does not fit is malformed, never a guess', () => {
    const clone = () => JSON.parse(JSON.stringify(good))
    const missing = clone(); delete missing.answers.route.probabilities.write
    const word = clone(); word.answers.route.probabilities.plan = 'high'
    const range = clone(); range.answers.route.probabilities.plan = 1.5
    const nan = clone(); nan.answers.continuation.noul = null
    for (const bad of [null, undefined, {}, 'x', { answers: {} }, { answers: { route: {} } }, missing, word, range, nan]) assert.deepEqual(r.parseJev(bad), { ok: false, reason: 'malformed_response' })
  })
  test('Jev is waited for out of the hook\'s own time: the most it asks, less when little is left, and not at all when there is none', () => {
    assert.equal(r.jevWait(undefined), r.JEV_TIMEOUT_MS)
    assert.equal(r.jevWait(30_000), 2500)
    assert.equal(r.jevWait(2000), 1300)
    assert.equal(r.jevWait(r.JEV_SPARE_MS + r.JEV_MIN_WAIT_MS), r.JEV_MIN_WAIT_MS)
    assert.equal(r.jevWait(r.JEV_SPARE_MS + r.JEV_MIN_WAIT_MS - 1), null)
    assert.equal(r.jevWait(0), null)
    assert.equal(r.jevWait(-5), null)
  })
  test('failures are named, and a refused key is left alone longest', () => {
    assert.equal(r.failureReason(401), 'auth_failed')
    assert.equal(r.failureReason(403), 'auth_failed')
    assert.equal(r.failureReason(429), 'rate_limited')
    assert.equal(r.failureReason(500), 'http_500')
    assert.equal(r.failureReason(null, 'timeout'), 'timeout')
    assert.equal(r.failureReason(null, 'error'), 'network_error')
    assert.ok(r.pauseFor('auth_failed') > r.pauseFor('timeout'))
    assert.equal(r.pauseFor('timeout'), 60_000)
  })
})

describe('what the person reads', () => {
  test('the status line says the router is on, and what the last prompt got', () => {
    assert.equal(r.statusPart(false, null), null)
    assert.equal(r.statusPart(true, null), 'router on')
    assert.equal(r.statusPart(true, { model: 'opus' }), 'router → opus')
    assert.equal(ui.composeStatus(false, 0, null, 'router → opus'), 'research mode off · router → opus')
    assert.equal(ui.composeStatus(true, 2, { status: 'PASS', blocking: 0, open: 0 }, 'router on'), 'research mode on · 2 jobs running · gate PASS · router on')
    assert.equal(ui.composeStatus(true, 0, null), 'research mode on', 'without a router, the line is what it was')
    assert.notEqual(ui.statusKey(0, null, 'router on'), ui.statusKey(0, null, 'router → opus'))
    assert.equal(ui.statusKey(1, null), ui.statusKey(1, null, null))
  })
  test('a decision is described with who made it', () => {
    assert.equal(r.describe({ route: 'plan', model: 'opus', via: 'jev', why: 'planning 92%' }), 'opus · planning · planning 92% · by Jev')
    assert.equal(r.describe({ route: 'code', model: 'sonnet', via: 'rules', why: 'mentions code' }, 'timeout'), 'sonnet · coding · mentions code · by keyword rules (Jev: timeout)')
    assert.match(r.describe({ route: 'other', model: 'haiku', via: 'directive', why: 'x' }), /you asked for it/)
  })
})
