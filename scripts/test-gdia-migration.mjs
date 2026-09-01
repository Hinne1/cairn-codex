import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { CollectionDatabase } from '../src/main/collection-database.ts'
import { analyzeGdiaDatabase, migrateGdiaDatabase } from '../src/main/gdia-migration.ts'

const rawArguments = process.argv.slice(2)
const options = parseOptions(rawArguments)
const requestedItems = positiveInteger(options.items ?? '4', '--items')
const projectRoot = resolve(import.meta.dirname, '..')
const baseDatabasePath = options['base-db'] ? resolve(options['base-db']) : null
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
if (baseDatabasePath) await copyFile(baseDatabasePath, targetDatabasePath)
else initializeTargetDatabase()

const target = new DatabaseSync(targetDatabasePath)
if (!baseDatabasePath) seedCatalog(target)
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
const queuePath = join(queueDirectory, 'pending-test.csv')
const queueBytes = Buffer.from(queueFields.join(';') + '\r\n', 'utf8')
await writeFile(queuePath, queueBytes)
const queueHash = createHash('sha256').update(queueBytes).digest('hex')
const sourceHash = await sha256(sourceDatabasePath)

const firstStarted = performance.now()
const firstRun = await runImport()
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
assertPreflight(firstRun, false)
await assertQueueReceipt(first.queueReceiptPath)
const orphanBatchPath = join(backupDirectory, 'queue-receipts', 'a'.repeat(64))
await mkdir(orphanBatchPath, { recursive: true })
await writeFile(join(orphanBatchPath, 'orphan.csv'), 'uncommitted receipt')

const repeatStarted = performance.now()
const repeatRun = await runImport()
const repeatDurationMs = Math.round(performance.now() - repeatStarted)
const repeated = inspectTarget()
if (repeated.vault !== first.vault || repeated.journal !== first.journal) {
  throw new Error('Repeated migration created duplicate vault items or journals.')
}
assertPreflight(repeatRun, true)
if (await exists(orphanBatchPath)) {
  throw new Error('The unchanged repeat did not reconcile an unreferenced queue receipt batch.')
}
if (repeated.queueReceiptPath !== first.queueReceiptPath) {
  throw new Error('The unchanged repeat did not reuse the verified queue receipt batch.')
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
await writeFile(`${sourceDatabasePath}-wal`, 'active WAL state')
let sqliteSidecarRejected = false
try {
  await runImport()
} catch (error) {
  sqliteSidecarRejected = String(error).includes('Close Item Assistant completely')
} finally {
  await rm(`${sourceDatabasePath}-wal`, { force: true })
}
if (!sqliteSidecarRejected) {
  throw new Error('The end-to-end migration accepted a database with unbacked SQLite sidecar state.')
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
  preflightVerified: true,
  namedStagesVerified: true,
  queueReceiptBatchVerified: true,
  orphanReceiptBatchReconciled: true,
  sqliteSidecarRejected: true,
  sourcePreserved: true,
  firstDurationMs,
  repeatDurationMs
}, null, 2))

async function runImport() {
  const database = new CollectionDatabase(targetDatabasePath)
  const stages = []
  try {
    const analysis = await analyzeGdiaDatabase(database, sourceDatabasePath, backupDirectory)
    const result = await migrateGdiaDatabase(database, sourceDatabasePath, backupDirectory, {
      requireAllCatalogued: false,
      expectedSourceSha256: analysis.preflight.sourceSha256,
      expectedQueueFingerprint: analysis.queueFingerprint,
      expectedRequiredFreeBytes: analysis.preflight.requiredFreeBytes,
      onStage: (stage) => stages.push(stage)
    })
    return { migration: 'gdia', preflight: analysis.preflight, stages, ...result }
  } finally {
    database.close()
  }
}

function assertPreflight(run, reused) {
  const preflight = run.preflight
  if (!preflight) throw new Error('Packaged migration omitted its preflight result.')
  if (
    preflight.sourceItems !== requestedItems + 1 ||
    preflight.sourceDatabaseItems !== requestedItems ||
    preflight.sourceQueueItems !== 1 ||
    preflight.sourceHardcoreItems !== expectedHardcore ||
    preflight.sourceSoftcoreItems !== requestedItems + 1 - expectedHardcore ||
    preflight.unsupportedItems !== 1
  ) {
    throw new Error(`Preflight counts did not match the generated source: ${JSON.stringify(preflight)}`)
  }
  if (
    preflight.backupReused !== reused ||
    preflight.sourceBackupRequiredBytes !== (reused ? 0 : preflight.backupBytes) ||
    preflight.queueReceiptBytes !== queueBytes.length ||
    preflight.archiveGrowthReserveBytes !== preflight.sourceItems * 4096 ||
    preflight.archiveBackupReserveBytes < preflight.archiveGrowthReserveBytes ||
    preflight.requiredFreeBytes !== (
      preflight.sourceBackupRequiredBytes +
      preflight.queueReceiptBytes +
      preflight.archiveGrowthReserveBytes +
      preflight.archiveBackupReserveBytes +
      128 * 1024
    ) ||
    preflight.availableFreeBytes < preflight.requiredFreeBytes ||
    !preflight.destinationMode.includes('Softcore and Hardcore kept separate')
  ) {
    throw new Error(`Preflight backup or destination details were incorrect: ${JSON.stringify(preflight)}`)
  }
  const expectedStages = ['verifying', 'backing-up', 'reading', 'importing', 'finalizing']
  if (JSON.stringify(run.stages) !== JSON.stringify(expectedStages)) {
    throw new Error(`Named migration stages were incomplete or unbounded: ${JSON.stringify(run.stages)}`)
  }
  if (run.backupReused !== reused) {
    throw new Error(`Migration backup reuse result did not match preflight: ${JSON.stringify(run)}`)
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
    const queueReceipt = database.prepare(`
      SELECT backup_path FROM operation_journal WHERE stash_path = ?
    `).get(queuePath)
    return {
      vault: count(database, 'vault_item'),
      journal: count(database, 'operation_journal'),
      softcore: Number(modes.find((row) => Number(row.hardcore) === 0)?.count ?? 0),
      hardcore: Number(modes.find((row) => Number(row.hardcore) === 1)?.count ?? 0),
      queue: Number(database.prepare("SELECT COUNT(*) AS count FROM vault_item WHERE CAST(serialized_item AS TEXT) LIKE '%3200000000%'").get().count),
      queueReceiptPath: String(queueReceipt?.backup_path ?? '')
    }
  } finally {
    database.close()
  }
}

async function assertQueueReceipt(path) {
  if (!path || await sha256(path) !== queueHash) {
    throw new Error('The imported queue item did not retain an exact verified receipt.')
  }
  const manifest = JSON.parse(await readFile(join(dirname(path), 'batch.json'), 'utf8'))
  const expectedFingerprint = createHash('sha256')
    .update(`pending-test.csv\0${queueHash}\0`)
    .digest('hex')
  if (
    manifest.fingerprint !== expectedFingerprint ||
    manifest.files?.[0]?.sha256 !== queueHash ||
    manifest.files?.[0]?.bytes !== queueBytes.length
  ) {
    throw new Error('The queue receipt batch manifest did not verify its complete source set.')
  }
}

function initializeTargetDatabase() {
  const initialized = new CollectionDatabase(targetDatabasePath)
  initialized.close()
}

function seedCatalog(database) {
  const insertCatalog = database.prepare(`
    INSERT INTO catalog_item (
      record, name, rarity, item_class, slot, level_requirement, item_level,
      set_name, set_record, bitmap, content_pack, updated_at_utc
    ) VALUES (?, ?, 'legendary', 'Weapon', 'one-handed', 1, 1, NULL, NULL, NULL, 'base', ?)
  `)
  for (let index = 0; index < 4; index += 1) {
    insertCatalog.run(
      `records/cairn-test/importable-${index}.dbr`,
      `Generated import item ${index}`,
      '2026-09-01T00:00:00.000Z'
    )
  }
}

function count(database, table) {
  return Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)
}

async function sha256(path) {
  const bytes = await import('node:fs/promises').then(({ readFile }) => readFile(path))
  return createHash('sha256').update(bytes).digest('hex')
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

function parseOptions(args) {
  const result = {}
  for (let index = 0; index < args.length; index += 2) result[args[index].replace(/^--/, '')] = args[index + 1]
  return result
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
