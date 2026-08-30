import { createHash, randomUUID } from 'node:crypto'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { basename, join } from 'node:path'
import type {
  ArchiveBackupEntry,
  ArchiveBackupStatus
} from '@shared/contracts'
import {
  checkpointClosedCollectionDatabase,
  validateCollectionDatabase,
  type CollectionDatabase,
  type ValidatedCollectionDatabase
} from './collection-database'

const MANIFEST_VERSION = 1
const PENDING_RESTORE_FILE = 'pending-restore.json'

interface ArchiveBackupManifest extends ArchiveBackupEntry {
  manifestVersion: number
}

interface PendingRestore {
  sourcePath: string
  sourceSha256: string
  requestedAtUtc: string
}

function safeStamp(value = new Date()): string {
  return value.toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z')
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function readManifest(path: string): Promise<ArchiveBackupManifest | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as ArchiveBackupManifest
    if (
      parsed.manifestVersion !== MANIFEST_VERSION ||
      !parsed.id ||
      !parsed.fileName ||
      !parsed.createdAtUtc ||
      !parsed.sha256
    ) return null
    return parsed
  } catch {
    return null
  }
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export class ArchiveBackupService {
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly database: CollectionDatabase,
    private readonly databasePath: string,
    private readonly backupDirectory: string,
    private readonly retention = 12
  ) {}

  static async applyPendingRestore(
    databasePath: string,
    backupDirectory: string
  ): Promise<boolean> {
    const pendingPath = join(backupDirectory, PENDING_RESTORE_FILE)
    if (!(await exists(pendingPath))) return false
    const pending = JSON.parse(await readFile(pendingPath, 'utf8')) as PendingRestore
    const selected = validateCollectionDatabase(pending.sourcePath)
    const selectedHash = await sha256File(pending.sourcePath)
    if (selectedHash !== pending.sourceSha256) {
      throw new Error('The staged archive restore changed after it was selected. Restore was canceled.')
    }

    await mkdir(backupDirectory, { recursive: true })
    if (await exists(databasePath)) {
      checkpointClosedCollectionDatabase(databasePath)
      await ArchiveBackupService.publishCopiedBackup(
        databasePath,
        backupDirectory,
        'pre-restore emergency backup'
      )
    }

    const replacement = `${databasePath}.restore-new-${randomUUID()}`
    const displaced = `${databasePath}.restore-old-${randomUUID()}`
    await copyFile(pending.sourcePath, replacement)
    const replacementInfo = validateCollectionDatabase(replacement)
    if (
      replacementInfo.schemaVersion !== selected.schemaVersion ||
      replacementInfo.vaultItemCount !== selected.vaultItemCount
    ) {
      await removeIfPresent(replacement)
      throw new Error('The staged archive failed verification after copying. Restore was canceled.')
    }

    let displacedExisting = false
    let replacementInstalled = false
    try {
      if (await exists(databasePath)) {
        await rename(databasePath, displaced)
        displacedExisting = true
      }
      await removeIfPresent(`${databasePath}-wal`)
      await removeIfPresent(`${databasePath}-shm`)
      await rename(replacement, databasePath)
      replacementInstalled = true
      validateCollectionDatabase(databasePath)
      if (displacedExisting) await removeIfPresent(displaced)
      await removeIfPresent(pendingPath)
      return true
    } catch (error) {
      await removeIfPresent(replacement)
      if (replacementInstalled) await removeIfPresent(databasePath)
      if (displacedExisting && !(await exists(databasePath))) {
        await rename(displaced, databasePath)
      }
      throw error
    }
  }

  static async quarantinePendingRestore(backupDirectory: string): Promise<string | null> {
    const pendingPath = join(backupDirectory, PENDING_RESTORE_FILE)
    if (!(await exists(pendingPath))) return null
    await mkdir(backupDirectory, { recursive: true })
    const failedPath = join(
      backupDirectory,
      `failed-restore-${safeStamp()}-${randomUUID().slice(0, 8)}.json`
    )
    await rename(pendingPath, failedPath)
    return failedPath
  }

  async ensureStartupBackup(): Promise<ArchiveBackupEntry | null> {
    const status = await this.getStatus()
    const latestAge = status.latest
      ? Date.now() - Date.parse(status.latest.createdAtUtc)
      : Number.POSITIVE_INFINITY
    if (latestAge < 24 * 60 * 60 * 1000) return null
    return this.createBackup('automatic daily backup')
  }

  createBackup(reason: string): Promise<ArchiveBackupEntry> {
    return this.serialize(async () => {
      this.database.checkpointForArchiveBackup()
      return ArchiveBackupService.publishCopiedBackup(
        this.databasePath,
        this.backupDirectory,
        reason,
        this.retention
      )
    })
  }

  async exportBackup(destinationPath: string): Promise<ArchiveBackupEntry> {
    const backup = await this.createBackup('manual export')
    await copyFile(join(this.backupDirectory, backup.fileName), destinationPath)
    const copiedHash = await sha256File(destinationPath)
    if (copiedHash !== backup.sha256) {
      await removeIfPresent(destinationPath)
      throw new Error('The exported archive did not match its verified source and was removed.')
    }
    return backup
  }

  async stageRestore(sourcePath: string): Promise<ArchiveBackupEntry> {
    return this.serialize(async () => {
      const entry = await ArchiveBackupService.publishCopiedBackup(
        sourcePath,
        this.backupDirectory,
        'imported restore point',
        this.retention
      )
      const pending: PendingRestore = {
        sourcePath: join(this.backupDirectory, entry.fileName),
        sourceSha256: entry.sha256,
        requestedAtUtc: new Date().toISOString()
      }
      const temporary = join(this.backupDirectory, `${PENDING_RESTORE_FILE}.${randomUUID()}.tmp`)
      await writeFile(temporary, `${JSON.stringify(pending, null, 2)}\n`, 'utf8')
      const pendingPath = join(this.backupDirectory, PENDING_RESTORE_FILE)
      await removeIfPresent(pendingPath)
      await rename(temporary, pendingPath)
      return entry
    })
  }

  async getStatus(): Promise<ArchiveBackupStatus> {
    await mkdir(this.backupDirectory, { recursive: true })
    const files = await readdir(this.backupDirectory)
    const manifests = await Promise.all(
      files.filter((file) => file.endsWith('.json') && file !== PENDING_RESTORE_FILE)
        .map((file) => readManifest(join(this.backupDirectory, file)))
    )
    const backups = manifests
      .filter((entry): entry is ArchiveBackupManifest => Boolean(entry))
      .filter((entry) => files.includes(entry.fileName))
      .sort((left, right) => right.createdAtUtc.localeCompare(left.createdAtUtc))
    return {
      backupDirectory: this.backupDirectory,
      backups,
      latest: backups[0] ?? null,
      pendingRestore: await exists(join(this.backupDirectory, PENDING_RESTORE_FILE))
    }
  }

  async flush(): Promise<void> {
    await this.queue
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  private static async publishCopiedBackup(
    sourcePath: string,
    backupDirectory: string,
    reason: string,
    retention = 12
  ): Promise<ArchiveBackupEntry> {
    await mkdir(backupDirectory, { recursive: true })
    const id = `${safeStamp()}-${randomUUID().slice(0, 8)}`
    const fileName = `cairn-codex-${id}.sqlite3`
    const finalPath = join(backupDirectory, fileName)
    const temporaryPath = `${finalPath}.tmp`
    await copyFile(sourcePath, temporaryPath)
    try {
      const validation: ValidatedCollectionDatabase = validateCollectionDatabase(temporaryPath)
      const details = await stat(temporaryPath)
      const entry: ArchiveBackupManifest = {
        manifestVersion: MANIFEST_VERSION,
        id,
        fileName,
        createdAtUtc: new Date().toISOString(),
        reason,
        sha256: await sha256File(temporaryPath),
        sizeBytes: details.size,
        schemaVersion: validation.schemaVersion,
        vaultItemCount: validation.vaultItemCount,
        verified: true
      }
      await rename(temporaryPath, finalPath)
      const manifestPath = join(backupDirectory, `${basename(fileName, '.sqlite3')}.json`)
      const temporaryManifest = `${manifestPath}.tmp`
      await writeFile(temporaryManifest, `${JSON.stringify(entry, null, 2)}\n`, 'utf8')
      await rename(temporaryManifest, manifestPath)
      await ArchiveBackupService.prune(backupDirectory, retention)
      return entry
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw error
    }
  }

  private static async prune(directory: string, retention: number): Promise<void> {
    const files = await readdir(directory)
    const manifests = (await Promise.all(
      files.filter((file) => file.endsWith('.json') && file !== PENDING_RESTORE_FILE)
        .map(async (file) => ({ file, entry: await readManifest(join(directory, file)) }))
    )).filter((value): value is { file: string; entry: ArchiveBackupManifest } => Boolean(value.entry))
      .sort((left, right) => right.entry.createdAtUtc.localeCompare(left.entry.createdAtUtc))
    const regular = manifests.filter(({ entry }) => !entry.reason.includes('emergency'))
    const emergency = manifests.filter(({ entry }) => entry.reason.includes('emergency'))
    for (const { file, entry } of [...regular.slice(retention), ...emergency.slice(3)]) {
      await removeIfPresent(join(directory, entry.fileName))
      await removeIfPresent(join(directory, file))
    }
  }
}
