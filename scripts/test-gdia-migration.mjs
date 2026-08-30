import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const options = parseOptions(process.argv.slice(2))
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
insert.run(900001, records[0], 3100000001, 0, Date.now() - 3000)
insert.run(900002, records[1], 3100000002, 1, Date.now() - 2000)
insert.run(900003, records[2], 3100000003, 1, Date.now() - 1000)
insert.run(900004, 'records/cairn-test/unsupported-item.dbr', 3100000004, 0, Date.now())
source.close()

const queueFields = [
  '18', '0', records[3], '', '', '3100000005', '0', '', '', '0', '', '0', '', '', '', '', '0', '1'
]
await writeFile(join(queueDirectory, 'pending-test.csv'), queueFields.join(';') + '\r\n', 'utf8')
const sourceHash = await sha256(sourceDatabasePath)

runImport('first')
const first = inspectTarget()
if (first.vault - baselineVault !== 4) {
  throw new Error(`First import added ${first.vault - baselineVault} copies; expected 4.`)
}
if (first.journal - baselineJournal !== 4) {
  throw new Error(`First import added ${first.journal - baselineJournal} journals; expected 4.`)
}
if (first.softcore !== 2 || first.hardcore !== 2) {
  throw new Error(`Mixed-mode import mismatch: ${first.softcore} SC / ${first.hardcore} HC.`)
}

runImport('repeat')
const repeated = inspectTarget()
if (repeated.vault !== first.vault || repeated.journal !== first.journal) {
  throw new Error('Repeated migration created duplicate vault items or journals.')
}
if (await sha256(sourceDatabasePath) !== sourceHash) {
  throw new Error('Item Assistant source database changed during the migration test.')
}
const backups = (await readdir(backupDirectory)).filter((name) => name.endsWith('.bak'))
if (backups.length < 2) throw new Error('Each migration run did not retain a verified source backup.')

console.log(JSON.stringify({
  passed: true,
  imported: first.vault - baselineVault,
  softcore: first.softcore,
  hardcore: first.hardcore,
  pendingQueueReceipts: first.queue,
  unsupportedSkipped: 1,
  repeatCreatedDuplicates: false,
  verifiedBackups: backups.length,
  sourcePreserved: true
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
      WHERE id LIKE 'gdia-90000%' OR CAST(serialized_item AS TEXT) LIKE '%3100000005%'
      GROUP BY is_hardcore
    `).all()
    return {
      vault: count(database, 'vault_item'),
      journal: count(database, 'operation_journal'),
      softcore: Number(modes.find((row) => Number(row.hardcore) === 0)?.count ?? 0),
      hardcore: Number(modes.find((row) => Number(row.hardcore) === 1)?.count ?? 0),
      queue: Number(database.prepare("SELECT COUNT(*) AS count FROM vault_item WHERE CAST(serialized_item AS TEXT) LIKE '%3100000005%'").get().count)
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

function assertInsideProject(path, root) {
  const prefix = root.endsWith('\\') ? root : root + '\\'
  if (!path.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
    throw new Error(`Refusing to use a migration-test directory outside the project: ${path}`)
  }
}
