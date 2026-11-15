// Surface parity against the snapshot (scripts/measure-surface.mjs). Needs upstream/ and its node_modules.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { compare } from '../../scripts/measure-surface.mjs'
import { upstreamDir } from '../../server/src/paths.mjs'

test('the host serves exactly the tier-1 tools, each identical to what upstream registers', { skip: !existsSync(join(upstreamDir(), 'node_modules', 'ah-dsh-tools')) }, async () => {
  const r = await compare()
  assert.deepEqual(r.notFromManifest, [], 'a module upstream registers that the manifest does not discover')
  assert.deepEqual(r.mismatched, [])
  assert.deepEqual(r.unexplained, [], 'a tier-1 tool that upstream registers but the host does not serve')
  assert.equal(r.served, 132)
  assert.deepEqual(r.hostServed.sort(), ['job_kill', 'job_log', 'job_status', 'job_wait'])
  assert.equal(r.upstreamTools, 136)
  assert.ok(r.notServed.every(n => n.tier === 'later' || n.tier === 'host-only'))
  assert.equal(r.ok, true)
})
