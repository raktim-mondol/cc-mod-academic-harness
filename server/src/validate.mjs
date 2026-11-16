// A small check of a tool call's arguments against the tool's input schema (schema.mjs), at the server boundary.
//
// Why: the server answers calls from the model, from the hooks module and from any direct MCP client. A malformed call otherwise reaches the
// tool and fails deep inside it, or is quietly coerced; a long tool would even start as a job first.
//
// What it understands is what the served tools use (type, required, properties, items, enum, oneOf); every other keyword is ignored, so a schema
// that grows a keyword never makes a call fail for it. It has no dependency on purpose.
//
// What it never does: put an argument VALUE in a message (a value can be a manuscript passage or a key). Messages name the field path, which comes
// from the schema, and what the field should be. A property the schema does not declare is neither checked nor named.

/** How the modes are written in AH_VALIDATE_TOOL_ARGS. An unknown or empty value is the default, `enforce`. (`warn` was the default while the usage counts showed whether a valid call would be refused; none was.) */
export const MODES = ['off', 'warn', 'enforce']
export const DEFAULT_MODE = 'enforce'
export function validationMode(raw) {
  const mode = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return MODES.includes(mode) ? mode : DEFAULT_MODE
}

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

const TYPE_CHECKS = {
  string: v => typeof v === 'string',
  number: v => typeof v === 'number' && Number.isFinite(v),
  integer: v => Number.isInteger(v),
  boolean: v => typeof v === 'boolean',
  object: isPlainObject,
  array: Array.isArray,
  null: v => v === null,
}
const ARTICLE = { string: 'a string', number: 'a number', integer: 'an integer', boolean: 'a boolean', object: 'an object', array: 'an array', null: 'null' }

const join = (path, key) => (path ? `${path}.${key}` : key)
const label = path => (path ? `"${path}"` : 'the arguments')
const sameValue = (a, b) => a === b || (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b))

function walk(schema, value, path, issues) {
  if (!isPlainObject(schema)) return
  const types = (Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []).filter(t => t in TYPE_CHECKS)
  if (types.length && !types.some(t => TYPE_CHECKS[t](value))) {
    issues.push({ path, expected: types.join('|'), message: `${label(path)} must be ${types.map(t => ARTICLE[t]).join(' or ')}` })
    return
  }
  // oneOf is permissive: one branch has to accept the value; if several do, that is fine.
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
    const fits = schema.oneOf.some(branch => { const sub = []; walk(branch, value, path, sub); return sub.length === 0 })
    if (!fits) issues.push({ path, expected: 'oneOf', message: `${label(path)} does not match any of the allowed shapes` })
  }
  if (Array.isArray(schema.enum) && schema.enum.length && !schema.enum.some(e => sameValue(e, value))) {
    const shown = schema.enum.slice(0, 6).map(e => String(e)).join(', ')
    issues.push({ path, expected: 'enum', message: `${label(path)} must be one of: ${shown}${schema.enum.length > 6 ? ', ...' : ''}` })
    return
  }
  if (isPlainObject(value)) {
    const props = isPlainObject(schema.properties) ? schema.properties : {}
    if (Array.isArray(schema.required)) {
      for (const name of schema.required) {
        if (typeof name === 'string' && (value[name] === undefined || value[name] === null)) issues.push({ path: join(path, name), expected: 'present', message: `${label(join(path, name))} is required` })
      }
    }
    for (const [name, sub] of Object.entries(props)) {
      // null on a property means "not given": models send it for a parameter they leave out. A required one was reported above.
      if (value[name] === undefined || value[name] === null) continue
      walk(sub, value[name], join(path, name), issues)
    }
  } else if (Array.isArray(value) && isPlainObject(schema.items)) {
    value.forEach((item, i) => walk(schema.items, item, `${path}[${i}]`, issues))
  }
}

/** `{ ok: true }` or `{ ok: false, issues: [{ path, expected, message }] }`. Never throws, whatever the schema or the arguments are. */
export function validateArgs(schema, args) {
  try {
    if (!isPlainObject(args)) return { ok: false, issues: [{ path: '', expected: 'object', message: 'the arguments must be an object' }] }
    const issues = []
    walk(schema, args, '', issues)
    return issues.length ? { ok: false, issues } : { ok: true }
  } catch {
    return { ok: true }
  }
}

/** The text of a refusal: at most three issues, then how many more. */
export function describeIssues(name, issues, max = 3) {
  const shown = issues.slice(0, max).map(i => i.message)
  const more = issues.length > max ? `; and ${issues.length - max} more` : ''
  return `Invalid arguments for ${name}: ${shown.join('; ')}${more}.`
}

/** The field paths only, for the one stderr line in warn mode. */
export function issuePaths(issues, max = 5) {
  const paths = issues.slice(0, max).map(i => i.path || '(arguments)')
  return paths.join(', ') + (issues.length > max ? `, and ${issues.length - max} more` : '')
}
