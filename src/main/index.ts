import { join } from 'node:path'
import { createHash, randomInt, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { arch, platform, release } from 'node:os'
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, screen, shell } from 'electron'
import {
  IPC_CHANNELS,
  type ArchiveBackupEntry,
  type ArchiveBackupActionResult,
  type ArchiveRollHydrationResult,
  type AppStatus,
  type CharacterSaveProfile,
  type CollectionBasis,
  type CollectionItem,
  type CollectionSnapshot,
  type DismantlingPreview,
  type DebugLoggingStatus,
  type DiagnosticExportResult,
  type GrimDawnDiscovery,
  type GdiaImportProgress,
  type GdiaImportResult,
  type IngestResult,
  type ItemRollAnalysis,
  type LiveGameStatus,
  type LiveGameSyncResult,
  type LiveRetrievalResult,
  type LiveSupplyDispenseResult,
  type OperationHistoryPage,
  type OperationHistoryRequest,
  type PreferenceLoadReport,
  type SpecialItemRecoveryResult,
  type SpecialRecoveryDestination,
  type MapRegionLocation,
  type RetrievalResult,
  type RendererErrorReport,
  type ObservedStashItem,
  type StagingTabInspection,
  type StartupPhaseEvent,
  type StartupStatus,
  type VaultListItem,
  type VaultItemPage,
  type VaultPageRequest,
  type VaultSummary,
  type WriteSafetyStatus
} from '@shared/contracts'
import {
  isCollectionOwned,
  withAwakeningAvailability
} from '@shared/collection-availability'
import { withRecipeAvailability } from '@shared/recipe-availability'
import { GrimDawnHelperClient } from './grim-dawn/helper-client'
import {
  CollectionDatabase,
  type RecoveryJournalOperation,
  type ResolvedArchiveCatalogItem
} from './collection-database'
import { analyzeGdiaDatabase, migrateGdiaDatabase } from './gdia-migration'
import { readLastGdiaImportResult, writeLastGdiaImportResult } from './gdia-import-receipt'
import { ArchiveBackupService } from './archive-backup'
import {
  DiagnosticLogger
} from './diagnostics'
import { StartupRecoveryService, type StartupRecoveryStatus } from './startup-recovery'
import { PreferenceFileStore } from './preference-file-store.ts'
import {
  BackgroundJobCanceledError,
  BackgroundJobCoordinator,
  isBackgroundJobId,
  runGlobalRollHydration,
  TrailingJobQueue
} from './background-jobs'
import { createMainIpcDomains } from './ipc/domains.ts'
import {
  booleanField,
  validateBackgroundJobId,
  validateCollectionRequest,
  validateNavigation,
  validateOperationHistory,
  validateOptionalMode,
  validatePath,
  validatePathAndVaultIds,
  validatePinnedBest,
  validatePreferenceBootstrap,
  validatePreferenceLoad,
  validateRendererError,
  validateSerializedPreferences,
  validateSourcePaths,
  validateSpecialRecovery,
  validateStartupPhase,
  validateSupplyDispense,
  validateVaultIds,
  validateVaultPage,
  validateZoomFactor
} from './ipc/validation.ts'
import { registerManagedShutdown, registerPrimaryWindowLifecycle } from './window-lifecycle.ts'
import { MainOperationCoordinator } from './operation-coordinator.ts'
import { BackgroundJobService } from './ipc/background-job-service.ts'
import { BackupService } from './ipc/backup-service.ts'
import { WindowService } from './ipc/window-service.ts'
import {
  ItemAssistantImportCanceledError,
  ItemAssistantImportService,
  migrationOptionsFromRequest
} from './ipc/import-service.ts'
import { CollectionService } from './ipc/collection-service.ts'
import { DiagnosticsService } from './ipc/diagnostics-service.ts'
import { ArchiveDomainService } from './ipc/archive-service.ts'
import { LiveTransferDomainService } from './ipc/live-transfer-service.ts'
import { LiveGameDomainService } from './ipc/live-game-service.ts'
import { DiagnosticExportService } from './ipc/diagnostic-export-service.ts'

function runArchiveBackupJob(
  jobs: BackgroundJobCoordinator,
  dedupeKey: string,
  reason: string,
  operation: () => Promise<ArchiveBackupEntry>
) {
  return jobs.run({
    kind: 'archive-backup',
    dedupeKey,
    stage: 'queued',
    progress: {
      completed: 0,
      total: 3,
      percent: 0,
      unit: 'steps',
      label: 'Prepare archive backup',
      detail: reason
    },
    canCancel: false,
    boundary: null,
    completedStage: 'complete',
    failedStage: 'failed',
    canceledStage: 'canceled'
  }, async (job) => {
    job.throwIfCancellationRequested()
    job.update({
      stage: 'checkpointing',
      canCancel: false,
      boundary: null,
      progress: { completed: 1, label: 'Checkpoint archive', detail: 'Preparing a consistent database copy.' }
    })
    const backup = await operation()
    job.update({
      stage: 'verifying',
      progress: { completed: 2, label: 'Verify archive backup', detail: 'The durable copy and manifest passed verification.' }
    })
    return backup
  }, (backup) => ({
    summary: 'Verified archive backup created.',
    metrics: {
      backupId: backup.id,
      sizeBytes: backup.sizeBytes,
      vaultItemCount: backup.vaultItemCount,
      verified: backup.verified
    }
  }))
}

// Packaged GUI launches do not always have a durable console attached. Electron's
// child processes can outlive a terminal or diagnostic launcher and inherit its
// now-closed pipe; without an error listener, a later console.warn/error turns a
// harmless logging failure into a main-process EPIPE crash dialog.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', () => {
    // Application logging is best-effort. Runtime errors are surfaced in the UI.
  })
}

// Isolated screenshot runs must work on CI and remote Windows sessions that have
// no usable GPU process. Production keeps Electron's normal acceleration path.
if (process.env.CAIRN_CODEX_SCREENSHOT_PATH) app.disableHardwareAcceleration()

const CATALOG_PRESENTATION_VERSION = 32
const DOUBLE_RARE_MI_BITMAP = 'character/item_doubleraremonsterinfrequent.tex'
const ROLL_ANALYSIS_VERSION = 4
const collectionRarities = ['epic', 'legendary', 'mi'] as const
const SAHDINAS_MEMENTO = {
  record: 'records/items/gearaccessories/necklaces/b100_necklace_sahdina.dbr',
  name: "Sahdina's Memento"
} as const
const SAFE_MODE_ARGUMENT = '--cairn-safe-mode'
const safeModeRequested = process.argv.includes(SAFE_MODE_ARGUMENT) ||
  (Boolean(process.env.CAIRN_CODEX_SCREENSHOT_PATH) && process.env.CAIRN_CODEX_SCREENSHOT_SAFE_MODE === '1')
const applicationStartedAt = Date.now()
const startupStatus: StartupStatus = {
  startedAtUtc: new Date(applicationStartedAt).toISOString(),
  cacheOutcome: 'pending',
  cachedPaintMs: null,
  interactiveMs: null,
  scanState: 'pending',
  scanSettledMs: null,
  rollAnalysisState: 'pending',
  rollAnalysisSettledMs: null,
  backgroundPhase: 'opening-cache'
}

function formatImportBytes(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`
  if (value >= 1024) return `${Math.ceil(value / 1024).toLocaleString()} KiB`
  return `${value.toLocaleString()} bytes`
}

function presentStartupStatus(): StartupStatus {
  return { ...startupStatus }
}

function recordStartupPhase(phase: StartupPhaseEvent, diagnostics: DiagnosticLogger): StartupStatus {
  const elapsedMs = Date.now() - applicationStartedAt
  let changed = false
  if (phase === 'cache-hit' && startupStatus.cacheOutcome === 'pending') {
    startupStatus.cacheOutcome = 'hit'
    changed = true
  } else if (phase === 'cache-miss' && startupStatus.cacheOutcome === 'pending') {
    startupStatus.cacheOutcome = 'miss'
    changed = true
  } else if (phase === 'cached-paint' && startupStatus.cachedPaintMs === null) {
    startupStatus.cachedPaintMs = elapsedMs
    changed = true
  } else if (phase === 'interactive' && startupStatus.interactiveMs === null) {
    startupStatus.interactiveMs = elapsedMs
    changed = true
  } else if (phase === 'scan-started' && startupStatus.scanState === 'pending') {
    startupStatus.scanState = 'running'
    changed = true
  } else if (phase === 'scan-settled' && startupStatus.scanState === 'running') {
    startupStatus.scanState = 'settled'
    startupStatus.scanSettledMs = elapsedMs
    changed = true
  } else if (phase === 'scan-skipped' && startupStatus.scanState === 'pending') {
    startupStatus.scanState = 'skipped'
    startupStatus.scanSettledMs = elapsedMs
    changed = true
  } else if (phase === 'roll-analysis-started' && startupStatus.rollAnalysisState === 'pending') {
    startupStatus.rollAnalysisState = 'running'
    changed = true
  } else if (phase === 'roll-analysis-settled' && startupStatus.rollAnalysisState === 'running') {
    startupStatus.rollAnalysisState = 'settled'
    startupStatus.rollAnalysisSettledMs = elapsedMs
    changed = true
  } else if (phase === 'roll-analysis-skipped' && startupStatus.rollAnalysisState === 'pending') {
    startupStatus.rollAnalysisState = 'skipped'
    startupStatus.rollAnalysisSettledMs = elapsedMs
    changed = true
  }
  startupStatus.backgroundPhase = startupStatus.interactiveMs === null
    ? 'opening-cache'
    : startupStatus.scanState === 'running'
      ? 'collection-scan'
      : startupStatus.rollAnalysisState === 'running'
        ? 'roll-analysis'
        : 'idle'
  if (changed) diagnostics.info('startup-phase', phase, { elapsedMs })
  return presentStartupStatus()
}

interface IngestCommand {
  path: string
  expectedSourceSha256: string
  items: Array<{ tabIndex: number; itemIndex: number; expectedSeed: number }>
}

interface PersistedWindowState {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

interface MapLocationIndex {
  version: number
  builtAt: string
  archives: Array<{ path: string; length: number; lastWriteUtc: string }>
  regionCount: number
  placedRecordCount: number
  sourceLocations: Record<string, MapRegionLocation[]>
  miTierCount: number
  locatedMiTierCount: number
  unlocatedMiBases: string[]
}

interface IngestPlan {
  path: string
  sourceSha256: string
  sourceItemCount: number
  replacementItemCount: number
  replacementSha256: string
  semanticallyValid: boolean
  idempotent: boolean
  items: Array<{ baseRecord: string; seed: number; [key: string]: unknown }>
}

interface CommittedIngest {
  plan: IngestPlan
  transaction: {
    backupPath: string
    rollbackPath: string
    sourceSha256: string
    committedSha256: string
  }
}

interface RetrievalCommand {
  path: string
  expectedSourceSha256: string
  targetTabIndex: number
  vaultItemIds: string[]
}

interface RetrievalPlanCommand {
  path: string
  targetTabIndex: number
  vaultItemIds: string[]
}

interface RetrievalPlan {
  path: string
  sourceSha256: string
  targetTabIndex: number
  sourceItemCount: number
  replacementItemCount: number
  replacementSha256: string
  restoredExactly: boolean
  semanticallyValid: boolean
  idempotent: boolean
  items: Array<{ baseRecord: string; seed: number }>
}

interface CommittedRetrieval {
  plan: RetrievalPlan
  transaction: {
    backupPath: string
    rollbackPath: string
    sourceSha256: string
    committedSha256: string
  }
}

interface TransferStashScan {
  path: string
  sha256: string
  itemCount: number
  tabs: Array<{
    index: number
    items: Array<{
      tabIndex: number
      itemIndex: number
      baseRecord: string
      seed: number
    }>
  }>
}

interface ItemIconExtractionResult {
  icons: Array<{ bitmap: string; key: string }>
  missing: string[]
  failures: Array<{ bitmap: string; error: string }>
}

interface LiveVaultPayload {
  stashVersion: number
  sourceTabIndex: number
  sourceItemIndex: number
  baseRecord: string
  prefixRecord: string
  suffixRecord: string
  modifierRecord: string
  transmuteRecord: string
  seed: number
  materiaRecord: string
  relicCompletionBonusRecord: string
  relicSeed: number
  enchantmentRecord: string
  ascendantRecord: string
  ascendantRecord2H: string
  unknown: number
  enchantmentSeed: number
  materiaCombines: number
  stackCount: number
  rerolls: number
  affixRerolls: number
  xOffset: number
  yOffset: number
}

interface LiveIncomingItem {
  path: string
  sha256: string
  isHardcore: boolean
  item: LiveVaultPayload
  createdAtUtc: string
}

interface LiveQueueReceipt {
  sha256: string
  receiptPath: string
}

interface LiveRetrievalQueue {
  operationId: string
  outgoingPath: string
  semanticSha256: string
  isHardcore: boolean
  baselineDeleted: string[]
  baselineIncoming: string[]
}

interface LiveRetrievalStatus {
  state: 'pending' | 'deposited' | 'rejected' | 'unknown'
  receiptPath: string | null
}

function isHardcoreStashPath(path: string): boolean {
  return path.toLocaleLowerCase().endsWith('.gsh')
}

async function countFiles(directory: string): Promise<number> {
  try {
    let count = 0
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      count += entry.isDirectory() ? await countFiles(join(directory, entry.name)) : 1
    }
    return count
  } catch {
    return 0
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cairn-icon',
    privileges: { standard: true, secure: true, supportFetchAPI: true }
  }
])

function helperArtifactPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'helper', 'CairnCodex.GrimDawn.exe')
    : join(
        app.getAppPath(),
        'src',
        'helper',
        'CairnCodex.GrimDawn',
        'bin',
        'Debug',
        'net10.0-windows',
        'CairnCodex.GrimDawn.dll'
      )
}

function createHelperClient(diagnostics?: DiagnosticLogger): GrimDawnHelperClient {
  const onDiagnostic: NonNullable<ConstructorParameters<typeof GrimDawnHelperClient>[0]['onDiagnostic']> =
    (event) => {
      if (event.outcome === 'failed') {
        diagnostics?.error('helper', 'request.failed', event.error, {
          method: event.method,
          durationMs: event.durationMs
        })
      } else {
        diagnostics?.debugEvent('helper', 'request.completed', {
          method: event.method,
          durationMs: event.durationMs
        })
      }
    }
  if (app.isPackaged) {
    return new GrimDawnHelperClient({
      command: helperArtifactPath(),
      args: [],
      onDiagnostic
    })
  }

  return new GrimDawnHelperClient({
    command: 'dotnet',
    args: [helperArtifactPath()],
    onDiagnostic
  })
}

interface TerminalRecoveryEntry {
  operationId: string
  state: 'deposited' | 'rejected'
  receiptPath: string
  semanticSha256: string
  copiedReceiptPath: string | null
}

type HelperRequester = Pick<GrimDawnHelperClient, 'request'>

function retainedRecoveryQueues(operation: RecoveryJournalOperation): LiveRetrievalQueue[] {
  const queues = operation.detail.queues
  if (!Array.isArray(queues)) return []
  const parsed = queues.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const queue = candidate as Record<string, unknown>
    if (
      typeof queue.operationId !== 'string' ||
      typeof queue.outgoingPath !== 'string' ||
      typeof queue.semanticSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(queue.semanticSha256) ||
      typeof queue.isHardcore !== 'boolean' ||
      !Array.isArray(queue.baselineDeleted) ||
      !queue.baselineDeleted.every((value) => typeof value === 'string') ||
      !Array.isArray(queue.baselineIncoming) ||
      !queue.baselineIncoming.every((value) => typeof value === 'string')
    ) return []
    return [{
      operationId: queue.operationId,
      outgoingPath: queue.outgoingPath,
      semanticSha256: queue.semanticSha256,
      isHardcore: queue.isHardcore,
      baselineDeleted: queue.baselineDeleted as string[],
      baselineIncoming: queue.baselineIncoming as string[]
    }]
  })
  return parsed.length === queues.length &&
    new Set(parsed.map((queue) => queue.operationId)).size === parsed.length
    ? parsed
    : []
}

function retainedTerminalResolution(operation: RecoveryJournalOperation): TerminalRecoveryEntry[] {
  const resolution = operation.detail.recoveryResolution
  if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution)) return []
  const entries = (resolution as Record<string, unknown>).entries
  if (!Array.isArray(entries)) return []
  const parsed = entries.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const entry = candidate as Record<string, unknown>
    if (
      typeof entry.operationId !== 'string' ||
      (entry.state !== 'deposited' && entry.state !== 'rejected') ||
      typeof entry.receiptPath !== 'string' ||
      typeof entry.semanticSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(entry.semanticSha256) ||
      (entry.copiedReceiptPath !== null && typeof entry.copiedReceiptPath !== 'string')
    ) return []
    return [{
      operationId: entry.operationId,
      state: entry.state as 'deposited' | 'rejected',
      receiptPath: entry.receiptPath,
      semanticSha256: entry.semanticSha256,
      copiedReceiptPath: entry.copiedReceiptPath as string | null
    }]
  })
  return parsed.length === entries.length &&
    new Set(parsed.map((entry) => entry.operationId)).size === parsed.length
    ? parsed
    : []
}

async function finalizeLiveRecoveryOperation(
  helper: HelperRequester,
  database: CollectionDatabase,
  operation: RecoveryJournalOperation,
  queues: LiveRetrievalQueue[],
  entries: TerminalRecoveryEntry[],
  diagnostics: DiagnosticLogger
): Promise<boolean> {
  if (
    entries.length !== queues.length ||
    entries.some((entry, index) =>
      entry.operationId !== queues[index]?.operationId ||
      entry.semanticSha256.toLowerCase() !== queues[index]?.semanticSha256.toLowerCase()
    )
  ) return false
  const rejected = entries.filter((entry) => entry.state === 'rejected')
  const deposited = entries.filter((entry) => entry.state === 'deposited')
  for (const entry of rejected) {
    try {
      await helper.request<LiveQueueReceipt>('ack-live-incoming', {
        path: entry.receiptPath,
        expectedSha256: entry.semanticSha256,
        receiptDirectory: join(app.getPath('userData'), 'live-receipts', 'recovered-rejections')
      })
    } catch (error) {
      if (!entry.copiedReceiptPath) throw error
      diagnostics.info('recovery', 'rejected-receipt.already-moved', {
        operationId: operation.id,
        queueOperationId: entry.operationId
      })
    }
  }

  const generated = operation.detail.transferKind === 'generated_delivery'
  const completedAtUtc = new Date().toISOString()
  if (generated) {
    if (deposited.length === 0) {
      database.failDeliveryOperation(
        operation.id,
        new Error('The game rejected every retained delivery; no generated item was delivered.')
      )
    } else {
      database.completeDeliveryOperation({
        operationId: operation.id,
        receiptPath: deposited[0]!.receiptPath,
        completedAtUtc,
        detail: {
          ...operation.detail,
          phase: 'recovered_committed',
          receiptPaths: deposited.map((entry) => entry.receiptPath),
          rejectedCount: rejected.length
        }
      })
    }
  } else {
    const vaultItemIds = Array.isArray(operation.detail.vaultItemIds)
      ? operation.detail.vaultItemIds.filter((value): value is string => typeof value === 'string')
      : []
    if (vaultItemIds.length === 0 || vaultItemIds.length !== queues.length) return false
    if (deposited.length === entries.length) {
      database.completeRetrievalOperation({
        operationId: operation.id,
        backupPath: deposited[0]!.receiptPath,
        completedAtUtc,
        vaultItemIds,
        detail: {
          ...operation.detail,
          phase: 'recovered_committed',
          receiptPaths: deposited.map((entry) => entry.receiptPath),
          vaultItemIds
        }
      })
    } else if (rejected.length === entries.length) {
      database.failRetrievalOperation(
        operation.id,
        vaultItemIds,
        new Error('The game rejected the retained retrieval; every archive copy remains stored.')
      )
    } else {
      const depositedVaultItemIds = entries.flatMap((entry, index) =>
        entry.state === 'deposited' ? [vaultItemIds[index]!] : []
      )
      const rejectedVaultItemIds = entries.flatMap((entry, index) =>
        entry.state === 'rejected' ? [vaultItemIds[index]!] : []
      )
      database.completePartialRetrievalOperation({
        operationId: operation.id,
        depositedVaultItemIds,
        rejectedVaultItemIds,
        receiptPaths: deposited.map((entry) => entry.receiptPath),
        completedAtUtc,
        detail: {
          ...operation.detail,
          phase: 'recovered_committed_partial',
          receiptPaths: deposited.map((entry) => entry.receiptPath),
          rejectedReceiptPaths: rejected.map((entry) => entry.receiptPath),
          depositedVaultItemIds,
          rejectedVaultItemIds,
          vaultItemIds
        }
      })
    }
  }
  diagnostics.info('recovery', 'operation.resolved', {
    operationId: operation.id,
    outcome: deposited.length > 0 ? 'committed' : 'rejected',
    depositedItems: deposited.length,
    rejectedItems: rejected.length
  })
  return true
}

async function reconcileLiveRecoveryOperations(
  helper: HelperRequester,
  database: CollectionDatabase,
  diagnostics: DiagnosticLogger
): Promise<number> {
  let resolved = 0
  for (const operation of database.listRecoveryOperations()) {
    if (operation.operation !== 'retrieve') continue
    const queues = retainedRecoveryQueues(operation)
    if (queues.length === 0) continue
    try {
      let entries = retainedTerminalResolution(operation)
      if (entries.length !== queues.length) {
        const inspected = await Promise.all(
          queues.map((queue) => helper.request<LiveRetrievalStatus>('inspect-live-retrieval', { queue }))
        )
        if (inspected.some((status) =>
          (status.state !== 'deposited' && status.state !== 'rejected') || !status.receiptPath
        )) continue
        entries = []
        for (const [index, status] of inspected.entries()) {
          const queue = queues[index]!
          let copiedReceiptPath: string | null = null
          if (status.state === 'rejected') {
            const copied = await helper.request<LiveQueueReceipt>('copy-live-incoming', {
              path: status.receiptPath!,
              expectedSha256: queue.semanticSha256,
              receiptDirectory: join(app.getPath('userData'), 'live-receipts', 'recovered-rejections')
            })
            copiedReceiptPath = copied.receiptPath
          }
          entries.push({
            operationId: queue.operationId,
            state: status.state as 'deposited' | 'rejected',
            receiptPath: status.receiptPath!,
            semanticSha256: queue.semanticSha256,
            copiedReceiptPath
          })
        }
        database.updatePendingOperationDetail(operation.id, {
          recoveryResolution: { recordedAtUtc: new Date().toISOString(), entries }
        })
        operation.detail = {
          ...operation.detail,
          recoveryResolution: { recordedAtUtc: new Date().toISOString(), entries }
        }
      }
      if (await finalizeLiveRecoveryOperation(
        helper, database, operation, queues, entries, diagnostics
      )) resolved += 1
    } catch (error) {
      diagnostics.error('recovery', 'operation.reconcile-failed', error, {
        operationId: operation.id
      })
    }
  }
  return resolved
}

function registerIpcHandlers(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  archiveBackups: ArchiveBackupService,
  diagnostics: DiagnosticLogger,
  startupRecovery: StartupRecoveryService,
  jobs: BackgroundJobCoordinator
): () => Promise<void> {
  const ipcDomains = createMainIpcDomains(ipcMain)
  const backgroundJobService = new BackgroundJobService(jobs)
  let latestCollection: CollectionSnapshot | null = null
  const collectionCachePath = join(app.getPath('userData'), 'collection-snapshot.json')
  const mapLocationCachePath = join(app.getPath('userData'), 'map-location-index.json')
  const gdiaBackupDirectory = join(app.getPath('userData'), 'migrations', 'gdia')
  const preferenceStore = new PreferenceFileStore(join(app.getPath('userData'), 'preferences.json'))
  let gdiaImportProgress: GdiaImportProgress | null = null
  const operations = new MainOperationCoordinator({
    diagnostics,
    reconcileTransfers: () => reconcileLiveRecoveryOperations(helper, database, diagnostics),
    unresolvedTransferCount: () => database.getRecoveryOperationCount()
  })
  const runExclusive = <T>(operation: () => Promise<T>): Promise<T> => operations.runExclusive(operation)
  const runTransferExclusive = <T>(operation: () => Promise<T>): Promise<T> =>
    operations.runTransferExclusive(operation)
  const runDiagnosticOperation = <T>(
    scope: string,
    event: string,
    operation: () => Promise<T>,
    startData?: Record<string, unknown>,
    completedData?: (result: T) => Record<string, unknown>,
    correlationId?: string
  ): Promise<T> => operations.runDiagnostic(
    scope, event, operation, startData, completedData, correlationId
  )
  const queuedArchiveBackups = new TrailingJobQueue<string>(async (queuedReason) => {
    await runArchiveBackupJob(
      jobs,
      `archive-backup:auto:${randomUUID()}`,
      queuedReason,
      () => runExclusive(() => archiveBackups.createBackup(queuedReason))
    ).result.catch((error) => {
      console.error(`[archive-backup] ${queuedReason} failed`, error)
    })
  })
  const queueArchiveBackup = (reason: string): void => {
    queuedArchiveBackups.enqueue(reason)
  }

  const stopPublishingJobs = jobs.subscribe((job) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.webContents.isDestroyed() || window.webContents.isCrashed()) continue
      try {
        window.webContents.send(IPC_CHANNELS.backgroundJobChanged, job)
      } catch (error) {
        if (!window.webContents.isDestroyed() && !window.webContents.isCrashed()) {
          console.warn('[background-jobs] renderer update could not be delivered', error)
        }
      }
    }
  })
  ipcDomains.backgroundJobs.handle(
    IPC_CHANNELS.getBackgroundJobs,
    () => backgroundJobService.list()
  )
  ipcDomains.backgroundJobs.handle(
    IPC_CHANNELS.cancelBackgroundJob,
    (_event, input: { id: string }) => backgroundJobService.cancel(input),
    validateBackgroundJobId
  )

  const diagnosticExporter = new DiagnosticExportService({
    nowUtc: () => new Date().toISOString(),
    selectOutput: async (defaultFileName) => {
      const selection = await dialog.showSaveDialog({
        title: 'Save Cairn Codex support bundle',
        defaultPath: join(app.getPath('downloads'), defaultFileName),
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      return selection.canceled ? null : selection.filePath ?? null
    },
    countFiles: (name) => countFiles(join(app.getPath('userData'), name)),
    inspectLive: () => helper.request<LiveGameStatus>('inspect-live-game'),
    helperHealth: () => helper.request<Record<string, unknown>>('health'),
    applicationSummary: async () => ({
      version: app.getVersion(),
      packaged: app.isPackaged,
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
      sha256: app.isPackaged
        ? await readFile(app.getAppPath())
            .then((contents) => createHash('sha256').update(contents).digest('hex'))
            .catch(() => null)
        : null
    }),
    systemSummary: () => ({ platform: platform(), release: release(), architecture: arch() }),
    helperSha256: () => readFile(helperArtifactPath())
      .then((contents) => createHash('sha256').update(contents).digest('hex'))
      .catch(() => null),
    databaseSummary: () => database.getDiagnosticSummary(),
    archiveBackupStatus: () => archiveBackups.getStatus(),
    collectionSnapshot: () => latestCollection,
    inspectWriteSafety: () => helper.request<WriteSafetyStatus>('inspect-write-safety'),
    startupStatus: () => presentStartupStatus(),
    loggingPolicy: () => diagnostics.getRetentionPolicy(),
    readLogs: () => diagnostics.readEntries(),
    registerSecret: (secret) => diagnostics.registerSecret(secret),
    write: (path, contents) => writeFile(path, contents, 'utf8'),
    info: (event, data) => diagnostics.info('diagnostics', event, data),
    error: (event, error) => diagnostics.error('diagnostics', event, error)
  })
  const diagnosticsService = new DiagnosticsService({
    appVersion: () => app.getVersion(),
    helperHealth: () => helper.request('health'),
    safeModeStatus: () => startupRecovery.getStatus(),
    debugEnabled: () => diagnostics.getDebugMode(),
    retentionPolicy: () => diagnostics.getRetentionPolicy(),
    persistDebugLogging: (enabled) => database.setDebugLogging(enabled),
    applyDebugLogging: (enabled) => diagnostics.setDebugMode(enabled),
    info: (scope, event, data) => diagnostics.info(scope, event, data),
    warn: (scope, event, data) => diagnostics.warn(scope, event, data),
    error: (scope, event, error, data) => diagnostics.error(scope, event, error, data),
    selectPreferenceExport: async (serialized) => {
      const stamp = new Date().toISOString().slice(0, 10)
      const selection = await dialog.showSaveDialog({
        title: 'Export Cairn Codex preferences',
        defaultPath: join(app.getPath('documents'), `cairn-codex-preferences-${stamp}.json`),
        filters: [{ name: 'Cairn Codex preferences', extensions: ['json'] }]
      })
      if (selection.canceled || !selection.filePath) return null
      await writeFile(selection.filePath, serialized, 'utf8')
      return selection.filePath
    },
    reconcileRecovery: () => reconcileLiveRecoveryOperations(helper, database, diagnostics),
    runExclusive,
    recoveryOperations: () => database.getDiagnosticSummary().recoveryOperations,
    exporter: diagnosticExporter
  })
  ipcDomains.diagnostics.handle(IPC_CHANNELS.getAppStatus, () => diagnosticsService.getAppStatus())
  ipcDomains.diagnostics.handle(IPC_CHANNELS.getDebugLogging, () => diagnosticsService.getDebugLogging())
  ipcDomains.diagnostics.handle(
    IPC_CHANNELS.setDebugLogging,
    (_event, input: { enabled: boolean }) => diagnosticsService.setDebugLogging(input),
    booleanField('enabled', 'Debug logging must be enabled or disabled explicitly.')
  )
  ipcDomains.diagnostics.handle(
    IPC_CHANNELS.recordNavigation,
    (_event, input: { view: string }) => diagnosticsService.recordNavigation(input),
    validateNavigation
  )
  ipcDomains.diagnostics.handle(
    IPC_CHANNELS.reportRendererError,
    (_event, input: RendererErrorReport) => diagnosticsService.reportRendererError(input),
    validateRendererError
  )
  ipcDomains.diagnostics.handle(
    IPC_CHANNELS.reportPreferenceLoad,
    (_event, input: PreferenceLoadReport) => diagnosticsService.reportPreferenceLoad(input),
    validatePreferenceLoad
  )
  ipcDomains.diagnostics.handle(
    IPC_CHANNELS.loadPreferences,
    async (_event, input: { origin: string; candidateSerialized: string | null }) => {
      const result = await preferenceStore.bootstrap(input.origin, input.candidateSerialized)
      diagnostics.info('settings', result.recovered ? 'preferences.file-recovered' : 'preferences.file-loaded', {
        importedOrigin: result.importedOrigin,
        backupCount: result.backupCount
      })
      return result
    },
    validatePreferenceBootstrap
  )
  ipcDomains.diagnostics.handle(
    IPC_CHANNELS.savePreferences,
    (_event, input: { serialized: string }) => preferenceStore.save(input.serialized),
    validateSerializedPreferences
  )
  ipcDomains.diagnostics.handle(
    IPC_CHANNELS.exportPreferences,
    (_event, input: { serialized: string }) => diagnosticsService.exportPreferences(input),
    validateSerializedPreferences
  )
  const restartWithSafeMode = (safe: boolean): void => {
    const args = process.argv.slice(1).filter((argument) => argument !== SAFE_MODE_ARGUMENT)
    if (safe) args.push(SAFE_MODE_ARGUMENT)
    diagnostics.info('recovery', safe ? 'safe-mode.requested' : 'normal-mode.requested')
    app.relaunch({ args })
    app.quit()
  }
  const windowService = new WindowService({
    restart: restartWithSafeMode,
    startupStatus: presentStartupStatus,
    recordStartupPhase: (phase) => recordStartupPhase(phase, diagnostics),
    markHealthy: () => startupRecovery.markHealthy(),
    recordHealthFailure: (error) => diagnostics.error('recovery', 'startup-health.persist-failed', error),
    openDataDirectory: () => shell.openPath(app.getPath('userData'))
  })
  ipcDomains.windowLifecycle.handle(IPC_CHANNELS.restartInSafeMode, () => windowService.restartInSafeMode())
  ipcDomains.windowLifecycle.handle(IPC_CHANNELS.restartNormally, () => windowService.restartNormally())
  ipcDomains.windowLifecycle.handle(IPC_CHANNELS.getStartupStatus, () => windowService.getStartupStatus())
  ipcDomains.windowLifecycle.handle(
    IPC_CHANNELS.reportStartupPhase,
    (_event, input: { phase: StartupPhaseEvent }) => windowService.reportStartupPhase(input),
    validateStartupPhase
  )
  ipcDomains.windowLifecycle.handle(IPC_CHANNELS.openDataDirectory, () => windowService.openDataDirectory())
  const backupService = new BackupService({
    store: archiveBackups,
    unresolvedTransferCount: () => database.getRecoveryOperationCount(),
    selectExportPath: async () => {
      const stamp = new Date().toISOString().slice(0, 10)
      const selection = await dialog.showSaveDialog({
        title: 'Export Cairn Codex archive backup',
        defaultPath: join(app.getPath('documents'), `cairn-codex-archive-${stamp}.sqlite3`),
        filters: [{ name: 'Cairn Codex archive', extensions: ['sqlite3'] }]
      })
      return selection.canceled ? null : selection.filePath ?? null
    },
    selectRestorePath: async (defaultDirectory) => {
      const selection = await dialog.showOpenDialog({
        title: 'Restore Cairn Codex archive backup',
        defaultPath: defaultDirectory,
        properties: ['openFile'],
        filters: [
          { name: 'Cairn Codex archive', extensions: ['sqlite3', 'sqlite', 'db'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
      return selection.canceled ? null : selection.filePaths[0] ?? null
    },
    confirmRestore: async () => (await dialog.showMessageBox({
      type: 'warning',
      title: 'Restore Cairn Codex archive?',
      message: 'CC will verify this backup and restart to restore it.',
      detail:
        'Before replacement, CC will preserve the current archive as a verified emergency backup. ' +
        'Grim Dawn stash files are not changed.',
      buttons: ['Cancel', 'Restore and restart'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })).response === 1,
    runBackup: (dedupeKey, reason, operation) =>
      runArchiveBackupJob(jobs, dedupeKey, reason, operation).result,
    runExclusive,
    scheduleRestart: () => setTimeout(() => { app.relaunch(); app.quit() }, 100),
    openPath: (path) => shell.openPath(path)
  })
  ipcDomains.backups.handle(IPC_CHANNELS.getArchiveBackupStatus, () => backupService.getStatus())
  ipcDomains.backups.handle(
    IPC_CHANNELS.createArchiveBackup,
    (): Promise<ArchiveBackupActionResult> => backupService.create()
  )
  ipcDomains.backups.handle(
    IPC_CHANNELS.exportArchiveBackup,
    (): Promise<ArchiveBackupActionResult> => backupService.export()
  )
  ipcDomains.backups.handle(
    IPC_CHANNELS.restoreArchiveBackup,
    (): Promise<ArchiveBackupActionResult> => backupService.restore()
  )
  ipcDomains.backups.handle(
    IPC_CHANNELS.openArchiveBackupDirectory,
    (): Promise<string> => backupService.openDirectory()
  )
  ipcDomains.imports.handle(IPC_CHANNELS.getLastGdiaImportResult, () =>
    readLastGdiaImportResult(gdiaBackupDirectory))
  ipcDomains.imports.handle(IPC_CHANNELS.getGdiaImportProgress, () => gdiaImportProgress)
  const itemAssistantImportService = new ItemAssistantImportService({
    collection: {
      readCollection: async () => {
        latestCollection ??= await readCollectionCache(collectionCachePath)
        return latestCollection
      }
    },
    sourcePicker: {
      pickDatabase: async () => {
        const defaultDatabase = join(
          process.env.LOCALAPPDATA ?? app.getPath('appData'),
          'EvilSoft', 'IAGD', 'data', 'userdata.db'
        )
        const selection = await dialog.showOpenDialog({
          title: 'Import Grim Dawn Item Assistant archive',
          defaultPath: defaultDatabase,
          properties: ['openFile'],
          filters: [
            { name: 'Item Assistant database', extensions: ['db', 'sqlite', 'sqlite3'] },
            { name: 'All files', extensions: ['*'] }
          ]
        })
        return selection.canceled ? null : selection.filePaths[0] ?? null
      }
    },
    analyzer: { analyze: (sourcePath) => analyzeGdiaDatabase(database, sourcePath, gdiaBackupDirectory) },
    reviewer: {
      confirm: async (preflight) => {
        const enoughSpace = preflight.requiredFreeBytes <= preflight.availableFreeBytes
        const confirmation = await dialog.showMessageBox({
          type: enoughSpace ? 'question' : 'warning',
          title: enoughSpace ? 'Import analyzed Item Assistant source?' : 'More free space is required',
          message: enoughSpace
            ? `${preflight.sourceItems.toLocaleString()} Item Assistant copies are ready for review.`
            : 'CC cannot reserve the full verified import footprint.',
          detail: [
            `Source: ${preflight.sourcePath}`,
            `Copies: ${preflight.sourceItems.toLocaleString()} total · ${preflight.sourceSoftcoreItems.toLocaleString()} Softcore · ${preflight.sourceHardcoreItems.toLocaleString()} Hardcore`,
            `Unsupported estimate: ${preflight.unsupportedItems.toLocaleString()}`,
            `Database backup: ${formatImportBytes(preflight.backupBytes)}`,
            `Total required free space: ${formatImportBytes(preflight.requiredFreeBytes)}`,
            `Available free space: ${formatImportBytes(preflight.availableFreeBytes)}`
          ].join('\n'),
          buttons: enoughSpace ? ['Cancel', 'Import'] : ['Close'],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        })
        return enoughSpace && confirmation.response === 1
      }
    },
    committer: {
      commit: (request) => migrateGdiaDatabase(
        database,
        request.sourcePath,
        gdiaBackupDirectory,
        migrationOptionsFromRequest(request)
      )
    },
    receipts: { write: (result) => writeLastGdiaImportResult(gdiaBackupDirectory, result) },
    backups: { enqueue: queueArchiveBackup },
    diagnostics: {
      reportFailure: (boundary, error) => diagnostics.error(
        'item-assistant-import', `${boundary}.failed`, error
      )
    },
    clock: { nowMs: () => Date.now(), nowUtc: () => new Date().toISOString() },
    runExclusive
  })
  ipcDomains.imports.handle(IPC_CHANNELS.importGdiaDatabase, async (event): Promise<GdiaImportResult> => {
    const importJob = jobs.run({
      kind: 'item-assistant-import',
      dedupeKey: 'item-assistant-import:interactive',
      stage: 'queued',
      progress: {
        completed: 0, total: 100, percent: 0, unit: 'steps',
        label: 'Prepare Item Assistant source', detail: 'Waiting for source selection.'
      },
      canCancel: true,
      supportsCancellation: true,
      boundary: 'during source selection',
      completedStage: 'complete', failedStage: 'failed', canceledStage: 'canceled'
    }, async (job) => {
      const publishProgress = (progress: GdiaImportProgress): void => {
        gdiaImportProgress = progress
        if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.gdiaImportProgress, progress)
        job.update({
          stage: progress.stage,
          progress: {
            completed: progress.percent,
            total: 100,
            percent: progress.percent,
            label: progress.label,
            detail: progress.detail
          },
          canCancel: progress.canCancel,
          boundary: progress.canCancel ? 'before archive mutation' : null
        })
      }
      try {
        const result = await itemAssistantImportService.start({
          cancellation: {
            isCancellationRequested: () => {
              try { job.throwIfCancellationRequested(); return false } catch { return true }
            }
          },
          publishProgress
        })
        if (result.canceled) job.finishAsCanceled('canceled')
        return result
      } catch (error) {
        if (error instanceof ItemAssistantImportCanceledError) {
          job.finishAsCanceled('canceled')
          throw new BackgroundJobCanceledError()
        }
        throw error
      }
    }, (result) => ({
      summary: 'Item Assistant import complete.',
      metrics: {
        imported: result.importedItems,
        duplicates: result.duplicateItems,
        unsupported: result.unsupportedItems,
        durationMs: result.durationMs
      }
    }))
    return importJob.result
  })
  ipcDomains.diagnostics.handle(
    IPC_CHANNELS.getRecoveryStatus,
    () => diagnosticsService.getRecoveryStatus()
  )
  ipcDomains.diagnostics.handle(
    IPC_CHANNELS.exportDiagnostics,
    () => diagnosticsService.exportDiagnostics()
  )
  ipcDomains.windowLifecycle.handle(
    IPC_CHANNELS.setZoomFactor,
    (event, input: { factor: number }): number => {
      return windowService.setZoomFactor(event, input)
    },
    validateZoomFactor
  )
  const collectionService = new CollectionService({
    cache: {
      read: async () => {
        const screenshotFixture = process.env.CAIRN_CODEX_SCREENSHOT_PATH
          ? process.env.CAIRN_CODEX_SCREENSHOT_FIXTURE
          : undefined
        if (screenshotFixture) latestCollection = createScreenshotCollectionFixture(screenshotFixture)
        latestCollection ??= await readCollectionCache(collectionCachePath)
        return latestCollection
      },
      write: async (snapshot) => {
        await writeCollectionCache(collectionCachePath, snapshot)
        latestCollection = snapshot
      }
    },
    freshness: {
      isMapIndexFresh: async () => {
        if (process.env.CAIRN_CODEX_SCREENSHOT_PATH) return true
        const mapIndex = await readMapLocationIndex(mapLocationCachePath)
        return Boolean(mapIndex && await mapLocationIndexIsFresh(mapIndex))
      },
      areSourcesFresh: process.env.CAIRN_CODEX_SCREENSHOT_PATH
        ? async () => true
        : collectionStashesAreFresh
    },
    scanner: { scanInstalledData: () => helper.request<CollectionSnapshot>('scan-collection') },
    icons: { attachIcons: (snapshot) => attachItemIcons(helper, jobs, snapshot) },
    maps: {
      attachLocations: async (snapshot, forceRebuild) => {
        const installationPath = snapshot.discovery.installations[0]?.path
        if (!installationPath) return snapshot
        const index = await loadMapLocationIndex(
          helper, jobs, mapLocationCachePath, installationPath, forceRebuild
        )
        return attachMapLocations(snapshot, index)
      }
    },
    archive: { persistSnapshot: (snapshot) => database.persistSnapshot(snapshot) },
    projector: {
      projectSources: projectCollectionSources,
      present: (snapshot, basis) => process.env.CAIRN_CODEX_SCREENSHOT_PATH &&
        process.env.CAIRN_CODEX_SCREENSHOT_FIXTURE === 'bounded-grid-a11y'
        ? Promise.resolve({ ...snapshot, basis })
        : presentCollection(helper, database, snapshot, basis)
    },
    hydration: {
      hydrateAll: ({ installationPath, batchLimit, onProgress }) =>
        runGlobalRollHydration(jobs, async (job) => runDiagnosticOperation(
          'background-job',
          'archive-roll-hydration',
          async () => {
            const mode: boolean | undefined = undefined
            const total = database.countArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION, mode)
            let processed = 0
            let pending = total
            job.update({ progress: { total, completed: 0 } })
            while (pending > 0) {
              job.safeBoundary('before the next analysis batch')
              const candidates = database.listArchiveRollAnalysisCandidates(
                ROLL_ANALYSIS_VERSION, batchLimit, mode
              )
              if (candidates.length === 0) break
              job.update({
                stage: 'analyzing', canCancel: false, boundary: null,
                progress: {
                  completed: processed,
                  label: 'Analyze archived item rolls',
                  detail: 'Processing a bounded batch of ' + candidates.length + ' copies.'
                }
              })
              const analyzed = await helper.request<{ items: ItemRollAnalysis[] }>('analyze-item-rolls', {
                installationPath,
                items: candidates.map(({ payload }) => {
                  const item = payload as LiveVaultPayload
                  return {
                    baseRecord: item.baseRecord,
                    prefixRecord: item.prefixRecord,
                    suffixRecord: item.suffixRecord,
                    seed: item.seed
                  }
                })
              })
              if (analyzed.items.length !== candidates.length) {
                throw new Error(
                  'Roll analysis returned ' + analyzed.items.length +
                  ' results for ' + candidates.length + ' archived copies.'
                )
              }
              job.update({
                stage: 'persisting',
                progress: { label: 'Store roll ratings', detail: 'Committing this bounded batch.' }
              })
              await runExclusive(async () => database.setVaultRollAnalyses(
                candidates.map((candidate, index) => ({
                  id: candidate.id,
                  rollAnalysis: analyzed.items[index]!
                }))
              ))
              processed += candidates.length
              pending = database.countArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION, mode)
              onProgress({ processed, pending })
              job.update({
                progress: { completed: processed, total: processed + pending },
                canCancel: true,
                boundary: 'before the next analysis batch'
              })
              if (pending > 0) await new Promise((resolve) => setTimeout(resolve, 40))
            }
            return { processed, pending }
          },
          { batchLimit },
          (result) => ({ processed: result.processed, pending: result.pending }),
          job.correlationId
        ), (result) => result)
    },
    diagnostics: {
      reportMapIndexFailure: (error) => console.warn('Grim Dawn map locations could not be indexed.', error)
    },
    discovery: {
      discover: () => helper.request<GrimDawnDiscovery>('discover-grim-dawn'),
      listCharacters: (installationPath) =>
        helper.request<CharacterSaveProfile[]>('list-characters', { installationPath })
    },
    preferences: {
      setPinnedBest: (record, instanceKey, isHardcore) =>
        database.setPinnedBest(record, instanceKey, isHardcore),
      getInfiniteSupplies: () => database.getInfiniteSupplies(),
      setInfiniteSupplies: (enabled) => database.setInfiniteSupplies(enabled),
      runExclusive,
      queueArchiveBackup
    },
    catalogPresentationVersion: CATALOG_PRESENTATION_VERSION
  })
  ipcDomains.collection.handle(
    IPC_CHANNELS.discoverGrimDawn,
    () => collectionService.discoverGrimDawn()
  )
  ipcDomains.collection.handle(
    IPC_CHANNELS.listCharacters,
    () => collectionService.listCharacters()
  )
  ipcDomains.collection.handle(
    IPC_CHANNELS.getCachedCollection,
    (_event, input: { sourcePaths: string[]; basis: CollectionBasis }) =>
      collectionService.getCached(input),
    validateCollectionRequest
  )
  ipcDomains.collection.handle(
    IPC_CHANNELS.hydrateArchiveRolls,
    (_event, input: { sourcePaths: string[] }) => collectionService.hydrateArchiveRolls(input),
    validateSourcePaths
  )
  ipcDomains.collection.handle(
    IPC_CHANNELS.scanCollection,
    async (_event, input: { sourcePaths: string[]; basis: CollectionBasis }): Promise<CollectionSnapshot> => {
      const scan = jobs.run({
        kind: 'collection-scan', dedupeKey: 'collection-scan:catalog', stage: 'queued',
        progress: {
          completed: 0, total: 4, percent: 0, unit: 'steps',
          label: 'Refresh collection', detail: 'Preparing the catalog scan.'
        },
        canCancel: false, boundary: null,
        completedStage: 'complete', failedStage: 'failed', canceledStage: 'canceled'
      }, async (job) => runDiagnosticOperation('background-job', 'collection-scan', async () => {
        job.update({
          stage: 'scanning', canCancel: false, boundary: null,
          progress: { completed: 0, label: 'Scan collection', detail: 'Reading installed game data and configured item sources.' }
        })
        return collectionService.scan(input)
      }, undefined, (result) => ({
        catalogItems: result.items.length,
        observedItems: result.observedItems.length,
        warningCount: result.warnings.length
      }), job.correlationId), (result) => ({
        summary: 'Collection scan complete.',
        metrics: { catalogItems: result.items.length, observedItems: result.observedItems.length }
      }))
      return scan.result
    },
    validateCollectionRequest
  )
  ipcDomains.collection.handle(
    IPC_CHANNELS.rebuildGameDataIndex,
    async (_event, input: { sourcePaths: string[]; basis: CollectionBasis }): Promise<CollectionSnapshot> => {
      const rebuild = jobs.run({
        kind: 'game-data-rebuild', dedupeKey: 'game-data-rebuild:catalog', stage: 'queued',
        progress: {
          completed: 0, total: 4, percent: 0, unit: 'steps',
          label: 'Rebuild game-data index', detail: 'Preparing a complete catalog rebuild.'
        },
        canCancel: false, boundary: null,
        completedStage: 'complete', failedStage: 'failed', canceledStage: 'canceled'
      }, async (job) => runDiagnosticOperation('background-job', 'game-data-rebuild', async () => {
        job.update({
          stage: 'scanning', canCancel: false, boundary: null,
          progress: { label: 'Scan installed game data', detail: 'Building a fresh catalog from installed archives.' }
        })
        return collectionService.rebuild(input)
      }, undefined, (result) => ({
        catalogItems: result.items.length,
        observedItems: result.observedItems.length,
        warningCount: result.warnings.length
      }), job.correlationId), (result) => ({
        summary: 'Game-data rebuild complete.',
        metrics: { catalogItems: result.items.length, observedItems: result.observedItems.length }
      }))
      return rebuild.result
    },
    validateCollectionRequest
  )
  ipcDomains.collection.handle(
    IPC_CHANNELS.setPinnedBest,
    (_event, input: { record: string; instanceKey: string | null; isHardcore: boolean }) =>
      collectionService.setPinnedBest(input),
    validatePinnedBest
  )
  ipcDomains.collection.handle(
    IPC_CHANNELS.getInfiniteSupplies,
    () => collectionService.getInfiniteSupplies()
  )
  ipcDomains.collection.handle(
    IPC_CHANNELS.setInfiniteSupplies,
    (_event, input: { enabled: boolean }) => collectionService.setInfiniteSupplies(input),
    booleanField('enabled', 'Infinite supplies must be enabled or disabled explicitly.')
  )
  const archiveService = new ArchiveDomainService({
    reads: {
      findCatalogNames: (records) => database.getCatalogNames([...records]),
      readVaultItems: () => database.listVaultItems(),
      readVaultPage: (request) => database.queryVaultItems(request),
      readOperationHistory: (request) => database.queryOperationHistory(request),
      readVaultSummary: () => {
        const summary = database.getVaultSummary()
        if (
          process.env.CAIRN_CODEX_SCREENSHOT_PATH &&
          process.env.CAIRN_CODEX_SCREENSHOT_FIXTURE === 'onboarding'
        ) return { ...summary, total: 128, ingested: 128 }
        return summary
      }
    },
    stashes: {
      scan: (path) => helper.request<TransferStashScan>('scan-transfer-stash', { path })
    },
    transactions: {
      commitIngest: (input) => executeStagingTabIngest(helper, database, input.path),
      commitRetrieval: (input) => executeLastTabRetrieval(
        helper, database, input.path, input.vaultItemIds
      )
    },
    enqueueArchiveBackup: queueArchiveBackup,
    reportBackupSchedulingFailure: (reason, error) => diagnostics.error(
      'archive-backup', 'post-commit-queue.failed', error, { reason }
    ),
    discoverInstallationPath: async () => {
      const discovered = latestCollection?.discovery ??
        await helper.request<GrimDawnDiscovery>('discover-grim-dawn')
      return discovered.installations[0]?.path ?? null
    },
    simulateDismantling: (installationPath, items) =>
      helper.request<DismantlingPreview>('simulate-dismantling', { installationPath, items })
  })
  ipcDomains.archive.handle(
    IPC_CHANNELS.inspectStagingTab,
    (_event, input: { path: string }): Promise<StagingTabInspection> =>
      archiveService.inspectStagingTab(input.path),
    validatePath
  )
  ipcDomains.archive.handle(
    IPC_CHANNELS.listVaultItems,
    (_event, input?: { isHardcore?: boolean }): VaultListItem[] =>
      input?.isHardcore === undefined
        ? archiveService.listVaultItems()
        : database.listVaultItems(input.isHardcore),
    validateOptionalMode
  )
  ipcDomains.archive.handle(
    IPC_CHANNELS.queryVaultItems,
    (_event, input: VaultPageRequest): VaultItemPage => archiveService.queryVaultItems(input),
    validateVaultPage
  )
  ipcDomains.archive.handle(
    IPC_CHANNELS.queryOperationHistory,
    (_event, input: OperationHistoryRequest): OperationHistoryPage =>
      archiveService.queryOperationHistory(input),
    validateOperationHistory
  )
  ipcDomains.archive.handle(
    IPC_CHANNELS.getVaultSummary,
    (): VaultSummary => {
      return archiveService.getVaultSummary()
    }
  )
  ipcDomains.archive.handle(
    IPC_CHANNELS.previewDismantling,
    (_event, input: { vaultItemIds: string[] }) =>
      archiveService.previewDismantling(input.vaultItemIds),
    validateVaultIds
  )
  ipcDomains.archive.handle(
    IPC_CHANNELS.ingestStagingTab,
    async (_event, input: { path: string }): Promise<IngestResult> => {
      const result = await runDiagnosticOperation(
        'transfer',
        'offline-ingest',
        () => runTransferExclusive(() => archiveService.ingestStagingTab(input.path)),
        undefined,
        (completed) => ({ ingestedItems: completed.ingested.length })
      )
      return result
    },
    validatePath
  )
  ipcDomains.archive.handle(
    IPC_CHANNELS.retrieveVaultItems,
    async (_event, input: { path: string; vaultItemIds: string[] }): Promise<RetrievalResult> => {
      const result = await runDiagnosticOperation(
        'transfer',
        'offline-retrieval',
        () => runTransferExclusive(() => archiveService.retrieveVaultItems(input.path, input.vaultItemIds)),
        { requestedItems: input.vaultItemIds.length },
        (completed) => ({ retrievedItems: completed.retrieved.length })
      )
      return result
    },
    validatePathAndVaultIds
  )
  const liveTransferService = new LiveTransferDomainService({
    journal: {
      readVaultItems: (vaultItemIds, isHardcore) => {
        const summaries = new Map(
          database.listVaultItems(isHardcore).map((item) => [item.id, item])
        )
        const matchingIds = vaultItemIds.filter((id) => summaries.has(id))
        if (matchingIds.length === 0) return []
        return database.getVaultItems(matchingIds, isHardcore).map((item) => {
          const summary = summaries.get(item.id)!
          const payload = item.payload as LiveVaultPayload
          return {
            id: item.id,
            baseRecord: item.baseRecord,
            seed: payload.seed ?? summary.seed,
            isHardcore,
            state: item.state,
            payload: item.payload
          }
        })
      },
      prepareRetrieval: (input) => database.prepareRetrievalOperation({
        operationId: input.operationId,
        stashPath: input.stashPath,
        sourceSha256: input.sourceIdentity,
        startedAtUtc: input.startedAtUtc,
        vaultItemIds: input.vaultItemIds,
        detail: input.detail
      }),
      updatePendingDetail: (operationId, detail) =>
        database.updatePendingOperationDetail(operationId, detail),
      completeRetrieval: (input) => database.completeRetrievalOperation({
        operationId: input.operationId,
        vaultItemIds: input.vaultItemIds,
        backupPath: input.receiptPaths[0]!,
        completedAtUtc: input.completedAtUtc,
        detail: input.detail
      }),
      completePartialRetrieval: (input) => database.completePartialRetrievalOperation(input),
      failRetrieval: (operationId, vaultItemIds, error) =>
        database.failRetrievalOperation(operationId, [...vaultItemIds], error),
      markRetrievalNeedsRecovery: (operationId, error) =>
        database.markRetrievalNeedsRecovery(operationId, error)
    },
    adapter: {
      inspectGame: () => helper.request<LiveGameStatus>('inspect-live-game'),
      enqueueRetrieval: (input) => helper.request<LiveRetrievalQueue>('enqueue-live-retrieval', input),
      inspectRetrieval: (queue) =>
        helper.request<LiveRetrievalStatus>('inspect-live-retrieval', { queue }),
      copyRejectedReceipt: (input) => helper.request<LiveQueueReceipt>('copy-live-incoming', {
        ...input,
        receiptDirectory: join(app.getPath('userData'), 'live-receipts', 'rejected-returns')
      }),
      acknowledgeRejectedReceipt: (input) => helper.request<LiveQueueReceipt>('ack-live-incoming', {
        ...input,
        receiptDirectory: join(app.getPath('userData'), 'live-receipts', 'rejected-returns')
      }).then(() => undefined)
    },
    recovery: {
      reconcile: () => reconcileLiveRecoveryOperations(helper, database, diagnostics).then(() => undefined),
      unresolvedCount: () => database.getRecoveryOperationCount()
    }
  })
  const liveGameService = new LiveGameDomainService({
    visualDiagnosticsActive: () => Boolean(process.env.CAIRN_CODEX_SCREENSHOT_PATH),
    inspectWriteSafety: () => helper.request<WriteSafetyStatus>('inspect-write-safety'),
    inspect: async () => {
      const status = await helper.request<LiveGameStatus>('inspect-live-game')
      if (!process.env.CAIRN_CODEX_SCREENSHOT_PATH) return status
      return {
        ...status,
        state: 'unavailable',
        detail: 'Live transfers are disabled during visual diagnostics.',
        connectedProcessId: null,
        hostWindowReady: false,
        messages: []
      }
    },
    approveBuild: () => helper.request<LiveGameStatus>('approve-live-game-build'),
    start: () => helper.request<LiveGameStatus>('start-live-game'),
    stop: () => helper.request<LiveGameStatus>('stop-live-game'),
    syncIncoming: async () => {
      latestCollection ??= await readCollectionCache(collectionCachePath)
      return syncLiveIncoming(
        helper,
        database,
        latestCollection?.discovery.installations[0]?.path
      )
    },
    retrieveVaultItems: (vaultItemIds) => liveTransferService.retrieveVaultItems(vaultItemIds),
    dispenseAugments: async (input) => {
      latestCollection ??= await readCollectionCache(collectionCachePath)
      if (!latestCollection) throw new Error('Build the game-data index before dispensing augments.')
      return executeLiveAugmentDispense(
        helper, database, latestCollection, input.records, input.expectedCharacterName
      )
    },
    recoverSpecialItem: async (input) => {
      latestCollection ??= await readCollectionCache(collectionCachePath)
      if (!latestCollection) throw new Error('Build the game-data index before recovering Sahdina\'s Memento.')
      return executeSahdinasMementoRecovery(
        helper, database, latestCollection, input.destination, input.expectedCharacterName
      )
    },
    runTransferExclusive,
    diagnostics: {
      run: (event, operation, startData, completedData) =>
        runDiagnosticOperation('transfer', event, operation, startData, completedData)
    },
    queueArchiveBackup
  })
  ipcDomains.liveTransfers.handle(
    IPC_CHANNELS.inspectWriteSafety,
    () => liveGameService.inspectWriteSafety()
  )
  ipcDomains.liveTransfers.handle(
    IPC_CHANNELS.inspectLiveGame,
    () => liveGameService.inspect()
  )
  ipcDomains.liveTransfers.handle(
    IPC_CHANNELS.approveLiveGameBuild,
    () => liveGameService.approveBuild()
  )
  ipcDomains.liveTransfers.handle(
    IPC_CHANNELS.startLiveGame,
    () => liveGameService.start()
  )
  ipcDomains.liveTransfers.handle(
    IPC_CHANNELS.stopLiveGame,
    () => liveGameService.stop()
  )
  ipcDomains.liveTransfers.handle(
    IPC_CHANNELS.syncLiveGame,
    () => liveGameService.sync()
  )
  ipcDomains.liveTransfers.handle(
    IPC_CHANNELS.retrieveLiveVaultItems,
    (_event, input: { vaultItemIds: string[] }) => liveGameService.retrieve(input.vaultItemIds),
    validateVaultIds
  )
  ipcDomains.liveTransfers.handle(
    IPC_CHANNELS.dispenseLiveAugments,
    (_event, input: { records: string[]; expectedCharacterName?: string }) =>
      liveGameService.dispense(input),
    validateSupplyDispense
  )
  ipcDomains.liveTransfers.handle(
    IPC_CHANNELS.recoverSahdinasMemento,
    (_event, input: { destination: SpecialRecoveryDestination; expectedCharacterName?: string }) =>
      liveGameService.recover(input),
    validateSpecialRecovery
  )
  return async () => {
    stopPublishingJobs()
    await queuedArchiveBackups.flush()
    await preferenceStore.flush()
    await operations.flush()
    await archiveBackups.flush()
    diagnostics.info('startup', 'application.shutdown')
    await diagnostics.flush()
  }
}

function createScreenshotCollectionFixture(name: string): CollectionSnapshot {
  if (name === 'onboarding') return createScreenshotCollectionFixture('search-help')
  if (name === 'settings') {
    const fixture = createScreenshotCollectionFixture('search-help')
    const stashes = [false, true].map((isHardcore) => ({
      path: `C:\\Synthetic QA\\settings\\${isHardcore ? 'transfer.gsh' : 'transfer.gst'}`,
      isHardcore,
      modLabel: 'Main campaign',
      itemCount: 0,
      lastWriteUtc: '2026-09-02T00:00:00.000Z',
      sha256: (isHardcore ? '1' : '0').repeat(64)
    }))
    return { ...fixture, basis: 'archive', scannedStashes: stashes, availableStashes: stashes }
  }
  if (name === 'bounded-grid-a11y') {
    const fixture = createScreenshotCollectionFixture('skill-explorer')
    const supplySlotFamilies = ['weapon', 'armor', 'jewelry'] as const
    const items = fixture.items.map((item, index): CollectionItem => {
      if (index < 60) return item
      const presentation = item.presentation!
      return {
        ...item,
        presentation: {
          ...presentation,
          sections: presentation.sections.map((section) => ({
            ...section,
            heading: section.heading === 'Wendigo Totem' ? 'Savagery' : section.heading,
            lines: section.lines.map((line) => ({
              ...line,
              label: line.label.replace('Wendigo Totem', 'Savagery')
            }))
          })),
          searchText: presentation.searchText.replaceAll('wendigo totem', 'savagery')
        }
      }
    })
    const supplies = items.slice(0, 6).map((item, index): CollectionItem => ({
      ...item,
      record: `records/items/synthetic/a11y_augment_${index}.dbr`,
      name: `Accessible Grid Augment ${index + 1}`,
      rarity: 'faction',
      itemClass: 'augment',
      slot: 'augment',
      supplySlotFamilies: [supplySlotFamilies[index % supplySlotFamilies.length]!],
      availableCount: 0,
      discovered: true,
      acquisition: {
        sources: ['Synthetic QA faction vendor'],
        sourceRecords: [],
        locations: [],
        factions: [{
          kind: 'item',
          faction: 'Synthetic QA',
          reputation: 'Revered',
          vendorRecord: `records/creatures/npcs/merchants/synthetic_a11y_${index}.dbr`
        }],
        crafting: null
      }
    }))
    return {
      ...fixture,
      items,
      supplies,
      supplySummary: { rarity: 'supply', total: supplies.length, collected: 0, availableCopies: 0 },
      skillMasteries: { ...fixture.skillMasteries, Savagery: 'Shaman' }
    }
  }
  if (name === 'farming-routes') {
    const fixture = createScreenshotCollectionFixture('search-help')
    const template = fixture.items[0]!
    const rarities = ['mi', 'epic', 'legendary'] as const
    const contentPacks = ['base', 'gdx1', 'gdx2', 'gdx3'] as const
    const items = Array.from({ length: 214 }, (_, routeIndex) =>
      Array.from({ length: routeIndex === 0 ? 13 : 1 }, (_, itemIndex): CollectionItem => {
        const routeNumber = String(routeIndex + 1).padStart(3, '0')
        const rarity = rarities[routeIndex % rarities.length]!
        const contentPack = contentPacks[routeIndex % contentPacks.length]!
        return {
          ...template,
          record: `records/items/synthetic/farming_route_${routeNumber}_item_${itemIndex}.dbr`,
          name: `Route ${routeNumber} Missing Base ${String(itemIndex + 1).padStart(2, '0')}`,
          rarity,
          levelRequirement: 1 + routeIndex % 94,
          itemLevel: 1 + routeIndex % 94,
          availableCount: 0,
          discovered: false,
          acquisition: {
            sources: [`Dropped by Route ${routeNumber} Guardian`],
            sourceRecords: [],
            factions: [],
            crafting: null,
            locations: [{
              name: `Synthetic Route ${routeNumber}`,
              routeName: `Rift ${1 + routeIndex % 7}`,
              zoneRecord: `records/levels/synthetic/farming_route_${routeNumber}.dbr`,
              levelFile: `levels/synthetic/farming_route_${routeNumber}.lvl`,
              contentPack,
              originX: routeIndex * 10,
              originY: routeIndex * 5
            }]
          },
          presentation: {
            ...template.presentation!,
            searchText: `synthetic farming route ${routeNumber} ${rarity}`
          }
        }
      })
    ).flat()
    return {
      ...fixture,
      items,
      observedItems: [],
      rarities: rarities.map((rarity) => ({
        rarity,
        total: items.filter((item) => item.rarity === rarity).length,
        collected: 0,
        availableCopies: 0
      }))
    }
  }
  if (name === 'planner') {
    const fixture = createScreenshotCollectionFixture('search-help')
    const template = fixture.items[0]!
    const rarities = ['legendary', 'epic', 'mi', 'faction'] as const
    const slots = ['head', 'chest', 'shoulders', 'medal', 'sword', 'offhand'] as const
    const items = Array.from({ length: 120 }, (_, index): CollectionItem => {
      const rarity = rarities[index % rarities.length]!
      const slot = slots[index % slots.length]!
      const conversionTarget = ['Vitality', 'Cold', 'Lightning', 'Acid'][index % 4]!
      return {
        ...template,
        record: `records/items/synthetic/planner_support_${index}.dbr`,
        name: `Wendigo Field Kit ${String(index + 1).padStart(3, '0')}`,
        rarity,
        itemClass: slot === 'sword' ? 'weapon_sword' : `armor_${slot}`,
        slot,
        levelRequirement: 1 + index % 70,
        itemLevel: 1 + index % 70,
        availableCount: index % 5 === 0 ? 1 : 0,
        discovered: index % 5 === 0,
        acquisition: Math.floor(index / 4) % 2 === 1 && template.acquisition
          ? {
              ...template.acquisition,
              locations: [{
                ...template.acquisition.locations![0]!,
                name: 'Review Hollow',
                routeName: 'Typed Route Review',
                zoneRecord: 'records/levels/synthetic/review_hollow.dbr',
                levelFile: 'levels/synthetic/review_hollow.map',
                originX: 240,
                originY: 180
              }]
            }
          : template.acquisition,
        presentation: {
          flavorText: null,
          sections: [{
            kind: 'base',
            heading: null,
            lines: [{
              label: 'to Wendigo Totem',
              minimum: 1 + index % 3,
              maximum: 1 + index % 3,
              unit: '',
              tone: 'skill',
              prefix: '+',
              suffix: ''
            }]
          }, {
            kind: 'skill-modifier',
            heading: 'Wendigo Totem',
            lines: [{
              label: `Bleeding Damage converted to ${conversionTarget} Damage`,
              minimum: 20 + index % 31,
              maximum: 20 + index % 31,
              unit: '%',
              tone: 'standard',
              prefix: '',
              suffix: ''
            }, {
              label: 'Skill Recharge',
              minimum: -(index % 4 + 1) * 0.25,
              maximum: -(index % 4 + 1) * 0.25,
              unit: 's',
              tone: 'standard',
              prefix: '',
              suffix: ''
            }]
          }],
          grantedSkill: null,
          searchText: `wendigo totem ${conversionTarget.toLocaleLowerCase()} damage leveling planner synthetic qa`
        }
      }
    })
    return {
      ...fixture,
      items,
      rarities: rarities.map((rarity) => ({
        rarity,
        total: items.filter((item) => item.rarity === rarity).length,
        collected: items.filter((item) => item.rarity === rarity && item.discovered).length,
        availableCopies: items.filter((item) => item.rarity === rarity).reduce((total, item) => total + item.availableCount, 0)
      })),
      skillMasteries: {
        'Curse of Frailty': 'Occultist',
        'Summon Hellhound': 'Occultist',
        'Summon Briarthorn': 'Shaman',
        'Wendigo Totem': 'Shaman',
        'Raise Skeletons': 'Necromancer',
        'Field Command': 'Soldier'
      },
      skillClassNames: {
        'Occultist|Shaman': 'Conjurer',
        'Necromancer|Soldier': 'Death Knight'
      }
    }
  }
  if (name === 'sets-bounded') {
    const items = Array.from({ length: 202 }, (_, index) => {
      const ordinal = String(index + 1).padStart(3, '0')
      const setName = `Bounded Set ${ordinal}`
      const setRecord = `records/items/synthetic/bounded_set_${ordinal}.dbr`
      const rarity = index % 2 === 0 ? 'legendary' as const : 'epic' as const
      const level = rarity === 'legendary' ? 94 : 50
      const state = index % 4
      const visual = index % 7 === 0
      const setPresentation = {
        name: setName,
        description: 'Synthetic detailed set used only for bounded renderer verification.',
        members: [`${setName} Crown`, `${setName} Guard`],
        tiers: [{
          requiredPieces: 2,
          lines: [{
            label: 'All Damage', minimum: 80 + index % 21, maximum: 80 + index % 21,
            unit: '%' as const, tone: 'standard' as const, prefix: '+', suffix: ''
          }],
          petLines: [],
          skillModifiers: visual ? [{
            kind: 'visual-modifier' as const,
            heading: 'Synthetic Skill · Visual transformation',
            lines: [{
              label: 'Alternate bounded verification effect', minimum: null, maximum: null,
              unit: '' as const, tone: 'visual' as const, prefix: '', suffix: ''
            }]
          }] : [],
          grantedSkill: null
        }]
      }
      return [
        createScreenshotSetItem({
          record: `records/items/synthetic/bounded_${ordinal}_crown.dbr`,
          name: `${setName} Crown`, rarity, slot: 'head', level, setName, setRecord,
          availableCount: state === 0 || state === 1 ? 1 : 0,
          discovered: state === 0 || state === 1,
          bestRollPercentile: state === 0 || state === 1 ? 70 + index % 25 : undefined,
          recipeUnlocked: state === 2,
          setPresentation,
          visual
        }),
        createScreenshotSetItem({
          record: `records/items/synthetic/bounded_${ordinal}_guard.dbr`,
          name: `${setName} Guard`, rarity, slot: 'chest', level, setName, setRecord,
          availableCount: state === 0 ? 1 : 0,
          discovered: state === 0,
          bestRollPercentile: state === 0 ? 65 + index % 30 : undefined,
          availableViaAwakening: state === 2,
          awakeningSourceAvailableCount: state === 2 ? 1 : 0,
          awakeningSourceName: state === 2 ? `${setName} Mark` : undefined,
          setPresentation
        })
      ]
    }).flat()
    return {
      ...createScreenshotCollectionFixture('search-help'),
      items,
      rarities: (['epic', 'legendary'] as const).map((rarity) => ({
        rarity,
        total: items.filter((item) => item.rarity === rarity).length,
        collected: items.filter((item) => item.rarity === rarity && item.discovered).length,
        availableCopies: items
          .filter((item) => item.rarity === rarity)
          .reduce((total, item) => total + item.availableCount, 0)
      }))
    }
  }
  if (name === 'sets-semantics') {
    const setPresentation = {
      name: 'Veil of the Cairn',
      description: 'Synthetic set used only for isolated UI verification.',
      members: ['Cairn Hood', 'Cairn Mantle', 'Cairn Sigil'],
      tiers: [{
        requiredPieces: 2,
        lines: [{
          label: 'Vitality Damage', minimum: 80, maximum: 80, unit: '%' as const,
          tone: 'standard' as const, prefix: '+', suffix: ''
        }],
        petLines: [],
        skillModifiers: [{
          kind: 'visual-modifier' as const,
          heading: 'Wendigo Totem · Visual transformation',
          lines: [{
            label: 'Alternate crimson spirit effect', minimum: null, maximum: null, unit: '' as const,
            tone: 'visual' as const, prefix: '', suffix: ''
          }]
        }],
        grantedSkill: null
      }]
    }
    const items = [
      createScreenshotSetItem({
        record: 'records/items/synthetic/cairn_hood.dbr', name: 'Cairn Hood', rarity: 'legendary',
        slot: 'head', level: 94, setName: 'Veil of the Cairn', setRecord: 'records/items/synthetic/cairn_set.dbr',
        availableCount: 2, discovered: true, bestRollPercentile: 72.5, setPresentation, visual: true
      }),
      createScreenshotSetItem({
        record: 'records/items/synthetic/cairn_mantle.dbr', name: 'Cairn Mantle', rarity: 'legendary',
        slot: 'shoulders', level: 94, setName: 'Veil of the Cairn', setRecord: 'records/items/synthetic/cairn_set.dbr',
        recipeUnlocked: true, setPresentation
      }),
      createScreenshotSetItem({
        record: 'records/items/synthetic/cairn_sigil.dbr', name: 'Cairn Sigil', rarity: 'legendary',
        slot: 'medal', level: 94, setName: 'Veil of the Cairn', setRecord: 'records/items/synthetic/cairn_set.dbr',
        availableViaAwakening: true, awakeningSourceAvailableCount: 1,
        awakeningSourceName: 'Cairn Mark', setPresentation
      }),
      createScreenshotSetItem({
        record: 'records/items/synthetic/warden_guard.dbr', name: "Warden's Guard", rarity: 'epic',
        slot: 'chest', level: 50, setName: "Warden's Vigil", setRecord: 'records/items/synthetic/warden_set.dbr',
        availableCount: 1, discovered: true, bestRollPercentile: 91
      }),
      createScreenshotSetItem({
        record: 'records/items/synthetic/warden_step.dbr', name: "Warden's Step", rarity: 'epic',
        slot: 'feet', level: 50, setName: "Warden's Vigil", setRecord: 'records/items/synthetic/warden_set.dbr',
        availableCount: 1, discovered: true, bestRollPercentile: 79
      }),
      createScreenshotSetItem({
        record: 'records/items/synthetic/forgotten_crown.dbr', name: 'Forgotten Crown', rarity: 'legendary',
        slot: 'head', level: 75, setName: 'Forgotten Oath', setRecord: 'records/items/synthetic/forgotten_set.dbr',
        discovered: true
      }),
      createScreenshotSetItem({
        record: 'records/items/synthetic/forgotten_blade.dbr', name: 'Forgotten Blade', rarity: 'legendary',
        slot: 'sword', level: 75, setName: 'Forgotten Oath', setRecord: 'records/items/synthetic/forgotten_set.dbr'
      })
    ]
    return {
      ...createScreenshotCollectionFixture('search-help'),
      items,
      rarities: [
        { rarity: 'epic', total: 2, collected: 2, availableCopies: 2 },
        { rarity: 'legendary', total: 5, collected: 2, availableCopies: 2 }
      ]
    }
  }
  if (name === 'mi-workshop') {
    const fixture = createScreenshotCollectionFixture('search-help')
    const syntheticStash = {
      path: 'C:\\Synthetic QA\\route-fixtures\\transfer.gst',
      isHardcore: false,
      modLabel: 'Main campaign',
      itemCount: 72,
      lastWriteUtc: '2026-09-01T12:00:00.000Z',
      sha256: '0'.repeat(64)
    }
    const template = fixture.items[0]!
    const bases = Array.from({ length: 6 }, (_, index): CollectionItem => ({
      ...template,
      record: `records/items/synthetic/mi_base_${index}.dbr`,
      name: ['Bloodsworn Repeater', 'Yeti Horn', 'Leafmane Trophy', 'Voidplume Crest', 'Korvan Gaze', 'Ugdenbog Edge'][index]!,
      rarity: 'mi',
      itemClass: index % 2 === 0 ? 'weapon_sword' : 'armor_medal',
      slot: index % 2 === 0 ? 'sword' : 'medal',
      levelRequirement: 35 + index * 12,
      itemLevel: 35 + index * 12,
      availableCount: 12,
      analyzedCopyCount: 12,
      bestRollPercentile: 94 - index * 4,
      discovered: true,
      presentation: {
        ...template.presentation!,
        searchText: `synthetic monster infrequent ${index % 2 === 0 ? 'physical damage' : 'vitality damage'}`
      }
    }))
    const prefixes = Array.from({ length: 12 }, (_, index) => ({
      key: `synthetic-prefix-${index}`,
      name: ['Void-Touched', 'Subjugator\'s', 'Glacial', 'Impervious', 'Devouring', 'Thunderstruck'][index % 6]! + (index >= 6 ? ' Prime' : ''),
      kind: 'prefix' as const,
      rarity: index % 3 === 0 ? 'magical' as const : 'rare' as const,
      records: [`records/items/synthetic/prefix_${index}.dbr`],
      availableCount: 6
    }))
    const suffixes = Array.from({ length: 12 }, (_, index) => ({
      key: `synthetic-suffix-${index}`,
      name: ['of Alacrity', 'of Binding', 'of Frostbite', 'of the Cabal', 'of Corrupted Peaks', 'of Scorching'][index % 6]! + (index >= 6 ? ' Prime' : ''),
      kind: 'suffix' as const,
      rarity: index % 4 === 0 ? 'magical' as const : 'rare' as const,
      records: [`records/items/synthetic/suffix_${index}.dbr`],
      availableCount: 6
    }))
    const observedItems = Array.from({ length: 72 }, (_, index): ObservedStashItem => {
      const base = bases[Math.floor(index / 12)]!
      const prefix = prefixes[index % 12]!
      const suffix = suffixes[(index * 5) % 12]!
      const percentile = 20 + (index * 17) % 79
      return {
        sourcePath: syntheticStash.path,
        tabIndex: Math.floor(index / 24),
        itemIndex: index % 24,
        baseRecord: base.record,
        prefixRecord: prefix.records[0]!,
        suffixRecord: suffix.records[0]!,
        modifierRecord: '',
        transmuteRecord: '',
        seed: 1_000_000 + index,
        materiaRecord: '',
        relicCompletionBonusRecord: '',
        relicSeed: 0,
        enchantmentRecord: '',
        ascendantRecord: '',
        ascendantRecord2H: '',
        enchantmentSeed: 0,
        materiaCombines: 0,
        stackCount: 1,
        rerolls: 0,
        affixRerolls: 0,
        instanceKey: `fixture-mi-${index}`,
        rollAnalysis: {
          modelVersion: 4,
          baseRecord: base.record,
          prefixRecord: prefix.records[0]!,
          suffixRecord: suffix.records[0]!,
          seed: 1_000_000 + index,
          supported: true,
          trusted: true,
          reason: null,
          percentileSampleSize: 1_000,
          overallEstimatedPercentile: percentile,
          baseEstimatedPercentile: Math.max(1, percentile - 7),
          prefixEstimatedPercentile: Math.min(99, percentile + 5),
          suffixEstimatedPercentile: Math.max(1, percentile - 3),
          stats: [{
            field: 'offensivePhysicalModifier',
            value: 80 + index,
            rollable: true,
            observedMinimum: 75,
            observedMaximum: 155,
            estimatedPercentile: percentile
          }],
          petStats: [],
          unmodeledFields: []
        }
      }
    })
    return {
      ...fixture,
      scannedStashes: [syntheticStash],
      availableStashes: [syntheticStash],
      observedItems,
      items: bases,
      rarities: [{ rarity: 'mi', total: bases.length, collected: bases.length, availableCopies: observedItems.length }],
      affixes: [...prefixes, ...suffixes],
      affixSummary: { total: prefixes.length + suffixes.length, collected: prefixes.length + suffixes.length, availableCopies: observedItems.length * 2 }
    }
  }
  if (name === 'skill-explorer') {
    const fixture = createScreenshotCollectionFixture('search-help')
    const template = fixture.items[0]!
    const rarities = ['legendary', 'epic', 'rare'] as const
    const slots = ['head', 'chest', 'shoulders', 'medal', 'sword', 'offhand'] as const
    const items = Array.from({ length: 120 }, (_, index): CollectionItem => {
      const rarity = rarities[index % rarities.length]!
      const slot = slots[index % slots.length]!
      const conversionTarget = ['Vitality', 'Cold', 'Lightning', 'Acid'][index % 4]!
      return {
        ...template,
        record: `records/items/synthetic/skill_support_${index}.dbr`,
        name: `Totemic Research ${String(index + 1).padStart(3, '0')}`,
        rarity,
        itemClass: slot === 'sword' ? 'weapon_sword' : `armor_${slot}`,
        slot,
        levelRequirement: 20 + index % 75,
        itemLevel: 20 + index % 75,
        availableCount: index % 4 === 0 ? 1 : 0,
        discovered: index % 4 === 0,
        presentation: {
          flavorText: null,
          sections: [{
            kind: 'base',
            heading: null,
            lines: [{
              label: 'to Wendigo Totem',
              minimum: 1 + index % 3,
              maximum: 1 + index % 3,
              unit: '',
              tone: 'skill',
              prefix: '+',
              suffix: ''
            }]
          }, {
            kind: 'skill-modifier',
            heading: 'Wendigo Totem',
            lines: [{
              label: `Bleeding Damage converted to ${conversionTarget} Damage`,
              minimum: 20 + index % 31,
              maximum: 20 + index % 31,
              unit: '%',
              tone: 'standard',
              prefix: '',
              suffix: ''
            }, {
              label: 'Skill Recharge',
              minimum: -(index % 4 + 1) * 0.25,
              maximum: -(index % 4 + 1) * 0.25,
              unit: 's',
              tone: 'standard',
              prefix: '',
              suffix: ''
            }]
          }],
          grantedSkill: null,
          searchText: `wendigo totem ${conversionTarget.toLocaleLowerCase()} damage skill recharge synthetic qa`
        }
      }
    })
    return {
      ...fixture,
      items,
      rarities: rarities.map((rarity) => ({
        rarity,
        total: items.filter((item) => item.rarity === rarity).length,
        collected: items.filter((item) => item.rarity === rarity && item.discovered).length,
        availableCopies: items.filter((item) => item.rarity === rarity).reduce((total, item) => total + item.availableCount, 0)
      })),
      skillMasteries: Object.fromEntries([
        ['Wendigo Totem', 'Shaman'],
        ...Array.from({ length: 60 }, (_, index) => [
          `Synthetic Skill ${String(index + 1).padStart(3, '0')}`,
          'Synthetic QA'
        ])
      ])
    }
  }
  if (name !== 'search-help') throw new Error(`Unknown screenshot fixture: ${name}`)
  return {
    catalogPresentationVersion: CATALOG_PRESENTATION_VERSION,
    cacheNeedsRefresh: false,
    basis: 'stashes',
    scannedAtUtc: '2026-09-01T00:00:00.000Z',
    discovery: { installations: [], saveLocations: [] },
    contentPacks: [],
    scannedStashes: [],
    availableStashes: [],
    observedItems: [],
    warnings: [],
    rarities: [],
    items: [{
      record: 'records/items/synthetic/searchlight.dbr',
      name: 'Mythical Searchlight',
      rarity: 'legendary',
      itemClass: 'armor_head',
      slot: 'head',
      levelRequirement: 84,
      itemLevel: 84,
      setName: null,
      setRecord: null,
      bitmap: null,
      contentPack: 'Synthetic QA',
      acquisition: {
        sources: ['Synthetic QA source'],
        sourceRecords: [],
        locations: [{
          name: 'QA Hollow',
          routeName: 'Search Tips Route',
          zoneRecord: 'records/levels/synthetic/qa_hollow.dbr',
          levelFile: 'levels/synthetic/qa_hollow.map',
          contentPack: 'Synthetic QA',
          originX: 0,
          originY: 0
        }],
        additionalLocationCount: 0,
        factions: [],
        crafting: null
      },
      presentation: {
        flavorText: null,
        sections: [{
          kind: 'base',
          heading: null,
          lines: [{
            label: 'Fire Resistance',
            minimum: 100,
            maximum: 100,
            unit: '%',
            tone: 'standard',
            prefix: '+',
            suffix: ''
          }]
        }],
        grantedSkill: null,
        searchText: 'fire resistance synthetic qa ward'
      },
      supplySlotFamilies: null,
      availableCount: 0,
      bestRollPercentile: null,
      analyzedCopyCount: 0,
      pinnedInstanceKey: null,
      discovered: false,
      recipeUnlocked: false,
      firstDiscoveredAt: null
    }],
    recipeSummary: { total: 0, collected: 0, unlockedItems: 0 },
    supplySummary: { rarity: 'supply', total: 0, collected: 0, availableCopies: 0 },
    affixSummary: { total: 0, collected: 0, availableCopies: 0 },
    affixes: [],
    plannerItems: [],
    supplies: [],
    materials: [],
    uiIcons: {},
    accountStores: [],
    skillMasteries: {},
    skillClassNames: {}
  }
}

function createScreenshotSetItem(input: {
  record: string
  name: string
  rarity: 'epic' | 'legendary'
  slot: string
  level: number
  setName: string
  setRecord: string
  availableCount?: number
  bestRollPercentile?: number
  discovered?: boolean
  recipeUnlocked?: boolean
  availableViaAwakening?: boolean
  awakeningSourceAvailableCount?: number
  awakeningSourceName?: string
  setPresentation?: CollectionItem['setPresentation']
  visual?: boolean
}): CollectionItem {
  return {
    record: input.record,
    name: input.name,
    rarity: input.rarity,
    itemClass: `armor_${input.slot}`,
    slot: input.slot,
    levelRequirement: input.level,
    itemLevel: input.level,
    setName: input.setName,
    setRecord: input.setRecord,
    bitmap: null,
    contentPack: 'Synthetic QA',
    setPresentation: input.setPresentation ?? null,
    presentation: input.visual ? {
      flavorText: null,
      sections: [{
        kind: 'visual-modifier',
        heading: 'Wendigo Totem · Visual transformation',
        lines: [{
          label: 'Alternate crimson spirit effect', minimum: null, maximum: null,
          unit: '', tone: 'visual', prefix: '', suffix: ''
        }]
      }],
      grantedSkill: null,
      searchText: 'wendigo totem vitality damage alternate crimson spirit effect'
    } : undefined,
    availableCount: input.availableCount ?? 0,
    bestRollPercentile: input.bestRollPercentile ?? null,
    analyzedCopyCount: input.bestRollPercentile === undefined ? 0 : 1,
    pinnedInstanceKey: null,
    discovered: input.discovered ?? false,
    recipeUnlocked: input.recipeUnlocked ?? false,
    availableViaAwakening: input.availableViaAwakening ?? false,
    awakeningSourceRecord: input.availableViaAwakening ? `${input.record}.base` : null,
    awakeningSourceName: input.awakeningSourceName ?? null,
    awakeningSourceAvailableCount: input.awakeningSourceAvailableCount ?? 0,
    firstDiscoveredAt: input.discovered ? '2026-09-01T00:00:00.000Z' : null
  }
}

async function syncLiveIncoming(
  helper: HelperRequester,
  database: CollectionDatabase,
  installationPath?: string
): Promise<LiveGameSyncResult> {
  const status = await helper.request<LiveGameStatus>('inspect-live-game')
  const incoming = await helper.request<LiveIncomingItem[]>('poll-live-incoming')
  if (status.state !== 'ready' && incoming.length === 0) {
    return { status, ingested: [], issues: [] }
  }
  const ingested: LiveGameSyncResult['ingested'] = []
  const analysisInputs: Array<{ vaultItemId: string; item: LiveVaultPayload }> = []
  const issues: string[] = []
  for (const source of incoming) {
    const catalogName = database.getCatalogNames([source.item.baseRecord]).get(
      source.item.baseRecord.toLowerCase()
    )
    const name = catalogName ?? database.ensureQuarantineCatalogItem(source.item.baseRecord)
    const identity = createHash('sha256')
      .update(source.path.toLowerCase())
      .update('\0')
      .update(source.sha256)
      .digest('hex')
    const operationId = `live-ingest-${identity}`
    const vaultItemId = `live-${identity}`
    if (database.hasCommittedOperation(operationId)) {
      try {
        await helper.request<LiveQueueReceipt>('ack-live-incoming', {
          path: source.path,
          expectedSha256: source.sha256,
          receiptDirectory: join(app.getPath('userData'), 'live-receipts', 'ingested')
        })
      } catch (error) {
        issues.push(`${name}: committed earlier, but queue acknowledgement still failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      continue
    }
    let prepared = false
    let committed = false
    try {
      const receipt = await helper.request<LiveQueueReceipt>('copy-live-incoming', {
        path: source.path,
        expectedSha256: source.sha256,
        receiptDirectory: join(app.getPath('userData'), 'live-receipts', 'ingested')
      })
      database.prepareIngestOperation({
        operationId,
        stashPath: `live://gdia/${source.isHardcore ? 'hc' : 'sc'}/${source.path.split(/[\\/]/).at(-1)}`,
        sourceSha256: source.sha256,
        startedAtUtc: new Date().toISOString(),
        items: [{ vaultItemId, baseRecord: source.item.baseRecord, payload: source.item }],
        detail: { phase: 'receipt_verified', adapter: 'gdia-live-v1', receiptPath: receipt.receiptPath }
      })
      prepared = true
      database.completeIngestOperation({
        operationId,
        backupPath: receipt.receiptPath,
        completedAtUtc: new Date().toISOString(),
        isHardcore: source.isHardcore,
        detail: { phase: 'committed', adapter: 'gdia-live-v1', receiptPath: receipt.receiptPath }
      })
      committed = true
      await helper.request<LiveQueueReceipt>('ack-live-incoming', {
        path: source.path,
        expectedSha256: source.sha256,
        receiptDirectory: join(app.getPath('userData'), 'live-receipts', 'ingested')
      })
      ingested.push({
        vaultItemId,
        baseRecord: source.item.baseRecord,
        prefixRecord: source.item.prefixRecord,
        suffixRecord: source.item.suffixRecord,
        name,
        seed: source.item.seed,
        instanceKey: createVaultInstanceKey(source.item),
        rollAnalysis: null
      })
      analysisInputs.push({ vaultItemId, item: source.item })
      if (!catalogName) {
        issues.push(
          `${name} was safely stored outside the Epic/Legendary/MI collection. ` +
            'It is available in Vault quarantine for an immediate live return.'
        )
      }
    } catch (error) {
      if (prepared && !committed) database.failIngestOperation(operationId, error)
      issues.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (installationPath && analysisInputs.length > 0) {
    try {
      const analyzed = await helper.request<{ items: ItemRollAnalysis[] }>('analyze-item-rolls', {
        installationPath,
        items: analysisInputs.map(({ item }) => ({
          baseRecord: item.baseRecord,
          prefixRecord: item.prefixRecord,
          suffixRecord: item.suffixRecord,
          seed: item.seed
        }))
      })
      const updates = analysisInputs.flatMap(({ vaultItemId }, index) => {
        const rollAnalysis = analyzed.items[index]
        const result = ingested.find((item) => item.vaultItemId === vaultItemId)
        if (!rollAnalysis || !result) return []
        result.rollAnalysis = rollAnalysis
        return [{ id: vaultItemId, rollAnalysis }]
      })
      database.setVaultRollAnalyses(updates)
    } catch (error) {
      issues.push(`Roll analysis will retry in the background: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return {
    status: await helper.request<LiveGameStatus>('inspect-live-game'),
    ingested,
    issues
  }
}

async function executeLiveRetrieval(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  vaultItemIds: string[]
): Promise<LiveRetrievalResult> {
  if (vaultItemIds.length === 0) throw new Error('Select at least one vault item to retrieve.')
  if (new Set(vaultItemIds).size !== vaultItemIds.length) {
    throw new Error('The live retrieval selection contains a duplicate archive item.')
  }
  const listed = new Map(database.listVaultItems().map((item) => [item.id, item]))
  const selected = vaultItemIds.map((id) => {
    const item = listed.get(id)
    if (!item) throw new Error(`Vault item does not exist: ${id}`)
    return item
  })
  const modes = new Set(selected.map((item) => item.isHardcore))
  if (modes.size !== 1) throw new Error('A live retrieval cannot mix Hardcore and Softcore items.')
  const unavailable = selected.filter((item) => item.state !== 'ingested')
  if (unavailable.length > 0) {
    throw new Error('Vault items are not available: ' + unavailable.map((item) => item.id).join(', '))
  }

  const retrieved: LiveRetrievalResult['retrieved'] = []
  const receiptPaths: string[] = []
  const issues: string[] = []
  for (const vaultItemId of vaultItemIds) {
    try {
      const result = await executeSingleLiveRetrieval(helper, database, vaultItemId)
      retrieved.push(...result.retrieved)
      receiptPaths.push(...result.receiptPaths)
    } catch (error) {
      if (retrieved.length === 0) throw error
      issues.push(error instanceof Error ? error.message : String(error))
      break
    }
  }
  return {
    operationId: randomUUID(),
    status: 'committed',
    retrieved,
    receiptPaths,
    issues
  }
}

const reputationThresholds: Record<string, number> = {
  tolerated: 0,
  friendly: 1_500,
  respected: 5_000,
  honored: 10_000,
  revered: 25_000
}

function normalizedFactionName(value: string): string {
  return value
    .toLocaleLowerCase()
    .replaceAll('’', "'")
    .replace(/[^a-z0-9]/g, '')
}

function createSupplyPayload(baseRecord: string): LiveVaultPayload {
  return {
    stashVersion: 11,
    sourceTabIndex: -1,
    sourceItemIndex: -1,
    baseRecord,
    prefixRecord: '',
    suffixRecord: '',
    modifierRecord: '',
    transmuteRecord: '',
    seed: randomInt(1, 0xffff_ffff),
    materiaRecord: '',
    relicCompletionBonusRecord: '',
    relicSeed: 0,
    enchantmentRecord: '',
    ascendantRecord: '',
    ascendantRecord2H: '',
    unknown: 0,
    enchantmentSeed: 0,
    materiaCombines: 0,
    stackCount: 1,
    rerolls: 0,
    affixRerolls: 0,
    xOffset: 0,
    yOffset: 0
  }
}

async function executeSahdinasMementoRecovery(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  collection: CollectionSnapshot,
  destination: SpecialRecoveryDestination,
  expectedCharacterName?: string
): Promise<SpecialItemRecoveryResult> {
  if (destination !== 'shared-stash' && destination !== 'character-inventory') {
    throw new Error('Sahdina recovery only supports the shared stash or active character inventory.')
  }

  const status = await helper.request<LiveGameStatus>('inspect-live-game')
  if (status.state !== 'ready') throw new Error(status.detail)
  const confirmedCharacterName = expectedCharacterName?.trim() || null
  if (
    status.activeCharacterName &&
    confirmedCharacterName &&
    status.activeCharacterName.localeCompare(confirmedCharacterName, undefined, { sensitivity: 'base' }) !== 0
  ) {
    throw new Error(
      `The active character changed from “${confirmedCharacterName}” to “${status.activeCharacterName}”. Review the character and try again.`
    )
  }
  const activeCharacterName = status.activeCharacterName ?? confirmedCharacterName
  let activeIsHardcore = status.isHardcore
  if (activeIsHardcore === null) {
    if (!activeCharacterName) {
      throw new Error('CC could not identify the active character well enough to resolve Hardcore or Softcore mode.')
    }
    const installationPath = collection.discovery.installations[0]?.path
    if (!installationPath) throw new Error('No Grim Dawn installation is available.')
    const profiles = await helper.request<CharacterSaveProfile[]>('list-characters', { installationPath })
    const matchingProfiles = profiles
      .filter((profile) => !profile.error)
      .filter((profile) => profile.name.localeCompare(activeCharacterName, undefined, { sensitivity: 'base' }) === 0)
    const matchingModes = [...new Set(matchingProfiles.map((profile) => profile.isHardcore))]
    if (matchingModes.length > 1) {
      throw new Error(
        `CC found both Hardcore and Softcore saves named “${activeCharacterName}”. Rename one before using live recovery.`
      )
    }
    activeIsHardcore = matchingModes[0] ?? null
    if (activeIsHardcore === null) {
      throw new Error(`The active character “${activeCharacterName}” was not found in the parsed saves.`)
    }
  }

  const operationId = `sahdina-${randomUUID()}`
  const item = createSupplyPayload(SAHDINAS_MEMENTO.record)
  const payloadSha256 = createHash('sha256').update(JSON.stringify(item)).digest('hex')
  let queued = false
  database.prepareDeliveryOperation({
    operationId,
    destination: `live://special-recovery/${destination}`,
    payloadSha256,
    startedAtUtc: new Date().toISOString(),
    detail: { phase: 'prepared', adapter: 'cairn-live-v1', record: SAHDINAS_MEMENTO.record, destination, isHardcore: activeIsHardcore }
  })
  try {
    const queue = await helper.request<LiveRetrievalQueue>('enqueue-live-retrieval', {
      operationId,
      isHardcore: activeIsHardcore,
      destination,
      item
    })
    queued = true
    database.updatePendingOperationDetail(operationId, {
      phase: 'queued',
      queues: [queue]
    })
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const result = await helper.request<LiveRetrievalStatus>('inspect-live-retrieval', { queue })
      if (result.state === 'rejected') {
        if (!result.receiptPath) {
          throw new Error('The game rejected the recovery without returning a durable queue receipt.')
        }
        await helper.request<LiveQueueReceipt>('ack-live-incoming', {
          path: result.receiptPath,
          expectedSha256: queue.semanticSha256,
          receiptDirectory: join(app.getPath('userData'), 'live-receipts', 'rejected-special-recoveries')
        })
        const target = destination === 'character-inventory' ? 'personal inventory' : status.depositTabDescription
        const rejection = new Error(`The game rejected the recovery because the ${target} is full. No replacement was delivered.`)
        database.failDeliveryOperation(operationId, rejection)
        queued = false
        throw rejection
      }
      if (result.state === 'deposited' && result.receiptPath) {
        database.completeDeliveryOperation({
          operationId,
          receiptPath: result.receiptPath,
          completedAtUtc: new Date().toISOString(),
          detail: { phase: 'committed', adapter: 'cairn-live-v1', record: SAHDINAS_MEMENTO.record, destination, isHardcore: activeIsHardcore }
        })
        return {
          operationId,
          status: 'committed',
          activeCharacter: activeCharacterName ?? 'Active character',
          destination,
          record: SAHDINAS_MEMENTO.record,
          name: SAHDINAS_MEMENTO.name,
          receiptPath: result.receiptPath
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    throw new Error(
      'Timed out waiting for Grim Dawn to acknowledge Sahdina\'s Memento. Do not click recovery again until the pending live queue has resolved.'
    )
  } catch (error) {
    if (queued) database.markDeliveryNeedsRecovery(operationId, error)
    else database.failDeliveryOperation(operationId, error)
    throw error
  }
}

async function executeLiveAugmentDispense(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  collection: CollectionSnapshot,
  records: string[],
  expectedCharacterName?: string
): Promise<LiveSupplyDispenseResult> {
  const uniqueRecords = [...new Set(records.map((record) => record.toLocaleLowerCase()))]
  if (uniqueRecords.length === 0) throw new Error('Select at least one augment to dispense.')

  let status = await helper.request<LiveGameStatus>('inspect-live-game')
  if (status.state !== 'ready') throw new Error(status.detail)
  for (let attempt = 0; attempt < 25 && !status.activeCharacterName; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    status = await helper.request<LiveGameStatus>('inspect-live-game')
    if (status.state !== 'ready') throw new Error(status.detail)
  }
  const confirmedCharacterName = expectedCharacterName?.trim() || null
  if (
    status.activeCharacterName &&
    confirmedCharacterName &&
    status.activeCharacterName.localeCompare(confirmedCharacterName, undefined, { sensitivity: 'base' }) !== 0
  ) {
    throw new Error(
      `The active character changed from “${confirmedCharacterName}” to “${status.activeCharacterName}”. Review the character and try again.`
    )
  }
  const activeCharacterName = status.activeCharacterName ?? confirmedCharacterName
  if (!activeCharacterName) {
    throw new Error('CC could not identify the active character. Reopen the Supplies view and try again.')
  }

  const installationPath = collection.discovery.installations[0]?.path
  if (!installationPath) throw new Error('No Grim Dawn installation is available.')
  let activeCharacter: CharacterSaveProfile | undefined
  let activeIsHardcore = status.isHardcore
  for (let attempt = 0; attempt < 2 && !activeCharacter; attempt += 1) {
    const profiles = await helper.request<CharacterSaveProfile[]>('list-characters', { installationPath })
    const matchingProfiles = profiles
      .filter((profile) => !profile.error)
      .filter((profile) => profile.name.localeCompare(activeCharacterName, undefined, { sensitivity: 'base' }) === 0)

    if (activeIsHardcore === null) {
      const matchingModes = [...new Set(matchingProfiles.map((profile) => profile.isHardcore))]
      if (matchingModes.length > 1) {
        throw new Error(
          `CC found both Hardcore and Softcore saves named “${activeCharacterName}”. Wait for the game-mode handshake or rename one before dispensing.`
        )
      }
      activeIsHardcore = matchingModes[0] ?? null
    }

    if (activeIsHardcore !== null) {
      const expectedMode = activeIsHardcore
      activeCharacter = matchingProfiles
        .filter((profile) => profile.isHardcore === expectedMode)
        .sort((left, right) => Date.parse(right.lastWriteUtc) - Date.parse(left.lastWriteUtc))[0]
    }
    if (!activeCharacter) await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!activeCharacter) {
    throw new Error(`The active character “${activeCharacterName}” was not found in the parsed saves.`)
  }
  if (activeIsHardcore === null) {
    throw new Error(`CC could not resolve whether “${activeCharacterName}” is Hardcore or Softcore.`)
  }

  const catalog = new Map(
    (collection.supplies ?? [])
      .filter((item) => item.slot === 'augment')
      .map((item) => [item.record.toLocaleLowerCase(), item])
  )
  const selected = uniqueRecords.map((record) => {
    const item = catalog.get(record)
    if (!item) throw new Error(`The selected record is not a catalogued faction augment: ${record}`)
    const requirements = (item.acquisition?.factions ?? [])
      .filter((requirement) => requirement.kind !== 'blueprint')
    if (requirements.length === 0) {
      throw new Error(`${item.name} has no verified faction-vendor requirement and cannot be injected.`)
    }
    const authorized = requirements.some((requirement) => {
      const threshold = reputationThresholds[requirement.reputation.toLocaleLowerCase()]
      if (threshold === undefined) return false
      const faction = activeCharacter.factions.find(
        (candidate) => normalizedFactionName(candidate.name) === normalizedFactionName(requirement.faction)
      )
      return Boolean(faction?.isUnlocked && faction.value >= threshold)
    })
    if (!authorized) {
      const needed = requirements.map((requirement) => `${requirement.faction} ${requirement.reputation}`).join(' or ')
      throw new Error(`${activeCharacter.name} cannot buy ${item.name}; requires ${needed}.`)
    }
    return item
  })

  const operationId = randomUUID()
  const receiptPaths: string[] = []
  const dispensed: typeof selected = []
  const issues: string[] = []
  const queued: Array<{ item: (typeof selected)[number]; queue: LiveRetrievalQueue }> = []
  const payloads = selected.map((item) => createSupplyPayload(item.record))
  const payloadSha256 = createHash('sha256').update(JSON.stringify(payloads)).digest('hex')
  database.prepareDeliveryOperation({
    operationId,
    destination: 'live://personal-inventory/augments',
    payloadSha256,
    startedAtUtc: new Date().toISOString(),
    detail: { phase: 'prepared', adapter: 'cairn-live-v1', records: selected.map((item) => item.record), isHardcore: activeCharacter.isHardcore }
  })
  try {
    for (const [index, item] of selected.entries()) {
      const queue = await helper.request<LiveRetrievalQueue>('enqueue-live-retrieval', {
        operationId: `${operationId}-${index}`,
        isHardcore: activeIsHardcore,
        destination: 'character-inventory',
        item: payloads[index]
      })
      queued.push({ item, queue })
      database.updatePendingOperationDetail(operationId, {
        phase: 'queued',
        queues: queued.map((entry) => entry.queue)
      })
    }

    const pending = new Map(queued.map((entry) => [entry.queue.operationId, entry]))
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline && pending.size > 0) {
      for (const [pendingId, entry] of [...pending.entries()]) {
        const result = await helper.request<LiveRetrievalStatus>('inspect-live-retrieval', { queue: entry.queue })
        if (result.state === 'rejected') {
          if (!result.receiptPath) throw new Error('The game rejected an augment without returning a durable queue receipt.')
          await helper.request<LiveQueueReceipt>('ack-live-incoming', {
            path: result.receiptPath,
            expectedSha256: entry.queue.semanticSha256,
            receiptDirectory: join(app.getPath('userData'), 'live-receipts', 'rejected-personal-deliveries')
          })
          issues.push(`${activeCharacter.name}'s personal inventory is full. No rejected augment was lost.`)
          pending.delete(pendingId)
        } else if (result.state === 'deposited' && result.receiptPath) {
          receiptPaths.push(result.receiptPath)
          dispensed.push(entry.item)
          pending.delete(pendingId)
        }
      }
      if (pending.size > 0) await new Promise((resolve) => setTimeout(resolve, 150))
    }
    if (pending.size > 0) {
      throw new Error(`Timed out waiting for Grim Dawn to acknowledge ${pending.size} personal-inventory ${pending.size === 1 ? 'delivery' : 'deliveries'}. Do not retry until CC resolves the pending queue.`)
    }
    if (dispensed.length === 0) {
      const rejection = new Error(issues[0] ?? 'No augments were delivered.')
      database.failDeliveryOperation(operationId, rejection)
      queued.length = 0
      throw rejection
    }
    database.completeDeliveryOperation({
      operationId,
      receiptPath: receiptPaths[0]!,
      completedAtUtc: new Date().toISOString(),
      detail: {
        phase: 'committed',
        adapter: 'cairn-live-v1',
        records: dispensed.map((item) => item.record),
        isHardcore: activeCharacter.isHardcore,
        receiptPaths,
        rejectedCount: issues.length
      }
    })

    return {
      operationId,
      status: 'committed',
      activeCharacter: activeCharacter.name,
      dispensed: dispensed.map((item) => ({ record: item.record, name: item.name })),
      receiptPaths,
      issues
    }
  } catch (error) {
    if (queued.length > 0) database.markDeliveryNeedsRecovery(operationId, error)
    else database.failDeliveryOperation(operationId, error)
    throw error
  }
}

async function executeSingleLiveRetrieval(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  vaultItemId: string
): Promise<LiveRetrievalResult> {
  const vaultItemIds = [vaultItemId]
  const listed = new Map(database.listVaultItems().map((item) => [item.id, item]))
  const selected = vaultItemIds.map((id) => {
    const item = listed.get(id)
    if (!item) throw new Error(`Vault item does not exist: ${id}`)
    return item
  })
  const isHardcore = selected[0]!.isHardcore
  const status = await helper.request<LiveGameStatus>('inspect-live-game')
  if (status.state !== 'ready') throw new Error(status.detail)
  if (status.isHardcore !== null && status.isHardcore !== isHardcore) {
    throw new Error(
      `The running character is ${status.isHardcore ? 'Hardcore' : 'Softcore'}, but the selection is ${isHardcore ? 'Hardcore' : 'Softcore'}.`
    )
  }
  const vaultItems = database.getVaultItems(vaultItemIds, isHardcore)
  const unavailable = vaultItems.filter((item) => item.state !== 'ingested')
  if (unavailable.length > 0) {
    throw new Error('Vault items are not available: ' + unavailable.map((item) => item.id).join(', '))
  }
  const operationId = randomUUID()
  const sourceIdentity = createHash('sha256')
    .update(JSON.stringify(vaultItems.map((item) => item.payload)))
    .digest('hex')
  let prepared = false
  let queued = false
  try {
    database.prepareRetrievalOperation({
      operationId,
      stashPath: `live://gdia/${isHardcore ? 'hc' : 'sc'}`,
      sourceSha256: sourceIdentity,
      startedAtUtc: new Date().toISOString(),
      vaultItemIds,
      detail: { phase: 'prepared', adapter: 'gdia-live-v1', vaultItemIds }
    })
    prepared = true
    const queues: LiveRetrievalQueue[] = []
    for (const [index, item] of vaultItems.entries()) {
      queues.push(
        await helper.request<LiveRetrievalQueue>('enqueue-live-retrieval', {
          operationId: `${operationId}-${index}`,
          isHardcore,
          item: item.payload
        })
      )
      queued = true
      database.updatePendingOperationDetail(operationId, {
        phase: 'queued',
        queues
      })
    }
    const deadline = Date.now() + 45_000
    const receipts = new Map<number, string>()
    while (Date.now() < deadline && receipts.size < queues.length) {
      for (const [index, queue] of queues.entries()) {
        if (receipts.has(index)) continue
        const result = await helper.request<LiveRetrievalStatus>('inspect-live-retrieval', { queue })
        if (result.state === 'rejected') {
          if (!result.receiptPath) {
            throw new Error('The game rejected the item without returning a durable queue receipt.')
          }
          await helper.request<LiveQueueReceipt>('ack-live-incoming', {
            path: result.receiptPath,
            expectedSha256: queue.semanticSha256,
            receiptDirectory: join(app.getPath('userData'), 'live-receipts', 'rejected-returns')
          })
          const rejection = new Error(
            `The ${status.depositTabDescription} is full. The item remains safely stored in the Codex Archive.`
          )
          database.failRetrievalOperation(operationId, vaultItemIds, rejection)
          prepared = false
          throw rejection
        }
        if (result.state === 'deposited' && result.receiptPath) receipts.set(index, result.receiptPath)
      }
      if (receipts.size < queues.length) await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (receipts.size !== queues.length) {
      throw new Error('Timed out waiting for the live hook to acknowledge the in-game deposit.')
    }
    const receiptPaths = [...receipts.entries()].sort(([left], [right]) => left - right).map(([, path]) => path)
    database.completeRetrievalOperation({
      operationId,
      vaultItemIds,
      backupPath: receiptPaths[0]!,
      completedAtUtc: new Date().toISOString(),
      detail: { phase: 'committed', adapter: 'gdia-live-v1', receiptPaths, vaultItemIds }
    })
    return {
      operationId,
      status: 'committed',
      retrieved: vaultItems.map((item, index) => ({
        vaultItemId: item.id,
        baseRecord: item.baseRecord,
        seed: (item.payload as { seed?: number }).seed ?? selected[index]!.seed
      })),
      receiptPaths,
      issues: []
    }
  } catch (error) {
    if (prepared) {
      if (queued) database.markRetrievalNeedsRecovery(operationId, error)
      else database.failRetrievalOperation(operationId, vaultItemIds, error)
    }
    throw error
  }
}

async function attachItemIcons(
  helper: GrimDawnHelperClient,
  jobs: BackgroundJobCoordinator,
  snapshot: CollectionSnapshot
): Promise<CollectionSnapshot> {
  const installation = snapshot.discovery.installations[0]
  if (!installation) return snapshot
  const bitmaps = [
    ...new Set(
      [...snapshot.items, ...(snapshot.plannerItems ?? []), ...(snapshot.supplies ?? []), ...(snapshot.materials ?? [])]
        .map((item) => item.bitmap)
        .filter((bitmap): bitmap is string => Boolean(bitmap))
    )
  ]
  bitmaps.push(DOUBLE_RARE_MI_BITMAP)
  const bitmapFingerprint = createHash('sha256').update(JSON.stringify(bitmaps)).digest('hex').slice(0, 16)
  const extraction = await jobs.run({
    kind: 'icon-extraction',
    dedupeKey: `icon-extraction:${bitmapFingerprint}`,
    stage: 'queued',
    progress: {
      completed: 0, total: bitmaps.length, percent: 0, unit: 'items',
      label: 'Extract item icons', detail: 'Preparing the requested icon set.'
    },
    canCancel: false,
    boundary: null,
    completedStage: 'complete', failedStage: 'failed', canceledStage: 'canceled'
  }, async (job) => {
    job.throwIfCancellationRequested()
    job.update({
      stage: 'extracting', canCancel: false, boundary: null,
      progress: { label: 'Extract item icons', detail: 'Decoding item art from installed game archives.' }
    })
    return helper.request<ItemIconExtractionResult>('extract-item-icons', {
      installationPath: installation.path,
      outputDirectory: join(app.getPath('userData'), 'item-icons'),
      bitmaps
    })
  }, (result) => ({
    summary: 'Item icon extraction complete.',
    metrics: { requested: bitmaps.length, extracted: result.icons.length, failures: result.failures.length }
  })).result
  if (extraction.failures.length > 0) {
    console.warn('Some Grim Dawn item icons could not be decoded.', extraction.failures.slice(0, 10))
  }
  const keys = new Map(
    extraction.icons.map((icon) => [icon.bitmap.toLocaleLowerCase(), icon.key])
  )
  return {
    ...snapshot,
    items: snapshot.items.map((item) => ({
      ...item,
      iconKey: item.bitmap ? (keys.get(item.bitmap.toLocaleLowerCase()) ?? null) : null
    })),
    plannerItems: (snapshot.plannerItems ?? []).map((item) => ({
      ...item,
      iconKey: item.bitmap ? (keys.get(item.bitmap.toLocaleLowerCase()) ?? null) : null
    })),
    supplies: (snapshot.supplies ?? []).map((item) => ({
      ...item,
      iconKey: item.bitmap ? (keys.get(item.bitmap.toLocaleLowerCase()) ?? null) : null
    })),
    materials: (snapshot.materials ?? []).map((item) => ({
      ...item,
      iconKey: item.bitmap ? (keys.get(item.bitmap.toLocaleLowerCase()) ?? null) : null
    })),
    uiIcons: {
      doubleRareMi: keys.get(DOUBLE_RARE_MI_BITMAP.toLocaleLowerCase()) ?? ''
    }
  }
}

async function readCollectionCache(path: string): Promise<CollectionSnapshot | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as CollectionSnapshot
    if (
      parsed.catalogPresentationVersion !== CATALOG_PRESENTATION_VERSION ||
      !Array.isArray(parsed.items) ||
      !Array.isArray(parsed.plannerItems) ||
      !Array.isArray(parsed.supplies) ||
      !Array.isArray(parsed.materials) ||
      !Array.isArray(parsed.accountStores) ||
      !Array.isArray(parsed.observedItems) ||
      !Array.isArray(parsed.scannedStashes)
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

async function loadMapLocationIndex(
  helper: GrimDawnHelperClient,
  jobs: BackgroundJobCoordinator,
  cachePath: string,
  installationPath: string,
  force = false
): Promise<MapLocationIndex> {
  if (!force) {
    const cached = await readMapLocationIndex(cachePath)
    if (cached && (await mapLocationIndexIsFresh(cached))) return cached
  }
  const installationKey = createHash('sha256').update(installationPath).digest('hex').slice(0, 16)
  const rebuilt = await jobs.run({
    kind: 'map-indexing',
    dedupeKey: `map-indexing:${installationKey}`,
    stage: 'queued',
    progress: {
      completed: 0, total: 2, percent: 0, unit: 'steps',
      label: 'Build map location index', detail: 'Preparing installed map archives.'
    },
    canCancel: false,
    boundary: null,
    completedStage: 'complete', failedStage: 'failed', canceledStage: 'canceled'
  }, async (job) => {
    job.throwIfCancellationRequested()
    job.update({
      stage: 'indexing', canCancel: false, boundary: null,
      progress: { label: 'Index map locations', detail: 'Resolving item sources against campaign regions.' }
    })
    const index = await helper.request<MapLocationIndex>('build-map-location-index', {
      installationPath
    })
    job.update({
      stage: 'persisting',
      progress: { completed: 1, label: 'Store map location index', detail: 'Writing the bounded index cache.' }
    })
    await writeJsonCache(cachePath, index)
    return index
  }, (result) => ({
    summary: 'Map location index complete.',
    metrics: { regions: result.regionCount, placedRecords: result.placedRecordCount }
  })).result
  console.log(
    `[map-index] ${rebuilt.regionCount} regions, ${rebuilt.placedRecordCount} placed game records`
  )
  return rebuilt
}

async function readMapLocationIndex(path: string): Promise<MapLocationIndex | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as MapLocationIndex
    if (
      parsed.version !== 8 ||
      !Array.isArray(parsed.archives) ||
      !parsed.sourceLocations ||
      typeof parsed.sourceLocations !== 'object'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

async function mapLocationIndexIsFresh(index: MapLocationIndex): Promise<boolean> {
  try {
    for (const archive of index.archives) {
      const current = await stat(archive.path)
      if (
        current.size !== archive.length ||
        Math.abs(current.mtimeMs - Date.parse(archive.lastWriteUtc)) > 1_000
      ) {
        return false
      }
    }
    return index.archives.length > 0
  } catch {
    return false
  }
}

async function collectionStashesAreFresh(snapshot: CollectionSnapshot): Promise<boolean> {
  const stashes = [
    ...(snapshot.availableStashes ?? snapshot.scannedStashes),
    ...(snapshot.accountStores ?? [])
  ]
  try {
    for (const stash of stashes) {
      const current = await stat(stash.path)
      if (Math.abs(current.mtimeMs - Date.parse(stash.lastWriteUtc)) > 1_000) return false
    }
    return true
  } catch {
    return false
  }
}

function attachMapLocations(
  snapshot: CollectionSnapshot,
  index: MapLocationIndex
): CollectionSnapshot {
  const locationsBySource = new Map(
    Object.entries(index.sourceLocations).map(([record, locations]) => [
      record.toLocaleLowerCase(),
      locations
    ])
  )
  return {
    ...snapshot,
    items: snapshot.items.map((item) => {
      if (item.rarity !== 'mi') return item
      const sourceRecords = item.acquisition?.sourceRecords ?? []
      const locations = sourceRecords.flatMap(
        (record) => locationsBySource.get(record.toLocaleLowerCase()) ?? []
      )
      const unique = new Map<string, MapRegionLocation>()
      for (const location of locations) {
        const key = `${location.name}:${location.routeName ?? ''}`.toLocaleLowerCase()
        if (!unique.has(key)) unique.set(key, location)
      }
      const distinctLocations = [...unique.values()]
      const namedWorldLocations = distinctLocations.filter((location) => Boolean(location.zoneRecord))
      const usefulLocations = (namedWorldLocations.length > 0 ? namedWorldLocations : distinctLocations)
        .sort((left, right) =>
          mapLocationRouteRank(left) - mapLocationRouteRank(right) ||
          left.name.localeCompare(right.name)
        )
      return item.acquisition
        ? {
            ...item,
            acquisition: {
              ...item.acquisition,
              // Source records are an internal join key; once locations are attached,
              // retaining thousands of repeated paths only bloats the persisted catalog.
              sourceRecords: [],
              locations: usefulLocations.slice(0, 64),
              additionalLocationCount: Math.max(0, usefulLocations.length - 64)
            }
          }
        : item
    })
  }
}

function mapLocationRouteRank(location: MapRegionLocation): number {
  const packRank = ({ base: 0, gdx1: 1, gdx2: 2, gdx3: 3 } as Record<string, number>)[location.contentPack] ?? 9
  const chapter = /riftgatemap1([a-l])_/i.exec(location.zoneRecord)?.[1]?.toLocaleLowerCase()
  const chapterRank = chapter ? chapter.charCodeAt(0) - 'a'.charCodeAt(0) : 99
  return packRank * 100 + chapterRank
}

async function writeJsonCache(path: string, value: unknown): Promise<void> {
  const temporaryPath = path + '.tmp'
  await writeFile(temporaryPath, JSON.stringify(value), 'utf8')
  await rename(temporaryPath, path)
}

async function writeCollectionCache(path: string, snapshot: CollectionSnapshot): Promise<void> {
  await writeJsonCache(path, snapshot)
}

function projectCollectionSources(
  snapshot: CollectionSnapshot,
  sourcePaths: string[]
): CollectionSnapshot {
  const availableStashes = snapshot.availableStashes ?? snapshot.scannedStashes
  const requested = new Set(sourcePaths.map((path) => path.toLocaleLowerCase()))
  const defaultMode = availableStashes.some((stash) => stash.isHardcore)
  const scannedStashes = availableStashes.filter((stash) =>
    requested.size > 0
      ? requested.has(stash.path.toLocaleLowerCase())
      : stash.isHardcore === defaultMode
  )
  const paths = new Set(scannedStashes.map((stash) => stash.path.toLocaleLowerCase()))
  const observedItems = snapshot.observedItems.filter((item) =>
    paths.has(item.sourcePath.toLocaleLowerCase())
  )
  const copiesByRecord = new Map<string, typeof observedItems>()
  for (const item of observedItems) {
    const key = item.baseRecord.toLocaleLowerCase()
    const copies = copiesByRecord.get(key)
    if (copies) copies.push(item)
    else copiesByRecord.set(key, [item])
  }
  const items = snapshot.items.map((item) => {
    const copies = copiesByRecord.get(item.record.toLocaleLowerCase()) ?? []
    const trusted = copies.filter(
      (copy) =>
        copy.rollAnalysis?.trusted === true &&
        copy.rollAnalysis.overallEstimatedPercentile !== null
    )
    return {
      ...item,
      availableCount: copies.length,
      analyzedCopyCount: trusted.length,
      bestRollPercentile:
        trusted.length > 0
          ? Math.max(...trusted.map((copy) => copy.rollAnalysis!.overallEstimatedPercentile!))
          : null
    }
  })
  const supplies = (snapshot.supplies ?? []).map((item) => ({
    ...item,
    availableCount: copiesByRecord.get(item.record.toLocaleLowerCase())?.length ?? 0
  }))
  const projectedMode =
    scannedStashes.length > 0 &&
    scannedStashes.every((stash) => stash.isHardcore === scannedStashes[0]!.isHardcore)
      ? scannedStashes[0]!.isHardcore
      : undefined
  const accountCounts = new Map<string, number>()
  const accountStores = (snapshot.accountStores ?? [])
    .filter((store) => projectedMode === undefined || store.isHardcore === projectedMode)
    .sort((left, right) => Date.parse(right.lastWriteUtc) - Date.parse(left.lastWriteUtc))
    .filter((store, index, all) =>
      all.findIndex((candidate) =>
        candidate.kind === store.kind && candidate.isHardcore === store.isHardcore
      ) === index
    )
  for (const store of accountStores) {
    for (const entry of store.entries) {
      const record = entry.record.toLocaleLowerCase()
      accountCounts.set(record, (accountCounts.get(record) ?? 0) + entry.quantity)
    }
  }
  const materials = (snapshot.materials ?? []).map((item) => ({
    ...item,
    availableCount: accountCounts.get(item.record.toLocaleLowerCase()) ?? 0,
    discovered: (accountCounts.get(item.record.toLocaleLowerCase()) ?? 0) > 0
  }))
  const warnings = snapshot.warnings.filter((warning) => {
    if (paths.has(warning.path.toLocaleLowerCase())) return true
    return scannedStashes.some(
      (stash) => stash.isHardcore === isHardcoreStashPath(warning.path)
    )
  })
  const rarities = collectionRarities.map((rarity) => {
    const matching = items.filter((item) => item.rarity === rarity)
    return {
      rarity,
      total: matching.length,
      collected: matching.filter((item) => item.availableCount > 0).length,
      availableCopies: matching.reduce((count, item) => count + item.availableCount, 0)
    }
  })
  return withProjectedAffixes({
    ...snapshot,
    isHardcore: projectedMode,
    availableStashes,
    scannedStashes,
    observedItems,
    warnings,
    rarities,
    items,
    supplies,
    materials
  }, observedItems)
}

function withProjectedAffixes(
  snapshot: CollectionSnapshot,
  observedItems: ObservedStashItem[]
): CollectionSnapshot {
  const counts = new Map<string, number>()
  for (const item of observedItems) {
    for (const record of [item.prefixRecord, item.suffixRecord]) {
      if (!record) continue
      const key = record.toLocaleLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const affixes = snapshot.affixes.map((affix) => ({
    ...affix,
    availableCount: affix.records.reduce(
      (count, record) => count + (counts.get(record.toLocaleLowerCase()) ?? 0),
      0
    )
  }))
  return {
    ...snapshot,
    affixes,
    affixSummary: {
      total: affixes.length,
      collected: affixes.filter((affix) => affix.availableCount > 0).length,
      availableCopies: affixes.reduce((count, affix) => count + affix.availableCount, 0)
    }
  }
}

function lifetimeMode(snapshot: CollectionSnapshot): boolean | undefined {
  const modes = new Set(snapshot.scannedStashes.map((stash) => stash.isHardcore))
  return modes.size === 1 ? [...modes][0] : undefined
}

async function presentCollection(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  snapshot: CollectionSnapshot,
  basis: CollectionBasis
): Promise<CollectionSnapshot> {
  await resolveQuarantinedArchiveItems(helper, database, snapshot)
  const mode = lifetimeMode(snapshot)
  if (basis !== 'archive') {
    return withRecipeCollection(
      database.presentSnapshot({ ...snapshot, basis: 'stashes' }, mode),
      mode
    )
  }

  const installation = snapshot.discovery.installations[0]
  const archived = database.listAvailableArchiveItems(mode)
  if (!installation || archived.length === 0) {
    return withRecipeCollection(database.presentArchiveSnapshot(snapshot, [], mode), mode)
  }
  const payloads = archived.map((item) => item.payload as LiveVaultPayload)
  const observedItems = archived.map((item, index): ObservedStashItem => {
    const payload = payloads[index]!
    return {
      sourcePath: `vault://${item.id}`,
      tabIndex: -1,
      itemIndex: index,
      baseRecord: payload.baseRecord,
      prefixRecord: payload.prefixRecord,
      suffixRecord: payload.suffixRecord,
      modifierRecord: payload.modifierRecord,
      transmuteRecord: payload.transmuteRecord,
      seed: payload.seed,
      materiaRecord: payload.materiaRecord,
      relicCompletionBonusRecord: payload.relicCompletionBonusRecord,
      relicSeed: payload.relicSeed,
      enchantmentRecord: payload.enchantmentRecord,
      ascendantRecord: payload.ascendantRecord,
      ascendantRecord2H: payload.ascendantRecord2H,
      enchantmentSeed: payload.enchantmentSeed,
      materiaCombines: payload.materiaCombines,
      stackCount: payload.stackCount,
      rerolls: payload.rerolls,
      affixRerolls: payload.affixRerolls,
      rollAnalysis: archived[index]!.rollAnalysis,
      instanceKey: createVaultInstanceKey(payload)
    }
  })
  return {
    ...withRecipeCollection(database.presentArchiveSnapshot(snapshot, observedItems, mode), mode),
    rollHydrationPending: database.countArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION, mode)
  }
}

async function resolveQuarantinedArchiveItems(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  snapshot: CollectionSnapshot
): Promise<void> {
  const records = database.listQuarantineCatalogRecords()
  const installationPath = snapshot.discovery.installations[0]?.path
  if (records.length === 0 || !installationPath) return
  try {
    const resolved = await helper.request<ResolvedArchiveCatalogItem[]>('resolve-archive-items', {
      installationPath,
      records
    })
    const result = database.resolveQuarantineCatalogItems(resolved)
    console.log(
      `[quarantine-audit] released ${result.releasedRecords} valid Rare records; ` +
      `retained ${result.recoveryRecords} generic records with resolved metadata; ` +
      `${result.missingRecords} records were absent from the installed databases.`
    )
  } catch (error) {
    console.warn('[quarantine-audit] Installed-data resolution failed; originals remain untouched.', error)
  }
}

function withRecipeCollection(
  snapshot: CollectionSnapshot,
  isHardcore?: boolean
): CollectionSnapshot {
  const decorate = (item: CollectionSnapshot['items'][number]) =>
    withRecipeAvailability(item, isHardcore)
  const recipeItemsCatalog = snapshot.items.map(decorate)
  const recipePlannerItems = (snapshot.plannerItems ?? []).map(decorate)
  const materials = (snapshot.materials ?? []).map(decorate)
  const awakeningSources = [...recipeItemsCatalog, ...recipePlannerItems]
  const items = withAwakeningAvailability(recipeItemsCatalog, awakeningSources)
  const plannerItems = withAwakeningAvailability(recipePlannerItems, awakeningSources)
  const recipeItems = [...items, ...plannerItems, ...materials].filter(
    (item, index, all) =>
      Boolean(item.acquisition?.crafting) &&
      all.findIndex((candidate) => candidate.record.toLowerCase() === item.record.toLowerCase()) === index
  )
  const rarities = snapshot.rarities.map((summary) => {
    const matching = items.filter((item) => item.rarity === summary.rarity)
    return {
      ...summary,
      total: matching.length,
      collected: matching.filter(isCollectionOwned).length,
      availableCopies: matching.reduce((count, item) => count + item.availableCount, 0)
    }
  })
  const collectedRecipes = recipeItems.filter((item) => item.recipeUnlocked).length
  return {
    ...snapshot,
    items,
    plannerItems,
    materials,
    rarities,
    recipeSummary: {
      total: recipeItems.length,
      collected: collectedRecipes,
      unlockedItems: collectedRecipes
    }
  }
}

function createVaultInstanceKey(item: LiveVaultPayload): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        item.baseRecord,
        item.prefixRecord,
        item.suffixRecord,
        item.modifierRecord,
        item.transmuteRecord,
        item.seed,
        item.materiaRecord,
        item.relicCompletionBonusRecord,
        item.relicSeed,
        item.enchantmentRecord,
        item.ascendantRecord,
        item.ascendantRecord2H,
        item.enchantmentSeed,
        item.materiaCombines,
        item.stackCount,
        item.rerolls,
        item.affixRerolls
      ])
    )
    .digest('hex')
}

function registerItemIconProtocol(): void {
  const iconDirectory = join(app.getPath('userData'), 'item-icons')
  protocol.handle('cairn-icon', async (request) => {
    const url = new URL(request.url)
    const fileName = url.pathname.split('/').at(-1) ?? ''
    if (!/^[a-f0-9]{64}\.png$/.test(fileName)) {
      return new Response('Invalid item icon key.', { status: 400 })
    }
    try {
      return new Response(await readFile(join(iconDirectory, fileName)), {
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' }
      })
    } catch {
      return new Response('Item icon was not found.', { status: 404 })
    }
  })
}

async function runSmokeTest(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  diagnostics: DiagnosticLogger
): Promise<void> {
  try {
    const schemaSmokePath = join(
      app.getPath('temp'),
      `cairn-codex-schema-smoke-${randomUUID()}.sqlite3`
    )
    try {
      new CollectionDatabase(schemaSmokePath).close()
      new CollectionDatabase(schemaSmokePath).close()
    } finally {
      await Promise.all(
        [schemaSmokePath, `${schemaSmokePath}-wal`, `${schemaSmokePath}-shm`].map((path) =>
          unlink(path).catch(() => undefined)
        )
      )
    }
    const archiveSmokeRoot = join(
      app.getPath('temp'),
      `cairn-codex-archive-backup-smoke-${randomUUID()}`
    )
    const archiveSmokePath = join(archiveSmokeRoot, 'archive.sqlite3')
    const archiveSmokeBackupDirectory = join(archiveSmokeRoot, 'backups')
    try {
      await mkdir(archiveSmokeRoot, { recursive: true })
      const archiveSmokeDatabase = new CollectionDatabase(archiveSmokePath)
      const archiveSmokeService = new ArchiveBackupService(
        archiveSmokeDatabase,
        archiveSmokePath,
        archiveSmokeBackupDirectory,
        2
      )
      const original = await archiveSmokeService.createBackup('smoke original')
      archiveSmokeDatabase.setInfiniteSupplies(false)
      await archiveSmokeService.createBackup('smoke changed')
      await archiveSmokeService.stageRestore(
        join(archiveSmokeBackupDirectory, original.fileName)
      )
      archiveSmokeDatabase.close()
      if (!(await ArchiveBackupService.applyPendingRestore(
        archiveSmokePath,
        archiveSmokeBackupDirectory
      ))) {
        throw new Error('Archive backup smoke test did not apply its staged restore.')
      }
      const restoredArchive = new CollectionDatabase(archiveSmokePath)
      try {
        if (!restoredArchive.getInfiniteSupplies()) {
          throw new Error('Archive restore did not recover the selected database state.')
        }
      } finally {
        restoredArchive.close()
      }
      const archiveStatus = await archiveSmokeService.getStatus()
      if (
        archiveStatus.pendingRestore ||
        archiveStatus.backups.length < 2 ||
        !archiveStatus.backups.every((entry) => entry.verified && /^[0-9a-f]{64}$/.test(entry.sha256))
      ) {
        throw new Error('Archive backup rotation or verification metadata failed its smoke test.')
      }
      await writeFile(
        join(archiveSmokeBackupDirectory, 'pending-restore.json'),
        `${JSON.stringify({
          sourcePath: join(archiveSmokeBackupDirectory, 'missing.sqlite3'),
          sourceSha256: '0'.repeat(64),
          requestedAtUtc: new Date().toISOString()
        }, null, 2)}\n`,
        'utf8'
      )
      let invalidRestoreRejected = false
      try {
        await ArchiveBackupService.applyPendingRestore(
          archiveSmokePath,
          archiveSmokeBackupDirectory
        )
      } catch {
        invalidRestoreRejected = true
      }
      const quarantinedRestore = await ArchiveBackupService.quarantinePendingRestore(
        archiveSmokeBackupDirectory
      )
      if (!invalidRestoreRejected || !quarantinedRestore) {
        throw new Error('Invalid staged restore did not fail closed and leave the current archive usable.')
      }
      await stat(quarantinedRestore)
      new CollectionDatabase(archiveSmokePath).close()
    } finally {
      await rm(archiveSmokeRoot, { recursive: true, force: true })
    }
    await helper.request('health')
    const writeTransaction = await helper.request<{ passed: boolean }>('self-test-write-transaction')
    if (!writeTransaction.passed) {
      throw new Error('Verified write transaction self-test failed.')
    }
    const liveQueue = await helper.request<{
      passed: boolean
      fields: number
      hookSha256: string
      injectorSha256: string
      offlineRecoveryPassed: boolean
      staleReceiptRejected: boolean
      queuePathGuardPassed: boolean
      multiItemPassed: boolean
      unsupportedBuildRejected: boolean
    }>('self-test-live-queue')
    if (
      !liveQueue.passed ||
      liveQueue.fields !== 18 ||
      !/^[0-9a-f]{64}$/.test(liveQueue.hookSha256) ||
      !/^[0-9a-f]{64}$/.test(liveQueue.injectorSha256) ||
      !liveQueue.offlineRecoveryPassed ||
      !liveQueue.staleReceiptRejected ||
      !liveQueue.queuePathGuardPassed ||
      !liveQueue.multiItemPassed ||
      !liveQueue.unsupportedBuildRejected
    ) {
      throw new Error('Live queue serializer self-test failed.')
    }
    const helperSnapshot = await helper.request<CollectionSnapshot>('scan-collection')
    const installationPath = helperSnapshot.discovery.installations[0]?.path
    if (!installationPath) throw new Error('Grim Dawn installation was not discovered.')
    const quarantineResolution = await helper.request<ResolvedArchiveCatalogItem[]>(
      'resolve-archive-items',
      {
        installationPath,
        records: [
          'records/items/gearaccessories/medals/b204a_medal.dbr',
          'records/items/gearshoulders/a09_shoulder02.dbr'
        ]
      }
    )
    const rareResolution = quarantineResolution.find((item) =>
      item.record.endsWith('/b204a_medal.dbr')
    )
    const genericResolution = quarantineResolution.find((item) =>
      item.record.endsWith('/a09_shoulder02.dbr')
    )
    if (
      rareResolution?.name !== "Brawler's Distinction" ||
      !rareResolution.catalogEligible ||
      genericResolution?.name !== 'Exalted Shoulderplates' ||
      genericResolution.catalogEligible
    ) {
      throw new Error('Installed-data quarantine classification did not preserve archive boundaries.')
    }
    const supplies = helperSnapshot.supplies ?? []
    const materials = helperSnapshot.materials ?? []
    const writ = supplies.find((item) => item.slot === 'writ')
    const mandate = supplies.find((item) => item.slot === 'mandate')
    const warrant = supplies.find((item) => item.slot === 'warrant')
    const merits = supplies.filter((item) => item.slot === 'merit')
    const saviorsMerit = merits.find((item) => item.name === "Savior's Merit")
    const clarityPotion = supplies.find((item) =>
      item.record.toLocaleLowerCase().endsWith('/xppotion_malmouth.dbr')
    )
    const augment = supplies.find((item) => item.slot === 'augment')
    const movementRune = supplies.find((item) => item.slot === 'rune')
    if (
      supplies.length < 300 ||
      supplies.some((item) => item.rarity !== 'supply') ||
      !writ ||
      !mandate ||
      !warrant ||
      merits.length !== 4 ||
      !saviorsMerit?.bitmap?.endsWith('/difficulty_legendaryunlock.tex') ||
      !saviorsMerit.presentation?.sections.some((section) =>
        section.lines.some((line) => line.label === 'Unlocks Ultimate difficulty')
      ) ||
      clarityPotion?.slot !== 'potion' ||
      !clarityPotion.presentation?.grantedSkill?.lines.some(
        (line) => line.label === 'Experience Gained' && line.minimum === 100
      ) ||
      !augment ||
      !movementRune
    ) {
      throw new Error('Reusable supply catalog did not include faction boosts, merits, Potion of Clarity, augments, and movement runes.')
    }
    if (
      materials.filter((item) => item.rarity === 'component').length < 40 ||
      !materials.some((item) => item.record.toLocaleLowerCase().endsWith('/quest_dynamite.dbr')) ||
      !materials.some((item) => item.slot === 'potion-formula')
    ) {
      throw new Error('Component and consumable account stores were not indexed.')
    }
    const characterProfiles = await helper.request<CharacterSaveProfile[]>('list-characters', {
      installationPath: helperSnapshot.discovery.installations[0]?.path
    })
    const sanya = characterProfiles.find((profile) => profile.name === 'Sanya' && !profile.error)
    if (
      characterProfiles.length === 0 ||
      characterProfiles.some((profile) => profile.error) ||
      !sanya?.skills.some((skill) => skill.name === 'Devouring Swarm' && skill.level > 0) ||
      !sanya.factions.some((faction) => faction.name === 'Devil\'s Crossing')
    ) {
      throw new Error('Read-only character loading did not validate current local and cloud saves.')
    }
    const factionPlannerItems = helperSnapshot.plannerItems ?? []
    const chosenArcanespark = factionPlannerItems.find((item) => item.name === 'Chosen Arcanespark')
    if (
      factionPlannerItems.length < 450 ||
      factionPlannerItems.some((item) => item.rarity !== 'faction') ||
      !chosenArcanespark?.acquisition?.factions?.some(
        (requirement) =>
          requirement.faction === "Kymon's Chosen" && requirement.reputation === 'Respected'
      )
    ) {
      throw new Error('Faction planning catalog did not preserve reputation vendor requirements.')
    }
    const monsterInfrequents = helperSnapshot.items.filter((item) => item.rarity === 'mi')
    const frostsnarlTiers = monsterInfrequents.filter((item) => item.name === "Frostsnarl's Horns")
    const skillRareTiers = new Map(
      ['Weaver Ring', 'Devourer Ring', 'Ascended Shoulderplates'].map((name) => [
        name,
        monsterInfrequents.filter((item) => item.name === name)
      ])
    )
    const unresolvedMiSources = monsterInfrequents.filter(
      (item) => !item.acquisition?.sources.some((source) => source.startsWith('Dropped by '))
    )
    if (
      monsterInfrequents.length < 1_600 ||
      unresolvedMiSources.length > 20 ||
      frostsnarlTiers.length !== 6 ||
      frostsnarlTiers.some(
        (item) => item.acquisition?.sources[0] !== 'Dropped by Frostsnarl the Chosen'
      )
    ) {
      throw new Error('Monster Infrequent source traversal did not resolve every live MI tier.')
    }
    if (
      skillRareTiers.get('Weaver Ring')?.length !== 7 ||
      skillRareTiers.get('Devourer Ring')?.length !== 6 ||
      skillRareTiers.get('Ascended Shoulderplates')?.length !== 6 ||
      [...skillRareTiers.values()].flat().some(
        (item) => !item.acquisition?.sources.some((source) => source.startsWith('Dropped by '))
      )
    ) {
      throw new Error('Build-defining green skill bases were not catalogued with their source tiers.')
    }
    const ignusShoulders = helperSnapshot.items.find((item) => item.name === "Ignus' Shoulderguards")
    const bloodswornSignet = helperSnapshot.items.find((item) => item.name === 'Bloodsworn Signet')
    const kravallShoulders = helperSnapshot.items.find((item) => item.name === "Kra'vall Shoulderguards")
    const loghorreanShoulders = helperSnapshot.items.find((item) => item.name === "Loghorrean's Corruption")
    if (
      !ignusShoulders?.acquisition?.sources.every((source) => source.startsWith('Dropped by ')) ||
      !bloodswornSignet?.acquisition?.sources.every((source) => source.startsWith('Dropped by ')) ||
      !kravallShoulders?.acquisition?.sources.some((source) => source.startsWith('Found in ')) ||
      !loghorreanShoulders?.acquisition?.sources.some((source) => source.startsWith('Found in '))
    ) {
      throw new Error('MI acquisition indexing did not separate monster drops from chest-only bases.')
    }
    const deterministicRecipes = helperSnapshot.items.filter((item) => item.acquisition?.crafting)
    const abyssalMask = deterministicRecipes.find((item) => item.name === 'Abyssal Mask')
    const mistbornTalisman = deterministicRecipes.find((item) => item.name === 'Mistborn Talisman')
    const randomLegendary = helperSnapshot.items.find((item) => item.name === 'Demonbone Legplates')
    if (
      deterministicRecipes.length < 400 ||
      !abyssalMask?.acquisition?.crafting?.knownSoftcore ||
      mistbornTalisman?.rarity !== 'rare' ||
      !mistbornTalisman.acquisition?.crafting?.blueprintRecords.some((record) =>
        record.endsWith('/craft_relic_b011.dbr')
      ) ||
      randomLegendary?.acquisition?.crafting
    ) {
      throw new Error('Known-blueprint indexing did not distinguish direct recipes from random crafting tables.')
    }
    const mapIndex = await helper.request<MapLocationIndex>('build-map-location-index', {
      installationPath: helperSnapshot.discovery.installations[0]?.path
    })
    const frostsnarlLocations =
      mapIndex.sourceLocations[
        'records/creatures/enemies/boss&quest/dranghoul_frostsnarl_01.dbr'
      ] ?? []
    if (!frostsnarlLocations.some((location) => location.name.includes("Kruu'Sul Crags"))) {
      throw new Error('Map location index did not place Frostsnarl in Kruu\'Sul Crags.')
    }
    const campaignLocationExamples = [
      'records/creatures/enemies/nemesis/nemesis_kymon_01.dbr',
      'records/creatures/enemies/nemesis/nemesis_orderdeathsvigil_02.dbr',
      'records/creatures/enemies/boss&quest/cultist_chthonianmonstrosity.dbr'
    ]
    if (campaignLocationExamples.some((record) =>
      !(mapIndex.sourceLocations[record] ?? []).some((location) => location.zoneRecord)
    )) {
      throw new Error('Map location index did not resolve scripted nemesis and summoned-boss campaign sources.')
    }
    const shatteredRealmLocations = Object.values(mapIndex.sourceLocations)
      .flat()
      .filter((location) => location.levelFile.includes('/EndlessDungeon/'))
    if (
      mapIndex.miTierCount - mapIndex.locatedMiTierCount > 128 ||
      shatteredRealmLocations.length > 0
    ) {
      throw new Error('Map location index retained Shattered Realm proxies or lost too many campaign item tiers.')
    }
    const flamebrand = helperSnapshot.items.find((item) => item.name === 'Flamebrand')
    const flamebrandFire = flamebrand?.presentation?.sections
      .flatMap((section) => section.lines)
      .find((line) => line.label === 'Fire Damage')
    if (
      !flamebrand?.presentation?.searchText.includes('Fire Strike') ||
      flamebrandFire?.minimum !== 40 ||
      flamebrandFire.maximum !== 60
    ) {
      throw new Error('Catalog presentation did not preserve Flamebrand skill text and roll ranges.')
    }
    const mythicalMaw = helperSnapshot.items.find(
      (item) => item.name === 'Mythical Maw of the Damned'
    )
    const mawGrantedLines = mythicalMaw?.presentation?.grantedSkill?.lines ?? []
    if (
      mawGrantedLines.find((line) => line.label === 'Energy Cost')?.minimum !== 60 ||
      mawGrantedLines.find((line) => line.label === 'Bleeding Damage over 3 Seconds')?.minimum !== 1320 ||
      mythicalMaw?.presentation?.sections.filter((section) => section.kind === 'skill-modifier').length !== 3
    ) {
      throw new Error('Catalog presentation did not resolve Mythical Maw skill levels and modifiers.')
    }
    const jackalStep = helperSnapshot.items.find((item) => item.name === "Mythical Jackal's Step")
    const stunBlast = helperSnapshot.items
      .flatMap((item) => item.setPresentation?.tiers ?? [])
      .map((tier) => tier.grantedSkill)
      .find((skill) => skill?.name === 'Stun Blast')
    if (
      jackalStep?.presentation?.grantedSkill?.trigger !== '20% Chance when Hit' ||
      stunBlast?.trigger !== '35% Chance on Default Weapon Attack'
    ) {
      throw new Error('Granted passive and proc skills did not preserve their activation trigger.')
    }
    const forbiddenMark = helperSnapshot.items.find(
      (item) => item.name === 'Mythical Mark of the Forbidden'
    )
    const wendigoModifier = forbiddenMark?.presentation?.sections.find(
      (section) => section.kind === 'skill-modifier' && section.heading === 'Wendigo Totem'
    )
    const anySkillConversion = helperSnapshot.items
      .flatMap((item) => item.presentation?.sections ?? [])
      .filter((section) => section.kind === 'skill-modifier')
      .flatMap((section) => section.lines)
      .some((line) => line.label.includes('Damage converted to'))
    if (
      wendigoModifier?.lines.find((line) => line.label === 'Vitality Damage')?.minimum !== 100 ||
      !anySkillConversion
    ) {
      throw new Error('Pet skill modifiers did not preserve special damage or conversion payloads.')
    }
    const oathbreaker = helperSnapshot.items.find((item) => item.setName === 'Oathbreaker')
      ?.setPresentation
    const marauder = helperSnapshot.items.find((item) => item.setName === "Marauder's Justice")
      ?.setPresentation
    const brimstone = helperSnapshot.items.find((item) => item.setName === 'Brimstone')
      ?.setPresentation
    const lightsGuardian = helperSnapshot.items.find((item) => item.setName === "Light's Guardian")
      ?.setPresentation
    const lightningNova = lightsGuardian?.tiers
      .flatMap((tier) => tier.grantedSkill?.linkedSkills ?? [])
      .find((skill) => skill.name === 'Lightning Nova')
    const lightningNovaDamage = lightningNova?.lines.find((line) => line.label === 'Lightning Damage')
    const lightningNovaElectrocute = lightningNova?.lines.find(
      (line) => line.label === 'Electrocute Damage over 2 Seconds'
    )
    if (
      !oathbreaker?.tiers.some(
        (tier) => tier.lines.some((line) => line.tone === 'skill' && line.minimum === 3) &&
          tier.grantedSkill
      ) ||
      !marauder?.tiers.some(
        (tier) =>
          tier.requiredPieces === 3 &&
          tier.lines.some((line) => line.label === 'Fire Damage' && line.minimum === 7) &&
          tier.lines.some((line) => line.label === 'Cold Damage' && line.minimum === 7)
      ) ||
      !brimstone?.tiers.some(
        (tier) =>
          tier.requiredPieces === 2 &&
          tier.lines.some((line) => line.label === 'Fire Damage' && line.minimum === 18)
      ) ||
      lightningNovaDamage?.minimum !== 320 ||
      lightningNovaDamage.maximum !== 500 ||
      lightningNovaElectrocute?.minimum !== 600
    ) {
      throw new Error('Set presentation omitted or misleveled flat damage, skill bonuses, or granted skills.')
    }
    const iceKing = helperSnapshot.items.find((item) => item.setName === "Ice King's Adornments")
      ?.setPresentation
    const iceKingModifiers = iceKing?.tiers.flatMap((tier) => tier.skillModifiers) ?? []
    const iceKingHellhound = iceKingModifiers.find(
      (section) => section.kind === 'skill-modifier' && section.heading === 'Summon Hellhound'
    )
    const iceKingVisual = iceKingModifiers.find(
      (section) => section.kind === 'visual-modifier' &&
        section.lines.some((line) => line.label === 'Summoned form: Direwolf')
    )
    const anyWpsSetModifier = helperSnapshot.items
      .flatMap((item) => item.setPresentation?.tiers ?? [])
      .flatMap((tier) => tier.skillModifiers)
      .filter((section) => section.kind === 'skill-modifier')
      .some((section) =>
        section.lines.some((line) => line.label === 'Weapon Damage') &&
        section.lines.some((line) => line.label === 'Chance on Default Weapon Attack')
      )
    const anyProjectileVisual = helperSnapshot.items
      .flatMap((item) => item.setPresentation?.tiers ?? [])
      .flatMap((tier) => tier.skillModifiers)
      .filter((section) => section.kind === 'visual-modifier')
      .some((section) =>
        section.lines.some((line) => line.label === 'Alternate projectile effects')
      )
    if (
      iceKingHellhound?.lines.find(
        (line) => line.label === 'Chaos Damage converted to Cold Damage'
      )?.minimum !== 100 ||
      !iceKingVisual ||
      !anyWpsSetModifier ||
      !anyProjectileVisual
    ) {
      throw new Error('Set presentation omitted a mechanical or visual skill modifier.')
    }
    const invertedRange = helperSnapshot.items
      .flatMap((item) => item.presentation?.sections ?? [])
      .flatMap((section) => section.lines)
      .find(
        (line) =>
          line.minimum !== null && line.maximum !== null && line.minimum > line.maximum
      )
    if (invertedRange) {
      throw new Error(`Catalog presentation produced an inverted range for ${invertedRange.label}.`)
    }
    const analyzedCopies = helperSnapshot.observedItems.filter(
      (item) => item.rollAnalysis !== null
    )
    const trustedRolls = analyzedCopies.filter(
      (item) =>
        item.rollAnalysis?.trusted === true &&
        item.rollAnalysis.overallEstimatedPercentile !== null &&
        item.rollAnalysis.percentileSampleSize === 4096
    )
    if (analyzedCopies.length === 0 || trustedRolls.length === 0) {
      throw new Error('Collection scan did not produce any trusted roll analyses.')
    }
    for (const item of helperSnapshot.items.filter((candidate) => candidate.bestRollPercentile !== null)) {
      const expected = Math.max(
        ...trustedRolls
          .filter((copy) => copy.baseRecord.toLowerCase() === item.record.toLowerCase())
          .map((copy) => copy.rollAnalysis!.overallEstimatedPercentile!)
      )
      if (Math.abs(expected - item.bestRollPercentile!) > 0.0000001) {
        throw new Error('Catalog best-roll selection does not match its trusted copies: ' + item.record)
      }
    }
    const roundTrips = await Promise.all(
      helperSnapshot.scannedStashes.map((stash) =>
        helper.request<{ semanticallyEquivalent: boolean; idempotent: boolean }>(
          'validate-transfer-stash-roundtrip',
          { path: stash.path }
        )
      )
    )
    if (roundTrips.some((result) => !result.semanticallyEquivalent || !result.idempotent)) {
      throw new Error('A transfer stash failed serializer round-trip validation.')
    }
    const ingestPlans = await Promise.all(
      helperSnapshot.scannedStashes
        .filter((stash) => stash.itemCount > 0)
        .map((stash) => {
          const observed = helperSnapshot.observedItems.find(
            (item) => item.sourcePath.toLowerCase() === stash.path.toLowerCase()
          )
          if (!observed) {
            throw new Error('Non-empty stash has no observed item: ' + stash.path)
          }
          return helper.request<{
            sourceItemCount: number
            replacementItemCount: number
            semanticallyValid: boolean
            idempotent: boolean
            items: Array<{ baseRecord: string; [key: string]: unknown }>
          }>('validate-ingest-plan', {
            path: stash.path,
            tabIndex: observed.tabIndex,
            itemIndex: observed.itemIndex
          })
        })
    )
    if (
      ingestPlans.some(
        (plan) =>
          !plan.semanticallyValid ||
          !plan.idempotent ||
          plan.replacementItemCount !== plan.sourceItemCount - 1
      )
    ) {
      throw new Error('A transfer stash failed the in-memory ingest plan validation.')
    }
    const retrievalRoundTrips = await Promise.all(
      helperSnapshot.scannedStashes
        .filter((stash) => stash.itemCount > 0)
        .map((stash) => {
          const observed = helperSnapshot.observedItems.find(
            (item) => item.sourcePath.toLowerCase() === stash.path.toLowerCase()
          )
          if (!observed) {
            throw new Error('Non-empty stash has no observed item: ' + stash.path)
          }
          return helper.request<{
            sourceItemCount: number
            restoredItemCount: number
            semanticallyEquivalent: boolean
            idempotent: boolean
          }>('validate-ingest-retrieval-roundtrip', {
            path: stash.path,
            tabIndex: observed.tabIndex,
            itemIndex: observed.itemIndex
          })
        })
    )
    if (
      retrievalRoundTrips.some(
        (result) =>
          !result.semanticallyEquivalent ||
          !result.idempotent ||
          result.restoredItemCount !== result.sourceItemCount
      )
    ) {
      throw new Error('A transfer stash failed the in-memory ingest/retrieval roundtrip.')
    }
    const snapshot = database.persistSnapshot(helperSnapshot)
    if (snapshot.supplySummary?.total !== supplies.length) {
      throw new Error('Reusable supply completion was not projected into the collection snapshot.')
    }
    const recipeArchiveSnapshot = withRecipeCollection(
      database.presentArchiveSnapshot(snapshot, [], false),
      false
    )
    const recipeUnlockedMask = recipeArchiveSnapshot.items.find(
      (item) => item.name === 'Abyssal Mask'
    )
    if (
      recipeArchiveSnapshot.recipeSummary.total < 400 ||
      recipeArchiveSnapshot.recipeSummary.collected === 0 ||
      !recipeUnlockedMask?.recipeUnlocked ||
      recipeUnlockedMask.discovered ||
      recipeUnlockedMask.availableCount !== 0
    ) {
      throw new Error('Known recipes did not stay explicit and separate from discovered copies.')
    }
    const awakenedCatalogItem = helperSnapshot.items.find((item) => item.baseVersionRecord)
    const awakeningBase = awakenedCatalogItem?.baseVersionRecord
      ? helperSnapshot.items.find(
          (item) => item.record.toLowerCase() === awakenedCatalogItem.baseVersionRecord!.toLowerCase()
        )
      : undefined
    if (!awakenedCatalogItem || !awakeningBase) {
      throw new Error('Catalog did not link an Awakened Legendary to its Epic base.')
    }
    const [availableAwakened] = withAwakeningAvailability(
      [{ ...awakenedCatalogItem, availableCount: 0, discovered: false }],
      [{ ...awakeningBase, availableCount: 1, discovered: true }]
    )
    if (
      !availableAwakened ||
      !isCollectionOwned(availableAwakened) ||
      !availableAwakened.availableViaAwakening ||
      availableAwakened.availableCount !== 0 ||
      availableAwakened.awakeningSourceRecord?.toLowerCase() !== awakeningBase.record.toLowerCase()
    ) {
      throw new Error('Owned Epic bases did not qualify their Awakened Legendary without fabricating a stored copy.')
    }
    const pinCandidate = snapshot.observedItems.find(
      (item) => item.instanceKey && item.rollAnalysis?.trusted
    )
    if (!pinCandidate?.instanceKey) {
      throw new Error('Smoke test needs one trusted copy to verify pinned-best persistence.')
    }
    database.setPinnedBest(pinCandidate.baseRecord, pinCandidate.instanceKey)
    const pinnedSnapshot = database.persistSnapshot({
      ...helperSnapshot,
      scannedAtUtc: new Date(Date.parse(helperSnapshot.scannedAtUtc) + 0.5).toISOString()
    })
    const pinnedCatalogItem = pinnedSnapshot.items.find(
      (item) => item.record.toLowerCase() === pinCandidate.baseRecord.toLowerCase()
    )
    if (pinnedCatalogItem?.pinnedInstanceKey !== pinCandidate.instanceKey) {
      throw new Error('Pinned-best selection did not survive a subsequent collection snapshot.')
    }
    database.setPinnedBest(pinCandidate.baseRecord, null)
    const journalPayload = ingestPlans[0]?.items[0]
    if (!journalPayload) {
      throw new Error('Smoke test needs one item payload to verify retrieval journal transitions.')
    }
    const journalVaultItemId = randomUUID()
    const ingestOperationId = randomUUID()
    database.prepareIngestOperation({
      operationId: ingestOperationId,
      stashPath: 'smoke-test-transfer.gsh',
      sourceSha256: 'smoke-source',
      startedAtUtc: new Date().toISOString(),
      items: [
        {
          vaultItemId: journalVaultItemId,
          baseRecord: journalPayload.baseRecord,
          payload: journalPayload
        }
      ],
      detail: { phase: 'prepared', smokeTest: true }
    })
    database.completeIngestOperation({
      operationId: ingestOperationId,
      backupPath: 'smoke-ingest-backup',
      completedAtUtc: new Date().toISOString(),
      isHardcore: true,
      detail: { phase: 'committed', smokeTest: true }
    })
    const archivedSmokeCopy = helperSnapshot.observedItems.find(
      (item) =>
        item.baseRecord.toLowerCase() === journalPayload.baseRecord.toLowerCase() &&
        item.seed === journalPayload.seed
    )
    const archivedBeforeRetrieval = database
      .presentArchiveSnapshot(snapshot, archivedSmokeCopy ? [archivedSmokeCopy] : [], true)
      .items.find((item) => item.record.toLowerCase() === journalPayload.baseRecord.toLowerCase())
    if (
      !archivedBeforeRetrieval?.discovered ||
      archivedBeforeRetrieval.availableCount !== 1
    ) {
      throw new Error('Codex Archive did not own the newly ingested item.')
    }
    const retrievalOperationId = randomUUID()
    database.prepareRetrievalOperation({
      operationId: retrievalOperationId,
      stashPath: 'smoke-test-transfer.gsh',
      sourceSha256: 'smoke-retrieval-source',
      startedAtUtc: new Date().toISOString(),
      vaultItemIds: [journalVaultItemId],
      detail: { phase: 'prepared', smokeTest: true }
    })
    if (database.getVaultItems([journalVaultItemId])[0]?.state !== 'retrieval_pending') {
      throw new Error('Vault item did not enter retrieval_pending state.')
    }
    database.completeRetrievalOperation({
      operationId: retrievalOperationId,
      backupPath: 'smoke-retrieval-backup',
      completedAtUtc: new Date().toISOString(),
      vaultItemIds: [journalVaultItemId],
      detail: { phase: 'committed', smokeTest: true }
    })
    const archivedAfterRetrieval = database
      .presentArchiveSnapshot(snapshot, [], true)
      .items.find((item) => item.record.toLowerCase() === journalPayload.baseRecord.toLowerCase())
    if (!archivedAfterRetrieval?.discovered || archivedAfterRetrieval.availableCount !== 0) {
      throw new Error('Codex Archive did not retain collection history after retrieval.')
    }
    if (database.getVaultItems([journalVaultItemId])[0]?.state !== 'retrieved') {
      throw new Error('Vault item did not enter retrieved state.')
    }
    const listedVaultItem = database.listVaultItems().find((item) => item.id === journalVaultItemId)
    if (
      !listedVaultItem ||
      listedVaultItem.state !== 'retrieved' ||
      listedVaultItem.seed !== (journalPayload.seed as number)
    ) {
      throw new Error('Vault listing did not project the stored payload and lifecycle state.')
    }
    const reusableVaultItemId = randomUUID()
    const reusableIngestOperationId = randomUUID()
    database.prepareIngestOperation({
      operationId: reusableIngestOperationId,
      stashPath: 'smoke-test-transfer.gsh',
      sourceSha256: 'smoke-reusable-source',
      startedAtUtc: new Date().toISOString(),
      items: [
        {
          vaultItemId: reusableVaultItemId,
          baseRecord: warrant.record,
          payload: { baseRecord: warrant.record, seed: 42, stackCount: 99 }
        }
      ],
      detail: { phase: 'prepared', smokeTest: true, reusable: true }
    })
    database.completeIngestOperation({
      operationId: reusableIngestOperationId,
      backupPath: 'smoke-reusable-ingest-backup',
      completedAtUtc: new Date().toISOString(),
      isHardcore: true,
      detail: { phase: 'committed', smokeTest: true, reusable: true }
    })
    const reusableBeforeRetrieval = database.getVaultItems([reusableVaultItemId])[0]
    if (
      !reusableBeforeRetrieval?.reusable ||
      reusableBeforeRetrieval.state !== 'ingested' ||
      (reusableBeforeRetrieval.payload as { stackCount?: number }).stackCount !== 1
    ) {
      throw new Error('Reusable supply ingest did not retain one normalized dispensable template.')
    }
    const reusableRetrievalOperationId = randomUUID()
    database.prepareRetrievalOperation({
      operationId: reusableRetrievalOperationId,
      stashPath: 'smoke-test-transfer.gsh',
      sourceSha256: 'smoke-reusable-retrieval-source',
      startedAtUtc: new Date().toISOString(),
      vaultItemIds: [reusableVaultItemId],
      detail: { phase: 'prepared', smokeTest: true, reusable: true }
    })
    database.completeRetrievalOperation({
      operationId: reusableRetrievalOperationId,
      backupPath: 'smoke-reusable-retrieval-backup',
      completedAtUtc: new Date().toISOString(),
      vaultItemIds: [reusableVaultItemId],
      detail: { phase: 'committed', smokeTest: true, reusable: true }
    })
    const reusableAfterRetrieval = database.getVaultItems([reusableVaultItemId])[0]
    const listedReusable = database.listVaultItems().find((item) => item.id === reusableVaultItemId)
    if (
      reusableAfterRetrieval?.state !== 'ingested' ||
      !reusableAfterRetrieval.reusable ||
      listedReusable?.state !== 'ingested' ||
      !listedReusable.reusable ||
      listedReusable.slot !== 'warrant'
    ) {
      throw new Error('Dispensing a reusable supply consumed its stored unlock.')
    }
    const ingestedPage = database.queryVaultItems({
      state: 'ingested',
      isHardcore: true,
      sort: 'recent',
      direction: 'desc',
      offset: 0,
      limit: 1
    })
    const retrievedPage = database.queryVaultItems({
      state: 'retrieved',
      sort: 'name',
      direction: 'asc',
      offset: 0,
      limit: 1
    })
    const searchedPage = database.queryVaultItems({
      state: 'ingested',
      query: listedReusable.name,
      sort: 'level',
      direction: 'desc',
      offset: 0,
      limit: 100
    })
    const escapedSearchPage = database.queryVaultItems({
      state: 'ingested',
      query: '%_',
      sort: 'roll',
      direction: 'desc',
      offset: 0,
      limit: 100
    })
    const structuredSearchPage = database.queryVaultItems({
      state: 'ingested',
      query: `base:"${warrant.record}" AND seed:42 AND mode:hardcore`,
      sort: 'level',
      direction: 'desc',
      offset: 0,
      limit: 100
    })
    const negatedSearchPage = database.queryVaultItems({
      state: 'ingested',
      query: `base:"${warrant.record}" AND NOT seed:42`,
      sort: 'recent',
      direction: 'desc',
      offset: 0,
      limit: 100
    })
    const ingestionHistory = database.queryOperationHistory({
      operation: 'ingest',
      outcome: 'committed',
      query: journalPayload.baseRecord,
      offset: 0,
      limit: 100
    })
    const retrievalHistory = database.queryOperationHistory({
      operation: 'retrieve',
      outcome: 'all',
      query: retrievalOperationId,
      offset: 0,
      limit: 100
    })
    const structuredHistory = database.queryOperationHistory({
      operation: 'ingest',
      outcome: 'all',
      query: `id:${ingestOperationId} AND mode:hardcore AND seed:${journalPayload.seed}`,
      offset: 0,
      limit: 100
    })
    let invalidStructuredSearchRejected = false
    try {
      database.queryVaultItems({
        state: 'ingested', query: 'level:ancient', sort: 'recent', direction: 'desc', offset: 0, limit: 100
      })
    } catch (error) {
      invalidStructuredSearchRejected = error instanceof Error && error.message.includes('needs a number')
    }
    const journalIngest = ingestionHistory.items.find((entry) => entry.id === ingestOperationId)
    const journalRetrieval = retrievalHistory.items.find((entry) => entry.id === retrievalOperationId)
    const vaultSummary = database.getVaultSummary()
    if (!structuredSearchPage.items.some((item) => item.id === reusableVaultItemId)) {
      throw new Error(`Structured vault search missed its fixture (${structuredSearchPage.total} matches).`)
    }
    if (negatedSearchPage.items.some((item) => item.id === reusableVaultItemId)) {
      throw new Error('Negated structured vault search retained the excluded fixture.')
    }
    if (structuredHistory.items[0]?.id !== ingestOperationId) {
      throw new Error(`Structured operation search missed its fixture (${structuredHistory.total} matches).`)
    }
    if (!invalidStructuredSearchRejected) {
      throw new Error('Invalid numeric structured search did not return an actionable error.')
    }
    if (
      ingestedPage.total < 1 ||
      ingestedPage.items.length !== 1 ||
      retrievedPage.total < 1 ||
      retrievedPage.items.length !== 1 ||
      !searchedPage.items.some((item) => item.id === reusableVaultItemId) ||
      escapedSearchPage.total !== 0 ||
      journalIngest?.isHardcore !== true ||
      journalIngest.itemCount !== 1 ||
      journalIngest.items[0]?.seed !== journalPayload.seed ||
      journalRetrieval?.state !== 'committed' ||
      journalRetrieval.itemCount !== 1 ||
      vaultSummary.total < 2 ||
      vaultSummary.ingested < 1 ||
      vaultSummary.retrieved < 1
    ) {
      throw new Error('Paged vault querying did not preserve filtering, sorting, or summary counts.')
    }
    const clarityVaultItemId = randomUUID()
    const clarityIngestOperationId = randomUUID()
    database.prepareIngestOperation({
      operationId: clarityIngestOperationId,
      stashPath: 'smoke-test-transfer.gsh',
      sourceSha256: 'smoke-clarity-source',
      startedAtUtc: new Date().toISOString(),
      items: [
        {
          vaultItemId: clarityVaultItemId,
          baseRecord: clarityPotion.record,
          payload: { baseRecord: clarityPotion.record, seed: 43, stackCount: 20 }
        }
      ],
      detail: { phase: 'prepared', smokeTest: true, finiteStack: true }
    })
    database.completeIngestOperation({
      operationId: clarityIngestOperationId,
      backupPath: 'smoke-clarity-ingest-backup',
      completedAtUtc: new Date().toISOString(),
      isHardcore: true,
      detail: { phase: 'committed', smokeTest: true, finiteStack: true }
    })
    const storedClarity = database.getVaultItems([clarityVaultItemId])[0]
    if (
      storedClarity?.state !== 'ingested' ||
      storedClarity.reusable ||
      (storedClarity.payload as { stackCount?: number }).stackCount !== 20
    ) {
      throw new Error('Potion of Clarity did not preserve its finite stack count in Supplies.')
    }
    if (!database.getInfiniteSupplies() || database.setInfiniteSupplies(false) !== false) {
      throw new Error('Infinite-supplies setting did not persist its disabled state.')
    }
    if (
      database.getDebugLogging() ||
      database.setDebugLogging(true) !== true ||
      !database.getDebugLogging() ||
      database.setDebugLogging(false) !== false ||
      database.getDebugLogging()
    ) {
      throw new Error('Debug-logging setting did not round-trip safely.')
    }
    const finiteRetrievalOperationId = randomUUID()
    database.prepareRetrievalOperation({
      operationId: finiteRetrievalOperationId,
      stashPath: 'smoke-test-transfer.gsh',
      sourceSha256: 'smoke-finite-supply-source',
      startedAtUtc: new Date().toISOString(),
      vaultItemIds: [reusableVaultItemId],
      detail: { phase: 'prepared', smokeTest: true, reusable: false }
    })
    database.completeRetrievalOperation({
      operationId: finiteRetrievalOperationId,
      backupPath: 'smoke-finite-supply-backup',
      completedAtUtc: new Date().toISOString(),
      vaultItemIds: [reusableVaultItemId],
      detail: { phase: 'committed', smokeTest: true, reusable: false }
    })
    database.setInfiniteSupplies(true)
    const finiteAfterRetrieval = database.getVaultItems([reusableVaultItemId])[0]
    const clarityAfterSettingToggle = database.getVaultItems([clarityVaultItemId])[0]
    if (
      finiteAfterRetrieval?.state !== 'retrieved' ||
      finiteAfterRetrieval.reusable ||
      clarityAfterSettingToggle?.reusable ||
      (clarityAfterSettingToggle?.payload as { stackCount?: number } | undefined)?.stackCount !== 20 ||
      !database.getInfiniteSupplies()
    ) {
      throw new Error('Disabling infinite supplies did not consume the dispensed stored copy.')
    }
    const migrationInput = {
      sourcePath: 'smoke-gdia-userdata.db',
      sourceSha256: 'smoke-gdia-source',
      backupPath: 'smoke-gdia-backup',
      importedAtUtc: new Date().toISOString(),
      items: [1, 2].map((externalId) => ({
        externalId: String(externalId),
        baseRecord: journalPayload.baseRecord as string,
        isHardcore: true,
        createdAtUtc: new Date().toISOString(),
        payload: journalPayload
      }))
    }
    const migration = database.importVaultItems(migrationInput)
    const repeatedMigration = database.importVaultItems(migrationInput)
    if (
      migration.importedIds.length !== 2 ||
      migration.duplicateIds.length !== 0 ||
      repeatedMigration.importedIds.length !== 0 ||
      repeatedMigration.duplicateIds.length !== 2
    ) {
      throw new Error('GDIA migration did not preserve copy multiplicity or idempotency.')
    }
    let duplicateSelectionRejected = false
    try {
      database.getVaultItems([migration.importedIds[0]!, migration.importedIds[0]!], true)
    } catch (error) {
      duplicateSelectionRejected =
        error instanceof Error && error.message.includes('Duplicate vault item IDs')
    }
    if (!duplicateSelectionRejected) {
      throw new Error('Vault retrieval accepted the same copy ID more than once.')
    }
    const failedRetrievalId = randomUUID()
    database.prepareRetrievalOperation({
      operationId: failedRetrievalId,
      stashPath: 'smoke-full-target.gsh',
      sourceSha256: 'smoke-full-target',
      startedAtUtc: new Date().toISOString(),
      vaultItemIds: [migration.importedIds[0]!],
      detail: { phase: 'prepared', smokeTest: true, scenario: 'full_target' }
    })
    database.failRetrievalOperation(
      failedRetrievalId,
      [migration.importedIds[0]!],
      new Error('Target tab is full.')
    )
    if (database.getVaultItems([migration.importedIds[0]!], true)[0]?.state !== 'ingested') {
      throw new Error('A rejected retrieval did not return its copy to ingested state.')
    }
    const committedDeliveryId = randomUUID()
    database.prepareDeliveryOperation({
      operationId: committedDeliveryId,
      destination: 'live://smoke/personal-inventory',
      payloadSha256: 'smoke-delivery-payload',
      startedAtUtc: new Date().toISOString(),
      detail: { phase: 'prepared', smokeTest: true, transferKind: 'generated_delivery' }
    })
    database.updatePendingOperationDetail(committedDeliveryId, {
      phase: 'queued',
      queues: [{ operationId: `${committedDeliveryId}-0`, semanticSha256: 'smoke-semantic-hash' }]
    })
    database.completeDeliveryOperation({
      operationId: committedDeliveryId,
      receiptPath: 'smoke-delivery-receipt',
      completedAtUtc: new Date().toISOString(),
      detail: { phase: 'committed', smokeTest: true, transferKind: 'generated_delivery' }
    })
    const rejectedDeliveryId = randomUUID()
    database.prepareDeliveryOperation({
      operationId: rejectedDeliveryId,
      destination: 'live://smoke/personal-inventory',
      payloadSha256: 'smoke-rejected-delivery-payload',
      startedAtUtc: new Date().toISOString(),
      detail: { phase: 'prepared', smokeTest: true, transferKind: 'generated_delivery' }
    })
    database.failDeliveryOperation(rejectedDeliveryId, new Error('Target inventory is full.'))
    const deliveryJournal = database.getDiagnosticSummary().journalStates
    if (
      !deliveryJournal.some(
        (entry) => entry.operation === 'retrieve' && entry.state === 'committed' && entry.count >= 2
      ) ||
      !deliveryJournal.some(
        (entry) => entry.operation === 'retrieve' && entry.state === 'failed' && entry.count >= 2
      )
    ) {
      throw new Error('Generated live deliveries did not retain committed and rejected journal outcomes.')
    }
    const rollCacheCandidate = database
      .listAvailableArchiveItems(true)
      .find((item) => item.id === migration.importedIds[0])
    const sourceRoll = archivedSmokeCopy?.rollAnalysis
    if (!rollCacheCandidate || !sourceRoll) {
      throw new Error('Smoke test needs an archived analyzed copy to verify roll caching.')
    }
    const pendingRollsBefore = database.countArchiveRollAnalysisCandidates(
      ROLL_ANALYSIS_VERSION,
      true
    )
    if (
      !database
        .listArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION, 1_000, true)
        .some((item) => item.id === rollCacheCandidate.id)
    ) {
      throw new Error('Missing archive roll analysis was not selected for bounded hydration.')
    }
    database.setVaultRollAnalyses([{ id: rollCacheCandidate.id, rollAnalysis: sourceRoll }])
    if (
      database.listAvailableArchiveItems(true).find((item) => item.id === rollCacheCandidate.id)
        ?.rollAnalysis?.overallEstimatedPercentile !== sourceRoll.overallEstimatedPercentile
    ) {
      throw new Error('Archive roll analysis did not survive a database round trip.')
    }
    if (
      database.countArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION, true) !==
        pendingRollsBefore - 1 ||
      database
        .listArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION, 1_000, true)
        .some((item) => item.id === rollCacheCandidate.id) ||
      !database
        .listArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION + 1, 1_000, true)
        .some((item) => item.id === rollCacheCandidate.id)
    ) {
      throw new Error('Bounded archive roll hydration did not respect cached model versions.')
    }
    const discovery = snapshot.discovery
    const stashCount = discovery.saveLocations.reduce(
      (count, location) => count + location.transferStashes.length,
      0
    )
    const collected = snapshot.rarities.reduce((count, rarity) => count + rarity.collected, 0)
    const unavailableSnapshot = database.persistSnapshot({
      ...helperSnapshot,
      scannedAtUtc: new Date(Date.parse(helperSnapshot.scannedAtUtc) + 1).toISOString(),
      scannedStashes: [],
      observedItems: [],
      items: helperSnapshot.items.map((item) => ({ ...item, availableCount: 0 }))
    })
    const retainedDiscoveries = unavailableSnapshot.rarities.reduce(
      (count, rarity) => count + rarity.collected,
      0
    )
    if (retainedDiscoveries !== collected) {
      throw new Error('Lifetime discoveries were lost when availability dropped to zero.')
    }
    const recoverySmokeRoot = join(
      app.getPath('temp'),
      `cairn-codex-live-recovery-smoke-${randomUUID()}`
    )
    const recoverySmokePath = join(recoverySmokeRoot, 'archive.sqlite3')
    let recoveryDatabase: CollectionDatabase | null = null
    try {
      await mkdir(recoverySmokeRoot, { recursive: true })
      recoveryDatabase = new CollectionDatabase(recoverySmokePath)
      recoveryDatabase.persistSnapshot(helperSnapshot)
      const recoveryImport = recoveryDatabase.importVaultItems({
        sourcePath: 'smoke-recovery-source',
        sourceSha256: 'smoke-recovery-source-hash',
        backupPath: 'smoke-recovery-backup',
        importedAtUtc: new Date().toISOString(),
        items: [0, 1, 2].map((externalId) => ({
          externalId: `recovery-${externalId}`,
          baseRecord: journalPayload.baseRecord as string,
          isHardcore: true,
          createdAtUtc: new Date().toISOString(),
          payload: journalPayload
        }))
      })
      const queue = (operationId: string, hashCharacter: string): LiveRetrievalQueue => ({
        operationId,
        outgoingPath: join(recoverySmokeRoot, 'queue', `${operationId}.csv`),
        semanticSha256: hashCharacter.repeat(64),
        isHardcore: true,
        baselineDeleted: [],
        baselineIncoming: []
      })
      const incomingItems: LiveIncomingItem[] = [0, 1].map((index) => ({
        path: join(recoverySmokeRoot, 'incoming', `smoke-ingest-${index}.csv`),
        sha256: String(index + 1).repeat(64),
        isHardcore: true,
        item: { ...(journalPayload as unknown as LiveVaultPayload), seed: 1000 + index },
        createdAtUtc: new Date().toISOString()
      }))
      const incomingHelper: HelperRequester = {
        request: async <T>(method: string, params: object = {}): Promise<T> => {
          if (method === 'inspect-live-game') {
            return { state: 'unavailable', detail: 'Offline recovery smoke.' } as T
          }
          if (method === 'poll-live-incoming') return incomingItems as T
          if (method === 'copy-live-incoming' || method === 'ack-live-incoming') {
            const input = params as { path: string; expectedSha256: string }
            return {
              sha256: input.expectedSha256,
              receiptPath: `${input.path}.${method === 'copy-live-incoming' ? 'copied' : 'acknowledged'}`
            } as T
          }
          throw new Error(`Unexpected live-ingest smoke helper method: ${method}`)
        }
      }
      const firstIngestBatch = await syncLiveIncoming(incomingHelper, recoveryDatabase)
      const repeatedIngestBatch = await syncLiveIncoming(incomingHelper, recoveryDatabase)
      if (firstIngestBatch.ingested.length !== 2 || repeatedIngestBatch.ingested.length !== 0) {
        throw new Error('A repeated multi-item live ingest was not idempotent after durable commit.')
      }
      const restartedOperationId = randomUUID()
      const restartedQueue = queue(`${restartedOperationId}-0`, 'a')
      recoveryDatabase.prepareRetrievalOperation({
        operationId: restartedOperationId,
        stashPath: 'live://gdia/hc',
        sourceSha256: 'smoke-restarted-retrieval',
        startedAtUtc: new Date().toISOString(),
        vaultItemIds: [recoveryImport.importedIds[0]!],
        detail: {
          phase: 'queued',
          smokeTest: true,
          vaultItemIds: [recoveryImport.importedIds[0]!],
          queues: [restartedQueue]
        }
      })
      recoveryDatabase.markRetrievalNeedsRecovery(
        restartedOperationId,
        new Error('Simulated CC exit after queueing.')
      )
      let repeatedSubmitRejected = false
      try {
        recoveryDatabase.prepareRetrievalOperation({
          operationId: randomUUID(),
          stashPath: 'live://gdia/hc',
          sourceSha256: 'smoke-repeat-submit',
          startedAtUtc: new Date().toISOString(),
          vaultItemIds: [recoveryImport.importedIds[0]!],
          detail: { phase: 'prepared', smokeTest: true }
        })
      } catch {
        repeatedSubmitRejected = true
      }
      recoveryDatabase.close()
      recoveryDatabase = new CollectionDatabase(recoverySmokePath)
      if (
        !repeatedSubmitRejected ||
        recoveryDatabase.listRecoveryOperations()[0]?.id !== restartedOperationId
      ) {
        throw new Error('A queued retrieval did not survive restart or reject a repeated submit.')
      }

      const recoveryStatuses = new Map<string, LiveRetrievalStatus>([
        [restartedQueue.operationId, {
          state: 'deposited',
          receiptPath: join(recoverySmokeRoot, 'deleted', `${restartedQueue.operationId}.csv`)
        }]
      ])
      const recoveryHelper: HelperRequester = {
        request: async <T>(method: string, params: object = {}): Promise<T> => {
          const input = params as { queue?: LiveRetrievalQueue; path?: string; expectedSha256?: string }
          if (method === 'inspect-live-retrieval' && input.queue) {
            return (recoveryStatuses.get(input.queue.operationId) ?? {
              state: 'unknown', receiptPath: null
            }) as T
          }
          if ((method === 'copy-live-incoming' || method === 'ack-live-incoming') && input.path) {
            return {
              sha256: input.expectedSha256,
              receiptPath: `${input.path}.${method === 'copy-live-incoming' ? 'copied' : 'acknowledged'}`
            } as T
          }
          throw new Error(`Unexpected recovery smoke helper method: ${method}`)
        }
      }
      if (
        await reconcileLiveRecoveryOperations(recoveryHelper, recoveryDatabase, diagnostics) !== 1 ||
        recoveryDatabase.getVaultItems([recoveryImport.importedIds[0]!], true)[0]?.state !== 'retrieved' ||
        recoveryDatabase.getRecoveryOperationCount() !== 0
      ) {
        throw new Error('A deposited retrieval did not reconcile after a simulated CC restart.')
      }

      const generatedOperationId = randomUUID()
      const generatedQueues = [
        queue(`${generatedOperationId}-0`, 'b'),
        queue(`${generatedOperationId}-1`, 'c')
      ]
      recoveryDatabase.prepareDeliveryOperation({
        operationId: generatedOperationId,
        destination: 'live://personal-inventory/augments',
        payloadSha256: 'smoke-generated-delivery',
        startedAtUtc: new Date().toISOString(),
        detail: {
          phase: 'queued',
          smokeTest: true,
          queues: generatedQueues,
          records: ['smoke-augment-a', 'smoke-augment-b']
        }
      })
      recoveryDatabase.markDeliveryNeedsRecovery(
        generatedOperationId,
        new Error('Simulated Grim Dawn exit during a multi-item delivery.')
      )
      recoveryStatuses.set(generatedQueues[0]!.operationId, {
        state: 'deposited',
        receiptPath: join(recoverySmokeRoot, 'deleted', `${generatedQueues[0]!.operationId}.csv`)
      })
      recoveryStatuses.set(generatedQueues[1]!.operationId, {
        state: 'rejected',
        receiptPath: join(recoverySmokeRoot, 'incoming', `${generatedQueues[1]!.operationId}.csv`)
      })
      if (
        await reconcileLiveRecoveryOperations(recoveryHelper, recoveryDatabase, diagnostics) !== 1 ||
        !recoveryDatabase.hasCommittedOperation(generatedOperationId)
      ) {
        throw new Error('A partial multi-item supply delivery did not reconcile deterministically.')
      }

      const staleOperationId = randomUUID()
      const staleQueue = queue(`${staleOperationId}-0`, 'd')
      recoveryDatabase.prepareRetrievalOperation({
        operationId: staleOperationId,
        stashPath: 'live://gdia/hc',
        sourceSha256: 'smoke-stale-receipt',
        startedAtUtc: new Date().toISOString(),
        vaultItemIds: [recoveryImport.importedIds[1]!],
        detail: {
          phase: 'queued',
          smokeTest: true,
          vaultItemIds: [recoveryImport.importedIds[1]!],
          queues: [staleQueue]
        }
      })
      recoveryDatabase.markRetrievalNeedsRecovery(
        staleOperationId,
        new Error('Simulated stale receipt.')
      )
      recoveryStatuses.set(staleQueue.operationId, { state: 'unknown', receiptPath: null })
      if (
        await reconcileLiveRecoveryOperations(recoveryHelper, recoveryDatabase, diagnostics) !== 0 ||
        recoveryDatabase.getRecoveryOperationCount() !== 1 ||
        recoveryDatabase.getVaultItems([recoveryImport.importedIds[1]!], true)[0]?.state !== 'retrieval_pending'
      ) {
        throw new Error('A stale or mismatched receipt did not remain fail-closed for audit.')
      }
      recoveryDatabase.failRetrievalOperation(
        staleOperationId,
        [recoveryImport.importedIds[1]!],
        new Error('Smoke cleanup after verified fail-closed stale receipt.')
      )
      if (recoveryDatabase.getDiagnosticSummary().quickCheck.some(
        (value) => value.toLocaleLowerCase() !== 'ok'
      )) {
        throw new Error('Recovery reconciliation damaged the archive database.')
      }
    } finally {
      recoveryDatabase?.close()
      await rm(recoverySmokeRoot, { recursive: true, force: true })
    }
    const recoveryOperationId = randomUUID()
    database.prepareRetrievalOperation({
      operationId: recoveryOperationId,
      stashPath: 'smoke-uncertain-outcome.gsh',
      sourceSha256: 'smoke-uncertain-outcome',
      startedAtUtc: new Date().toISOString(),
      vaultItemIds: [migration.importedIds[1]!],
      detail: { phase: 'prepared', smokeTest: true, scenario: 'helper_timeout' }
    })
    database.markRetrievalNeedsRecovery(recoveryOperationId, new Error('Simulated lost response.'))
    const databaseDiagnostics = database.getDiagnosticSummary()
    if (
      databaseDiagnostics.quickCheck.some((value) => value.toLocaleLowerCase() !== 'ok') ||
      database.getRecoveryOperationCount() !== 1 ||
      !databaseDiagnostics.recoveryOperations.some(
        (operation) => operation.id === recoveryOperationId && operation.state === 'needs_recovery'
      )
    ) {
      throw new Error('Uncertain transfer state was not retained for recovery diagnostics.')
    }
    console.log(
      JSON.stringify({
        helper: 'available',
        writeTransaction: 'verified',
        liveQueue: 'verified',
        migrationDedupe: 'verified',
        duplicateSelection: 'rejected',
        rejectedRetrievalRollback: 'verified',
        generatedDeliveryJournal: 'verified',
        uncertainOutcomeRecovery: 'verified',
        restartRecovery: 'verified',
        offlineReceiptRecovery: 'verified',
        staleReceipt: 'rejected',
        multiItemRecovery: 'verified',
        multiItemLiveIngest: 'verified',
        databaseIntegrity: 'verified',
        archiveBackupRestore: 'verified',
        archiveRollCache: 'verified',
        debugLoggingSetting: 'verified',
        serializerRoundTrips: roundTrips.length,
        ingestPlans: ingestPlans.length,
        retrievalRoundTrips: retrievalRoundTrips.length,
        retrievalJournal: 'verified',
        vaultListing: 'verified',
        vaultPaging: 'verified',
        analyzedCopies: analyzedCopies.length,
        trustedRolls: trustedRolls.length,
        withheldRolls: analyzedCopies.length - trustedRolls.length,
        pinnedBest: 'verified',
        installations: discovery.installations.length,
        saveLocations: discovery.saveLocations.length,
        transferStashes: stashCount,
        catalogItems: snapshot.items.length,
        collected,
        retainedDiscoveries
      })
    )
    helper.dispose()
    database.close()
    app.exit(0)
  } catch (error) {
    console.error(error)
    helper.dispose()
    database.close()
    app.exit(1)
  }
}

async function runIngestCommand(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  command: IngestCommand
): Promise<void> {
  try {
    const snapshot = await helper.request<CollectionSnapshot>('scan-collection')
    database.persistSnapshot(snapshot)
    console.log(JSON.stringify(await executeIngestCommand(helper, database, command)))
    helper.dispose()
    database.close()
    app.exit(0)
  } catch (error) {
    console.error(error)
    helper.dispose()
    database.close()
    app.exit(1)
  }
}

async function executeIngestCommand(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  command: IngestCommand
): Promise<IngestResult> {
  const operationId = randomUUID()
  let prepared = false
  try {
    const safety = await helper.request<WriteSafetyStatus>('inspect-write-safety')
    if (!safety.permitted) {
      throw new Error('Write safety gate refused permission: ' + safety.reasons.join(' '))
    }

    const selectors = command.items.map(({ tabIndex, itemIndex }) => ({ tabIndex, itemIndex }))
    const plan = await helper.request<IngestPlan>('plan-ingest-items', {
      path: command.path,
      items: selectors
    })
    if (
      plan.sourceSha256.toLowerCase() !== command.expectedSourceSha256.toLowerCase() ||
      !plan.semanticallyValid ||
      !plan.idempotent ||
      plan.replacementItemCount !== plan.sourceItemCount - command.items.length
    ) {
      throw new Error('Ingest plan no longer matches the approved source and transformation.')
    }
    const actualSeeds = plan.items.map((item) => item.seed)
    const expectedSeeds = command.items.map((item) => item.expectedSeed)
    if (
      actualSeeds.length !== expectedSeeds.length ||
      actualSeeds.some((seed, index) => seed !== expectedSeeds[index])
    ) {
      throw new Error('The selected stash items no longer match the approved roll seeds.')
    }

    const vaultItems = plan.items.map((item) => ({
      vaultItemId: randomUUID(),
      baseRecord: item.baseRecord,
      payload: item
    }))
    database.prepareIngestOperation({
      operationId,
      stashPath: plan.path,
      sourceSha256: plan.sourceSha256,
      startedAtUtc: new Date().toISOString(),
      items: vaultItems,
      detail: {
        phase: 'prepared',
        replacementSha256: plan.replacementSha256,
        sourceItemCount: plan.sourceItemCount,
        replacementItemCount: plan.replacementItemCount,
        vaultItemIds: vaultItems.map((item) => item.vaultItemId)
      }
    })
    prepared = true

    const committed = await helper.request<CommittedIngest>('commit-ingest-items', {
      operationId,
      path: plan.path,
      expectedSourceSha256: plan.sourceSha256,
      items: selectors,
      backupDirectory: join(app.getPath('userData'), 'backups')
    })
    if (
      committed.transaction.sourceSha256.toLowerCase() !== plan.sourceSha256.toLowerCase() ||
      committed.transaction.committedSha256.toLowerCase() !== plan.replacementSha256.toLowerCase()
    ) {
      throw new Error('Committed ingest hashes do not match the persisted plan.')
    }

    const completedAtUtc = new Date().toISOString()
    const vaultItemIds = database.completeIngestOperation({
      operationId,
      backupPath: committed.transaction.backupPath,
      completedAtUtc,
      isHardcore: isHardcoreStashPath(plan.path),
      detail: {
        phase: 'committed',
        replacementSha256: committed.transaction.committedSha256,
        rollbackPath: committed.transaction.rollbackPath,
        vaultItemIds: vaultItems.map((item) => item.vaultItemId)
      }
    })
    const verified = await helper.request<{
      sha256: string
      itemCount: number
      tabs: Array<{ items: unknown[] }>
    }>('scan-transfer-stash', { path: plan.path })
    if (
      verified.sha256.toLowerCase() !== committed.transaction.committedSha256.toLowerCase() ||
      verified.itemCount !== plan.replacementItemCount
    ) {
      throw new Error('Post-commit stash verification did not match the committed ingest.')
    }

    return {
      operationId,
      status: 'committed',
      ingested: plan.items.map((item, index) => ({
        vaultItemId: vaultItemIds[index]!,
        baseRecord: item.baseRecord,
        seed: item.seed
      })),
      sourceItems: plan.sourceItemCount,
      remainingItems: verified.itemCount,
      lastTabItems: verified.tabs.at(-1)?.items.length ?? 0,
      sourceSha256: plan.sourceSha256,
      committedSha256: committed.transaction.committedSha256,
      backupPath: committed.transaction.backupPath,
      rollbackPath: committed.transaction.rollbackPath
    }
  } catch (error) {
    if (prepared) {
      database.failIngestOperation(operationId, error)
    }
    throw error
  }
}

async function runRetrievalPlanCommand(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  command: RetrievalPlanCommand
): Promise<void> {
  try {
    const vaultItems = database.getVaultItems(
      command.vaultItemIds,
      isHardcoreStashPath(command.path)
    )
    const unavailable = vaultItems.filter((item) => item.state !== 'ingested')
    if (unavailable.length > 0) {
      throw new Error(
        'Vault items are not available for retrieval: ' + unavailable.map((item) => item.id).join(', ')
      )
    }
    const plan = await helper.request<RetrievalPlan>('plan-retrieve-items', {
      path: command.path,
      targetTabIndex: command.targetTabIndex,
      items: vaultItems.map((item) => item.payload)
    })
    if (
      !plan.restoredExactly ||
      !plan.semanticallyValid ||
      !plan.idempotent ||
      plan.replacementItemCount !== plan.sourceItemCount + vaultItems.length
    ) {
      throw new Error('Retrieval plan failed its item and serializer invariants.')
    }

    console.log(
      JSON.stringify({
        status: 'planned',
        vaultItemIds: command.vaultItemIds,
        ...plan
      })
    )
    helper.dispose()
    database.close()
    app.exit(0)
  } catch (error) {
    console.error(error)
    helper.dispose()
    database.close()
    app.exit(1)
  }
}

async function runRetrievalCommand(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  command: RetrievalCommand
): Promise<void> {
  try {
    console.log(JSON.stringify(await executeRetrievalCommand(helper, database, command)))
    helper.dispose()
    database.close()
    app.exit(0)
  } catch (error) {
    console.error(error)
    helper.dispose()
    database.close()
    app.exit(1)
  }
}

async function executeRetrievalCommand(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  command: RetrievalCommand
): Promise<RetrievalResult> {
  const operationId = randomUUID()
  let prepared = false
  let commitAttempted = false
  try {
    const safety = await helper.request<WriteSafetyStatus>('inspect-write-safety')
    if (!safety.permitted) {
      throw new Error('Write safety gate refused permission: ' + safety.reasons.join(' '))
    }

    const vaultItems = database.getVaultItems(
      command.vaultItemIds,
      isHardcoreStashPath(command.path)
    )
    const unavailable = vaultItems.filter((item) => item.state !== 'ingested')
    if (unavailable.length > 0) {
      throw new Error(
        'Vault items are not available for retrieval: ' + unavailable.map((item) => item.id).join(', ')
      )
    }
    const payloads = vaultItems.map((item) => item.payload)
    const plan = await helper.request<RetrievalPlan>('plan-retrieve-items', {
      path: command.path,
      targetTabIndex: command.targetTabIndex,
      items: payloads
    })
    if (
      plan.sourceSha256.toLowerCase() !== command.expectedSourceSha256.toLowerCase() ||
      !plan.restoredExactly ||
      !plan.semanticallyValid ||
      !plan.idempotent ||
      plan.replacementItemCount !== plan.sourceItemCount + vaultItems.length
    ) {
      throw new Error('Retrieval plan no longer matches the approved source and transformation.')
    }

    database.prepareRetrievalOperation({
      operationId,
      stashPath: plan.path,
      sourceSha256: plan.sourceSha256,
      startedAtUtc: new Date().toISOString(),
      vaultItemIds: command.vaultItemIds,
      detail: {
        phase: 'prepared',
        targetTabIndex: command.targetTabIndex,
        replacementSha256: plan.replacementSha256,
        sourceItemCount: plan.sourceItemCount,
        replacementItemCount: plan.replacementItemCount,
        vaultItemIds: command.vaultItemIds
      }
    })
    prepared = true

    commitAttempted = true
    const committed = await helper.request<CommittedRetrieval>('commit-retrieve-items', {
      operationId,
      path: plan.path,
      expectedSourceSha256: plan.sourceSha256,
      targetTabIndex: command.targetTabIndex,
      items: payloads,
      backupDirectory: join(app.getPath('userData'), 'backups')
    })
    if (
      committed.transaction.sourceSha256.toLowerCase() !== plan.sourceSha256.toLowerCase() ||
      committed.transaction.committedSha256.toLowerCase() !== plan.replacementSha256.toLowerCase()
    ) {
      throw new Error('Committed retrieval hashes do not match the persisted plan.')
    }

    const verified = await helper.request<{
      sha256: string
      itemCount: number
      tabs: Array<{ items: Array<{ baseRecord: string; seed: number }> }>
    }>('scan-transfer-stash', { path: plan.path })
    const targetItems = verified.tabs[command.targetTabIndex]?.items ?? []
    if (
      verified.sha256.toLowerCase() !== committed.transaction.committedSha256.toLowerCase() ||
      verified.itemCount !== plan.replacementItemCount ||
      targetItems.length !== plan.items.length ||
      !targetItems.every((item, index) => {
        const planned = plan.items[index]
        return planned !== undefined && item.baseRecord === planned.baseRecord && item.seed === planned.seed
      })
    ) {
      throw new Error('Post-commit stash verification did not match the committed retrieval.')
    }

    const completedAtUtc = new Date().toISOString()
    database.completeRetrievalOperation({
      operationId,
      backupPath: committed.transaction.backupPath,
      completedAtUtc,
      vaultItemIds: command.vaultItemIds,
      detail: {
        phase: 'committed',
        targetTabIndex: command.targetTabIndex,
        replacementSha256: committed.transaction.committedSha256,
        rollbackPath: committed.transaction.rollbackPath,
        vaultItemIds: command.vaultItemIds
      }
    })

    return {
      operationId,
      status: 'committed',
      retrieved: plan.items.map((item, index) => ({
        vaultItemId: command.vaultItemIds[index]!,
        baseRecord: item.baseRecord,
        seed: item.seed
      })),
      sourceItems: plan.sourceItemCount,
      remainingItems: verified.itemCount,
      targetTabItems: targetItems.length,
      sourceSha256: plan.sourceSha256,
      committedSha256: committed.transaction.committedSha256,
      backupPath: committed.transaction.backupPath,
      rollbackPath: committed.transaction.rollbackPath
    }
  } catch (error) {
    if (prepared) {
      if (commitAttempted) {
        database.markRetrievalNeedsRecovery(operationId, error)
      } else {
        database.failRetrievalOperation(operationId, command.vaultItemIds, error)
      }
    }
    throw error
  }
}

async function inspectStagingTab(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  path: string
): Promise<StagingTabInspection> {
  const scan = await helper.request<TransferStashScan>('scan-transfer-stash', { path })
  const lastTab = scan.tabs.at(-1)
  if (!lastTab) throw new Error('The selected transfer stash has no tabs.')
  const names = database.getCatalogNames(lastTab.items.map((item) => item.baseRecord))
  return {
    path: scan.path,
    sha256: scan.sha256,
    tabIndex: lastTab.index,
    tabCount: scan.tabs.length,
    itemCount: lastTab.items.length,
    totalItemCount: scan.itemCount,
    items: lastTab.items.map((item) => ({
      tabIndex: item.tabIndex,
      itemIndex: item.itemIndex,
      baseRecord: item.baseRecord,
      name: names.get(item.baseRecord.toLowerCase()) ?? item.baseRecord,
      seed: item.seed,
      supported: names.has(item.baseRecord.toLowerCase())
    }))
  }
}

async function executeStagingTabIngest(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  path: string
): Promise<IngestResult> {
  const staging = await inspectStagingTab(helper, database, path)
  if (staging.items.length === 0) {
    throw new Error('The final stash tab is empty; there is nothing staged for ingest.')
  }
  const unsupported = staging.items.filter((item) => !item.supported)
  if (unsupported.length > 0) {
    throw new Error(
      'The staging tab contains items that CC cannot archive: ' +
        unsupported.map((item) => item.name).join(', ')
    )
  }
  return executeIngestCommand(helper, database, {
    path: staging.path,
    expectedSourceSha256: staging.sha256,
    items: staging.items.map((item) => ({
      tabIndex: item.tabIndex,
      itemIndex: item.itemIndex,
      expectedSeed: item.seed
    }))
  })
}

async function executeLastTabRetrieval(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  path: string,
  vaultItemIds: string[]
): Promise<RetrievalResult> {
  if (vaultItemIds.length === 0) throw new Error('Select at least one vault item to retrieve.')
  const staging = await inspectStagingTab(helper, database, path)
  if (staging.itemCount !== 0) {
    throw new Error('The final stash tab must be empty before retrieving an item.')
  }
  return executeRetrievalCommand(helper, database, {
    path: staging.path,
    expectedSourceSha256: staging.sha256,
    targetTabIndex: staging.tabIndex,
    vaultItemIds
  })
}

async function readWindowState(): Promise<PersistedWindowState | null> {
  try {
    const parsed = JSON.parse(
      await readFile(join(app.getPath('userData'), 'window-state.json'), 'utf8')
    ) as Partial<PersistedWindowState>
    if (
      !Number.isFinite(parsed.x) ||
      !Number.isFinite(parsed.y) ||
      !Number.isFinite(parsed.width) ||
      !Number.isFinite(parsed.height)
    ) return null
    return {
      x: parsed.x!,
      y: parsed.y!,
      width: Math.max(960, parsed.width!),
      height: Math.max(640, parsed.height!),
      maximized: parsed.maximized === true
    }
  } catch {
    return null
  }
}

function visibleWindowBounds(state: PersistedWindowState | null): Electron.Rectangle | null {
  if (!state) return null
  const requested = { x: state.x, y: state.y, width: state.width, height: state.height }
  const display = screen.getAllDisplays().find(({ workArea }) =>
    requested.x < workArea.x + workArea.width &&
    requested.x + requested.width > workArea.x &&
    requested.y < workArea.y + workArea.height &&
    requested.y + requested.height > workArea.y
  )
  if (!display) return null
  const width = Math.min(requested.width, display.workArea.width)
  const height = Math.min(requested.height, display.workArea.height)
  return {
    x: Math.min(Math.max(requested.x, display.workArea.x), display.workArea.x + display.workArea.width - width),
    y: Math.min(Math.max(requested.y, display.workArea.y), display.workArea.y + display.workArea.height - height),
    width,
    height
  }
}

function rememberWindowState(window: BrowserWindow): void {
  if (process.env.CAIRN_CODEX_SCREENSHOT_PATH) return
  const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds()
  void writeFile(
    join(app.getPath('userData'), 'window-state.json'),
    JSON.stringify({ ...bounds, maximized: window.isMaximized() } satisfies PersistedWindowState)
  ).catch((error) => console.warn('Could not persist window placement.', error))
}

async function createWindow(recoveryStatus: StartupRecoveryStatus): Promise<void> {
  const screenshotPath = process.env.CAIRN_CODEX_SCREENSHOT_PATH
  const savedState = screenshotPath ? null : await readWindowState()
  const savedBounds = visibleWindowBounds(savedState)
  const window = new BrowserWindow({
    width: savedBounds?.width ?? 1280,
    height: savedBounds?.height ?? 800,
    ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: screenshotPath ? 480 : 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#10100f',
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.ico')
      : join(app.getAppPath(), 'build', 'icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !screenshotPath
    }
  })
  window.setMenuBarVisibility(false)
  window.setAutoHideMenuBar(true)
  if (savedState?.maximized) window.maximize()

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleWindowStateSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => rememberWindowState(window), 250)
  }
  window.on('resize', scheduleWindowStateSave)
  window.on('move', scheduleWindowStateSave)
  window.on('maximize', scheduleWindowStateSave)
  window.on('unmaximize', scheduleWindowStateSave)
  window.on('close', () => rememberWindowState(window))

  const revealWindow = (): void => {
    if (screenshotPath || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
  window.once('ready-to-show', revealWindow)
  window.webContents.once('did-finish-load', revealWindow)
  if (!screenshotPath) setTimeout(revealWindow, 1500)

  const recoveryQuery = {
    safeMode: recoveryStatus.active ? '1' : '0',
    safeModeSuggested: process.env.CAIRN_CODEX_SCREENSHOT_SAFE_MODE_SUGGESTED === '1'
      ? '1'
      : recoveryStatus.suggested ? '1' : '0',
    failedStarts: process.env.CAIRN_CODEX_SCREENSHOT_FAILED_STARTS ?? String(recoveryStatus.failedStarts),
    simulateWorkspaceError: process.env.CAIRN_CODEX_SCREENSHOT_RENDER_ERROR === '1' ? '1' : '0'
  }
  const screenshotRouteHash = process.env.CAIRN_CODEX_SCREENSHOT_ROUTE_HASH?.replace(/^#/, '')
  if (process.env.ELECTRON_RENDERER_URL) {
    const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL)
    for (const [key, value] of Object.entries(recoveryQuery)) rendererUrl.searchParams.set(key, value)
    if (screenshotRouteHash) rendererUrl.hash = screenshotRouteHash
    void window.loadURL(rendererUrl.toString())
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), {
      query: recoveryQuery,
      ...(screenshotRouteHash ? { hash: screenshotRouteHash } : {})
    })
  }
  window.webContents.on('did-fail-load', (_event, code, description) => {
    console.error('[window] renderer load failed', { code, description })
  })

  if (screenshotPath) {
    window.webContents.once('did-finish-load', () => {
      void captureWindowWhenReady(window, screenshotPath)
    })
  }
}

async function captureWindowWhenReady(window: BrowserWindow, path: string): Promise<void> {
  const captureStartedAt = Date.now()
  const interactionTimings: Record<string, number> = {}
  let expectedRouteControls: Record<string, unknown> = {}
  try {
    const routeParameters = new URLSearchParams(
      (process.env.CAIRN_CODEX_SCREENSHOT_ROUTE_HASH ?? '').replace(/^#/, '')
    )
    const controls = routeParameters.get('controls')
    if (controls) expectedRouteControls = JSON.parse(controls) as Record<string, unknown>
  } catch {
    expectedRouteControls = {}
  }
  try {
    const requestedWidth = Number.parseInt(
      process.env.CAIRN_CODEX_SCREENSHOT_WIDTH ?? '',
      10
    )
    const requestedHeight = Number.parseInt(
      process.env.CAIRN_CODEX_SCREENSHOT_HEIGHT ?? '',
      10
    )
    const screenshotWidth = Number.isFinite(requestedWidth)
      ? Math.min(Math.max(requestedWidth, 480), 1920)
      : 1440
    const screenshotHeight = Number.isFinite(requestedHeight)
      ? Math.min(Math.max(requestedHeight, 720), 2400)
      : 1000
    window.setContentSize(screenshotWidth, screenshotHeight)
    const [actualContentWidth, actualContentHeight] = window.getContentSize()
    if (actualContentWidth !== screenshotWidth || actualContentHeight !== screenshotHeight) {
      throw new Error(
        `Screenshot viewport mismatch: requested ${screenshotWidth}x${screenshotHeight}, ` +
        `received ${actualContentWidth}x${actualContentHeight}.`
      )
    }
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const scanError = await window.webContents.executeJavaScript(
        "document.querySelector('.scan-error')?.textContent"
      )
      if (scanError) throw new Error('Renderer collection scan failed: ' + scanError)
      const ready = await window.webContents.executeJavaScript(
        `(Boolean(document.querySelector('.workspace-error, .root-recovery, .safe-mode-offer')) ||
          Boolean(document.querySelector('.catalog-grid, .catalog-results, .set-grid, .workspace-sidebar, .settings-workspace, .vault-workspace'))) &&
         (!document.querySelector('.primary-action')?.disabled ||
          Boolean(document.querySelector('.workspace-error, .root-recovery, .safe-mode-offer')) ||
          Boolean(document.querySelector('.background-scan'))) &&
         (${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_WAIT_FOR_SCAN === '1')}
           ? !document.querySelector('.background-scan')
           : true)`
      )
      if (ready) {
        window.webContents.setZoomFactor(1)
        await new Promise((resolve) => setTimeout(resolve, 50))
        const onboardingStep = Number.parseInt(
          process.env.CAIRN_CODEX_SCREENSHOT_ONBOARDING_STEP ?? '0',
          10
        )
        if (
          process.env.CAIRN_CODEX_SCREENSHOT_ONBOARDING_STEP !== undefined ||
          process.env.CAIRN_CODEX_SCREENSHOT_DISMISS_ONBOARDING === '1'
        ) {
          for (let attempt = 0; attempt < 40; attempt += 1) {
            const mounted = await window.webContents.executeJavaScript(
              "Boolean(document.querySelector('.onboarding-dialog'))"
            )
            if (mounted) break
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
        }
        for (let step = 0; step < onboardingStep; step += 1) {
          const advanced = await window.webContents.executeJavaScript(`
            (() => {
              const button = [...document.querySelectorAll('.onboarding-footer button')]
                .find((candidate) => ['Continue', 'Continue without importing'].includes(candidate.textContent?.trim() ?? ''))
              button?.click()
              return Boolean(button)
            })()
          `)
          if (!advanced) throw new Error(`Onboarding could not advance from step ${step}.`)
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_ONBOARDING_STEP !== undefined) {
          const renderedOnboardingStep = await window.webContents.executeJavaScript(
            "document.querySelector('.onboarding-dialog')?.getAttribute('data-onboarding-step')"
          )
          if (renderedOnboardingStep === null || Number(renderedOnboardingStep) !== onboardingStep) {
            throw new Error(
              `Onboarding screenshot requested step ${onboardingStep}, rendered ${renderedOnboardingStep ?? 'none'}.`
            )
          }
          if (
            onboardingStep === 1 &&
            process.env.CAIRN_CODEX_SCREENSHOT_FIXTURE === 'onboarding'
          ) {
            let retainedCopyText = ''
            for (let attempt = 0; attempt < 40; attempt += 1) {
              retainedCopyText = await window.webContents.executeJavaScript(
                "document.querySelector('.retained-count')?.textContent?.trim() ?? ''"
              )
              if (retainedCopyText) break
              await new Promise((resolve) => setTimeout(resolve, 50))
            }
            if (retainedCopyText !== '128 archived copies') {
              throw new Error(`Onboarding retained-copy evidence was not rendered; received ${retainedCopyText || 'none'}.`)
            }
          }
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_DISMISS_ONBOARDING === '1') {
          await window.webContents.executeJavaScript(`
            [...document.querySelectorAll('.onboarding-footer button')]
              .find((button) => button.textContent?.trim() === 'Recovery & diagnostics')
              ?.click()
          `)
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_HYDRATE_ALL_MODES === '1') {
          interactionTimings.allModeHydrationMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const cached = await window.cairnCodex.getCachedCollection([], 'archive')
              const sourcePaths = (cached?.availableStashes ?? cached?.scannedStashes ?? [])
                .map((stash) => stash.path)
              let pending = 1
              while (pending > 0) {
                const result = await window.cairnCodex.hydrateArchiveRolls(sourcePaths)
                if (!result) throw new Error('Archive hydration returned no result.')
                pending = result.pending
                if (result.processed === 0 && pending > 0) {
                  throw new Error('Archive hydration made no progress.')
                }
                if (pending > 0) await new Promise((resolve) => setTimeout(resolve, 0))
              }
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_ENABLE_ALL_TOOLS === '1') {
          const enabledAllTools = await window.webContents.executeJavaScript(`
            (async () => {
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const button = (selector, label) => [...document.querySelectorAll(selector)]
                .find((candidate) => candidate.textContent?.trim() === label)
              button('.system-nav button', 'Settings')?.click()
              await frames()
              const experimental = document.querySelector('.experimental-tools-toggle input')
              if (experimental instanceof HTMLInputElement && !experimental.checked) experimental.click()
              await frames()
              button('.workspace-tool-presets button', 'Show all')?.click()
              await frames()
              const collection = button('.system-nav button', 'Collection')
              collection?.click()
              await frames()
              return Boolean(collection)
            })()
          `)
          if (!enabledAllTools) throw new Error('Could not enable all tools in the isolated screenshot profile.')
        }
        const category = process.env.CAIRN_CODEX_SCREENSHOT_CATEGORY
        if (category) {
          const categoryResult = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              await new Promise((resolve) => setTimeout(resolve, 100))
              document.querySelector('.onboarding-skip')?.click()
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const destination = [...document.querySelectorAll('.workspace-shortcuts button, .workspace-sidebar [data-tool-id], .category-tabs button, .system-nav button')]
                .find((button) =>
                  (button.querySelector('.workspace-nav-label')?.textContent ?? button.querySelector('span')?.textContent ?? button.textContent)?.trim() === ${JSON.stringify(category)})
              destination?.click()
              await new Promise((resolve) => setTimeout(resolve, 100))
              return { elapsedMs: performance.now() - started, opened: Boolean(destination) }
            })()
          `)
          if (!categoryResult.opened) throw new Error(`Screenshot category was not available: ${category}.`)
          interactionTimings.categoryMs = categoryResult.elapsedMs
        }
        const plannerDisplay = process.env.CAIRN_CODEX_SCREENSHOT_PLANNER_DISPLAY
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_WORKSPACE_SIDEBAR === '1') {
          interactionTimings.workspaceSidebarMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              await frames()
              const sidebar = document.querySelector('.workspace-sidebar')
              const home = sidebar?.querySelector('[data-tool-id="collection"]')
              const active = sidebar?.querySelector('.workspace-nav-tools [aria-current="page"]')
              const customize = sidebar?.querySelector('[aria-label="Customize visible tools"]')
              const toggle = sidebar?.querySelector('.workspace-sidebar-toggle')
              if (!sidebar || !home || !active || !customize || !toggle) {
                throw new Error('The workspace sidebar did not render all required controls.')
              }
              const sidebarRect = sidebar.getBoundingClientRect()
              const activeRect = active.getBoundingClientRect()
              const navItems = [...sidebar.querySelectorAll('.workspace-nav-item')]
                .filter((item) => item.getClientRects().length > 0)
              const activeIconRect = active.querySelector('.workspace-nav-svg')?.getBoundingClientRect()
              const visibleControls = [home, active, customize, toggle]
                .filter((control) => control.getClientRects().length > 0)
              for (const control of visibleControls) {
                control.focus()
                if (document.activeElement !== control) throw new Error('A workspace sidebar control could not receive keyboard focus.')
              }
              if (
                Math.abs(sidebarRect.left) > 1 || sidebarRect.right > window.innerWidth ||
                activeRect.left < sidebarRect.left - 1 || activeRect.right > sidebarRect.right + 1 ||
                document.documentElement.scrollWidth > window.innerWidth + 1
              ) {
                throw new Error('The workspace sidebar is clipped or causing page-level overflow.')
              }
              if (
                navItems.some((item) => !item.querySelector('.workspace-nav-svg')) ||
                !activeIconRect || activeIconRect.width < 20 || activeIconRect.height < 20
              ) {
                throw new Error('The workspace sidebar did not render its complete legible icon set.')
              }
              const activeLabel = active.querySelector('.workspace-nav-label')?.textContent?.trim()
              if (toggle.getClientRects().length > 0) {
                const beganCollapsed = sidebar.classList.contains('collapsed')
                if (!beganCollapsed) {
                  toggle.click()
                  await frames()
                }
                if (!sidebar.classList.contains('collapsed')) throw new Error('The workspace sidebar did not enter compact mode.')
                active.blur()
                await frames()
                active.focus()
                active.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
                await frames()
                const tooltip = document.querySelector('.workspace-nav-tooltip')
                const tooltipRect = tooltip?.getBoundingClientRect()
                if (
                  !(tooltip instanceof HTMLElement) || tooltip.textContent?.trim() !== activeLabel ||
                  !tooltipRect || tooltipRect.left < sidebar.getBoundingClientRect().right - 1
                ) {
                  throw new Error('Compact workspace navigation did not expose its focused destination label.')
                }
                active.blur()
                await frames()
                toggle.click()
                await frames()
                if (sidebar.classList.contains('collapsed')) throw new Error('The workspace sidebar did not leave compact mode.')
                if (beganCollapsed) {
                  toggle.click()
                  await frames()
                }
              }
              customize.click()
              await frames()
              const activeSetting = [...document.querySelectorAll('.tool-settings-options label')]
                .find((label) => label.querySelector('strong')?.textContent?.trim().startsWith(activeLabel))
                ?.querySelector('input')
              if (!(activeSetting instanceof HTMLInputElement) || !activeSetting.checked) {
                throw new Error('The active specialist was not represented in tool customization.')
              }
              activeSetting.click()
              await frames()
              if (!document.querySelector('.hero') || !document.querySelector('.workspace-sidebar')) {
                throw new Error('Hiding the active specialist did not return to the Collection dashboard.')
              }
              activeSetting.click()
              document.querySelector('.tool-settings-done')?.click()
              await frames()
              const restoredDestination = [...document.querySelectorAll('.workspace-shortcuts button')]
                .find((button) => button.querySelector('span')?.textContent?.trim() === activeLabel)
              restoredDestination?.click()
              await frames()
              if (document.querySelector('.workspace-sidebar .workspace-nav-tools [aria-current="page"] .workspace-nav-label')?.textContent?.trim() !== activeLabel) {
                throw new Error('The restored specialist did not reopen in the focused shell.')
              }
              return performance.now() - started
            })()
          `)
        }
        if (plannerDisplay) {
          const plannerDisplayLabel = ({ table: 'List', cards: 'Grid', map: 'MI sources' } as Record<string, string>)[plannerDisplay] ?? ''
          await window.webContents.executeJavaScript(`
            (async () => {
              const label = ${JSON.stringify(plannerDisplayLabel)}
              ;[...document.querySelectorAll('.planner-display button')]
                .find((button) => button.textContent?.trim() === label)
                ?.click()
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            })()
          `)
        }
        const transferSection = process.env.CAIRN_CODEX_SCREENSHOT_TRANSFER_SECTION
        if (transferSection) {
          await window.webContents.executeJavaScript(`
            (async () => {
              ;[...document.querySelectorAll('.transfer-section-tabs button')]
                .find((button) => button.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(transferSection)})
                ?.click()
              await new Promise((resolve) => setTimeout(resolve, 250))
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_TRANSFERS_WORKSPACE === '1') {
          interactionTimings.transfersWorkspaceMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const workspace = document.querySelector('.vault-workspace')
              if (!workspace || document.querySelector('.workspace-sidebar')) {
                throw new Error('Transfers must render as a focused system workspace without the workspace sidebar.')
              }
              const sectionButtons = [...workspace.querySelectorAll('.transfer-section-tabs button')]
              if (sectionButtons.length !== 3) throw new Error('Transfers did not retain its three section controls.')
              const activeSection = () => workspace.querySelector('.transfer-section-tabs button.active strong')?.textContent?.trim()
              if (activeSection() !== 'Dispense history') throw new Error('Transfers section model did not accept the requested history route.')
              const historyInput = workspace.querySelector('.vault-explorer-toolbar input')
              if (!(historyInput instanceof HTMLInputElement) || historyInput.value !== 'failed') {
                throw new Error('Transfers history query model did not restore its typed route value.')
              }
              const outcome = workspace.querySelector('.vault-explorer-toolbar select')
              if (!(outcome instanceof HTMLSelectElement)) throw new Error('Transfers outcome control was not rendered.')
              outcome.value = 'failed'
              outcome.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              if (outcome.value !== 'failed') throw new Error('Transfers history outcome model did not update.')

              const quarantine = sectionButtons.find((button) => button.textContent?.includes('Quarantined items'))
              if (!(quarantine instanceof HTMLButtonElement)) throw new Error('Transfers quarantine control was not rendered.')
              quarantine.click()
              await frames()
              if (!workspace.querySelector('.quarantine-workspace') || workspace.querySelector('.operation-history')) {
                throw new Error('Transfers section switch did not replace history with quarantine.')
              }
              const modeButtons = [...workspace.querySelectorAll('.transfer-mode-tabs button')]
              if (modeButtons.length !== 2) throw new Error('Transfers quarantine did not retain both return modes.')
              modeButtons[1].click()
              await frames()
              if (!workspace.querySelector('.vault-target') || !modeButtons[1].classList.contains('active')) {
                throw new Error('Transfers offline return-mode model did not update its presentation.')
              }
              const returnButton = workspace.querySelector('.quarantine-actions button')
              if (!(returnButton instanceof HTMLButtonElement) || !returnButton.disabled) {
                throw new Error('Empty quarantine unexpectedly enabled a destructive return action.')
              }

              const dispense = sectionButtons.find((button) => button.textContent?.includes('Dispense history'))
              dispense?.click()
              await frames()
              if (activeSection() !== 'Dispense history' || historyInput.value !== 'failed') {
                throw new Error('Transfers session did not preserve history controls across section remounts.')
              }
              const controls = window.history.state?.route?.controls
              if (
                window.history.state?.route?.workspace !== 'vault' ||
                controls?.section !== 'dispense-history' ||
                controls?.historyQuery !== 'failed' ||
                controls?.historyOutcome !== 'failed' ||
                controls?.mode !== 'offline'
              ) {
                throw new Error('Transfers session changes were not reflected in typed route state.')
              }
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_COLLAPSE_TRACKERS === '1') {
          await window.webContents.executeJavaScript(`
            (() => {
              const toggle = document.querySelector('.completion-tracker > header button')
              if (toggle?.getAttribute('aria-expanded') === 'true') toggle.click()
            })()
          `)
        } else if (process.env.CAIRN_CODEX_SCREENSHOT_EXPAND_TRACKERS === '1') {
          await window.webContents.executeJavaScript(`
            (() => {
              const toggle = document.querySelector('.completion-tracker > header button')
              if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click()
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_PLANNER_ACTIONS === '1') {
          interactionTimings.plannerActionsMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const resultCount = () => Number((document.querySelector('.planner-explorer-toolbar .explorer-result-count')?.textContent ?? '').replace(/[^0-9]/g, ''))
              const firstResult = () => document.querySelector('.planner-results .bounded-results-item')
              const first = firstResult()
              const buttons = first?.querySelectorAll('.planner-item-actions button, .planner-card-actions button')
              const favorite = buttons?.[0]
              const ignore = buttons?.[1]
              if (!(favorite instanceof HTMLButtonElement) || !(ignore instanceof HTMLButtonElement)) {
                throw new Error('Planner action verification could not find favorite and ignore controls.')
              }
              favorite.click()
              await frames()
              if (!favorite.classList.contains('active') || document.querySelector('.item-drawer')) {
                throw new Error('Planner favorite did not toggle independently of item activation.')
              }
              favorite.click()
              await frames()
              if (favorite.classList.contains('active')) throw new Error('Planner favorite did not toggle off.')
              ignore.click()
              await frames()
              if (resultCount() !== 119 || document.querySelector('.item-drawer')) {
                throw new Error('Planner ignore did not remove exactly one result without opening the item.')
              }
              const listFilter = document.querySelectorAll('.planner-explorer-toolbar .explorer-toolbar-filters select')[1]
              if (!(listFilter instanceof HTMLSelectElement)) throw new Error('Planner ignored-list filter was not available.')
              listFilter.value = 'true'
              listFilter.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              if (resultCount() !== 1) throw new Error('Planner ignored-list filter did not reveal the ignored base.')
              const restore = firstResult()?.querySelectorAll('.planner-item-actions button, .planner-card-actions button')[1]
              if (!(restore instanceof HTMLButtonElement) || restore.textContent?.trim() !== 'Restore') {
                throw new Error('Planner ignored result did not expose Restore.')
              }
              restore.click()
              await frames()
              if (resultCount() !== 0) throw new Error('Planner Restore did not remove the base from the ignored list.')
              listFilter.value = 'false'
              listFilter.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              if (resultCount() !== 120) throw new Error('Planner shopping list did not recover after restoring the base.')
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_PLANNER_SCROLLING === '1') {
          interactionTimings.plannerScrollingMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              const waitFor = async (predicate, failure) => {
                for (let attempt = 0; attempt < 80; attempt += 1) {
                  if (predicate()) return
                  await wait(25)
                }
                throw new Error(failure)
              }
              const buttons = [...document.querySelectorAll('.planner-display button')]
              const list = buttons.find((button) => button.textContent?.trim() === 'List')
              const grid = buttons.find((button) => button.textContent?.trim() === 'Grid')
              if (!(list instanceof HTMLButtonElement) || !(grid instanceof HTMLButtonElement)) {
                throw new Error('Planner scrolling verification could not find List and Grid views.')
              }
              if (!list.classList.contains('active')) list.click()
              await frames()
              const surface = document.querySelector('.planner-table-wrap')
              if (!(surface instanceof HTMLElement)) throw new Error('Planner list surface was not rendered.')
              if (getComputedStyle(surface).maxHeight !== 'none' || surface.clientHeight <= innerHeight) {
                throw new Error('Planner list still creates a bottom-bounded vertical viewport.')
              }
              const initialRows = [...surface.querySelectorAll('.bounded-results-item')]
              if (initialRows.length !== 50) throw new Error('Planner continuous window started with ' + initialRows.length + ' mounted rows instead of 50.')
              initialRows[0]?.focus()
              initialRows[0]?.dispatchEvent(new FocusEvent('focus'))
              await waitFor(() => document.querySelector('.game-tooltip'), 'Focused planner row did not open its tooltip.')
              if (document.activeElement !== initialRows[0]) throw new Error('The initial planner row did not receive DOM focus.')
              const tooltip = document.querySelector('.game-tooltip')
              if (!(tooltip instanceof HTMLElement)) throw new Error('Planner tooltip was not rendered.')
              const tooltipInlineStyle = tooltip.style.cssText
              const tooltipScrollTop = tooltip.scrollTop
              const tooltipScrollProbe = document.createElement('div')
              tooltipScrollProbe.setAttribute('aria-hidden', 'true')
              tooltipScrollProbe.style.cssText = 'height:480px;min-height:480px;flex:0 0 480px'
              tooltip.appendChild(tooltipScrollProbe)
              tooltip.style.height = '120px'
              tooltip.style.maxHeight = '120px'
              tooltip.style.overflowY = 'auto'
              await frames()
              if (tooltip.scrollHeight <= tooltip.clientHeight) {
                throw new Error('Planner tooltip scroll verification could not create deterministic overflow.')
              }
              tooltip.scrollTop = 0
              const wheel = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
              tooltip.dispatchEvent(wheel)
              if (wheel.defaultPrevented || tooltip.scrollTop !== 0) {
                throw new Error('A visible planner tooltip still captures ordinary mouse-wheel input.')
              }
              const altWheel = new WheelEvent('wheel', { deltaY: 120, altKey: true, bubbles: true, cancelable: true })
              tooltip.dispatchEvent(altWheel)
              if (!altWheel.defaultPrevented || tooltip.scrollTop <= 0) {
                throw new Error('Alt + mouse wheel did not scroll the overflowing planner tooltip.')
              }
              tooltipScrollProbe.remove()
              tooltip.style.cssText = tooltipInlineStyle
              tooltip.scrollTop = tooltipScrollTop

              const firstText = initialRows[0]?.textContent?.replace(/\\s+/g, ' ').trim()
              const firstBottom = surface.querySelector('.bounded-results-continuation.is-next')
              if (!(firstBottom instanceof HTMLElement)) throw new Error('Planner continuous-scroll sentinel was not rendered.')
              firstBottom.scrollIntoView({ block: 'end' })
              await waitFor(
                () => surface.querySelectorAll('.bounded-results-item').length > 50,
                'Scrolling to the planner boundary did not append the second bounded page.'
              )
              await frames(); await frames()
              let rows = [...surface.querySelectorAll('.bounded-results-item')]
              if (rows.length > 100 || document.activeElement !== initialRows[0]) {
                throw new Error('The second planner window exceeded its DOM bound or lost focus prematurely.')
              }
              const secondBottom = surface.querySelector('.bounded-results-continuation.is-next')
              if (!(secondBottom instanceof HTMLElement)) throw new Error('Planner did not expose the next continuous boundary.')
              secondBottom.scrollIntoView({ block: 'end' })
              await waitFor(
                () => surface.querySelector('.bounded-results-item')?.textContent?.replace(/\\s+/g, ' ').trim() !== firstText,
                'Observer-driven planner scrolling did not advance its bounded two-page window.'
              )
              await frames(); await frames()
              rows = [...surface.querySelectorAll('.bounded-results-item')]
              const focusedAfterEviction = document.activeElement
              if (
                rows.length > 100 ||
                !(focusedAfterEviction instanceof HTMLElement) ||
                !focusedAfterEviction.classList.contains('bounded-results-item') ||
                focusedAfterEviction.textContent?.replace(/\\s+/g, ' ').trim() === firstText ||
                !surface.querySelector('.bounded-results-continuation.is-previous button')
              ) {
                throw new Error('Planner continuous scrolling did not advance its bounded two-page window.')
              }
              const listCount = surface.querySelectorAll('.bounded-results-item').length
              const focusedKey = focusedAfterEviction.dataset.resultKey
              const unobscuredTop = () => {
                const topbar = document.querySelector('.topbar')
                return topbar instanceof HTMLElement ? Math.max(0, topbar.getBoundingClientRect().bottom) : 0
              }
              // Chromium can place adjacent layout edges a fractional pixel apart at some
              // display scales. Treat a one-pixel overlap as the same visible boundary.
              const viewportTolerance = 1
              grid.click()
              await frames(); await frames()
              const gridCards = document.querySelectorAll('.planner-card-results .planner-card').length
              const gridFocus = document.activeElement
              const gridFocusRect = gridFocus instanceof HTMLElement ? gridFocus.getBoundingClientRect() : null
              if (
                gridCards !== listCount ||
                !grid.classList.contains('active') ||
                !(gridFocus instanceof HTMLElement) ||
                gridFocus.dataset.resultKey !== focusedKey ||
                !gridFocusRect ||
                gridFocusRect.top < unobscuredTop() - viewportTolerance ||
                gridFocusRect.top >= innerHeight + viewportTolerance
              ) {
                throw new Error('Planner Grid view did not preserve the focused visible result and continuous window: ' + JSON.stringify({
                  gridCards, listCount, active: grid.classList.contains('active'), focusedKey,
                  gridFocusKey: gridFocus instanceof HTMLElement ? gridFocus.dataset.resultKey : null,
                  top: gridFocusRect?.top, bottom: gridFocusRect?.bottom, unobscuredTop: unobscuredTop(), innerHeight
                }))
              }
              list.click()
              await frames(); await frames()
              const restoredFocus = document.activeElement
              const restoredFocusRect = restoredFocus instanceof HTMLElement ? restoredFocus.getBoundingClientRect() : null
              if (
                !document.querySelector('.planner-table-results') ||
                !list.classList.contains('active') ||
                !(restoredFocus instanceof HTMLElement) ||
                restoredFocus.dataset.resultKey !== focusedKey ||
                !restoredFocusRect ||
                restoredFocusRect.top < unobscuredTop() - viewportTolerance ||
                restoredFocusRect.top >= innerHeight + viewportTolerance
              ) {
                throw new Error('Planner List view did not restore the focused visible result and continuous window: ' + JSON.stringify({
                  focusedKey, restoredFocusKey: restoredFocus instanceof HTMLElement ? restoredFocus.dataset.resultKey : null,
                  top: restoredFocusRect?.top, bottom: restoredFocusRect?.bottom, unobscuredTop: unobscuredTop(), innerHeight
                }))
              }
              const trailingFocus = [...surface.querySelectorAll('.bounded-results-item')].at(-1)
              if (!(trailingFocus instanceof HTMLElement)) throw new Error('Planner trailing-page focus target was not rendered.')
              trailingFocus.focus()
              trailingFocus.dispatchEvent(new FocusEvent('focus'))
              const trailingKey = trailingFocus.dataset.resultKey
              if (document.activeElement !== trailingFocus) throw new Error('Planner trailing-page item did not receive focus.')
              const previousBoundary = surface.querySelector('.bounded-results-continuation.is-previous')
              if (!(previousBoundary instanceof HTMLElement)) throw new Error('Planner previous-window boundary was not rendered.')
              previousBoundary.scrollIntoView({ block: 'start' })
              await waitFor(
                () => surface.querySelector('.bounded-results-item')?.textContent?.replace(/\\s+/g, ' ').trim() === firstText,
                'Planner backward restoration did not recover the first result window.'
              )
              await frames(); await frames()
              const backwardFocus = document.activeElement
              if (
                surface.querySelectorAll('.bounded-results-item').length > 100 ||
                !(backwardFocus instanceof HTMLElement) ||
                !backwardFocus.classList.contains('bounded-results-item') ||
                backwardFocus.dataset.resultKey === trailingKey ||
                !surface.contains(backwardFocus)
              ) {
                throw new Error('Planner backward restoration exceeded its DOM bound or lost trailing-page focus.')
              }
              return performance.now() - started
            })()
          `)
        }
        const supplyCategory = process.env.CAIRN_CODEX_SCREENSHOT_SUPPLY_CATEGORY
        if (supplyCategory) {
          await window.webContents.executeJavaScript(`
            (async () => {
              const select = document.querySelector('.supplies-workspace .explorer-toolbar-filters select')
              if (!(select instanceof HTMLSelectElement)) throw new Error('Supply category control was not rendered.')
              select.value = ${JSON.stringify(supplyCategory)}
              select.dispatchEvent(new Event('change', { bubbles: true }))
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_BOUNDED_GRID_SEMANTICS === '1') {
          interactionTimings.boundedGridSemanticsMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const workspaceButton = (label) => [...document.querySelectorAll('.workspace-shortcuts button, .workspace-sidebar [data-tool-id]')]
                .find((button) => (button.querySelector('.workspace-nav-label')?.textContent ?? button.querySelector('span')?.textContent ?? button.textContent)?.trim() === label)
              const openWorkspace = async (label) => {
                const button = workspaceButton(label)
                if (!(button instanceof HTMLButtonElement)) throw new Error(label + ' workspace control was not available.')
                button.click()
                await frames()
              }
              const assertGrid = (selector, label, expectedCount) => {
                const root = document.querySelector(selector)
                const collection = root?.querySelector(':scope > .bounded-results-collection')
                if (!(root instanceof HTMLElement) || collection?.getAttribute('role') !== 'grid') {
                  throw new Error(label + ' did not expose a grid result collection.')
                }
                const rows = [...collection.children]
                if (rows.length !== expectedCount || rows.some((row) => row.getAttribute('role') !== 'row')) {
                  throw new Error(label + ' did not expose exactly ' + expectedCount + ' direct grid rows.')
                }
                const cells = rows.map((row) => row.querySelector(':scope > .bounded-results-item[role="gridcell"]'))
                if (cells.some((cell) => !(cell instanceof HTMLElement))) {
                  throw new Error(label + ' grid rows did not each own one direct gridcell.')
                }
                if (cells[0]?.tabIndex !== 0 || cells.slice(1).some((cell) => cell.tabIndex !== -1)) {
                  throw new Error(label + ' did not retain one roving gridcell tab stop.')
                }
                return cells
              }
              const verifyGridNavigation = async (cells, label) => {
                if (cells.length < 2) throw new Error(label + ' needs at least two cells for keyboard verification.')
                const first = cells[0]
                const firstTop = first.getBoundingClientRect().top
                const expectedDown = cells.find((cell) => cell.getBoundingClientRect().top > firstTop + 1) ?? first
                first.focus()
                first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
                await frames()
                if (document.activeElement !== expectedDown) {
                  throw new Error(label + ' ArrowDown did not follow the visual grid after semantic row wrapping: ' + JSON.stringify({
                    first: { key: first.dataset.resultKey, left: first.getBoundingClientRect().left, top: firstTop },
                    expected: {
                      key: expectedDown.dataset.resultKey,
                      left: expectedDown.getBoundingClientRect().left,
                      top: expectedDown.getBoundingClientRect().top
                    },
                    actual: document.activeElement instanceof HTMLElement
                      ? {
                          key: document.activeElement.dataset.resultKey,
                          className: document.activeElement.className,
                          left: document.activeElement.getBoundingClientRect().left,
                          top: document.activeElement.getBoundingClientRect().top
                        }
                      : null
                  }))
                }
                expectedDown.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
                await frames()
                if (document.activeElement !== first) {
                  throw new Error(label + ' ArrowUp did not return through the visual grid after semantic row wrapping.')
                }
              }

              const collectionCells = assertGrid('.catalog-results', 'Collection', 48)
              const ownedCollectionCards = document.querySelectorAll('.item-card:not(.missing)').length
              if (ownedCollectionCards < 2) throw new Error('The bounded-grid fixture did not preserve seeded archive evidence.')
              await verifyGridNavigation(collectionCells, 'Collection')
              collectionCells[0].click()
              await frames()
              if (!document.querySelector('.item-drawer')) throw new Error('Collection gridcell activation did not open its item drawer.')
              document.querySelector('.drawer-close')?.click()
              await frames()

              await openWorkspace('Stash Oracle')
              const oracleRoot = document.querySelector('.oracle-results')
              const oracleCount = oracleRoot?.querySelectorAll('.bounded-results-row').length ?? 0
              if (oracleCount < 2 || oracleCount > 12) {
                throw new Error('Stash Oracle rendered ' + oracleCount + ' rows after Collection showed ' + ownedCollectionCards + ' owned cards.')
              }
              const oracleCells = assertGrid('.oracle-results', 'Stash Oracle', oracleCount)
              await verifyGridNavigation(oracleCells, 'Stash Oracle')

              await openWorkspace('Supplies')
              if (!document.querySelector('.supply-results .bounded-results-state.is-empty')) {
                throw new Error('Supplies did not retain its shared empty state before selecting augments.')
              }
              const category = document.querySelector('.supplies-workspace .explorer-toolbar-filters select')
              if (!(category instanceof HTMLSelectElement)) throw new Error('Supplies category control was not rendered.')
              category.value = 'augments'
              category.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              const supplyCells = assertGrid('.supply-results', 'Supplies', 6)
              if (supplyCells.some((cell) => cell.getAttribute('aria-selected') !== 'false' || cell.getAttribute('aria-disabled') !== 'true')) {
                throw new Error('Supplies selection and disabled semantics did not remain on each gridcell.')
              }
              supplyCells[0].focus()
              supplyCells[0].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
              await frames()
              if (supplyCells[0].getAttribute('aria-selected') !== 'false') {
                throw new Error('Disabled Supplies gridcell changed selection after keyboard activation.')
              }
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_BOUNDED_KEYBOARD === '1') {
          interactionTimings.boundedKeyboardMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              const rows = [...document.querySelectorAll('.bounded-tooltip-results .bounded-results-item')]
              if (rows.length < 2) throw new Error('Bounded keyboard verification needs at least two mounted rows.')
              rows[0].focus()
              rows[0].dispatchEvent(new FocusEvent('focus'))
              for (let attempt = 0; attempt < 20 && !document.querySelector('.game-tooltip'); attempt += 1) {
                await wait(25)
              }
              if (document.activeElement !== rows[0]) throw new Error('The first bounded row did not receive focus.')
              if (!document.querySelector('.game-tooltip')) throw new Error('Focused MI row did not open the shared item tooltip.')
              const firstTop = rows[0].offsetTop
              const expectedDown = rows.find((row) => row.offsetTop > firstTop) ?? rows[1]
              rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
              await wait(20)
              if (document.activeElement !== expectedDown) throw new Error('ArrowDown did not move focus to the next bounded row.')
              expectedDown.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
              await wait(20)
              if (document.activeElement !== rows.at(-1)) throw new Error('End did not move focus to the last mounted row.')
              rows.at(-1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
              await wait(20)
              if (document.activeElement !== rows[0]) throw new Error('Home did not restore focus to the first mounted row.')
              const firstPageFirstRow = rows[0].textContent?.replace(/\s+/g, ' ').trim()
              const nextPage = document.querySelector('.bounded-tooltip-results .bounded-results-footer nav button:last-of-type')
              if (!(nextPage instanceof HTMLButtonElement) || nextPage.disabled) {
                throw new Error('Bounded keyboard verification needs an enabled next-page control.')
              }
              nextPage.click()
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const nextRows = [...document.querySelectorAll('.bounded-tooltip-results .bounded-results-item')]
              const nextPageFirstRow = nextRows[0]?.textContent?.replace(/\s+/g, ' ').trim()
              if (nextRows.length === 0 || nextRows.length > rows.length || nextPageFirstRow === firstPageFirstRow) {
                throw new Error('Next did not replace the mounted bounded page.')
              }
              const previousPage = document.querySelector('.bounded-tooltip-results .bounded-results-footer nav button:first-of-type')
              if (!(previousPage instanceof HTMLButtonElement) || previousPage.disabled) {
                throw new Error('The bounded previous-page control did not enable on page two.')
              }
              previousPage.click()
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const restoredFirstRow = document.querySelector('.bounded-tooltip-results .bounded-results-item')?.textContent?.replace(/\s+/g, ' ').trim()
              if (restoredFirstRow !== firstPageFirstRow) throw new Error('Previous did not restore the first bounded page.')
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_SETS_PAGING === '1') {
          interactionTimings.setsPagingMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              const root = document.querySelector('.set-results')
              const cards = () => [...document.querySelectorAll('.set-results .set-card')]
              const firstRecord = () => cards()[0]?.getAttribute('data-set-record')
              const pageText = () => root?.querySelector('.bounded-results-footer nav span')?.textContent?.trim() ?? ''
              const rangeText = () => root?.querySelector('.bounded-results-footer > span')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
              const nextButton = () => root?.querySelector('.bounded-results-footer nav button:last-of-type')
              const goToSecondPage = async () => {
                const next = nextButton()
                if (!(next instanceof HTMLButtonElement) || next.disabled) {
                  throw new Error('Sets did not expose an enabled next-page control.')
                }
                next.click()
                await frames()
                if (!pageText().includes('Page 2')) throw new Error('Sets did not advance to page two.')
              }
              const changeSelect = async (select, value, label) => {
                if (!(select instanceof HTMLSelectElement)) throw new Error('Sets ' + label + ' control was not available.')
                select.value = value
                select.dispatchEvent(new Event('change', { bubbles: true }))
                await frames()
                if (!pageText().includes('Page 1') && !rangeText().startsWith('1–')) {
                  throw new Error(
                    'Sets paging did not reset after ' + label + ' changed; page=' + pageText() +
                    ', range=' + rangeText() + ', cards=' + cards().length + ', value=' + select.value + '.'
                  )
                }
              }
              if (!root || cards().length !== 50) {
                throw new Error('The 202-set fixture did not mount exactly 50 set cards on page one.')
              }
              const collection = root.querySelector('.bounded-results-collection')
              const semanticItems = [...root.querySelectorAll('.bounded-results-item')]
              if (collection?.getAttribute('role') !== 'list' || semanticItems.some((item) => item.getAttribute('role') !== 'listitem')) {
                throw new Error('Passive Set cards did not retain valid list/listitem semantics inside their visual grid.')
              }
              const firstPageRecord = firstRecord()
              if (!firstPageRecord) throw new Error('Sets did not expose stable set identity.')
              const next = nextButton()
              if (!(next instanceof HTMLButtonElement)) throw new Error('Sets paging control was not rendered.')
              next.focus()
              if (document.activeElement !== next) throw new Error('The Sets next-page control was not keyboard reachable.')
              await goToSecondPage()
              if (cards().length !== 50 || !firstRecord() || firstRecord() === firstPageRecord) {
                throw new Error('Sets did not replace page one with the next 50 stable set cards.')
              }

              const sort = document.querySelector('.collection-explorer-toolbar .explorer-toolbar-sort select')
              await changeSelect(sort, 'name', 'sorting')
              await goToSecondPage()
              const filters = document.querySelectorAll('.collection-explorer-toolbar .explorer-toolbar-filters select')
              await changeSelect(filters[0], 'unstarted', 'progress filter')
              await changeSelect(filters[0], 'all', 'progress filter restoration')
              await goToSecondPage()
              await changeSelect(filters[1], 'epic', 'rarity filter')
              await changeSelect(filters[1], 'all', 'rarity filter restoration')
              await goToSecondPage()
              await changeSelect(filters[2], 'visual', 'feature filter')
              await changeSelect(filters[2], 'all', 'feature filter restoration')

              const input = document.querySelector('.collection-explorer-toolbar .explorer-search input')
              if (!(input instanceof HTMLInputElement)) throw new Error('Sets search control was not available.')
              input.value = 'no-such-bounded-set'
              input.dispatchEvent(new Event('input', { bubbles: true }))
              await wait(175)
              await frames()
              if (cards().length !== 0 || !root.querySelector('.bounded-results-state.is-empty')) {
                throw new Error('Sets search did not render the shared zero-result state.')
              }
              input.value = ''
              input.dispatchEvent(new Event('input', { bubbles: true }))
              await wait(175)
              await frames()
              if (cards().length !== 50 || !pageText().includes('Page 1')) {
                throw new Error('Clearing Sets search did not restore the first bounded page.')
              }

              const item = root.querySelector('.set-card li > button')
              if (!(item instanceof HTMLButtonElement)) throw new Error('Set member controls were not retained.')
              item.focus()
              item.dispatchEvent(new FocusEvent('focus'))
              for (let attempt = 0; attempt < 20 && !document.querySelector('.game-tooltip'); attempt += 1) await wait(25)
              if (!document.querySelector('.game-tooltip')) throw new Error('Set member focus did not retain the global item tooltip.')
              const expectedItemName = item.querySelector('strong')?.textContent?.trim()
              item.click()
              await frames()
              if (!expectedItemName || document.querySelector('.item-drawer h2')?.textContent?.trim() !== expectedItemName) {
                throw new Error('Set member activation did not retain the matching item drawer.')
              }
              document.querySelector('.drawer-close')?.click()
              await frames()
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_FARMING_PAGING === '1') {
          interactionTimings.farmingPagingMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const root = document.querySelector('.farming-route-results')
              const mountedRows = () => [...document.querySelectorAll('.farming-route-results .bounded-results-item')]
              const firstRank = () => document.querySelector('.farming-route-results .farm-rank')?.textContent?.trim()
              const firstRouteKey = () => document.querySelector('.farming-route-results article')?.getAttribute('data-route-key')
              const setSearch = async (value) => {
                const input = document.querySelector('.farming-workspace .explorer-search input')
                if (!(input instanceof HTMLInputElement)) {
                  throw new Error('Collection Farming search control was not available.')
                }
                input.value = value
                input.dispatchEvent(new Event('input', { bubbles: true }))
                await new Promise((resolve) => setTimeout(resolve, 175))
                await frames()
              }
              if (!root || mountedRows().length !== 50 || firstRank() !== '1') {
                throw new Error('The first Collection Farming page did not mount ranks 1–50.')
              }
              const firstPageRouteKey = firstRouteKey()
              if (!firstPageRouteKey) throw new Error('Collection Farming did not expose stable route identity.')
              const next = root.querySelector('.bounded-results-footer nav button:last-of-type')
              if (!(next instanceof HTMLButtonElement) || next.disabled) {
                throw new Error('Collection Farming did not expose an enabled next-page control.')
              }
              next.focus()
              if (document.activeElement !== next) {
                throw new Error('The Collection Farming next-page control was not keyboard reachable.')
              }
              next.click()
              await frames()
              const secondPageRouteKey = firstRouteKey()
              if (mountedRows().length !== 50 || firstRank() !== '51' || !secondPageRouteKey || secondPageRouteKey === firstPageRouteKey) {
                throw new Error('Collection Farming did not replace page one with global ranks 51–100.')
              }
              await setSearch('route 001')
              if (mountedRows().length !== 1 || firstRank() !== '1' || !firstRouteKey()?.includes(':synthetic route 001:')) {
                throw new Error('Collection Farming search did not reset to the matching stable route on page one.')
              }
              await setSearch('no-such-farming-route')
              if (mountedRows().length !== 0 || !root.querySelector('.bounded-results-state.is-empty')) {
                throw new Error('Collection Farming search did not render the shared zero-result state.')
              }
              await setSearch('')
              if (mountedRows().length !== 50 || firstRank() !== '1' || firstRouteKey() !== firstPageRouteKey) {
                throw new Error('Clearing Collection Farming search did not restore the original first page and route identity.')
              }
              root.querySelector('.bounded-results-footer nav button:last-of-type')?.click()
              await frames()
              if (firstRank() !== '51') throw new Error('Collection Farming could not return to page two before filter reset.')
              const rarity = document.querySelector('.farming-workspace .explorer-toolbar-filters select')
              if (!(rarity instanceof HTMLSelectElement)) {
                throw new Error('Collection Farming rarity control was not available.')
              }
              rarity.value = 'mi'
              rarity.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              if (firstRank() !== '1') {
                throw new Error('Collection Farming did not reset paging after a rarity change.')
              }
              rarity.value = 'all'
              rarity.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              const item = document.querySelector('.farming-route-results .farm-items button')
              if (!(item instanceof HTMLButtonElement)) {
                throw new Error('Collection Farming item snippets were not retained.')
              }
              const rect = item.getBoundingClientRect()
              item.dispatchEvent(new MouseEvent('mouseenter', {
                bubbles: true,
                clientX: rect.left + Math.min(8, rect.width / 2),
                clientY: rect.top + Math.min(8, rect.height / 2)
              }))
              for (let attempt = 0; attempt < 20 && !document.querySelector('.game-tooltip'); attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 25))
              }
              if (!document.querySelector('.game-tooltip')) {
                throw new Error('Collection Farming item snippets did not retain the global tooltip.')
              }
              const expectedItemName = item.textContent?.trim()
              item.click()
              await frames()
              const drawerItemName = document.querySelector('.item-drawer h2')?.textContent?.trim()
              if (!expectedItemName || drawerItemName !== expectedItemName) {
                throw new Error('Collection Farming item activation did not open the matching item drawer.')
              }
              document.querySelector('.drawer-close')?.click()
              await frames()
              item.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_SUPPLY_SELECTION === '1') {
          await window.webContents.executeJavaScript(`
            (async () => {
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const rows = () => [...document.querySelectorAll('.supply-results .bounded-results-item')]
              for (let attempt = 0; attempt < 40 && rows().length === 0; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 50))
              }
              const firstRows = rows()
              const eligible = firstRows.find((row) => row.getAttribute('aria-disabled') !== 'true')
              if (!(eligible instanceof HTMLElement)) {
                const disabled = firstRows.find((row) => row.getAttribute('aria-disabled') === 'true')
                if (!(disabled instanceof HTMLElement)) throw new Error('No supply was available for selection verification.')
                disabled.click()
                await frames()
                if (disabled.getAttribute('aria-selected') === 'true' || disabled.querySelector('input:checked')) {
                  throw new Error('An ineligible supply was selected.')
                }
                return
              }
              const identity = eligible.textContent?.replace(/\s+/g, ' ').trim()
              eligible.click()
              await frames()
              if (eligible.getAttribute('aria-selected') !== 'true' || !eligible.querySelector('input:checked')) {
                throw new Error('Eligible supply selection did not synchronize card and checkbox state.')
              }
              const disabled = firstRows.find((row) => row.getAttribute('aria-disabled') === 'true')
              if (disabled instanceof HTMLElement) {
                disabled.click()
                await frames()
                if (disabled.getAttribute('aria-selected') === 'true') throw new Error('An ineligible supply was selected.')
              }
              const next = document.querySelector('.supply-results .bounded-results-footer nav button:last-of-type')
              if (!(next instanceof HTMLButtonElement) || next.disabled) throw new Error('Supply selection verification needs a second page.')
              next.click()
              await frames()
              const previous = document.querySelector('.supply-results .bounded-results-footer nav button:first-of-type')
              if (!(previous instanceof HTMLButtonElement) || previous.disabled) throw new Error('Supply page did not advance.')
              previous.click()
              await frames()
              const restored = rows().find((row) => row.textContent?.replace(/\s+/g, ' ').trim() === identity)
              if (!(restored instanceof HTMLElement) || restored.getAttribute('aria-selected') !== 'true') {
                throw new Error('Keyed supply selection did not survive paging.')
              }
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_SUPPLIES_WORKSPACE === '1') {
          interactionTimings.suppliesWorkspaceMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              const root = document.querySelector('.supplies-workspace')
              const resultRoot = document.querySelector('.supply-results')
              const rows = () => [...document.querySelectorAll('.supply-results .bounded-results-item')]
              const resultCount = () => Number((document.querySelector('.supplies-workspace .explorer-result-count')?.textContent ?? '').replace(/[^0-9]/g, ''))
              const setQuery = async (value) => {
                const input = document.querySelector('.supplies-workspace .explorer-search input')
                if (!(input instanceof HTMLInputElement)) throw new Error('Supplies search control was not rendered.')
                input.value = value
                input.dispatchEvent(new Event('input', { bubbles: true }))
                await wait(175)
                await frames()
              }
              for (let attempt = 0; attempt < 40 && rows().length === 0; attempt += 1) await wait(50)
              if (!root || !root.querySelector('.tool-header') || !root.querySelector('.explorer-toolbar')) {
                throw new Error('Supplies did not render the shared workspace shell.')
              }
              if (!resultRoot || rows().length < 2 || rows().length > 60) {
                throw new Error('Supplies did not mount a bounded non-empty result page.')
              }
              const originalTotal = resultCount()
              const originalFirst = rows()[0]?.textContent?.replace(/\s+/g, ' ').trim()
              if (!Number.isFinite(originalTotal) || originalTotal < rows().length) throw new Error('Supplies result count was invalid.')
              const first = rows()[0]
              const second = rows()[1]
              const searchInput = document.querySelector('.supplies-workspace .explorer-search input')
              if (!(searchInput instanceof HTMLInputElement)) throw new Error('Supplies search control was not rendered.')
              first.dispatchEvent(new FocusEvent('blur'))
              searchInput.focus()
              await wait(120)
              if (document.querySelector('.game-tooltip')) throw new Error('Supplies tooltip did not settle before keyboard verification.')
              let nativeFocusEvents = 0
              first.addEventListener('focus', () => { nativeFocusEvents += 1 })
              first.focus()
              if (document.activeElement !== first) throw new Error('The first Supply card was not keyboard focusable.')
              if (nativeFocusEvents === 0) first.dispatchEvent(new FocusEvent('focus'))
              if (document.querySelector('.game-tooltip')) throw new Error('Supply focus bypassed the established delayed tooltip queue.')
              for (let attempt = 0; attempt < 40 && !document.querySelector('.game-tooltip'); attempt += 1) await wait(25)
              if (!document.querySelector('.game-tooltip')) throw new Error('Supply keyboard focus did not use the global item tooltip.')
              first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
              await wait(20)
              if (document.activeElement !== second) throw new Error('ArrowRight did not move to the next Supply card.')
              const next = resultRoot.querySelector('.bounded-results-footer nav button:last-of-type')
              if (next instanceof HTMLButtonElement && !next.disabled) {
                next.click()
                await frames()
                if (rows().length > 60 || rows()[0]?.textContent?.replace(/\s+/g, ' ').trim() === originalFirst) {
                  throw new Error('Supplies paging did not replace its bounded cards.')
                }
              }
              await setQuery('zz-no-supply-result-zz')
              if (rows().length !== 0 || !resultRoot.querySelector('.bounded-results-state.is-empty')) {
                throw new Error('Supplies did not render the shared empty state after an impossible search.')
              }
              await setQuery('')
              if (rows().length < 2 || rows().length > 60 || resultCount() !== originalTotal) {
                throw new Error('Supplies search reset did not restore the original bounded result set.')
              }
              const pageText = resultRoot.querySelector('.bounded-results-footer nav span')?.textContent ?? 'Page 1'
              if (!pageText.includes('Page 1')) throw new Error('Editing Supplies search did not reset paging to page one.')
              rows()[0]?.dispatchEvent(new FocusEvent('blur'))
              searchInput.focus()
              await wait(100)
              const systemButton = (label) => [...document.querySelectorAll('.system-nav button')]
                .find((button) => button.textContent?.trim() === label)
              const workspaceButton = (label) => [...document.querySelectorAll('.workspace-shortcuts button, .workspace-sidebar [data-tool-id]')]
                .find((button) => (button.querySelector('.workspace-nav-label')?.textContent ?? button.querySelector('span')?.textContent)?.trim() === label)
              const waitForPopState = () => new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Supplies mode verification did not emit popstate.')), 1500)
                window.addEventListener('popstate', () => {
                  clearTimeout(timer)
                  requestAnimationFrame(() => requestAnimationFrame(resolve))
                }, { once: true })
              })
              const initialLiveSupply = document.querySelector('.supplies-workspace .segmented-control button:first-child')
              if (!(initialLiveSupply instanceof HTMLButtonElement)) throw new Error('Live Supplies mode was unavailable to history verification.')
              initialLiveSupply.click()
              await frames()
              const transfers = systemButton('Transfers')
              if (!(transfers instanceof HTMLButtonElement)) throw new Error('Transfers navigation was unavailable to Supplies mode verification.')
              transfers.click()
              await frames()
              const quarantine = [...document.querySelectorAll('.transfer-section-tabs button')]
                .find((button) => button.textContent?.includes('Quarantined items'))
              if (!(quarantine instanceof HTMLButtonElement)) throw new Error('Quarantine section was unavailable to Supplies mode verification.')
              quarantine.click()
              await frames()
              const offlineTransfer = document.querySelector('.transfer-mode-tabs button:last-child')
              if (!(offlineTransfer instanceof HTMLButtonElement)) throw new Error('Offline transfer mode was unavailable to Supplies mode verification.')
              offlineTransfer.click()
              await frames()
              const backToTransfers = waitForPopState()
              history.back()
              await backToTransfers
              if (!document.querySelector('.vault-workspace')) {
                throw new Error('Back did not restore the prior Transfers section.')
              }
              const backToSupplies = waitForPopState()
              history.back()
              await backToSupplies
              if (!document.querySelector('.supplies-workspace .segmented-control button:first-child.active')) {
                throw new Error('Back did not restore the original live Supplies mode.')
              }
              const forwardToTransfers = waitForPopState()
              history.forward()
              await forwardToTransfers
              if (!document.querySelector('.vault-workspace')) {
                throw new Error('Forward did not restore the prior Transfers section.')
              }
              const forwardToOffline = waitForPopState()
              history.forward()
              await forwardToOffline
              if (!document.querySelector('.transfer-mode-tabs button:last-child.active')) {
                throw new Error('Forward did not restore the offline Transfers mode.')
              }
              const collection = systemButton('Collection')
              if (!(collection instanceof HTMLButtonElement)) throw new Error('Collection navigation was unavailable to Supplies mode verification.')
              collection.click()
              await frames()
              const supplies = workspaceButton('Supplies')
              if (!(supplies instanceof HTMLButtonElement)) throw new Error('Supplies navigation was unavailable after Transfers restoration.')
              supplies.click()
              await frames()
              const restoredOffline = document.querySelector('.supplies-workspace .segmented-control button:last-child')
              if (!(restoredOffline instanceof HTMLButtonElement) || !restoredOffline.classList.contains('active')) {
                throw new Error('Supplies did not inherit the restored offline transfer mode.')
              }
              const liveSupply = document.querySelector('.supplies-workspace .segmented-control button:first-child')
              if (liveSupply instanceof HTMLButtonElement) liveSupply.click()
              await frames()
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_DISMANTLING_PREVIEW === '1') {
          await window.webContents.executeJavaScript(`
            [...document.querySelectorAll('.dismantling-toolbar button')]
              .find((button) => button.textContent?.trim() === 'Select safe duplicates')
              ?.click()
          `)
          await new Promise((resolve) => setTimeout(resolve, 100))
          await window.webContents.executeJavaScript(
            "document.querySelector('.dismantling-run')?.click()"
          )
          let previewCompleted = false
          for (let attempt = 0; attempt < 120; attempt += 1) {
            const previewError = await window.webContents.executeJavaScript(
              "document.querySelector('.dismantling-error')?.textContent"
            )
            if (previewError) throw new Error('Dismantling preview failed: ' + previewError)
            const previewReady = await window.webContents.executeJavaScript(
              "Boolean(document.querySelector('.dismantling-costs'))"
            )
            if (previewReady) {
              previewCompleted = true
              break
            }
            await new Promise((resolve) => setTimeout(resolve, 250))
          }
          if (!previewCompleted) throw new Error('Dismantling preview timed out.')
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_PLANNER_MAP === '1') {
          await window.webContents.executeJavaScript(
            "document.querySelector('.planner-display button:last-child')?.click()"
          )
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_PLANNER_NAVIGATION === '1') {
          interactionTimings.plannerNavigationMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              const activePlan = () => document.querySelector('#planner-profile-select option:checked')?.textContent?.trim() ?? ''
              const originalPlan = activePlan()
              document.querySelector('.planner-new-plan')?.click()
              await wait(50)
              document.querySelector('.planner-setup-dialog footer button:not(.secondary)')?.click()
              await wait(75)
              const name = document.querySelector('.planner-setup-dialog input[type="text"]')
              if (name) {
                name.value = 'Synthetic Conjurer'
                name.dispatchEvent(new Event('input', { bubbles: true }))
              }
              document.querySelector('.planner-setup-dialog footer button:not(.secondary)')?.click()
              await wait(75)
              document.querySelector('.planner-setup-suggestions button')?.click()
              await wait(50)
              document.querySelector('.planner-setup-dialog footer button:not(.secondary)')?.click()
              await wait(75)
              document.querySelector('.planner-setup-dialog footer button:not(.secondary)')?.click()
              await wait(100)
              if (!activePlan().startsWith('Synthetic Conjurer')) {
                const dialogState = document.querySelector('.planner-setup-dialog')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 240) ?? 'closed'
                throw new Error('New planner profile did not become active: ' + activePlan() + ' · ' + dialogState)
              }
              history.back()
              await wait(100)
              if (activePlan() !== originalPlan) throw new Error('Back did not restore the previous planner profile.')
              history.forward()
              await wait(100)
              if (!activePlan().startsWith('Synthetic Conjurer')) throw new Error('Forward did not restore the new planner profile.')
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_OPEN_PLANNER_SETUP === '1') {
          const openedPlannerSetup = await window.webContents.executeJavaScript(`
            (async () => {
              document.querySelector('.planner-new-plan')?.click()
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              return Boolean(document.querySelector('.planner-setup-dialog'))
            })()
          `)
          if (!openedPlannerSetup) throw new Error('New plan dialog was not available for screenshot capture.')
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_ACCESSIBLE_MODAL === '1') {
          const verifiedAccessibleModal = await window.webContents.executeJavaScript(`
            (async () => {
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              document.querySelector('.onboarding-skip')?.click()
              for (let attempt = 0; attempt < 20 && document.querySelector('.onboarding-dialog'); attempt += 1) {
                await wait(25)
              }
              if (document.querySelector('.onboarding-dialog')) {
                throw new Error('Persisted onboarding could not be dismissed before custom-dialog verification.')
              }
              await frames()
              if (!document.querySelector('.planner-new-plan')) {
                const collection = [...document.querySelectorAll('.system-nav button')]
                  .find((button) => button.textContent?.trim() === 'Collection')
                collection?.click()
                await frames()
                const planner = [...document.querySelectorAll('.workspace-shortcuts button')]
                  .find((button) => button.querySelector('span')?.textContent?.trim() === 'Leveling Planner')
                planner?.click()
                await frames()
              }
              const opener = document.querySelector('.planner-new-plan')
              const outside = document.querySelector('.topbar-actions button:not([disabled]), .history-nav button:not([disabled])')
              if (!(opener instanceof HTMLButtonElement) || !(outside instanceof HTMLButtonElement)) return false
              const originalAddEventListener = document.addEventListener
              const originalRemoveEventListener = document.removeEventListener
              const registeredModalFocusListeners = []
              const removedModalFocusListeners = new Set()
              document.addEventListener = function (type, listener, options) {
                if (type === 'focusin' && options === true) registeredModalFocusListeners.push(listener)
                return originalAddEventListener.call(this, type, listener, options)
              }
              document.removeEventListener = function (type, listener, options) {
                if (type === 'focusin' && options === true && registeredModalFocusListeners.includes(listener)) {
                  removedModalFocusListeners.add(listener)
                }
                return originalRemoveEventListener.call(this, type, listener, options)
              }
              opener.focus()
              opener.click()
              await frames()
              let dialog = document.querySelector('.planner-setup-dialog')
              for (let attempt = 0; attempt < 20 && dialog instanceof HTMLElement && !dialog.contains(document.activeElement); attempt += 1) {
                await wait(25)
                dialog = document.querySelector('.planner-setup-dialog')
              }
              if (!(dialog instanceof HTMLElement) || !dialog.contains(document.activeElement)) {
                throw new Error('Planner setup did not open with focus inside its custom dialog: ' + JSON.stringify({
                  dialog: dialog instanceof HTMLElement,
                  activeTag: document.activeElement?.tagName,
                  activeClass: document.activeElement instanceof HTMLElement ? document.activeElement.className : null,
                  bodyClass: document.body.className
                }))
              }
              outside.focus()
              outside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
              await frames()
              if (!dialog.contains(document.activeElement)) {
                throw new Error('The custom Planner setup dialog allowed programmatic focus to escape.')
              }
              const historyState = JSON.stringify(history.state)
              const historyShortcut = new KeyboardEvent('keydown', {
                key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true
              })
              let historyShortcutReachedWindow = false
              const recordWindowHistoryShortcut = () => { historyShortcutReachedWindow = true }
              window.addEventListener('keydown', recordWindowHistoryShortcut, { once: true })
              document.activeElement?.dispatchEvent(historyShortcut)
              window.removeEventListener('keydown', recordWindowHistoryShortcut)
              await wait(200)
              if (
                !historyShortcut.defaultPrevented ||
                historyShortcutReachedWindow ||
                JSON.stringify(history.state) !== historyState ||
                document.querySelector('.onboarding-dialog')
              ) {
                throw new Error('An application-history shortcut escaped the active modal: ' + JSON.stringify({
                  defaultPrevented: historyShortcut.defaultPrevented,
                  reachedWindow: historyShortcutReachedWindow,
                  stateChanged: JSON.stringify(history.state) !== historyState,
                  onboardingPresent: Boolean(document.querySelector('.onboarding-dialog'))
                }))
              }
              document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape', bubbles: true, cancelable: true
              }))
              await frames()
              if (document.querySelector('.planner-setup-dialog') || document.activeElement !== opener) {
                throw new Error('Planner setup did not close and restore focus to its opener.')
              }
              document.addEventListener = originalAddEventListener
              document.removeEventListener = originalRemoveEventListener
              if (
                registeredModalFocusListeners.length !== 1 ||
                removedModalFocusListeners.size !== registeredModalFocusListeners.length
              ) {
                throw new Error('Planner setup did not remove its exact captured focus listener: ' + JSON.stringify({
                  registered: registeredModalFocusListeners.length,
                  removed: removedModalFocusListeners.size
                }))
              }
              outside.focus()
              outside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
              await frames()
              if (document.activeElement !== outside) {
                throw new Error('Planner setup retained its focus listener after unmount: ' + JSON.stringify({
                  activeTag: document.activeElement?.tagName,
                  activeClass: document.activeElement instanceof HTMLElement ? document.activeElement.className : null,
                  activeConnected: document.activeElement instanceof HTMLElement ? document.activeElement.isConnected : null,
                  onboardingPresent: Boolean(document.querySelector('.onboarding-dialog')),
                  plannerPresent: Boolean(document.querySelector('.planner-setup-dialog')),
                  outsideClass: outside.className
                }))
              }

              opener.focus()
              opener.click()
              await frames()
              dialog = document.querySelector('.planner-setup-dialog')
              if (!(dialog instanceof HTMLElement)) throw new Error('Planner setup did not reopen for detached-target verification.')
              document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape', bubbles: true, cancelable: true
              }))
              opener.remove()
              await frames()
              await frames()
              if (!(document.activeElement instanceof HTMLElement) || !document.activeElement.isConnected || document.activeElement === document.body) {
                throw new Error('Detached opener did not restore focus to a connected application fallback.')
              }
              return true
            })()
          `)
          if (!verifiedAccessibleModal) throw new Error('Planner setup custom-dialog verification controls were unavailable.')
        }
        const oracleMinimumLevel = process.env.CAIRN_CODEX_SCREENSHOT_ORACLE_MIN_LEVEL
        const oracleMaximumLevel = process.env.CAIRN_CODEX_SCREENSHOT_ORACLE_MAX_LEVEL
        if (process.env.CAIRN_CODEX_SCREENSHOT_ORACLE_SURPRISE === '1') {
          const surprised = await window.webContents.executeJavaScript(`
            (async () => {
              const button = [...document.querySelectorAll('.oracle-explorer-toolbar .explorer-toolbar-actions button')]
                .find((candidate) => candidate.textContent?.trim() === 'Surprise me')
              button?.click()
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              return Boolean(button)
            })()
          `)
          if (!surprised) throw new Error('Stash Oracle Surprise me action was not available.')
        }
        if (oracleMinimumLevel || oracleMaximumLevel) {
          await window.webContents.executeJavaScript(`
            (async () => {
              const setLevel = (label, value) => {
                const input = document.querySelector('.oracle-explorer-toolbar input[aria-label="' + label + '"]')
                if (!(input instanceof HTMLInputElement) || !value) return
                input.value = value
                input.dispatchEvent(new Event('input', { bubbles: true }))
                input.dispatchEvent(new Event('change', { bubbles: true }))
              }
              setLevel('Minimum item level', ${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_ORACLE_MIN_LEVEL ?? '')})
              setLevel('Maximum item level', ${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_ORACLE_MAX_LEVEL ?? '')})
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            })()
          `)
        }
        const skillScope = process.env.CAIRN_CODEX_SCREENSHOT_SKILL_SCOPE
        if (skillScope) {
          await window.webContents.executeJavaScript(`
            (() => {
              const select = document.querySelector('.skill-explorer-toolbar .explorer-toolbar-filters select')
              if (!select) return
              select.value = ${JSON.stringify(skillScope === 'My Archive' ? 'archive' : 'all')}
              select.dispatchEvent(new Event('change', { bubbles: true }))
            })()
          `)
        }
        const skillQuery = process.env.CAIRN_CODEX_SCREENSHOT_SKILL_QUERY
        if (skillQuery) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          await window.webContents.executeJavaScript(`
            (() => {
              const input = document.querySelector('.skill-combobox input')
              if (!input) return
              input.value = ${JSON.stringify(skillQuery)}
              input.dispatchEvent(new Event('input', { bubbles: true }))
              input.focus()
              if (${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_SKILL_SELECT_FIRST === '1')}) {
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
              }
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_SKILL_EXPLORER_WORKSPACE === '1') {
          interactionTimings.skillExplorerWorkspaceMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              const root = document.querySelector('.skill-table-results')
              const rows = () => [...document.querySelectorAll('.skill-table-results .bounded-results-item')]
              const resultCount = () => Number((document.querySelector('.skill-explorer-toolbar .explorer-result-count')?.textContent ?? '').replace(/[^0-9]/g, ''))
              const setQuery = async (value) => {
                const input = document.querySelector('.skill-explorer-toolbar .explorer-search input')
                if (!(input instanceof HTMLInputElement)) throw new Error('Skill Explorer result search was not rendered.')
                input.value = value
                input.dispatchEvent(new Event('input', { bubbles: true }))
                await wait(175)
                await frames()
              }
              if (!document.querySelector('.skill-explorer')) throw new Error('Skill Explorer workspace was not rendered.')
              if (!root || rows().length < 2 || rows().length > 50) {
                throw new Error('Skill Explorer did not mount a bounded non-empty result page.')
              }
              const originalTotal = resultCount()
              const originalFirst = rows()[0]?.textContent?.replace(/\s+/g, ' ').trim()
              if (!Number.isFinite(originalTotal) || originalTotal < rows().length) throw new Error('Skill Explorer result count was invalid.')
              const first = rows()[0]
              const second = rows()[1]
              let nativeFocusEvents = 0
              first.addEventListener('focus', () => { nativeFocusEvents += 1 })
              const activeBeforeFocus = document.activeElement === first
              if (activeBeforeFocus) {
                const picker = document.querySelector('.skill-combobox input')
                if (picker instanceof HTMLInputElement) picker.focus()
                await frames()
              }
              first.focus()
              if (document.activeElement !== first) throw new Error('The first Skill Explorer row was not keyboard focusable.')
              // Hidden screenshot windows can update activeElement without dispatching focus.
              // Exercise the same event that a foreground keyboard focus transition produces.
              if (nativeFocusEvents === 0) first.dispatchEvent(new FocusEvent('focus'))
              for (let attempt = 0; attempt < 8 && !document.querySelector('.game-tooltip'); attempt += 1) await wait(10)
              if (!document.querySelector('.game-tooltip')) throw new Error('Keyboard focus did not immediately use the global Skill Explorer tooltip.')
              first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
              await wait(20)
              if (document.activeElement !== second) throw new Error('ArrowDown did not move to the next Skill Explorer row.')
              const firstRow = first.querySelector('.skill-table-row')
              if (!(firstRow instanceof HTMLElement)) throw new Error('Skill Explorer row content was unavailable.')
              const rowRect = firstRow.getBoundingClientRect()
              firstRow.dispatchEvent(new MouseEvent('mouseenter', {
                clientX: rowRect.left + Math.min(12, rowRect.width / 2),
                clientY: rowRect.top + Math.min(12, rowRect.height / 2)
              }))
              for (let attempt = 0; attempt < 40 && !document.querySelector('.game-tooltip'); attempt += 1) await wait(25)
              if (!document.querySelector('.game-tooltip')) throw new Error('Skill Explorer did not use the global item tooltip.')
              firstRow.dispatchEvent(new MouseEvent('mouseleave'))
              const levelSort = [...document.querySelectorAll('.skill-table-header button')]
                .find((button) => button.textContent?.trim().startsWith('Level'))
              if (!(levelSort instanceof HTMLButtonElement)) throw new Error('Skill Explorer level sort was unavailable.')
              levelSort.focus()
              levelSort.click()
              await frames()
              if (!levelSort.textContent?.includes('↓')) throw new Error('Skill Explorer level sort did not select descending order.')
              const levelColumn = levelSort.closest('[role="columnheader"]')
              if (levelColumn?.getAttribute('aria-sort') !== 'descending') {
                throw new Error('Skill Explorer level sort did not expose descending aria-sort state.')
              }
              const sortedColumns = [...document.querySelectorAll('.skill-table-header [role="columnheader"][aria-sort]')]
              if (sortedColumns.length !== 1 || sortedColumns[0] !== levelColumn) {
                throw new Error('Skill Explorer exposed sort state on more than the active column.')
              }
              if (levelSort.querySelector('[aria-hidden="true"]')?.textContent?.trim() !== '↓') {
                throw new Error('Skill Explorer sort direction glyph was not decorative.')
              }
              const next = root.querySelector('.bounded-results-footer nav button:last-of-type')
              if (next instanceof HTMLButtonElement && !next.disabled) {
                next.click()
                await frames()
                if (rows().length > 50 || rows()[0]?.textContent?.replace(/\s+/g, ' ').trim() === originalFirst) {
                  throw new Error('Skill Explorer paging did not replace its bounded rows.')
                }
              }
              await setQuery('zz-no-skill-result-zz')
              if (rows().length !== 0 || !root.querySelector('.bounded-results-state.is-empty')) {
                throw new Error('Skill Explorer did not render the shared empty state after an impossible search.')
              }
              await setQuery('')
              if (rows().length < 2 || rows().length > 50 || resultCount() !== originalTotal) {
                throw new Error('Skill Explorer search reset did not restore the original bounded result set.')
              }
              const picker = document.querySelector('.skill-combobox input')
              if (!(picker instanceof HTMLInputElement)) throw new Error('Skill picker was unavailable.')
              picker.focus()
              picker.value = ''
              picker.dispatchEvent(new Event('input', { bubbles: true }))
              await frames()
              picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
              await frames()
              if (picker.hasAttribute('aria-controls') || picker.hasAttribute('aria-activedescendant')) {
                throw new Error('Closed Skill picker retained a dangling ARIA popup reference.')
              }
              picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
              await frames()
              const listbox = document.querySelector('.skill-suggestions')
              let options = [...document.querySelectorAll('.skill-suggestions [role="option"]')]
              const activeOption = document.querySelector('.skill-suggestions [role="option"].active')
              if (!(activeOption instanceof HTMLButtonElement)) throw new Error('Skill picker keyboard traversal did not expose an active option.')
              const activeOptionId = picker.getAttribute('aria-activedescendant')
              if (
                document.activeElement !== picker ||
                !(listbox instanceof HTMLElement) ||
                picker.getAttribute('aria-controls') !== listbox.id ||
                !activeOptionId ||
                activeOption.id !== activeOptionId ||
                document.getElementById(activeOptionId) !== activeOption ||
                activeOption.tabIndex !== -1 ||
                activeOption.getAttribute('aria-selected') !== 'true'
              ) {
                throw new Error('Skill picker did not keep input focus on its active-descendant option.')
              }
              const optionIds = options.map((option) => option.id)
              if (
                options.length < 20 ||
                optionIds.some((id) => !id) ||
                new Set(optionIds).size !== options.length ||
                options.some((option) => !(option instanceof HTMLButtonElement) || option.tabIndex !== -1)
              ) {
                throw new Error('Skill picker options did not expose unique IDs without extra Tab stops.')
              }
              const stableOption = options[10]
              const stableSkill = stableOption?.textContent?.trim()
              const stableOptionId = stableOption?.id
              if (!stableSkill || !stableOptionId) throw new Error('Skill picker stable-ID option was unavailable.')
              picker.value = stableSkill
              picker.dispatchEvent(new Event('input', { bubbles: true }))
              await frames()
              const filteredStableOption = [...document.querySelectorAll('.skill-suggestions [role="option"]')]
                .find((option) => option.textContent?.trim() === stableSkill)
              if (filteredStableOption?.id !== stableOptionId) {
                throw new Error('Skill picker option ID changed when its suggestion list was filtered.')
              }
              picker.value = ''
              picker.dispatchEvent(new Event('input', { bubbles: true }))
              await frames()
              options = [...document.querySelectorAll('.skill-suggestions [role="option"]')]
              const initialScrollTop = listbox.scrollTop
              for (let index = 0; index < 20; index += 1) {
                picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
              }
              await frames()
              const traversedOptionId = picker.getAttribute('aria-activedescendant')
              const traversedOption = traversedOptionId ? document.getElementById(traversedOptionId) : null
              if (!(traversedOption instanceof HTMLButtonElement) || document.activeElement !== picker) {
                throw new Error('Repeated Skill picker traversal lost its input-owned active descendant.')
              }
              const listboxRect = listbox.getBoundingClientRect()
              const traversedRect = traversedOption.getBoundingClientRect()
              if (
                listbox.scrollTop <= initialScrollTop ||
                traversedRect.top < listboxRect.top - 1 ||
                traversedRect.bottom > listboxRect.bottom + 1
              ) {
                throw new Error('Skill picker did not scroll its keyboard-active option into view.')
              }
              picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
              await frames()
              if (picker.getAttribute('aria-activedescendant') === traversedOptionId || document.activeElement !== picker) {
                throw new Error('Arrow Up did not move the Skill picker active descendant backward.')
              }
              const pointerOption = options[10]
              if (!(pointerOption instanceof HTMLButtonElement)) throw new Error('Skill picker pointer option was unavailable.')
              const pointerSkill = pointerOption.textContent?.trim()
              const mousedownAllowed = pointerOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
              if (mousedownAllowed || document.activeElement !== picker) {
                throw new Error('Pointer interaction moved focus away from the Skill picker input.')
              }
              pointerOption.click()
              await frames()
              if (
                !pointerSkill ||
                picker.value !== pointerSkill ||
                document.querySelector('.skill-suggestions') ||
                picker.hasAttribute('aria-controls') ||
                picker.hasAttribute('aria-activedescendant')
              ) {
                throw new Error('Pointer selection did not select and close the Skill picker option.')
              }
              picker.value = ''
              picker.dispatchEvent(new Event('input', { bubbles: true }))
              await frames()
              picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
              await frames()
              picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
              await frames()
              const keyboardOptionId = picker.getAttribute('aria-activedescendant')
              const keyboardOption = keyboardOptionId ? document.getElementById(keyboardOptionId) : null
              const reopenedOptions = [...document.querySelectorAll('.skill-suggestions [role="option"]')]
              if (!(keyboardOption instanceof HTMLButtonElement) || keyboardOption !== reopenedOptions.at(-1)) {
                throw new Error('Arrow Up did not open the Skill picker on its final option.')
              }
              const selectedSkill = keyboardOption.textContent?.trim()
              picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
              await frames()
              if (!selectedSkill || picker.value !== selectedSkill || document.querySelector('.skill-suggestions')) {
                throw new Error('Enter did not select and close the active Skill picker option.')
              }
              picker.dispatchEvent(new Event('input', { bubbles: true }))
              await frames()
              if (!document.querySelector('.skill-suggestions')) throw new Error('Skill picker did not reopen for Escape verification.')
              picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
              await frames()
              if (
                document.querySelector('.skill-suggestions') ||
                picker.value !== selectedSkill ||
                picker.hasAttribute('aria-controls') ||
                picker.hasAttribute('aria-activedescendant')
              ) {
                throw new Error('Escape did not close the Skill picker without changing its value.')
              }
              return performance.now() - started
            })()
          `)
        }
        const query = process.env.CAIRN_CODEX_SCREENSHOT_QUERY
        if (query) {
          interactionTimings.searchMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const input = document.querySelector('.explorer-search input, .search-field input')
              if (input) {
                input.value = ${JSON.stringify(query)}
                input.dispatchEvent(new Event('input', { bubbles: true }))
              }
              await new Promise((resolve) => setTimeout(resolve, 150))
              await new Promise((resolve) => setTimeout(resolve, 0))
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_ORACLE_WORKSPACE === '1') {
          interactionTimings.oracleWorkspaceMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              const root = document.querySelector('.oracle-results')
              const rows = () => [...document.querySelectorAll('.oracle-results .bounded-results-item')]
              const firstIdentity = () => rows()[0]?.textContent?.replace(/\s+/g, ' ').trim()
              const setQuery = async (value) => {
                const input = document.querySelector('.oracle-explorer-toolbar .explorer-search input')
                if (!(input instanceof HTMLInputElement)) throw new Error('Oracle search control was not rendered.')
                input.value = value
                input.dispatchEvent(new Event('input', { bubbles: true }))
                await wait(175)
                await frames()
              }
              const minimum = document.querySelector('.oracle-explorer-toolbar input[aria-label="Minimum item level"]')
              const maximum = document.querySelector('.oracle-explorer-toolbar input[aria-label="Maximum item level"]')
              if (!root || rows().length !== 12) throw new Error('Oracle did not mount its bounded 12-card page.')
              if (!(minimum instanceof HTMLInputElement) || minimum.value !== '1' ||
                  !(maximum instanceof HTMLInputElement) || maximum.value !== '100') {
                throw new Error('Oracle level controls did not retain the requested 1–100 range.')
              }
              const firstPageIdentity = firstIdentity()
              const first = rows()[0]
              const second = rows()[1]
              first.focus()
              if (document.activeElement !== first) throw new Error('The first Oracle card was not keyboard focusable.')
              first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
              await wait(20)
              if (document.activeElement !== second) throw new Error('ArrowDown did not move to the next Oracle card.')
              const evidence = first.querySelector('.oracle-evidence button')
              if (!(evidence instanceof HTMLButtonElement)) throw new Error('Oracle evidence did not expose an item action.')
              const evidenceRect = evidence.getBoundingClientRect()
              evidence.dispatchEvent(new MouseEvent('mouseenter', {
                clientX: evidenceRect.left + Math.min(12, evidenceRect.width / 2),
                clientY: evidenceRect.top + Math.min(12, evidenceRect.height / 2)
              }))
              for (let attempt = 0; attempt < 40 && !document.querySelector('.game-tooltip'); attempt += 1) await wait(25)
              if (!document.querySelector('.game-tooltip')) throw new Error('Oracle evidence did not use the global item tooltip.')
              evidence.dispatchEvent(new MouseEvent('mouseleave'))
              const next = root.querySelector('.bounded-results-footer nav button:last-of-type')
              if (!(next instanceof HTMLButtonElement) || next.disabled) throw new Error('Oracle next-page control was unavailable.')
              next.click()
              await frames()
              if (rows().length !== 12 || firstIdentity() === firstPageIdentity) throw new Error('Oracle paging did not replace the mounted cards.')
              await setQuery('zz-no-oracle-result-zz')
              if (rows().length !== 0 || !root.querySelector('.bounded-results-state.is-empty')) {
                throw new Error('Oracle did not render the shared empty state after an impossible search.')
              }
              await setQuery(${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_QUERY ?? '')})
              if (rows().length !== 12 || firstIdentity() !== firstPageIdentity) {
                throw new Error('Oracle search reset did not restore page one and its original first result.')
              }
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_DISMANTLING_WORKSPACE === '1') {
          interactionTimings.dismantlingWorkspaceMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              const rows = () => [...document.querySelectorAll('.dismantling-row')]
              const setQuery = async (value) => {
                const input = document.querySelector('.dismantling-workspace .explorer-search input')
                if (!(input instanceof HTMLInputElement)) throw new Error('Dismantling search control was not rendered.')
                input.value = value
                input.dispatchEvent(new Event('input', { bubbles: true }))
                await wait(175)
                await frames()
              }
              if (!document.querySelector('.dismantling-workspace')) throw new Error('Dismantling workspace was not rendered.')
              for (let attempt = 0; attempt < 120 && rows().length !== 120; attempt += 1) await wait(250)
              if (rows().length !== 120) throw new Error('Dismantling did not mount its initial 120-copy window.')
              const firstCheckbox = rows()[0]?.querySelector('input[type="checkbox"]')
              if (!(firstCheckbox instanceof HTMLInputElement)) throw new Error('Dismantling copy selection was unavailable.')
              firstCheckbox.focus()
              if (document.activeElement !== firstCheckbox) throw new Error('Dismantling copy selection was not keyboard focusable.')
              firstCheckbox.click()
              await frames()
              const run = document.querySelector('.dismantling-run')
              if (!(run instanceof HTMLButtonElement) || run.disabled || !run.textContent?.includes('Preview 1 selected')) {
                throw new Error('Dismantling selection did not enable the read-only preview action.')
              }
              run.click()
              let previewReady = false
              for (let attempt = 0; attempt < 120; attempt += 1) {
                const previewError = document.querySelector('.dismantling-preview .vault-notice.error')?.textContent
                if (previewError) throw new Error('Dismantling preview failed: ' + previewError)
                if (document.querySelector('.dismantling-costs')) {
                  previewReady = true
                  break
                }
                await wait(250)
              }
              if (!previewReady) throw new Error('Dismantling preview did not complete.')
              const waitForPopState = () => new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Dismantling history navigation timed out.')), 2_000)
                window.addEventListener('popstate', () => {
                  clearTimeout(timer)
                  requestAnimationFrame(() => requestAnimationFrame(resolve))
                }, { once: true })
              })
              const back = waitForPopState()
              history.back()
              await back
              if (document.querySelector('.dismantling-workspace')) throw new Error('Back did not leave Dismantling Lab.')
              const forward = waitForPopState()
              history.forward()
              await forward
              const restoredRun = document.querySelector('.dismantling-run')
              if (!(restoredRun instanceof HTMLButtonElement) || !restoredRun.textContent?.includes('Preview 1 selected')) {
                throw new Error('Forward did not restore Dismantling Lab with its transient selection intact.')
              }
              await setQuery('zz-no-dismantling-result-zz')
              if (rows().length !== 0 || !document.querySelector('.dismantling-candidates .vault-empty')) {
                throw new Error('Dismantling did not render its empty state after an impossible search.')
              }
              await setQuery(${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_QUERY ?? '')})
              if (rows().length !== 120) throw new Error('Dismantling search did not restore its initial 120-copy window.')
              const more = document.querySelector('.dismantling-more')
              if (!(more instanceof HTMLButtonElement)) throw new Error('Dismantling progressive disclosure control was unavailable.')
              more.focus()
              if (document.activeElement !== more) throw new Error('Dismantling progressive disclosure was not keyboard focusable.')
              more.click()
              await frames()
              if (rows().length !== 240) throw new Error('Dismantling did not reveal the next 120 candidate copies.')
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_OPEN_SEARCH_HELP === '1') {
          const openedSearchHelp = await window.webContents.executeJavaScript(`
            (() => {
              const details = document.querySelector('.explorer-search-help')
              if (!(details instanceof HTMLDetailsElement)) return false
              details.open = true
              details.querySelector('summary')?.focus()
              return true
            })()
          `)
          if (!openedSearchHelp) throw new Error('Search help control was not available for screenshot capture.')
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_RESPONSIVE_TOOLS === '1') {
          await window.webContents.executeJavaScript(`
            (async () => {
              const waitForFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const details = document.querySelector('.explorer-search-help')
              const summary = details?.querySelector('summary')
              if (!(details instanceof HTMLDetailsElement) || !(summary instanceof HTMLElement)) {
                throw new Error('Search tips were not rendered for responsive verification.')
              }
              summary.scrollIntoView({ block: 'center', inline: 'nearest' })
              await waitForFrames()
              details.open = true
              await waitForFrames()
              await new Promise((resolve) => setTimeout(resolve, 50))
              const panel = document.querySelector('.explorer-search-help-panel')
              if (!(panel instanceof HTMLElement)) throw new Error('Search tips panel did not open.')
              const panelRect = panel.getBoundingClientRect()
              if (
                panelRect.left < 0 || panelRect.right > window.innerWidth + 1 ||
                panelRect.top < 0 || panelRect.bottom > window.innerHeight + 1
              ) {
                throw new Error('Search tips escaped the viewport: ' + JSON.stringify({
                  left: panelRect.left, right: panelRect.right, top: panelRect.top, bottom: panelRect.bottom,
                  viewport: { width: window.innerWidth, height: window.innerHeight }
                }))
              }
              panel.focus()
              panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
              await waitForFrames()
              if (details.open || document.activeElement !== summary) {
                throw new Error('Escape did not close Search tips and restore focus to its trigger.')
              }

              const advancedTrigger = document.querySelector('.advanced-search-trigger')
              if (!(advancedTrigger instanceof HTMLButtonElement)) {
                throw new Error('Advanced search trigger was not rendered for responsive verification.')
              }
              advancedTrigger.click()
              await waitForFrames()
              const dialog = document.querySelector('.advanced-search-dialog')
              if (!(dialog instanceof HTMLDialogElement) || !dialog.open) {
                throw new Error('Advanced search dialog did not open.')
              }
              const dialogRect = dialog.getBoundingClientRect()
              if (
                dialogRect.left < 0 || dialogRect.right > window.innerWidth + 1 ||
                dialogRect.top < 0 || dialogRect.bottom > window.innerHeight + 1 ||
                !dialog.contains(document.activeElement)
              ) {
                throw new Error('Advanced search is clipped or did not receive focus: ' + JSON.stringify({
                  left: dialogRect.left, right: dialogRect.right, top: dialogRect.top, bottom: dialogRect.bottom,
                  focused: document.activeElement?.tagName,
                  viewport: { width: window.innerWidth, height: window.innerHeight }
                }))
              }
              const dialogControls = [...dialog.querySelectorAll('button:not([disabled]), select:not([disabled]), input:not([disabled]):not([type="hidden"]), [tabindex]:not([tabindex="-1"])')]
                .filter((control) => control instanceof HTMLElement && control.offsetParent !== null)
              const firstDialogControl = dialogControls[0]
              const lastDialogControl = dialogControls[dialogControls.length - 1]
              if (!(firstDialogControl instanceof HTMLElement) || !(lastDialogControl instanceof HTMLElement)) {
                throw new Error('Advanced search did not expose a keyboard focus cycle.')
              }
              lastDialogControl.focus()
              lastDialogControl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
              if (document.activeElement !== firstDialogControl) {
                throw new Error('Tab did not wrap from the last Advanced search control to the first.')
              }
              firstDialogControl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
              if (document.activeElement !== lastDialogControl) {
                throw new Error('Shift+Tab did not wrap from the first Advanced search control to the last.')
              }
              advancedTrigger.focus()
              advancedTrigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
              await waitForFrames()
              if (!dialog.contains(document.activeElement)) {
                throw new Error('Advanced search allowed programmatic focus to escape the modal.')
              }
              document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
              await waitForFrames()
              if (dialog.open || document.activeElement !== advancedTrigger) {
                throw new Error('Escape did not close Advanced search and restore focus to its trigger.')
              }
              const localScroller = [...document.querySelectorAll('.skill-table-wrap, .planner-table-wrap, .mi-table-wrap')]
                .find((element) => element instanceof HTMLElement && element.offsetParent !== null)
              if (localScroller instanceof HTMLElement && localScroller.scrollWidth > localScroller.clientWidth) {
                const descriptionId = localScroller.getAttribute('aria-describedby')
                const description = descriptionId ? document.getElementById(descriptionId) : null
                if (
                  localScroller.tabIndex < 0 ||
                  !(description instanceof HTMLElement) ||
                  (window.innerWidth <= 1180 && getComputedStyle(description).display === 'none')
                ) {
                  throw new Error('Wide result table is not exposed as a labeled, keyboard-focusable local scroller.')
                }
                localScroller.focus()
                if (document.activeElement !== localScroller) {
                  throw new Error('Wide result table could not receive keyboard focus.')
                }
              }
              if (${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_OPEN_SEARCH_HELP === '1')}) {
                details.open = true
                await waitForFrames()
              }
            })()
          `)
        }
        const miWorkshopQuery = process.env.CAIRN_CODEX_SCREENSHOT_MI_QUERY
        const miAffixFilter = process.env.CAIRN_CODEX_SCREENSHOT_MI_AFFIX_FILTER
        const miNativeRestore = process.env.CAIRN_CODEX_SCREENSHOT_MI_NATIVE_RESTORE === '1'
        if (miWorkshopQuery || miAffixFilter) {
          await window.webContents.executeJavaScript(`
            (async () => {
              const input = document.querySelector('.mi-explorer-toolbar .explorer-search input')
              if (input && ${JSON.stringify(Boolean(miWorkshopQuery))}) {
                input.value = ${JSON.stringify(miWorkshopQuery ?? '')}
                if (!${JSON.stringify(miNativeRestore)}) input.dispatchEvent(new Event('input', { bubbles: true }))
              }
              const select = document.querySelector('.mi-explorer-toolbar .explorer-toolbar-filters select')
              if (select && ${JSON.stringify(Boolean(miAffixFilter))}) {
                select.value = ${JSON.stringify(miAffixFilter ?? 'all')}
                if (!${JSON.stringify(miNativeRestore)}) select.dispatchEvent(new Event('change', { bubbles: true }))
              }
              if (${JSON.stringify(miNativeRestore)}) window.dispatchEvent(new PageTransitionEvent('pageshow'))
              await new Promise((resolve) => setTimeout(resolve, 150))
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_MI_WORKSHOP_WORKSPACE === '1') {
          interactionTimings.miWorkshopWorkspaceMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
              const root = document.querySelector('.mi-workshop')
              const resultRoot = document.querySelector('.mi-table-results')
              const rows = () => [...document.querySelectorAll('.mi-table-results .bounded-results-item')]
              const resultCount = () => Number((document.querySelector('.mi-explorer-toolbar .explorer-result-count')?.textContent ?? '').replace(/[^0-9]/g, ''))
              const selects = () => [...document.querySelectorAll('.mi-explorer-toolbar select')]
              const setQuery = async (value) => {
                const input = document.querySelector('.mi-explorer-toolbar .explorer-search input')
                if (!(input instanceof HTMLInputElement)) throw new Error('MI Workshop search control was not rendered.')
                input.value = value
                input.dispatchEvent(new Event('input', { bubbles: true }))
                await wait(175)
                await frames()
              }
              if (!root || !root.querySelector('.tool-header') || !root.querySelector('.explorer-toolbar')) {
                throw new Error('MI Workshop did not render the shared workspace shell.')
              }
              if (!resultRoot || rows().length < 2 || rows().length > 50) {
                throw new Error('MI Workshop did not mount a bounded non-empty result page.')
              }
              const originalTotal = resultCount()
              const originalFirst = rows()[0]?.textContent?.replace(/\s+/g, ' ').trim()
              if (!Number.isFinite(originalTotal) || originalTotal < rows().length) throw new Error('MI Workshop result count was invalid.')
              const first = rows()[0]
              const second = rows()[1]
              const affixed = rows().find((row) => row.querySelectorAll('.affix-name.rare, .affix-name.magical').length === 2)
              if (!(affixed instanceof HTMLElement)) throw new Error('MI Workshop fixture did not expose an affixed copy for tooltip verification.')
              let nativeFocusEvents = 0
              affixed.addEventListener('focus', () => { nativeFocusEvents += 1 })
              affixed.focus()
              if (document.activeElement !== affixed) throw new Error('An affixed MI Workshop row was not keyboard focusable.')
              if (nativeFocusEvents === 0) affixed.dispatchEvent(new FocusEvent('focus'))
              for (let attempt = 0; attempt < 8 && !document.querySelector('.game-tooltip'); attempt += 1) await wait(10)
              const tooltipName = document.querySelector('.game-tooltip h3')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
              const rowAffixes = [...affixed.querySelectorAll('.affix-name')].map((node) => node.textContent?.trim()).filter(Boolean)
              // Older imported catalog tags contain a few singular/plural label variants (for
              // example, "of Spine" versus "of Spines") for the same serialized affix record.
              const tooltipIncludesAffix = (affix) => tooltipName.includes(affix) ||
                (affix.endsWith('s') && tooltipName.includes(affix.slice(0, -1)))
              if (!tooltipName || rowAffixes.some((affix) => !tooltipIncludesAffix(affix))) {
                throw new Error('MI Workshop keyboard tooltip did not immediately preserve the selected copy affixes: ' + JSON.stringify({ tooltipName, rowAffixes }))
              }
              first.focus()
              first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
              await wait(20)
              if (document.activeElement !== second) throw new Error('ArrowDown did not move to the next MI Workshop row.')
              const searchInput = document.querySelector('.mi-explorer-toolbar .explorer-search input')
              second.dispatchEvent(new FocusEvent('blur'))
              if (searchInput instanceof HTMLInputElement) searchInput.focus()
              await wait(120)
              if (document.querySelector('.game-tooltip')) throw new Error('MI Workshop tooltip did not settle before pointer-delay verification.')
              const affixedRow = affixed.querySelector('.mi-table-row')
              if (!(affixedRow instanceof HTMLElement)) throw new Error('MI Workshop row content was unavailable.')
              affixedRow.dispatchEvent(new MouseEvent('mouseenter', { clientX: 20, clientY: 20 }))
              if (document.querySelector('.game-tooltip')) throw new Error('MI Workshop pointer hover bypassed the established tooltip delay.')
              for (let attempt = 0; attempt < 40 && !document.querySelector('.game-tooltip'); attempt += 1) await wait(25)
              if (!document.querySelector('.game-tooltip')) throw new Error('MI Workshop pointer hover did not use the global tooltip.')
              affixedRow.dispatchEvent(new MouseEvent('mouseleave'))
              const [affixSelect, metricSelect, sortSelect, orderSelect] = selects()
              if (![affixSelect, metricSelect, sortSelect, orderSelect].every((select) => select instanceof HTMLSelectElement)) {
                throw new Error('MI Workshop typed filter and sort controls were incomplete.')
              }
              affixSelect.value = 'double-rare'
              affixSelect.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              if (rows().length === 0 || rows().some((row) => row.querySelectorAll('.affix-name.rare').length !== 2 || row.querySelector('.affix-name.magical'))) {
                throw new Error('MI Workshop double-rare filter admitted a non-rare affix pair.')
              }
              affixSelect.value = 'all'
              affixSelect.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              sortSelect.value = 'level'
              sortSelect.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              orderSelect.value = 'asc'
              orderSelect.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              const levels = rows().map((row) => Number(row.querySelector('.mi-table-row > [role="gridcell"]:nth-child(2)')?.textContent))
              if (levels.some((level, index) => index > 0 && level < levels[index - 1])) {
                throw new Error('MI Workshop required-level sort did not produce ascending results: ' + JSON.stringify({
                  levels,
                  sort: sortSelect.value,
                  order: orderSelect.value
                }))
              }
              const next = resultRoot.querySelector('.bounded-results-footer nav button:last-of-type')
              if (!(next instanceof HTMLButtonElement) || next.disabled) throw new Error('MI Workshop verification needs a second bounded page.')
              next.click()
              await frames()
              if (rows().length > 50 || rows()[0]?.textContent?.replace(/\s+/g, ' ').trim() === originalFirst) {
                throw new Error('MI Workshop paging did not replace its bounded rows.')
              }
              await setQuery('zz-no-mi-result-zz')
              if (rows().length !== 0 || !resultRoot.querySelector('.bounded-results-state.is-empty')) {
                throw new Error('MI Workshop did not render the shared empty state after an impossible search.')
              }
              await setQuery('')
              if (rows().length < 2 || rows().length > 50 || resultCount() !== originalTotal) {
                throw new Error('MI Workshop search reset did not restore the original bounded result set.')
              }
              const pageText = resultRoot.querySelector('.bounded-results-footer nav span')?.textContent ?? 'Page 1'
              if (!pageText.includes('Page 1')) throw new Error('Editing MI Workshop search did not reset paging to page one.')
              const scroller = document.querySelector('.mi-table-wrap')
              if (!(scroller instanceof HTMLElement) || scroller.tabIndex < 0 || scroller.getAttribute('aria-describedby') !== 'mi-table-scroll-help') {
                throw new Error('MI Workshop comparison table is not a labeled keyboard-focusable local scroller.')
              }
              if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
                throw new Error('MI Workshop escaped its local scroller and overflowed the document.')
              }
              return performance.now() - started
            })()
          `)
        }
        const scrollTarget = process.env.CAIRN_CODEX_SCREENSHOT_SCROLL_TARGET
        if (scrollTarget) {
          await window.webContents.executeJavaScript(`
            (() => {
              const target = document.querySelector(${JSON.stringify(scrollTarget)})
              if (!target) return window.scrollTo(0, 0)
              const topbar = document.querySelector('.topbar')
              const offset = (topbar?.getBoundingClientRect().height ?? 0) + 12
              window.scrollTo(0, Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset))
            })()
          `)
        } else {
          await window.webContents.executeJavaScript('window.scrollTo(0, 0)')
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_OPEN_FIRST === '1') {
          await new Promise((resolve) => setTimeout(resolve, 250))
          await window.webContents.executeJavaScript(
            "document.querySelector('.item-card[role=button], .set-card li button')?.click()"
          )
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_HOVER_FIRST === '1') {
          await new Promise((resolve) => setTimeout(resolve, 250))
          await window.webContents.executeJavaScript(`
            (() => {
              const card = document.querySelector('.item-card[role=button], .set-card li button, .planner-results .bounded-results-item, .atlas-item-list button')
              if (!card) return
              const rect = card.getBoundingClientRect()
              card.dispatchEvent(new MouseEvent('mouseenter', {
                bubbles: false,
                clientX: rect.right - 20,
                clientY: rect.top + 30
              }))
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_TYPED_ROUTES === '1') {
          interactionTimings.typedRoutesMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const waitForPopState = () => new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Typed route navigation did not emit popstate.')), 1500)
                window.addEventListener('popstate', () => {
                  clearTimeout(timer)
                  requestAnimationFrame(() => requestAnimationFrame(resolve))
                }, { once: true })
              })
              const systemButton = (label) => [...document.querySelectorAll('.system-nav button')]
                .find((button) => button.textContent?.trim() === label)
              const workspaceButton = (label) => [...document.querySelectorAll('.workspace-shortcuts button, .workspace-sidebar [data-tool-id]')]
                .find((button) => (button.querySelector('.workspace-nav-label')?.textContent ?? button.querySelector('span')?.textContent)?.trim() === label)
              const openCollectionWorkspace = async () => {
                const collection = workspaceButton('Collection')
                if (!(collection instanceof HTMLButtonElement) || !collection.isConnected) {
                  throw new Error('Live Collection workspace route was unavailable.')
                }
                collection.click()
                await frames()
              }
              const activeWorkspace = () => document.querySelector('.workspace-sidebar [aria-current="page"] .workspace-nav-label')?.textContent?.trim()
              const expectedInitialControls = ${JSON.stringify(expectedRouteControls)}
              const assertInitialControls = (state) => {
                for (const [key, expected] of Object.entries(expectedInitialControls)) {
                  if (key === 'profileId' && expected === null) continue
                  if (JSON.stringify(state.route.controls[key]) !== JSON.stringify(expected)) {
                    throw new Error('Initial typed route control was overwritten: ' + JSON.stringify({
                      key, expected, actual: state.route.controls[key], controls: state.route.controls
                    }))
                  }
                }
              }
              const assertTypedEntry = (workspace, itemExpected) => {
                const state = window.history.state
                if (
                  state?.cairnCodex !== true || state?.routeVersion !== 1 ||
                  state?.route?.version !== 1 || state?.route?.workspace !== workspace ||
                  typeof state?.index !== 'number' || 'view' in state || 'selectedRecord' in state
                ) {
                  throw new Error('History entry is not the versioned typed route for ' + workspace + ': ' + JSON.stringify(state))
                }
                if (itemExpected && !state.route.itemRecord) throw new Error('Item route omitted its stable record identity.')
                if (!itemExpected && state.route.itemRecord !== null) throw new Error('Workspace route retained a transient item selection.')
                const serialized = JSON.stringify(state.route)
                for (const forbidden of ['snapshot', 'results', 'observedItems', 'payload']) {
                  if (serialized.includes('"' + forbidden + '"')) {
                    throw new Error('Typed route serialized forbidden transient data: ' + forbidden + '.')
                  }
                }
                const hash = new URL(window.location.href).hash
                const params = new URLSearchParams(hash.slice(1))
                if (params.get('cc-route') !== '1' || params.get('view') !== workspace) {
                  throw new Error('URL deep link and typed history state disagree: ' + hash)
                }
                return state
              }

              document.querySelector('.onboarding-skip')?.click()
              await frames()
              if (window.history.state?.route?.workspace === 'planner') {
                const initialPlanner = assertTypedEntry('planner', false)
                assertInitialControls(initialPlanner)
                if (!document.querySelector('.leveling-planner')) throw new Error('Direct Planner deep link did not restore its workspace.')
                const activeRegion = document.querySelector('.mi-atlas-regions button.active')
                if (
                  !(activeRegion instanceof HTMLButtonElement) ||
                  activeRegion.dataset.regionKey !== expectedInitialControls.atlasRegion
                ) {
                  throw new Error('Direct Planner map route did not preserve its selected atlas region.')
                }
                return performance.now() - started
              }
              if (window.history.state?.route?.workspace === 'sets') {
                const initialSet = assertTypedEntry('sets', false)
                assertInitialControls(initialSet)
                if (activeWorkspace() !== 'Sets') throw new Error('Direct Sets deep link did not restore its workspace.')
                const setsRoot = document.querySelector('.set-results')
                const currentSetPage = () => setsRoot?.querySelector('.bounded-results-footer nav span')?.textContent?.trim() ?? ''
                if (!currentSetPage().includes('Page 2')) throw new Error('Direct Sets deep link did not restore page two.')
                const setItem = document.querySelector('.set-card li button')
                if (!(setItem instanceof HTMLButtonElement)) throw new Error('Deep-linked Sets route did not render an item link.')
                setItem.click()
                await frames()
                const setItemState = assertTypedEntry('sets', true)
                if (!document.querySelector('.item-drawer')) throw new Error('Set item link did not open its typed item route.')

                const closeDrawer = document.querySelector('.drawer-close')
                if (!(closeDrawer instanceof HTMLButtonElement)) throw new Error('Set item drawer did not expose its close action.')
                closeDrawer.click()
                await frames()
                assertTypedEntry('sets', false)
                if (!currentSetPage().includes('Page 2')) throw new Error('Closing the Set item drawer did not retain page two.')

                const search = document.querySelector('.collection-explorer-toolbar .explorer-search input')
                if (!(search instanceof HTMLInputElement)) throw new Error('Sets search was unavailable for route restoration.')
                search.value = 'no-such-route-restoration-set'
                search.dispatchEvent(new Event('input', { bubbles: true }))
                await new Promise((resolve) => setTimeout(resolve, 175))
                await frames()
                const restrictedState = assertTypedEntry('sets', false)
                if (restrictedState.route.controls.page !== 1 || !document.querySelector('.set-results .bounded-results-state.is-empty')) {
                  throw new Error('Restrictive Sets search did not replace history with its page-one empty state.')
                }

                const backToSetItem = waitForPopState()
                window.history.back()
                await backToSetItem
                await new Promise((resolve) => setTimeout(resolve, 175))
                const restoredItem = assertTypedEntry('sets', true)
                if (
                  restoredItem.route.itemRecord !== setItemState.route.itemRecord ||
                  !currentSetPage().includes('Page 2') ||
                  !document.querySelector('.item-drawer')
                ) {
                  throw new Error('Back did not restore the Set item route on page two after a restrictive search.')
                }

                const forwardToRestrictedSet = waitForPopState()
                window.history.forward()
                await forwardToRestrictedSet
                await new Promise((resolve) => setTimeout(resolve, 175))
                if (
                  document.querySelector('.item-drawer') ||
                  window.history.state.route.itemRecord !== null ||
                  window.history.state.route.controls.query !== 'no-such-route-restoration-set' ||
                  window.history.state.route.controls.page !== 1 ||
                  !document.querySelector('.set-results .bounded-results-state.is-empty')
                ) {
                  throw new Error('Forward did not restore the restrictive Sets search route.')
                }
                return performance.now() - started
              }
              const initial = assertTypedEntry('collection', false)
              assertInitialControls(initial)
              if (activeWorkspace() !== 'Collection' || typeof initial.route.controls.query !== 'string') {
                throw new Error('Direct Collection deep link did not restore its workspace and query.')
              }
              const card = document.querySelector('.catalog-results .bounded-results-item[tabindex]')
              if (!(card instanceof HTMLElement)) throw new Error('Deep-linked Collection route did not render an activatable MI item.')
              card.click()
              await frames()
              const itemState = assertTypedEntry('collection', true)
              const drawer = document.querySelector('.item-drawer')
              const openWorkshop = document.querySelector('.drawer-mi-tools button')
              if (!(drawer instanceof HTMLElement) || !(openWorkshop instanceof HTMLButtonElement)) {
                throw new Error('Collection item route did not open the MI comparison drawer and return action.')
              }
              const itemName = drawer.querySelector('h2')?.textContent?.trim()
              if (!itemName || !itemState.route.itemRecord) throw new Error('MI item route lacked stable identity.')
              openWorkshop.click()
              await frames()
              const workshopState = assertTypedEntry('mi-workshop', false)
              if (workshopState.route.controls.query !== itemName || document.querySelector('.item-drawer')) {
                throw new Error('Open in MI Workshop did not create a serializable return destination.')
              }
              const backToItem = waitForPopState()
              window.history.back()
              await backToItem
              if (!document.querySelector('.item-drawer') || window.history.state.route.itemRecord !== itemState.route.itemRecord) {
                throw new Error('Back did not restore the MI item drawer route: ' + JSON.stringify({
                  state: window.history.state,
                  expectedRecord: itemState.route.itemRecord,
                  drawer: document.querySelector('.item-drawer h2')?.textContent?.trim() ?? null,
                  workspace: activeWorkspace()
                }))
              }
              const forwardToWorkshop = waitForPopState()
              window.history.forward()
              await forwardToWorkshop
              if (document.querySelector('.item-drawer') || window.history.state.route.controls.query !== itemName) {
                throw new Error('Forward did not restore the MI Workshop return route.')
              }

              const search = document.querySelector('.mi-explorer-toolbar .explorer-search input')
              const affix = document.querySelector('.mi-explorer-toolbar .explorer-toolbar-filters select')
              if (!(search instanceof HTMLInputElement) || !(affix instanceof HTMLSelectElement)) {
                throw new Error('MI route controls were not rendered for native restoration verification.')
              }
              const restoredWorkshopState = assertTypedEntry('mi-workshop', false)
              search.value = 'native-restoration-disagreement'
              affix.value = 'double-rare'
              window.dispatchEvent(new PageTransitionEvent('pageshow'))
              await frames()
              await new Promise((resolve) => setTimeout(resolve, 20))
              if (
                search.value !== restoredWorkshopState.route.controls.query ||
                affix.value !== restoredWorkshopState.route.controls.affix
              ) {
                throw new Error('Native form restoration disagreed with application route state.')
              }

              await openCollectionWorkspace()
              assertTypedEntry('collection', false)
              const workshop = workspaceButton('MI Workshop')
              if (!(workshop instanceof HTMLButtonElement)) throw new Error('MI Workshop child route was unavailable from Collection.')
              workshop.click()
              await frames()
              assertTypedEntry('mi-workshop', false)
              const backToCollection = waitForPopState()
              window.history.back()
              await backToCollection
              const collectionBeforeMaterials = assertTypedEntry('collection', false)
              const materials = workspaceButton('Components & Consumables')
              if (!(materials instanceof HTMLButtonElement)) throw new Error('Materials child route was unavailable from Collection.')
              materials.click()
              await frames()
              assertTypedEntry('materials', false)
              const materialsSearch = document.querySelector('.collection-materials-workspace .explorer-search input')
              if (!(materialsSearch instanceof HTMLInputElement)) throw new Error('Materials search control was not rendered.')
              materialsSearch.value = 'materials-only-query'
              materialsSearch.dispatchEvent(new Event('input', { bubbles: true }))
              await frames()
              if (window.history.state.route.controls.query !== 'materials-only-query') {
                throw new Error('Materials did not own its typed query state.')
              }
              await openCollectionWorkspace()
              const restoredCollection = assertTypedEntry('collection', false)
              if (JSON.stringify(restoredCollection.route.controls) !== JSON.stringify(collectionBeforeMaterials.route.controls)) {
                throw new Error('Materials controls leaked into Collection: ' + JSON.stringify({
                  before: collectionBeforeMaterials.route.controls,
                  after: restoredCollection.route.controls
                }))
              }
              const materialsAgain = workspaceButton('Components & Consumables')
              materialsAgain?.click()
              await frames()
              const restoredMaterials = assertTypedEntry('materials', false)
              if (restoredMaterials.route.controls.query !== 'materials-only-query') {
                throw new Error('Returning to Materials did not preserve its independent typed query.')
              }
              await openCollectionWorkspace()
              assertTypedEntry('collection', false)
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_NAVIGATION === '1' && transferSection) {
          interactionTimings.navigationMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const activeSection = () => document.querySelector('.transfer-section-tabs button.active strong')?.textContent?.trim()
              const waitForPopState = () => new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Navigation did not emit popstate.')), 1500)
                window.addEventListener('popstate', () => {
                  clearTimeout(timer)
                  requestAnimationFrame(() => requestAnimationFrame(resolve))
                }, { once: true })
              })
              const back = waitForPopState()
              window.history.back()
              await back
              if (activeSection() !== 'Ingest history') throw new Error('Back did not restore Ingest history.')
              const forward = waitForPopState()
              window.history.forward()
              await forward
              if (activeSection() !== ${JSON.stringify(transferSection)}) {
                throw new Error('Forward did not restore the requested transfer section.')
              }
              const restoredQuery = document.querySelector('.vault-explorer-toolbar input')?.value ?? ''
              if (restoredQuery !== ${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_QUERY ?? '')}) {
                throw new Error('Forward did not restore the transfer-history query.')
              }
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_NAVIGATION === '1' && !transferSection) {
          if (process.env.CAIRN_CODEX_SCREENSHOT_ONBOARDING_STEP === undefined) {
            await window.webContents.executeJavaScript(`
              (async () => {
                document.querySelector('.onboarding-skip')?.click()
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              })()
            `)
          }
          window.setOpacity(0)
          window.showInactive()
          window.webContents.invalidate()
          await new Promise((resolve) => setTimeout(resolve, 100))
          interactionTimings.navigationMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const systemButton = (label) => [...document.querySelectorAll('.system-nav button')]
                .find((button) => button.textContent?.trim() === label)
              const workspaceButton = (label) => [...document.querySelectorAll('.workspace-shortcuts button, .workspace-sidebar [data-tool-id]')]
                .find((button) => (button.querySelector('.workspace-nav-label')?.textContent ?? button.querySelector('span')?.textContent)?.trim() === label)
              const currentSystemView = () => document.querySelector('.system-nav button[aria-current="page"]')?.textContent?.trim()
              const activeWorkspace = () => document.querySelector('.workspace-sidebar [aria-current="page"] .workspace-nav-label')?.textContent?.trim()
              const assertSettings = () => {
                if (currentSystemView() !== 'Settings' || !document.querySelector('.settings-workspace')) {
                  throw new Error('Settings destination and content were not restored together.')
                }
              }
              const assertCollection = () => {
                if (
                  currentSystemView() !== undefined ||
                  activeWorkspace() !== 'Collection' ||
                  !document.querySelector('.workspace-sidebar') ||
                  !document.querySelector('.category-tabs') ||
                  systemButton('Collection')
                ) {
                  throw new Error('Collection was duplicated in system and workspace navigation.')
                }
              }
              const waitForFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const waitForPopState = () => new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('System navigation did not emit popstate.')), 1500)
                window.addEventListener('popstate', () => {
                  clearTimeout(timer)
                  requestAnimationFrame(() => requestAnimationFrame(resolve))
                }, { once: true })
              })
              assertSettings()
              const collection = systemButton('Collection')
              if (!collection) throw new Error('Persistent Collection navigation was not rendered.')
              const systemNav = document.querySelector('.system-nav')
              const navButtons = [...(systemNav?.querySelectorAll('button') ?? [])]
              const navLabels = navButtons.map((button) => button.textContent?.trim())
              if (navLabels.join('|') !== 'Collection|Transfers|Settings') {
                throw new Error('System navigation order was not deterministic: ' + navLabels.join('|') + '.')
              }
              const navRect = systemNav?.getBoundingClientRect()
              if (
                !navRect ||
                navRect.left < 0 || navRect.right > window.innerWidth ||
                navRect.top < 0 || navRect.bottom > window.innerHeight ||
                navRect.width <= 0 || navRect.height <= 0 ||
                (systemNav?.scrollWidth ?? 1) > (systemNav?.clientWidth ?? 0) ||
                (systemNav?.scrollHeight ?? 1) > (systemNav?.clientHeight ?? 0) ||
                document.documentElement.scrollWidth > window.innerWidth
              ) {
                throw new Error('Persistent system navigation is clipped or overflowing.')
              }
              for (const button of navButtons) {
                const rect = button.getBoundingClientRect()
                const style = getComputedStyle(button)
                const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
                if (
                  button.disabled || button.tabIndex < 0 ||
                  style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 ||
                  rect.width <= 0 || rect.height <= 0 ||
                  rect.left < navRect.left || rect.right > navRect.right ||
                  rect.top < navRect.top || rect.bottom > navRect.bottom ||
                  rect.left < 0 || rect.right > window.innerWidth ||
                  rect.top < 0 || rect.bottom > window.innerHeight ||
                  !hit || (hit !== button && !button.contains(hit))
                ) {
                  throw new Error(
                    (button.textContent?.trim() || 'Unknown') + ' is clipped, obscured, or unavailable: ' +
                    JSON.stringify({
                      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
                      navRect: { left: navRect.left, right: navRect.right, top: navRect.top, bottom: navRect.bottom },
                      viewport: { width: window.innerWidth, height: window.innerHeight },
                      display: style.display,
                      visibility: style.visibility,
                      opacity: style.opacity,
                      hit: hit ? { tag: hit.tagName, className: hit.className } : null
                    })
                  )
                }
                button.focus()
                if (document.activeElement !== button) {
                  throw new Error((button.textContent?.trim() || 'Unknown') + ' could not receive keyboard focus.')
                }
              }
              collection.focus()
              if (document.activeElement !== collection) throw new Error('Collection could not receive keyboard focus.')
              collection.click()
              await waitForFrames()
              assertCollection()
              const sets = workspaceButton('Sets')
              if (!sets) throw new Error('Sets child workspace was not rendered for navigation verification.')
              sets.click()
              await waitForFrames()
              if (
                currentSystemView() !== undefined ||
                activeWorkspace() !== 'Sets' ||
                document.querySelector('.category-tabs') ||
                systemButton('Collection')
              ) {
                throw new Error('Specialist workspace retained a system-level Collection control.')
              }
              const backToCollection = waitForPopState()
              window.history.back()
              await backToCollection
              assertCollection()
              const backToSettings = waitForPopState()
              window.history.back()
              await backToSettings
              assertSettings()
              const forward = waitForPopState()
              window.history.forward()
              await forward
              assertCollection()
              const returnToSettings = waitForPopState()
              window.history.back()
              await returnToSettings
              assertSettings()
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_VERIFY_SETTINGS_WORKSPACE === '1') {
          interactionTimings.settingsWorkspaceMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const wait = (duration = 100) => new Promise((resolve) => setTimeout(resolve, duration))
              const preferences = () => JSON.parse(localStorage.getItem('cairn-codex-preferences') || '{}')
              const expectedSafeMode = ${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_EXPECT_SAFE_SETTINGS === '1')}
              if (expectedSafeMode) {
                const settingsButton = [...document.querySelectorAll('.system-nav button')]
                  .find((button) => button.textContent?.trim() === 'Settings')
                if (!(settingsButton instanceof HTMLButtonElement)) {
                  throw new Error('Safe-mode Settings navigation control was not rendered.')
                }
                settingsButton.click()
                await frames()
              }
              const workspace = document.querySelector('.settings-workspace')
              if (!workspace || document.querySelector('.workspace-sidebar')) {
                throw new Error('Settings must render as a focused system workspace without the workspace sidebar.')
              }
              if (workspace.querySelectorAll('.settings-card').length !== 14) {
                throw new Error('Settings extraction did not retain all fourteen cards.')
              }

              const autoConnect = workspace.querySelector('.settings-card input[type="checkbox"]')
              const experimental = workspace.querySelector('.experimental-tools-toggle input')
              if (!(autoConnect instanceof HTMLInputElement) || !(experimental instanceof HTMLInputElement)) {
                throw new Error('Settings safety toggles were not rendered.')
              }
              if (expectedSafeMode) {
                if (!autoConnect.disabled || !experimental.disabled || experimental.checked) {
                  throw new Error('Safe mode did not disable auto-connect and experimental tools.')
                }
                return performance.now() - started
              }
              if (autoConnect.disabled || experimental.disabled) {
                throw new Error('Ordinary Settings unexpectedly inherited safe-mode gating.')
              }

              experimental.click()
              await frames()
              if (!experimental.checked || preferences().workspace?.experimentalToolsEnabled !== true) {
                throw new Error('Experimental-tools emit did not update the persisted shell preference.')
              }
              const oracleLabel = [...workspace.querySelectorAll('.workspace-tool-options label')]
                .find((label) => label.textContent?.includes('Stash Oracle'))
              const oracleToggle = oracleLabel?.querySelector('input')
              if (!(oracleToggle instanceof HTMLInputElement) || oracleToggle.disabled) {
                throw new Error('Enabling experimental tools did not enable the Stash Oracle control.')
              }
              const triviaLabel = [...workspace.querySelectorAll('.workspace-tool-options label')]
                .find((label) => label.textContent?.includes('Collection Trivia'))
              const triviaToggle = triviaLabel?.querySelector('input')
              if (!(triviaToggle instanceof HTMLInputElement)) throw new Error('Tool visibility control was not rendered.')
              const triviaInitiallyVisible = triviaToggle.checked
              triviaToggle.click()
              await frames()
              if (preferences().workspace?.visibleTools?.includes('trivia') === triviaInitiallyVisible) {
                throw new Error('Tool visibility emit did not persist the requested boolean argument.')
              }

              const tierMode = workspace.querySelector('input[type="radio"][value="tier"]')
              if (!(tierMode instanceof HTMLInputElement)) throw new Error('MI counting model was not rendered.')
              tierMode.click()
              await frames()
              if (!tierMode.checked || preferences().workspace?.miCountingMode !== 'tier') {
                throw new Error('MI counting v-model did not update the persisted parent ref.')
              }

              const stashTarget = workspace.querySelector('.retrieval-settings select')
              if (!(stashTarget instanceof HTMLSelectElement) || stashTarget.options.length !== 2) {
                throw new Error('Settings fixture did not expose both retrieval targets.')
              }
              const nextStash = stashTarget.options[1].value
              stashTarget.value = nextStash
              stashTarget.dispatchEvent(new Event('change', { bubbles: true }))
              await frames()
              await wait()
              if (stashTarget.value !== nextStash || preferences().sources?.retrievalStash !== nextStash) {
                throw new Error('Retrieval-target v-model did not update the persisted parent ref.')
              }

              const modeToggles = [...workspace.querySelectorAll('.archive-mode-options input')]
              if (modeToggles.length !== 2 || !modeToggles.every((input) => input instanceof HTMLInputElement)) {
                throw new Error('Settings fixture did not expose both archive-mode controls.')
              }
              for (const modeToggle of modeToggles) {
                if (!modeToggle.checked) {
                  modeToggle.click()
                  await frames()
                  await wait()
                }
              }
              if (!modeToggles.every((input) => input.checked) || preferences().sources?.archivePaths?.length !== 2) {
                throw new Error('Archive-mode enable events did not establish the two-mode test state.')
              }
              const [softcore, hardcore] = modeToggles
              softcore.click()
              await frames()
              await wait()
              if (softcore.checked || !hardcore.checked || !hardcore.disabled || preferences().sources?.archivePaths?.length !== 1) {
                throw new Error('Disabling one archive mode did not protect the remaining mode.')
              }
              hardcore.click()
              await frames()
              if (!hardcore.checked) throw new Error('The disabled final archive mode was changed programmatically through the UI.')
              softcore.click()
              await frames()
              await wait()
              if (!softcore.checked || !hardcore.checked || hardcore.disabled || preferences().sources?.archivePaths?.length !== 2) {
                throw new Error('Re-enabling the second archive mode did not restore both-mode state.')
              }
              return performance.now() - started
            })()
          `)
        }
        await window.webContents.executeJavaScript(`
          (async () => {
            if (${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_ONBOARDING_STEP === undefined)}) {
              document.querySelector('.onboarding-skip')?.click()
            }
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          })()
        `)
        window.setOpacity(0)
        window.showInactive()
        window.webContents.invalidate()
        await new Promise((resolve) => setTimeout(resolve, 1000))
        if (scrollTarget) {
          await window.webContents.executeJavaScript(`
            (() => {
              const target = document.querySelector(${JSON.stringify(scrollTarget)})
              if (!target) return
              const topbar = document.querySelector('.topbar')
              const offset = (topbar?.getBoundingClientRect().height ?? 0) + 12
              window.scrollTo(0, Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset))
            })()
          `)
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        const renderedState = await window.webContents.executeJavaScript(`({
          heading: document.querySelector('.hero h2')?.textContent,
          results: document.querySelector('.explorer-result-count, .result-count')?.textContent,
          cards: document.querySelectorAll('.item-card').length,
          sets: document.querySelectorAll('.set-card').length,
          copyCards: document.querySelectorAll('.copy-card').length,
          vaultRows: document.querySelectorAll('.quarantine-results .vault-row, .vault-item-list .vault-row').length,
          operationRows: document.querySelectorAll('.operation-history-row').length,
          plannerRows: document.querySelectorAll('.planner-table-results .planner-table-row').length,
          plannerCards: document.querySelectorAll('.planner-card-results .planner-card').length,
          boundedRows: document.querySelectorAll('.bounded-results .bounded-results-item').length,
          skillRows: document.querySelectorAll('.skill-table-results .skill-table-row').length,
          dismantlingRows: document.querySelectorAll('.dismantling-row').length,
          farmingRows: document.querySelectorAll('.farm-list .bounded-results-item > article').length,
          oracleCards: document.querySelectorAll('.oracle-card').length,
          supplyCards: document.querySelectorAll('.supply-card').length,
          materialCards: document.querySelectorAll('.materials-grid .item-card').length,
          toolHeaders: document.querySelectorAll('.tool-header').length,
          explorerToolbars: document.querySelectorAll('.explorer-toolbar').length,
          boundedSurfaces: document.querySelectorAll('.bounded-results').length,
          miRows: [...document.querySelectorAll('.mi-table-results .mi-table-row')].map((row) => ({
            text: row.textContent?.replace(/\s+/g, ' ').trim(),
            prefixClass: row.children[2]?.className,
            suffixClass: row.children[3]?.className
          })),
          miQuery: document.querySelector('.mi-explorer-toolbar .explorer-search input')?.value,
          miAffixFilter: document.querySelector('.mi-explorer-toolbar .explorer-toolbar-filters select')?.value,
          drawer: document.querySelector('.item-drawer h2')?.textContent?.trim(),
          tooltip: document.querySelector('.game-tooltip')?.textContent?.trim(),
          tooltipRect: (() => {
            const tooltip = document.querySelector('.game-tooltip')
            if (!tooltip) return null
            const rect = tooltip.getBoundingClientRect()
            return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }
          })(),
          cacheIssue: document.querySelector('.app-shell')?.getAttribute('data-cache-issue'),
          cacheApi: typeof window.cairnCodex?.getCachedCollection,
          icons: [...document.querySelectorAll('.item-mark img')].map((image) => ({
            src: image.getAttribute('src'),
            complete: image.complete,
            width: image.naturalWidth,
            height: image.naturalHeight
          })),
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          scrollTargetFound: Boolean(document.querySelector(${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_SCROLL_TARGET ?? 'body')})),
          activeWorkspace: document.querySelector('.workspace-sidebar [aria-current="page"] .workspace-nav-label')?.textContent?.trim() ??
            document.querySelector('.system-nav button[aria-current="page"]')?.textContent?.trim(),
          documentWidth: document.documentElement.scrollWidth,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          overflowingElements: [...document.querySelectorAll('body *')]
            .filter((element) => {
              const rect = element.getBoundingClientRect()
              return rect.right > window.innerWidth + 1 || rect.left < -1
            })
            .slice(0, 12)
            .map((element) => {
              const rect = element.getBoundingClientRect()
              return {
                tag: element.tagName.toLocaleLowerCase(),
                className: typeof element.className === 'string' ? element.className : '',
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                width: Math.round(rect.width)
              }
            }),
          titleX: document.querySelector('.topbar > div')?.getBoundingClientRect().x,
          mainX: document.querySelector('main')?.getBoundingClientRect().x,
          viewport: { width: window.innerWidth, height: window.innerHeight }
        })`)
        const startup = await window.webContents.executeJavaScript(
          'window.cairnCodex.getStartupStatus()'
        ) as StartupStatus
        const performanceReport = {
          readyMs: Date.now() - captureStartedAt,
          startup,
          interactions: interactionTimings,
          renderedState
        }
        const image = await window.webContents.capturePage()
        await writeFile(path, image.toPNG())
        if (process.env.CAIRN_CODEX_PERF_REPORT_PATH) {
          await writeFile(
            process.env.CAIRN_CODEX_PERF_REPORT_PATH,
            JSON.stringify(performanceReport, null, 2)
          )
        }
        console.log(
          JSON.stringify({
            screenshotPath: path,
            width: actualContentWidth,
            height: actualContentHeight,
            ...performanceReport
          })
        )
        app.quit()
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    const diagnostic = await window.webContents.executeJavaScript(`({
      heading: document.querySelector('.hero h2')?.textContent,
      scanError: document.querySelector('.scan-error')?.textContent,
      scanDisabled: document.querySelector('.primary-action')?.disabled,
          backgroundScan: document.querySelector('.background-scan')?.textContent,
          cacheIssue: document.querySelector('.app-shell')?.getAttribute('data-cache-issue'),
          cacheApi: typeof window.cairnCodex?.getCachedCollection,
      cards: document.querySelectorAll('.item-card').length,
      text: document.body.innerText.slice(0, 500)
    })`)
    throw new Error(
      'Renderer did not finish its collection scan before screenshot timeout: ' +
        JSON.stringify(diagnostic)
    )
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
}

// Automated diagnostics run in disposable processes and must not be mistaken
// for user-launched second instances while the ordinary app is open.
const hasSingleInstanceLock = process.env.CAIRN_CODEX_SCREENSHOT_PATH ||
  process.env.CAIRN_CODEX_SMOKE_TEST === '1'
  ? true
  : app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
}

let createActivatedWindow: (() => Promise<void>) | null = null
registerPrimaryWindowLifecycle({
  app,
  getWindows: () => BrowserWindow.getAllWindows(),
  createWindow: async () => { await createActivatedWindow?.() },
  platform: process.platform
}, hasSingleInstanceLock)

if (process.platform === 'win32') app.setAppUserModelId('com.hinnestolzenberg.cairncodex')

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  const diagnosticsDirectory = process.env.CAIRN_CODEX_SMOKE_TEST === '1'
    ? join(app.getPath('temp'), `cairn-codex-smoke-logs-${process.pid}`)
    : join(app.getPath('userData'), 'logs')
  // Start with the larger bounded policy so a persisted debug session is not
  // truncated before the database setting becomes available below.
  const diagnostics = new DiagnosticLogger(diagnosticsDirectory, true)
  await diagnostics.initialize()
  const startupRecoveryPath = process.env.CAIRN_CODEX_SMOKE_TEST === '1'
    ? join(app.getPath('temp'), `cairn-codex-startup-recovery-${process.pid}.json`)
    : join(app.getPath('userData'), 'startup-recovery.json')
  const startupRecovery = new StartupRecoveryService(startupRecoveryPath, safeModeRequested)
  const startupRecoveryStatus = await startupRecovery.markStarted().catch((error) => {
    diagnostics.error('recovery', 'startup-health.read-failed', error)
    return startupRecovery.getStatus()
  })
  let rendererProcessFailed = false
  process.on('uncaughtExceptionMonitor', (error) => {
    diagnostics.error('failure', 'main-process.uncaught-exception', error)
  })
  app.on('render-process-gone', (_event, _webContents, details) => {
    if (process.env.CAIRN_CODEX_SCREENSHOT_PATH) {
      console.error('[benchmark-renderer-gone]' + JSON.stringify({
        reason: details.reason,
        exitCode: details.exitCode
      }))
    }
    if (details.reason === 'clean-exit') return
    rendererProcessFailed = true
    void startupRecovery.markRendererFailure().catch((error) => {
      diagnostics.error('recovery', 'startup-health.failure-persist-failed', error)
    })
    diagnostics.warn('failure', 'renderer-process.gone', {
      reason: details.reason,
      exitCode: details.exitCode
    })
  })
  app.on('child-process-gone', (_event, details) => {
    diagnostics.warn('failure', 'child-process.gone', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode
    })
  })
  diagnostics.info('startup', 'electron.ready', {
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    electronVersion: process.versions.electron,
    safeMode: startupRecoveryStatus
  })
  console.log('[startup] Electron ready; opening Cairn Codex services.')
  Menu.setApplicationMenu(null)
  registerItemIconProtocol()
  diagnostics.info('startup', 'icon-protocol.registered')
  console.log('[startup] Item icon protocol registered.')
  const helper = createHelperClient(diagnostics)
  const databaseOverride = process.env.CAIRN_CODEX_DATABASE_PATH
  const databasePath = process.env.CAIRN_CODEX_SMOKE_TEST === '1'
    ? ':memory:'
    : databaseOverride ?? join(app.getPath('userData'), 'cairn-codex.sqlite3')
  const archiveBackupDirectory = process.env.CAIRN_CODEX_ARCHIVE_BACKUP_DIR ??
    join(app.getPath('userData'), 'archive-backups')
  if (databasePath !== ':memory:') {
    try {
      const restored = await ArchiveBackupService.applyPendingRestore(
        databasePath,
        archiveBackupDirectory
      )
      if (restored) {
        diagnostics.info('startup', 'archive-restore.applied')
        console.log('[startup] Staged archive restore applied and verified.')
      }
    } catch (error) {
      const quarantined = await ArchiveBackupService.quarantinePendingRestore(
        archiveBackupDirectory
      ).catch(() => null)
      console.error(
        '[startup] Staged archive restore was rejected; the current archive was preserved.' +
        (quarantined ? ` Request quarantined at ${quarantined}.` : ''),
        error
      )
      diagnostics.error('startup', 'archive-restore.rejected', error, {
        requestQuarantined: Boolean(quarantined)
      })
    }
  }
  const database = new CollectionDatabase(databasePath)
  diagnostics.setDebugMode(database.getDebugLogging())
  diagnostics.info('startup', 'database.ready', {
    schemaVersion: database.getDiagnosticSummary().schemaVersion
  })
  console.log('[startup] Collection database ready.')

  const ingestCommand = process.env.CAIRN_CODEX_INGEST_REQUEST
  if (ingestCommand) {
    void runIngestCommand(helper, database, JSON.parse(ingestCommand) as IngestCommand)
    return
  }

  const gdiaImportPath = process.env.CAIRN_CODEX_IMPORT_GDIA
  if (gdiaImportPath) {
    const backupDirectory = process.env.CAIRN_CODEX_MIGRATION_BACKUP_DIR ??
      join(app.getPath('userData'), 'migrations', 'gdia')
    const stages: string[] = []
    void analyzeGdiaDatabase(database, gdiaImportPath, backupDirectory)
      .then(async (analysis) => ({
        analysis,
        result: await migrateGdiaDatabase(
          database,
          gdiaImportPath,
          backupDirectory,
          {
            requireAllCatalogued: false,
            expectedSourceSha256: analysis.preflight.sourceSha256,
            expectedQueueFingerprint: analysis.queueFingerprint,
            expectedRequiredFreeBytes: analysis.preflight.requiredFreeBytes,
            onStage: (stage) => stages.push(stage)
          }
        )
      }))
      .then(({ analysis, result }) => {
        console.log(JSON.stringify({ migration: 'gdia', preflight: analysis.preflight, stages, ...result }))
        helper.dispose()
        database.close()
        app.exit(0)
      })
      .catch((error) => {
        console.error(error)
        helper.dispose()
        database.close()
        app.exit(1)
      })
    return
  }

  const retrievalPlanCommand = process.env.CAIRN_CODEX_RETRIEVAL_PLAN_REQUEST
  if (retrievalPlanCommand) {
    void runRetrievalPlanCommand(
      helper,
      database,
      JSON.parse(retrievalPlanCommand) as RetrievalPlanCommand
    )
    return
  }

  const retrievalCommand = process.env.CAIRN_CODEX_RETRIEVE_REQUEST
  if (retrievalCommand) {
    void runRetrievalCommand(
      helper,
      database,
      JSON.parse(retrievalCommand) as RetrievalCommand
    )
    return
  }

  if (process.env.CAIRN_CODEX_SMOKE_TEST === '1') {
    void runSmokeTest(helper, database, diagnostics)
    return
  }

  const archiveBackups = new ArchiveBackupService(
    database,
    databasePath,
    archiveBackupDirectory
  )
  const jobs = new BackgroundJobCoordinator()
  const flushIpcWrites = registerIpcHandlers(
    helper,
    database,
    archiveBackups,
    diagnostics,
    startupRecovery,
    jobs
  )
  diagnostics.info('startup', 'ipc.registered')
  console.log('[startup] IPC handlers registered; creating the main window.')
  createActivatedWindow = () => createWindow(startupRecovery.getStatus())
  void createWindow(startupRecoveryStatus)
  void jobs.run({
    kind: 'archive-backup',
    dedupeKey: 'archive-backup:startup-check',
    stage: 'queued',
    progress: {
      completed: 0, total: 1, percent: 0, unit: 'steps',
      label: 'Check automatic archive backup', detail: 'Reviewing the latest verified backup age.'
    },
    canCancel: false,
    boundary: null,
    completedStage: 'complete', failedStage: 'failed', canceledStage: 'canceled'
  }, async (job) => {
    job.throwIfCancellationRequested()
    job.update({ stage: 'checkpointing', canCancel: false, boundary: null })
    return archiveBackups.ensureStartupBackup()
  }, (backup) => ({
    summary: backup ? 'Automatic archive backup created.' : 'Existing archive backup is current.',
    metrics: { created: Boolean(backup), backupId: backup?.id ?? null }
  })).result
    .then((backup) => {
      if (backup) console.log(`[archive-backup] verified ${backup.fileName}`)
    })
    .catch((error) => console.error('[archive-backup] automatic daily backup failed', error))

  registerManagedShutdown(app, async () => {
    await flushIpcWrites().catch((error) => {
      console.error('[shutdown] queued archive work failed', error)
    })
    if (!rendererProcessFailed) {
      await startupRecovery.markHealthy().catch((error) => {
        diagnostics.error('recovery', 'startup-health.shutdown-persist-failed', error)
      })
    }
    helper.dispose()
    database.close()
  }, (error) => console.error('[shutdown] queued archive work failed', error))
})
