// A stand-in stdio MCP server for the mount tests and the live paper_mcp scenario: echo, boom, slow and grow tools.
import { appendFileSync } from 'node:fs'
let buf = ''
let grown = false
const log = process.env.FAKE_LOG
const send = m => process.stdout.write(JSON.stringify(m) + '\n')
const tools = () => [
  { name: 'echo', description: 'echoes', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'boom', description: 'fails', inputSchema: { type: 'object', properties: {} } },
  { name: 'slow', description: 'waits', inputSchema: { type: 'object', properties: {} } },
  { name: 'grow', description: 'adds a tool', inputSchema: { type: 'object', properties: {} } },
  ...(grown ? [{ name: 'extra', description: 'new', inputSchema: { type: 'object', properties: {} } }] : []),
]
process.stdin.setEncoding('utf8')
process.stdin.on('data', d => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
    if (log) appendFileSync(log, JSON.stringify({ method: m.method, params: m.params }) + '\n')
    if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'fake', version: '1' } } })
    else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: tools() } })
    else if (m.method === 'tools/call') {
      const { name, arguments: a } = m.params
      if (name === 'echo') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'echo:' + a.text + ':' + (process.env.FAKE_SECRET ?? 'nosecret') }] } })
      else if (name === 'boom') send({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: 'it broke' }] } })
      else if (name === 'grow') { grown = true; send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'grown' }] } }); send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }) }
      // 'slow' never answers
    }
  }
})
