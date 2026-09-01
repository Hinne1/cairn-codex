import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { CollectionDatabase, VaultImportResult } from './collection-database'
import { prepareGdiaBackup } from './gdia-backup'

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

export async function migrateGdiaDatabase(
  database: CollectionDatabase,
  sourcePath: string,
  backupDirectory: string,
  options: { requireHardcoreOnly?: boolean; requireAllCatalogued?: boolean } = {}
): Promise<GdiaMigrationResult> {
  const backup = await prepareGdiaBackup(sourcePath, backupDirectory)
  const { backupPath, sourceSha256 } = backup

  // Import from the verified immutable copy, never from GDIA's live database.
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
    const queueItems = await readPendingQueueItems(sourcePath, backupDirectory, importedAtUtc)
    const items = [...databaseItems, ...queueItems]
    const sourceHardcoreItems = items.filter((item) => item.isHardcore).length
    if (options.requireHardcoreOnly && sourceHardcoreItems !== items.length) {
      throw new Error(
        `Expected a Hardcore-only GDIA migration, but found ${items.length - sourceHardcoreItems} Softcore item(s).`
      )
    }
    const result = database.importVaultItems({
      sourcePath,
      sourceSha256,
      backupPath,
      importedAtUtc,
      requireAllSupported: options.requireAllCatalogued,
      items
    })
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

async function readPendingQueueItems(
  sourceDatabasePath: string,
  backupDirectory: string,
  fallbackCreatedAtUtc: string
) {
  const incomingDirectory = join(dirname(dirname(sourceDatabasePath)), 'itemqueue', 'ingoing')
  let names: string[]
  try {
    names = (await readdir(incomingDirectory)).filter((name) => name.toLowerCase().endsWith('.csv')).sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const receiptDirectory = join(backupDirectory, 'queue-receipts')
  await mkdir(receiptDirectory, { recursive: true })
  return Promise.all(
    names.map(async (name) => {
      const sourcePath = join(incomingDirectory, name)
      const bytes = await readFile(sourcePath)
      const sourceSha256 = createHash('sha256').update(bytes).digest('hex')
      const backupPath = join(receiptDirectory, `${sourceSha256}.${name}`)
      await copyFile(sourcePath, backupPath)
      if ((await hashFile(backupPath)) !== sourceSha256) {
        throw new Error(`GDIA queue receipt backup failed verification: ${name}`)
      }
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
        externalId: `queue-${sourceSha256.slice(0, 16)}`,
        baseRecord: fields[2].trim(),
        isHardcore: fields[1] === '1',
        createdAtUtc: Number.isNaN(metadata.birthtime.valueOf())
          ? fallbackCreatedAtUtc
          : metadata.birthtime.toISOString(),
        sourcePath,
        sourceSha256,
        backupPath,
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
