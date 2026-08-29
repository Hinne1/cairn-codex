import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { extractFile, listPackage } from '@electron/asar'

const root = resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('Usage: node scripts/audit-package.mjs <package-directory>')

const required = [
  'Cairn Codex.exe',
  'LICENSE.CAIRN-CODEX.txt',
  'THIRD_PARTY_NOTICES.md',
  'README.md',
  join('resources', 'helper', 'CairnCodex.GrimDawn.exe'),
  join('resources', 'helper', 'coreclr.dll'),
  join('resources', 'helper', 'native', 'ItemAssistantHook_x64.dll'),
  join('resources', 'helper', 'native', 'DllInjector64.exe')
]
for (const path of required) await stat(join(root, path))
try {
  await stat(join(root, 'LICENSE'))
} catch {
  await stat(join(root, 'LICENSE.electron.txt'))
}

const forbiddenExtensions = new Set(['.db', '.sqlite', '.sqlite3', '.gsh', '.gst', '.bak', '.dmp'])
const forbiddenSegments = ['backups', 'live-adapter', 'live-receipts', 'item-icons', 'quarantine']
const files = []

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await visit(path)
    else files.push(path)
  }
}
await visit(root)

const archivePath = join(root, 'resources', 'app.asar')
let archiveEntries = []
try {
  await stat(archivePath)
  archiveEntries = listPackage(archivePath).map((entry) => entry.replaceAll('\\', '/'))
  if (!archiveEntries.includes('/package.json')) throw new Error('Packaged ASAR is missing package.json.')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
  await stat(join(root, 'resources', 'app', 'package.json'))
}

for (const path of files) {
  const local = relative(root, path).replaceAll('\\', '/').toLowerCase()
  const extension = local.slice(local.lastIndexOf('.'))
  if (forbiddenExtensions.has(extension) || forbiddenSegments.some((part) => local.split('/').includes(part))) {
    throw new Error(`Personal or game-state data is present in the package: ${local}`)
  }
}

const expected = {
  'ItemAssistantHook_x64.dll': '419b53fdff4e75dafb98f9066a0271da0f0c937b5b02e5beca2e39af527a34c5',
  'DllInjector64.exe': '569e6bdde51148b29aece0491366e9aa4c21cf2f11279a94c815e2b958cfe10c'
}
for (const [name, expectedHash] of Object.entries(expected)) {
  const bytes = await readFile(join(root, 'resources', 'helper', 'native', name))
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expectedHash) throw new Error(`${name} has unexpected SHA-256 ${actual}.`)
}

const appFiles = files.filter((path) => relative(root, path).replaceAll('\\', '/').startsWith('resources/app/'))
for (const path of appFiles) {
  if (!/\.(?:js|cjs|css|html|json)$/i.test(path)) continue
  const text = await readFile(path, 'utf8')
  if (/C:\\Users\\Hinne|Hinne\\AppData|Documents\\My Games\\Grim Dawn/i.test(text)) {
    throw new Error(`A personal machine path is embedded in ${relative(root, path)}.`)
  }
}
for (const entry of archiveEntries) {
  if (!/\.(?:js|cjs|css|html|json)$/i.test(entry)) continue
  const text = extractFile(archivePath, entry.replace(/^\//, '').replaceAll('/', '\\')).toString('utf8')
  if (/C:\\Users\\Hinne|Hinne\\AppData|Documents\\My Games\\Grim Dawn/i.test(text)) {
    throw new Error(`A personal machine path is embedded in resources/app.asar:${entry}.`)
  }
}

console.log(
  `Package audit passed: ${basename(root)}, ${files.length} files, ` +
  `${archiveEntries.length > 0 ? `${archiveEntries.length} ASAR entries, ` : ''}self-contained helper.`
)
