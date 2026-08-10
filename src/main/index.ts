import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import {
  IPC_CHANNELS,
  type AppStatus,
  type CollectionSnapshot,
  type GrimDawnDiscovery
} from '@shared/contracts'
import { GrimDawnHelperClient } from './grim-dawn/helper-client'
import { CollectionDatabase } from './collection-database'

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

function registerIpcHandlers(helper: GrimDawnHelperClient, database: CollectionDatabase): void {
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
  ipcMain.handle(
    IPC_CHANNELS.scanCollection,
    async (): Promise<CollectionSnapshot> => {
      const snapshot = await helper.request<CollectionSnapshot>('scan-collection')
      return database.persistSnapshot(snapshot)
    }
  )
}

async function runSmokeTest(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase
): Promise<void> {
  try {
    await helper.request('health')
    const writeTransaction = await helper.request<{ passed: boolean }>('self-test-write-transaction')
    if (!writeTransaction.passed) {
      throw new Error('Verified write transaction self-test failed.')
    }
    const helperSnapshot = await helper.request<CollectionSnapshot>('scan-collection')
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
    const snapshot = database.persistSnapshot(helperSnapshot)
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
    console.log(
      JSON.stringify({
        helper: 'available',
        writeTransaction: 'verified',
        serializerRoundTrips: roundTrips.length,
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
  const database = new CollectionDatabase(
    process.env.CAIRN_CODEX_SMOKE_TEST === '1'
      ? ':memory:'
      : join(app.getPath('userData'), 'cairn-codex.sqlite3')
  )

  if (process.env.CAIRN_CODEX_SMOKE_TEST === '1') {
    void runSmokeTest(helper, database)
    return
  }

  registerIpcHandlers(helper, database)
  createWindow()

  app.once('before-quit', () => {
    helper.dispose()
    database.close()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
