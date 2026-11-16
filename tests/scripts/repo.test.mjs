// Repository metadata that must agree with itself: the release number in four places, the npm scripts CI runs, and the commands in the
// workflow. A mismatch here is how a release ships with one number in the manifest and another in the README.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = file => readFileSync(join(root, file), 'utf8')
const plugin = JSON.parse(read('.claude-plugin/plugin.json'))
const pkg = JSON.parse(read('package.json'))
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('the release number', () => {
  test('plugin.json, package.json, the README and the changelog name the same version', () => {
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
    assert.equal(pkg.version, plugin.version)
    assert.ok(read('README.md').includes(`**Version ${plugin.version}.**`), `README.md does not say **Version ${plugin.version}.**`)
    assert.match(read('CHANGELOG.md'), new RegExp(`^## ${escape(plugin.version)}(?:\\s|$)`, 'm'))
  })
})

describe('the developer commands', () => {
  test('the package is private, an ES module, and needs the Node version the suite tests', () => {
    assert.equal(pkg.private, true)
    assert.equal(pkg.type, 'module')
    assert.equal(pkg.engines.node, '>=22')
    assert.equal(pkg.license, plugin.license)
  })
  test('every script points at a file that exists', () => {
    for (const [name, command] of Object.entries(pkg.scripts)) {
      for (const m of String(command).matchAll(/(?:^|\s)((?:scripts|server|tests)\/[A-Za-z0-9_./-]+\.(?:mjs|ts|tsx))/g)) {
        assert.ok(existsSync(join(root, m[1])), `${name}: ${m[1]} is missing`)
      }
    }
  })
  test('CI runs the same gate as npm run check', () => {
    const ci = read('.github/workflows/ci.yml')
    assert.equal(pkg.scripts.check, 'node scripts/check.mjs')
    assert.match(ci, /node scripts\/setup\.mjs --github/)
    assert.match(ci, /npm run check/)
  })
})

describe('the workflows', () => {
  const files = readdirSync(join(root, '.github', 'workflows')).filter(f => /\.ya?ml$/.test(f))
  test('there are workflows to check', () => {
    assert.ok(files.length > 0)
  })
  test('every action is pinned to a commit, not a tag that can move', () => {
    for (const file of files) {
      for (const m of read(`.github/workflows/${file}`).matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
        if (m[1].startsWith('./')) continue
        assert.match(m[1], /^[^@\s]+@[0-9a-f]{40}$/, `${file}: "${m[1]}" is not pinned to a 40-character commit`)
      }
    }
  })
  test('Dependabot keeps the pinned actions current', () => {
    assert.match(read('.github/dependabot.yml'), /package-ecosystem:\s*github-actions/)
  })
})
