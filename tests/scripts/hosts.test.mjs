// The network hosts the plugin declares (server/src/hosts.mjs, written into plugin.json as `network.hosts`) against the hosts its runtime code writes.
// The declaration is the author's word and blocks nothing, so the only thing that keeps it true is this test.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as hosts from '../../server/src/hosts.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const HAVE_CORE = existsSync(join(root, 'core', 'vendor', 'papermemory', 'papermemory'))

/** The runtime code: what the tool server, the hooks, PaperMemory, the writing engine and the deep-review runner run. Not tests, docs, skills or scripts. */
const ROOTS = ['core/science-sources', 'core/client', 'server/src', 'server/bin', 'hooks', 'core/vendor/papermemory/papermemory', 'core/vendor/academic-harness/ah', 'core/vendor/open-deepreview/src', 'core/vendor/open-deepreview/runner.mjs', 'core/vendor/open-deepreview/register.mjs']
const SKIP = new Set(['node_modules', 'tests', '__pycache__', 'generated', 'build'])

function sources() {
  const files = []
  const walk = path => {
    if (!existsSync(path)) return
    if (statSync(path).isDirectory()) { for (const name of readdirSync(path)) if (!SKIP.has(name)) walk(join(path, name)) } else if (/\.(js|mjs|ts|tsx|py)$/.test(path)) files.push(path)
  }
  for (const r of ROOTS) walk(join(root, r))
  for (const name of readdirSync(join(root, 'core'))) if (name.endsWith('.js')) files.push(join(root, 'core', name))
  return files
}

/** Every host written as a URL in the runtime code, with the files that write it. */
function written() {
  const found = new Map()
  for (const file of sources()) {
    for (const m of readFileSync(file, 'utf8').matchAll(/https?:\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g)) {
      const h = m[1].toLowerCase()
      if (!found.has(h)) found.set(h, new Set())
      found.get(h).add(file.slice(root.length + 1))
    }
  }
  return found
}

describe('the declared network hosts', { skip: !HAVE_CORE }, () => {
  const found = written()
  const declared = new Set(hosts.NETWORK_HOSTS)
  const notReached = new Set(Object.keys(hosts.NOT_REACHED))

  test('every host the runtime code writes is declared, or listed as never contacted with a reason', () => {
    const undeclared = [...found.keys()].filter(h => !declared.has(h) && !notReached.has(h) && !/^(127\.|localhost)/.test(h)).sort()
    assert.deepEqual(undeclared, [], 'a host the code writes that plugin.json does not declare: add it to a group in server/src/hosts.mjs (it is reached), or to NOT_REACHED with the reason (a link, a namespace, a comment), then run node scripts/build-manifest.mjs')
  })
  test('every declared host is still written in the runtime code, apart from the installer\'s', () => {
    const stale = hosts.NETWORK_HOSTS.filter(h => !found.has(h) && !hosts.INSTALL.includes(h)).sort()
    assert.deepEqual(stale, [], 'a declared host no code names any more: remove it from server/src/hosts.mjs')
  })
  test('no host is both declared and not reached, and every reason is a sentence', () => {
    assert.deepEqual(hosts.NETWORK_HOSTS.filter(h => notReached.has(h)), [])
    for (const [h, why] of Object.entries(hosts.NOT_REACHED)) assert.ok(typeof why === 'string' && why.length > 10, h)
    for (const h of notReached) assert.ok(found.has(h) || h === '127.0.0.1', `${h} is listed as not reached but no code writes it`)
  })
  test('the declared list is sorted, lower case, plain host names, and plugin.json says the same', () => {
    assert.deepEqual([...hosts.NETWORK_HOSTS], [...hosts.NETWORK_HOSTS].sort())
    for (const h of hosts.NETWORK_HOSTS) assert.match(h, /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/, h)
    const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'))
    assert.deepEqual(manifest.network?.hosts, hosts.NETWORK_HOSTS)
  })
  test('the hosts of the providers that need a key are declared', () => {
    for (const h of ['api.search.brave.com', 'api.tavily.com', 'api.exa.ai', 'api.perplexity.ai', 'api.parallel.ai', 'api.consensus.app', 'elicit.com', 'api.firecrawl.dev', 'r.jina.ai']) assert.ok(declared.has(h), h)
  })
})
