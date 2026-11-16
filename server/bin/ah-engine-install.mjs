#!/usr/bin/env node
// The background build of the writing engine's environment as its own process (server/src/engine-install.mjs, `installEngineInWorker`). The `ah`
// server starts it detached, so the build goes on when the session that started it ends. It says nothing: while it runs, the marker file in the
// engine folder holds its pid, and the guard and the doctor say "being installed". Exit 0 when the environment is ready (or another build is
// making it), 1 when it could not be built; `node scripts/install-engine.mjs` then shows why.
import { installEngine } from '../src/engine-install.mjs'

// The snapshot to build in is the first argument: the server names the one it is running from.
installEngine({ quiet: true, ...(process.argv[2] ? { upstream: process.argv[2] } : {}) }).then(() => process.exit(0), () => process.exit(1))
