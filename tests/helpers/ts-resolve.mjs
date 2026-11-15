// Lets a node test import the hooks module's own TypeScript: Node strips the types, and this resolves the extensionless relative
// imports the hooks use (`./generated/task-modes`) to the .ts file beside them. `import './helpers/ts-resolve.mjs'` before the import.
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\\.[a-z]+$/.test(specifier) && context.parentURL?.endsWith('.ts')) {
    const candidate = new URL(specifier + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
`), import.meta.url)
