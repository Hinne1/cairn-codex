import type {
  ArchiveBackupStatus,
  CollectionSnapshot,
  DiagnosticExportResult,
  LiveGameStatus,
  WriteSafetyStatus
} from '../../shared/contracts.ts'
import {
  diagnosticPrivacyViolations,
  redactDiagnosticValue,
  type DiagnosticLogEntry
} from '../diagnostics.ts'

export interface DiagnosticApplicationSummary {
  version: string
  packaged: boolean
  electron: string
  node: string
  chrome: string
  sha256: string | null
}

export interface DiagnosticExportDependencies {
  nowUtc(): string
  selectOutput(defaultFileName: string): Promise<string | null>
  countFiles(directoryName: string): Promise<number>
  inspectLive(): Promise<LiveGameStatus>
  helperHealth(): Promise<Record<string, unknown>>
  applicationSummary(): Promise<DiagnosticApplicationSummary>
  systemSummary(): Record<string, unknown>
  helperSha256(): Promise<string | null>
  databaseSummary(): unknown
  archiveBackupStatus(): Promise<ArchiveBackupStatus>
  collectionSnapshot(): CollectionSnapshot | null
  inspectWriteSafety(): Promise<WriteSafetyStatus>
  startupStatus(): unknown
  loggingPolicy(): unknown
  readLogs(): Promise<DiagnosticLogEntry[]>
  registerSecret(secret: string | null): void
  write(path: string, contents: string): Promise<void>
  info(event: string, data?: Record<string, unknown>): void
  error(event: string, error: Error): void
}

async function safely<T>(operation: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await operation()
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** Owns support-bundle projection, redaction, privacy validation, and publication. */
export class DiagnosticExportService {
  private readonly dependencies: DiagnosticExportDependencies

  constructor(dependencies: DiagnosticExportDependencies) {
    this.dependencies = dependencies
  }

  async export(): Promise<DiagnosticExportResult> {
    const generatedAtUtc = this.dependencies.nowUtc()
    const fileStamp = generatedAtUtc.replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z')
    const outputPath = await this.dependencies.selectOutput(`cairn-codex-support-${fileStamp}.json`)
    if (!outputPath) return { canceled: true, path: null }

    const directoryCounts: Record<string, number> = {}
    for (const name of ['backups', 'live-receipts', 'live-adapter', 'quarantine']) {
      directoryCounts[name] = await this.dependencies.countFiles(name)
    }
    const live = await safely(() => this.dependencies.inspectLive())
    if (!('error' in live)) this.dependencies.registerSecret(live.activeCharacterName)
    const safeLive = 'error' in live ? live : {
      state: live.state,
      grimDawnProcessCount: live.grimDawnProcessIds.length,
      itemAssistantProcessCount: live.itemAssistantProcessIds.length,
      hookAvailable: live.hookAvailable,
      hookVersion: live.hookVersion,
      connected: live.connectedProcessId !== null,
      activeCharacterPresent: live.activeCharacterName !== null,
      isHardcore: live.isHardcore,
      hostWindowReady: live.hostWindowReady,
      gameVersion: live.gameVersion,
      gameBuildId: live.gameBuildId,
      gameDllSha256: live.gameDllSha256,
      gameDllLastWriteUtc: live.gameDllLastWriteUtc,
      hookSha256: live.hookSha256,
      recommendation: live.recommendation,
      hookMessageCount: live.messages.length
    }
    const backupStatus = await safely(() => this.dependencies.archiveBackupStatus())
    const archiveBackups = 'error' in backupStatus ? backupStatus : {
      retained: backupStatus.backups.length,
      verified: backupStatus.backups.filter((backup) => backup.verified).length,
      pendingRestore: backupStatus.pendingRestore,
      latest: backupStatus.latest ? {
        createdAtUtc: backupStatus.latest.createdAtUtc,
        reason: backupStatus.latest.reason,
        sizeBytes: backupStatus.latest.sizeBytes,
        schemaVersion: backupStatus.latest.schemaVersion,
        vaultItemCount: backupStatus.latest.vaultItemCount,
        verified: backupStatus.latest.verified
      } : null
    }
    const collection = this.dependencies.collectionSnapshot()
    const logs = await this.dependencies.readLogs()
    const report = redactDiagnosticValue({
      generatedAtUtc,
      formatVersion: 1,
      privacy: 'No item payloads, save contents, database contents, character names, personal paths, raw hook messages, credentials, queues, receipts, archives, or extracted game assets are included.',
      app: await this.dependencies.applicationSummary(),
      system: this.dependencies.systemSummary(),
      helper: {
        health: await safely(() => this.dependencies.helperHealth()),
        sha256: await this.dependencies.helperSha256()
      },
      database: this.dependencies.databaseSummary(),
      archiveBackups,
      files: directoryCounts,
      collection: collection ? {
        scannedAtUtc: collection.scannedAtUtc,
        basis: collection.basis,
        warningCount: collection.warnings.length,
        contentPacks: collection.contentPacks.map((pack) => pack.id),
        sourceCount: collection.scannedStashes.length,
        catalogItems: collection.items.length,
        observedItems: collection.observedItems.length
      } : null,
      writeSafety: await safely(() => this.dependencies.inspectWriteSafety()),
      live: safeLive,
      startup: this.dependencies.startupStatus(),
      logging: this.dependencies.loggingPolicy(),
      jobTimings: logs
        .filter((entry) => entry.durationMs !== undefined)
        .slice(-100)
        .map(({ timestampUtc, scope, event, correlationId, durationMs }) => ({
          timestampUtc, scope, event, correlationId, durationMs
        })),
      lastSafeActions: logs
        .filter((entry) => entry.event.endsWith('.completed'))
        .slice(-25)
        .map(({ timestampUtc, scope, event, correlationId, durationMs }) => ({
          timestampUtc, scope, event, correlationId, durationMs
        })),
      logs
    })
    const serialized = `${JSON.stringify(report, null, 2)}\n`
    const privacyViolations = diagnosticPrivacyViolations(
      serialized,
      'error' in live || !live.activeCharacterName ? [] : [live.activeCharacterName]
    )
    if (privacyViolations.length > 0) {
      this.dependencies.error(
        'support-bundle.rejected',
        new Error(`Privacy validation failed: ${privacyViolations.join(', ')}`)
      )
      throw new Error('The support bundle failed its privacy check and was not written.')
    }
    await this.dependencies.write(outputPath, serialized)
    this.dependencies.info('support-bundle.exported', { formatVersion: 1 })
    return { canceled: false, path: outputPath }
  }
}
