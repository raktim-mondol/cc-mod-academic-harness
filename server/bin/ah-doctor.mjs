#!/usr/bin/env node
// What is ready and what is not, for `/academic doctor` and by hand.
//
//   node server/bin/ah-doctor.mjs            the report as text
//   node server/bin/ah-doctor.mjs --json     the checks as JSON
//   node server/bin/ah-doctor.mjs --online   also ask GitHub whether upstream has moved on
//
// Read-only. Exit 0 when the mod can work, 1 when something it cannot work without is missing.
import { diagnose, format } from '../src/doctor.mjs'

process.stderr.write = (write => (chunk, ...rest) => (String(chunk).includes('ExperimentalWarning') ? true : write.call(process.stderr, chunk, ...rest)))(process.stderr.write)
const report = await diagnose({ online: process.argv.includes('--online') })
process.stdout.write(`${process.argv.includes('--json') ? JSON.stringify(report, null, 2) : format(report)}\n`)
process.exit(report.blocking ? 1 : 0)
