#!/usr/bin/env node
// Live model-router scenarios: nested `claude -p` with the mod loaded by --plugin-dir and model_router on. What is checked is the model
// Claude Code really sent each request to, read from the `assistant` messages of the stream.
//
//   node tests/live/router.mjs                    all, with the keyword rules and a local stand-in for TypeSafe
//   node tests/live/router.mjs rules steps        some, by name
//   TYPESAFE_API_KEY=... node tests/live/router.mjs real     the real Jev: calibration over tests/fixtures/router-prompts.json
//
// rules        no key: planning -> opus, coding -> sonnet, academic writing -> haiku, anything else -> sonnet
// off          the router off (the default): a planning prompt stays on the session's model
// directive    [haiku] at the start of a planning prompt wins over the classifier
// steps        a turn that calls a tool: every request of the turn is on the same model
// jev          a local stand-in for TypeSafe answers: the request it gets, and that its probabilities decide the model
// jev-option   the key comes from the plugin's own option, not the shell
// jev-down     the stand-in never answers: the keyword rules answer after the 2.5 s wait, and the prompt is held no longer
// command      /model-router status, on and off inside one session
// real         needs a TypeSafe key; prints what Jev decides for each fixture prompt and how often it agrees with the label
//
// Costs: a request on a model not yet used in the last hour writes the whole prompt prefix to that model's cache (about 68k tokens with
// this machine's tools: $0.54 on Opus the first time). Cents for the rest. Needs a working `claude` login.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const base = join(homedir(), '.cache', 'ah-cc-router', 'live-tests')
const SESSION_MODEL = 'sonnet'
const ONLY = 'Reply with only the single word DONE.'

/** One headless run. Resolves to the models of the assistant messages, the result and the stand-in's log. */
function run(name, prompt, { options = {}, env = {}, allow = [], budget = 1.5, model = SESSION_MODEL, timeout = 300_000 } = {}) {
  const cwd = join(base, name)
  rmSync(cwd, { recursive: true, force: true })
  mkdirSync(cwd, { recursive: true })
  const settings = join(base, `${name}.settings.json`)
  writeFileSync(settings, JSON.stringify({ pluginConfigs: { 'academic-harness@inline': { options: { model_router: 'on', ...options } } } }))
  const args = ['-p', prompt, '--plugin-dir', root, '--model', model, '--max-budget-usd', String(budget), '--settings', settings, '--output-format', 'stream-json', '--verbose']
  if (allow.length) args.push('--allowedTools', allow.join(','))
  const childEnv = { ...process.env, AH_MOD_HOME: join(base, 'home'), AH_MANAGED_INSTALLS: '0', AH_AUTO_INSTALL: '0', ...env }
  return new Promise(res => {
    const child = spawn('claude', args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let firstAnswerMs = null
    const started = Date.now()
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
    child.stdout.on('data', d => {
      out += d
      if (firstAnswerMs === null && /"type":"assistant"/.test(String(d))) firstAnswerMs = Date.now() - started
    })
    child.on('close', () => {
      clearTimeout(timer)
      const events = out.split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
      const assistants = events.filter(e => e.type === 'assistant')
      res({
        ms: Date.now() - started,
        firstAnswerMs,
        init: events.find(e => e.type === 'system' && e.subtype === 'init'),
        models: assistants.map(e => e.message.model),
        synthetic: assistants.filter(e => e.message.model === '<synthetic>').map(e => e.message.content.map(c => c.text ?? c.type).join(' ')),
        calls: assistants.flatMap(e => e.message.content.filter(b => b.type === 'tool_use')),
        text: events.find(e => e.type === 'result')?.result ?? '',
        result: events.find(e => e.type === 'result'),
      })
    })
  })
}
const cost = r => `$${(r.result?.total_cost_usd ?? 0).toFixed(2)}`
const uniq = xs => [...new Set(xs)]
const family = m => /opus/.test(m) ? 'opus' : /sonnet/.test(m) ? 'sonnet' : /haiku/.test(m) ? 'haiku' : m
// A reply Claude Code made itself (`<synthetic>`: an API error, a rate limit) says nothing about routing: report what it said.
const modelsOf = r => {
  if (r.synthetic.length) throw new Error(`Claude Code answered with its own message, not a model: ${r.synthetic[0].slice(0, 200)}`)
  return uniq(r.models.map(family))
}

/** A stand-in for TypeSafe on a loopback port: records what it is sent and answers by the prompt's own words. */
function standIn(answer) {
  const log = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', d => (body += d))
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}')
      log.push({ url: req.url, method: req.method, auth: req.headers.authorization, body: parsed })
      const a = answer(String(parsed.state?.message ?? ''))
      if (a === 'hang') return
      if (a === 'refuse') { res.writeHead(401).end('{"error":"bad key"}'); return }
      const probabilities = { plan: 0, code: 0, write: 0, other: 0, ...a.p }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        model: 'jev-1.14.0',
        answers: { route: { type: 'choice', choice: 'other', confidence: 1, probabilities }, continuation: { type: 'noul', noul: a.cont ?? 0.01 } },
        usage: { input_tokens: 100, output_tokens: 10 },
      }))
    })
  })
  return new Promise(res => server.listen(0, '127.0.0.1', () => res({ log, url: `http://127.0.0.1:${server.address().port}/v1/systemone`, close: () => server.closeAllConnections?.() ?? server.close() })))
}

const scenarios = {
  async rules() {
    const cases = [
      ['plan', `Make a plan for migrating a small data pipeline to Spark. ${ONLY}`, 'opus'],
      ['code', `Fix the failing test in tests/test_io.py. ${ONLY}`, 'sonnet'],
      ['write', `Proofread this paragraph of my discussion section: "We found that the effect were significant". ${ONLY}`, 'haiku'],
      ['other', `What is the capital of Australia? ${ONLY}`, 'sonnet'],
    ]
    const seen = []
    let total = 0
    for (const [name, prompt, want] of cases) {
      const r = await run(`rules-${name}`, prompt, { options: { router_engine: 'rules' } })
      assert.deepEqual(modelsOf(r), [want], `${name}: the session is on ${SESSION_MODEL}, the models used were ${r.models}`)
      seen.push(`${name}→${want}`)
      total += r.result?.total_cost_usd ?? 0
    }
    return `${seen.join(', ')}; $${total.toFixed(2)}`
  },
  async off() {
    const r = await run('off', `Make a plan for migrating a small data pipeline to Spark. ${ONLY}`, { options: { model_router: 'off' } })
    assert.deepEqual(modelsOf(r), ['sonnet'], `used ${r.models}`)
    return `a planning prompt stays on ${SESSION_MODEL}, ${cost(r)}`
  },
  async directive() {
    const r = await run('directive', `[haiku] Make a plan for migrating a small data pipeline to Spark. ${ONLY}`, { options: { router_engine: 'rules' } })
    assert.deepEqual(modelsOf(r), ['haiku'], `used ${r.models}`)
    return `[haiku] beat the planning rule, ${cost(r)}`
  },
  async steps() {
    const r = await run('steps', `Make a plan for a tiny script: first run the Bash command \`echo router-live\`, then say DONE.`, { options: { router_engine: 'rules' }, allow: ['Bash'] })
    assert.ok(r.calls.some(c => c.name === 'Bash'), `the Bash tool was not called: ${r.calls.map(c => c.name)}`)
    assert.ok(r.models.length >= 2, `a tool call means two requests at least: ${r.models.length}`)
    assert.deepEqual(modelsOf(r), ['opus'], `every request of the turn on one model: ${r.models}`)
    return `${r.models.length} requests, all on opus, ${cost(r)}`
  },
  async jev() {
    const stand = await standIn(text => (/proofread/i.test(text) ? { p: { write: 0.95, other: 0.05 } } : /capital/i.test(text) ? { p: { plan: 0.9, other: 0.1 } } : { p: { code: 0.9, other: 0.1 } }))
    try {
      const env = { AH_ROUTER_JEV_URL: stand.url, TYPESAFE_API_KEY: 'live-test-key' }
      // The words say planning; the stand-in says coding. Jev decides, so the model is sonnet (the rules would have said opus).
      const a = await run('jev-a', `Make a plan for migrating a small data pipeline to Spark. ${ONLY}`, { env })
      assert.deepEqual(modelsOf(a), ['sonnet'], `Jev said coding: ${a.models}`)
      // The words say nothing; the stand-in says writing with 95%.
      const b = await run('jev-b', `Proofread my sentence about the results. ${ONLY}`, { env })
      assert.deepEqual(modelsOf(b), ['haiku'], `Jev said writing: ${b.models}`)
      // A trivial question the stand-in calls planning: opus. Cents on sonnet, so the one opus run is the cache write only.
      const c = await run('jev-c', `What is the capital of Australia? ${ONLY}`, { env })
      assert.deepEqual(modelsOf(c), ['opus'], `Jev said planning: ${c.models}`)
      assert.equal(stand.log.length, 3, `one request per prompt: ${stand.log.length}`)
      for (const q of stand.log) {
        assert.equal(q.method, 'POST')
        assert.equal(q.auth, 'Bearer live-test-key')
        assert.equal(q.body.model, 'jev-1.14.0')
        assert.deepEqual(Object.keys(q.body.questions).sort(), ['continuation', 'route'])
        assert.ok(typeof q.body.state.message === 'string' && q.body.state.message.length > 0)
      }
      assert.ok(stand.log[0].body.state.message.startsWith('Make a plan for migrating'), 'the prompt was sent as the message')
      return `Jev's answers decided: coding→sonnet, writing→haiku, planning→opus; 3 requests, ${cost(a)}+${cost(b)}+${cost(c)}`
    } finally {
      stand.close()
    }
  },
  async 'jev-option'() {
    const stand = await standIn(() => ({ p: { write: 0.95, other: 0.05 } }))
    try {
      const env = { AH_ROUTER_JEV_URL: stand.url, TYPESAFE_API_KEY: '' }
      const r = await run('jev-option', `Say hello. ${ONLY}`, { env, options: { typesafe_api_key: 'key-from-the-option' } })
      assert.equal(stand.log.length, 1, 'Jev was asked: the option reached the hooks module')
      assert.equal(stand.log[0].auth, 'Bearer key-from-the-option')
      assert.deepEqual(modelsOf(r), ['haiku'], `used ${r.models}`)
      return `a key saved as a plugin option reached Jev, ${cost(r)}`
    } finally {
      stand.close()
    }
  },
  async 'jev-down'() {
    const hang = await standIn(() => 'hang')
    try {
      const env = { AH_ROUTER_JEV_URL: hang.url, TYPESAFE_API_KEY: 'live-test-key' }
      const prompt = `Proofread this sentence: "The data was collected." ${ONLY}`
      const baseline = await run('jev-down-base', prompt, { env: { ...env, AH_ROUTER_JEV_URL: '' }, options: { router_engine: 'rules' } })
      const slow = await run('jev-down', prompt, { env })
      assert.deepEqual(modelsOf(slow), ['haiku'], `the rules answered: ${slow.models}`)
      assert.equal(hang.log.length, 1, 'Jev was asked once')
      // What matters is when the model answered, not when the process ended: an abandoned request runs to the engine's own limit
      // (about 30 s) and only a headless process waits for it.
      const held = slow.firstAnswerMs - baseline.firstAnswerMs
      assert.ok(held > 1500 && held < 6000, `the prompt was held ${held} ms for a Jev that never answered; the router waits 2.5 s`)
      const tail = slow.ms - slow.firstAnswerMs
      return `Jev never answered: the rules chose haiku after ${(held / 1000).toFixed(1)} s; the process then took ${(tail / 1000).toFixed(0)} s to exit, ${cost(slow)}`
    } finally {
      hang.close()
    }
  },
  async command() {
    const r = await run('command', '/model-router status', { options: { model_router: 'off' }, budget: 0.5 })
    const said = `${r.text}\n${JSON.stringify(r.result)}`
    assert.match(said, /Model router is off/, `status said: ${said.slice(0, 300)}`)
    assert.match(said, /Planning → opus · coding → sonnet · academic writing → haiku · everything else → sonnet/)
    const on = await run('command-on', '/model-router on', { options: { model_router: 'off' }, budget: 0.5 })
    assert.match(`${on.text}\n${JSON.stringify(on.result)}`, /Model router on\./)
    return 'status and on answer in a headless run'
  },
  async real() {
    if (!process.env.TYPESAFE_API_KEY) throw new Error('set TYPESAFE_API_KEY to run the real Jev')
    const fixtures = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'router-prompts.json'), 'utf8'))
    const r = await import(join(root, 'tests', 'helpers', 'ts-resolve.mjs')).then(() => import(join(root, 'hooks', 'router-core.ts')))
    let agree = 0
    const misses = []
    for (const f of fixtures) {
      const res = await fetch(r.JEV_URL, { method: 'POST', headers: { authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(r.jevRequest(f.prompt)) })
      const j = r.parseJev(await res.json().catch(() => null))
      if (!j.ok) { misses.push(`${f.expect.padEnd(5)} ?  ${f.prompt.slice(0, 70)} (${j.reason}, http ${res.status})`); continue }
      const d = r.decide(j.p, j.continuation, f.previous ?? null)
      const ok = d.route === f.expect || (f.accept ?? []).includes(d.route)
      if (ok) agree++
      else misses.push(`${f.expect.padEnd(5)} → ${d.route.padEnd(5)} ${f.prompt.slice(0, 70)}  [${Object.entries(j.p).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' ')} · go ${j.continuation.toFixed(2)}]`)
    }
    console.log(misses.map(m => `    ${m}`).join('\n'))
    return `${agree} of ${fixtures.length} prompts routed as labelled`
  },
}

const wanted = process.argv.slice(2)
const names = wanted.length ? wanted : Object.keys(scenarios).filter(n => n !== 'real')
let failed = 0
for (const name of names) {
  if (!scenarios[name]) { console.error(`no scenario ${name}: ${Object.keys(scenarios).join(', ')}`); process.exit(2) }
  try {
    console.log(`✔ ${name}: ${await scenarios[name]()}`)
  } catch (error) {
    failed++
    console.log(`✘ ${name}: ${error instanceof Error ? error.message : error}`)
  }
}
process.exit(failed ? 1 : 0)
