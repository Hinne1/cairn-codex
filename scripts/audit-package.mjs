import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { extractFile, listPackage } from '@electron/asar'
import { readPeImports } from './pe-imports.mjs'
import { assertReleaseEntry } from './release-entry-boundary.mjs'

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
  join('resources', 'helper', 'native', 'DllInjector64.exe'),
  join('resources', 'prerequisites', 'vc_redist.x64.exe'),
  join('resources', 'prerequisites', 'vc-redist-manifest.json')
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
  assertReleaseEntry(local, /\.(js|cjs|mjs|map)$/.test(local) ? await readFile(path, 'utf8') : '')
  const extension = local.slice(local.lastIndexOf('.'))
  if (forbiddenExtensions.has(extension) || forbiddenSegments.some((part) => local.split('/').includes(part))) {
    throw new Error(`Personal or game-state data is present in the package: ${local}`)
  }
}

for (const path of archiveEntries) {
  assertReleaseEntry(path, /\.(js|cjs|mjs|map)$/.test(path)
    ? extractFile(archivePath, path.replace(/^\//, '')).toString('utf8') : '')
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

const nativeDependencyPolicy = {
  'ItemAssistantHook_x64.dll': new Set([
    'kernel32.dll', 'user32.dll', 'shell32.dll', 'ole32.dll',
    'msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'
  ]),
  'DllInjector64.exe': new Set([
    'kernel32.dll', 'user32.dll', 'advapi32.dll', 'vcruntime140.dll'
  ])
}
for (const [name, allowed] of Object.entries(nativeDependencyPolicy)) {
  const bytes = await readFile(join(root, 'resources', 'helper', 'native', name))
  const imports = readPeImports(bytes)
  const unexpected = imports.filter((dependency) =>
    !allowed.has(dependency) && !dependency.startsWith('api-ms-win-crt-')
  )
  if (unexpected.length > 0) {
    throw new Error(`${name} has unallowlisted PE dependencies: ${unexpected.join(', ')}.`)
  }
  for (const requiredRuntime of [...allowed].filter((dependency) => /^(?:msvcp|vcruntime)/.test(dependency))) {
    if (!imports.includes(requiredRuntime)) {
      throw new Error(`${name} no longer imports expected runtime dependency ${requiredRuntime}; review packaging deliberately.`)
    }
  }
}

const prerequisiteRoot = join(root, 'resources', 'prerequisites')
const redistBytes = await readFile(join(prerequisiteRoot, 'vc_redist.x64.exe'))
const redistManifest = JSON.parse(await readFile(join(prerequisiteRoot, 'vc-redist-manifest.json'), 'utf8'))
const redistHash = createHash('sha256').update(redistBytes).digest('hex')
if (redistManifest.schemaVersion !== 1 || redistManifest.sha256 !== redistHash) {
  throw new Error('The packaged VC++ prerequisite does not match its verified staging manifest.')
}
const redistVersion = String(redistManifest.version ?? '').split('.').map(Number)
if (redistVersion.length < 2 || redistVersion[0] < 14 || (redistVersion[0] === 14 && redistVersion[1] < 43)) {
  throw new Error(`The packaged VC++ prerequisite ${redistManifest.version ?? '<missing>'} is older than 14.43.`)
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
  `${archiveEntries.length > 0 ? `${archiveEntries.length} ASAR entries, ` : ''}` +
  `self-contained helper, VC++ prerequisite ${redistManifest.version}.`
)
