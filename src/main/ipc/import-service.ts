import type {
  CollectionSnapshot,
  GdiaImportPreflight,
  GdiaImportProgress,
  GdiaImportResult,
  GdiaImportStage
} from '../../shared/contracts.ts'
import type {
  GdiaMigrationAnalysis,
  GdiaMigrationOptions,
  GdiaMigrationResult
} from '../gdia-migration.ts'

const COMMIT_STAGES = new Set<GdiaImportStage>([
  'verifying',
  'backing-up',
  'reading',
  'importing',
  'finalizing'
])

export class ItemAssistantImportInProgressError extends Error {
  readonly code = 'import.already-running'

  constructor() {
    super('An Item Assistant import is already running.')
    this.name = 'ItemAssistantImportInProgressError'
  }
}

export class ItemAssistantImportCanceledError extends Error {
  readonly code = 'import.canceled-before-mutation'

  constructor() {
    super('The Item Assistant import was canceled before archive mutation.')
    this.name = 'ItemAssistantImportCanceledError'
  }
}

export class ItemAssistantCollectionUnavailableError extends Error {
  readonly code = 'import.collection-unavailable'

  constructor() {
    super('Let CC finish its initial game-data scan before importing Item Assistant.')
    this.name = 'ItemAssistantCollectionUnavailableError'
  }
}

export interface ItemAssistantCollectionReader {
  readCollection(): Promise<CollectionSnapshot | null>
}

export interface ItemAssistantSourcePicker {
  pickDatabase(): Promise<string | null>
}

export interface ItemAssistantPreflightAnalyzer {
  analyze(sourcePath: string): Promise<GdiaMigrationAnalysis>
}

export interface ItemAssistantPreflightReviewer {
  confirm(preflight: GdiaImportPreflight): Promise<boolean>
}

export interface ItemAssistantCommitRequest {
  sourcePath: string
  expectedSourceSha256: string
  expectedQueueFingerprint: string
  expectedRequiredFreeBytes: number
  requireAllCatalogued: false
  onStage(stage: Extract<
    GdiaImportStage,
    'verifying' | 'backing-up' | 'reading' | 'importing' | 'finalizing'
  >): void
  /** Call only after the archive transaction has committed. */
  onArchiveMutationCommitted(): void
}

export interface ItemAssistantArchiveCommitter {
  commit(request: ItemAssistantCommitRequest): Promise<GdiaMigrationResult>
}

export interface ItemAssistantImportReceiptStore {
  write(result: GdiaImportResult): Promise<void>
}

export interface ItemAssistantArchiveBackupQueue {
  enqueue(reason: string): void
}

export interface ItemAssistantImportDiagnostics {
  reportFailure(boundary: 'receipt' | 'post-commit-backup', error: unknown): void
}

export interface ItemAssistantImportClock {
  nowMs(): number
  nowUtc(): string
}

export interface ItemAssistantImportCancellation {
  isCancellationRequested(): boolean
}

export interface ItemAssistantImportRequest {
  cancellation: ItemAssistantImportCancellation
  publishProgress(progress: GdiaImportProgress): void
}

export interface ItemAssistantImportDependencies {
  collection: ItemAssistantCollectionReader
  sourcePicker: ItemAssistantSourcePicker
  analyzer: ItemAssistantPreflightAnalyzer
  reviewer: ItemAssistantPreflightReviewer
  committer: ItemAssistantArchiveCommitter
  receipts: ItemAssistantImportReceiptStore
  backups: ItemAssistantArchiveBackupQueue
  diagnostics: ItemAssistantImportDiagnostics
  clock: ItemAssistantImportClock
  runExclusive<T>(operation: () => Promise<T>): Promise<T>
}

const commitProgress: Record<
  Extract<GdiaImportStage, 'verifying' | 'backing-up' | 'reading' | 'importing' | 'finalizing'>,
  GdiaImportProgress
> = {
  verifying: {
    stage: 'verifying',
    label: 'Verify analyzed source',
    detail: 'Confirming the database and pending queue still match preflight.',
    percent: 30,
    canCancel: false
  },
  'backing-up': {
    stage: 'backing-up',
    label: 'Protect source',
    detail: 'Creating or reusing a fully verified immutable backup.',
    percent: 42,
    canCancel: false
  },
  reading: {
    stage: 'reading',
    label: 'Read verified backup',
    detail: 'Loading supported Softcore and Hardcore copies from the immutable backup.',
    percent: 60,
    canCancel: false
  },
  importing: {
    stage: 'importing',
    label: 'Commit archive copies',
    detail: 'Applying one bounded archive transaction. This stage cannot be canceled.',
    percent: 78,
    canCancel: false
  },
  finalizing: {
    stage: 'finalizing',
    label: 'Write durable result',
    detail: 'Recording the final counts and verified backup outcome.',
    percent: 94,
    canCancel: false
  }
}

/**
 * Owns the interactive Item Assistant workflow independently of Electron.
 * Dependencies expose the concrete read, preflight, commit, receipt, and backup
 * boundaries so the composition root can wire existing low-level operations.
 */
export class ItemAssistantImportService {
  private readonly dependencies: ItemAssistantImportDependencies
  private active: Promise<GdiaImportResult> | null = null

  constructor(dependencies: ItemAssistantImportDependencies) {
    this.dependencies = dependencies
  }

  start(request: ItemAssistantImportRequest): Promise<GdiaImportResult> {
    if (this.active) return Promise.reject(new ItemAssistantImportInProgressError())

    // Defer dependency invocation until after the in-flight marker is installed.
    // A synchronous progress callback can therefore not re-enter start unnoticed.
    const operation = Promise.resolve().then(() => this.run(request))
    const tracked = operation.then(
      (result) => {
        if (this.active === tracked) this.active = null
        return result
      },
      (error: unknown) => {
        if (this.active === tracked) this.active = null
        throw error
      }
    )
    this.active = tracked
    return tracked
  }

  private async run(request: ItemAssistantImportRequest): Promise<GdiaImportResult> {
    const startedAt = this.dependencies.clock.nowMs()
    let sourcePath: string | null = null
    let archiveMutationCommitted = false
    let backupAttempted = false
    let backupQueued = false

    const publish = (progress: GdiaImportProgress): void => request.publishProgress({ ...progress })
    const checkpoint = (): void => {
      if (request.cancellation.isCancellationRequested()) {
        throw new ItemAssistantImportCanceledError()
      }
    }
    const canceledResult = (): GdiaImportResult => ({
      canceled: true,
      sourcePath,
      sourceItems: 0,
      sourceDatabaseItems: 0,
      sourceQueueItems: 0,
      sourceHardcoreItems: 0,
      sourceSoftcoreItems: 0,
      importedItems: 0,
      duplicateItems: 0,
      unsupportedItems: 0,
      backupPath: null,
      backupReused: false,
      receiptPersisted: false,
      completedAtUtc: null,
      durationMs: this.dependencies.clock.nowMs() - startedAt
    })
    const queuePostCommitBackup = (): void => {
      if (backupAttempted) return
      backupAttempted = true
      try {
        this.dependencies.backups.enqueue('Item Assistant migration')
        backupQueued = true
      } catch (error) {
        this.dependencies.diagnostics.reportFailure('post-commit-backup', error)
      }
    }

    publish({
      stage: 'selecting',
      label: 'Choose Item Assistant database',
      detail: 'No files have been changed.',
      percent: 0,
      canCancel: true
    })

    try {
      checkpoint()
      if (!(await this.dependencies.collection.readCollection())) {
        throw new ItemAssistantCollectionUnavailableError()
      }
      checkpoint()
      sourcePath = await this.dependencies.sourcePicker.pickDatabase()
      checkpoint()
      if (!sourcePath) {
        publish({
          stage: 'canceled',
          label: 'Import canceled',
          detail: 'No files were changed.',
          percent: 0,
          canCancel: false
        })
        return canceledResult()
      }

      publish({
        stage: 'analyzing',
        label: 'Analyze selected source',
        detail: 'Counting copies, modes, unsupported records, backup bytes, and free space.',
        percent: 12,
        canCancel: false
      })
      const analysis = await this.dependencies.analyzer.analyze(sourcePath)
      checkpoint()
      const preflight = analysis.preflight
      const enoughSpace = preflight.requiredFreeBytes <= preflight.availableFreeBytes

      publish({
        stage: 'awaiting-confirmation',
        label: 'Review analyzed source',
        detail: 'Cancel is safe here. No backup or archive mutation has started.',
        percent: 25,
        canCancel: true
      })
      const confirmed = await this.dependencies.reviewer.confirm(preflight)
      checkpoint()
      if (!enoughSpace || !confirmed) {
        publish({
          stage: 'canceled',
          label: 'Import canceled safely',
          detail: 'No files were changed.',
          percent: 25,
          canCancel: false
        })
        return canceledResult()
      }

      // This is the last cancellation boundary. Once commit starts, backup and
      // archive operations must run to a known outcome.
      checkpoint()
      const commitSourcePath = sourcePath
      const result = await this.dependencies.runExclusive(() => this.dependencies.committer.commit({
        sourcePath: commitSourcePath,
        expectedSourceSha256: preflight.sourceSha256,
        expectedQueueFingerprint: analysis.queueFingerprint,
        expectedRequiredFreeBytes: preflight.requiredFreeBytes,
        requireAllCatalogued: false,
        onStage: (stage) => {
          if (!COMMIT_STAGES.has(stage)) return
          publish(commitProgress[stage])
        },
        onArchiveMutationCommitted: () => {
          archiveMutationCommitted = true
        }
      }))

      const completedAtUtc = this.dependencies.clock.nowUtc()
      let summary: GdiaImportResult = {
        canceled: false,
        sourcePath,
        sourceItems: result.sourceItems,
        sourceDatabaseItems: result.sourceDatabaseItems,
        sourceQueueItems: result.sourceQueueItems,
        sourceHardcoreItems: result.sourceHardcoreItems,
        sourceSoftcoreItems: result.sourceSoftcoreItems,
        importedItems: result.importedIds.length,
        duplicateItems: result.duplicateIds.length,
        unsupportedItems: result.unsupportedIds.length,
        backupPath: result.backupPath,
        backupReused: result.backupReused,
        receiptPersisted: true,
        completedAtUtc,
        durationMs: this.dependencies.clock.nowMs() - startedAt
      }

      try {
        await this.dependencies.receipts.write(summary)
      } catch (error) {
        summary = { ...summary, receiptPersisted: false }
        this.dependencies.diagnostics.reportFailure('receipt', error)
      }
      if (archiveMutationCommitted || result.importedIds.length > 0) queuePostCommitBackup()

      publish({
        stage: 'complete',
        label: 'Item Assistant import complete',
        detail: `${summary.importedItems.toLocaleString()} imported · ` +
          `${summary.duplicateItems.toLocaleString()} already present · ` +
          `${summary.unsupportedItems.toLocaleString()} unsupported.`,
        percent: 100,
        canCancel: false
      })
      return summary
    } catch (error) {
      if (archiveMutationCommitted) queuePostCommitBackup()
      if (error instanceof ItemAssistantImportCanceledError) {
        publish({
          stage: 'canceled',
          label: 'Import canceled safely',
          detail: 'No archive mutation started after the cancellation request.',
          percent: 25,
          canCancel: false
        })
        throw error
      }
      publish({
        stage: 'failed',
        label: 'Import stopped safely',
        detail: archiveMutationCommitted && backupQueued
          ? 'Archive mutation committed before finalization failed; a protective backup was queued.'
          : archiveMutationCommitted
            ? 'Archive mutation committed before finalization failed; backup scheduling also failed and was reported.'
          : 'CC preserved the source and reported the failure without continuing.',
        percent: 100,
        canCancel: false
      })
      throw error
    }
  }
}

/** Adapter shape matching migrateGdiaDatabase options for composition-root wiring. */
export function migrationOptionsFromRequest(request: ItemAssistantCommitRequest): GdiaMigrationOptions {
  return {
    requireAllCatalogued: request.requireAllCatalogued,
    expectedSourceSha256: request.expectedSourceSha256,
    expectedQueueFingerprint: request.expectedQueueFingerprint,
    expectedRequiredFreeBytes: request.expectedRequiredFreeBytes,
    onStage: request.onStage,
    onArchiveMutationCommitted: request.onArchiveMutationCommitted
  }
}
