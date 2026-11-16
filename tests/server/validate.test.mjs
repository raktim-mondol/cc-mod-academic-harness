// The argument check at the server boundary (server/src/validate.mjs). No upstream needed except the last block, which reads the served surface.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { recordUpstream } from '../../scripts/measure-surface.mjs'
import { upstreamDir } from '../../server/src/paths.mjs'
import { toInputSchema } from '../../server/src/schema.mjs'
import { describeIssues, issuePaths, validateArgs, validationMode } from '../../server/src/validate.mjs'

const schema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    max_results: { type: 'number' },
    count: { type: 'integer' },
    flag: { type: 'boolean' },
    mode: { type: 'string', enum: ['fast', 'deep'] },
    tags: { type: 'array', items: { type: 'string' } },
    plan: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
    either: { oneOf: [{ type: 'string' }, { type: 'number' }] },
  },
  required: ['query'],
}
const bad = (args, s = schema) => { const r = validateArgs(s, args); assert.equal(r.ok, false, JSON.stringify(args)); return r.issues }

describe('validateArgs', () => {
  test('a good call passes, with and without the optional fields', () => {
    assert.deepEqual(validateArgs(schema, { query: 'q' }), { ok: true })
    assert.deepEqual(validateArgs(schema, { query: 'q', max_results: 3, count: 2, flag: false, mode: 'deep', tags: ['a'], plan: { question: 'x' }, either: 4 }), { ok: true })
  })
  test('a required field that is missing, undefined or null is reported', () => {
    for (const args of [{}, { query: undefined }, { query: null }]) assert.deepEqual(bad(args).map(i => i.path), ['query'])
  })
  test('null on an optional field means "not given"', () => {
    assert.deepEqual(validateArgs(schema, { query: 'q', max_results: null, tags: null, plan: null }), { ok: true })
  })
  test('types are enforced, and an integer is not just any number', () => {
    assert.deepEqual(bad({ query: 1 }).map(i => i.path), ['query'])
    assert.deepEqual(bad({ query: 'q', max_results: '3' }).map(i => i.path), ['max_results'])
    assert.deepEqual(bad({ query: 'q', max_results: NaN }).map(i => i.path), ['max_results'])
    assert.deepEqual(validateArgs(schema, { query: 'q', max_results: 2.5 }), { ok: true })
    assert.deepEqual(bad({ query: 'q', count: 2.5 }).map(i => i.path), ['count'])
    assert.deepEqual(bad({ query: 'q', flag: 'yes' }).map(i => i.path), ['flag'])
    assert.deepEqual(bad({ query: 'q', tags: 'a' }).map(i => i.path), ['tags'])
    assert.deepEqual(bad({ query: 'q', plan: [] }).map(i => i.path), ['plan'])
  })
  test('an enum is a membership test', () => {
    assert.deepEqual(bad({ query: 'q', mode: 'slow' }).map(i => i.path), ['mode'])
    assert.match(bad({ query: 'q', mode: 'slow' })[0].message, /one of: fast, deep/)
  })
  test('every array element is checked, and the path names the index', () => {
    assert.deepEqual(bad({ query: 'q', tags: ['a', 2, 'c', 4] }).map(i => i.path), ['tags[1]', 'tags[3]'])
  })
  test('a nested path is dotted, and a nested required field is required', () => {
    assert.deepEqual(bad({ query: 'q', plan: {} }).map(i => i.path), ['plan.question'])
    assert.deepEqual(bad({ query: 'q', plan: { question: 5 } }).map(i => i.path), ['plan.question'])
  })
  test('oneOf wants one branch to fit; two fitting is fine', () => {
    assert.deepEqual(bad({ query: 'q', either: true }).map(i => i.expected), ['oneOf'])
    const both = { type: 'object', properties: { v: { oneOf: [{ type: 'number' }, { type: 'integer' }] } } }
    assert.deepEqual(validateArgs(both, { v: 3 }), { ok: true })
    assert.deepEqual(validateArgs(both, { v: 3.5 }), { ok: true })
    assert.equal(validateArgs(both, { v: 'x' }).ok, false)
  })
  test('properties the schema does not declare, and keywords it does not know, never fail a call', () => {
    assert.deepEqual(validateArgs({ ...schema, additionalProperties: false, format: 'x' }, { query: 'q', extra: 1 }), { ok: true })
  })
  test('the arguments must be an object', () => {
    for (const args of [null, [], 'text', 5, undefined]) assert.deepEqual(bad(args).map(i => i.path), [''])
  })
  test('a schema it cannot read passes the call rather than throwing', () => {
    for (const s of [undefined, null, 'x', 5, { type: 'nonsense' }, { properties: 5, required: 'q' }]) assert.deepEqual(validateArgs(s, { a: 1 }), { ok: true })
  })
  test('no argument value is ever in a message', () => {
    const secret = 'SECRET-MANUSCRIPT-PASSAGE'
    const issues = bad({ query: 1, max_results: secret, mode: secret, tags: [secret, 3], plan: secret, either: { k: secret }, [secret]: secret })
    const all = JSON.stringify(issues) + describeIssues('t', issues) + issuePaths(issues)
    assert.ok(!all.includes(secret), all)
  })
})

describe('the messages', () => {
  test('at most three issues are listed, then how many more', () => {
    const issues = bad({ query: 1, max_results: 'x', count: 'x', flag: 1, mode: 'z' })
    const text = describeIssues('literature_search', issues)
    assert.match(text, /^Invalid arguments for literature_search: "query" must be a string; /)
    assert.match(text, /; and 2 more\.$/)
  })
  test('the warn line carries paths only', () => {
    assert.equal(issuePaths(bad({ query: 1, plan: {} })), 'query, plan.question')
    assert.equal(issuePaths(bad(null)), '(arguments)')
  })
})

describe('the setting', () => {
  test('enforce is the default, and an unknown value is the default', () => {
    for (const v of [undefined, '', '  ', 'maybe', 'ON', 5]) assert.equal(validationMode(v), 'enforce')
    assert.equal(validationMode('enforce'), 'enforce')
    assert.equal(validationMode(' Off '), 'off')
    assert.equal(validationMode('warn'), 'warn')
  })
})

describe('the served surface', { skip: !existsSync(join(upstreamDir(), 'node_modules', 'ah-dsh-tools')) }, () => {
  const tools = recordUpstream().perEntry.flatMap(e => e.tools)
  test('there are tools to look at', () => assert.ok(tools.length >= 100))
  test('every schema can be checked without throwing, and a call with no arguments fails only on what it requires', () => {
    for (const t of tools) {
      const input = toInputSchema(t)
      const r = validateArgs(input, {})
      const required = Array.isArray(input.required) ? input.required : []
      if (required.length === 0) assert.equal(r.ok, true, `${t.name}: nothing is required, yet {} fails`)
      else assert.deepEqual(r.issues.map(i => i.path).sort(), [...required].sort(), t.name)
    }
  })
  test('every required name is a declared property, at every level', () => {
    const check = (schema, where) => {
      if (!schema || typeof schema !== 'object') return
      if (Array.isArray(schema.required)) for (const n of schema.required) assert.ok(schema.properties && n in schema.properties, `${where}: "${n}" is required but not declared`)
      for (const [k, v] of Object.entries(schema.properties ?? {})) check(v, `${where}.${k}`)
      if (schema.items) check(schema.items, `${where}[]`)
      for (const b of schema.oneOf ?? []) check(b, `${where}|`)
    }
    for (const t of tools) check(toInputSchema(t), t.name)
  })
})
