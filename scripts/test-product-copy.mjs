import { readdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoots = ['src/renderer', 'src/main', 'src/helper']
const sourceExtensions = new Set(['.cs', '.css', '.html', '.ts', '.vue'])
const ignoredDirectories = new Set(['bin', 'obj'])

const allowedLoreLines = new Set([
  "src/renderer/src/App.vue::<h2>{{ snapshot ? 'Your collection has entered the Codex.' : 'Reading the archives of Cairn…' }}</h2>",
  'src/renderer/src/App.vue::<section class="planner-world-map" aria-label="Cairn item source map">'
])

const allowedProductNameLines = new Set([
  'src/renderer/index.html::<title>Cairn Codex</title>',
  'src/renderer/src/components/OnboardingDialog.vue::<h2 id="onboarding-title">Welcome to Cairn Codex</h2>',
  "src/renderer/src/semantic-tokens.ts::name: 'Cairn Codex',",
  'src/main/collection-database.ts::`Archive schema ${version.user_version} is newer than this Cairn Codex build supports.`',
  "src/main/collection-database.ts::throw new Error('The selected file is not a Cairn Codex archive database.')",
  "src/main/bootstrap.ts::title: 'Export Cairn Codex preferences',",
  "src/main/bootstrap.ts::filters: [{ name: 'Cairn Codex preferences', extensions: ['json'] }]",
  "src/main/bootstrap.ts::title: 'Export Cairn Codex archive backup',",
  "src/main/bootstrap.ts::filters: [{ name: 'Cairn Codex archive', extensions: ['sqlite3'] }]",
  "src/main/bootstrap.ts::title: 'Restore Cairn Codex archive backup',",
  "src/main/bootstrap.ts::{ name: 'Cairn Codex archive', extensions: ['sqlite3', 'sqlite', 'db'] },",
  "src/main/bootstrap.ts::title: 'Restore Cairn Codex archive?',",
  "src/main/bootstrap.ts::title: 'Save Cairn Codex support bundle',",
  "src/main/bootstrap.ts::console.log('[startup] Electron ready; opening Cairn Codex services.')",
  "src/main/ipc/domain-error-transport.ts::known('live-transfers.adapter-missing', 'The native live adapter is missing. Repair or reinstall Cairn Codex, then review Windows Security Protection history.', /live adapter is incomplete: missing .*Protection history/i),",
  "src/renderer/src/App.vue::'Enable the Cairn Codex live adapter for this Grim Dawn session? Item Assistant must remain closed while CC owns the game hook.'",
  'src/renderer/src/App.vue::<h1>Cairn Codex</h1>',
  "src/renderer/src/App.vue::<strong>{{ appInitializing && !snapshot ? 'Opening Cairn Codex' : activeBackgroundJob?.progress.label }}</strong>",
  'src/renderer/src/workspaces/SettingsWorkspace.vue::<section class="settings-workspace" aria-label="Cairn Codex settings">',
  'src/helper/CairnCodex.GrimDawn/LiveGameAdapter.cs::"Close Grim Dawn Item Assistant before enabling Cairn Codex live mode.");',
  'src/helper/CairnCodex.GrimDawn/LiveGameAdapter.cs::0, WindowClassName, "Cairn Codex live host", 0,',
  'src/helper/CairnCodex.GrimDawn/LiveGameAdapter.cs::? $"User-approved exact Grim Dawn build {knownVersion} with verified Cairn Codex hook {hookVersion}."',
  'src/helper/CairnCodex.GrimDawn/LiveGameAdapter.cs::: $"Verified Cairn Codex hook {hookVersion} for Grim Dawn {knownVersion}.",',
  'src/helper/CairnCodex.GrimDawn/LiveGameAdapter.cs::"Update Cairn Codex after a Grim Dawn patch. Until then, use Offline staging; do not bypass the compatibility check.");',
  'src/helper/CairnCodex.GrimDawn/LiveGameAdapter.cs::"the Cairn Codex live adapter. Re-run the Cairn Codex installer, or run the bundled " +',
  'src/helper/CairnCodex.GrimDawn/LiveGameAdapter.cs::$"The bundled Cairn Codex live adapter is incomplete: missing {string.Join(" and ", missing)}. " +',
  'src/helper/CairnCodex.GrimDawn/LiveGameAdapter.cs::"Repair or reinstall Cairn Codex from its trusted release source, then review Windows Security > " +',
  'src/helper/CairnCodex.GrimDawn/Gdia/Stash/Stash.cs::throw new InvalidOperationException("Account component and potion stores are read-only in Cairn Codex.");'
])

const allowedCairnLines = new Set([...allowedLoreLines, ...allowedProductNameLines])

const requiredProductNameContexts = [
  ['src/renderer/index.html', '<title>Cairn Codex</title>'],
  ['src/renderer/src/App.vue', '<h1>Cairn Codex</h1>'],
  ['src/renderer/src/components/OnboardingDialog.vue', 'Welcome to Cairn Codex'],
  ['src/main/bootstrap.ts', "title: 'Export Cairn Codex preferences'"]
]

const requiredCompactSubjectContexts = [
  ['src/renderer/src/components/OnboardingDialog.vue', 'CC automatically checks'],
  ['src/renderer/src/components/OnboardingDialog.vue', 'CC rotates archive snapshots'],
  ['src/renderer/src/App.vue', 'new to CC'],
  ['src/main/bootstrap.ts', 'CC will verify this backup']
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
const cairnLines = new Set()

for (const path of files) {
  const source = await readFile(path, 'utf8')
  const repositoryPath = relative(repositoryRoot, path).replaceAll('\\', '/')
  contents.set(repositoryPath, source)
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/\bCairn\b/u.test(trimmed)) cairnLines.add(`${repositoryPath}::${trimmed}`)
  }
}

const unexpected = [...cairnLines].filter((entry) => !allowedCairnLines.has(entry))
const missingAllowances = [...allowedCairnLines].filter((entry) => !cairnLines.has(entry))
if (unexpected.length || missingAllowances.length) {
  const details = [
    ...unexpected.map((entry) => `Unapproved Cairn context: ${entry}`),
    ...missingAllowances.map((entry) => `Missing approved Cairn context: ${entry}`)
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
  explicitProductNameAllowances: allowedProductNameLines.size,
  productNameContexts: requiredProductNameContexts.length,
  compactSubjectContexts: requiredCompactSubjectContexts.length
}, null, 2))
