// The guard's pure translation layer (hooks/guard-core.ts): the engine's stdout is JSON, but a warning line or a log line may share
// the stream with it. The guard must read the reply, and must fail closed when there is none.
import '../helpers/ts-resolve.mjs'
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

const guard = await import('../../hooks/guard-core.ts')

describe('the engine reply in a stream', () => {
  test('a JSON object is read even when a warning precedes it and a log line follows it', () => {
    const reply = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'protected' } }
    const out = guard.parseEngineStdout(`warning: profile not found\n${JSON.stringify(reply)}\n[trace] done`)
    assert.equal(out?.deny, true)
    assert.equal(out?.reason, 'protected')
    assert.deepEqual(out?.raw, reply)
  })
  test('braces and escaped quotes inside strings do not end the object early', () => {
    const reply = { additionalContext: 'a } brace and a \\" quote' }
    assert.equal(guard.parseEngineStdout(`${JSON.stringify(reply)}\nlater`)?.additionalContext, reply.additionalContext)
  })
  test('a lead-in object is skipped when it is not the reply shape', () => {
    const out = guard.parseEngineStdout('{"note":"not the reply"}\n{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"no"}}')
    assert.equal(out?.deny, true)
    assert.equal(out?.reason, 'no')
  })
  test('a plain settings-hook result is read like the wrapped one', () => {
    assert.equal(guard.parseEngineStdout('{"continue":true}')?.deny, false)
    const out = guard.parseEngineStdout('{"permissionDecision":"deny","permissionDecisionReason":"no"}')
    assert.equal(out?.deny, true)
    assert.equal(out?.reason, 'no')
  })
  test('no object, or an unclosed object, is null', () => {
    assert.equal(guard.parseEngineStdout('Traceback (most recent call last)'), null)
    assert.equal(guard.parseEngineStdout('{"decision":"block"'), null)
    assert.equal(guard.parseEngineStdout(''), null)
  })
})

describe('did the engine answer', () => {
  test('exit 0 with empty or JSON stdout is an answer; anything else is a failure', () => {
    assert.equal(guard.engineAnswered(0, ''), true)
    assert.equal(guard.engineAnswered(0, '{"decision":"block"}\n'), true)
    assert.equal(guard.engineAnswered(3, '{"decision":"block"}'), false)
    assert.equal(guard.engineAnswered(0, 'Traceback'), false)
  })
})

describe('paper_mcp asks before it writes a server into .mcp.json', () => {
  const tool = `${guard.PLUGIN_PREFIX}paper_mcp`
  test('register and approve ask; status and unregister, and every other tool, do not', () => {
    assert.equal(guard.paperMcpCheck(tool, { action: 'register', serverName: 'p' })?.decision, 'ask')
    assert.equal(guard.paperMcpCheck(tool, { action: 'approve', serverName: 'p' })?.decision, 'ask')
    assert.equal(guard.paperMcpCheck(tool, { action: 'status' }), null)
    assert.equal(guard.paperMcpCheck(tool, { action: 'unregister', serverName: 'p' }), null)
    assert.equal(guard.paperMcpCheck(tool, undefined), null)
    assert.equal(guard.paperMcpCheck(`${guard.PLUGIN_PREFIX}notebook`, { action: 'register' }), null)
    assert.equal(guard.paperMcpCheck('paper_mcp', { action: 'register' }), null, 'only the plugin\'s own tool name is matched')
  })
  test('the reason shows the program, its folder and the variables, and says Claude Code asks again', () => {
    const r = guard.paperMcpCheck(tool, { action: 'register', serverName: 'demo', command: '/venv/bin/python', args: ['/srv/demo_mcp.py'], cwd: '/srv', envNames: ['S2_API_KEY'] }).reason
    assert.match(r, /"demo"/)
    assert.match(r, /\/venv\/bin\/python \/srv\/demo_mcp\.py/)
    assert.match(r, /in \/srv/)
    assert.match(r, /S2_API_KEY/)
    assert.match(r, /Claude Code will ask again/)
    assert.match(guard.paperMcpReason({ action: 'register', serverName: 'x', command: 'c', args: ['a'] }), /given no secret variables/)
    assert.match(guard.paperMcpReason({ action: 'approve', serverName: 'x' }), /already in this project's \.dsh\/paper-mcps\.json/)
  })
  test('a long or odd input cannot make the reason huge', () => {
    const r = guard.paperMcpReason({ action: 'register', serverName: 'n'.repeat(500), command: 'c'.repeat(5000), args: ['a'.repeat(5000)], cwd: 'd'.repeat(5000), envNames: Array.from({ length: 500 }, (_, i) => `V${i}`) })
    assert.ok(r.length < 1400, String(r.length))
    assert.doesNotThrow(() => guard.paperMcpReason(null))
  })
})
