import { createHash } from 'node:crypto'
import type {
  ArchiveBackupActionResult,
  ArchiveBackupEntry,
  ArchiveBackupStatus
} from '../../shared/contracts.ts'

export interface BackupStore {
  getStatus(): Promise<ArchiveBackupStatus>
  createBackup(reason: string): Promise<ArchiveBackupEntry>
  exportBackup(path: string): Promise<ArchiveBackupEntry>
  stageRestore(path: string): Promise<ArchiveBackupEntry>
}

export interface BackupServiceDependencies {
  store: BackupStore
  unresolvedTransferCount(): number
  selectExportPath(): Promise<string | null>
  selectRestorePath(defaultDirectory: string): Promise<string | null>
  confirmRestore(): Promise<boolean>
  runBackup(
    dedupeKey: string,
    reason: string,
    operation: () => Promise<ArchiveBackupEntry>
  ): Promise<ArchiveBackupEntry>
  runExclusive<T>(operation: () => Promise<T>): Promise<T>
  scheduleRestart(): void
  openPath(path: string): Promise<string>
}

const canceledResult = (): ArchiveBackupActionResult => ({
  canceled: true,
  backup: null,
  path: null,
  restarting: false
})

export class BackupService {
  private readonly dependencies: BackupServiceDependencies

  constructor(dependencies: BackupServiceDependencies) {
    this.dependencies = dependencies
  }

  getStatus(): Promise<ArchiveBackupStatus> {
    return this.dependencies.store.getStatus()
  }

  async create(): Promise<ArchiveBackupActionResult> {
    const backup = await this.dependencies.runBackup(
      'archive-backup:create',
      'manual backup',
      () => this.dependencies.runExclusive(() => this.dependencies.store.createBackup('manual backup'))
    )
    return { canceled: false, backup, path: null, restarting: false }
  }

  async export(): Promise<ArchiveBackupActionResult> {
    const path = await this.dependencies.selectExportPath()
    if (!path) return canceledResult()
    const key = createHash('sha256').update(path).digest('hex').slice(0, 16)
    const backup = await this.dependencies.runBackup(
      `archive-backup:export:${key}`,
      'manual export',
      () => this.dependencies.runExclusive(() => this.dependencies.store.exportBackup(path))
    )
    return { canceled: false, backup, path, restarting: false }
  }

  async restore(): Promise<ArchiveBackupActionResult> {
    const unresolved = this.dependencies.unresolvedTransferCount()
    if (unresolved > 0) {
      throw new Error(
        `${unresolved} transfer operation${unresolved === 1 ? '' : 's'} require recovery attention. ` +
        'Resolve or audit them before restoring the archive.'
      )
    }
    const status = await this.dependencies.store.getStatus()
    const path = await this.dependencies.selectRestorePath(status.backupDirectory)
    if (!path || !(await this.dependencies.confirmRestore())) return canceledResult()
    const key = createHash('sha256').update(path).digest('hex').slice(0, 16)
    const backup = await this.dependencies.runBackup(
      `archive-backup:restore:${key}`,
      'stage archive restore',
      () => this.dependencies.runExclusive(() => this.dependencies.store.stageRestore(path))
    )
    this.dependencies.scheduleRestart()
    return { canceled: false, backup, path, restarting: true }
  }

  async openDirectory(): Promise<string> {
    return this.dependencies.openPath((await this.dependencies.store.getStatus()).backupDirectory)
  }
}
