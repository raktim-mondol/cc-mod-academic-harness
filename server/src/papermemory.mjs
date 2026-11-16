// Find, and if needed install, the PaperMemory CLI, then describe how to run `papermemory mcp`.
//
// Mirrors upstream's papermemory-cli.js with these differences, each on purpose:
//   - The managed install lives under the mod's own home (AH_MOD_HOME, default
//     ~/.local/share/cc-mod-academic-harness/home/papermemory), never under DSH_HOME or ~/.dsh.
//   - It never runs `init` on an existing store and never migrates one. A store that needs
//     migrating makes the server report `migration-required`; migrating it (after `papermemory
//     backup`) is the user's step. A store that does not exist yet is created by the server itself.
//   - With AH_UPSTREAM set (development against a checkout) nothing is installed: building from
//     a live checkout could write into it (plan ground rule 1).
//
// Everything here logs to stderr. Standard output belongs to the MCP protocol.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LOG = '[academic-harness] papermemory'
export const MIN_VERSION = '0.3.6'
export const STAMP_REV = 'ccmod1'
// The MCP copy of the reference library is hidden, as upstream does. The mod gets the workspace-aware
// native `reference_library` tool from the ah server in P2 (the server's cwd would also be right here).
export const HIDDEN_TOOLS = ['papermemory_library']
export const EXPECTED_TOOLS = 14
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000
const PROBE_TIMEOUT_MS = 20 * 1000
const LOCK_STALE_MS = 10 * 60 * 1000

const HERE = dirname(fileURLToPath(import.meta.url))
const IS_WIN = process.platform === 'win32'

export const say = msg => process.stderr.write(`${LOG}: ${msg}\n`)

import { isDevMode, modHome, modRoot, upstreamDir } from './paths.mjs'
export { modRoot, modHome, upstreamDir, isDevMode }
export function installDir(env = process.env) { return join(modHome(env), 'papermemory') }
export function vendorDir(env = process.env) { return join(upstreamDir(env), 'vendor', 'papermemory') }

const venvBin = (env, name) => join(installDir(env), '.venv', IS_WIN ? 'Scripts' : 'bin', IS_WIN ? `${name}.exe` : name)
const stampPath = env => join(installDir(env), 'installed-version')

export function vendoredVersion(env = process.env) {
  try {
    const m = readFileSync(join(vendorDir(env), 'pyproject.toml'), 'utf8').match(/^version\s*=\s*"([^"]+)"/m)
    return m ? m[1] : MIN_VERSION
  } catch {
    return MIN_VERSION
  }
}
export const wantStamp = (env = process.env) => `${vendoredVersion(env)}+${STAMP_REV}`
export function installedStamp(env = process.env) {
  try { return readFileSync(stampPath(env), 'utf8').trim() || undefined } catch { return undefined }
}

function semver(v) {
  const m = String(v ?? '').trim().match(/^(\d+)\.(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
export function versionAtLeast(have, want) {
  const a = semver(have), b = semver(want)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i] }
  return true
}

export function run(command, args, { cwd, timeoutMs = PROBE_TIMEOUT_MS, env } = {}) {
  return new Promise(res => {
    let out = '', err = '', settled = false
    const done = r => { if (!settled) { settled = true; clearTimeout(timer); res(r) } }
    let child
    try { child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { return res({ code: 127, out, err: String(e) }) }
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* gone */ } done({ code: 124, out, err: err + `timed out after ${timeoutMs} ms` }) }, timeoutMs)
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('error', e => done({ code: 127, out, err: err + String(e) }))
    child.on('close', code => done({ code: code ?? 1, out, err }))
  })
}

function onPath(names, env = process.env) {
  for (const dir of (env.PATH || '').split(delimiter)) {
    if (!dir) continue
    for (const n of names) { const p = join(dir, n); if (existsSync(p)) return p }
  }
  return undefined
}
const findUv = (env = process.env) => env.UV?.trim() || onPath([IS_WIN ? 'uv.exe' : 'uv'], env) || [join(homedir(), '.local', 'bin', 'uv'), join(homedir(), '.cargo', 'bin', 'uv')].find(existsSync)
const findPython = (env = process.env) => env.ACADEMIC_HARNESS_PYTHON?.trim() || onPath(IS_WIN ? ['python.exe', 'python'] : ['python3', 'python'], env)

export const launchOf = command => ({ command, args: [] })

export async function cliVersion(launch, env = process.env) {
  const r = await run(launch.command, [...launch.args, 'version', '--json'], { env: { ...env, PYTHONUNBUFFERED: '1' } })
  const text = r.out.trim()
  try { return JSON.parse(text.slice(text.indexOf('{'))).version } catch { return undefined }
}

/** Does `papermemory mcp` answer an initialize line with JSON (not Content-Length framing)? */
export function probeNdjson(launch, env = process.env, timeoutMs = 5000) {
  return new Promise(res => {
    let settled = false
    const child = spawn(launch.command, [...launch.args, 'mcp'], { env, stdio: ['pipe', 'pipe', 'ignore'] })
    const done = ok => { if (settled) return; settled = true; clearTimeout(timer); try { child.kill('SIGKILL') } catch { /* gone */ } res(ok) }
    const timer = setTimeout(() => done(false), timeoutMs)
    child.stdout.once('data', b => { const t = b.toString(); done(!t.startsWith('Content-Length:') && t.includes('{') && t.includes('jsonrpc')) })
    child.on('error', () => done(false))
    try { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n'); child.stdin.end() } catch { done(false) }
  })
}

/** The managed install, when present and current. */
export function findManaged(env = process.env) {
  const bin = venvBin(env, 'papermemory')
  if (installedStamp(env) !== wantStamp(env)) return undefined
  if (existsSync(bin)) return launchOf(bin)
  const py = venvBin(env, 'python')
  return existsSync(py) ? { command: py, args: ['-m', 'papermemory'] } : undefined
}

async function withInstallLock(env, fn) {
  const dir = installDir(env)
  mkdirSync(dir, { recursive: true })
  const lock = join(dir, 'install.lock')
  const deadline = Date.now() + INSTALL_TIMEOUT_MS
  for (;;) {
    try { mkdirSync(lock); break } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) { rmSync(lock, { recursive: true, force: true }); continue } } catch { continue }
      if (findManaged(env)) return findManaged(env) // another process finished it
      if (Date.now() > deadline) throw new Error('timed out waiting for another install to finish')
      await new Promise(r => setTimeout(r, 500))
    }
  }
  try { return await fn() } finally { rmSync(lock, { recursive: true, force: true }) }
}

export async function install(env = process.env) {
  const vendor = vendorDir(env)
  if (!existsSync(join(vendor, 'pyproject.toml'))) { say(`vendored package missing at ${vendor}. Run: node scripts/sync-upstream.mjs`); return undefined }
  return withInstallLock(env, async () => {
    if (findManaged(env)) return findManaged(env)
    const dir = installDir(env)
    const venv = join(dir, '.venv')
    const spec = `${vendor}[pdf]`
    say(`installing papermemory ${vendoredVersion(env)} into ${dir} (first run)`)
    const uv = findUv(env)
    let r = { code: 1, out: '', err: '' }
    if (uv) {
      r = await run(uv, ['venv', '--clear', venv], { cwd: dir, timeoutMs: INSTALL_TIMEOUT_MS, env })
      if (r.code === 0) r = await run(uv, ['pip', 'install', '--python', venvBin(env, 'python'), spec], { cwd: dir, timeoutMs: INSTALL_TIMEOUT_MS, env })
    }
    if (!uv || r.code !== 0 || !existsSync(venvBin(env, 'papermemory'))) {
      const py = findPython(env)
      if (!py) { say('no uv and no python3 on PATH; cannot install'); return undefined }
      r = await run(py, ['-m', 'venv', '--clear', venv], { cwd: dir, timeoutMs: INSTALL_TIMEOUT_MS, env })
      if (r.code === 0) r = await run(venvBin(env, 'python'), ['-m', 'pip', 'install', spec], { cwd: dir, timeoutMs: INSTALL_TIMEOUT_MS, env })
    }
    const launch = existsSync(venvBin(env, 'papermemory')) ? launchOf(venvBin(env, 'papermemory')) : undefined
    if (!launch || r.code !== 0) { say(`install failed (exit ${r.code}): ${(r.err || r.out).trim().replace(/\s+/g, ' ').slice(0, 400)}`); return undefined }
    const v = await cliVersion(launch, env)
    if (!versionAtLeast(v, MIN_VERSION)) { say(`installed version ${v ?? 'unknown'} is below ${MIN_VERSION}; refusing it`); return undefined }
    writeFileSync(stampPath(env), `${wantStamp(env)}\n`)
    say(`ready (version ${v})`)
    return launch
  })
}

/**
 * PAPERMEMORY_CLI, then the managed install (installing it if missing and not in dev mode), then a
 * PATH copy that passes the version and NDJSON checks. Returns undefined when none works.
 */
export async function resolveLaunch(env = process.env) {
  const override = env.PAPERMEMORY_CLI?.trim()
  if (override) return launchOf(override)
  const managed = findManaged(env)
  if (managed) return managed
  if (!isDevMode(env) && env.PAPERMEMORY_SKIP_INSTALL !== '1') {
    const installed = await install(env)
    if (installed) return installed
  }
  const path = onPath(IS_WIN ? ['papermemory.exe', 'papermemory.cmd', 'papermemory'] : ['papermemory'], env)
  if (path) {
    const launch = launchOf(path)
    const v = await cliVersion(launch, env)
    if (!versionAtLeast(v, MIN_VERSION)) { say(`${path} is version ${v ?? 'unknown'} (< ${MIN_VERSION}); not using it`); return undefined }
    if (!(await probeNdjson(launch, env))) { say(`${path} does not speak newline-delimited MCP; not using it`); return undefined }
    say(`using ${path} (${v}) from PATH`)
    return launch
  }
  return undefined
}

/** Environment for `papermemory mcp`: the caller's, plus unbuffered output and the hidden tool list. */
export function serverEnv(env = process.env) {
  return { ...env, PYTHONUNBUFFERED: '1', PAPERMEMORY_HIDE_TOOLS: HIDDEN_TOOLS.join(',') }
}
