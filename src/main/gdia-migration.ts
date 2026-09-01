import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { GdiaImportPreflight, GdiaImportStage } from '@shared/contracts'
import type { CollectionDatabase, VaultImportResult } from './collection-database'
import { inspectGdiaBackup, prepareGdiaBackup } from './gdia-backup'

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
  if ((await hashFile(sourcePath)) !== backup.sourceSha256) {
    throw new Error('The Item Assistant database changed during preflight; close Item Assistant and analyze it again.')
  }
  const queueItems = await inspectPendingQueueItems(sourcePath, new Date().toISOString())
  const baseRecords = [...databaseRows.map((row) => row.baserecord), ...queueItems.map((item) => item.baseRecord)]
  const sourceHardcoreItems = databaseRows.filter((row) => row.IsHardcore === 1).length +
    queueItems.filter((item) => item.isHardcore).length
  const sourceItems = databaseRows.length + queueItems.length
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
      requiredFreeBytes: backup.requiredFreeBytes,
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
    const importedAtUtc = new Date().toISOString()
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
    const pendingQueueItems = await inspectPendingQueueItems(sourcePath, importedAtUtc)
    if (
      options.expectedQueueFingerprint !== undefined &&
      pendingQueueFingerprint(pendingQueueItems) !== options.expectedQueueFingerprint
    ) {
      throw new Error('The Item Assistant pending queue changed after preflight; analyze it again before importing.')
    }
    const queueItems = await preservePendingQueueItems(pendingQueueItems, backupDirectory)
    const items = [...databaseItems, ...queueItems]
    const sourceHardcoreItems = items.filter((item) => item.isHardcore).length
    if (options.requireHardcoreOnly && sourceHardcoreItems !== items.length) {
      throw new Error(
        `Expected a Hardcore-only GDIA migration, but found ${items.length - sourceHardcoreItems} Softcore item(s).`
      )
    }
    options.onStage?.('importing')
    const result = database.importVaultItems({
      sourcePath,
      sourceSha256,
      backupPath,
      importedAtUtc,
      requireAllSupported: options.requireAllCatalogued,
      items
    })
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
  backupDirectory: string
) {
  const receiptDirectory = join(backupDirectory, 'queue-receipts')
  await mkdir(receiptDirectory, { recursive: true })
  return Promise.all(items.map(async ({ name, bytes, ...item }) => {
    const backupPath = join(receiptDirectory, `${item.sourceSha256}.${name}`)
    try {
      if ((await hashFile(backupPath)) === item.sourceSha256) return { ...item, backupPath }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const temporaryPath = `${backupPath}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, bytes)
      if ((await hashFile(temporaryPath)) !== item.sourceSha256) {
        throw new Error(`GDIA queue receipt backup failed verification: ${name}`)
      }
      await rename(temporaryPath, backupPath)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
    if ((await hashFile(backupPath)) !== item.sourceSha256) {
      throw new Error(`GDIA queue receipt backup failed verification: ${name}`)
    }
    return { ...item, backupPath }
  }))
}

function pendingQueueFingerprint(items: PendingQueueItem[]): string {
  const hash = createHash('sha256')
  for (const item of items) hash.update(`${item.name}\0${item.sourceSha256}\0`)
  return hash.digest('hex')
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
