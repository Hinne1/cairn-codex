import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS, type AppStatus, type GrimDawnDiscovery } from '@shared/contracts'
import { GrimDawnHelperClient } from './grim-dawn/helper-client'

function createHelperClient(): GrimDawnHelperClient {
  if (app.isPackaged) {
    return new GrimDawnHelperClient({
      command: join(process.resourcesPath, 'helper', 'CairnCodex.GrimDawn.exe'),
      args: []
    })
  }

  return new GrimDawnHelperClient({
    command: 'dotnet',
    args: [
      join(
        app.getAppPath(),
        'src',
        'helper',
        'CairnCodex.GrimDawn',
        'bin',
        'Debug',
        'net10.0-windows',
        'CairnCodex.GrimDawn.dll'
      )
    ]
  })
}

function registerIpcHandlers(helper: GrimDawnHelperClient): void {
  ipcMain.handle(IPC_CHANNELS.getAppStatus, async (): Promise<AppStatus> => {
    try {
      await helper.request('health')
      return { appVersion: app.getVersion(), helper: 'available', mode: 'read-only' }
    } catch {
      return { appVersion: app.getVersion(), helper: 'unavailable', mode: 'read-only' }
    }
  })
  ipcMain.handle(
    IPC_CHANNELS.discoverGrimDawn,
    (): Promise<GrimDawnDiscovery> => helper.request<GrimDawnDiscovery>('discover-grim-dawn')
  )
}

async function runSmokeTest(helper: GrimDawnHelperClient): Promise<void> {
  try {
    await helper.request('health')
    const discovery = await helper.request<GrimDawnDiscovery>('discover-grim-dawn')
    const stashCount = discovery.saveLocations.reduce(
      (count, location) => count + location.transferStashes.length,
      0
    )
    console.log(
      JSON.stringify({
        helper: 'available',
        installations: discovery.installations.length,
        saveLocations: discovery.saveLocations.length,
        transferStashes: stashCount
      })
    )
    helper.dispose()
    app.exit(0)
  } catch (error) {
    console.error(error)
    helper.dispose()
    app.exit(1)
  }
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
  const helper = createHelperClient()

  if (process.env.CAIRN_CODEX_SMOKE_TEST === '1') {
    void runSmokeTest(helper)
    return
  }

  registerIpcHandlers(helper)
  createWindow()

  app.once('before-quit', () => helper.dispose())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
