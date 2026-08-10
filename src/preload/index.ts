import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type AppStatus,
  type CairnCodexApi,
  type CollectionSnapshot,
  type GrimDawnDiscovery
} from '@shared/contracts'

const api: CairnCodexApi = {
  getAppStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getAppStatus) as Promise<AppStatus>,
  discoverGrimDawn: () =>
    ipcRenderer.invoke(IPC_CHANNELS.discoverGrimDawn) as Promise<GrimDawnDiscovery>,
  scanCollection: () =>
    ipcRenderer.invoke(IPC_CHANNELS.scanCollection) as Promise<CollectionSnapshot>,
  setPinnedBest: (record, instanceKey) =>
    ipcRenderer.invoke(IPC_CHANNELS.setPinnedBest, { record, instanceKey }) as Promise<void>
}

contextBridge.exposeInMainWorld('cairnCodex', api)
