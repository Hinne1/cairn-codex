import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { GdiaImportResult } from '@shared/contracts'

const RECEIPT_VERSION = 1
const RECEIPT_NAME = 'last-import.json'

interface StoredReceipt {
  receiptVersion: number
  result: GdiaImportResult
}

export async function readLastGdiaImportResult(
  backupDirectory: string
): Promise<GdiaImportResult | null> {
  try {
    const stored = JSON.parse(
      await readFile(join(backupDirectory, RECEIPT_NAME), 'utf8')
    ) as StoredReceipt
    return stored.receiptVersion === RECEIPT_VERSION && validResult(stored.result)
      ? stored.result
      : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

export async function writeLastGdiaImportResult(
  backupDirectory: string,
  result: GdiaImportResult
): Promise<void> {
  if (!validResult(result) || result.canceled) throw new Error('Refusing to persist an invalid Item Assistant import receipt.')
  await mkdir(backupDirectory, { recursive: true })
  const path = join(backupDirectory, RECEIPT_NAME)
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  const stored: StoredReceipt = { receiptVersion: RECEIPT_VERSION, result }
  let temporary = null as Awaited<ReturnType<typeof open>> | null
  try {
    temporary = await open(temporaryPath, 'wx')
    await temporary.writeFile(`${JSON.stringify(stored, null, 2)}\n`, 'utf8')
    await temporary.sync()
    await temporary.close()
    temporary = null
    await rename(temporaryPath, path)
    const published = await open(path, 'r+')
    try {
      await published.sync()
    } finally {
      await published.close()
    }
    await syncDirectory(backupDirectory)
  } catch (error) {
    await temporary?.close().catch(() => undefined)
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const directory = await open(path, 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

function validResult(value: unknown): value is GdiaImportResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<GdiaImportResult>
  const counts = [
    result.sourceItems,
    result.sourceDatabaseItems,
    result.sourceQueueItems,
    result.sourceHardcoreItems,
    result.sourceSoftcoreItems,
    result.importedItems,
    result.duplicateItems,
    result.unsupportedItems,
    result.durationMs
  ]
  return result.canceled === false &&
    typeof result.sourcePath === 'string' &&
    typeof result.backupPath === 'string' &&
    typeof result.backupReused === 'boolean' &&
    result.receiptPersisted === true &&
    typeof result.completedAtUtc === 'string' &&
    Number.isFinite(Date.parse(result.completedAtUtc)) &&
    counts.every((count) => Number.isSafeInteger(count) && Number(count) >= 0)
}
