import { expect, mock, test } from 'claude-code/testing'

// The model router (hooks/router.ts). Nothing sits beneath the plugin in a test: each hook below stands for the engine. A call on `$`
// is answered `{ value }`; an event by its own result. The policy and the keyword rules are tested on their own in
// tests/scripts/router-core.test.mjs; here it is the hooks: what reaches the request, and what must never happen.

const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
type Fetched = { url: string; auth: string; body: any }

function world(on: any, opts: { env?: Record<string, string>; model?: string; failStatus?: boolean; jev?: (body: any) => { status: number; body: unknown } | 'hang' | 'throw' } = {}) {
  const status: (string | undefined)[] = []
  const toasts: string[] = []
  const fetched: Fetched[] = []
  const seen: { model: string; agentId?: string }[] = []
  const clock = mock.clock(on)
  const env = opts.env ?? {}
  on('env.get', (_: unknown, e: { name: string }) => ({ value: env[e.name] }))
  on('session.cwd', () => ({ value: '/p' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.model', () => ({ value: opts.model ?? 'claude-sonnet-5-5' }))
  on('fs.exists', () => ({ value: false }))
  on('ui.status', (_: unknown, e: { text: string | undefined }) => {
    if (opts.failStatus) throw new Error('no status line')
    status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_: unknown, e: { text: string }) => { toasts.push(e.text); return { value: undefined } })
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('http.fetch', (_: unknown, e: { url: string; init?: { headers?: Record<string, string>; body?: string } }) => {
    fetched.push({ url: e.url, auth: e.init?.headers?.['authorization'] ?? '', body: JSON.parse(String(e.init?.body ?? '{}')) })
    const answer = opts.jev?.(fetched.at(-1)!.body)
    if (answer === 'throw') throw new Error('ECONNRESET')
    if (answer === 'hang') return new Promise(() => undefined)
    const a = answer ?? { status: 500, body: {} }
    return { value: { status: a.status, ok: a.status >= 200 && a.status < 300, headers: {}, text: JSON.stringify(a.body) } }
  })
  // The bottom of the chain: records the model each request would be sent with.
  on('turn.step', async function* (_: unknown, e: { turnId: string; index: number; model: string; agentId?: string }) {
    seen.push({ model: e.model, ...(e.agentId ? { agentId: e.agentId } : {}) })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.Stop', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('tool.check', () => ({ decision: 'allow' }))
  return { status, toasts, fetched, seen, clock }
}

/** Move the mock clock in steps, letting the hook under test reach its own timer between them. */
async function wait(w: ReturnType<typeof world>, ms: number) {
  for (let i = 0; i < 5; i++) {
    for (let k = 0; k < 50; k++) await Promise.resolve()
    await w.clock.advance(ms / 5)
  }
}

let n = 0
/** One prompt: the turn starts, then the engine makes `steps` requests on `model`. Resolves to the model of each. */
async function turn($: any, w: ReturnType<typeof world>, text: string, o: { model?: string; steps?: number; agentId?: string } = {}) {
  const turnId = `t${++n}`
  const before = w.seen.length
  await $.turn.start({ text, turnId, ...(o.agentId ? { agentId: o.agentId } : {}) })
  for (let i = 0; i < (o.steps ?? 1); i++) {
    const stream = $.turn.step({ turnId, index: i, model: o.model ?? 'claude-sonnet-5-5', messageCount: 2 + i, ...(o.agentId ? { agentId: o.agentId } : {}) })
    for await (const _ of stream) void _
    await stream.result
  }
  return w.seen.slice(before).map(s => s.model)
}

const routeAnswer = (p: Partial<Record<'plan' | 'code' | 'write' | 'other', number>>, continuation = 0.02) => ({
  status: 200,
  body: { model: 'jev-1.14.0', answers: { route: { type: 'choice', choice: 'other', confidence: 1, probabilities: { plan: 0, code: 0, write: 0, other: 0, ...p } }, continuation: { type: 'noul', noul: continuation } } },
})
const start = ($: any) => $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
const router = ($: any, args = '') => $.command.run({ command: 'model-router', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
const ON = { options: { model_router: 'on' } } as const

test('off by default: no request is touched, nothing is sent anywhere', async ($, on) => {
  const w = world(on, { env: { TYPESAFE_API_KEY: 'k' } })
  await start($)
  expect(await turn($, w, 'Make a plan for the migration')).toEqual(['claude-sonnet-5-5'])
  expect(w.fetched).toEqual([])
  expect(w.status.at(-1)).toBe('research mode off')
})

test('rules, no key: planning to opus, coding to sonnet, academic writing to haiku, anything else to sonnet', ON, async ($, on) => {
  const w = world(on, { model: 'claude-fable-5-2' })
  await start($)
  const ask = (text: string) => turn($, w, text, { model: 'claude-fable-5-2' })
  expect(await ask('Make a plan for the migration of our data pipeline')).toEqual(['opus'])
  expect(await ask('Fix the failing test in tests/test_io.py')).toEqual(['sonnet'])
  expect(await ask('Proofread this paragraph of my discussion section')).toEqual(['haiku'])
  expect(await ask('What is the capital of Australia?')).toEqual(['sonnet'])
  expect(w.fetched).toEqual([]) // no key: the prompt went nowhere
})

test('every request of a turn gets the same model, tool steps included', ON, async ($, on) => {
  const w = world(on, { model: 'claude-sonnet-5-5' })
  await start($)
  expect(await turn($, w, 'Come up with a roadmap for the study', { steps: 4 })).toEqual(['opus', 'opus', 'opus', 'opus'])
})

test('a request already on the target model is left as it is, and so is a session on another provider\'s model', ON, async ($, on) => {
  const w = world(on)
  await start($)
  expect(await turn($, w, 'Make a plan for the work', { model: 'claude-opus-5-5' })).toEqual(['claude-opus-5-5'])
  expect(await turn($, w, 'Make a plan for the work', { model: 'deepseek-chat' })).toEqual(['deepseek-chat'])
})

test('a long-context session keeps its window', ON, async ($, on) => {
  const w = world(on)
  await start($)
  expect(await turn($, w, 'Make a plan for the work', { model: 'claude-sonnet-5-5[1m]' })).toEqual(['opus[1m]'])
})

test('a subagent runs the model its own definition names', ON, async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, w, 'Make a plan for the work', { model: 'claude-haiku-5-5' }) // the main loop is routed to opus
  expect(await turn($, w, 'Summarise these notes', { model: 'claude-haiku-5-5', agentId: 'agent-1' })).toEqual(['claude-haiku-5-5'])
})

test('the models are the person\'s to choose, and a value that is not a model name is ignored', { options: { model_router: 'on', router_plan_model: 'claude-opus-5-5', router_code_model: 'claude-haiku-5-5', router_write_model: 'not a model; rm -rf /', router_fallback_model: 'opus' } }, async ($, on) => {
  const w = world(on)
  await start($)
  expect(await turn($, w, 'Make a plan for the work', { model: 'claude-sonnet-5-5' })).toEqual(['claude-opus-5-5'])
  expect(await turn($, w, 'Fix the bug in main.py', { model: 'claude-sonnet-5-5' })).toEqual(['claude-haiku-5-5'])
  expect(await turn($, w, 'Rewrite my abstract to be shorter', { model: 'claude-sonnet-5-5' })).toEqual(['haiku']) // the default, the setting was refused
  expect(await turn($, w, 'What does a p-value mean?', { model: 'claude-sonnet-5-5' })).toEqual(['opus'])
})

test('[opus], [sonnet] and [haiku] at the start choose the model for that prompt, over the classifier', ON, async ($, on) => {
  const w = world(on, { env: { TYPESAFE_API_KEY: 'k' }, jev: () => routeAnswer({ plan: 0.9 }) })
  await start($)
  expect(await turn($, w, '[haiku] Make a plan for the work', { model: 'claude-opus-5-5' })).toEqual(['haiku'])
  expect(w.fetched).toEqual([])
  // a tag anywhere but the start is just words: the classifier decides (here it says planning, and the session is on opus already)
  expect(await turn($, w, 'mention [haiku] later in the sentence: fix main.py', { model: 'claude-opus-5-5' })).toEqual(['claude-opus-5-5'])
  expect(w.fetched.length).toBe(1)
})

test('with a key, Jev decides and is sent the prompt and the key, nothing else', ON, async ($, on) => {
  const w = world(on, { env: { TYPESAFE_API_KEY: 'secret-key' }, jev: () => routeAnswer({ plan: 0.92, code: 0.05, other: 0.03 }) })
  await start($)
  expect(await turn($, w, 'Before we touch the code, how should we structure the new module?')).toEqual(['opus'])
  expect(w.fetched.length).toBe(1)
  expect(w.fetched[0]!.url).toBe(JEV_URL)
  expect(w.fetched[0]!.auth).toBe('Bearer secret-key')
  expect(Object.keys(w.fetched[0]!.body).sort()).toEqual(['model', 'questions', 'state'])
  expect(w.fetched[0]!.body.state).toEqual({ message: 'Before we touch the code, how should we structure the new module?' })
  expect(Object.keys(w.fetched[0]!.body.questions).sort()).toEqual(['continuation', 'route'])
})

test('the key saved in the plugin\'s settings is used', { options: { model_router: 'on', typesafe_api_key: 'saved-key' } }, async ($, on) => {
  const w = world(on, { jev: () => routeAnswer({ plan: 0.9, other: 0.1 }) })
  await start($)
  expect(await turn($, w, 'Make a plan for the work')).toEqual(['opus'])
  expect(w.fetched[0]!.auth).toBe('Bearer saved-key')
})

test('router_engine rules keeps every prompt on this machine, key or not', { options: { model_router: 'on', router_engine: 'rules', typesafe_api_key: 'saved-key' } }, async ($, on) => {
  const w = world(on, { env: { TYPESAFE_API_KEY: 'other-key' }, jev: () => routeAnswer({ code: 0.95 }) })
  await start($)
  expect(await turn($, w, 'Make a plan for the work')).toEqual(['opus'])
  expect(w.fetched).toEqual([])
  expect((await router($, 'status')).text).toContain('no prompt leaves this machine')
})

test('an address other than TypeSafe\'s is refused: a prompt and a key are never sent to another host', ON, async ($, on) => {
  const w = world(on, { env: { TYPESAFE_API_KEY: 'k', AH_ROUTER_JEV_URL: 'https://evil.example/v1/systemone' }, jev: () => routeAnswer({ plan: 0.9 }) })
  await start($)
  await turn($, w, 'Make a plan for the work')
  expect(w.fetched.map(f => f.url)).toEqual([JEV_URL])
})

test('a loopback address is honoured, for tests that stand in for TypeSafe', ON, async ($, on) => {
  const w = world(on, { env: { TYPESAFE_API_KEY: 'k', AH_ROUTER_JEV_URL: 'http://127.0.0.1:9/v1/systemone' }, jev: () => routeAnswer({ plan: 0.9 }) })
  await start($)
  await turn($, w, 'Make a plan for the work')
  expect(w.fetched.map(f => f.url)).toEqual(['http://127.0.0.1:9/v1/systemone'])
})

test('Jev\'s probabilities go through the policy: the smallest model needs a clear case', ON, async ($, on) => {
  const answers: Record<string, ReturnType<typeof routeAnswer>> = {
    clear: routeAnswer({ write: 0.9, code: 0.05, other: 0.05 }),
    mixed: routeAnswer({ write: 0.55, code: 0.4, other: 0.05 }),
    vague: routeAnswer({ plan: 0.2, code: 0.3, write: 0.25, other: 0.25 }),
    both: routeAnswer({ plan: 0.45, code: 0.45, other: 0.1 }),
  }
  let which = 'clear'
  const w = world(on, { env: { TYPESAFE_API_KEY: 'k' }, jev: () => answers[which]! })
  await start($)
  const ask = (k: string) => { which = k; return turn($, w, `prompt ${k} ${Math.random()}`, { model: 'claude-fable-5-2' }) }
  expect(await ask('clear')).toEqual(['haiku'])
  expect(await ask('mixed')).toEqual(['sonnet'])
  expect(await ask('vague')).toEqual(['sonnet'])
  expect(await ask('both')).toEqual(['opus']) // any prompt that needs a plan
})

test('a go-ahead keeps coding or writing, and never keeps planning', ON, async ($, on) => {
  let answer: ReturnType<typeof routeAnswer> = routeAnswer({ write: 0.95, other: 0.05 })
  const w = world(on, { env: { TYPESAFE_API_KEY: 'k' }, jev: () => answer })
  await start($)
  const ask = (t: string) => turn($, w, t, { model: 'claude-fable-5-2' })
  expect(await ask('Polish the abstract of my paper')).toEqual(['haiku'])
  answer = routeAnswer({ other: 0.9, code: 0.1 }, 0.97)
  expect(await ask('yes, go ahead')).toEqual(['haiku'])
  answer = routeAnswer({ plan: 0.95, other: 0.05 })
  expect(await ask('Draft a plan for the new experiments')).toEqual(['opus'])
  answer = routeAnswer({ other: 0.9, code: 0.1 }, 0.97)
  expect(await ask('looks good, do it')).toEqual(['sonnet'])
})

test('Jev slow, refused, failing or malformed: the keyword rules answer, the turn is not held, and Jev is left alone for a while', ON, async ($, on) => {
  let mode: 'hang' | 'throw' | 'denied' | 'bad' = 'hang'
  const env: Record<string, string> = { TYPESAFE_API_KEY: 'k' }
  const w = world(on, {
    env,
    jev: () => (mode === 'denied' ? { status: 401, body: {} } : mode === 'bad' ? { status: 200, body: { answers: { route: { probabilities: { plan: 'high' } } } } } : mode),
  })
  await start($)
  const plan = 'Make a plan for the work'
  const slow = turn($, w, plan, { model: 'claude-sonnet-5-5' })
  await wait(w, 3000) // past the 2.5 s the router waits for Jev
  expect(await slow).toEqual(['opus'])
  expect(w.fetched.length).toBe(1)
  expect((await router($, 'status')).text).toContain('Jev did not decide: timeout')

  // Within the pause Jev is not asked again, so a dead service does not cost every prompt its timeout.
  expect(await turn($, w, 'Fix the bug in a.py', { model: 'claude-opus-5-5' })).toEqual(['sonnet'])
  expect(w.fetched.length).toBe(1)

  // After it Jev is asked again; a refused key then waits ten minutes.
  await wait(w, 61_000)
  mode = 'denied'
  expect(await turn($, w, plan, { model: 'claude-sonnet-5-5' })).toEqual(['opus'])
  expect(w.fetched.length).toBe(2)
  expect((await router($, 'status')).text).toContain('Jev did not decide: auth_failed')
  await wait(w, 61_000)
  expect(await turn($, w, plan, { model: 'claude-sonnet-5-5' })).toEqual(['opus'])
  expect(w.fetched.length).toBe(2)

  // A new key is not held back by the old one's failure.
  env['TYPESAFE_API_KEY'] = 'a-new-key'
  expect(await turn($, w, plan, { model: 'claude-sonnet-5-5' })).toEqual(['opus'])
  expect(w.fetched.length).toBe(3)
  expect(w.fetched[2]!.auth).toBe('Bearer a-new-key')

  // A 200 that is not the shape Jev answers in is a fallback too, never a guess.
  await wait(w, 10 * 60_000)
  mode = 'bad'
  expect(await turn($, w, 'Fix the bug in a.py', { model: 'claude-opus-5-5' })).toEqual(['sonnet'])
  expect((await router($, 'status')).text).toContain('malformed_response')
})

test('a throw from the network is a fallback, not a failed turn', ON, async ($, on) => {
  const w = world(on, { env: { TYPESAFE_API_KEY: 'k' }, jev: () => 'throw' })
  await start($)
  expect(await turn($, w, 'Make a plan for the work', { model: 'claude-sonnet-5-5' })).toEqual(['opus'])
  expect((await router($, 'status')).text).toContain('network_error')
})

test('a notice of a finished job is not a new task: the route stays, and a plan is not kept', ON, async ($, on) => {
  const w = world(on)
  await start($)
  const ask = (t: string, kind = 'composer') => $.prompt.submit({ text: t, wait: false, origin: { kind } as any }).then(() => turn($, w, t, { model: 'claude-fable-5-2' }))
  expect(await ask('Fix the bug in a.py')).toEqual(['sonnet'])
  expect(await ask('Background job job-1 finished: deep_research: RAG. Read the result with job_status.', 'plugin')).toEqual(['sonnet'])
  expect(await ask('Make a plan for the work')).toEqual(['opus'])
  expect(await ask('Background job job-2 finished.', 'task-notification')).toEqual(['sonnet'])
  expect(await turn($, w, '', { model: 'claude-fable-5-2' })).toEqual(['sonnet']) // a continued turn with no prompt
})

test('plan mode goes to the planning model whatever the words are', ON, async ($, on) => {
  const w = world(on)
  await start($)
  const text = 'Change the colour of the button'
  await $.classic.UserPromptSubmit({ prompt: text, permission_mode: 'plan' })
  expect(await turn($, w, text, { model: 'claude-sonnet-5-5' })).toEqual(['opus'])
  // the next prompt, sent outside plan mode, is classified on its own
  expect(await turn($, w, text, { model: 'claude-sonnet-5-5' })).toEqual(['claude-sonnet-5-5'])
})

test('/model-router: on and off for the session, over the setting; status says what it would do', async ($, on) => {
  const w = world(on, { env: { TYPESAFE_API_KEY: 'k' } })
  await start($)
  expect((await router($)).text).toContain('Model router is off (from the model_router setting)')
  const switched = (await router($, 'on')).text
  expect(switched).toContain('Model router on.')
  expect(switched).toContain('Planning → opus · coding → sonnet · academic writing → haiku · everything else → sonnet')
  expect(switched).toContain('Jev (TypeSafe key found)')
  expect(w.status.at(-1)).toBe('research mode off · router on')
  expect(await turn($, w, 'Rewrite my abstract')).toEqual(['haiku']) // Jev answers 500 here, so the rules answer
  expect((await router($, 'off')).text).toContain('Model router off.')
  expect(w.status.at(-1)).toBe('research mode off')
  expect((await router($, 'nonsense')).text).toContain('Unknown argument "nonsense"')
})

test('/model-router explain shows the decision without sending the prompt where no key is set', ON, async ($, on) => {
  const w = world(on)
  await start($)
  const said = (await router($, 'explain Draft a research plan for the new cohort')).text
  expect(said).toContain('opus · planning')
  expect(said).toContain('Nothing was sent anywhere')
  expect(w.fetched).toEqual([])
  expect((await router($, 'explain')).text).toContain('Say which prompt to explain')
})

test('the router names itself in the status line, and a change of model raises one toast', ON, async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.status.at(-1)).toBe('research mode off · router on')
  await turn($, w, 'Make a plan for the work')
  expect(w.status.at(-1)).toBe('research mode off · router → opus')
  expect(w.toasts).toEqual(['router → opus (planning)'])
  await turn($, w, 'Make a plan for the other work')
  expect(w.toasts.length).toBe(1) // the same model again: no second toast
})

test('a status line that cannot be drawn never stops a turn or loses the decision', { options: { model_router: 'on' } }, async ($, on) => {
  const w = world(on, { failStatus: true })
  await start($)
  expect(await turn($, w, 'Make a plan for the work')).toEqual(['opus'])
})
