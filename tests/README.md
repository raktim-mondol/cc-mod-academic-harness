# tests/

| Where | What | Run |
|---|---|---|
| `*.test.ts`, `*.test.tsx` | Plugin tests of the hooks module, with the engine stood in for | `claude plugin test .` |
| `scripts/*.test.mjs` | The builds, the task mapping against upstream's, the interface's pure parts, what is left out, the snapshot, the doctor, the update report, the documentation | `node --test "tests/scripts/*.test.mjs"` |
| `server/*.test.mjs` | The tool host, the surface parity, the guard bridge, jobs, PaperMemory's launcher, the first start | `node --test "tests/server/*.test.mjs"` |
| `live/*.mjs` | Scripts that drive a real Claude Code, tmux, the network. They cost cents and are run by choice | `node tests/live/p5.mjs [scenario ...]` |
| `helpers/` | `ts-resolve.mjs` lets node import the hooks' `.ts` files | |
| `fixtures/` | A manuscript, a script, and the other inputs the tests use | |
| `probe/` | The probe plugin of phase P0 | |

Which command checks what, what each live script costs, and how to write a test: [Testing](../docs/maintain/testing.md). The whole fast gate is `npm run check`.
