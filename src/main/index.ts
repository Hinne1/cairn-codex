import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS, type AppStatus } from '@shared/contracts'

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getAppStatus, (): AppStatus => ({
    appVersion: app.getVersion(),
    helper: 'not-configured',
    mode: 'read-only'
  }))
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#10100f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
