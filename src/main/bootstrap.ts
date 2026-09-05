import { createLiveTransferService } from './transfers/live-retrieval.ts';
import { executeIngestCommand, executeRetrievalCommand, planRetrievalCommand, type IngestCommand, type RetrievalCommand } from './transfers/offline-transactions.ts';
import { syncLiveIncoming } from './transfers/live-incoming.ts';
import { executeLiveAugmentDispense, executeSahdinasMementoRecovery } from './transfers/live-delivery.ts';
import { reconcileLiveRecoveryOperations } from './transfers/retained-receipts.ts';
import { systemTransferClock, isHardcoreStashPath, type HelperRequester } from './transfers/runtime.ts';

import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { arch, platform, release } from 'node:os';
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, screen, shell } from 'electron';
import { isGlossarySourceUrl } from '../shared/glossary-sources';
import type { ApplicationVerification } from './application-runtime.ts';
import { captureDiagnosticScreenshot } from './screenshot-diagnostics.ts';
import { CATALOG_PRESENTATION_VERSION, ROLL_ANALYSIS_VERSION } from './catalog-versions.ts';
import { IPC_CHANNELS, type ArchiveBackupEntry, type ArchiveBackupActionResult, type CharacterSaveProfile, type CollectionBasis, type CollectionSnapshot, type DismantlingPreview, type GrimDawnDiscovery, type GdiaImportProgress, type GdiaImportResult, type IngestResult, type ItemRollAnalysis, type LiveGameStatus, type OperationHistoryPage, type OperationHistoryRequest, type PreferenceLoadReport, type SpecialRecoveryDestination, type MapRegionLocation, type RetrievalResult, type RendererErrorReport, type ObservedStashItem, type StagingTabInspection, type StartupPhaseEvent, type StartupStatus, type VaultListItem, type VaultItemPage, type VaultPageRequest, type VaultSummary, type WriteSafetyStatus } from '@shared/contracts';

import { presentCollection, type LiveVaultPayload } from './collection-presentation.ts';
import { QuarantineReconciliationService } from './quarantine-reconciliation.ts';
import { GrimDawnHelperClient } from './grim-dawn/helper-client';
import { CollectionDatabase, type ResolvedArchiveCatalogItem } from './collection-database';
import { analyzeGdiaDatabase, migrateGdiaDatabase } from './gdia-migration';
import { readLastGdiaImportResult, writeLastGdiaImportResult } from './gdia-import-receipt';
import { ArchiveBackupService } from './archive-backup';
import { DiagnosticLogger } from './diagnostics';
import { StartupRecoveryService, type StartupRecoveryStatus } from './startup-recovery';
import { PreferenceFileStore } from './preference-file-store.ts';
import { BackgroundJobCanceledError, BackgroundJobCoordinator, runGlobalRollHydration, TrailingJobQueue } from './background-jobs';
import { createMainIpcDomains } from './ipc/domains.ts';
import { booleanField, validateBackgroundJobId, validateCollectionRequest, validateNavigation, validateOperationHistory, validateOptionalMode, validatePath, validatePathAndVaultIds, validatePinnedBest, validatePreferenceBootstrap, validatePreferenceLoad, validateRendererError, validateSerializedPreferences, validateSourcePaths, validateSpecialRecovery, validateStartupPhase, validateSupplyDispense, validateVaultIds, validateVaultPage, validateZoomFactor } from './ipc/validation.ts';
import { registerManagedShutdown, registerPrimaryWindowLifecycle, registerWindowStatePersistence } from './window-lifecycle.ts';
import { MainOperationCoordinator } from './operation-coordinator.ts';
import { BackgroundJobService } from './ipc/background-job-service.ts';
import { BackupService } from './ipc/backup-service.ts';
import { WindowService } from './ipc/window-service.ts';
import { ItemAssistantImportCanceledError, ItemAssistantImportService, migrationOptionsFromRequest } from './ipc/import-service.ts';
import { CollectionService } from './ipc/collection-service.ts';
import { runCollectionRefresh } from './ipc/collection-refresh-jobs.ts';
import { DiagnosticsService } from './ipc/diagnostics-service.ts';
import { ArchiveDomainService } from './ipc/archive-service.ts';

import { LiveGameDomainService } from './ipc/live-game-service.ts';
import { DiagnosticExportService } from './ipc/diagnostic-export-service.ts';
import { readCollectionSnapshotCache, writeCollectionSnapshotCache } from './collection-snapshot-cache.ts';

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

let verification: ApplicationVerification | undefined
let applicationRoot = app.getAppPath()
let applicationStarted = false
const DOUBLE_RARE_MI_BITMAP = 'character/item_doubleraremonsterinfrequent.tex'
const collectionRarities = ['epic', 'legendary', 'mi'] as const

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

interface PersistedWindowState {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

export interface MapLocationIndex {
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

interface RetrievalPlanCommand {
  path: string
  targetTabIndex: number
  vaultItemIds: string[]
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
        applicationRoot,
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
          lane: event.lane,
          method: event.method,
          durationMs: event.durationMs
        })
      } else {
        diagnostics?.debugEvent('helper', 'request.completed', {
          lane: event.lane,
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

function transferDependencies(helper: HelperRequester, database: CollectionDatabase) {
  return { helper, database, clock: systemTransferClock, paths: {
    backups: join(app.getPath('userData'), 'backups'),
    receipts: join(app.getPath('userData'), 'live-receipts')
  } }
}

function registerIpcHandlers(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  archiveBackups: ArchiveBackupService,
  diagnostics: DiagnosticLogger,
  startupRecovery: StartupRecoveryService,
  jobs: BackgroundJobCoordinator
): () => Promise<void> {
  const transfer = transferDependencies(helper, database)
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
    transfersPermitted: () => !process.env.CAIRN_CODEX_SCREENSHOT_PATH,
    reconcileTransfers: () => reconcileLiveRecoveryOperations({ ...transfer, diagnostics }),
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
  const quarantineReconciliation = new QuarantineReconciliationService({
    jobs,
    listRecords: () => database.listQuarantineCatalogRecords(),
    resolve: (installationPath, records) => helper.request<ResolvedArchiveCatalogItem[]>(
      'resolve-archive-items', { installationPath, records }
    ),
    commit: items => database.resolveQuarantineCatalogItems(items),
    runExclusive,
    queueBackup: queueArchiveBackup
  })
  const reconcileQuarantine = async (snapshot: CollectionSnapshot | null): Promise<void> => {
    try {
      await quarantineReconciliation.reconcile(snapshot?.discovery.installations[0]?.path)
    } catch (error) {
      // A metadata failure preserves quarantine and never changes import/scan success.
      diagnostics.error('quarantine-reconciliation', 'metadata.failed', error)
    }
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
    visualDiagnosticsActive: () => Boolean(process.env.CAIRN_CODEX_SCREENSHOT_PATH),
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
    reconcileRecovery: () => reconcileLiveRecoveryOperations({ ...transfer, diagnostics }),
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
        else await reconcileQuarantine(latestCollection)
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
        latestCollection ??= verification?.cachedCollection() ?? null
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
      present: async (snapshot, basis) => verification?.presentCollection(snapshot, basis)
        ?? presentCollection(database, snapshot, basis, ROLL_ANALYSIS_VERSION)
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
    catalogPresentationVersion: CATALOG_PRESENTATION_VERSION,
    afterCatalogCommit: reconcileQuarantine
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
      return runCollectionRefresh(jobs, 'collection-scan', async (job) => runDiagnosticOperation('background-job', 'collection-scan', async () => {
        job.update({
          stage: 'scanning', canCancel: false, boundary: null,
          progress: { completed: 0, label: 'Scan collection', detail: 'Reading installed game data and configured item sources.' }
        })
        return collectionService.scanCatalog()
      }, undefined, (result) => ({
        catalogItems: result.items.length,
        observedItems: result.observedItems.length,
        warningCount: result.warnings.length
      }), job.correlationId), (result) => collectionService.present(result, input))
    },
    validateCollectionRequest
  )
  ipcDomains.collection.handle(
    IPC_CHANNELS.rebuildGameDataIndex,
    async (_event, input: { sourcePaths: string[]; basis: CollectionBasis }): Promise<CollectionSnapshot> => {
      return runCollectionRefresh(jobs, 'game-data-rebuild', async (job) => runDiagnosticOperation('background-job', 'game-data-rebuild', async () => {
        job.update({
          stage: 'scanning', canCancel: false, boundary: null,
          progress: { label: 'Scan installed game data', detail: 'Building a fresh catalog from installed archives.' }
        })
        return collectionService.rebuildCatalog()
      }, undefined, (result) => ({
        catalogItems: result.items.length,
        observedItems: result.observedItems.length,
        warningCount: result.warnings.length
      }), job.correlationId), (result) => collectionService.present(result, input))
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
        return verification?.presentVaultSummary(summary) ?? summary
      }
    },
    stashes: {
      scan: (path) => helper.request<TransferStashScan>('scan-transfer-stash', { path })
    },
    transactions: {
      commitIngest: (input) => executeIngestCommand(transfer, input),
      commitRetrieval: (input) => executeRetrievalCommand(transfer, input)
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
  const liveTransferService = createLiveTransferService({ ...transfer, diagnostics })
  const liveGameService = new LiveGameDomainService({
    visualDiagnosticsActive: () => Boolean(process.env.CAIRN_CODEX_SCREENSHOT_PATH),
    inspectWriteSafety: () => helper.request<WriteSafetyStatus>('inspect-write-safety'),
    inspect: () => helper.request<LiveGameStatus>('inspect-live-game'),
    approveBuild: () => helper.request<LiveGameStatus>('approve-live-game-build'),
    start: () => helper.request<LiveGameStatus>('start-live-game'),
    stop: () => helper.request<LiveGameStatus>('stop-live-game'),
    syncIncoming: async () => {
      latestCollection ??= await readCollectionCache(collectionCachePath)
      return syncLiveIncoming(
        transfer,
        latestCollection?.discovery.installations[0]?.path
      )
    },
    retrieveVaultItems: (vaultItemIds) => liveTransferService.retrieveVaultItems(vaultItemIds),
    dispenseAugments: async (input) => {
      latestCollection ??= await readCollectionCache(collectionCachePath)
      if (!latestCollection) throw new Error('Build the game-data index before dispensing augments.')
      return executeLiveAugmentDispense(
        transfer, latestCollection, input.records, input.expectedCharacterName
      )
    },
    recoverSpecialItem: async (input) => {
      latestCollection ??= await readCollectionCache(collectionCachePath)
      if (!latestCollection) throw new Error('Build the game-data index before recovering Sahdina\'s Memento.')
      return executeSahdinasMementoRecovery(
        transfer, latestCollection, input.destination, input.expectedCharacterName
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
    await quarantineReconciliation.shutdown()
    await queuedArchiveBackups.flush()
    await preferenceStore.flush()
    await operations.flush()
    await archiveBackups.flush()
    diagnostics.info('startup', 'application.shutdown')
    await diagnostics.flush()
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
  return readCollectionSnapshotCache(path)
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
  await writeCollectionSnapshotCache(path, snapshot)
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

async function runIngestCommand(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  command: IngestCommand
): Promise<void> {
  try {
    const snapshot = await helper.request<CollectionSnapshot>('scan-collection')
    database.persistSnapshot(snapshot)
    console.log(JSON.stringify(await executeIngestCommand(transferDependencies(helper, database), command)))
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

async function runRetrievalPlanCommand(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  command: RetrievalPlanCommand
): Promise<void> {
  try {
    console.log(JSON.stringify(await planRetrievalCommand(transferDependencies(helper, database), command)))
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
    console.log(JSON.stringify(await executeRetrievalCommand(transferDependencies(helper, database), command)))
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

function captureWindowState(window: BrowserWindow): PersistedWindowState | null {
  if (process.env.CAIRN_CODEX_SCREENSHOT_PATH) return null
  const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds()
  return { ...bounds, maximized: window.isMaximized() }
}

async function rememberWindowState(state: PersistedWindowState | null): Promise<void> {
  if (!state) return
  await writeFile(
    join(app.getPath('userData'), 'window-state.json'),
    JSON.stringify(state)
  )
}

let windowStatePersistence: { finalize(): Promise<void> } | null = null

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
      : join(applicationRoot, 'build', 'icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !screenshotPath
    }
  })
  window.setMenuBarVisibility(false)
  window.webContents.setWindowOpenHandler(({ url }) => {
    // Only the fixed glossary references may leave the app. Never create a
    // privileged child window or accept arbitrary external protocols/URLs.
    if (isGlossarySourceUrl(url)) void shell.openExternal(url).catch(() => undefined)
    return { action: 'deny' }
  })
  window.setAutoHideMenuBar(true)
  if (savedState?.maximized) window.maximize()

  windowStatePersistence = registerWindowStatePersistence(
    window,
    () => captureWindowState(window),
    rememberWindowState,
    (error) => console.warn('Could not persist window placement.', error)
  )

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
      void (verification?.captureWindow ?? captureDiagnosticScreenshot)(window, screenshotPath)
    })
  }
}





// Automated diagnostics run in disposable processes and must not be mistaken
// for user-launched second instances while the ordinary app is open.
export function startCairnApplication(options: { verification?: ApplicationVerification; applicationRoot?: string } = {}): void {
  if (applicationStarted) throw new Error('The application has already started.')
  applicationStarted = true
  verification = options.verification
  applicationRoot = options.applicationRoot ?? applicationRoot
  const hasSingleInstanceLock = process.env.CAIRN_CODEX_SCREENSHOT_PATH ||
    verification?.smokeRequested
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
    const diagnosticsDirectory = verification?.smokeRequested
      ? join(app.getPath('temp'), `cairn-codex-smoke-logs-${process.pid}`)
      : join(app.getPath('userData'), 'logs')
    // Start with the larger bounded policy so a persisted debug session is not
    // truncated before the database setting becomes available below.
    const diagnostics = new DiagnosticLogger(diagnosticsDirectory, true)
    await diagnostics.initialize()
    const startupRecoveryPath = verification?.smokeRequested
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
    const databasePath = verification?.smokeRequested
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

    if (verification?.smokeRequested) {
      void verification.runSmokeTest(helper, database, diagnostics)
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
      await windowStatePersistence?.finalize()
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
}
