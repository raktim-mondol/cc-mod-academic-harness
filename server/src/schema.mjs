// The input schema Claude Code gets for a tool.
//
// Tools built with the package's `defineTool` already carry JSON Schema in `parameters` (the
// package compiles the parameter DSL itself), so for them this is a copy. The DSL branch exists
// for a definition registered as a plain object (`{ key: { type, required, description } }`), the
// shape upstream's own scripts/claude-plugin-check/skill-mcp.mjs converts.

const isJsonSchemaRoot = p => p && typeof p === 'object' && p.type === 'object' && p.properties && typeof p.properties === 'object' && !Array.isArray(p.properties)

function fromSpec(spec) {
  if (spec == null || typeof spec !== 'object') return {}
  const { required, ...rest } = spec
  const out = { ...rest }
  if (rest.properties && typeof rest.properties === 'object') {
    const props = {}
    const req = []
    for (const [k, v] of Object.entries(rest.properties)) {
      props[k] = fromSpec(v)
      if (v && v.required === true) req.push(k)
    }
    out.properties = props
    if (req.length) out.required = [...new Set([...(Array.isArray(rest.required) ? rest.required : []), ...req])]
  }
  if (rest.items) out.items = fromSpec(rest.items)
  if (Array.isArray(rest.oneOf)) out.oneOf = rest.oneOf.map(fromSpec)
  return out
}

export function toInputSchema(tool) {
  const p = tool.parameters ?? {}
  if (isJsonSchemaRoot(p) || (p.type === 'object' && !p.properties)) return structuredClone(p.properties ? p : { ...p, properties: {} })
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(p)) {
    properties[key] = fromSpec(spec)
    if (spec && spec.required === true) required.push(key)
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}
