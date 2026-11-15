#!/usr/bin/env node
// P0 probe MCP server: newline-delimited JSON-RPC over stdio. Answers S2, S3 and S4.
// It never prints a secret: it reports only whether one arrived, its length and a
// short hash.
import { appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline'

const out = process.env.AH_PROBE_OUT
const note = (kind, data) => {
  if (!out) return
  appendFileSync(out, JSON.stringify({ at: new Date().toISOString(), src: 'server', kind, data }) + '\n')
}
const send = m => process.stdout.write(JSON.stringify(m) + '\n')
const desc = v => (v === undefined ? { set: false } : { set: true, length: v.length, sha256_8: createHash('sha256').update(v).digest('hex').slice(0, 8), looksUnsubstituted: v.includes('${') })

let clientCaps = {}
let rootsId = null

function envReport() {
  return {
    cwd: process.cwd(),
    pid: process.pid,
    CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID ?? null,
    claudeVars: Object.keys(process.env).filter(k => k.startsWith('CLAUDE')).sort(),
    PROBE_ROOT_SEEN: process.env.PROBE_ROOT_SEEN ?? null,
    PROBE_DATA_SEEN: process.env.PROBE_DATA_SEEN ?? null,
    PROBE_SECRET: desc(process.env.PROBE_SECRET),
    PROBE_PLAIN: desc(process.env.PROBE_PLAIN),
    argv1: process.argv[1],
  }
}

const tools = [
  { name: 'probe_noop', description: 'Probe tool that does nothing. Returns "noop".', inputSchema: { type: 'object', properties: {} } },
  { name: 'probe_env', description: 'Probe tool: report this server process environment (no secrets).', inputSchema: { type: 'object', properties: {} } },
]

createInterface({ input: process.stdin }).on('line', line => {
  let m
  try { m = JSON.parse(line) } catch { return }
  if (m.method === 'initialize') {
    clientCaps = m.params?.capabilities ?? {}
    note('initialize', { clientInfo: m.params?.clientInfo, protocolVersion: m.params?.protocolVersion, capabilities: clientCaps, env: envReport() })
    send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'probe', version: '0.0.1' } } })
  } else if (m.method === 'notifications/initialized') {
    // S3: does the client answer roots/list? Ask whether or not it advertised roots.
    rootsId = 9001
    note('roots.advertised', clientCaps.roots ?? null)
    send({ jsonrpc: '2.0', id: rootsId, method: 'roots/list' })
  } else if (m.id === rootsId && (m.result || m.error)) {
    note('roots.answer', m.result ?? m.error)
  } else if (m.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: m.id, result: { tools } })
  } else if (m.method === 'tools/call') {
    const name = m.params?.name
    note('tools.call', { name, meta: m.params?._meta ?? null, env: envReport() })
    const text = name === 'probe_env' ? JSON.stringify(envReport()) : 'noop'
    send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text }] } })
  } else if (m.id !== undefined && m.method) {
    send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not found' } })
  }
})
process.stdin.on('end', () => { note('stdin.end', null); process.exit(0) })
