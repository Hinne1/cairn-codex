import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import { assertReleaseEntry } from './release-entry-boundary.mjs'

const root = resolve(process.argv[2] ?? 'out')
await stat(join(root, 'main/index.js'))
let checked = 0
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    assertReleaseEntry(relative(root, path), '')
    if (entry.isDirectory()) await visit(path)
    else {
      assertReleaseEntry(relative(root, path), /\.(js|cjs|mjs|map)$/.test(path) ? await readFile(path, 'utf8') : '')
      checked++
    }
  }
}
await visit(root)
console.log(`Release entry audit passed: ${checked} files; no verification modules or fixture bodies.`)
