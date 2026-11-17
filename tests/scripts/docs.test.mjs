// The documentation stays navigable: every link resolves, the paths the guide, design and maintenance pages name exist, and every page can be
// reached from the repository README (so a page added without an index entry fails here).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The markdown a person reads: not the snapshot, not the generated skills and agents (only their READMEs), not fixtures, and not the
 *  repository automation templates (`.github/`), which describe a process rather than the project. */
const pages = execFileSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' }).split('\n')
  .filter(f => f.endsWith('.md'))
  .filter(f => !f.startsWith('core/') && !f.startsWith('tests/fixtures/') && !f.startsWith('tests/probe/') && !f.startsWith('scripts/research-mode'))
  .filter(f => !f.startsWith('.github/'))
  .filter(f => !/^(skills|agents)\//.test(f))

const read = f => readFileSync(join(root, f), 'utf8')
/** The text with code fences and inline code removed, so a link-like string in an example is not taken for a link. */
const prose = text => text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
const links = f => [...prose(read(f)).matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)].map(m => m[1]).filter(l => !/^(https?:|mailto:|#)/.test(l)).map(l => l.split('#')[0]).filter(Boolean)

describe('the documentation', () => {
  test('there are pages, and the roots exist', () => {
    assert.ok(pages.length >= 30, `${pages.length} pages`)
    for (const f of ['README.md', 'CHANGELOG.md', 'docs/README.md', 'hooks/README.md', 'server/README.md', 'scripts/README.md', 'tests/README.md', 'types/README.md']) assert.ok(pages.includes(f), f)
  })

  test('the folders Claude Code reads file by file hold no README', () => {
    // every .md in agents/ is an agent definition (a README would be loaded as one); skills/ holds one folder per skill
    const stray = execFileSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', 'agents', 'skills'], { encoding: 'utf8' }).split('\n').filter(f => /^(agents|skills)\/(README|readme)[^/]*$/.test(f))
    assert.deepEqual(stray, [])
  })

  test('every relative link resolves', () => {
    const broken = []
    for (const f of pages) for (const target of links(f)) {
      const path = normalize(join(dirname(f), target))
      if (!existsSync(join(root, path))) broken.push(`${f} -> ${target}`)
    }
    assert.deepEqual(broken, [])
  })

  test('the paths the current pages name in code spans exist', () => {
    const current = pages.filter(f => !f.startsWith('docs/history/'))
    const pathLike = /`((?:docs|hooks|server|scripts|tests|skills|agents|types)\/[A-Za-z0-9_./-]+\.(?:md|mjs|ts|tsx|json))`/g
    const missing = []
    for (const f of current) for (const m of read(f).matchAll(pathLike)) {
      const path = m[1]
      if (path.includes('<') || path.includes('*')) continue
      if (!existsSync(join(root, path))) missing.push(`${f}: ${path}`)
    }
    assert.deepEqual(missing, [])
  })

  test('every page is reachable from the repository README', () => {
    const seen = new Set()
    const queue = ['README.md']
    while (queue.length) {
      const f = queue.pop()
      if (seen.has(f)) continue
      seen.add(f)
      for (const target of links(f)) {
        const path = normalize(join(dirname(f), target))
        if (path.endsWith('.md') && pages.includes(path) && !seen.has(path)) queue.push(path)
      }
    }
    const lost = pages.filter(f => !seen.has(f))
    assert.deepEqual(lost, [], 'add each to the index of its folder')
  })

  test('every folder of pages has an index that links all of them', () => {
    for (const dir of ['docs/guide', 'docs/design', 'docs/maintain', 'docs/history']) {
      const index = `${dir}/README.md`
      assert.ok(pages.includes(index), `${dir} has no README.md`)
      const linked = new Set(links(index).map(t => normalize(join(dir, t))))
      for (const f of pages.filter(p => p.startsWith(`${dir}/`) && p !== index)) assert.ok(linked.has(f), `${index} does not link ${relative(dir, f)}`)
    }
  })

  test('the docs index links every section and every component README', () => {
    const linked = new Set(links('docs/README.md').map(t => normalize(join('docs', t))))
    for (const f of ['docs/guide/README.md', 'docs/design/README.md', 'docs/maintain/README.md', 'docs/history/README.md', 'hooks/README.md', 'server/README.md', 'scripts/README.md', 'tests/README.md', 'types/README.md', 'CHANGELOG.md', 'README.md']) assert.ok(linked.has(f), f)
  })

  test('the repository README says what the numbers the guide gives say', () => {
    const readme = read('README.md')
    const plugin = JSON.parse(read('.claude-plugin/plugin.json'))
    assert.match(readme, new RegExp(`\\*\\*Version ${plugin.version.replace(/\./g, '\\.')}\\.\\*\\*`), 'the README names the plugin version')
    assert.match(read('CHANGELOG.md'), new RegExp(`## ${plugin.version.replace(/\./g, '\\.')}`), 'the changelog has an entry for it')
    const builtSkills = JSON.parse(read('skills/.build-info.json')).included.length
    assert.match(readme, new RegExp(`${builtSkills} core skills`))
    const agents = execFileSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', 'agents'], { encoding: 'utf8' }).split('\n').filter(f => f.endsWith('.md') && !f.endsWith('README.md')).length
    assert.match(readme, new RegExp(`${agents} specialist agents`))
  })

  test('the marketplace file names the plugin, and the install line in the README uses it', () => {
    const market = JSON.parse(read('.claude-plugin/marketplace.json'))
    const plugin = JSON.parse(read('.claude-plugin/plugin.json'))
    assert.deepEqual(market.plugins.map(p => p.name), [plugin.name])
    assert.equal(market.plugins[0].source, './')
    assert.ok(read('README.md').includes(`/plugin install ${plugin.name} --marketplace raktim-mondol/cc-mod-academic-harness`))
  })
})
