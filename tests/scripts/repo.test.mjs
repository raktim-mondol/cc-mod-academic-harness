// Repository metadata that must agree with itself: the release number in four places, the npm scripts CI runs, and the commands in the
// workflow. A mismatch here is how a release ships with one number in the manifest and another in the README.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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

describe('the licences of what is copied', () => {
  const info = JSON.parse(read('skills/.build-info.json'))
  const notice = read('NOTICE')
  /** What a copied skill may name: the build keeps no other (decision D5). */
  const ALLOWED = new Set(['MIT', 'CC-BY-4.0'])
  const copied = readdirSync(join(root, 'skills')).filter(n => statSync(join(root, 'skills', n)).isDirectory() && n !== 'research-guides')

  test('the build copied no restricted licence, and skills/ holds exactly what it says it copied', () => {
    assert.equal(info.restricted, false, 'a local build with restricted licences must never be committed')
    assert.deepEqual([...copied].sort(), info.included.map(s => s.name).sort())
    for (const s of info.included) assert.ok(s.license === null || ALLOWED.has(s.license), `${s.name} names ${s.license}`)
    for (const s of info.included) {
      const line = /^license:\s*(.+)$/m.exec(read(`skills/${s.name}/SKILL.md`))?.[1]?.trim().replace(/^["']|["']$/g, '') ?? null
      assert.equal(line, s.license, `${s.name}: SKILL.md and the build record disagree`)
    }
  })
  test('every skill that is not MIT or the source\'s own text is credited in NOTICE', () => {
    const others = info.included.filter(s => s.license && s.license !== 'MIT')
    assert.ok(others.length > 0)
    for (const s of others) assert.ok(notice.includes(s.name), `${s.name} (${s.license}) is not in NOTICE`)
    assert.match(notice, /CC BY-SA 4\.0/)
    assert.ok(notice.includes('remove-ai-signs/references/signs.md'))
    assert.match(notice, /Creative Commons Attribution 4\.0/)
  })
  test('the MIT sources named in NOTICE keep their copyright lines, and the skills they came from are named', () => {
    assert.match(notice, /Copyright \(c\) 2025 K-Dense Inc\./)
    assert.match(notice, /Copyright \(c\) 2026 K-Dense, Inc\./)
    for (const name of ['literature-review', 'framing-research-questions', 'investigating-anomalous-results', 'preregistering-analysis', 'requesting-red-team-review', 'verifying-results-before-claiming', 'designing-the-analysis', 'establishing-feasibility-first']) {
      assert.ok(copied.includes(name), `${name} is expected to be copied`)
      assert.ok(notice.includes(name), `${name} is copied but not in NOTICE`)
    }
  })
  test('NOTICE counts the skills the way the build record does', () => {
    const n = info.included.length
    const mit = info.included.filter(s => s.license === 'MIT').length
    const cc = info.included.filter(s => s.license === 'CC-BY-4.0').length
    const none = info.included.filter(s => s.license === null).length
    assert.ok(notice.replace(/\s+/g, ' ').includes(`Of the ${n} skills copied, ${mit} name MIT, ${cc} name CC-BY-4.0, and ${none} name no licence`), 'the counts in NOTICE are out of date')
  })
})
