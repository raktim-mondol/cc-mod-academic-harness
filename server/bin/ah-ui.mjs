#!/usr/bin/env node
// Data for the interface (status line and pane), as JSON on stdout. The hooks module has no Node, so it runs this with $.process.run.
//
//   node server/bin/ah-ui.mjs panel <cwd>      { project, library }: the project's state card cut to a pane, its gate, the library's counts
//   node server/bin/ah-ui.mjs gate <cwd>       the same without the library (the status line's refresh)
//
// Read-only. `project` is null outside an ah.yaml tree, `library` null when PaperMemory has no database, and either carries `error` when
// its source could not answer. Exit 0 always except for a bad call (2): a failing source is data, not a crash.
import { prepareEnv } from '../src/env.mjs'
import { panelData } from '../src/panel.mjs'

const [verb, cwd = process.cwd()] = process.argv.slice(2)
if (verb !== 'panel' && verb !== 'gate') {
  process.stderr.write('ah-ui: expected "panel <cwd>" or "gate <cwd>"\n')
  process.exit(2)
}
prepareEnv(process.env)
process.stderr.write = (write => (chunk, ...rest) => (String(chunk).includes('ExperimentalWarning') ? true : write.call(process.stderr, chunk, ...rest)))(process.stderr.write)
const data = await panelData(cwd, { gateOnly: verb === 'gate' })
process.stdout.write(`${JSON.stringify(data)}\n`)
