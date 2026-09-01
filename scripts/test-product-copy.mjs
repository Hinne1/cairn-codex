import { readdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoots = ['src/renderer', 'src/main', 'src/helper']
const sourceExtensions = new Set(['.cs', '.html', '.ts', '.vue'])
const ignoredDirectories = new Set(['bin', 'obj'])

const allowedLoreLines = new Set([
  "src/main/index.ts::name: 'Veil of the Cairn',",
  "src/main/index.ts::members: ['Cairn Hood', 'Cairn Mantle', 'Cairn Sigil'],",
  "src/main/index.ts::record: 'records/items/synthetic/cairn_hood.dbr', name: 'Cairn Hood', rarity: 'legendary',",
  "src/main/index.ts::slot: 'head', level: 94, setName: 'Veil of the Cairn', setRecord: 'records/items/synthetic/cairn_set.dbr',",
  "src/main/index.ts::record: 'records/items/synthetic/cairn_mantle.dbr', name: 'Cairn Mantle', rarity: 'legendary',",
  "src/main/index.ts::slot: 'shoulders', level: 94, setName: 'Veil of the Cairn', setRecord: 'records/items/synthetic/cairn_set.dbr',",
  "src/main/index.ts::record: 'records/items/synthetic/cairn_sigil.dbr', name: 'Cairn Sigil', rarity: 'legendary',",
  "src/main/index.ts::slot: 'medal', level: 94, setName: 'Veil of the Cairn', setRecord: 'records/items/synthetic/cairn_set.dbr',",
  "src/main/index.ts::awakeningSourceName: 'Cairn Mark', setPresentation",
  "src/renderer/src/App.vue::<h2>{{ snapshot ? 'Your collection has entered the Codex.' : 'Reading the archives of Cairn…' }}</h2>",
  'src/renderer/src/App.vue::<section class="planner-world-map" aria-label="Cairn item source map">'
])

const requiredProductNameContexts = [
  ['src/renderer/index.html', '<title>Cairn Codex</title>'],
  ['src/renderer/src/App.vue', '<h1>Cairn Codex</h1>'],
  ['src/renderer/src/components/OnboardingDialog.vue', 'Welcome to Cairn Codex'],
  ['src/main/index.ts', "title: 'Export Cairn Codex preferences'"]
]

const requiredCompactSubjectContexts = [
  ['src/renderer/src/components/OnboardingDialog.vue', 'CC automatically checks'],
  ['src/renderer/src/components/OnboardingDialog.vue', 'CC rotates archive snapshots'],
  ['src/renderer/src/App.vue', 'new to CC'],
  ['src/main/index.ts', 'CC will verify this backup']
]

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) files.push(...await collectSourceFiles(path))
    else if (sourceExtensions.has(extname(entry.name))) files.push(path)
  }
  return files
}

const files = (await Promise.all(sourceRoots.map((root) => collectSourceFiles(join(repositoryRoot, root))))).flat()
const contents = new Map()
const standaloneCairnLines = new Set()
const personifiedProductLines = new Set()
const productActorPattern = /\bCairn Codex(?:['’]s|\s+(?:accesses|analyzes|can|cannot|checks|could|creates|did|does|found|has|is|keeps|owns|preserves|reads|records|rotates|runs|uses|will|writes))\b/u

for (const path of files) {
  const source = await readFile(path, 'utf8')
  const repositoryPath = relative(repositoryRoot, path).replaceAll('\\', '/')
  contents.set(repositoryPath, source)
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue
    if (/\bCairn\b(?!\s+Codex\b)/u.test(trimmed)) {
      standaloneCairnLines.add(`${repositoryPath}::${trimmed}`)
    }
    if (productActorPattern.test(trimmed)) personifiedProductLines.add(`${repositoryPath}::${trimmed}`)
  }
}

const unexpected = [...standaloneCairnLines].filter((entry) => !allowedLoreLines.has(entry))
const missingLore = [...allowedLoreLines].filter((entry) => !standaloneCairnLines.has(entry))
if (unexpected.length || missingLore.length || personifiedProductLines.size) {
  const details = [
    ...unexpected.map((entry) => `Unexpected standalone Cairn: ${entry}`),
    ...missingLore.map((entry) => `Missing explicit lore allowance: ${entry}`),
    ...[...personifiedProductLines].map((entry) => `Use CC as the product actor: ${entry}`)
  ]
  throw new Error(`Product copy policy failed:\n${details.join('\n')}`)
}

for (const [path, expected] of [...requiredProductNameContexts, ...requiredCompactSubjectContexts]) {
  if (!contents.get(path)?.includes(expected)) {
    throw new Error(`Product copy policy lost required context in ${path}: ${expected}`)
  }
}

console.log(JSON.stringify({
  passed: true,
  scannedFiles: files.length,
  explicitLoreAllowances: allowedLoreLines.size,
  productNameContexts: requiredProductNameContexts.length,
  compactSubjectContexts: requiredCompactSubjectContexts.length
}, null, 2))
