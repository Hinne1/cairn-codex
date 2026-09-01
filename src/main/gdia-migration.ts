import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { GdiaImportPreflight, GdiaImportStage } from '@shared/contracts'
import type { CollectionDatabase, VaultImportResult } from './collection-database'
import {
  assertNoGdiaSqliteSidecars,
  inspectGdiaBackup,
  prepareGdiaBackup
} from './gdia-backup'

const ARCHIVE_GROWTH_RESERVE_PER_ITEM = 4096
const IMPORT_METADATA_RESERVE_BYTES = 128 * 1024
const QUEUE_RECEIPT_MANIFEST_VERSION = 1

interface GdiaPlayerItemRow {
  Id: number
  baserecord: string
  PrefixRecord: string | null
  SuffixRecord: string | null
  ModifierRecord: string | null
  TransmuteRecord: string | null
  Seed: number
  MateriaRecord: string | null
  RelicCompletionBonusRecord: string | null
  RelicSeed: number | null
  EnchantmentRecord: string | null
  UNKNOWN: number | null
  EnchantmentSeed: number | null
  MateriaCombines: number | null
  StackCount: number | null
  IsHardcore: number
  created_at: number | null
  AscendantAffixNameRecord: string | null
  AscendantAffix2hNameRecord: string | null
  RerollsUsed: number | null
  AffixRerollsUsed: number | null
}

export interface GdiaMigrationResult extends VaultImportResult {
  sourceItems: number
  sourceDatabaseItems: number
  sourceQueueItems: number
  sourceHardcoreItems: number
  sourceSoftcoreItems: number
  sourceSha256: string
  backupPath: string
  backupReused: boolean
}

export interface GdiaMigrationAnalysis {
  preflight: GdiaImportPreflight
  queueFingerprint: string
}

export interface GdiaMigrationOptions {
  requireHardcoreOnly?: boolean
  requireAllCatalogued?: boolean
  expectedSourceSha256?: string
  expectedQueueFingerprint?: string
  expectedRequiredFreeBytes?: number
  onStage?: (stage: Extract<GdiaImportStage, 'verifying' | 'backing-up' | 'reading' | 'importing' | 'finalizing'>) => void
}

interface PendingQueueItem {
  name: string
  bytes: Buffer
  sourcePath: string
  sourceSha256: string
  externalId: string
  baseRecord: string
  isHardcore: boolean
  createdAtUtc: string
  payload: Record<string, unknown>
}

export async function analyzeGdiaDatabase(
  database: CollectionDatabase,
  sourcePath: string,
  backupDirectory: string,
  destinationMode = 'Codex Archive · Softcore and Hardcore kept separate'
): Promise<GdiaMigrationAnalysis> {
  const backup = await inspectGdiaBackup(sourcePath, backupDirectory)
  const source = new DatabaseSync(sourcePath, { readOnly: true })
  let databaseRows: Array<{ baserecord: string; IsHardcore: number }>
  try {
    databaseRows = source.prepare('SELECT baserecord, IsHardcore FROM PlayerItem').all() as unknown as typeof databaseRows
  } finally {
    source.close()
  }
  await assertNoGdiaSqliteSidecars(sourcePath)
  if ((await hashFile(sourcePath)) !== backup.sourceSha256) {
    throw new Error('The Item Assistant database changed during preflight; close Item Assistant and analyze it again.')
  }
  const queueItems = await inspectPendingQueueItems(sourcePath, new Date().toISOString())
  const baseRecords = [...databaseRows.map((row) => row.baserecord), ...queueItems.map((item) => item.baseRecord)]
  const sourceHardcoreItems = databaseRows.filter((row) => row.IsHardcore === 1).length +
    queueItems.filter((item) => item.isHardcore).length
  const sourceItems = databaseRows.length + queueItems.length
  const queueReceiptBytes = safeByteTotal(queueItems.map((item) => item.bytes.length))
  const archiveGrowthReserveBytes = safeByteProduct(sourceItems, ARCHIVE_GROWTH_RESERVE_PER_ITEM)
  const archiveBackupReserveBytes = safeByteTotal([
    database.getStorageFootprintBytes(),
    archiveGrowthReserveBytes
  ])
  const requiredFreeBytes = safeByteTotal([
    backup.requiredFreeBytes,
    queueReceiptBytes,
    archiveGrowthReserveBytes,
    archiveBackupReserveBytes,
    IMPORT_METADATA_RESERVE_BYTES
  ])
  return {
    preflight: {
      sourcePath,
      sourceSha256: backup.sourceSha256,
      sourceItems,
      sourceDatabaseItems: databaseRows.length,
      sourceQueueItems: queueItems.length,
      sourceHardcoreItems,
      sourceSoftcoreItems: sourceItems - sourceHardcoreItems,
      unsupportedItems: database.countUnsupportedVaultItems(baseRecords),
      backupBytes: backup.sourceBytes,
      sourceBackupRequiredBytes: backup.requiredFreeBytes,
      queueReceiptBytes,
      archiveGrowthReserveBytes,
      archiveBackupReserveBytes,
      requiredFreeBytes,
      availableFreeBytes: backup.availableFreeBytes,
      backupReused: backup.backupReused,
      destinationMode
    },
    queueFingerprint: pendingQueueFingerprint(queueItems)
  }
}

export async function migrateGdiaDatabase(
  database: CollectionDatabase,
  sourcePath: string,
  backupDirectory: string,
  options: GdiaMigrationOptions = {}
): Promise<GdiaMigrationResult> {
  options.onStage?.('verifying')
  const verifiedSource = await inspectGdiaBackup(sourcePath, backupDirectory)
  if (
    options.expectedSourceSha256 !== undefined &&
    verifiedSource.sourceSha256 !== options.expectedSourceSha256
  ) {
    throw new Error('The Item Assistant database changed after preflight; analyze it again before importing.')
  }
  if (
    options.expectedRequiredFreeBytes !== undefined &&
    verifiedSource.availableFreeBytes < options.expectedRequiredFreeBytes
  ) {
    throw new Error(
      `Available space dropped below the analyzed import reserve: ` +
      `${options.expectedRequiredFreeBytes.toLocaleString()} bytes required, ` +
      `${verifiedSource.availableFreeBytes.toLocaleString()} bytes available.`
    )
  }
  const importedAtUtc = new Date().toISOString()
  const pendingQueueItems = await inspectPendingQueueItems(sourcePath, importedAtUtc)
  const queueFingerprint = pendingQueueFingerprint(pendingQueueItems)
  if (
    options.expectedQueueFingerprint !== undefined &&
    queueFingerprint !== options.expectedQueueFingerprint
  ) {
    throw new Error('The Item Assistant pending queue changed after preflight; analyze it again before importing.')
  }
  options.onStage?.('backing-up')
  const backup = await prepareGdiaBackup(sourcePath, backupDirectory, {
    expectedSourceSha256: options.expectedSourceSha256
  })
  const { backupPath, sourceSha256 } = backup

  // Import from the verified immutable copy, never from GDIA's live database.
  options.onStage?.('reading')
  const source = new DatabaseSync(backupPath, { readOnly: true })
  try {
    const rows = source
      .prepare(`
        SELECT
          Id, baserecord, PrefixRecord, SuffixRecord, ModifierRecord, TransmuteRecord,
          Seed, MateriaRecord, RelicCompletionBonusRecord, RelicSeed,
          EnchantmentRecord, UNKNOWN, EnchantmentSeed, MateriaCombines, StackCount,
          IsHardcore, created_at, AscendantAffixNameRecord, AscendantAffix2hNameRecord,
          RerollsUsed, AffixRerollsUsed
        FROM PlayerItem
        ORDER BY Id
      `)
      .all() as unknown as GdiaPlayerItemRow[]
    const databaseItems = rows.map((row) => ({
      externalId: String(row.Id),
      baseRecord: row.baserecord,
      isHardcore: row.IsHardcore === 1,
      createdAtUtc: toCreatedAtUtc(row.created_at, importedAtUtc),
      payload: {
        stashVersion: 11,
        sourceTabIndex: -1,
        sourceItemIndex: -1,
        baseRecord: row.baserecord,
        prefixRecord: row.PrefixRecord ?? '',
        suffixRecord: row.SuffixRecord ?? '',
        modifierRecord: row.ModifierRecord ?? '',
        transmuteRecord: row.TransmuteRecord ?? '',
        seed: unsigned(row.Seed),
        materiaRecord: row.MateriaRecord ?? '',
        relicCompletionBonusRecord: row.RelicCompletionBonusRecord ?? '',
        relicSeed: unsigned(row.RelicSeed),
        enchantmentRecord: row.EnchantmentRecord ?? '',
        ascendantRecord: row.AscendantAffixNameRecord ?? '',
        ascendantRecord2H: row.AscendantAffix2hNameRecord ?? '',
        unknown: unsigned(row.UNKNOWN),
        enchantmentSeed: unsigned(row.EnchantmentSeed),
        materiaCombines: unsigned(row.MateriaCombines),
        stackCount: unsigned(row.StackCount) || 1,
        rerolls: unsigned(row.RerollsUsed),
        affixRerolls: unsigned(row.AffixRerollsUsed),
        xOffset: 0,
        yOffset: 0
      }
    }))
    const queueBatch = await preservePendingQueueItems(
      pendingQueueItems,
      backupDirectory,
      queueFingerprint,
      database.getGdiaQueueReceiptBackupPaths()
    )
    const queueItems = queueBatch.items
    const items = [...databaseItems, ...queueItems]
    const sourceHardcoreItems = items.filter((item) => item.isHardcore).length
    if (options.requireHardcoreOnly && sourceHardcoreItems !== items.length) {
      throw new Error(
        `Expected a Hardcore-only GDIA migration, but found ${items.length - sourceHardcoreItems} Softcore item(s).`
      )
    }
    options.onStage?.('importing')
    let result: VaultImportResult
    try {
      result = database.importVaultItems({
        sourcePath,
        sourceSha256,
        backupPath,
        importedAtUtc,
        requireAllSupported: options.requireAllCatalogued,
        items
      })
    } catch (error) {
      if (queueBatch.published) {
        await rm(queueBatch.batchPath, { recursive: true, force: true }).catch(() => undefined)
      }
      throw error
    }
    if (
      queueBatch.published &&
      !batchHasReference(queueBatch.batchPath, database.getGdiaQueueReceiptBackupPaths())
    ) {
      await rm(queueBatch.batchPath, { recursive: true, force: true })
    }
    options.onStage?.('finalizing')
    return {
      ...result,
      sourceItems: items.length,
      sourceDatabaseItems: databaseItems.length,
      sourceQueueItems: queueItems.length,
      sourceHardcoreItems,
      sourceSoftcoreItems: items.length - sourceHardcoreItems,
      sourceSha256,
      backupPath,
      backupReused: backup.reused
    }
  } finally {
    source.close()
  }
}

async function inspectPendingQueueItems(
  sourceDatabasePath: string,
  fallbackCreatedAtUtc: string
): Promise<PendingQueueItem[]> {
  const incomingDirectory = join(dirname(dirname(sourceDatabasePath)), 'itemqueue', 'ingoing')
  let names: string[]
  try {
    names = (await readdir(incomingDirectory)).filter((name) => name.toLowerCase().endsWith('.csv')).sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return Promise.all(
    names.map(async (name) => {
      const sourcePath = join(incomingDirectory, name)
      const bytes = await readFile(sourcePath)
      const sourceSha256 = createHash('sha256').update(bytes).digest('hex')
      const fields = bytes
        .toString('utf8')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/, 1)[0]!
        .split(';')
      if (![17, 18].includes(fields.length) || !fields[2]?.trim()) {
        throw new Error(`Unsupported GDIA queue receipt format: ${name}`)
      }
      const number = (value: string | undefined) => Number.parseInt(value ?? '', 10) >>> 0
      const metadata = await stat(sourcePath)
      return {
        name,
        bytes,
        externalId: `queue-${sourceSha256.slice(0, 16)}`,
        baseRecord: fields[2].trim(),
        isHardcore: fields[1] === '1',
        createdAtUtc: Number.isNaN(metadata.birthtime.valueOf())
          ? fallbackCreatedAtUtc
          : metadata.birthtime.toISOString(),
        sourcePath,
        sourceSha256,
        payload: {
          stashVersion: 11,
          sourceTabIndex: -1,
          sourceItemIndex: -1,
          baseRecord: fields[2].trim(),
          prefixRecord: fields[3]!.trim(),
          suffixRecord: fields[4]!.trim(),
          modifierRecord: fields[7]!.trim(),
          transmuteRecord: fields[13]!.trim(),
          seed: number(fields[5]),
          materiaRecord: fields[8]!.trim(),
          relicCompletionBonusRecord: fields[9]!.trim(),
          relicSeed: number(fields[10]),
          enchantmentRecord: fields[11]!.trim(),
          ascendantRecord: fields[14]!.trim(),
          ascendantRecord2H: fields[15]!.trim(),
          unknown: 0,
          enchantmentSeed: number(fields[12]),
          materiaCombines: 0,
          stackCount: fields.length === 18 ? number(fields[17]) || 1 : 1,
          rerolls: number(fields[6]),
          affixRerolls: number(fields[16]),
          xOffset: 0,
          yOffset: 0
        }
      }
    })
  )
}

async function preservePendingQueueItems(
  items: PendingQueueItem[],
  backupDirectory: string,
  fingerprint: string,
  referencedPaths: string[]
): Promise<{
  items: Array<Omit<PendingQueueItem, 'name' | 'bytes'> & { backupPath: string }>
  batchPath: string
  published: boolean
}> {
  const receiptDirectory = join(backupDirectory, 'queue-receipts')
  const batchPath = join(receiptDirectory, fingerprint)
  await reconcileQueueReceiptBatches(receiptDirectory, referencedPaths, fingerprint)
  if (items.length === 0) return { items: [], batchPath, published: false }
  await mkdir(receiptDirectory, { recursive: true })
  if (await validQueueReceiptBatch(batchPath, fingerprint, items)) {
    return {
      items: items.map(({ name, bytes: _bytes, ...item }) => ({ ...item, backupPath: join(batchPath, name) })),
      batchPath,
      published: false
    }
  }
  await rm(batchPath, { recursive: true, force: true })
  const temporaryPath = join(receiptDirectory, `.${fingerprint}.${randomUUID()}.tmp`)
  try {
    await mkdir(temporaryPath)
    for (const item of items) {
      const path = join(temporaryPath, item.name)
      await writeFile(path, item.bytes)
      if ((await hashFile(path)) !== item.sourceSha256) {
        throw new Error(`GDIA queue receipt backup failed verification: ${item.name}`)
      }
    }
    await writeFile(join(temporaryPath, 'batch.json'), `${JSON.stringify({
      manifestVersion: QUEUE_RECEIPT_MANIFEST_VERSION,
      fingerprint,
      files: items.map((item) => ({ name: item.name, sha256: item.sourceSha256, bytes: item.bytes.length }))
    }, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, batchPath)
  } catch (error) {
    await rm(temporaryPath, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  if (!(await validQueueReceiptBatch(batchPath, fingerprint, items))) {
    await rm(batchPath, { recursive: true, force: true }).catch(() => undefined)
    throw new Error('The Item Assistant queue receipt batch failed publication verification.')
  }
  return {
    items: items.map(({ name, bytes: _bytes, ...item }) => ({ ...item, backupPath: join(batchPath, name) })),
    batchPath,
    published: true
  }
}

async function validQueueReceiptBatch(
  batchPath: string,
  fingerprint: string,
  items: PendingQueueItem[]
): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(join(batchPath, 'batch.json'), 'utf8')) as {
      manifestVersion?: number
      fingerprint?: string
      files?: Array<{ name?: string; sha256?: string; bytes?: number }>
    }
    if (
      manifest.manifestVersion !== QUEUE_RECEIPT_MANIFEST_VERSION ||
      manifest.fingerprint !== fingerprint ||
      manifest.files?.length !== items.length
    ) return false
    for (const item of items) {
      const entry = manifest.files.find((candidate) => candidate.name === item.name)
      if (
        entry?.sha256 !== item.sourceSha256 ||
        entry.bytes !== item.bytes.length ||
        (await hashFile(join(batchPath, item.name))) !== item.sourceSha256
      ) return false
    }
    return true
  } catch {
    return false
  }
}

async function reconcileQueueReceiptBatches(
  receiptDirectory: string,
  referencedPaths: string[],
  currentFingerprint: string
): Promise<void> {
  let entries
  try {
    entries = await readdir(receiptDirectory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    const path = join(receiptDirectory, entry.name)
    if (entry.isDirectory() && /^\.[0-9a-f]{64}\.[0-9a-f-]{36}\.tmp$/i.test(entry.name)) {
      await rm(path, { recursive: true, force: true })
      continue
    }
    if (
      entry.isDirectory() &&
      /^[0-9a-f]{64}$/i.test(entry.name) &&
      entry.name !== currentFingerprint &&
      !batchHasReference(path, referencedPaths)
    ) {
      await rm(path, { recursive: true, force: true })
    }
  }
}

function batchHasReference(batchPath: string, referencedPaths: string[]): boolean {
  const batch = normalizedPath(batchPath)
  return referencedPaths.some((path) => normalizedPath(path).startsWith(`${batch}${sep}`))
}

function normalizedPath(path: string): string {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized
}

function pendingQueueFingerprint(items: PendingQueueItem[]): string {
  const hash = createHash('sha256')
  for (const item of items) hash.update(`${item.name}\0${item.sourceSha256}\0`)
  return hash.digest('hex')
}

function safeByteProduct(left: number, right: number): number {
  const value = left * right
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('The import reserve exceeds safe byte accounting.')
  return value
}

function safeByteTotal(values: number[]): number {
  return values.reduce((total, value) => {
    const next = total + value
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(next)) {
      throw new Error('The import reserve exceeds safe byte accounting.')
    }
    return next
  }, 0)
}

function unsigned(value: number | null): number {
  return Number(value ?? 0) >>> 0
}

function toCreatedAtUtc(value: number | null, fallback: string): string {
  if (!value || !Number.isFinite(value)) return fallback
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? fallback : date.toISOString()
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
