#!/usr/bin/env node
// The first-start setup of the core as its own process (server/src/bootstrap.mjs, `bootstrapInWorker`). The `ah` server starts it detached, so the copy and
// `npm ci` go on when the session that started them ends: a headless `claude -p` is over in seconds, and a setup tied to its server would never
// finish. It says nothing: what it is doing, and why it failed, are in <home>/bootstrap.json, which the doctor reads. Exit 0 when the core is
// ready, 1 when it is not.
import { bootstrap } from '../src/bootstrap.mjs'

bootstrap().then(() => process.exit(0), () => process.exit(1))
