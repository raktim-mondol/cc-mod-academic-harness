#!/usr/bin/env node
// Surface parity: the tools the host serves against the tools upstream registers.
//
//   node scripts/measure-surface.mjs           print the report, exit 1 on a mismatch
//   node scripts/measure-surface.mjs --json    the same as JSON
//
// Three questions, answered from the snapshot in upstream/ (never the source checkout):
//   1. Do all the modules the manifest discovers (index.js components and the preset rows) register the same
//      tool names as upstream's own collectToolDefinitions() (scripts/measure-tool-surface.mjs)?  Catches a
//      module the manifest does not know about.
//   2. For each tool the host serves: same name, description and parameters as upstream registers?
//   3. Every upstream tool the host does not serve belongs to a module that is classified host-only or later.
//
// The recording runs in a child process so the scratch DSH_HOME and the installer switches never touch this one.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHost } from '../server/src/host.mjs'
import { adapt } from '../server/src/render.mjs'
import { discover, classify } from '../server/src/manifest.mjs'
import { upstreamDir } from '../server/src/paths.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const CHILD = `
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const [upstream, entriesJson] = process.argv.slice(1)
const entries = JSON.parse(entriesJson)
const permissive = () => {
  const callable = new Proxy(function noop() {}, { get: (_t, p) => (p === 'then' ? undefined : callable), apply: () => callable })
  return callable
}
const perEntry = []
for (const e of entries) {
  const sink = []
  const callable = permissive()
  const ctx = new Proxy({}, { get: (_t, p) => (p === 'tools' ? { register: d => { sink.push(d); return () => {} } } : callable) })
  let error
  try {
    const mod = await import(pathToFileURL(join(upstream, e.file)).href)
    const fn = mod[e.fn] ?? mod.default?.[e.fn]
    if (typeof fn === 'function') await fn(ctx, {})
  } catch (err) { error = String(err.message).split('\\n')[0] }
  perEntry.push({ file: e.file, fn: e.fn, error, tools: sink.map(d => ({ name: d.name, description: d.description ?? '', parameters: d.parameters ?? {} })) })
}
const { collectToolDefinitions } = await import(pathToFileURL(join(upstream, 'scripts', 'measure-tool-surface.mjs')).href)
const { found, skipped } = await collectToolDefinitions()
process.stdout.write('\\n@@RESULT@@' + JSON.stringify({ perEntry, upstreamNames: found.map(f => f.definition.name), skipped }))
`

export function recordUpstream(upstream = upstreamDir()) {
  const scratchRoot = join(homedir(), '.cache', 'ah-test-homes')
  mkdirSync(scratchRoot, { recursive: true })
  const home = mkdtempSync(join(scratchRoot, 'surface-'))
  try {
    const env = { ...process.env, DSH_HOME: home }
    for (const f of ['ACADEMIC_HARNESS_SKIP_INSTALL', 'ACADEMIC_HARNESS_MODAL_SKIP_INSTALL', 'TEXTFOLD_SKIP_INSTALL', 'PAPERMEMORY_SKIP_INSTALL', 'ZVEC_GREP_SKIP_INSTALL']) env[f] = '1'
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', CHILD, upstream, JSON.stringify(discover(upstream))], { env, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })
    return JSON.parse(out.slice(out.lastIndexOf('@@RESULT@@') + '@@RESULT@@'.length))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

export async function compare({ upstream = upstreamDir() } = {}) {
  const rec = recordUpstream(upstream)
  const recorded = new Map() // name -> { description, parameters, file }
  const classOf = new Map(discover(upstream).map(e => [`${e.file}#${e.fn}`, classify(e)]))
  for (const e of rec.perEntry) for (const t of e.tools) recorded.set(t.name, { ...t, file: e.file, cls: classOf.get(`${e.file}#${e.fn}`) })

  const notFromManifest = rec.upstreamNames.filter(n => !recorded.has(n))
  // The host loads every module in this process: give it a scratch home and switch the installers off, then put the environment back.
  const saved = { ...process.env }
  const hostRoot = join(homedir(), '.cache', 'ah-test-homes')
  mkdirSync(hostRoot, { recursive: true })
  const scratch = mkdtempSync(join(hostRoot, 'host-'))
  process.env.DSH_HOME = scratch
  for (const f of ['ACADEMIC_HARNESS_SKIP_INSTALL', 'ACADEMIC_HARNESS_MODAL_SKIP_INSTALL', 'TEXTFOLD_SKIP_INSTALL', 'PAPERMEMORY_SKIP_INSTALL', 'ZVEC_GREP_SKIP_INSTALL']) process.env[f] = '1'
  let host
  try {
    host = await createHost({ upstream, areas: 'all', cwd: here, logger: () => {}, env: { ...process.env, AH_MOD_HOME: scratch } })
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
  }
  const cleanup = () => rmSync(scratch, { recursive: true, force: true })
  // The host's own tools (jobtools.mjs) are not upstream's; they are checked by their own tests.
  const hostTools = new Set(['job_status', 'job_wait', 'job_log', 'job_kill'])
  const served = host.list().filter(t => !hostTools.has(t.name))
  const hostServed = host.list().filter(t => hostTools.has(t.name)).map(t => t.name)
  const mismatched = []
  for (const t of served) {
    const u = recorded.get(t.name)
    if (!u) { mismatched.push({ tool: t.name, why: 'served but not registered upstream' }); continue }
    if (adapt(u.description) !== t.description) mismatched.push({ tool: t.name, why: 'description differs' })
    else if (JSON.stringify(u.parameters) !== JSON.stringify(t.inputSchema)) mismatched.push({ tool: t.name, why: 'parameters differ' })
    else if (u.cls?.tier !== 1) mismatched.push({ tool: t.name, why: `served although its module is ${u.cls?.tier}` })
  }
  const servedNames = new Set(served.map(t => t.name))
  cleanup()
  const notServed = [...recorded.values()].filter(u => !servedNames.has(u.name))
  const unexplained = notServed.filter(u => u.cls?.tier === 1)
  await host.dispose()
  return {
    upstreamTools: rec.upstreamNames.length,
    manifestTools: recorded.size,
    served: served.length,
    hostServed,
    notServed: notServed.map(u => ({ tool: u.name, module: u.file, tier: u.cls?.tier })),
    notFromManifest,
    mismatched,
    unexplained: unexplained.map(u => u.name),
    loadErrors: rec.perEntry.filter(e => e.error).map(e => `${e.file}: ${e.error}`),
    ok: notFromManifest.length === 0 && mismatched.length === 0 && unexplained.length === 0 && served.length > 0,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await compare()
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2))
  else {
    console.log(`upstream registers ${r.upstreamTools} tools; the manifest's modules register ${r.manifestTools}; the host serves ${r.served}`)
    const by = {}
    for (const n of r.notServed) (by[n.tier] ??= []).push(n.tool)
    for (const [tier, names] of Object.entries(by)) console.log(`  not served, ${tier}: ${names.length}`)
    for (const k of ['notFromManifest', 'mismatched', 'unexplained', 'loadErrors']) if (r[k].length) console.log(`${k}: ${JSON.stringify(r[k])}`)
    console.log(r.ok ? 'parity: ok' : 'parity: MISMATCH')
  }
  process.exit(r.ok ? 0 : 1)
}
void pathToFileURL
