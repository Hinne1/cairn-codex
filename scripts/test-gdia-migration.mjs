import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const options = parseOptions(process.argv.slice(2))
const requestedItems = positiveInteger(options.items ?? '4', '--items')
const projectRoot = resolve(import.meta.dirname, '..')
const appPath = resolveRequired(options.app, '--app')
const baseDatabasePath = resolveRequired(options['base-db'], '--base-db')
const testRoot = join(projectRoot, 'local-cache', 'gdia-migration')
const profileRoot = join(testRoot, 'profile')
const sourceRoot = join(testRoot, 'item-assistant')
const sourceDatabasePath = join(sourceRoot, 'data', 'userdata.db')
const queueDirectory = join(sourceRoot, 'itemqueue', 'ingoing')
const targetDatabasePath = join(testRoot, 'cairn-codex.sqlite3')
const backupDirectory = join(profileRoot, 'migrations', 'gdia')

assertInsideProject(testRoot, projectRoot)
await rm(testRoot, { recursive: true, force: true })
await mkdir(dirname(sourceDatabasePath), { recursive: true })
await mkdir(queueDirectory, { recursive: true })
await mkdir(profileRoot, { recursive: true })
await copyFile(baseDatabasePath, targetDatabasePath)

const target = new DatabaseSync(targetDatabasePath)
const records = target.prepare(`
  SELECT record
  FROM catalog_item
  WHERE rarity IN ('epic', 'legendary', 'mi')
  ORDER BY record
  LIMIT 4
`).all().map((row) => String(row.record))
if (records.length !== 4) throw new Error('The seed Cairn database does not contain four importable catalog records.')
const baselineVault = count(target, 'vault_item')
const baselineJournal = count(target, 'operation_journal')
target.close()

const source = new DatabaseSync(sourceDatabasePath)
source.exec(`
  CREATE TABLE PlayerItem (
    Id INTEGER PRIMARY KEY,
    baserecord TEXT NOT NULL,
    PrefixRecord TEXT,
    SuffixRecord TEXT,
    ModifierRecord TEXT,
    TransmuteRecord TEXT,
    Seed INTEGER NOT NULL,
    MateriaRecord TEXT,
    RelicCompletionBonusRecord TEXT,
    RelicSeed INTEGER,
    EnchantmentRecord TEXT,
    UNKNOWN INTEGER,
    EnchantmentSeed INTEGER,
    MateriaCombines INTEGER,
    StackCount INTEGER,
    IsHardcore INTEGER NOT NULL,
    created_at INTEGER,
    AscendantAffixNameRecord TEXT,
    AscendantAffix2hNameRecord TEXT,
    RerollsUsed INTEGER,
    AffixRerollsUsed INTEGER
  )
`)
const insert = source.prepare(`
  INSERT INTO PlayerItem (
    Id, baserecord, PrefixRecord, SuffixRecord, ModifierRecord, TransmuteRecord,
    Seed, MateriaRecord, RelicCompletionBonusRecord, RelicSeed, EnchantmentRecord,
    UNKNOWN, EnchantmentSeed, MateriaCombines, StackCount, IsHardcore, created_at,
    AscendantAffixNameRecord, AscendantAffix2hNameRecord, RerollsUsed, AffixRerollsUsed
  ) VALUES (?, ?, '', '', '', '', ?, '', '', 0, '', 0, 0, 0, 1, ?, ?, '', '', 0, 0)
`)
const databaseItemCount = requestedItems - 1
source.exec('BEGIN IMMEDIATE')
for (let index = 0; index < databaseItemCount; index += 1) {
  insert.run(
    700000000 + index,
    records[index % records.length],
    3100000000 + index,
    index % 2 === 0 ? 1 : 0,
    Date.now() - (databaseItemCount - index) * 1000
  )
}
insert.run(799999999, 'records/cairn-test/unsupported-item.dbr', 3199999999, 0, Date.now())
source.exec('COMMIT')
source.close()

const queueFields = [
  '18', '0', records[3], '', '', '3200000000', '0', '', '', '0', '', '0', '', '', '', '', '0', '1'
]
await writeFile(join(queueDirectory, 'pending-test.csv'), queueFields.join(';') + '\r\n', 'utf8')
const sourceHash = await sha256(sourceDatabasePath)

const firstStarted = performance.now()
runImport('first')
const firstDurationMs = Math.round(performance.now() - firstStarted)
const first = inspectTarget()
if (first.vault - baselineVault !== requestedItems) {
  throw new Error(`First import added ${first.vault - baselineVault} copies; expected ${requestedItems}.`)
}
if (first.journal - baselineJournal !== requestedItems) {
  throw new Error(`First import added ${first.journal - baselineJournal} journals; expected ${requestedItems}.`)
}
const expectedHardcore = Math.ceil(databaseItemCount / 2)
const expectedSoftcore = Math.floor(databaseItemCount / 2) + 1
if (first.softcore !== expectedSoftcore || first.hardcore !== expectedHardcore) {
  throw new Error(
    `Mixed-mode import mismatch: ${first.softcore} SC / ${first.hardcore} HC; ` +
    `expected ${expectedSoftcore} SC / ${expectedHardcore} HC.`
  )
}

const repeatStarted = performance.now()
runImport('repeat')
const repeatDurationMs = Math.round(performance.now() - repeatStarted)
const repeated = inspectTarget()
if (repeated.vault !== first.vault || repeated.journal !== first.journal) {
  throw new Error('Repeated migration created duplicate vault items or journals.')
}
if (await sha256(sourceDatabasePath) !== sourceHash) {
  throw new Error('Item Assistant source database changed during the migration test.')
}
const backups = (await readdir(backupDirectory)).filter((name) => name.endsWith('.bak'))
if (backups.length !== 1) throw new Error('The unchanged repeat import did not reuse one verified source backup.')
const backupPath = join(backupDirectory, backups[0])
const backupManifest = JSON.parse(await readFile(`${backupPath}.json`, 'utf8'))
if (backupManifest.sourceSha256 !== sourceHash || await sha256(backupPath) !== sourceHash) {
  throw new Error('The retained source backup or manifest failed content verification.')
}

console.log(JSON.stringify({
  passed: true,
  requestedItems,
  imported: first.vault - baselineVault,
  softcore: first.softcore,
  hardcore: first.hardcore,
  pendingQueueReceipts: first.queue,
  unsupportedSkipped: 1,
  repeatCreatedDuplicates: false,
  verifiedBackups: backups.length,
  unchangedBackupReused: true,
  sourcePreserved: true,
  firstDurationMs,
  repeatDurationMs
}, null, 2))

function runImport(label) {
  const result = spawnSync(appPath, [`--user-data-dir=${profileRoot}`], {
    env: {
      ...process.env,
      CAIRN_CODEX_DATABASE_PATH: targetDatabasePath,
      CAIRN_CODEX_IMPORT_GDIA: sourceDatabasePath,
      CAIRN_CODEX_MIGRATION_BACKUP_DIR: backupDirectory,
      CAIRN_CODEX_SCREENSHOT_PATH: join(testRoot, `unused-${label}.png`)
    },
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true
  })
  if (result.status !== 0) {
    throw new Error(`${label} packaged migration failed (${result.status}): ${result.stderr || result.stdout}`)
  }
}

function inspectTarget() {
  const database = new DatabaseSync(targetDatabasePath, { readOnly: true })
  try {
    const modes = database.prepare(`
      SELECT is_hardcore AS hardcore, COUNT(*) AS count
      FROM vault_item
      WHERE (
        id LIKE 'gdia-%'
        AND CAST(substr(id, 6, instr(substr(id, 6), '-') - 1) AS INTEGER)
          BETWEEN 700000000 AND ?
      ) OR CAST(serialized_item AS TEXT) LIKE '%3200000000%'
      GROUP BY is_hardcore
    `).all(700000000 + databaseItemCount - 1)
    return {
      vault: count(database, 'vault_item'),
      journal: count(database, 'operation_journal'),
      softcore: Number(modes.find((row) => Number(row.hardcore) === 0)?.count ?? 0),
      hardcore: Number(modes.find((row) => Number(row.hardcore) === 1)?.count ?? 0),
      queue: Number(database.prepare("SELECT COUNT(*) AS count FROM vault_item WHERE CAST(serialized_item AS TEXT) LIKE '%3200000000%'").get().count)
    }
  } finally {
    database.close()
  }
}

function count(database, table) {
  return Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)
}

async function sha256(path) {
  const bytes = await import('node:fs/promises').then(({ readFile }) => readFile(path))
  return createHash('sha256').update(bytes).digest('hex')
}

function parseOptions(args) {
  const result = {}
  for (let index = 0; index < args.length; index += 2) result[args[index].replace(/^--/, '')] = args[index + 1]
  return result
}

function resolveRequired(value, name) {
  if (!value) throw new Error(`${name} is required.`)
  return resolve(value)
}

function positiveInteger(value, name) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100_000) {
    throw new Error(`${name} must be an integer from 1 to 100000.`)
  }
  return parsed
}

function assertInsideProject(path, root) {
  const prefix = root.endsWith('\\') ? root : root + '\\'
  if (!path.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
    throw new Error(`Refusing to use a migration-test directory outside the project: ${path}`)
  }
}
