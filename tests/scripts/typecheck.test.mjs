// scripts/typecheck.mjs: the advice for the one type-check failure that is the generated typings' and not the code's.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hint, TOO_BIG_BYTES } from '../../scripts/typecheck.mjs'

const deep = "hooks/guard.ts(83,3): error TS2589: Type instantiation is excessively deep and possibly infinite.\nhooks/guard.ts(91,44): error TS2339: Property 'tool' does not exist"

test('a TS2589 with MCP typings of megabytes gets the advice, naming the file and its size', () => {
  const text = hint(deep, 1_865_773)
  assert.match(text, /not from the code/)
  assert.match(text, /claude-code-mcp\/index\.d\.ts is 1\.9 MB/)
  assert.match(text, /ENABLE_CLAUDEAI_MCP_SERVERS=false claude --plugin-dir/)
})
test('any other failure, or small typings, gets no advice: the code is then at fault', () => {
  assert.equal(hint(deep, 412), null, 'small typings: a real error')
  assert.equal(hint(deep, TOO_BIG_BYTES), null, 'at the limit, not over it')
  assert.equal(hint("hooks/rsi.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.", 2_000_000), null, 'another error with big typings')
  assert.equal(hint('', 2_000_000), null)
  assert.equal(hint(undefined, 2_000_000), null)
})
