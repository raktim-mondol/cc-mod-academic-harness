// Mounted MCP servers: the `ctx.plugin(McpClient, { transport: 'stdio', ... })` that upstream's paper_mcp calls.
//
// On DSH, mounting a stdio MCP server puts its tools on `ctx.tools` as `mcp__<serverName>__<tool>`. The same here: this file
// spawns the server, speaks the small part of MCP a tool server needs (initialize, tools/list, tools/call, cancellation,
// tools/list_changed) and registers each of its tools in the host's registry. The host then tells Claude Code its tool list
// changed. A tool of a mounted server shows up as `mcp__plugin_academic-harness_ah__mcp__<serverName>__<tool>`.
import { spawn } from 'node:child_process'

export const PROTOCOL_VERSION = '2025-06-18'
const REQUEST_TIMEOUT_MS = 30_000

/** A minimal JSON-RPC-over-stdio MCP client to one child process. */
export function connectStdio({ command, args = [], cwd, env, spawnFn = spawn, onToolsChanged = () => {}, log = () => {} }) {
  const child = spawnFn(command, args, { cwd, env: { ...process.env, ...(env ?? {}) }, stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = ''
  let nextId = 0
  let closed = false
  let stderrTail = ''
  const waiting = new Map()
  const closeAll = reason => {
    closed = true
    for (const [, w] of waiting) w.reject(new Error(reason))
    waiting.clear()
  }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk
    let i
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim()
      buffer = buffer.slice(i + 1)
      if (!line) continue
      let m
      try { m = JSON.parse(line) } catch { continue }
      if (m.id !== undefined && (m.result !== undefined || m.error !== undefined) && waiting.has(m.id)) {
        const w = waiting.get(m.id)
        waiting.delete(m.id)
        m.error ? w.reject(new Error(m.error.message ?? 'request failed')) : w.resolve(m.result)
      } else if (m.method === 'notifications/tools/list_changed') onToolsChanged()
      else if (m.method && m.id !== undefined) write({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } })
    }
  })
  child.stderr.on('data', d => { stderrTail = (stderrTail + d).slice(-400) })
  child.on('error', error => { log(`mounted server could not start: ${error.message}`); closeAll(error.message) })
  child.on('close', code => closeAll(`the server exited (${code})${stderrTail ? `: ${stderrTail.trim().slice(-160)}` : ''}`))
  child.stdin.on('error', () => {})

  function write(message) {
    if (!closed) child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  function request(method, params, { signal, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      if (closed) return reject(new Error('the server is not running'))
      const id = ++nextId
      const timer = setTimeout(() => { done(); write({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'timeout' } }); reject(new Error(`${method} timed out after ${Math.round(timeoutMs / 1000)} s`)) }, timeoutMs)
      const onAbort = () => { done(); write({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'cancelled' } }); reject(new Error(`${method} was cancelled`)) }
      const done = () => { clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); waiting.delete(id) }
      waiting.set(id, { resolve: v => { done(); resolve(v) }, reject: e => { done(); reject(e) } })
      if (signal?.aborted) return onAbort()
      signal?.addEventListener?.('abort', onAbort, { once: true })
      write({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })
    })
  }

  return {
    pid: child.pid,
    async initialize() {
      await request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'academic-harness-host', version: '1' } }, { timeoutMs: 60_000 })
      write({ jsonrpc: '2.0', method: 'notifications/initialized' })
    },
    async listTools() {
      const out = []
      let cursor
      do {
        const r = await request('tools/list', cursor ? { cursor } : undefined)
        out.push(...(r.tools ?? []))
        cursor = r.nextCursor
      } while (cursor)
      return out
    },
    callTool: (name, args, opts) => request('tools/call', { name, arguments: args ?? {} }, { timeoutMs: 300_000, ...opts }),
    isClosed: () => closed,
    close() {
      if (closed) return
      closed = true
      try { child.stdin.end() } catch { /* gone */ }
      try { child.kill('SIGTERM') } catch { /* gone */ }
      setTimeout(() => { try { child.kill('SIGKILL') } catch { /* gone */ } }, 2000).unref?.()
    },
  }
}

const text = r => (r?.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n')

/**
 * Mount one server: its tools are registered as `mcp__<serverName>__<tool>`. Resolves to { serverName, tools } once they are
 * listed; rejects if the server cannot start or answer.
 */
export async function mountServer(registry, spec, { onChange = () => {}, log = () => {}, spawnFn } = {}) {
  const { serverName, command, args, cwd, env, toolCallTimeoutMs } = spec
  const names = new Set()
  const client = connectStdio({ command, args, cwd, env, spawnFn, log, onToolsChanged: () => { sync().catch(error => log(`${serverName}: tool re-sync failed: ${error.message}`)) } })
  const disposers = []

  async function sync() {
    const listed = await client.listTools()
    for (const d of disposers.splice(0)) d()
    names.clear()
    for (const tool of listed) {
      const name = `mcp__${serverName}__${tool.name}`
      names.add(name)
      disposers.push(registry.register({
        name,
        description: tool.description ?? `${tool.name} (from the ${serverName} MCP server)`,
        parameters: tool.inputSchema?.type === 'object' ? tool.inputSchema : { type: 'object', properties: {} },
        timeoutMs: toolCallTimeoutMs,
        output: { render: (_args, value) => value },
        async execute(callArgs, exec) {
          const r = await client.callTool(tool.name, callArgs, { signal: exec?.signal, ...(Number.isFinite(toolCallTimeoutMs) ? { timeoutMs: toolCallTimeoutMs } : {}) })
          if (r?.isError) throw new Error(text(r) || `${tool.name} failed`)
          return (r?.content ?? []).map(c => (c.type === 'text' ? { type: 'text', text: c.text } : c.type === 'image' ? { type: 'image', data: c.data, mimeType: c.mimeType } : { type: 'text', text: JSON.stringify(c) }))
        },
      }))
    }
    onChange()
    return listed.length
  }

  try {
    await client.initialize()
    const count = await sync()
    return { serverName, tools: count, close: () => { for (const d of disposers.splice(0)) d(); client.close(); onChange() }, client }
  } catch (error) {
    client.close()
    throw error
  }
}
