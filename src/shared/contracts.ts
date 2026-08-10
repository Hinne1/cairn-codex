export const IPC_CHANNELS = {
  getAppStatus: 'app:get-status'
} as const

export interface AppStatus {
  appVersion: string
  helper: 'not-configured' | 'available' | 'unavailable'
  mode: 'read-only'
}

export interface CairnCodexApi {
  getAppStatus: () => Promise<AppStatus>
}
