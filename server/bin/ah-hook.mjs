#!/usr/bin/env node
// The guard bridge: run the writing engine's `ah hook <event>` for the hooks module.
//
//   node server/bin/ah-hook.mjs <userprompt|pre|post|stop>     payload on stdin, the engine's reply on stdout
//
// The hooks module has no Node, so it starts this with $.process.run. This file resolves the engine the
// way upstream does (academic-harness-cli.js: ACADEMIC_HARNESS_CLI or AH_CMD, else the venv inside the
// snapshot), runs it in the project, and hands its stdout and exit code back unchanged.
//
// Exit codes: the engine's own (0 for an answer, an allow prints nothing), 3 when there is no engine to
// run, 124 when the engine overran its time. Anything but 0 is a failure the hooks module must not read
// as "allowed": the guard fails closed for mutating calls.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { engineDir, engineStatus } from '../src/engine.mjs'
import { coreDir, modHome } from '../src/paths.mjs'
import { loadRsi, mergeReply, rsiEvent } from '../src/rsi-bridge.mjs'

export const EXIT_NO_ENGINE = 3
export const EXIT_TIMEOUT = 124
const EVENTS = new Set(['userprompt', 'pre', 'post', 'stop', 'rsi-post'])
/** The events the self-improvement loop (ah_rsi) listens to, and the name it knows each by. `rsi-post` is only the loop: the hooks module sends it for every tool, the engine for the few that edit. */
const RSI_EVENT = { userprompt: 'userprompt', stop: 'stop', 'rsi-post': 'post' }

async function readStdin() {
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text
}

export async function main(argv = process.argv.slice(2), env = process.env, stdin = readStdin) {
  const event = argv[0]
  if (!EVENTS.has(event)) {
    process.stderr.write(`ah-hook: expected one of ${[...EVENTS].join(', ')}, got "${event ?? ''}"\n`)
    return 2
  }
  const raw = await stdin()
  let payload
  try {
    payload = JSON.parse(raw || '{}')
  } catch {
    process.stderr.write('ah-hook: stdin is not JSON\n')
    return 2
  }
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd()

  // The loop runs in its own process step and never stops a turn: whatever it does, the reply is the engine's, plus lessons when there are any.
  const runRsi = async (root, engineOut) => {
    // The shell's AH_RSI wins over the plugin option the hooks module passes as AH_RSI_SETTING.
    const mode = (env.AH_RSI?.trim() || env.AH_RSI_SETTING?.trim() || '').toLowerCase()
    if (!RSI_EVENT[event] || ['off', '0', 'false', 'no'].includes(mode)) return {}
    try {
      process.env.DSH_HOME = modHome(env)
      if (!process.env.AH_RSI?.trim() && mode) process.env.AH_RSI = mode
      return await rsiEvent({ event: RSI_EVENT[event], payload, root, home: modHome(env), rsi: await loadRsi(coreDir(env)), engineOut })
    } catch (error) {
      process.stderr.write(`ah-hook: rsi: ${error?.message ?? error}\n`)
      return {}
    }
  }
  if (event === 'rsi-post') {
    const cli = await import(pathToFileURL(join(coreDir(env), 'academic-harness-cli.js')).href)
    const root = cli.findAhRoot(cwd)
    if (root) await runRsi(root)
    return 0
  }

  // AH_NO_ENFORCE=1 is the engine's own switch for working without the guard (it skips pre, post and stop). The fail-closed text names it
  // as the way on when the engine cannot run, so it has to hold then too: without this an engine that is not built refused every edit and the
  // switch could not be reached. Set by the person in the environment Claude Code starts in; a tool call cannot set it.
  if (env.AH_NO_ENFORCE === '1' && event !== 'userprompt') return 0

  // The installer flags stay off: this process never builds anything, it only looks for a built engine.
  env.ACADEMIC_HARNESS_SKIP_INSTALL = '1'
  const status = engineStatus(env, undefined, { verify: false })
  if (!status.ok) {
    const { installing } = await import('../src/engine-install.mjs')
    const building = installing(engineDir(coreDir(env)))
    process.stderr.write(`ah-hook: no engine to run: ${building ? 'the engine is being installed (it takes under a minute); try again shortly' : status.why}\n`)
    return EXIT_NO_ENGINE
  }
  const upstream = coreDir(env)
  const cliFile = join(upstream, 'academic-harness-cli.js')
  if (!existsSync(cliFile)) {
    process.stderr.write(`ah-hook: ${cliFile} is missing; run node scripts/setup.mjs\n`)
    return EXIT_NO_ENGINE
  }
  const cli = await import(pathToFileURL(cliFile).href)
  const launch = cli.resolveAhLaunch()
  if (!launch) {
    process.stderr.write('ah-hook: the engine launcher resolved nothing\n')
    return EXIT_NO_ENGINE
  }
  const root = cli.findAhRoot(cwd)
  if (!root) return 0 // not an Academic Harness project: nothing to do, and nothing is started
  // The engine's own log, kept apart from DSH's so a person can tell the two hosts' events apart.
  const childEnv = cli.ahEnv({ AH_LOG: env.AH_LOG?.trim() || join(root, '.ah', 'claude-hooks.jsonl'), ...(env.AH_T3_MODE ? { AH_T3_MODE: env.AH_T3_MODE } : {}) }, { root, model: env.AH_MODEL })
  const timeoutMs = Number(env.AH_HOOK_TIMEOUT_MS) > 0 ? Number(env.AH_HOOK_TIMEOUT_MS) : 110_000
  const r = await cli.run(launch.command, cli.cliArgs(launch, ['hook', event]), { cwd, timeoutMs, env: childEnv, silent: true, stdin: `${JSON.stringify(payload)}\n` })
  let out = r.out
  if (r.code === 0 && RSI_EVENT[event]) {
    const lessons = await runRsi(root, r.out)
    if (lessons.additionalContext) out = mergeReply(out, lessons.additionalContext)
  }
  if (out) process.stdout.write(out)
  if (r.err) process.stderr.write(r.err)
  if (r.code === EXIT_TIMEOUT) process.stderr.write(`ah-hook: the engine did not answer within ${timeoutMs} ms\n`)
  return r.code
}


if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then(code => process.exit(code), error => {
    process.stderr.write(`ah-hook: ${error?.message ?? error}\n`)
    process.exit(1)
  })
}
