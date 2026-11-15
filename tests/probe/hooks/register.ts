import type { Register } from 'claude-code'

// P0 probe module. It writes one JSON line per observation to the file named by
// AH_PROBE_OUT, so a nested `claude -p` run can be read back afterwards. Without
// AH_PROBE_OUT it logs nothing. Behaviour switches (all off by default):
//   AH_PROBE_ASK=1   tool.check answers `ask` for the probe_noop tool (S6)
//   AH_PROBE_STOP=1  classic.Stop blocks once (S5)
//   AH_PROBE_THROW=1 classic.PreToolUse throws, with a fail-closed .catch (S5)
//   AH_PROBE_THROW=2 a tool.call hook on Bash throws, with no .catch (S5)
//   AH_PROBE_AH=<path to an `ah` executable>  used by the TIMEME call (S8)

async function log($: any, kind: string, data: unknown) {
  const out = await $.env.get('AH_PROBE_OUT')
  if (!out) return
  const at = await $.clock.now()
  const prev = (await $.fs.exists(out)) ? await $.fs.read(out) : ''
  const prevText = typeof prev === 'string' ? prev : String((prev as any)?.text ?? '')
  await $.fs.write(out, prevText + JSON.stringify({ at, src: 'hooks', kind, data }) + '\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await log($, 'session.start', {
      sessionId: await $.session.id(),
      cwd: await $.session.cwd(),
      pluginRoot: $.plugin.root,
      event: e,
    })
    await $.command.register({ name: 'probe', description: 'P0 probe command (S7)' })
    return next(e)
  })

  on('command.run', { command: 'probe' }, async ($, e, next) => {
    await log($, 'command.run', { command: e.command, args: e.args })
    return { text: 'PROBE-COMMAND-RAN' }
  })

  on('classic.PreToolUse', async ($, e, next) => {
    // classic.PreToolUse shares tool.call's envelope: e.tool and the tool's own
    // arguments flattened onto e (e.command for Bash), not the settings-hook stdin.
    await log($, 'classic.PreToolUse', { envelope: e })
    if (e.tool === 'Bash' && e.command.includes('DENYME')) {
      return { deny: 'PROBE-DENIED by classic.PreToolUse' }
    }
    if (e.tool === 'Bash' && e.command.includes('TIMEME')) {
      const ah = await $.env.get('AH_PROBE_AH')
      if (ah) {
        const t0 = await $.clock.now()
        const r = await $.process.run([ah, 'hook', 'pre'], {
          stdin: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/nonexistent' }, session_id: 'probe', cwd: await $.session.cwd(), transcript_path: '' }),
          timeoutMs: 120000,
        })
        const t1 = await $.clock.now()
        await log($, 'S8.process.run', { ms: t1 - t0, exitCode: r.exitCode, stdout: r.stdout.slice(0, 300), stderr: r.stderr.slice(0, 300) })
      }
    }
    if ((await $.env.get('AH_PROBE_THROW')) === '1') throw new Error('probe: classic.PreToolUse threw on purpose')
    return next(e)
  }).catch(async ($, e, next) => {
    // Fail closed: only for the throw scenario, so the other scenarios are unaffected.
    if ((await $.env.get('AH_PROBE_THROW')) === '1' && !next.called) {
      await log($, 'classic.PreToolUse.catch', { tool: e.tool })
      return e.tool === 'Bash' ? { deny: 'PROBE-CATCH-DENY: guard failed' } : next(e)
    }
    return next(e)
  })

  // A gating hook with no .catch that throws (AH_PROBE_THROW=2): is the call skipped-over or blocked?
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if ((await $.env.get('AH_PROBE_THROW')) === '2') throw new Error('probe: tool.call threw on purpose')
    return next(e)
  })

  on('classic.PostToolUse', async ($, e, next) => {
    await log($, 'classic.PostToolUse', { tool: e.tool_name })
    const r = await next(e)
    return { ...r, additionalContext: [...(r.additionalContext ?? []), 'PROBE-POST-NOTE'] }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await log($, 'classic.UserPromptSubmit', { prompt: String(e.prompt ?? '').slice(0, 80) })
    const r = await next(e)
    return { ...r, additionalContext: [...(r.additionalContext ?? []), 'PROBE-PROMPT-CONTEXT'] }
  })

  on('classic.Stop', async ($, e, next) => {
    const isStopProbe = (await $.env.get('AH_PROBE_STOP')) === '1'
    await log($, 'classic.Stop', { stop_hook_active: e.stop_hook_active, isStopProbe })
    if (isStopProbe && !e.stop_hook_active) {
      return { block: 'PROBE-STOP-BLOCK: reply with the single word AGAIN before stopping.' }
    }
    return next(e)
  })

  on('tool.check', { tool: /probe_noop/ }, async ($, e, next) => {
    const isAsk = (await $.env.get('AH_PROBE_ASK')) === '1'
    await log($, 'tool.check', { tool: e.tool, isAsk, approver: e.approver ?? null })
    if (isAsk) return { decision: 'ask', reason: 'PROBE-ASK from tool.check' }
    return next(e)
  })

  on('tool.call', { tool: /probe_/ }, async ($, e, next) => {
    await log($, 'tool.call', { tool: e.tool })
    return next(e)
  })
}
