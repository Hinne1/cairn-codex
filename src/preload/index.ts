import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type AppStatus,
  type CairnCodexApi,
  type CollectionSnapshot,
  type GrimDawnDiscovery,
  type IngestResult,
  type RetrievalResult,
  type StagingTabInspection,
  type VaultListItem,
  type WriteSafetyStatus
} from '@shared/contracts'

const api: CairnCodexApi = {
  getAppStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getAppStatus) as Promise<AppStatus>,
  setZoomFactor: (factor) =>
    ipcRenderer.invoke(IPC_CHANNELS.setZoomFactor, { factor }) as Promise<number>,
  getCachedCollection: (sourcePaths, basis) =>
    ipcRenderer.invoke(IPC_CHANNELS.getCachedCollection, { sourcePaths, basis }) as Promise<CollectionSnapshot | null>,
  discoverGrimDawn: () =>
    ipcRenderer.invoke(IPC_CHANNELS.discoverGrimDawn) as Promise<GrimDawnDiscovery>,
  scanCollection: (sourcePaths, basis) =>
    ipcRenderer.invoke(IPC_CHANNELS.scanCollection, { sourcePaths, basis }) as Promise<CollectionSnapshot>,
  setPinnedBest: (record, instanceKey, isHardcore) =>
    ipcRenderer.invoke(IPC_CHANNELS.setPinnedBest, { record, instanceKey, isHardcore }) as Promise<void>,
  inspectWriteSafety: () =>
    ipcRenderer.invoke(IPC_CHANNELS.inspectWriteSafety) as Promise<WriteSafetyStatus>,
  inspectStagingTab: (path) =>
    ipcRenderer.invoke(IPC_CHANNELS.inspectStagingTab, { path }) as Promise<StagingTabInspection>,
  listVaultItems: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listVaultItems) as Promise<VaultListItem[]>,
  ingestStagingTab: (path) =>
    ipcRenderer.invoke(IPC_CHANNELS.ingestStagingTab, { path }) as Promise<IngestResult>,
  retrieveVaultItems: (path, vaultItemIds) =>
    ipcRenderer.invoke(IPC_CHANNELS.retrieveVaultItems, { path, vaultItemIds }) as Promise<RetrievalResult>
}

contextBridge.exposeInMainWorld('cairnCodex', api)
