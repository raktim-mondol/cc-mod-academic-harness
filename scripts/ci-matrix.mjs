#!/usr/bin/env node
// The Claude Code versions the CI workflow runs the plugin checks on: every version in TESTED_VERSIONS (server/src/compat.mjs), then `latest`.
// Adding a version there after a live run adds it to CI. Prints one line for $GITHUB_OUTPUT:  claude=["2.1.330","latest"]
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TESTED_VERSIONS } from '../server/src/compat.mjs'

export const matrix = () => [...TESTED_VERSIONS, 'latest']

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(`claude=${JSON.stringify(matrix())}`)
