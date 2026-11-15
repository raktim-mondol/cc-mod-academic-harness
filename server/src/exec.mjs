// The per-call context upstream tools read as their second argument.
//
// What the tier-1 tools use (grepped, not guessed): exec.signal, exec.callId, and
// exec.agent.session.header.{id,cwd,parentSession}. S3 of docs/PLATFORM-NOTES.md says where each
// comes from: the server's cwd is the session directory, CLAUDE_CODE_SESSION_ID is the session id,
// and the call's _meta["claudecode/toolUseId"] is the call id.
import { randomUUID } from 'node:crypto'

export function sessionIdFrom(env = process.env) {
  const id = env.CLAUDE_CODE_SESSION_ID?.trim()
  return id || undefined
}

export function makeExec({ name, args, callId, signal, cwd, sessionId, route }) {
  const header = { cwd, ...(sessionId ? { id: sessionId } : {}) }
  return {
    name,
    arguments: args,
    callId: callId || `call-${randomUUID()}`,
    signal,
    agent: {
      // Only the fields the modules read. `ctx.get` answers undefined for every service, as the
      // documented optional-service pattern allows (notebook.js sessionKey).
      id: sessionId,
      // `options` is where deep_research and deep_review look for the model route (provider and model).
      options: route ? { provider: route.provider, model: route.model } : {},
      session: { header, id: sessionId },
      ctx: { get: () => undefined },
    },
  }
}
