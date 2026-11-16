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
