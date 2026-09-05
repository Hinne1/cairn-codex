import { contextBridge, ipcRenderer as electronIpcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type AppStatus,
  type ArchiveRollHydrationResult,
  type ArchiveBackupActionResult,
  type ArchiveBackupStatus,
  type CairnCodexApi,
  type CharacterSaveProfile,
  type CollectionSnapshot,
  type DiagnosticExportResult,
  type DismantlingPreview,
  type DebugLoggingStatus,
  type GdiaImportProgress,
  type GdiaImportResult,
  type GrimDawnDiscovery,
  type IngestResult,
  type LiveGameStatus,
  type LiveGameSyncResult,
  type LiveRetrievalResult,
  type LiveSupplyDispenseResult,
  type OperationHistoryPage,
  type OperationHistoryRequest,
  type PreferenceBootstrapResult,
  type PreferenceLoadReport,
  type SpecialItemRecoveryResult,
  type RetrievalResult,
  type RecoveryStatus,
  type RendererErrorReport,
  type StagingTabInspection,
  type StartupPhaseEvent,
  type StartupStatus,
  type VaultListItem,
  type VaultItemPage,
  type VaultPageRequest,
  type VaultSummary,
  type WriteSafetyStatus
} from '@shared/contracts'
import type { AnyBackgroundJobSnapshot } from '@shared/background-jobs'
import type { DismantlingPage, DismantlingSelection, SupplyPage, SupplySelection } from '@shared/workspace-query-contracts'
import { decodeIpcError } from '@shared/ipc-error-transport'

const ipcRenderer = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> =>
    electronIpcRenderer.invoke(channel, ...args).catch((error: unknown) => {
      throw decodeIpcError(error) ?? error
    }),
  on: electronIpcRenderer.on.bind(electronIpcRenderer),
  removeListener: electronIpcRenderer.removeListener.bind(electronIpcRenderer)
}

const api: CairnCodexApi = {
  onArchiveRecoveryChanged: (listener) => {
    const handler = (): void => listener()
    ipcRenderer.on(IPC_CHANNELS.archiveRecoveryChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.archiveRecoveryChanged, handler)
  },
  getBackgroundJobs: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getBackgroundJobs) as Promise<AnyBackgroundJobSnapshot[]>,
  cancelBackgroundJob: (id) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelBackgroundJob, { id }) as Promise<AnyBackgroundJobSnapshot | null>,
  onBackgroundJobChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, job: AnyBackgroundJobSnapshot): void => listener(job)
    ipcRenderer.on(IPC_CHANNELS.backgroundJobChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.backgroundJobChanged, handler)
  },
  getAppStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getAppStatus) as Promise<AppStatus>,
  setZoomFactor: (factor) =>
    ipcRenderer.invoke(IPC_CHANNELS.setZoomFactor, { factor }) as Promise<number>,
  exportDiagnostics: () =>
    ipcRenderer.invoke(IPC_CHANNELS.exportDiagnostics) as Promise<DiagnosticExportResult>,
  openDataDirectory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.openDataDirectory) as Promise<string>,
  getArchiveBackupStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getArchiveBackupStatus) as Promise<ArchiveBackupStatus>,
  createArchiveBackup: () =>
    ipcRenderer.invoke(IPC_CHANNELS.createArchiveBackup) as Promise<ArchiveBackupActionResult>,
  exportArchiveBackup: () =>
    ipcRenderer.invoke(IPC_CHANNELS.exportArchiveBackup) as Promise<ArchiveBackupActionResult>,
  restoreArchiveBackup: () =>
    ipcRenderer.invoke(IPC_CHANNELS.restoreArchiveBackup) as Promise<ArchiveBackupActionResult>,
  openArchiveBackupDirectory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.openArchiveBackupDirectory) as Promise<string>,
  importGdiaDatabase: () =>
    ipcRenderer.invoke(IPC_CHANNELS.importGdiaDatabase) as Promise<GdiaImportResult>,
  getLastGdiaImportResult: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getLastGdiaImportResult) as Promise<GdiaImportResult | null>,
  getGdiaImportProgress: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getGdiaImportProgress) as Promise<GdiaImportProgress | null>,
  onGdiaImportProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: GdiaImportProgress): void => listener(progress)
    ipcRenderer.on(IPC_CHANNELS.gdiaImportProgress, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.gdiaImportProgress, handler)
  },
  getRecoveryStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getRecoveryStatus) as Promise<RecoveryStatus>,
  getCachedCollection: (sourcePaths, basis) =>
    ipcRenderer.invoke(IPC_CHANNELS.getCachedCollection, { sourcePaths, basis }) as Promise<CollectionSnapshot | null>,
  hydrateArchiveRolls: (sourcePaths) =>
    ipcRenderer.invoke(IPC_CHANNELS.hydrateArchiveRolls, { sourcePaths }) as Promise<ArchiveRollHydrationResult | null>,
  discoverGrimDawn: () =>
    ipcRenderer.invoke(IPC_CHANNELS.discoverGrimDawn) as Promise<GrimDawnDiscovery>,
  listCharacters: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listCharacters) as Promise<CharacterSaveProfile[]>,
  scanCollection: (sourcePaths, basis) =>
    ipcRenderer.invoke(IPC_CHANNELS.scanCollection, { sourcePaths, basis }) as Promise<CollectionSnapshot>,
  rebuildGameDataIndex: (sourcePaths, basis) =>
    ipcRenderer.invoke(IPC_CHANNELS.rebuildGameDataIndex, { sourcePaths, basis }) as Promise<CollectionSnapshot>,
  setPinnedBest: (record, instanceKey, isHardcore) =>
    ipcRenderer.invoke(IPC_CHANNELS.setPinnedBest, { record, instanceKey, isHardcore }) as Promise<void>,
  setFavoriteItem: (instanceKey, isHardcore, favorite) =>
    ipcRenderer.invoke(IPC_CHANNELS.setFavoriteItem, { instanceKey, isHardcore, favorite }) as Promise<void>,
  getInfiniteSupplies: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getInfiniteSupplies) as Promise<boolean>,
  setInfiniteSupplies: (enabled) =>
    ipcRenderer.invoke(IPC_CHANNELS.setInfiniteSupplies, { enabled }) as Promise<boolean>,
  getDebugLogging: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getDebugLogging) as Promise<DebugLoggingStatus>,
  setDebugLogging: (enabled) =>
    ipcRenderer.invoke(IPC_CHANNELS.setDebugLogging, { enabled }) as Promise<DebugLoggingStatus>,
  recordNavigation: (view) =>
    ipcRenderer.invoke(IPC_CHANNELS.recordNavigation, { view }) as Promise<void>,
  reportRendererError: (report: RendererErrorReport) =>
    ipcRenderer.invoke(IPC_CHANNELS.reportRendererError, report) as Promise<void>,
  reportPreferenceLoad: (report: PreferenceLoadReport) =>
    ipcRenderer.invoke(IPC_CHANNELS.reportPreferenceLoad, report) as Promise<void>,
  loadPreferences: (origin, candidateSerialized) =>
    ipcRenderer.invoke(IPC_CHANNELS.loadPreferences, { origin, candidateSerialized }) as Promise<PreferenceBootstrapResult>,
  savePreferences: (serialized) =>
    ipcRenderer.invoke(IPC_CHANNELS.savePreferences, { serialized }) as Promise<void>,
  exportPreferences: (serialized) =>
    ipcRenderer.invoke(IPC_CHANNELS.exportPreferences, { serialized }) as Promise<DiagnosticExportResult>,
  getStartupStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getStartupStatus) as Promise<StartupStatus>,
  reportStartupPhase: (phase: StartupPhaseEvent) =>
    ipcRenderer.invoke(IPC_CHANNELS.reportStartupPhase, { phase }) as Promise<StartupStatus>,
  restartInSafeMode: () =>
    ipcRenderer.invoke(IPC_CHANNELS.restartInSafeMode) as Promise<void>,
  restartNormally: () =>
    ipcRenderer.invoke(IPC_CHANNELS.restartNormally) as Promise<void>,
  inspectWriteSafety: () =>
    ipcRenderer.invoke(IPC_CHANNELS.inspectWriteSafety) as Promise<WriteSafetyStatus>,
  inspectStagingTab: (path) =>
    ipcRenderer.invoke(IPC_CHANNELS.inspectStagingTab, { path }) as Promise<StagingTabInspection>,
  listVaultItems: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listVaultItems) as Promise<VaultListItem[]>,
  queryVaultItems: (request: VaultPageRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.queryVaultItems, request) as Promise<VaultItemPage>,
  querySupplies: request => ipcRenderer.invoke(IPC_CHANNELS.querySupplies, request) as Promise<SupplyPage>,
  selectSupplyBoosts: request => ipcRenderer.invoke(IPC_CHANNELS.selectSupplyBoosts, request) as Promise<SupplySelection>,
  queryDismantling: request => ipcRenderer.invoke(IPC_CHANNELS.queryDismantling, request) as Promise<DismantlingPage>,
  selectDismantlingDuplicates: request => ipcRenderer.invoke(IPC_CHANNELS.selectDismantlingDuplicates, request) as Promise<DismantlingSelection>,
  queryOperationHistory: (request: OperationHistoryRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.queryOperationHistory, request) as Promise<OperationHistoryPage>,
  getVaultSummary: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getVaultSummary) as Promise<VaultSummary>,
  previewDismantling: (vaultItemIds) =>
    ipcRenderer.invoke(IPC_CHANNELS.previewDismantling, { vaultItemIds }) as Promise<DismantlingPreview>,
  ingestStagingTab: (path) =>
    ipcRenderer.invoke(IPC_CHANNELS.ingestStagingTab, { path }) as Promise<IngestResult>,
  retrieveVaultItems: (path, vaultItemIds) =>
    ipcRenderer.invoke(IPC_CHANNELS.retrieveVaultItems, { path, vaultItemIds }) as Promise<RetrievalResult>,
  inspectLiveGame: () =>
    ipcRenderer.invoke(IPC_CHANNELS.inspectLiveGame) as Promise<LiveGameStatus>,
  approveLiveGameBuild: () =>
    ipcRenderer.invoke(IPC_CHANNELS.approveLiveGameBuild) as Promise<LiveGameStatus>,
  startLiveGame: () =>
    ipcRenderer.invoke(IPC_CHANNELS.startLiveGame) as Promise<LiveGameStatus>,
  stopLiveGame: () =>
    ipcRenderer.invoke(IPC_CHANNELS.stopLiveGame) as Promise<LiveGameStatus>,
  syncLiveGame: () =>
    ipcRenderer.invoke(IPC_CHANNELS.syncLiveGame) as Promise<LiveGameSyncResult>,
  retrieveLiveVaultItems: (vaultItemIds) =>
    ipcRenderer.invoke(IPC_CHANNELS.retrieveLiveVaultItems, { vaultItemIds }) as Promise<LiveRetrievalResult>,
  dispenseLiveAugments: (records, expectedCharacterName) =>
    ipcRenderer.invoke(IPC_CHANNELS.dispenseLiveAugments, { records, expectedCharacterName }) as Promise<LiveSupplyDispenseResult>,
  recoverSahdinasMemento: (destination, expectedCharacterName) =>
    ipcRenderer.invoke(IPC_CHANNELS.recoverSahdinasMemento, { destination, expectedCharacterName }) as Promise<SpecialItemRecoveryResult>
}

contextBridge.exposeInMainWorld('cairnCodex', api)
