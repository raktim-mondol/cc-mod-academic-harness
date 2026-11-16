#!/usr/bin/env node
// What is ready and what is not, for `/academic doctor` and by hand.
//
//   node server/bin/ah-doctor.mjs            the report as text
//   node server/bin/ah-doctor.mjs --json     the checks as JSON
//   node server/bin/ah-doctor.mjs --online   also ask GitHub whether upstream has moved on
//   node server/bin/ah-doctor.mjs --usage    which skills, agents and commands were used and which never were (--all lists every name);
//                                            the tools that were never called are only known to a running server: /academic usage
//
// Read-only. Exit 0 when the mod can work, 1 when something it cannot work without is missing.
import { diagnose, format } from '../src/doctor.mjs'
import { knownNames } from '../src/doctortool.mjs'
import { modHome } from '../src/paths.mjs'
import { formatReport, readUsage, usageDir } from '../src/usage.mjs'

process.stderr.write = (write => (chunk, ...rest) => (String(chunk).includes('ExperimentalWarning') ? true : write.call(process.stderr, chunk, ...rest)))(process.stderr.write)
if (process.argv.includes('--usage')) {
  process.stdout.write(`${formatReport(readUsage(usageDir(modHome())), knownNames(undefined), { all: process.argv.includes('--all') })}\n`)
  process.exit(0)
}
const report = await diagnose({ online: process.argv.includes('--online') })
process.stdout.write(`${process.argv.includes('--json') ? JSON.stringify(report, null, 2) : format(report)}\n`)
process.exit(report.blocking ? 1 : 0)
