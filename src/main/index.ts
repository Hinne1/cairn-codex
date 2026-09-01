import { join } from 'node:path'
import { createHash, randomInt, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { arch, platform, release } from 'node:os'
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, screen, shell } from 'electron'
import {
  IPC_CHANNELS,
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
  DiagnosticLogger,
  diagnosticPrivacyViolations,
  redactDiagnosticValue
} from './diagnostics'
import { StartupRecoveryService, type StartupRecoveryStatus } from './startup-recovery'

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
      return false
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
  startupRecovery: StartupRecoveryService
): () => Promise<void> {
  let writeQueue: Promise<void> = Promise.resolve()
  let latestCollection: CollectionSnapshot | null = null
  let collectionScan: Promise<CollectionSnapshot> | null = null
  let archiveRollHydrationBatch: Promise<ArchiveRollHydrationResult | null> | null = null
  const collectionCachePath = join(app.getPath('userData'), 'collection-snapshot.json')
  const mapLocationCachePath = join(app.getPath('userData'), 'map-location-index.json')
  const gdiaBackupDirectory = join(app.getPath('userData'), 'migrations', 'gdia')
  let gdiaImportActive = false
  let gdiaImportProgress: GdiaImportProgress | null = null
  const runExclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writeQueue.then(operation, operation)
    writeQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
  const runTransferExclusive = <T>(operation: () => Promise<T>): Promise<T> =>
    runExclusive(async () => {
      await reconcileLiveRecoveryOperations(helper, database, diagnostics)
      const unresolved = database.getRecoveryOperationCount()
      if (unresolved > 0) {
        throw new Error(
          `${unresolved} earlier transfer operation${unresolved === 1 ? '' : 's'} require recovery attention. ` +
          'Pause writes, export diagnostics in Settings, and audit the retained journal and receipts first.'
        )
      }
      return operation()
    })
  const runDiagnosticOperation = async <T>(
    scope: string,
    event: string,
    operation: () => Promise<T>,
    startData?: Record<string, unknown>,
    completedData?: (result: T) => Record<string, unknown>
  ): Promise<T> => {
    const correlationId = randomUUID()
    const startedAt = diagnostics.operationStarted(scope, event, correlationId, startData)
    try {
      const result = await operation()
      diagnostics.operationCompleted(scope, event, correlationId, startedAt, completedData?.(result))
      return result
    } catch (error) {
      diagnostics.operationFailed(scope, event, correlationId, startedAt, error)
      throw error
    }
  }
  const queueArchiveBackup = (reason: string): void => {
    void runExclusive(() => archiveBackups.createBackup(reason)).catch((error) => {
      console.error(`[archive-backup] ${reason} failed`, error)
    })
  }

  ipcMain.handle(IPC_CHANNELS.getAppStatus, async (): Promise<AppStatus> => {
    try {
      await helper.request('health')
      return { appVersion: app.getVersion(), helper: 'available', mode: 'read-only', safeMode: startupRecovery.getStatus() }
    } catch {
      return { appVersion: app.getVersion(), helper: 'unavailable', mode: 'read-only', safeMode: startupRecovery.getStatus() }
    }
  })
  ipcMain.handle(IPC_CHANNELS.getDebugLogging, (): DebugLoggingStatus => {
    const policy = diagnostics.getRetentionPolicy()
    return {
      enabled: diagnostics.getDebugMode(),
      maxFiles: policy.maxFiles,
      maxFileBytes: policy.maxFileBytes,
      maxAgeDays: policy.maxAgeDays
    }
  })
  ipcMain.handle(
    IPC_CHANNELS.setDebugLogging,
    (_event, input: { enabled: boolean }): DebugLoggingStatus => {
      if (typeof input?.enabled !== 'boolean') throw new Error('Debug logging must be enabled or disabled explicitly.')
      database.setDebugLogging(input.enabled)
      diagnostics.setDebugMode(input.enabled)
      const policy = diagnostics.getRetentionPolicy()
      return {
        enabled: diagnostics.getDebugMode(),
        maxFiles: policy.maxFiles,
        maxFileBytes: policy.maxFileBytes,
        maxAgeDays: policy.maxAgeDays
      }
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.recordNavigation,
    (_event, input: { view: string }): void => {
      const views = new Set([
        'collection', 'sets', 'materials', 'skills', 'planner', 'oracle', 'mi-workshop',
        'supplies', 'farming', 'dismantling', 'vault', 'settings'
      ])
      if (!views.has(input?.view)) throw new Error('Unknown workspace navigation event.')
      diagnostics.info('navigation', 'workspace.opened', { view: input.view })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.reportRendererError,
    (_event, input: RendererErrorReport): void => {
      if (
        !input || !/^[0-9a-f-]{36}$/i.test(input.correlationId) ||
        typeof input.workspace !== 'string' || input.workspace.length > 64 ||
        typeof input.message !== 'string' || input.message.length < 1 || input.message.length > 500 ||
        (input.stack !== null && (typeof input.stack !== 'string' || input.stack.length > 4000))
      ) {
        throw new Error('Renderer error report is outside its safe bounds.')
      }
      diagnostics.error(
        'renderer',
        'workspace.failed',
        new Error(input.message),
        { correlationId: input.correlationId, workspace: input.workspace, stack: input.stack }
      )
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.reportPreferenceLoad,
    (_event, input: PreferenceLoadReport): void => {
      const sources = new Set(['fresh', 'legacy', 'stored'])
      if (
        !input || !sources.has(input.source) || typeof input.migrated !== 'boolean' ||
        input.schemaVersion !== 1 || !Array.isArray(input.invalidFields) || input.invalidFields.length > 64 ||
        !input.invalidFields.every((field) => typeof field === 'string' && /^[a-z][a-zA-Z0-9.[\]-]{0,99}$/.test(field))
      ) {
        throw new Error('Preference-load diagnostics are outside their safe bounds.')
      }
      const event = input.invalidFields.length ? 'preferences.recovered' : 'preferences.loaded'
      const data = {
        source: input.source,
        migrated: input.migrated,
        schemaVersion: input.schemaVersion,
        invalidFields: input.invalidFields
      }
      if (input.invalidFields.length) diagnostics.warn('settings', event, data)
      else diagnostics.info('settings', event, data)
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.exportPreferences,
    async (_event, input: { serialized: string }): Promise<DiagnosticExportResult> => {
      if (!input || typeof input.serialized !== 'string' || input.serialized.length > 2 * 1024 * 1024) {
        throw new Error('Preference export is outside its safe bounds.')
      }
      let parsed: unknown
      try { parsed = JSON.parse(input.serialized) as unknown } catch { throw new Error('Preference export is not valid JSON.') }
      if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1) {
        throw new Error('Preference export has an unsupported schema version.')
      }
      const stamp = new Date().toISOString().slice(0, 10)
      const selection = await dialog.showSaveDialog({
        title: 'Export Cairn Codex preferences',
        defaultPath: join(app.getPath('documents'), `cairn-codex-preferences-${stamp}.json`),
        filters: [{ name: 'Cairn Codex preferences', extensions: ['json'] }]
      })
      if (selection.canceled || !selection.filePath) return { canceled: true, path: null }
      await writeFile(selection.filePath, input.serialized, 'utf8')
      diagnostics.info('settings', 'preferences.exported', { schemaVersion: 1 })
      return { canceled: false, path: selection.filePath }
    }
  )
  const restartWithSafeMode = (safe: boolean): void => {
    const args = process.argv.slice(1).filter((argument) => argument !== SAFE_MODE_ARGUMENT)
    if (safe) args.push(SAFE_MODE_ARGUMENT)
    diagnostics.info('recovery', safe ? 'safe-mode.requested' : 'normal-mode.requested')
    app.relaunch({ args })
    app.quit()
  }
  ipcMain.handle(IPC_CHANNELS.restartInSafeMode, (): void => restartWithSafeMode(true))
  ipcMain.handle(IPC_CHANNELS.restartNormally, (): void => restartWithSafeMode(false))
  ipcMain.handle(IPC_CHANNELS.getStartupStatus, (): StartupStatus => presentStartupStatus())
  ipcMain.handle(
    IPC_CHANNELS.reportStartupPhase,
    (_event, input: { phase: StartupPhaseEvent }): StartupStatus => {
      const phases: StartupPhaseEvent[] = [
        'cache-hit', 'cache-miss', 'cached-paint', 'interactive',
        'scan-started', 'scan-settled', 'scan-skipped',
        'roll-analysis-started', 'roll-analysis-settled', 'roll-analysis-skipped'
      ]
      if (!phases.includes(input?.phase)) throw new Error('Unknown startup phase event.')
      const status = recordStartupPhase(input.phase, diagnostics)
      if (input.phase === 'interactive') void startupRecovery.markHealthy().catch((error) => {
        diagnostics.error('recovery', 'startup-health.persist-failed', error)
      })
      return status
    }
  )
  ipcMain.handle(IPC_CHANNELS.openDataDirectory, async (): Promise<string> => {
    return shell.openPath(app.getPath('userData'))
  })
  ipcMain.handle(IPC_CHANNELS.getArchiveBackupStatus, () => archiveBackups.getStatus())
  ipcMain.handle(
    IPC_CHANNELS.createArchiveBackup,
    async (): Promise<ArchiveBackupActionResult> => ({
      canceled: false,
      backup: await runExclusive(() => archiveBackups.createBackup('manual backup')),
      path: null,
      restarting: false
    })
  )
  ipcMain.handle(
    IPC_CHANNELS.exportArchiveBackup,
    async (): Promise<ArchiveBackupActionResult> => {
      const stamp = new Date().toISOString().slice(0, 10)
      const selection = await dialog.showSaveDialog({
        title: 'Export Cairn Codex archive backup',
        defaultPath: join(app.getPath('documents'), `cairn-codex-archive-${stamp}.sqlite3`),
        filters: [{ name: 'Cairn Codex archive', extensions: ['sqlite3'] }]
      })
      if (selection.canceled || !selection.filePath) {
        return { canceled: true, backup: null, path: null, restarting: false }
      }
      const backup = await runExclusive(() => archiveBackups.exportBackup(selection.filePath!))
      return {
        canceled: false,
        backup,
        path: selection.filePath,
        restarting: false
      }
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.restoreArchiveBackup,
    async (): Promise<ArchiveBackupActionResult> => {
      const unresolved = database.getRecoveryOperationCount()
      if (unresolved > 0) {
        throw new Error(
          `${unresolved} transfer operation${unresolved === 1 ? '' : 's'} require recovery attention. ` +
          'Resolve or audit them before restoring the archive.'
        )
      }
      const selection = await dialog.showOpenDialog({
        title: 'Restore Cairn Codex archive backup',
        defaultPath: (await archiveBackups.getStatus()).backupDirectory,
        properties: ['openFile'],
        filters: [
          { name: 'Cairn Codex archive', extensions: ['sqlite3', 'sqlite', 'db'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
      const sourcePath = selection.filePaths[0]
      if (selection.canceled || !sourcePath) {
        return { canceled: true, backup: null, path: null, restarting: false }
      }
      const confirmation = await dialog.showMessageBox({
        type: 'warning',
        title: 'Restore Cairn Codex archive?',
        message: 'Cairn will verify this backup and restart to restore it.',
        detail:
          'Before replacement, Cairn will preserve the current archive as a verified emergency backup. ' +
          'Grim Dawn stash files are not changed.',
        buttons: ['Cancel', 'Restore and restart'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      if (confirmation.response !== 1) {
        return { canceled: true, backup: null, path: null, restarting: false }
      }
      const backup = await runExclusive(() => archiveBackups.stageRestore(sourcePath))
      setTimeout(() => {
        app.relaunch()
        app.quit()
      }, 100)
      return { canceled: false, backup, path: sourcePath, restarting: true }
    }
  )
  ipcMain.handle(IPC_CHANNELS.openArchiveBackupDirectory, async (): Promise<string> => {
    return shell.openPath((await archiveBackups.getStatus()).backupDirectory)
  })
  ipcMain.handle(IPC_CHANNELS.getLastGdiaImportResult, () =>
    readLastGdiaImportResult(gdiaBackupDirectory))
  ipcMain.handle(IPC_CHANNELS.getGdiaImportProgress, () => gdiaImportProgress)
  ipcMain.handle(IPC_CHANNELS.importGdiaDatabase, async (event): Promise<GdiaImportResult> => {
    if (gdiaImportActive) throw new Error('An Item Assistant import is already in progress.')
    gdiaImportActive = true
    const startedAt = Date.now()
    const publish = (progress: GdiaImportProgress): void => {
      gdiaImportProgress = progress
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.gdiaImportProgress, progress)
    }
    const canceledResult = (sourcePath: string | null): GdiaImportResult => ({
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
      durationMs: Date.now() - startedAt
    })
    publish({
      stage: 'selecting',
      label: 'Choose Item Assistant database',
      detail: 'No files have been changed.',
      percent: 0,
      canCancel: true
    })
    try {
    latestCollection ??= await readCollectionCache(collectionCachePath)
    if (!latestCollection) {
      throw new Error('Let Cairn finish its initial game-data scan before importing Item Assistant.')
    }
    const defaultDatabase = join(
      process.env.LOCALAPPDATA ?? app.getPath('appData'),
      'EvilSoft',
      'IAGD',
      'data',
      'userdata.db'
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
    const sourcePath = selection.filePaths[0]
    if (selection.canceled || !sourcePath) {
      publish({ stage: 'canceled', label: 'Import canceled', detail: 'No files were changed.', percent: 0, canCancel: false })
      return canceledResult(null)
    }
    publish({
      stage: 'analyzing',
      label: 'Analyze selected source',
      detail: 'Counting copies, modes, unsupported records, backup bytes, and free space.',
      percent: 12,
      canCancel: false
    })
    const analysis = await analyzeGdiaDatabase(database, sourcePath, gdiaBackupDirectory)
    const preflight = analysis.preflight
    const enoughSpace = preflight.requiredFreeBytes <= preflight.availableFreeBytes
    publish({
      stage: 'awaiting-confirmation',
      label: 'Review analyzed source',
      detail: 'Cancel is safe here. No backup or archive mutation has started.',
      percent: 25,
      canCancel: true
    })
    const confirmation = await dialog.showMessageBox({
      type: enoughSpace ? 'question' : 'warning',
      title: enoughSpace ? 'Import analyzed Item Assistant source?' : 'More free space is required',
      message: enoughSpace
        ? `${preflight.sourceItems.toLocaleString()} Item Assistant copies are ready for review.`
        : 'Cairn cannot reserve the full verified import footprint.',
      detail: [
        `Source: ${preflight.sourcePath}`,
        `Copies: ${preflight.sourceItems.toLocaleString()} total · ${preflight.sourceSoftcoreItems.toLocaleString()} Softcore · ${preflight.sourceHardcoreItems.toLocaleString()} Hardcore`,
        `Unsupported estimate: ${preflight.unsupportedItems.toLocaleString()}`,
        `Database backup: ${formatImportBytes(preflight.backupBytes)}`,
        `Source-backup reserve: ${formatImportBytes(preflight.sourceBackupRequiredBytes)}${preflight.backupReused ? ' · verified backup will be reused' : ''}`,
        `Queue-receipt reserve: ${formatImportBytes(preflight.queueReceiptBytes)}`,
        `Archive growth reserve: ${formatImportBytes(preflight.archiveGrowthReserveBytes)}`,
        `Post-import archive backup reserve: ${formatImportBytes(preflight.archiveBackupReserveBytes)}`,
        `Total required free space: ${formatImportBytes(preflight.requiredFreeBytes)}`,
        `Available free space: ${formatImportBytes(preflight.availableFreeBytes)}`,
        `Destination: ${preflight.destinationMode}`,
        '',
        enoughSpace
          ? 'After confirmation, Cairn runs the verified backup and archive commit to completion. The source remains unchanged.'
          : 'Free space on the destination volume, then analyze the source again.'
      ].join('\n'),
      buttons: enoughSpace ? ['Cancel', 'Import analyzed source'] : ['Close'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (!enoughSpace || confirmation.response !== 1) {
      publish({ stage: 'canceled', label: 'Import canceled safely', detail: 'No files were changed.', percent: 25, canCancel: false })
      return canceledResult(sourcePath)
    }
    const stageProgress: Record<string, GdiaImportProgress> = {
      verifying: { stage: 'verifying', label: 'Verify analyzed source', detail: 'Confirming the database and pending queue still match preflight.', percent: 30, canCancel: false },
      'backing-up': { stage: 'backing-up', label: 'Protect source', detail: 'Creating or reusing a fully verified immutable backup.', percent: 42, canCancel: false },
      reading: { stage: 'reading', label: 'Read verified backup', detail: 'Loading supported Softcore and Hardcore copies from the immutable backup.', percent: 60, canCancel: false },
      importing: { stage: 'importing', label: 'Commit archive copies', detail: 'Applying one bounded archive transaction. This stage cannot be canceled.', percent: 78, canCancel: false },
      finalizing: { stage: 'finalizing', label: 'Write durable result', detail: 'Recording the final counts and verified backup outcome.', percent: 94, canCancel: false }
    }
    const completed = await runDiagnosticOperation(
      'import',
      'item-assistant',
      () => runExclusive(async () => {
        const result = await migrateGdiaDatabase(
          database,
          sourcePath,
          gdiaBackupDirectory,
          {
            requireAllCatalogued: false,
            expectedSourceSha256: preflight.sourceSha256,
            expectedQueueFingerprint: analysis.queueFingerprint,
            expectedRequiredFreeBytes: preflight.requiredFreeBytes,
            onStage: (stage) => publish(stageProgress[stage]!)
          }
        )
        const completedAtUtc = new Date().toISOString()
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
          durationMs: Date.now() - startedAt
        }
        try {
          await writeLastGdiaImportResult(gdiaBackupDirectory, summary)
        } catch (error) {
          summary = { ...summary, receiptPersisted: false }
          diagnostics.error('import', 'item-assistant.receipt-failed', error)
        }
        return { result, summary }
      }),
      { sourceItems: preflight.sourceItems, unsupportedEstimate: preflight.unsupportedItems },
      (completed) => ({
        sourceItems: completed.result.sourceItems,
        importedItems: completed.result.importedIds.length,
        duplicateItems: completed.result.duplicateIds.length,
        unsupportedItems: completed.result.unsupportedIds.length
      })
    )
    const { result, summary } = completed
    if (result.importedIds.length > 0) queueArchiveBackup('Item Assistant migration')
    publish({
      stage: 'complete',
      label: 'Item Assistant import complete',
      detail: `${summary.importedItems.toLocaleString()} imported · ${summary.duplicateItems.toLocaleString()} already present · ${summary.unsupportedItems.toLocaleString()} unsupported.`,
      percent: 100,
      canCancel: false
    })
    return summary
    } catch (error) {
      publish({
        stage: 'failed',
        label: 'Import stopped safely',
        detail: 'Cairn preserved the source and reported the failure without continuing.',
        percent: 100,
        canCancel: false
      })
      throw error
    } finally {
      gdiaImportActive = false
    }
  })
  ipcMain.handle(IPC_CHANNELS.getRecoveryStatus, () => runExclusive(async () => {
    await reconcileLiveRecoveryOperations(helper, database, diagnostics)
    const operations = database.getDiagnosticSummary().recoveryOperations
    return {
      requiresAttention: operations.length > 0,
      operations: operations.map((operation) => ({
        id: operation.id,
        operation: operation.operation,
        state: operation.state,
        startedAtUtc: operation.startedAtUtc,
        hasBackup: operation.hasBackup
      }))
    }
  }))
  ipcMain.handle(IPC_CHANNELS.exportDiagnostics, async () => {
    const generatedAtUtc = new Date().toISOString()
    const fileStamp = generatedAtUtc.replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z')
    const selection = await dialog.showSaveDialog({
      title: 'Save Cairn Codex support bundle',
      defaultPath: join(app.getPath('downloads'), `cairn-codex-support-${fileStamp}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (selection.canceled || !selection.filePath) return { canceled: true, path: null }

    const safely = async <T>(operation: () => Promise<T>): Promise<T | { error: string }> => {
      try {
        return await operation()
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }
    const userData = app.getPath('userData')
    const directoryCounts: Record<string, number> = {}
    for (const name of ['backups', 'live-receipts', 'live-adapter', 'quarantine']) {
      directoryCounts[name] = await countFiles(join(userData, name))
    }
    const live = await safely(() => helper.request<LiveGameStatus>('inspect-live-game'))
    if (!('error' in live)) diagnostics.registerSecret(live.activeCharacterName)
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
    const helperHealth = await safely(() => helper.request<Record<string, unknown>>('health'))
    const appSha256 = app.isPackaged
      ? await readFile(app.getAppPath())
          .then((contents) => createHash('sha256').update(contents).digest('hex'))
          .catch(() => null)
      : null
    const helperSha256 = await readFile(helperArtifactPath())
      .then((contents) => createHash('sha256').update(contents).digest('hex'))
      .catch(() => null)
    const logs = await diagnostics.readEntries()
    const report = redactDiagnosticValue({
      generatedAtUtc,
      formatVersion: 1,
      privacy: 'No item payloads, save contents, database contents, character names, personal paths, raw hook messages, credentials, queues, receipts, archives, or extracted game assets are included.',
      app: {
        version: app.getVersion(),
        packaged: app.isPackaged,
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome,
        sha256: appSha256
      },
      system: { platform: platform(), release: release(), architecture: arch() },
      helper: { health: helperHealth, sha256: helperSha256 },
      database: database.getDiagnosticSummary(),
      archiveBackups: await safely(async () => {
        const status = await archiveBackups.getStatus()
        return {
          retained: status.backups.length,
          verified: status.backups.filter((backup) => backup.verified).length,
          pendingRestore: status.pendingRestore,
          latest: status.latest ? {
            createdAtUtc: status.latest.createdAtUtc,
            reason: status.latest.reason,
            sizeBytes: status.latest.sizeBytes,
            schemaVersion: status.latest.schemaVersion,
            vaultItemCount: status.latest.vaultItemCount,
            verified: status.latest.verified
          } : null
        }
      }),
      files: directoryCounts,
      collection: latestCollection ? {
        scannedAtUtc: latestCollection.scannedAtUtc,
        basis: latestCollection.basis,
        warningCount: latestCollection.warnings.length,
        contentPacks: latestCollection.contentPacks.map((pack) => pack.id),
        sourceCount: latestCollection.scannedStashes.length,
        catalogItems: latestCollection.items.length,
        observedItems: latestCollection.observedItems.length
      } : null,
      writeSafety: await safely(() => helper.request<WriteSafetyStatus>('inspect-write-safety')),
      live: safeLive,
      startup: presentStartupStatus(),
      logging: diagnostics.getRetentionPolicy(),
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
    const serializedReport = `${JSON.stringify(report, null, 2)}\n`
    const privacyViolations = diagnosticPrivacyViolations(
      serializedReport,
      'error' in live || !live.activeCharacterName ? [] : [live.activeCharacterName]
    )
    if (privacyViolations.length > 0) {
      diagnostics.error(
        'diagnostics',
        'support-bundle.rejected',
        new Error(`Privacy validation failed: ${privacyViolations.join(', ')}`)
      )
      throw new Error('The support bundle failed its privacy check and was not written.')
    }
    await writeFile(selection.filePath, serializedReport, 'utf8')
    diagnostics.info('diagnostics', 'support-bundle.exported', { formatVersion: 1 })
    return { canceled: false, path: selection.filePath }
  })
  ipcMain.handle(
    IPC_CHANNELS.setZoomFactor,
    (event, input: { factor: number }): number => {
      const factor = Math.min(1.8, Math.max(0.7, Math.round(input.factor * 10) / 10))
      event.sender.setZoomFactor(factor)
      return factor
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.discoverGrimDawn,
    (): Promise<GrimDawnDiscovery> => helper.request<GrimDawnDiscovery>('discover-grim-dawn')
  )
  ipcMain.handle(
    IPC_CHANNELS.listCharacters,
    async (): Promise<CharacterSaveProfile[]> => {
      const discovered = latestCollection?.discovery ?? await helper.request<GrimDawnDiscovery>('discover-grim-dawn')
      const installationPath = discovered.installations[0]?.path
      if (!installationPath) return []
      return helper.request<CharacterSaveProfile[]>('list-characters', { installationPath })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.getCachedCollection,
    async (_event, input: { sourcePaths: string[]; basis: CollectionBasis }): Promise<CollectionSnapshot | null> => {
      const screenshotFixture = process.env.CAIRN_CODEX_SCREENSHOT_PATH
        ? process.env.CAIRN_CODEX_SCREENSHOT_FIXTURE
        : undefined
      if (screenshotFixture) {
        latestCollection = createScreenshotCollectionFixture(screenshotFixture)
        return latestCollection
      }
      latestCollection ??= await readCollectionCache(collectionCachePath)
      if (!latestCollection) {
        return null
      }
      const mapIndex = await readMapLocationIndex(mapLocationCachePath)
      if (!mapIndex || !(await mapLocationIndexIsFresh(mapIndex))) return null
      const cacheNeedsRefresh = !(await collectionStashesAreFresh(latestCollection))
      const projected = projectCollectionSources(latestCollection, input.sourcePaths)
      return {
        ...(await presentCollection(helper, database, projected, input.basis)),
        cacheNeedsRefresh
      }
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.hydrateArchiveRolls,
    async (_event, input: { sourcePaths: string[] }): Promise<ArchiveRollHydrationResult | null> => {
      const screenshotFixture = process.env.CAIRN_CODEX_SCREENSHOT_PATH
        ? process.env.CAIRN_CODEX_SCREENSHOT_FIXTURE
        : undefined
      if (screenshotFixture) {
        latestCollection = createScreenshotCollectionFixture(screenshotFixture)
        return { processed: 0, pending: 0, snapshot: latestCollection }
      }
      if (archiveRollHydrationBatch) return archiveRollHydrationBatch
      const batch = runDiagnosticOperation(
        'background-job',
        'archive-roll-hydration',
        async (): Promise<ArchiveRollHydrationResult | null> => {
          latestCollection ??= await readCollectionCache(collectionCachePath)
          if (!latestCollection) return null
          const projected = projectCollectionSources(latestCollection, input.sourcePaths)
          const mode = lifetimeMode(projected)
          const installation = projected.discovery.installations[0]
          if (!installation) {
            return {
              processed: 0,
              pending: 0,
              snapshot: await presentCollection(helper, database, projected, 'archive')
            }
          }
          const candidates = database.listArchiveRollAnalysisCandidates(
            ROLL_ANALYSIS_VERSION,
            256,
            mode
          )
          if (candidates.length === 0) {
            return {
              processed: 0,
              pending: 0,
              snapshot: await presentCollection(helper, database, projected, 'archive')
            }
          }
          const analyzed = await helper.request<{ items: ItemRollAnalysis[] }>('analyze-item-rolls', {
            installationPath: installation.path,
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
              `Roll analysis returned ${analyzed.items.length} results for ${candidates.length} archived copies.`
            )
          }
          await runExclusive(async () => {
            database.setVaultRollAnalyses(
              candidates.map((candidate, index) => ({
                id: candidate.id,
                rollAnalysis: analyzed.items[index]!
              }))
            )
          })
          const pending = database.countArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION, mode)
          return {
            processed: candidates.length,
            pending,
            snapshot: pending === 0
              ? await presentCollection(helper, database, projected, 'archive')
              : null
          }
        },
        { batchLimit: 256 },
        (result) => ({ processed: result?.processed ?? 0, pending: result?.pending ?? 0 })
      )
      archiveRollHydrationBatch = batch
      try {
        return await batch
      } finally {
        if (archiveRollHydrationBatch === batch) archiveRollHydrationBatch = null
      }
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.scanCollection,
    async (_event, input: { sourcePaths: string[]; basis: CollectionBasis }): Promise<CollectionSnapshot> => {
      collectionScan ??= runDiagnosticOperation('background-job', 'collection-scan', async () => {
        const startedAt = Date.now()
        const snapshot = await helper.request<CollectionSnapshot>('scan-collection')
        const withIcons = await attachItemIcons(helper, snapshot)
        const installationPath = withIcons.discovery.installations[0]?.path
        let withLocations = withIcons
        if (installationPath) {
          try {
            const locationIndex = await loadMapLocationIndex(
              helper,
              mapLocationCachePath,
              installationPath
            )
            withLocations = attachMapLocations(withIcons, locationIndex)
          } catch (error) {
            console.warn('Grim Dawn map locations could not be indexed.', error)
          }
        }
        const persisted = {
          ...database.persistSnapshot(withLocations),
          catalogPresentationVersion: CATALOG_PRESENTATION_VERSION
        }
        latestCollection = persisted
        await writeCollectionCache(collectionCachePath, persisted)
        console.log(`[collection-scan] completed in ${Date.now() - startedAt}ms`)
        return persisted
      }, undefined, (result) => ({
        catalogItems: result.items.length,
        observedItems: result.observedItems.length,
        warningCount: result.warnings.length
      })).finally(() => {
        collectionScan = null
      })
      const snapshot = await collectionScan
      const projected = projectCollectionSources(snapshot, input.sourcePaths)
      // A catalog refresh must resolve as soon as the browsable snapshot is ready.
      // Re-analyzing older archived rolls can take minutes after a game-data/schema
      // change; keeping it inside this foreground promise left the renderer on a
      // zero-item loading screen even though the completed cache was already on disk.
      return presentCollection(helper, database, projected, input.basis)
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.rebuildGameDataIndex,
    async (_event, input: { sourcePaths: string[]; basis: CollectionBasis }): Promise<CollectionSnapshot> => {
      return runDiagnosticOperation('background-job', 'game-data-rebuild', async () => {
        const snapshot = await helper.request<CollectionSnapshot>('scan-collection')
        const withIcons = await attachItemIcons(helper, snapshot)
        const installationPath = withIcons.discovery.installations[0]?.path
        if (!installationPath) throw new Error('No Grim Dawn installation is available.')
        const locationIndex = await loadMapLocationIndex(
          helper,
          mapLocationCachePath,
          installationPath,
          true
        )
        latestCollection = {
          ...database.persistSnapshot(attachMapLocations(withIcons, locationIndex)),
          catalogPresentationVersion: CATALOG_PRESENTATION_VERSION
        }
        await writeCollectionCache(collectionCachePath, latestCollection)
        const projected = projectCollectionSources(latestCollection, input.sourcePaths)
        return presentCollection(helper, database, projected, input.basis)
      }, undefined, (result) => ({
        catalogItems: result.items.length,
        observedItems: result.observedItems.length,
        warningCount: result.warnings.length
      }))
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.setPinnedBest,
    (_event, input: { record: string; instanceKey: string | null; isHardcore: boolean }): void => {
      database.setPinnedBest(input.record, input.instanceKey, input.isHardcore)
      queueArchiveBackup('pinned copy changed')
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.getInfiniteSupplies,
    (): boolean => database.getInfiniteSupplies()
  )
  ipcMain.handle(
    IPC_CHANNELS.setInfiniteSupplies,
    async (_event, input: { enabled: boolean }): Promise<boolean> => {
      const enabled = await runExclusive(async () => database.setInfiniteSupplies(input.enabled))
      queueArchiveBackup('supply settings changed')
      return enabled
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.inspectWriteSafety,
    (): Promise<WriteSafetyStatus> => helper.request<WriteSafetyStatus>('inspect-write-safety')
  )
  ipcMain.handle(
    IPC_CHANNELS.inspectStagingTab,
    (_event, input: { path: string }): Promise<StagingTabInspection> =>
      inspectStagingTab(helper, database, input.path)
  )
  ipcMain.handle(
    IPC_CHANNELS.listVaultItems,
    (_event, input?: { isHardcore?: boolean }): VaultListItem[] =>
      database.listVaultItems(input?.isHardcore)
  )
  ipcMain.handle(
    IPC_CHANNELS.queryVaultItems,
    (_event, input: VaultPageRequest): VaultItemPage => {
      if (!input || !['ingested', 'retrieval_pending', 'retrieved'].includes(input.state)) {
        throw new Error('A valid vault state is required.')
      }
      if (!['recent', 'name', 'level', 'roll'].includes(input.sort)) {
        throw new Error('A valid vault sort is required.')
      }
      if (!['asc', 'desc'].includes(input.direction)) {
        throw new Error('A valid vault sort direction is required.')
      }
      if (
        input.rarity !== undefined &&
        !['epic', 'legendary', 'mi', 'rare', 'faction', 'supply'].includes(input.rarity)
      ) {
        throw new Error('The requested vault rarity is not supported.')
      }
      if (
        !Number.isInteger(input.offset) || input.offset < 0 || input.offset > 10_000_000 ||
        !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 250 ||
        (input.query?.length ?? 0) > 200
      ) {
        throw new Error('Vault paging parameters are outside their safe bounds.')
      }
      return database.queryVaultItems(input)
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.queryOperationHistory,
    (_event, input: OperationHistoryRequest): OperationHistoryPage => {
      if (!input || !['ingest', 'retrieve'].includes(input.operation)) {
        throw new Error('A valid operation-history kind is required.')
      }
      if (!['all', 'committed', 'failed', 'pending'].includes(input.outcome)) {
        throw new Error('A valid operation-history outcome is required.')
      }
      if (
        !Number.isInteger(input.offset) || input.offset < 0 || input.offset > 10_000_000 ||
        !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 250 ||
        (input.query?.length ?? 0) > 200
      ) {
        throw new Error('Operation-history paging parameters are outside their safe bounds.')
      }
      return database.queryOperationHistory(input)
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.getVaultSummary,
    (): VaultSummary => {
      const summary = database.getVaultSummary()
      if (
        process.env.CAIRN_CODEX_SCREENSHOT_PATH &&
        process.env.CAIRN_CODEX_SCREENSHOT_FIXTURE === 'onboarding'
      ) {
        return { ...summary, total: 128, ingested: 128 }
      }
      return summary
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.previewDismantling,
    async (_event, input: { vaultItemIds: string[] }): Promise<DismantlingPreview> => {
      const requestedIds = input.vaultItemIds ?? []
      if (new Set(requestedIds).size !== requestedIds.length) {
        throw new Error('Duplicate dismantling candidate IDs are not allowed.')
      }
      const byId = new Map(database.listVaultItems().map((item) => [item.id, item]))
      const items = requestedIds.map((id) => {
        const item = byId.get(id)
        if (!item || item.state !== 'ingested' || !item.catalogued || item.reusable ||
          !['epic', 'legendary', 'mi', 'rare'].includes(item.rarity)) {
          throw new Error(`Archive copy is not eligible for dismantling preview: ${id}`)
        }
        return {
          vaultItemId: item.id,
          name: item.name,
          rarity: item.rarity,
          itemLevel: item.itemLevel,
          ascendant: item.ascendant
        }
      })
      const discovered = latestCollection?.discovery ??
        await helper.request<GrimDawnDiscovery>('discover-grim-dawn')
      const installationPath = discovered.installations[0]?.path
      if (!installationPath) throw new Error('No Grim Dawn installation is available.')
      return helper.request<DismantlingPreview>('simulate-dismantling', { installationPath, items })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.ingestStagingTab,
    async (_event, input: { path: string }): Promise<IngestResult> => {
      const result = await runDiagnosticOperation(
        'transfer',
        'offline-ingest',
        () => runTransferExclusive(() => executeStagingTabIngest(helper, database, input.path)),
        undefined,
        (completed) => ({ ingestedItems: completed.ingested.length })
      )
      if (result.ingested.length > 0) queueArchiveBackup('offline ingest')
      return result
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.retrieveVaultItems,
    async (_event, input: { path: string; vaultItemIds: string[] }): Promise<RetrievalResult> => {
      const result = await runDiagnosticOperation(
        'transfer',
        'offline-retrieval',
        () => runTransferExclusive(() => executeLastTabRetrieval(helper, database, input.path, input.vaultItemIds)),
        { requestedItems: input.vaultItemIds.length },
        (completed) => ({ retrievedItems: completed.retrieved.length })
      )
      if (result.retrieved.length > 0) queueArchiveBackup('offline retrieval')
      return result
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.inspectLiveGame,
    async (): Promise<LiveGameStatus> => {
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
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.approveLiveGameBuild,
    (): Promise<LiveGameStatus> => helper.request<LiveGameStatus>('approve-live-game-build')
  )
  ipcMain.handle(
    IPC_CHANNELS.startLiveGame,
    (): Promise<LiveGameStatus> => {
      if (process.env.CAIRN_CODEX_SCREENSHOT_PATH) {
        throw new Error('Live transfers are disabled during visual diagnostics.')
      }
      return helper.request<LiveGameStatus>('start-live-game')
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.stopLiveGame,
    (): Promise<LiveGameStatus> => helper.request<LiveGameStatus>('stop-live-game')
  )
  ipcMain.handle(
    IPC_CHANNELS.syncLiveGame,
    async (): Promise<LiveGameSyncResult> => {
      latestCollection ??= await readCollectionCache(collectionCachePath)
      const result = await runTransferExclusive(() => syncLiveIncoming(
        helper,
        database,
        latestCollection?.discovery.installations[0]?.path
      ))
      if (result.ingested.length > 0) {
        diagnostics.info('transfer', 'live-ingest.completed', { ingestedItems: result.ingested.length })
        queueArchiveBackup('live ingest')
      }
      return result
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.retrieveLiveVaultItems,
    async (_event, input: { vaultItemIds: string[] }): Promise<LiveRetrievalResult> => {
      const result = await runDiagnosticOperation(
        'transfer',
        'live-retrieval',
        () => runTransferExclusive(() => executeLiveRetrieval(helper, database, input.vaultItemIds)),
        { requestedItems: input.vaultItemIds.length },
        (completed) => ({ retrievedItems: completed.retrieved.length })
      )
      if (result.retrieved.length > 0) queueArchiveBackup('live retrieval')
      return result
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.dispenseLiveAugments,
    (_event, input: { records: string[]; expectedCharacterName?: string }): Promise<LiveSupplyDispenseResult> =>
      runDiagnosticOperation('transfer', 'supply-dispense', () => runTransferExclusive(async () => {
        latestCollection ??= await readCollectionCache(collectionCachePath)
        if (!latestCollection) throw new Error('Build the game-data index before dispensing augments.')
        const result = await executeLiveAugmentDispense(
          helper,
          database,
          latestCollection,
          input.records,
          input.expectedCharacterName
        )
        queueArchiveBackup('supply delivery')
        return result
      }), { requestedItems: input.records.length }, (completed) => ({ deliveredItems: completed.dispensed.length }))
  )
  ipcMain.handle(
    IPC_CHANNELS.recoverSahdinasMemento,
    (_event, input: { destination: SpecialRecoveryDestination; expectedCharacterName?: string }): Promise<SpecialItemRecoveryResult> =>
      runDiagnosticOperation('transfer', 'special-item-recovery', () => runTransferExclusive(async () => {
        latestCollection ??= await readCollectionCache(collectionCachePath)
        if (!latestCollection) throw new Error('Build the game-data index before recovering Sahdina\'s Memento.')
        const result = await executeSahdinasMementoRecovery(
          helper,
          database,
          latestCollection,
          input.destination,
          input.expectedCharacterName
        )
        queueArchiveBackup('special item recovery')
        return result
      }), { destination: input.destination }, () => ({ deliveredItems: 1 }))
  )
  return async () => {
    await writeQueue
    await archiveBackups.flush()
    diagnostics.info('startup', 'application.shutdown')
    await diagnostics.flush()
  }
}

function createScreenshotCollectionFixture(name: string): CollectionSnapshot {
  if (name === 'onboarding') return createScreenshotCollectionFixture('search-help')
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
        availableCount: 2, discovered: true, setPresentation, visual: true
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
        availableCount: 1, discovered: true
      }),
      createScreenshotSetItem({
        record: 'records/items/synthetic/warden_step.dbr', name: "Warden's Step", rarity: 'epic',
        slot: 'feet', level: 50, setName: "Warden's Vigil", setRecord: 'records/items/synthetic/warden_set.dbr',
        availableCount: 1, discovered: true
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
    bestRollPercentile: null,
    analyzedCopyCount: 0,
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
      throw new Error('Cairn could not identify the active character well enough to resolve Hardcore or Softcore mode.')
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
        `Cairn found both Hardcore and Softcore saves named “${activeCharacterName}”. Rename one before using live recovery.`
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
    throw new Error('Cairn could not identify the active character. Reopen the Supplies view and try again.')
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
          `Cairn found both Hardcore and Softcore saves named “${activeCharacterName}”. Wait for the game-mode handshake or rename one before dispensing.`
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
    throw new Error(`Cairn could not resolve whether “${activeCharacterName}” is Hardcore or Softcore.`)
  }

  const catalog = new Map(
    (collection.supplies ?? [])
      .filter((item) => item.slot === 'augment')
      .map((item) => [item.record.toLocaleLowerCase(), item])
  )
  const selected = uniqueRecords.map((record) => {
    const item = catalog.get(record)
    if (!item) throw new Error(`The selected record is not a catalogued faction augment: ${record}`)
    const requirements = item.acquisition?.factions ?? []
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
      throw new Error(`Timed out waiting for Grim Dawn to acknowledge ${pending.size} personal-inventory ${pending.size === 1 ? 'delivery' : 'deliveries'}. Do not retry until Cairn resolves the pending queue.`)
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
  const extraction = await helper.request<ItemIconExtractionResult>('extract-item-icons', {
    installationPath: installation.path,
    outputDirectory: join(app.getPath('userData'), 'item-icons'),
    bitmaps
  })
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
  cachePath: string,
  installationPath: string,
  force = false
): Promise<MapLocationIndex> {
  if (!force) {
    const cached = await readMapLocationIndex(cachePath)
    if (cached && (await mapLocationIndexIsFresh(cached))) return cached
  }
  const rebuilt = await helper.request<MapLocationIndex>('build-map-location-index', {
    installationPath
  })
  await writeJsonCache(cachePath, rebuilt)
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
      )
    ) {
      throw new Error('Set presentation omitted flat damage, skill bonuses, or granted skills.')
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
        new Error('Simulated Cairn exit after queueing.')
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
        throw new Error('A deposited retrieval did not reconcile after a simulated Cairn restart.')
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
      'The staging tab contains items that Cairn cannot archive: ' +
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
  if (process.env.ELECTRON_RENDERER_URL) {
    const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL)
    for (const [key, value] of Object.entries(recoveryQuery)) rendererUrl.searchParams.set(key, value)
    void window.loadURL(rendererUrl.toString())
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { query: recoveryQuery })
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
         Boolean(document.querySelector('.catalog-grid, .set-grid'))) &&
         (!document.querySelector('.primary-action')?.disabled ||
          Boolean(document.querySelector('.workspace-error, .root-recovery, .safe-mode-offer')) ||
          Boolean(document.querySelector('.background-scan'))) &&
         (${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_WAIT_FOR_SCAN === '1')}
           ? !document.querySelector('.background-scan')
           : true)`
      )
      if (ready) {
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
        const category = process.env.CAIRN_CODEX_SCREENSHOT_CATEGORY
        if (category) {
          interactionTimings.categoryMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              await new Promise((resolve) => setTimeout(resolve, 100))
              document.querySelector('.onboarding-skip')?.click()
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              ;[...document.querySelectorAll('.workspace-tabs button, .category-tabs button, .system-nav button')]
                .find((button) =>
                  (button.querySelector('span')?.textContent ?? button.textContent)?.trim() === ${JSON.stringify(category)})
                ?.click()
              await new Promise((resolve) => setTimeout(resolve, 100))
              return performance.now() - started
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
              const card = document.querySelector('.item-card[role=button], .set-card li button, .planner-table tbody tr, .atlas-item-list button')
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
          vaultRows: document.querySelectorAll('.vault-item-list .vault-row').length,
          operationRows: document.querySelectorAll('.operation-history-row').length,
          miRows: [...document.querySelectorAll('.mi-table tbody tr')].map((row) => ({
            text: row.textContent?.replace(/\s+/g, ' ').trim(),
            prefixClass: row.children[2]?.className,
            suffixClass: row.children[3]?.className
          })),
          miQuery: document.querySelector('.mi-workshop-search input')?.value,
          miAffixFilter: document.querySelector('.mi-workshop-controls select')?.value,
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
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
}

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
  const flushIpcWrites = registerIpcHandlers(helper, database, archiveBackups, diagnostics, startupRecovery)
  diagnostics.info('startup', 'ipc.registered')
  console.log('[startup] IPC handlers registered; creating the main window.')
  void createWindow(startupRecoveryStatus)
  void archiveBackups.ensureStartupBackup()
    .then((backup) => {
      if (backup) console.log(`[archive-backup] verified ${backup.fileName}`)
    })
    .catch((error) => console.error('[archive-backup] automatic daily backup failed', error))

  let shutdownReady = false
  app.on('before-quit', (event) => {
    if (shutdownReady) return
    event.preventDefault()
    void flushIpcWrites()
      .catch((error) => console.error('[shutdown] queued archive work failed', error))
      .finally(async () => {
        if (!rendererProcessFailed) {
          await startupRecovery.markHealthy().catch((error) => {
            diagnostics.error('recovery', 'startup-health.shutdown-persist-failed', error)
          })
        }
        helper.dispose()
        database.close()
        shutdownReady = true
        app.quit()
      })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow(startupRecovery.getStatus())
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
