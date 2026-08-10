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
  discoverGrimDawn: () =>
    ipcRenderer.invoke(IPC_CHANNELS.discoverGrimDawn) as Promise<GrimDawnDiscovery>,
  scanCollection: () =>
    ipcRenderer.invoke(IPC_CHANNELS.scanCollection) as Promise<CollectionSnapshot>,
  setPinnedBest: (record, instanceKey) =>
    ipcRenderer.invoke(IPC_CHANNELS.setPinnedBest, { record, instanceKey }) as Promise<void>,
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
