#!/usr/bin/env node
// Runs one nested `claude -p` scenario against the P0 probe plugin (and the mod),
// from a scratch directory under ~/.cache. Ground rules 4 and 7 of the plan.
//
//   node scripts/probe-run.mjs <name> [--probe-env K=V]... [--no-mod] [--no-probe] -- <claude args...>
//
// Writes ~/.cache/ah-cc-p0/out/<name>/{stream.jsonl,stderr.txt,probe.jsonl}.
// The prompt is the last claude argument, as usual for `claude -p`.

import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cache = join(homedir(), '.cache', 'ah-cc-p0')
const ENV_DROP = ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_BRIDGE_SESSION_ID']

const argv = process.argv.slice(2)
const name = argv.shift()
const sep = argv.indexOf('--')
const mine = sep === -1 ? argv : argv.slice(0, sep)
const claudeArgs = sep === -1 ? [] : argv.slice(sep + 1)

const env = { ...process.env }
for (const k of ENV_DROP) delete env[k]
let useMod = true
let useProbe = true
for (let i = 0; i < mine.length; i++) {
  if (mine[i] === '--probe-env') { const [k, ...v] = mine[++i].split('='); env[k] = v.join('=') }
  else if (mine[i] === '--no-mod') useMod = false
  else if (mine[i] === '--no-probe') useProbe = false
}

const outDir = join(cache, 'out', name)
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
const work = join(cache, 'work', name)
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
env.AH_PROBE_OUT = join(outDir, 'probe.jsonl')

const dirs = []
if (useProbe) dirs.push('--plugin-dir', join(root, 'tests', 'probe'))
if (useMod) dirs.push('--plugin-dir', root)

const args = ['-p', ...dirs, '--output-format', 'stream-json', '--verbose', ...claudeArgs]
writeFileSync(join(outDir, 'cmd.txt'), `cwd=${work}\nclaude ${args.map(a => JSON.stringify(a)).join(' ')}\n`)

const child = spawn('claude', args, { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] })
let so = '', se = ''
const timer = setTimeout(() => child.kill('SIGKILL'), 240_000)
child.stdout.on('data', d => { so += d })
child.stderr.on('data', d => { se += d })
child.on('close', code => {
  clearTimeout(timer)
  writeFileSync(join(outDir, 'stream.jsonl'), so)
  writeFileSync(join(outDir, 'stderr.txt'), se)
  console.log(`${name}: exit ${code}, ${so.length} bytes stdout, ${se.length} bytes stderr -> ${outDir}`)
})
