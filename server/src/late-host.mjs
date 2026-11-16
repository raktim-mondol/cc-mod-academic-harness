// A host that can be replaced while the server is running: the first-start fetch (bootstrap.mjs) takes a minute, and the server must answer
// `initialize` at once. It starts as a host that has only the `doctor` tool and, when the snapshot is ready, swaps in the full host and
// tells the client the tool list changed. What the client already told the server (the session folder, that the session has started) is
// handed to the new host.
export function lateHost(first) {
  let current = first
  let cwd = null
  let started = false
  let onChange = null
  // serve() sets `host.registry.onChange` once; it is kept here and put on whichever registry is current.
  const registry = {
    get onChange() { return onChange },
    set onChange(fn) { onChange = fn; if (current.registry) current.registry.onChange = fn },
  }
  return {
    registry,
    get loaded() { return current.loaded },
    get failed() { return current.failed },
    list: () => current.list(),
    call: (...args) => current.call(...args),
    setCwd(dir) { cwd = dir; current.setCwd?.(dir) },
    start() { started = true; return current.start?.() },
    dispose: () => current.dispose(),
    /** Put `next` in place of the host now answering. The old one is disposed; the client is told the list changed. */
    swap(next) {
      const old = current
      current = next
      if (cwd) next.setCwd?.(cwd)
      if (onChange && next.registry) next.registry.onChange = onChange
      if (started) next.start?.()
      Promise.resolve(old.dispose?.()).catch(() => {})
      try { onChange?.() } catch { /* a listener must not break the swap */ }
    },
  }
}
