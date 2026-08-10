import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type AppStatus,
  type CairnCodexApi
} from '@shared/contracts'

const api: CairnCodexApi = {
  getAppStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getAppStatus) as Promise<AppStatus>
}

contextBridge.exposeInMainWorld('cairnCodex', api)
