// The `ctx` given to each upstream module's apply().
//
// In DSH `ctx` is a Cordis context with dozens of services. A module in the tool host needs a tiny
// part of it: `ctx.tools.register`. Anything else a module reaches for is a service this host does
// not provide, and that has to be loud: a tool that needs a model route or a jobs service must say
// so by name, not silently do nothing (plan P2 step 2).
//
// `ctx.get(name)` is the documented optional-service lookup, so it answers undefined.

export class UnportedServiceError extends Error {
  constructor(service, detail = '') {
    super(`The Claude Code tool host does not provide the "${service}" service${detail ? ` (${detail})` : ''}. A tool that needs it is not available here yet.`)
    this.name = 'UnportedServiceError'
    this.service = service
  }
}

export class Registry {
  tools = new Map()
  subscriptions = []
  disposers = []

  /** Called when a tool is added or removed after start (a mounted server's tools): the host tells the client the list changed. */
  onChange = null

  register(definition) {
    if (!definition || typeof definition.name !== 'string' || typeof definition.execute !== 'function') {
      throw new TypeError('tools.register: expected a tool definition with a name and an execute function')
    }
    if (this.tools.has(definition.name)) throw new Error(`tool "${definition.name}" is registered twice`)
    this.tools.set(definition.name, definition)
    return () => { if (this.tools.get(definition.name) === definition) { this.tools.delete(definition.name); try { this.onChange?.() } catch { /* a listener must not break a removal */ } } }
  }

  async dispose() {
    for (const d of this.disposers.splice(0).reverse()) { try { await d() } catch { /* shutting down */ } }
  }
}

/** `onModule` names the module being applied, for the error text. */
export function createContext(registry, { log = () => {}, module = '', services = {} } = {}) {
  const tools = {
    register: def => registry.register(def),
    get: name => registry.tools.get(name),
    resolve: name => registry.tools.get(name),
    list: () => [...registry.tools.values()],
    async execute(name, args, exec) {
      const t = registry.tools.get(name)
      if (!t) throw new Error(`unknown tool ${name}`)
      return t.execute(args, exec)
    },
  }
  const own = {
    tools,
    // Optional services (`approval`, ...), when the host built them; undefined otherwise, as upstream's own lookups expect.
    get: name => services.optional?.[name],
    // `ctx.plugin(McpClient, { transport: 'stdio', ... })` is how paper_mcp mounts a generated server (mounts.mjs). Any other plugin is not ported.
    plugin(factory, options) {
      if (options?.transport === 'stdio' && typeof services.mount === 'function') {
        Promise.resolve(services.mount(options)).catch(error => log(`mount of ${options.serverName} failed: ${error.message}`))
        return undefined
      }
      throw new UnportedServiceError('plugin', `${module || 'a module'} mounts something other than a stdio MCP server`)
    },
    // Subscriptions are recorded, never fired: the events (session/created, agent/disposed) are DSH's.
    on(event, handler) {
      registry.subscriptions.push({ module, event, handler })
      return () => {}
    },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') registry.disposers.push(dispose)
      return () => {}
    },
    // Real services, when the host built them: `jobs` (jobs.mjs) and `llm` (llm.mjs).
    ...(services.jobs ? { jobs: services.jobs } : {}),
    ...(services.llm ? { llm: services.llm } : {}),
    logger: {
      debug: () => {},
      info: m => log(String(m)),
      warn: m => log(String(m)),
      error: m => log(String(m)),
    },
  }
  return new Proxy(own, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (typeof prop === 'symbol' || prop === 'then' || prop === 'toJSON') return undefined
      throw new UnportedServiceError(prop, module && `needed by ${module}`)
    },
    has: (target, prop) => prop in target,
  })
}
