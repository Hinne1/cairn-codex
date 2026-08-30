import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type AppStatus,
  type CairnCodexApi,
  type CharacterSaveProfile,
  type CollectionSnapshot,
  type DiagnosticExportResult,
  type GdiaImportResult,
  type GrimDawnDiscovery,
  type IngestResult,
  type LiveGameStatus,
  type LiveGameSyncResult,
  type LiveRetrievalResult,
  type LiveSupplyDispenseResult,
  type SpecialItemRecoveryResult,
  type RetrievalResult,
  type RecoveryStatus,
  type StagingTabInspection,
  type VaultListItem,
  type WriteSafetyStatus
} from '@shared/contracts'

const api: CairnCodexApi = {
  getAppStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getAppStatus) as Promise<AppStatus>,
  setZoomFactor: (factor) =>
    ipcRenderer.invoke(IPC_CHANNELS.setZoomFactor, { factor }) as Promise<number>,
  exportDiagnostics: () =>
    ipcRenderer.invoke(IPC_CHANNELS.exportDiagnostics) as Promise<DiagnosticExportResult>,
  openDataDirectory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.openDataDirectory) as Promise<string>,
  importGdiaDatabase: () =>
    ipcRenderer.invoke(IPC_CHANNELS.importGdiaDatabase) as Promise<GdiaImportResult>,
  getRecoveryStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getRecoveryStatus) as Promise<RecoveryStatus>,
  getCachedCollection: (sourcePaths, basis) =>
    ipcRenderer.invoke(IPC_CHANNELS.getCachedCollection, { sourcePaths, basis }) as Promise<CollectionSnapshot | null>,
  hydrateArchiveRolls: (sourcePaths) =>
    ipcRenderer.invoke(IPC_CHANNELS.hydrateArchiveRolls, { sourcePaths }) as Promise<CollectionSnapshot | null>,
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
  getInfiniteSupplies: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getInfiniteSupplies) as Promise<boolean>,
  setInfiniteSupplies: (enabled) =>
    ipcRenderer.invoke(IPC_CHANNELS.setInfiniteSupplies, { enabled }) as Promise<boolean>,
  inspectWriteSafety: () =>
    ipcRenderer.invoke(IPC_CHANNELS.inspectWriteSafety) as Promise<WriteSafetyStatus>,
  inspectStagingTab: (path) =>
    ipcRenderer.invoke(IPC_CHANNELS.inspectStagingTab, { path }) as Promise<StagingTabInspection>,
  listVaultItems: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listVaultItems) as Promise<VaultListItem[]>,
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
