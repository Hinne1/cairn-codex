import { join } from 'node:path'
import { createHash, randomInt, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { arch, platform, release } from 'node:os'
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, screen, shell } from 'electron'
import {
  IPC_CHANNELS,
  type ArchiveBackupActionResult,
  type AppStatus,
  type CharacterSaveProfile,
  type CollectionBasis,
  type CollectionSnapshot,
  type GrimDawnDiscovery,
  type GdiaImportResult,
  type IngestResult,
  type ItemRollAnalysis,
  type LiveGameStatus,
  type LiveGameSyncResult,
  type LiveRetrievalResult,
  type LiveSupplyDispenseResult,
  type SpecialItemRecoveryResult,
  type SpecialRecoveryDestination,
  type MapRegionLocation,
  type RetrievalResult,
  type ObservedStashItem,
  type StagingTabInspection,
  type VaultListItem,
  type WriteSafetyStatus
} from '@shared/contracts'
import {
  isCollectionOwned,
  withAwakeningAvailability
} from '@shared/collection-availability'
import { GrimDawnHelperClient } from './grim-dawn/helper-client'
import {
  CollectionDatabase,
  type ResolvedArchiveCatalogItem
} from './collection-database'
import { migrateGdiaDatabase } from './gdia-migration'
import { ArchiveBackupService } from './archive-backup'

// Packaged GUI launches do not always have a durable console attached. Electron's
// child processes can outlive a terminal or diagnostic launcher and inherit its
// now-closed pipe; without an error listener, a later console.warn/error turns a
// harmless logging failure into a main-process EPIPE crash dialog.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', () => {
    // Application logging is best-effort. Runtime errors are surfaced in the UI.
  })
}

const CATALOG_PRESENTATION_VERSION = 31
const ROLL_ANALYSIS_VERSION = 4
const collectionRarities = ['epic', 'legendary', 'mi'] as const
const SAHDINAS_MEMENTO = {
  record: 'records/items/gearaccessories/necklaces/b100_necklace_sahdina.dbr',
  name: "Sahdina's Memento"
} as const

interface IngestCommand {
  path: string
  expectedSourceSha256: string
  items: Array<{ tabIndex: number; itemIndex: number; expectedSeed: number }>
}

interface PersistedWindowState {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

interface MapLocationIndex {
  version: number
  builtAt: string
  archives: Array<{ path: string; length: number; lastWriteUtc: string }>
  regionCount: number
  placedRecordCount: number
  sourceLocations: Record<string, MapRegionLocation[]>
  miTierCount: number
  locatedMiTierCount: number
  unlocatedMiBases: string[]
}

interface IngestPlan {
  path: string
  sourceSha256: string
  sourceItemCount: number
  replacementItemCount: number
  replacementSha256: string
  semanticallyValid: boolean
  idempotent: boolean
  items: Array<{ baseRecord: string; seed: number; [key: string]: unknown }>
}

interface CommittedIngest {
  plan: IngestPlan
  transaction: {
    backupPath: string
    rollbackPath: string
    sourceSha256: string
    committedSha256: string
  }
}

interface RetrievalCommand {
  path: string
  expectedSourceSha256: string
  targetTabIndex: number
  vaultItemIds: string[]
}

interface RetrievalPlanCommand {
  path: string
  targetTabIndex: number
  vaultItemIds: string[]
}

interface RetrievalPlan {
  path: string
  sourceSha256: string
  targetTabIndex: number
  sourceItemCount: number
  replacementItemCount: number
  replacementSha256: string
  restoredExactly: boolean
  semanticallyValid: boolean
  idempotent: boolean
  items: Array<{ baseRecord: string; seed: number }>
}

interface CommittedRetrieval {
  plan: RetrievalPlan
  transaction: {
    backupPath: string
    rollbackPath: string
    sourceSha256: string
    committedSha256: string
  }
}

interface TransferStashScan {
  path: string
  sha256: string
  itemCount: number
  tabs: Array<{
    index: number
    items: Array<{
      tabIndex: number
      itemIndex: number
      baseRecord: string
      seed: number
    }>
  }>
}

interface ItemIconExtractionResult {
  icons: Array<{ bitmap: string; key: string }>
  missing: string[]
  failures: Array<{ bitmap: string; error: string }>
}

interface LiveVaultPayload {
  stashVersion: number
  sourceTabIndex: number
  sourceItemIndex: number
  baseRecord: string
  prefixRecord: string
  suffixRecord: string
  modifierRecord: string
  transmuteRecord: string
  seed: number
  materiaRecord: string
  relicCompletionBonusRecord: string
  relicSeed: number
  enchantmentRecord: string
  ascendantRecord: string
  ascendantRecord2H: string
  unknown: number
  enchantmentSeed: number
  materiaCombines: number
  stackCount: number
  rerolls: number
  affixRerolls: number
  xOffset: number
  yOffset: number
}

interface LiveIncomingItem {
  path: string
  sha256: string
  isHardcore: boolean
  item: LiveVaultPayload
  createdAtUtc: string
}

interface LiveQueueReceipt {
  sha256: string
  receiptPath: string
}

interface LiveRetrievalQueue {
  operationId: string
  outgoingPath: string
  semanticSha256: string
  isHardcore: boolean
  baselineDeleted: string[]
  baselineIncoming: string[]
}

interface LiveRetrievalStatus {
  state: 'pending' | 'deposited' | 'rejected' | 'unknown'
  receiptPath: string | null
}

function isHardcoreStashPath(path: string): boolean {
  return path.toLocaleLowerCase().endsWith('.gsh')
}

async function countFiles(directory: string): Promise<number> {
  try {
    let count = 0
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      count += entry.isDirectory() ? await countFiles(join(directory, entry.name)) : 1
    }
    return count
  } catch {
    return 0
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cairn-icon',
    privileges: { standard: true, secure: true, supportFetchAPI: true }
  }
])

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

function registerIpcHandlers(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  archiveBackups: ArchiveBackupService
): () => Promise<void> {
  let writeQueue: Promise<void> = Promise.resolve()
  let latestCollection: CollectionSnapshot | null = null
  let collectionScan: Promise<CollectionSnapshot> | null = null
  const collectionCachePath = join(app.getPath('userData'), 'collection-snapshot.json')
  const mapLocationCachePath = join(app.getPath('userData'), 'map-location-index.json')
  const runExclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writeQueue.then(operation, operation)
    writeQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
  const runTransferExclusive = <T>(operation: () => Promise<T>): Promise<T> =>
    runExclusive(async () => {
      const unresolved = database.getRecoveryOperationCount()
      if (unresolved > 0) {
        throw new Error(
          `${unresolved} earlier transfer operation${unresolved === 1 ? '' : 's'} require recovery attention. ` +
          'Pause writes, export diagnostics in Settings, and audit the retained journal and receipts first.'
        )
      }
      return operation()
    })
  const queueArchiveBackup = (reason: string): void => {
    void runExclusive(() => archiveBackups.createBackup(reason)).catch((error) => {
      console.error(`[archive-backup] ${reason} failed`, error)
    })
  }

  ipcMain.handle(IPC_CHANNELS.getAppStatus, async (): Promise<AppStatus> => {
    try {
      await helper.request('health')
      return { appVersion: app.getVersion(), helper: 'available', mode: 'read-only' }
    } catch {
      return { appVersion: app.getVersion(), helper: 'unavailable', mode: 'read-only' }
    }
  })
  ipcMain.handle(IPC_CHANNELS.openDataDirectory, async (): Promise<string> => {
    return shell.openPath(app.getPath('userData'))
  })
  ipcMain.handle(IPC_CHANNELS.getArchiveBackupStatus, () => archiveBackups.getStatus())
  ipcMain.handle(
    IPC_CHANNELS.createArchiveBackup,
    async (): Promise<ArchiveBackupActionResult> => ({
      canceled: false,
      backup: await runExclusive(() => archiveBackups.createBackup('manual backup')),
      path: null,
      restarting: false
    })
  )
  ipcMain.handle(
    IPC_CHANNELS.exportArchiveBackup,
    async (): Promise<ArchiveBackupActionResult> => {
      const stamp = new Date().toISOString().slice(0, 10)
      const selection = await dialog.showSaveDialog({
        title: 'Export Cairn Codex archive backup',
        defaultPath: join(app.getPath('documents'), `cairn-codex-archive-${stamp}.sqlite3`),
        filters: [{ name: 'Cairn Codex archive', extensions: ['sqlite3'] }]
      })
      if (selection.canceled || !selection.filePath) {
        return { canceled: true, backup: null, path: null, restarting: false }
      }
      const backup = await runExclusive(() => archiveBackups.exportBackup(selection.filePath!))
      return {
        canceled: false,
        backup,
        path: selection.filePath,
        restarting: false
      }
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.restoreArchiveBackup,
    async (): Promise<ArchiveBackupActionResult> => {
      const unresolved = database.getRecoveryOperationCount()
      if (unresolved > 0) {
        throw new Error(
          `${unresolved} transfer operation${unresolved === 1 ? '' : 's'} require recovery attention. ` +
          'Resolve or audit them before restoring the archive.'
        )
      }
      const selection = await dialog.showOpenDialog({
        title: 'Restore Cairn Codex archive backup',
        defaultPath: (await archiveBackups.getStatus()).backupDirectory,
        properties: ['openFile'],
        filters: [
          { name: 'Cairn Codex archive', extensions: ['sqlite3', 'sqlite', 'db'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
      const sourcePath = selection.filePaths[0]
      if (selection.canceled || !sourcePath) {
        return { canceled: true, backup: null, path: null, restarting: false }
      }
      const confirmation = await dialog.showMessageBox({
        type: 'warning',
        title: 'Restore Cairn Codex archive?',
        message: 'Cairn will verify this backup and restart to restore it.',
        detail:
          'Before replacement, Cairn will preserve the current archive as a verified emergency backup. ' +
          'Grim Dawn stash files are not changed.',
        buttons: ['Cancel', 'Restore and restart'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      if (confirmation.response !== 1) {
        return { canceled: true, backup: null, path: null, restarting: false }
      }
      const backup = await runExclusive(() => archiveBackups.stageRestore(sourcePath))
      setTimeout(() => {
        app.relaunch()
        app.quit()
      }, 100)
      return { canceled: false, backup, path: sourcePath, restarting: true }
    }
  )
  ipcMain.handle(IPC_CHANNELS.openArchiveBackupDirectory, async (): Promise<string> => {
    return shell.openPath((await archiveBackups.getStatus()).backupDirectory)
  })
  ipcMain.handle(IPC_CHANNELS.importGdiaDatabase, async (): Promise<GdiaImportResult> => {
    latestCollection ??= await readCollectionCache(collectionCachePath)
    if (!latestCollection) {
      throw new Error('Let Cairn finish its initial game-data scan before importing Item Assistant.')
    }
    const defaultDatabase = join(
      process.env.LOCALAPPDATA ?? app.getPath('appData'),
      'EvilSoft',
      'IAGD',
      'data',
      'userdata.db'
    )
    const selection = await dialog.showOpenDialog({
      title: 'Import Grim Dawn Item Assistant archive',
      defaultPath: defaultDatabase,
      properties: ['openFile'],
      filters: [
        { name: 'Item Assistant database', extensions: ['db', 'sqlite', 'sqlite3'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    const sourcePath = selection.filePaths[0]
    if (selection.canceled || !sourcePath) {
      return {
        canceled: true,
        sourcePath: null,
        sourceItems: 0,
        sourceDatabaseItems: 0,
        sourceQueueItems: 0,
        sourceHardcoreItems: 0,
        sourceSoftcoreItems: 0,
        importedItems: 0,
        duplicateItems: 0,
        unsupportedItems: 0,
        backupPath: null
      }
    }
    const result = await runExclusive(() => migrateGdiaDatabase(
      database,
      sourcePath,
      join(app.getPath('userData'), 'migrations', 'gdia'),
      { requireAllCatalogued: false }
    ))
    if (result.importedIds.length > 0) queueArchiveBackup('Item Assistant migration')
    return {
      canceled: false,
      sourcePath,
      sourceItems: result.sourceItems,
      sourceDatabaseItems: result.sourceDatabaseItems,
      sourceQueueItems: result.sourceQueueItems,
      sourceHardcoreItems: result.sourceHardcoreItems,
      sourceSoftcoreItems: result.sourceSoftcoreItems,
      importedItems: result.importedIds.length,
      duplicateItems: result.duplicateIds.length,
      unsupportedItems: result.unsupportedIds.length,
      backupPath: result.backupPath
    }
  })
  ipcMain.handle(IPC_CHANNELS.getRecoveryStatus, () => {
    const operations = database.getDiagnosticSummary().recoveryOperations
    return {
      requiresAttention: operations.length > 0,
      operations: operations.map((operation) => ({
        id: operation.id,
        operation: operation.operation,
        state: operation.state,
        startedAtUtc: operation.startedAtUtc,
        hasBackup: operation.hasBackup
      }))
    }
  })
  ipcMain.handle(IPC_CHANNELS.exportDiagnostics, async () => {
    const generatedAtUtc = new Date().toISOString()
    const fileStamp = generatedAtUtc.replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z')
    const selection = await dialog.showSaveDialog({
      title: 'Save Cairn Codex diagnostics',
      defaultPath: join(app.getPath('downloads'), `cairn-codex-diagnostics-${fileStamp}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (selection.canceled || !selection.filePath) return { canceled: true, path: null }

    const safely = async <T>(operation: () => Promise<T>): Promise<T | { error: string }> => {
      try {
        return await operation()
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }
    const userData = app.getPath('userData')
    const directoryCounts: Record<string, number> = {}
    for (const name of ['backups', 'live-receipts', 'live-adapter', 'quarantine']) {
      directoryCounts[name] = await countFiles(join(userData, name))
    }
    const live = await safely(() => helper.request<LiveGameStatus>('inspect-live-game'))
    const safeLive = 'error' in live ? live : {
      state: live.state,
      grimDawnProcessCount: live.grimDawnProcessIds.length,
      itemAssistantProcessCount: live.itemAssistantProcessIds.length,
      hookAvailable: live.hookAvailable,
      hookVersion: live.hookVersion,
      connected: live.connectedProcessId !== null,
      activeCharacterPresent: live.activeCharacterName !== null,
      isHardcore: live.isHardcore,
      hostWindowReady: live.hostWindowReady,
      gameVersion: live.gameVersion,
      gameBuildId: live.gameBuildId,
      gameDllSha256: live.gameDllSha256,
      gameDllLastWriteUtc: live.gameDllLastWriteUtc,
      hookSha256: live.hookSha256,
      recommendation: live.recommendation,
      hookMessageCount: live.messages.length
    }
    const report = {
      generatedAtUtc,
      privacy: 'No item payloads, save contents, database contents, character names, raw hook messages, or extracted game assets are included.',
      app: {
        version: app.getVersion(),
        packaged: app.isPackaged,
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome
      },
      system: { platform: platform(), release: release(), architecture: arch() },
      database: database.getDiagnosticSummary(),
      archiveBackups: await safely(() => archiveBackups.getStatus()),
      files: directoryCounts,
      collection: latestCollection ? {
        scannedAtUtc: latestCollection.scannedAtUtc,
        basis: latestCollection.basis,
        warningCount: latestCollection.warnings.length,
        warningMessages: latestCollection.warnings.map((warning) => warning.message),
        contentPacks: latestCollection.contentPacks.map((pack) => pack.id),
        sourceCount: latestCollection.scannedStashes.length,
        catalogItems: latestCollection.items.length,
        observedItems: latestCollection.observedItems.length
      } : null,
      writeSafety: await safely(() => helper.request<WriteSafetyStatus>('inspect-write-safety')),
      live: safeLive
    }
    await writeFile(selection.filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    return { canceled: false, path: selection.filePath }
  })
  ipcMain.handle(
    IPC_CHANNELS.setZoomFactor,
    (event, input: { factor: number }): number => {
      const factor = Math.min(1.8, Math.max(0.7, Math.round(input.factor * 10) / 10))
      event.sender.setZoomFactor(factor)
      return factor
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.discoverGrimDawn,
    (): Promise<GrimDawnDiscovery> => helper.request<GrimDawnDiscovery>('discover-grim-dawn')
  )
  ipcMain.handle(
    IPC_CHANNELS.listCharacters,
    async (): Promise<CharacterSaveProfile[]> => {
      const discovered = latestCollection?.discovery ?? await helper.request<GrimDawnDiscovery>('discover-grim-dawn')
      const installationPath = discovered.installations[0]?.path
      if (!installationPath) return []
      return helper.request<CharacterSaveProfile[]>('list-characters', { installationPath })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.getCachedCollection,
    async (_event, input: { sourcePaths: string[]; basis: CollectionBasis }): Promise<CollectionSnapshot | null> => {
      latestCollection ??= await readCollectionCache(collectionCachePath)
      if (!latestCollection) {
        return null
      }
      const mapIndex = await readMapLocationIndex(mapLocationCachePath)
      if (!mapIndex || !(await mapLocationIndexIsFresh(mapIndex))) return null
      const cacheNeedsRefresh = !(await collectionStashesAreFresh(latestCollection))
      const projected = projectCollectionSources(latestCollection, input.sourcePaths)
      return {
        ...(await presentCollection(helper, database, projected, input.basis, false)),
        cacheNeedsRefresh
      }
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.hydrateArchiveRolls,
    async (_event, input: { sourcePaths: string[] }): Promise<CollectionSnapshot | null> => {
      latestCollection ??= await readCollectionCache(collectionCachePath)
      if (!latestCollection) return null
      const projected = projectCollectionSources(latestCollection, input.sourcePaths)
      return presentCollection(helper, database, projected, 'archive', true, 24)
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.scanCollection,
    async (_event, input: { sourcePaths: string[]; basis: CollectionBasis }): Promise<CollectionSnapshot> => {
      collectionScan ??= (async () => {
        const startedAt = Date.now()
        const snapshot = await helper.request<CollectionSnapshot>('scan-collection')
        const withIcons = await attachItemIcons(helper, snapshot)
        const installationPath = withIcons.discovery.installations[0]?.path
        let withLocations = withIcons
        if (installationPath) {
          try {
            const locationIndex = await loadMapLocationIndex(
              helper,
              mapLocationCachePath,
              installationPath
            )
            withLocations = attachMapLocations(withIcons, locationIndex)
          } catch (error) {
            console.warn('Grim Dawn map locations could not be indexed.', error)
          }
        }
        const persisted = {
          ...database.persistSnapshot(withLocations),
          catalogPresentationVersion: CATALOG_PRESENTATION_VERSION
        }
        latestCollection = persisted
        await writeCollectionCache(collectionCachePath, persisted)
        console.log(`[collection-scan] completed in ${Date.now() - startedAt}ms`)
        return persisted
      })().finally(() => {
        collectionScan = null
      })
      const snapshot = await collectionScan
      const projected = projectCollectionSources(snapshot, input.sourcePaths)
      // A catalog refresh must resolve as soon as the browsable snapshot is ready.
      // Re-analyzing older archived rolls can take minutes after a game-data/schema
      // change; keeping it inside this foreground promise left the renderer on a
      // zero-item loading screen even though the completed cache was already on disk.
      return presentCollection(helper, database, projected, input.basis, false)
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.rebuildGameDataIndex,
    async (_event, input: { sourcePaths: string[]; basis: CollectionBasis }): Promise<CollectionSnapshot> => {
      const snapshot = await helper.request<CollectionSnapshot>('scan-collection')
      const withIcons = await attachItemIcons(helper, snapshot)
      const installationPath = withIcons.discovery.installations[0]?.path
      if (!installationPath) throw new Error('No Grim Dawn installation is available.')
      const locationIndex = await loadMapLocationIndex(
        helper,
        mapLocationCachePath,
        installationPath,
        true
      )
      latestCollection = {
        ...database.persistSnapshot(attachMapLocations(withIcons, locationIndex)),
        catalogPresentationVersion: CATALOG_PRESENTATION_VERSION
      }
      await writeCollectionCache(collectionCachePath, latestCollection)
      const projected = projectCollectionSources(latestCollection, input.sourcePaths)
      return presentCollection(helper, database, projected, input.basis, false)
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.setPinnedBest,
    (_event, input: { record: string; instanceKey: string | null; isHardcore: boolean }): void => {
      database.setPinnedBest(input.record, input.instanceKey, input.isHardcore)
      queueArchiveBackup('pinned copy changed')
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.getInfiniteSupplies,
    (): boolean => database.getInfiniteSupplies()
  )
  ipcMain.handle(
    IPC_CHANNELS.setInfiniteSupplies,
    async (_event, input: { enabled: boolean }): Promise<boolean> => {
      const enabled = await runExclusive(async () => database.setInfiniteSupplies(input.enabled))
      queueArchiveBackup('supply settings changed')
      return enabled
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.inspectWriteSafety,
    (): Promise<WriteSafetyStatus> => helper.request<WriteSafetyStatus>('inspect-write-safety')
  )
  ipcMain.handle(
    IPC_CHANNELS.inspectStagingTab,
    (_event, input: { path: string }): Promise<StagingTabInspection> =>
      inspectStagingTab(helper, database, input.path)
  )
  ipcMain.handle(
    IPC_CHANNELS.listVaultItems,
    (_event, input?: { isHardcore?: boolean }): VaultListItem[] =>
      database.listVaultItems(input?.isHardcore)
  )
  ipcMain.handle(
    IPC_CHANNELS.ingestStagingTab,
    async (_event, input: { path: string }): Promise<IngestResult> => {
      const result = await runTransferExclusive(() => executeStagingTabIngest(helper, database, input.path))
      if (result.ingested.length > 0) queueArchiveBackup('offline ingest')
      return result
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.retrieveVaultItems,
    async (_event, input: { path: string; vaultItemIds: string[] }): Promise<RetrievalResult> => {
      const result = await runTransferExclusive(() => executeLastTabRetrieval(helper, database, input.path, input.vaultItemIds))
      if (result.retrieved.length > 0) queueArchiveBackup('offline retrieval')
      return result
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.inspectLiveGame,
    async (): Promise<LiveGameStatus> => {
      const status = await helper.request<LiveGameStatus>('inspect-live-game')
      if (!process.env.CAIRN_CODEX_SCREENSHOT_PATH) return status
      return {
        ...status,
        state: 'unavailable',
        detail: 'Live transfers are disabled during visual diagnostics.',
        connectedProcessId: null,
        hostWindowReady: false,
        messages: []
      }
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.approveLiveGameBuild,
    (): Promise<LiveGameStatus> => helper.request<LiveGameStatus>('approve-live-game-build')
  )
  ipcMain.handle(
    IPC_CHANNELS.startLiveGame,
    (): Promise<LiveGameStatus> => {
      if (process.env.CAIRN_CODEX_SCREENSHOT_PATH) {
        throw new Error('Live transfers are disabled during visual diagnostics.')
      }
      return helper.request<LiveGameStatus>('start-live-game')
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.stopLiveGame,
    (): Promise<LiveGameStatus> => helper.request<LiveGameStatus>('stop-live-game')
  )
  ipcMain.handle(
    IPC_CHANNELS.syncLiveGame,
    async (): Promise<LiveGameSyncResult> => {
      latestCollection ??= await readCollectionCache(collectionCachePath)
      const result = await runTransferExclusive(() => syncLiveIncoming(
        helper,
        database,
        latestCollection?.discovery.installations[0]?.path
      ))
      if (result.ingested.length > 0) queueArchiveBackup('live ingest')
      return result
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.retrieveLiveVaultItems,
    async (_event, input: { vaultItemIds: string[] }): Promise<LiveRetrievalResult> => {
      const result = await runTransferExclusive(() => executeLiveRetrieval(helper, database, input.vaultItemIds))
      if (result.retrieved.length > 0) queueArchiveBackup('live retrieval')
      return result
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.dispenseLiveAugments,
    (_event, input: { records: string[]; expectedCharacterName?: string }): Promise<LiveSupplyDispenseResult> =>
      runTransferExclusive(async () => {
        latestCollection ??= await readCollectionCache(collectionCachePath)
        if (!latestCollection) throw new Error('Build the game-data index before dispensing augments.')
        const result = await executeLiveAugmentDispense(
          helper,
          database,
          latestCollection,
          input.records,
          input.expectedCharacterName
        )
        queueArchiveBackup('supply delivery')
        return result
      })
  )
  ipcMain.handle(
    IPC_CHANNELS.recoverSahdinasMemento,
    (_event, input: { destination: SpecialRecoveryDestination; expectedCharacterName?: string }): Promise<SpecialItemRecoveryResult> =>
      runTransferExclusive(async () => {
        latestCollection ??= await readCollectionCache(collectionCachePath)
        if (!latestCollection) throw new Error('Build the game-data index before recovering Sahdina\'s Memento.')
        const result = await executeSahdinasMementoRecovery(
          helper,
          database,
          latestCollection,
          input.destination,
          input.expectedCharacterName
        )
        queueArchiveBackup('special item recovery')
        return result
      })
  )
  return async () => {
    await writeQueue
    await archiveBackups.flush()
  }
}

async function syncLiveIncoming(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  installationPath?: string
): Promise<LiveGameSyncResult> {
  const status = await helper.request<LiveGameStatus>('inspect-live-game')
  const incoming = await helper.request<LiveIncomingItem[]>('poll-live-incoming')
  if (status.state !== 'ready' && incoming.length === 0) {
    return { status, ingested: [], issues: [] }
  }
  const ingested: LiveGameSyncResult['ingested'] = []
  const analysisInputs: Array<{ vaultItemId: string; item: LiveVaultPayload }> = []
  const issues: string[] = []
  for (const source of incoming) {
    const catalogName = database.getCatalogNames([source.item.baseRecord]).get(
      source.item.baseRecord.toLowerCase()
    )
    const name = catalogName ?? database.ensureQuarantineCatalogItem(source.item.baseRecord)
    const identity = createHash('sha256')
      .update(source.path.toLowerCase())
      .update('\0')
      .update(source.sha256)
      .digest('hex')
    const operationId = `live-ingest-${identity}`
    const vaultItemId = `live-${identity}`
    if (database.hasCommittedOperation(operationId)) {
      try {
        await helper.request<LiveQueueReceipt>('ack-live-incoming', {
          path: source.path,
          expectedSha256: source.sha256,
          receiptDirectory: join(app.getPath('userData'), 'live-receipts', 'ingested')
        })
      } catch (error) {
        issues.push(`${name}: committed earlier, but queue acknowledgement still failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      continue
    }
    let prepared = false
    let committed = false
    try {
      const receipt = await helper.request<LiveQueueReceipt>('copy-live-incoming', {
        path: source.path,
        expectedSha256: source.sha256,
        receiptDirectory: join(app.getPath('userData'), 'live-receipts', 'ingested')
      })
      database.prepareIngestOperation({
        operationId,
        stashPath: `live://gdia/${source.isHardcore ? 'hc' : 'sc'}/${source.path.split(/[\\/]/).at(-1)}`,
        sourceSha256: source.sha256,
        startedAtUtc: new Date().toISOString(),
        items: [{ vaultItemId, baseRecord: source.item.baseRecord, payload: source.item }],
        detail: { phase: 'receipt_verified', adapter: 'gdia-live-v1', receiptPath: receipt.receiptPath }
      })
      prepared = true
      database.completeIngestOperation({
        operationId,
        backupPath: receipt.receiptPath,
        completedAtUtc: new Date().toISOString(),
        isHardcore: source.isHardcore,
        detail: { phase: 'committed', adapter: 'gdia-live-v1', receiptPath: receipt.receiptPath }
      })
      committed = true
      await helper.request<LiveQueueReceipt>('ack-live-incoming', {
        path: source.path,
        expectedSha256: source.sha256,
        receiptDirectory: join(app.getPath('userData'), 'live-receipts', 'ingested')
      })
      ingested.push({
        vaultItemId,
        baseRecord: source.item.baseRecord,
        prefixRecord: source.item.prefixRecord,
        suffixRecord: source.item.suffixRecord,
        name,
        seed: source.item.seed,
        instanceKey: createVaultInstanceKey(source.item),
        rollAnalysis: null
      })
      analysisInputs.push({ vaultItemId, item: source.item })
      if (!catalogName) {
        issues.push(
          `${name} was safely stored outside the Epic/Legendary/MI collection. ` +
            'It is available in Vault quarantine for an immediate live return.'
        )
      }
    } catch (error) {
      if (prepared && !committed) database.failIngestOperation(operationId, error)
      issues.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (installationPath && analysisInputs.length > 0) {
    try {
      const analyzed = await helper.request<{ items: ItemRollAnalysis[] }>('analyze-item-rolls', {
        installationPath,
        items: analysisInputs.map(({ item }) => ({
          baseRecord: item.baseRecord,
          prefixRecord: item.prefixRecord,
          suffixRecord: item.suffixRecord,
          seed: item.seed
        }))
      })
      const updates = analysisInputs.flatMap(({ vaultItemId }, index) => {
        const rollAnalysis = analyzed.items[index]
        const result = ingested.find((item) => item.vaultItemId === vaultItemId)
        if (!rollAnalysis || !result) return []
        result.rollAnalysis = rollAnalysis
        return [{ id: vaultItemId, rollAnalysis }]
      })
      database.setVaultRollAnalyses(updates)
    } catch (error) {
      issues.push(`Roll analysis will retry in the background: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return {
    status: await helper.request<LiveGameStatus>('inspect-live-game'),
    ingested,
    issues
  }
}

async function executeLiveRetrieval(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  vaultItemIds: string[]
): Promise<LiveRetrievalResult> {
  if (vaultItemIds.length === 0) throw new Error('Select at least one vault item to retrieve.')
  if (new Set(vaultItemIds).size !== vaultItemIds.length) {
    throw new Error('The live retrieval selection contains a duplicate archive item.')
  }
  const listed = new Map(database.listVaultItems().map((item) => [item.id, item]))
  const selected = vaultItemIds.map((id) => {
    const item = listed.get(id)
    if (!item) throw new Error(`Vault item does not exist: ${id}`)
    return item
  })
  const modes = new Set(selected.map((item) => item.isHardcore))
  if (modes.size !== 1) throw new Error('A live retrieval cannot mix Hardcore and Softcore items.')
  const unavailable = selected.filter((item) => item.state !== 'ingested')
  if (unavailable.length > 0) {
    throw new Error('Vault items are not available: ' + unavailable.map((item) => item.id).join(', '))
  }

  const retrieved: LiveRetrievalResult['retrieved'] = []
  const receiptPaths: string[] = []
  const issues: string[] = []
  for (const vaultItemId of vaultItemIds) {
    try {
      const result = await executeSingleLiveRetrieval(helper, database, vaultItemId)
      retrieved.push(...result.retrieved)
      receiptPaths.push(...result.receiptPaths)
    } catch (error) {
      if (retrieved.length === 0) throw error
      issues.push(error instanceof Error ? error.message : String(error))
      break
    }
  }
  return {
    operationId: randomUUID(),
    status: 'committed',
    retrieved,
    receiptPaths,
    issues
  }
}

const reputationThresholds: Record<string, number> = {
  tolerated: 0,
  friendly: 1_500,
  respected: 5_000,
  honored: 10_000,
  revered: 25_000
}

function normalizedFactionName(value: string): string {
  return value
    .toLocaleLowerCase()
    .replaceAll('’', "'")
    .replace(/[^a-z0-9]/g, '')
}

function createSupplyPayload(baseRecord: string): LiveVaultPayload {
  return {
    stashVersion: 11,
    sourceTabIndex: -1,
    sourceItemIndex: -1,
    baseRecord,
    prefixRecord: '',
    suffixRecord: '',
    modifierRecord: '',
    transmuteRecord: '',
    seed: randomInt(1, 0xffff_ffff),
    materiaRecord: '',
    relicCompletionBonusRecord: '',
    relicSeed: 0,
    enchantmentRecord: '',
    ascendantRecord: '',
    ascendantRecord2H: '',
    unknown: 0,
    enchantmentSeed: 0,
    materiaCombines: 0,
    stackCount: 1,
    rerolls: 0,
    affixRerolls: 0,
    xOffset: 0,
    yOffset: 0
  }
}

async function executeSahdinasMementoRecovery(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  collection: CollectionSnapshot,
  destination: SpecialRecoveryDestination,
  expectedCharacterName?: string
): Promise<SpecialItemRecoveryResult> {
  if (destination !== 'shared-stash' && destination !== 'character-inventory') {
    throw new Error('Sahdina recovery only supports the shared stash or active character inventory.')
  }

  const status = await helper.request<LiveGameStatus>('inspect-live-game')
  if (status.state !== 'ready') throw new Error(status.detail)
  const confirmedCharacterName = expectedCharacterName?.trim() || null
  if (
    status.activeCharacterName &&
    confirmedCharacterName &&
    status.activeCharacterName.localeCompare(confirmedCharacterName, undefined, { sensitivity: 'base' }) !== 0
  ) {
    throw new Error(
      `The active character changed from “${confirmedCharacterName}” to “${status.activeCharacterName}”. Review the character and try again.`
    )
  }
  const activeCharacterName = status.activeCharacterName ?? confirmedCharacterName
  let activeIsHardcore = status.isHardcore
  if (activeIsHardcore === null) {
    if (!activeCharacterName) {
      throw new Error('Cairn could not identify the active character well enough to resolve Hardcore or Softcore mode.')
    }
    const installationPath = collection.discovery.installations[0]?.path
    if (!installationPath) throw new Error('No Grim Dawn installation is available.')
    const profiles = await helper.request<CharacterSaveProfile[]>('list-characters', { installationPath })
    const matchingProfiles = profiles
      .filter((profile) => !profile.error)
      .filter((profile) => profile.name.localeCompare(activeCharacterName, undefined, { sensitivity: 'base' }) === 0)
    const matchingModes = [...new Set(matchingProfiles.map((profile) => profile.isHardcore))]
    if (matchingModes.length > 1) {
      throw new Error(
        `Cairn found both Hardcore and Softcore saves named “${activeCharacterName}”. Rename one before using live recovery.`
      )
    }
    activeIsHardcore = matchingModes[0] ?? null
    if (activeIsHardcore === null) {
      throw new Error(`The active character “${activeCharacterName}” was not found in the parsed saves.`)
    }
  }

  const operationId = `sahdina-${randomUUID()}`
  const item = createSupplyPayload(SAHDINAS_MEMENTO.record)
  const payloadSha256 = createHash('sha256').update(JSON.stringify(item)).digest('hex')
  let queued = false
  database.prepareDeliveryOperation({
    operationId,
    destination: `live://special-recovery/${destination}`,
    payloadSha256,
    startedAtUtc: new Date().toISOString(),
    detail: { phase: 'prepared', adapter: 'cairn-live-v1', record: SAHDINAS_MEMENTO.record, destination }
  })
  try {
    const queue = await helper.request<LiveRetrievalQueue>('enqueue-live-retrieval', {
      operationId,
      isHardcore: activeIsHardcore,
      destination,
      item
    })
    queued = true
    database.updatePendingOperationDetail(operationId, {
      phase: 'queued',
      queues: [queue]
    })
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const result = await helper.request<LiveRetrievalStatus>('inspect-live-retrieval', { queue })
      if (result.state === 'rejected') {
        if (!result.receiptPath) {
          throw new Error('The game rejected the recovery without returning a durable queue receipt.')
        }
        await helper.request<LiveQueueReceipt>('ack-live-incoming', {
          path: result.receiptPath,
          expectedSha256: queue.semanticSha256,
          receiptDirectory: join(app.getPath('userData'), 'live-receipts', 'rejected-special-recoveries')
        })
        const target = destination === 'character-inventory' ? 'personal inventory' : status.depositTabDescription
        const rejection = new Error(`The game rejected the recovery because the ${target} is full. No replacement was delivered.`)
        database.failDeliveryOperation(operationId, rejection)
        queued = false
        throw rejection
      }
      if (result.state === 'deposited' && result.receiptPath) {
        database.completeDeliveryOperation({
          operationId,
          receiptPath: result.receiptPath,
          completedAtUtc: new Date().toISOString(),
          detail: { phase: 'committed', adapter: 'cairn-live-v1', record: SAHDINAS_MEMENTO.record, destination }
        })
        return {
          operationId,
          status: 'committed',
          activeCharacter: activeCharacterName ?? 'Active character',
          destination,
          record: SAHDINAS_MEMENTO.record,
          name: SAHDINAS_MEMENTO.name,
          receiptPath: result.receiptPath
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    throw new Error(
      'Timed out waiting for Grim Dawn to acknowledge Sahdina\'s Memento. Do not click recovery again until the pending live queue has resolved.'
    )
  } catch (error) {
    if (queued) database.markDeliveryNeedsRecovery(operationId, error)
    else database.failDeliveryOperation(operationId, error)
    throw error
  }
}

async function executeLiveAugmentDispense(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  collection: CollectionSnapshot,
  records: string[],
  expectedCharacterName?: string
): Promise<LiveSupplyDispenseResult> {
  const uniqueRecords = [...new Set(records.map((record) => record.toLocaleLowerCase()))]
  if (uniqueRecords.length === 0) throw new Error('Select at least one augment to dispense.')

  let status = await helper.request<LiveGameStatus>('inspect-live-game')
  if (status.state !== 'ready') throw new Error(status.detail)
  for (let attempt = 0; attempt < 25 && !status.activeCharacterName; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    status = await helper.request<LiveGameStatus>('inspect-live-game')
    if (status.state !== 'ready') throw new Error(status.detail)
  }
  const confirmedCharacterName = expectedCharacterName?.trim() || null
  if (
    status.activeCharacterName &&
    confirmedCharacterName &&
    status.activeCharacterName.localeCompare(confirmedCharacterName, undefined, { sensitivity: 'base' }) !== 0
  ) {
    throw new Error(
      `The active character changed from “${confirmedCharacterName}” to “${status.activeCharacterName}”. Review the character and try again.`
    )
  }
  const activeCharacterName = status.activeCharacterName ?? confirmedCharacterName
  if (!activeCharacterName) {
    throw new Error('Cairn could not identify the active character. Reopen the Supplies view and try again.')
  }

  const installationPath = collection.discovery.installations[0]?.path
  if (!installationPath) throw new Error('No Grim Dawn installation is available.')
  let activeCharacter: CharacterSaveProfile | undefined
  let activeIsHardcore = status.isHardcore
  for (let attempt = 0; attempt < 2 && !activeCharacter; attempt += 1) {
    const profiles = await helper.request<CharacterSaveProfile[]>('list-characters', { installationPath })
    const matchingProfiles = profiles
      .filter((profile) => !profile.error)
      .filter((profile) => profile.name.localeCompare(activeCharacterName, undefined, { sensitivity: 'base' }) === 0)

    if (activeIsHardcore === null) {
      const matchingModes = [...new Set(matchingProfiles.map((profile) => profile.isHardcore))]
      if (matchingModes.length > 1) {
        throw new Error(
          `Cairn found both Hardcore and Softcore saves named “${activeCharacterName}”. Wait for the game-mode handshake or rename one before dispensing.`
        )
      }
      activeIsHardcore = matchingModes[0] ?? null
    }

    if (activeIsHardcore !== null) {
      const expectedMode = activeIsHardcore
      activeCharacter = matchingProfiles
        .filter((profile) => profile.isHardcore === expectedMode)
        .sort((left, right) => Date.parse(right.lastWriteUtc) - Date.parse(left.lastWriteUtc))[0]
    }
    if (!activeCharacter) await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!activeCharacter) {
    throw new Error(`The active character “${activeCharacterName}” was not found in the parsed saves.`)
  }
  if (activeIsHardcore === null) {
    throw new Error(`Cairn could not resolve whether “${activeCharacterName}” is Hardcore or Softcore.`)
  }

  const catalog = new Map(
    (collection.supplies ?? [])
      .filter((item) => item.slot === 'augment')
      .map((item) => [item.record.toLocaleLowerCase(), item])
  )
  const selected = uniqueRecords.map((record) => {
    const item = catalog.get(record)
    if (!item) throw new Error(`The selected record is not a catalogued faction augment: ${record}`)
    const requirements = item.acquisition?.factions ?? []
    if (requirements.length === 0) {
      throw new Error(`${item.name} has no verified faction-vendor requirement and cannot be injected.`)
    }
    const authorized = requirements.some((requirement) => {
      const threshold = reputationThresholds[requirement.reputation.toLocaleLowerCase()]
      if (threshold === undefined) return false
      const faction = activeCharacter.factions.find(
        (candidate) => normalizedFactionName(candidate.name) === normalizedFactionName(requirement.faction)
      )
      return Boolean(faction?.isUnlocked && faction.value >= threshold)
    })
    if (!authorized) {
      const needed = requirements.map((requirement) => `${requirement.faction} ${requirement.reputation}`).join(' or ')
      throw new Error(`${activeCharacter.name} cannot buy ${item.name}; requires ${needed}.`)
    }
    return item
  })

  const operationId = randomUUID()
  const receiptPaths: string[] = []
  const dispensed: typeof selected = []
  const issues: string[] = []
  const queued: Array<{ item: (typeof selected)[number]; queue: LiveRetrievalQueue }> = []
  const payloads = selected.map((item) => createSupplyPayload(item.record))
  const payloadSha256 = createHash('sha256').update(JSON.stringify(payloads)).digest('hex')
  database.prepareDeliveryOperation({
    operationId,
    destination: 'live://personal-inventory/augments',
    payloadSha256,
    startedAtUtc: new Date().toISOString(),
    detail: { phase: 'prepared', adapter: 'cairn-live-v1', records: selected.map((item) => item.record) }
  })
  try {
    for (const [index, item] of selected.entries()) {
      const queue = await helper.request<LiveRetrievalQueue>('enqueue-live-retrieval', {
        operationId: `${operationId}-${index}`,
        isHardcore: activeIsHardcore,
        destination: 'character-inventory',
        item: payloads[index]
      })
      queued.push({ item, queue })
      database.updatePendingOperationDetail(operationId, {
        phase: 'queued',
        queues: queued.map((entry) => entry.queue)
      })
    }

    const pending = new Map(queued.map((entry) => [entry.queue.operationId, entry]))
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline && pending.size > 0) {
      for (const [pendingId, entry] of [...pending.entries()]) {
        const result = await helper.request<LiveRetrievalStatus>('inspect-live-retrieval', { queue: entry.queue })
        if (result.state === 'rejected') {
          if (!result.receiptPath) throw new Error('The game rejected an augment without returning a durable queue receipt.')
          await helper.request<LiveQueueReceipt>('ack-live-incoming', {
            path: result.receiptPath,
            expectedSha256: entry.queue.semanticSha256,
            receiptDirectory: join(app.getPath('userData'), 'live-receipts', 'rejected-personal-deliveries')
          })
          issues.push(`${activeCharacter.name}'s personal inventory is full. No rejected augment was lost.`)
          pending.delete(pendingId)
        } else if (result.state === 'deposited' && result.receiptPath) {
          receiptPaths.push(result.receiptPath)
          dispensed.push(entry.item)
          pending.delete(pendingId)
        }
      }
      if (pending.size > 0) await new Promise((resolve) => setTimeout(resolve, 150))
    }
    if (pending.size > 0) {
      throw new Error(`Timed out waiting for Grim Dawn to acknowledge ${pending.size} personal-inventory ${pending.size === 1 ? 'delivery' : 'deliveries'}. Do not retry until Cairn resolves the pending queue.`)
    }
    if (dispensed.length === 0) {
      const rejection = new Error(issues[0] ?? 'No augments were delivered.')
      database.failDeliveryOperation(operationId, rejection)
      queued.length = 0
      throw rejection
    }
    database.completeDeliveryOperation({
      operationId,
      receiptPath: receiptPaths[0]!,
      completedAtUtc: new Date().toISOString(),
      detail: {
        phase: 'committed',
        adapter: 'cairn-live-v1',
        records: dispensed.map((item) => item.record),
        receiptPaths,
        rejectedCount: issues.length
      }
    })

    return {
      operationId,
      status: 'committed',
      activeCharacter: activeCharacter.name,
      dispensed: dispensed.map((item) => ({ record: item.record, name: item.name })),
      receiptPaths,
      issues
    }
  } catch (error) {
    if (queued.length > 0) database.markDeliveryNeedsRecovery(operationId, error)
    else database.failDeliveryOperation(operationId, error)
    throw error
  }
}

async function executeSingleLiveRetrieval(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  vaultItemId: string
): Promise<LiveRetrievalResult> {
  const vaultItemIds = [vaultItemId]
  const listed = new Map(database.listVaultItems().map((item) => [item.id, item]))
  const selected = vaultItemIds.map((id) => {
    const item = listed.get(id)
    if (!item) throw new Error(`Vault item does not exist: ${id}`)
    return item
  })
  const isHardcore = selected[0]!.isHardcore
  const status = await helper.request<LiveGameStatus>('inspect-live-game')
  if (status.state !== 'ready') throw new Error(status.detail)
  if (status.isHardcore !== null && status.isHardcore !== isHardcore) {
    throw new Error(
      `The running character is ${status.isHardcore ? 'Hardcore' : 'Softcore'}, but the selection is ${isHardcore ? 'Hardcore' : 'Softcore'}.`
    )
  }
  const vaultItems = database.getVaultItems(vaultItemIds, isHardcore)
  const unavailable = vaultItems.filter((item) => item.state !== 'ingested')
  if (unavailable.length > 0) {
    throw new Error('Vault items are not available: ' + unavailable.map((item) => item.id).join(', '))
  }
  const operationId = randomUUID()
  const sourceIdentity = createHash('sha256')
    .update(JSON.stringify(vaultItems.map((item) => item.payload)))
    .digest('hex')
  let prepared = false
  let queued = false
  try {
    database.prepareRetrievalOperation({
      operationId,
      stashPath: `live://gdia/${isHardcore ? 'hc' : 'sc'}`,
      sourceSha256: sourceIdentity,
      startedAtUtc: new Date().toISOString(),
      vaultItemIds,
      detail: { phase: 'prepared', adapter: 'gdia-live-v1', vaultItemIds }
    })
    prepared = true
    const queues: LiveRetrievalQueue[] = []
    for (const [index, item] of vaultItems.entries()) {
      queues.push(
        await helper.request<LiveRetrievalQueue>('enqueue-live-retrieval', {
          operationId: `${operationId}-${index}`,
          isHardcore,
          item: item.payload
        })
      )
      queued = true
      database.updatePendingOperationDetail(operationId, {
        phase: 'queued',
        queues
      })
    }
    const deadline = Date.now() + 45_000
    const receipts = new Map<number, string>()
    while (Date.now() < deadline && receipts.size < queues.length) {
      for (const [index, queue] of queues.entries()) {
        if (receipts.has(index)) continue
        const result = await helper.request<LiveRetrievalStatus>('inspect-live-retrieval', { queue })
        if (result.state === 'rejected') {
          if (!result.receiptPath) {
            throw new Error('The game rejected the item without returning a durable queue receipt.')
          }
          await helper.request<LiveQueueReceipt>('ack-live-incoming', {
            path: result.receiptPath,
            expectedSha256: queue.semanticSha256,
            receiptDirectory: join(app.getPath('userData'), 'live-receipts', 'rejected-returns')
          })
          const rejection = new Error(
            `The ${status.depositTabDescription} is full. The item remains safely stored in the Codex Archive.`
          )
          database.failRetrievalOperation(operationId, vaultItemIds, rejection)
          prepared = false
          throw rejection
        }
        if (result.state === 'deposited' && result.receiptPath) receipts.set(index, result.receiptPath)
      }
      if (receipts.size < queues.length) await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (receipts.size !== queues.length) {
      throw new Error('Timed out waiting for the live hook to acknowledge the in-game deposit.')
    }
    const receiptPaths = [...receipts.entries()].sort(([left], [right]) => left - right).map(([, path]) => path)
    database.completeRetrievalOperation({
      operationId,
      vaultItemIds,
      backupPath: receiptPaths[0]!,
      completedAtUtc: new Date().toISOString(),
      detail: { phase: 'committed', adapter: 'gdia-live-v1', receiptPaths, vaultItemIds }
    })
    return {
      operationId,
      status: 'committed',
      retrieved: vaultItems.map((item, index) => ({
        vaultItemId: item.id,
        baseRecord: item.baseRecord,
        seed: (item.payload as { seed?: number }).seed ?? selected[index]!.seed
      })),
      receiptPaths,
      issues: []
    }
  } catch (error) {
    if (prepared) {
      if (queued) database.markRetrievalNeedsRecovery(operationId, error)
      else database.failRetrievalOperation(operationId, vaultItemIds, error)
    }
    throw error
  }
}

async function attachItemIcons(
  helper: GrimDawnHelperClient,
  snapshot: CollectionSnapshot
): Promise<CollectionSnapshot> {
  const installation = snapshot.discovery.installations[0]
  if (!installation) return snapshot
  const bitmaps = [
    ...new Set(
      [...snapshot.items, ...(snapshot.plannerItems ?? []), ...(snapshot.supplies ?? []), ...(snapshot.materials ?? [])]
        .map((item) => item.bitmap)
        .filter((bitmap): bitmap is string => Boolean(bitmap))
    )
  ]
  const extraction = await helper.request<ItemIconExtractionResult>('extract-item-icons', {
    installationPath: installation.path,
    outputDirectory: join(app.getPath('userData'), 'item-icons'),
    bitmaps
  })
  if (extraction.failures.length > 0) {
    console.warn('Some Grim Dawn item icons could not be decoded.', extraction.failures.slice(0, 10))
  }
  const keys = new Map(
    extraction.icons.map((icon) => [icon.bitmap.toLocaleLowerCase(), icon.key])
  )
  return {
    ...snapshot,
    items: snapshot.items.map((item) => ({
      ...item,
      iconKey: item.bitmap ? (keys.get(item.bitmap.toLocaleLowerCase()) ?? null) : null
    })),
    plannerItems: (snapshot.plannerItems ?? []).map((item) => ({
      ...item,
      iconKey: item.bitmap ? (keys.get(item.bitmap.toLocaleLowerCase()) ?? null) : null
    })),
    supplies: (snapshot.supplies ?? []).map((item) => ({
      ...item,
      iconKey: item.bitmap ? (keys.get(item.bitmap.toLocaleLowerCase()) ?? null) : null
    })),
    materials: (snapshot.materials ?? []).map((item) => ({
      ...item,
      iconKey: item.bitmap ? (keys.get(item.bitmap.toLocaleLowerCase()) ?? null) : null
    }))
  }
}

async function readCollectionCache(path: string): Promise<CollectionSnapshot | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as CollectionSnapshot
    if (
      parsed.catalogPresentationVersion !== CATALOG_PRESENTATION_VERSION ||
      !Array.isArray(parsed.items) ||
      !Array.isArray(parsed.plannerItems) ||
      !Array.isArray(parsed.supplies) ||
      !Array.isArray(parsed.materials) ||
      !Array.isArray(parsed.accountStores) ||
      !Array.isArray(parsed.observedItems) ||
      !Array.isArray(parsed.scannedStashes)
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

async function loadMapLocationIndex(
  helper: GrimDawnHelperClient,
  cachePath: string,
  installationPath: string,
  force = false
): Promise<MapLocationIndex> {
  if (!force) {
    const cached = await readMapLocationIndex(cachePath)
    if (cached && (await mapLocationIndexIsFresh(cached))) return cached
  }
  const rebuilt = await helper.request<MapLocationIndex>('build-map-location-index', {
    installationPath
  })
  await writeJsonCache(cachePath, rebuilt)
  console.log(
    `[map-index] ${rebuilt.regionCount} regions, ${rebuilt.placedRecordCount} placed game records`
  )
  return rebuilt
}

async function readMapLocationIndex(path: string): Promise<MapLocationIndex | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as MapLocationIndex
    if (
      parsed.version !== 8 ||
      !Array.isArray(parsed.archives) ||
      !parsed.sourceLocations ||
      typeof parsed.sourceLocations !== 'object'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

async function mapLocationIndexIsFresh(index: MapLocationIndex): Promise<boolean> {
  try {
    for (const archive of index.archives) {
      const current = await stat(archive.path)
      if (
        current.size !== archive.length ||
        Math.abs(current.mtimeMs - Date.parse(archive.lastWriteUtc)) > 1_000
      ) {
        return false
      }
    }
    return index.archives.length > 0
  } catch {
    return false
  }
}

async function collectionStashesAreFresh(snapshot: CollectionSnapshot): Promise<boolean> {
  const stashes = [
    ...(snapshot.availableStashes ?? snapshot.scannedStashes),
    ...(snapshot.accountStores ?? [])
  ]
  try {
    for (const stash of stashes) {
      const current = await stat(stash.path)
      if (Math.abs(current.mtimeMs - Date.parse(stash.lastWriteUtc)) > 1_000) return false
    }
    return true
  } catch {
    return false
  }
}

function attachMapLocations(
  snapshot: CollectionSnapshot,
  index: MapLocationIndex
): CollectionSnapshot {
  const locationsBySource = new Map(
    Object.entries(index.sourceLocations).map(([record, locations]) => [
      record.toLocaleLowerCase(),
      locations
    ])
  )
  return {
    ...snapshot,
    items: snapshot.items.map((item) => {
      if (item.rarity !== 'mi') return item
      const sourceRecords = item.acquisition?.sourceRecords ?? []
      const locations = sourceRecords.flatMap(
        (record) => locationsBySource.get(record.toLocaleLowerCase()) ?? []
      )
      const unique = new Map<string, MapRegionLocation>()
      for (const location of locations) {
        const key = `${location.name}:${location.routeName ?? ''}`.toLocaleLowerCase()
        if (!unique.has(key)) unique.set(key, location)
      }
      const distinctLocations = [...unique.values()]
      const namedWorldLocations = distinctLocations.filter((location) => Boolean(location.zoneRecord))
      const usefulLocations = (namedWorldLocations.length > 0 ? namedWorldLocations : distinctLocations)
        .sort((left, right) =>
          mapLocationRouteRank(left) - mapLocationRouteRank(right) ||
          left.name.localeCompare(right.name)
        )
      return item.acquisition
        ? {
            ...item,
            acquisition: {
              ...item.acquisition,
              // Source records are an internal join key; once locations are attached,
              // retaining thousands of repeated paths only bloats the persisted catalog.
              sourceRecords: [],
              locations: usefulLocations.slice(0, 64),
              additionalLocationCount: Math.max(0, usefulLocations.length - 64)
            }
          }
        : item
    })
  }
}

function mapLocationRouteRank(location: MapRegionLocation): number {
  const packRank = ({ base: 0, gdx1: 1, gdx2: 2, gdx3: 3 } as Record<string, number>)[location.contentPack] ?? 9
  const chapter = /riftgatemap1([a-l])_/i.exec(location.zoneRecord)?.[1]?.toLocaleLowerCase()
  const chapterRank = chapter ? chapter.charCodeAt(0) - 'a'.charCodeAt(0) : 99
  return packRank * 100 + chapterRank
}

async function writeJsonCache(path: string, value: unknown): Promise<void> {
  const temporaryPath = path + '.tmp'
  await writeFile(temporaryPath, JSON.stringify(value), 'utf8')
  await rename(temporaryPath, path)
}

async function writeCollectionCache(path: string, snapshot: CollectionSnapshot): Promise<void> {
  await writeJsonCache(path, snapshot)
}

function projectCollectionSources(
  snapshot: CollectionSnapshot,
  sourcePaths: string[]
): CollectionSnapshot {
  const availableStashes = snapshot.availableStashes ?? snapshot.scannedStashes
  const requested = new Set(sourcePaths.map((path) => path.toLocaleLowerCase()))
  const defaultMode = availableStashes.some((stash) => stash.isHardcore)
  const scannedStashes = availableStashes.filter((stash) =>
    requested.size > 0
      ? requested.has(stash.path.toLocaleLowerCase())
      : stash.isHardcore === defaultMode
  )
  const paths = new Set(scannedStashes.map((stash) => stash.path.toLocaleLowerCase()))
  const observedItems = snapshot.observedItems.filter((item) =>
    paths.has(item.sourcePath.toLocaleLowerCase())
  )
  const copiesByRecord = new Map<string, typeof observedItems>()
  for (const item of observedItems) {
    const key = item.baseRecord.toLocaleLowerCase()
    const copies = copiesByRecord.get(key)
    if (copies) copies.push(item)
    else copiesByRecord.set(key, [item])
  }
  const items = snapshot.items.map((item) => {
    const copies = copiesByRecord.get(item.record.toLocaleLowerCase()) ?? []
    const trusted = copies.filter(
      (copy) =>
        copy.rollAnalysis?.trusted === true &&
        copy.rollAnalysis.overallEstimatedPercentile !== null
    )
    return {
      ...item,
      availableCount: copies.length,
      analyzedCopyCount: trusted.length,
      bestRollPercentile:
        trusted.length > 0
          ? Math.max(...trusted.map((copy) => copy.rollAnalysis!.overallEstimatedPercentile!))
          : null
    }
  })
  const supplies = (snapshot.supplies ?? []).map((item) => ({
    ...item,
    availableCount: copiesByRecord.get(item.record.toLocaleLowerCase())?.length ?? 0
  }))
  const projectedMode =
    scannedStashes.length > 0 &&
    scannedStashes.every((stash) => stash.isHardcore === scannedStashes[0]!.isHardcore)
      ? scannedStashes[0]!.isHardcore
      : undefined
  const accountCounts = new Map<string, number>()
  const accountStores = (snapshot.accountStores ?? [])
    .filter((store) => projectedMode === undefined || store.isHardcore === projectedMode)
    .sort((left, right) => Date.parse(right.lastWriteUtc) - Date.parse(left.lastWriteUtc))
    .filter((store, index, all) =>
      all.findIndex((candidate) =>
        candidate.kind === store.kind && candidate.isHardcore === store.isHardcore
      ) === index
    )
  for (const store of accountStores) {
    for (const entry of store.entries) {
      const record = entry.record.toLocaleLowerCase()
      accountCounts.set(record, (accountCounts.get(record) ?? 0) + entry.quantity)
    }
  }
  const materials = (snapshot.materials ?? []).map((item) => ({
    ...item,
    availableCount: accountCounts.get(item.record.toLocaleLowerCase()) ?? 0,
    discovered: (accountCounts.get(item.record.toLocaleLowerCase()) ?? 0) > 0
  }))
  const warnings = snapshot.warnings.filter((warning) => {
    if (paths.has(warning.path.toLocaleLowerCase())) return true
    return scannedStashes.some(
      (stash) => stash.isHardcore === isHardcoreStashPath(warning.path)
    )
  })
  const rarities = collectionRarities.map((rarity) => {
    const matching = items.filter((item) => item.rarity === rarity)
    return {
      rarity,
      total: matching.length,
      collected: matching.filter((item) => item.availableCount > 0).length,
      availableCopies: matching.reduce((count, item) => count + item.availableCount, 0)
    }
  })
  return withProjectedAffixes({
    ...snapshot,
    isHardcore: projectedMode,
    availableStashes,
    scannedStashes,
    observedItems,
    warnings,
    rarities,
    items,
    supplies,
    materials
  }, observedItems)
}

function withProjectedAffixes(
  snapshot: CollectionSnapshot,
  observedItems: ObservedStashItem[]
): CollectionSnapshot {
  const counts = new Map<string, number>()
  for (const item of observedItems) {
    for (const record of [item.prefixRecord, item.suffixRecord]) {
      if (!record) continue
      const key = record.toLocaleLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const affixes = snapshot.affixes.map((affix) => ({
    ...affix,
    availableCount: affix.records.reduce(
      (count, record) => count + (counts.get(record.toLocaleLowerCase()) ?? 0),
      0
    )
  }))
  return {
    ...snapshot,
    affixes,
    affixSummary: {
      total: affixes.length,
      collected: affixes.filter((affix) => affix.availableCount > 0).length,
      availableCopies: affixes.reduce((count, affix) => count + affix.availableCount, 0)
    }
  }
}

function lifetimeMode(snapshot: CollectionSnapshot): boolean | undefined {
  const modes = new Set(snapshot.scannedStashes.map((stash) => stash.isHardcore))
  return modes.size === 1 ? [...modes][0] : undefined
}

async function presentCollection(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  snapshot: CollectionSnapshot,
  basis: CollectionBasis,
  analyzeMissing = true,
  analysisLimit = Number.POSITIVE_INFINITY
): Promise<CollectionSnapshot> {
  await resolveQuarantinedArchiveItems(helper, database, snapshot)
  const mode = lifetimeMode(snapshot)
  if (basis !== 'archive') {
    return withRecipeCollection(
      database.presentSnapshot({ ...snapshot, basis: 'stashes' }, mode),
      mode
    )
  }

  const installation = snapshot.discovery.installations[0]
  const archived = database.listAvailableArchiveItems(mode)
  if (!installation || archived.length === 0) {
    return withRecipeCollection(database.presentArchiveSnapshot(snapshot, [], mode), mode)
  }
  const payloads = archived.map((item) => item.payload as LiveVaultPayload)
  const missingAnalysis = archived
    .map((item, index) => ({ item, payload: payloads[index]! }))
    .filter(
      ({ item }) =>
        item.rollAnalysis === null ||
        item.rollAnalysis.modelVersion !== ROLL_ANALYSIS_VERSION ||
        item.rollAnalysis.baseEstimatedPercentile === undefined ||
        item.rollAnalysis.prefixEstimatedPercentile === undefined ||
        item.rollAnalysis.suffixEstimatedPercentile === undefined
    )
  const analysisBatch = missingAnalysis.slice(0, analysisLimit)
  if (analyzeMissing && analysisBatch.length > 0) {
    const analyzed = await helper.request<{ items: ItemRollAnalysis[] }>('analyze-item-rolls', {
      installationPath: installation.path,
      items: analysisBatch.map(({ payload }) => ({
        baseRecord: payload.baseRecord,
        prefixRecord: payload.prefixRecord,
        suffixRecord: payload.suffixRecord,
        seed: payload.seed
      }))
    })
    database.setVaultRollAnalyses(
      analysisBatch.map(({ item }, index) => ({
        id: item.id,
        rollAnalysis: analyzed.items[index]!
      }))
    )
    for (const [index, entry] of analysisBatch.entries()) {
      entry.item.rollAnalysis = analyzed.items[index] ?? null
    }
  }
  const observedItems = archived.map((item, index): ObservedStashItem => {
    const payload = payloads[index]!
    return {
      sourcePath: `vault://${item.id}`,
      tabIndex: -1,
      itemIndex: index,
      baseRecord: payload.baseRecord,
      prefixRecord: payload.prefixRecord,
      suffixRecord: payload.suffixRecord,
      modifierRecord: payload.modifierRecord,
      transmuteRecord: payload.transmuteRecord,
      seed: payload.seed,
      materiaRecord: payload.materiaRecord,
      relicCompletionBonusRecord: payload.relicCompletionBonusRecord,
      relicSeed: payload.relicSeed,
      enchantmentRecord: payload.enchantmentRecord,
      ascendantRecord: payload.ascendantRecord,
      ascendantRecord2H: payload.ascendantRecord2H,
      enchantmentSeed: payload.enchantmentSeed,
      materiaCombines: payload.materiaCombines,
      stackCount: payload.stackCount,
      rerolls: payload.rerolls,
      affixRerolls: payload.affixRerolls,
      rollAnalysis: archived[index]!.rollAnalysis,
      instanceKey: createVaultInstanceKey(payload)
    }
  })
  return {
    ...withRecipeCollection(database.presentArchiveSnapshot(snapshot, observedItems, mode), mode),
    rollHydrationPending: analyzeMissing
      ? Math.max(0, missingAnalysis.length - analysisBatch.length)
      : missingAnalysis.length
  }
}

async function resolveQuarantinedArchiveItems(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  snapshot: CollectionSnapshot
): Promise<void> {
  const records = database.listQuarantineCatalogRecords()
  const installationPath = snapshot.discovery.installations[0]?.path
  if (records.length === 0 || !installationPath) return
  try {
    const resolved = await helper.request<ResolvedArchiveCatalogItem[]>('resolve-archive-items', {
      installationPath,
      records
    })
    const result = database.resolveQuarantineCatalogItems(resolved)
    console.log(
      `[quarantine-audit] released ${result.releasedRecords} valid Rare records; ` +
      `retained ${result.recoveryRecords} generic records with resolved metadata; ` +
      `${result.missingRecords} records were absent from the installed databases.`
    )
  } catch (error) {
    console.warn('[quarantine-audit] Installed-data resolution failed; originals remain untouched.', error)
  }
}

function withRecipeCollection(
  snapshot: CollectionSnapshot,
  isHardcore?: boolean
): CollectionSnapshot {
  const recipeKnown = (item: CollectionSnapshot['items'][number]): boolean => {
    const crafting = item.acquisition?.crafting
    if (!crafting) return false
    if (isHardcore === true) return crafting.knownHardcore === true
    if (isHardcore === false) return crafting.knownSoftcore === true
    return crafting.knownSoftcore === true || crafting.knownHardcore === true
  }
  const decorate = (item: CollectionSnapshot['items'][number]) => {
    const recipeUnlocked = recipeKnown(item)
    return {
      ...item,
      recipeUnlocked,
      discovered:
        snapshot.basis === 'archive' ? Boolean(item.discovered || recipeUnlocked) : item.discovered
    }
  }
  const recipeItemsCatalog = snapshot.items.map(decorate)
  const recipePlannerItems = (snapshot.plannerItems ?? []).map(decorate)
  const materials = (snapshot.materials ?? []).map(decorate)
  const awakeningSources = [...recipeItemsCatalog, ...recipePlannerItems]
  const items = withAwakeningAvailability(recipeItemsCatalog, awakeningSources)
  const plannerItems = withAwakeningAvailability(recipePlannerItems, awakeningSources)
  const recipeItems = [...items, ...plannerItems, ...materials].filter(
    (item, index, all) =>
      Boolean(item.acquisition?.crafting) &&
      all.findIndex((candidate) => candidate.record.toLowerCase() === item.record.toLowerCase()) === index
  )
  const rarities = snapshot.rarities.map((summary) => {
    const matching = items.filter((item) => item.rarity === summary.rarity)
    return {
      ...summary,
      total: matching.length,
      collected: matching.filter(isCollectionOwned).length,
      availableCopies: matching.reduce((count, item) => count + item.availableCount, 0)
    }
  })
  const collectedRecipes = recipeItems.filter((item) => item.recipeUnlocked).length
  return {
    ...snapshot,
    items,
    plannerItems,
    materials,
    rarities,
    recipeSummary: {
      total: recipeItems.length,
      collected: collectedRecipes,
      unlockedItems: collectedRecipes
    }
  }
}

function createVaultInstanceKey(item: LiveVaultPayload): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        item.baseRecord,
        item.prefixRecord,
        item.suffixRecord,
        item.modifierRecord,
        item.transmuteRecord,
        item.seed,
        item.materiaRecord,
        item.relicCompletionBonusRecord,
        item.relicSeed,
        item.enchantmentRecord,
        item.ascendantRecord,
        item.ascendantRecord2H,
        item.enchantmentSeed,
        item.materiaCombines,
        item.stackCount,
        item.rerolls,
        item.affixRerolls
      ])
    )
    .digest('hex')
}

function registerItemIconProtocol(): void {
  const iconDirectory = join(app.getPath('userData'), 'item-icons')
  protocol.handle('cairn-icon', async (request) => {
    const url = new URL(request.url)
    const fileName = url.pathname.split('/').at(-1) ?? ''
    if (!/^[a-f0-9]{64}\.png$/.test(fileName)) {
      return new Response('Invalid item icon key.', { status: 400 })
    }
    try {
      return new Response(await readFile(join(iconDirectory, fileName)), {
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' }
      })
    } catch {
      return new Response('Item icon was not found.', { status: 404 })
    }
  })
}

async function runSmokeTest(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase
): Promise<void> {
  try {
    const schemaSmokePath = join(
      app.getPath('temp'),
      `cairn-codex-schema-smoke-${randomUUID()}.sqlite3`
    )
    try {
      new CollectionDatabase(schemaSmokePath).close()
      new CollectionDatabase(schemaSmokePath).close()
    } finally {
      await Promise.all(
        [schemaSmokePath, `${schemaSmokePath}-wal`, `${schemaSmokePath}-shm`].map((path) =>
          unlink(path).catch(() => undefined)
        )
      )
    }
    const archiveSmokeRoot = join(
      app.getPath('temp'),
      `cairn-codex-archive-backup-smoke-${randomUUID()}`
    )
    const archiveSmokePath = join(archiveSmokeRoot, 'archive.sqlite3')
    const archiveSmokeBackupDirectory = join(archiveSmokeRoot, 'backups')
    try {
      await mkdir(archiveSmokeRoot, { recursive: true })
      const archiveSmokeDatabase = new CollectionDatabase(archiveSmokePath)
      const archiveSmokeService = new ArchiveBackupService(
        archiveSmokeDatabase,
        archiveSmokePath,
        archiveSmokeBackupDirectory,
        2
      )
      const original = await archiveSmokeService.createBackup('smoke original')
      archiveSmokeDatabase.setInfiniteSupplies(false)
      await archiveSmokeService.createBackup('smoke changed')
      await archiveSmokeService.stageRestore(
        join(archiveSmokeBackupDirectory, original.fileName)
      )
      archiveSmokeDatabase.close()
      if (!(await ArchiveBackupService.applyPendingRestore(
        archiveSmokePath,
        archiveSmokeBackupDirectory
      ))) {
        throw new Error('Archive backup smoke test did not apply its staged restore.')
      }
      const restoredArchive = new CollectionDatabase(archiveSmokePath)
      try {
        if (!restoredArchive.getInfiniteSupplies()) {
          throw new Error('Archive restore did not recover the selected database state.')
        }
      } finally {
        restoredArchive.close()
      }
      const archiveStatus = await archiveSmokeService.getStatus()
      if (
        archiveStatus.pendingRestore ||
        archiveStatus.backups.length < 2 ||
        !archiveStatus.backups.every((entry) => entry.verified && /^[0-9a-f]{64}$/.test(entry.sha256))
      ) {
        throw new Error('Archive backup rotation or verification metadata failed its smoke test.')
      }
      await writeFile(
        join(archiveSmokeBackupDirectory, 'pending-restore.json'),
        `${JSON.stringify({
          sourcePath: join(archiveSmokeBackupDirectory, 'missing.sqlite3'),
          sourceSha256: '0'.repeat(64),
          requestedAtUtc: new Date().toISOString()
        }, null, 2)}\n`,
        'utf8'
      )
      let invalidRestoreRejected = false
      try {
        await ArchiveBackupService.applyPendingRestore(
          archiveSmokePath,
          archiveSmokeBackupDirectory
        )
      } catch {
        invalidRestoreRejected = true
      }
      const quarantinedRestore = await ArchiveBackupService.quarantinePendingRestore(
        archiveSmokeBackupDirectory
      )
      if (!invalidRestoreRejected || !quarantinedRestore) {
        throw new Error('Invalid staged restore did not fail closed and leave the current archive usable.')
      }
      await stat(quarantinedRestore)
      new CollectionDatabase(archiveSmokePath).close()
    } finally {
      await rm(archiveSmokeRoot, { recursive: true, force: true })
    }
    await helper.request('health')
    const writeTransaction = await helper.request<{ passed: boolean }>('self-test-write-transaction')
    if (!writeTransaction.passed) {
      throw new Error('Verified write transaction self-test failed.')
    }
    const liveQueue = await helper.request<{
      passed: boolean
      fields: number
      hookSha256: string
      injectorSha256: string
    }>('self-test-live-queue')
    if (
      !liveQueue.passed ||
      liveQueue.fields !== 18 ||
      !/^[0-9a-f]{64}$/.test(liveQueue.hookSha256) ||
      !/^[0-9a-f]{64}$/.test(liveQueue.injectorSha256)
    ) {
      throw new Error('Live queue serializer self-test failed.')
    }
    const helperSnapshot = await helper.request<CollectionSnapshot>('scan-collection')
    const installationPath = helperSnapshot.discovery.installations[0]?.path
    if (!installationPath) throw new Error('Grim Dawn installation was not discovered.')
    const quarantineResolution = await helper.request<ResolvedArchiveCatalogItem[]>(
      'resolve-archive-items',
      {
        installationPath,
        records: [
          'records/items/gearaccessories/medals/b204a_medal.dbr',
          'records/items/gearshoulders/a09_shoulder02.dbr'
        ]
      }
    )
    const rareResolution = quarantineResolution.find((item) =>
      item.record.endsWith('/b204a_medal.dbr')
    )
    const genericResolution = quarantineResolution.find((item) =>
      item.record.endsWith('/a09_shoulder02.dbr')
    )
    if (
      rareResolution?.name !== "Brawler's Distinction" ||
      !rareResolution.catalogEligible ||
      genericResolution?.name !== 'Exalted Shoulderplates' ||
      genericResolution.catalogEligible
    ) {
      throw new Error('Installed-data quarantine classification did not preserve archive boundaries.')
    }
    const supplies = helperSnapshot.supplies ?? []
    const materials = helperSnapshot.materials ?? []
    const writ = supplies.find((item) => item.slot === 'writ')
    const mandate = supplies.find((item) => item.slot === 'mandate')
    const warrant = supplies.find((item) => item.slot === 'warrant')
    const merits = supplies.filter((item) => item.slot === 'merit')
    const saviorsMerit = merits.find((item) => item.name === "Savior's Merit")
    const clarityPotion = supplies.find((item) =>
      item.record.toLocaleLowerCase().endsWith('/xppotion_malmouth.dbr')
    )
    const augment = supplies.find((item) => item.slot === 'augment')
    const movementRune = supplies.find((item) => item.slot === 'rune')
    if (
      supplies.length < 300 ||
      supplies.some((item) => item.rarity !== 'supply') ||
      !writ ||
      !mandate ||
      !warrant ||
      merits.length !== 4 ||
      !saviorsMerit?.bitmap?.endsWith('/difficulty_legendaryunlock.tex') ||
      !saviorsMerit.presentation?.sections.some((section) =>
        section.lines.some((line) => line.label === 'Unlocks Ultimate difficulty')
      ) ||
      clarityPotion?.slot !== 'potion' ||
      !clarityPotion.presentation?.grantedSkill?.lines.some(
        (line) => line.label === 'Experience Gained' && line.minimum === 100
      ) ||
      !augment ||
      !movementRune
    ) {
      throw new Error('Reusable supply catalog did not include faction boosts, merits, Potion of Clarity, augments, and movement runes.')
    }
    if (
      materials.filter((item) => item.rarity === 'component').length < 40 ||
      !materials.some((item) => item.record.toLocaleLowerCase().endsWith('/quest_dynamite.dbr')) ||
      !materials.some((item) => item.slot === 'potion-formula')
    ) {
      throw new Error('Component and consumable account stores were not indexed.')
    }
    const characterProfiles = await helper.request<CharacterSaveProfile[]>('list-characters', {
      installationPath: helperSnapshot.discovery.installations[0]?.path
    })
    const sanya = characterProfiles.find((profile) => profile.name === 'Sanya' && !profile.error)
    if (
      characterProfiles.length === 0 ||
      characterProfiles.some((profile) => profile.error) ||
      !sanya?.skills.some((skill) => skill.name === 'Devouring Swarm' && skill.level > 0) ||
      !sanya.factions.some((faction) => faction.name === 'Devil\'s Crossing')
    ) {
      throw new Error('Read-only character loading did not validate current local and cloud saves.')
    }
    const factionPlannerItems = helperSnapshot.plannerItems ?? []
    const chosenArcanespark = factionPlannerItems.find((item) => item.name === 'Chosen Arcanespark')
    if (
      factionPlannerItems.length < 450 ||
      factionPlannerItems.some((item) => item.rarity !== 'faction') ||
      !chosenArcanespark?.acquisition?.factions?.some(
        (requirement) =>
          requirement.faction === "Kymon's Chosen" && requirement.reputation === 'Respected'
      )
    ) {
      throw new Error('Faction planning catalog did not preserve reputation vendor requirements.')
    }
    const monsterInfrequents = helperSnapshot.items.filter((item) => item.rarity === 'mi')
    const frostsnarlTiers = monsterInfrequents.filter((item) => item.name === "Frostsnarl's Horns")
    const skillRareTiers = new Map(
      ['Weaver Ring', 'Devourer Ring', 'Ascended Shoulderplates'].map((name) => [
        name,
        monsterInfrequents.filter((item) => item.name === name)
      ])
    )
    const unresolvedMiSources = monsterInfrequents.filter(
      (item) => !item.acquisition?.sources.some((source) => source.startsWith('Dropped by '))
    )
    if (
      monsterInfrequents.length < 1_600 ||
      unresolvedMiSources.length > 20 ||
      frostsnarlTiers.length !== 6 ||
      frostsnarlTiers.some(
        (item) => item.acquisition?.sources[0] !== 'Dropped by Frostsnarl the Chosen'
      )
    ) {
      throw new Error('Monster Infrequent source traversal did not resolve every live MI tier.')
    }
    if (
      skillRareTiers.get('Weaver Ring')?.length !== 7 ||
      skillRareTiers.get('Devourer Ring')?.length !== 6 ||
      skillRareTiers.get('Ascended Shoulderplates')?.length !== 6 ||
      [...skillRareTiers.values()].flat().some(
        (item) => !item.acquisition?.sources.some((source) => source.startsWith('Dropped by '))
      )
    ) {
      throw new Error('Build-defining green skill bases were not catalogued with their source tiers.')
    }
    const ignusShoulders = helperSnapshot.items.find((item) => item.name === "Ignus' Shoulderguards")
    const bloodswornSignet = helperSnapshot.items.find((item) => item.name === 'Bloodsworn Signet')
    const kravallShoulders = helperSnapshot.items.find((item) => item.name === "Kra'vall Shoulderguards")
    const loghorreanShoulders = helperSnapshot.items.find((item) => item.name === "Loghorrean's Corruption")
    if (
      !ignusShoulders?.acquisition?.sources.every((source) => source.startsWith('Dropped by ')) ||
      !bloodswornSignet?.acquisition?.sources.every((source) => source.startsWith('Dropped by ')) ||
      !kravallShoulders?.acquisition?.sources.some((source) => source.startsWith('Found in ')) ||
      !loghorreanShoulders?.acquisition?.sources.some((source) => source.startsWith('Found in '))
    ) {
      throw new Error('MI acquisition indexing did not separate monster drops from chest-only bases.')
    }
    const deterministicRecipes = helperSnapshot.items.filter((item) => item.acquisition?.crafting)
    const abyssalMask = deterministicRecipes.find((item) => item.name === 'Abyssal Mask')
    const mistbornTalisman = deterministicRecipes.find((item) => item.name === 'Mistborn Talisman')
    const randomLegendary = helperSnapshot.items.find((item) => item.name === 'Demonbone Legplates')
    if (
      deterministicRecipes.length < 400 ||
      !abyssalMask?.acquisition?.crafting?.knownSoftcore ||
      mistbornTalisman?.rarity !== 'rare' ||
      !mistbornTalisman.acquisition?.crafting?.blueprintRecords.some((record) =>
        record.endsWith('/craft_relic_b011.dbr')
      ) ||
      randomLegendary?.acquisition?.crafting
    ) {
      throw new Error('Known-blueprint indexing did not distinguish direct recipes from random crafting tables.')
    }
    const mapIndex = await helper.request<MapLocationIndex>('build-map-location-index', {
      installationPath: helperSnapshot.discovery.installations[0]?.path
    })
    const frostsnarlLocations =
      mapIndex.sourceLocations[
        'records/creatures/enemies/boss&quest/dranghoul_frostsnarl_01.dbr'
      ] ?? []
    if (!frostsnarlLocations.some((location) => location.name.includes("Kruu'Sul Crags"))) {
      throw new Error('Map location index did not place Frostsnarl in Kruu\'Sul Crags.')
    }
    const campaignLocationExamples = [
      'records/creatures/enemies/nemesis/nemesis_kymon_01.dbr',
      'records/creatures/enemies/nemesis/nemesis_orderdeathsvigil_02.dbr',
      'records/creatures/enemies/boss&quest/cultist_chthonianmonstrosity.dbr'
    ]
    if (campaignLocationExamples.some((record) =>
      !(mapIndex.sourceLocations[record] ?? []).some((location) => location.zoneRecord)
    )) {
      throw new Error('Map location index did not resolve scripted nemesis and summoned-boss campaign sources.')
    }
    const shatteredRealmLocations = Object.values(mapIndex.sourceLocations)
      .flat()
      .filter((location) => location.levelFile.includes('/EndlessDungeon/'))
    if (
      mapIndex.miTierCount - mapIndex.locatedMiTierCount > 128 ||
      shatteredRealmLocations.length > 0
    ) {
      throw new Error('Map location index retained Shattered Realm proxies or lost too many campaign item tiers.')
    }
    const flamebrand = helperSnapshot.items.find((item) => item.name === 'Flamebrand')
    const flamebrandFire = flamebrand?.presentation?.sections
      .flatMap((section) => section.lines)
      .find((line) => line.label === 'Fire Damage')
    if (
      !flamebrand?.presentation?.searchText.includes('Fire Strike') ||
      flamebrandFire?.minimum !== 40 ||
      flamebrandFire.maximum !== 60
    ) {
      throw new Error('Catalog presentation did not preserve Flamebrand skill text and roll ranges.')
    }
    const mythicalMaw = helperSnapshot.items.find(
      (item) => item.name === 'Mythical Maw of the Damned'
    )
    const mawGrantedLines = mythicalMaw?.presentation?.grantedSkill?.lines ?? []
    if (
      mawGrantedLines.find((line) => line.label === 'Energy Cost')?.minimum !== 60 ||
      mawGrantedLines.find((line) => line.label === 'Bleeding Damage over 3 Seconds')?.minimum !== 1320 ||
      mythicalMaw?.presentation?.sections.filter((section) => section.kind === 'skill-modifier').length !== 3
    ) {
      throw new Error('Catalog presentation did not resolve Mythical Maw skill levels and modifiers.')
    }
    const jackalStep = helperSnapshot.items.find((item) => item.name === "Mythical Jackal's Step")
    const stunBlast = helperSnapshot.items
      .flatMap((item) => item.setPresentation?.tiers ?? [])
      .map((tier) => tier.grantedSkill)
      .find((skill) => skill?.name === 'Stun Blast')
    if (
      jackalStep?.presentation?.grantedSkill?.trigger !== '20% Chance when Hit' ||
      stunBlast?.trigger !== '35% Chance on Default Weapon Attack'
    ) {
      throw new Error('Granted passive and proc skills did not preserve their activation trigger.')
    }
    const forbiddenMark = helperSnapshot.items.find(
      (item) => item.name === 'Mythical Mark of the Forbidden'
    )
    const wendigoModifier = forbiddenMark?.presentation?.sections.find(
      (section) => section.kind === 'skill-modifier' && section.heading === 'Wendigo Totem'
    )
    const anySkillConversion = helperSnapshot.items
      .flatMap((item) => item.presentation?.sections ?? [])
      .filter((section) => section.kind === 'skill-modifier')
      .flatMap((section) => section.lines)
      .some((line) => line.label.includes('Damage converted to'))
    if (
      wendigoModifier?.lines.find((line) => line.label === 'Vitality Damage')?.minimum !== 100 ||
      !anySkillConversion
    ) {
      throw new Error('Pet skill modifiers did not preserve special damage or conversion payloads.')
    }
    const oathbreaker = helperSnapshot.items.find((item) => item.setName === 'Oathbreaker')
      ?.setPresentation
    const marauder = helperSnapshot.items.find((item) => item.setName === "Marauder's Justice")
      ?.setPresentation
    const brimstone = helperSnapshot.items.find((item) => item.setName === 'Brimstone')
      ?.setPresentation
    if (
      !oathbreaker?.tiers.some(
        (tier) => tier.lines.some((line) => line.tone === 'skill' && line.minimum === 3) &&
          tier.grantedSkill
      ) ||
      !marauder?.tiers.some(
        (tier) =>
          tier.requiredPieces === 3 &&
          tier.lines.some((line) => line.label === 'Fire Damage' && line.minimum === 7) &&
          tier.lines.some((line) => line.label === 'Cold Damage' && line.minimum === 7)
      ) ||
      !brimstone?.tiers.some(
        (tier) =>
          tier.requiredPieces === 2 &&
          tier.lines.some((line) => line.label === 'Fire Damage' && line.minimum === 18)
      )
    ) {
      throw new Error('Set presentation omitted flat damage, skill bonuses, or granted skills.')
    }
    const iceKing = helperSnapshot.items.find((item) => item.setName === "Ice King's Adornments")
      ?.setPresentation
    const iceKingModifiers = iceKing?.tiers.flatMap((tier) => tier.skillModifiers) ?? []
    const iceKingHellhound = iceKingModifiers.find(
      (section) => section.kind === 'skill-modifier' && section.heading === 'Summon Hellhound'
    )
    const iceKingVisual = iceKingModifiers.find(
      (section) => section.kind === 'visual-modifier' &&
        section.lines.some((line) => line.label === 'Summoned form: Direwolf')
    )
    const anyWpsSetModifier = helperSnapshot.items
      .flatMap((item) => item.setPresentation?.tiers ?? [])
      .flatMap((tier) => tier.skillModifiers)
      .filter((section) => section.kind === 'skill-modifier')
      .some((section) =>
        section.lines.some((line) => line.label === 'Weapon Damage') &&
        section.lines.some((line) => line.label === 'Chance on Default Weapon Attack')
      )
    const anyProjectileVisual = helperSnapshot.items
      .flatMap((item) => item.setPresentation?.tiers ?? [])
      .flatMap((tier) => tier.skillModifiers)
      .filter((section) => section.kind === 'visual-modifier')
      .some((section) =>
        section.lines.some((line) => line.label === 'Alternate projectile effects')
      )
    if (
      iceKingHellhound?.lines.find(
        (line) => line.label === 'Chaos Damage converted to Cold Damage'
      )?.minimum !== 100 ||
      !iceKingVisual ||
      !anyWpsSetModifier ||
      !anyProjectileVisual
    ) {
      throw new Error('Set presentation omitted a mechanical or visual skill modifier.')
    }
    const invertedRange = helperSnapshot.items
      .flatMap((item) => item.presentation?.sections ?? [])
      .flatMap((section) => section.lines)
      .find(
        (line) =>
          line.minimum !== null && line.maximum !== null && line.minimum > line.maximum
      )
    if (invertedRange) {
      throw new Error(`Catalog presentation produced an inverted range for ${invertedRange.label}.`)
    }
    const analyzedCopies = helperSnapshot.observedItems.filter(
      (item) => item.rollAnalysis !== null
    )
    const trustedRolls = analyzedCopies.filter(
      (item) =>
        item.rollAnalysis?.trusted === true &&
        item.rollAnalysis.overallEstimatedPercentile !== null &&
        item.rollAnalysis.percentileSampleSize === 4096
    )
    if (analyzedCopies.length === 0 || trustedRolls.length === 0) {
      throw new Error('Collection scan did not produce any trusted roll analyses.')
    }
    for (const item of helperSnapshot.items.filter((candidate) => candidate.bestRollPercentile !== null)) {
      const expected = Math.max(
        ...trustedRolls
          .filter((copy) => copy.baseRecord.toLowerCase() === item.record.toLowerCase())
          .map((copy) => copy.rollAnalysis!.overallEstimatedPercentile!)
      )
      if (Math.abs(expected - item.bestRollPercentile!) > 0.0000001) {
        throw new Error('Catalog best-roll selection does not match its trusted copies: ' + item.record)
      }
    }
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
    const ingestPlans = await Promise.all(
      helperSnapshot.scannedStashes
        .filter((stash) => stash.itemCount > 0)
        .map((stash) => {
          const observed = helperSnapshot.observedItems.find(
            (item) => item.sourcePath.toLowerCase() === stash.path.toLowerCase()
          )
          if (!observed) {
            throw new Error('Non-empty stash has no observed item: ' + stash.path)
          }
          return helper.request<{
            sourceItemCount: number
            replacementItemCount: number
            semanticallyValid: boolean
            idempotent: boolean
            items: Array<{ baseRecord: string; [key: string]: unknown }>
          }>('validate-ingest-plan', {
            path: stash.path,
            tabIndex: observed.tabIndex,
            itemIndex: observed.itemIndex
          })
        })
    )
    if (
      ingestPlans.some(
        (plan) =>
          !plan.semanticallyValid ||
          !plan.idempotent ||
          plan.replacementItemCount !== plan.sourceItemCount - 1
      )
    ) {
      throw new Error('A transfer stash failed the in-memory ingest plan validation.')
    }
    const retrievalRoundTrips = await Promise.all(
      helperSnapshot.scannedStashes
        .filter((stash) => stash.itemCount > 0)
        .map((stash) => {
          const observed = helperSnapshot.observedItems.find(
            (item) => item.sourcePath.toLowerCase() === stash.path.toLowerCase()
          )
          if (!observed) {
            throw new Error('Non-empty stash has no observed item: ' + stash.path)
          }
          return helper.request<{
            sourceItemCount: number
            restoredItemCount: number
            semanticallyEquivalent: boolean
            idempotent: boolean
          }>('validate-ingest-retrieval-roundtrip', {
            path: stash.path,
            tabIndex: observed.tabIndex,
            itemIndex: observed.itemIndex
          })
        })
    )
    if (
      retrievalRoundTrips.some(
        (result) =>
          !result.semanticallyEquivalent ||
          !result.idempotent ||
          result.restoredItemCount !== result.sourceItemCount
      )
    ) {
      throw new Error('A transfer stash failed the in-memory ingest/retrieval roundtrip.')
    }
    const snapshot = database.persistSnapshot(helperSnapshot)
    if (snapshot.supplySummary?.total !== supplies.length) {
      throw new Error('Reusable supply completion was not projected into the collection snapshot.')
    }
    const recipeArchiveSnapshot = withRecipeCollection(
      database.presentArchiveSnapshot(snapshot, [], false),
      false
    )
    const recipeUnlockedMask = recipeArchiveSnapshot.items.find(
      (item) => item.name === 'Abyssal Mask'
    )
    if (
      recipeArchiveSnapshot.recipeSummary.total < 400 ||
      recipeArchiveSnapshot.recipeSummary.collected === 0 ||
      !recipeUnlockedMask?.recipeUnlocked ||
      !recipeUnlockedMask.discovered ||
      recipeUnlockedMask.availableCount !== 0
    ) {
      throw new Error('Known recipes did not unlock their Codex items without creating stored copies.')
    }
    const awakenedCatalogItem = helperSnapshot.items.find((item) => item.baseVersionRecord)
    const awakeningBase = awakenedCatalogItem?.baseVersionRecord
      ? helperSnapshot.items.find(
          (item) => item.record.toLowerCase() === awakenedCatalogItem.baseVersionRecord!.toLowerCase()
        )
      : undefined
    if (!awakenedCatalogItem || !awakeningBase) {
      throw new Error('Catalog did not link an Awakened Legendary to its Epic base.')
    }
    const [availableAwakened] = withAwakeningAvailability(
      [{ ...awakenedCatalogItem, availableCount: 0, discovered: false }],
      [{ ...awakeningBase, availableCount: 1, discovered: true }]
    )
    if (
      !availableAwakened ||
      !isCollectionOwned(availableAwakened) ||
      !availableAwakened.availableViaAwakening ||
      availableAwakened.availableCount !== 0 ||
      availableAwakened.awakeningSourceRecord?.toLowerCase() !== awakeningBase.record.toLowerCase()
    ) {
      throw new Error('Owned Epic bases did not qualify their Awakened Legendary without fabricating a stored copy.')
    }
    const pinCandidate = snapshot.observedItems.find(
      (item) => item.instanceKey && item.rollAnalysis?.trusted
    )
    if (!pinCandidate?.instanceKey) {
      throw new Error('Smoke test needs one trusted copy to verify pinned-best persistence.')
    }
    database.setPinnedBest(pinCandidate.baseRecord, pinCandidate.instanceKey)
    const pinnedSnapshot = database.persistSnapshot({
      ...helperSnapshot,
      scannedAtUtc: new Date(Date.parse(helperSnapshot.scannedAtUtc) + 0.5).toISOString()
    })
    const pinnedCatalogItem = pinnedSnapshot.items.find(
      (item) => item.record.toLowerCase() === pinCandidate.baseRecord.toLowerCase()
    )
    if (pinnedCatalogItem?.pinnedInstanceKey !== pinCandidate.instanceKey) {
      throw new Error('Pinned-best selection did not survive a subsequent collection snapshot.')
    }
    database.setPinnedBest(pinCandidate.baseRecord, null)
    const journalPayload = ingestPlans[0]?.items[0]
    if (!journalPayload) {
      throw new Error('Smoke test needs one item payload to verify retrieval journal transitions.')
    }
    const journalVaultItemId = randomUUID()
    const ingestOperationId = randomUUID()
    database.prepareIngestOperation({
      operationId: ingestOperationId,
      stashPath: 'smoke-test-transfer.gsh',
      sourceSha256: 'smoke-source',
      startedAtUtc: new Date().toISOString(),
      items: [
        {
          vaultItemId: journalVaultItemId,
          baseRecord: journalPayload.baseRecord,
          payload: journalPayload
        }
      ],
      detail: { phase: 'prepared', smokeTest: true }
    })
    database.completeIngestOperation({
      operationId: ingestOperationId,
      backupPath: 'smoke-ingest-backup',
      completedAtUtc: new Date().toISOString(),
      isHardcore: true,
      detail: { phase: 'committed', smokeTest: true }
    })
    const archivedSmokeCopy = helperSnapshot.observedItems.find(
      (item) =>
        item.baseRecord.toLowerCase() === journalPayload.baseRecord.toLowerCase() &&
        item.seed === journalPayload.seed
    )
    const archivedBeforeRetrieval = database
      .presentArchiveSnapshot(snapshot, archivedSmokeCopy ? [archivedSmokeCopy] : [], true)
      .items.find((item) => item.record.toLowerCase() === journalPayload.baseRecord.toLowerCase())
    if (
      !archivedBeforeRetrieval?.discovered ||
      archivedBeforeRetrieval.availableCount !== 1
    ) {
      throw new Error('Codex Archive did not own the newly ingested item.')
    }
    const retrievalOperationId = randomUUID()
    database.prepareRetrievalOperation({
      operationId: retrievalOperationId,
      stashPath: 'smoke-test-transfer.gsh',
      sourceSha256: 'smoke-retrieval-source',
      startedAtUtc: new Date().toISOString(),
      vaultItemIds: [journalVaultItemId],
      detail: { phase: 'prepared', smokeTest: true }
    })
    if (database.getVaultItems([journalVaultItemId])[0]?.state !== 'retrieval_pending') {
      throw new Error('Vault item did not enter retrieval_pending state.')
    }
    database.completeRetrievalOperation({
      operationId: retrievalOperationId,
      backupPath: 'smoke-retrieval-backup',
      completedAtUtc: new Date().toISOString(),
      vaultItemIds: [journalVaultItemId],
      detail: { phase: 'committed', smokeTest: true }
    })
    const archivedAfterRetrieval = database
      .presentArchiveSnapshot(snapshot, [], true)
      .items.find((item) => item.record.toLowerCase() === journalPayload.baseRecord.toLowerCase())
    if (!archivedAfterRetrieval?.discovered || archivedAfterRetrieval.availableCount !== 0) {
      throw new Error('Codex Archive did not retain collection history after retrieval.')
    }
    if (database.getVaultItems([journalVaultItemId])[0]?.state !== 'retrieved') {
      throw new Error('Vault item did not enter retrieved state.')
    }
    const listedVaultItem = database.listVaultItems().find((item) => item.id === journalVaultItemId)
    if (
      !listedVaultItem ||
      listedVaultItem.state !== 'retrieved' ||
      listedVaultItem.seed !== (journalPayload.seed as number)
    ) {
      throw new Error('Vault listing did not project the stored payload and lifecycle state.')
    }
    const reusableVaultItemId = randomUUID()
    const reusableIngestOperationId = randomUUID()
    database.prepareIngestOperation({
      operationId: reusableIngestOperationId,
      stashPath: 'smoke-test-transfer.gsh',
      sourceSha256: 'smoke-reusable-source',
      startedAtUtc: new Date().toISOString(),
      items: [
        {
          vaultItemId: reusableVaultItemId,
          baseRecord: warrant.record,
          payload: { baseRecord: warrant.record, seed: 42, stackCount: 99 }
        }
      ],
      detail: { phase: 'prepared', smokeTest: true, reusable: true }
    })
    database.completeIngestOperation({
      operationId: reusableIngestOperationId,
      backupPath: 'smoke-reusable-ingest-backup',
      completedAtUtc: new Date().toISOString(),
      isHardcore: true,
      detail: { phase: 'committed', smokeTest: true, reusable: true }
    })
    const reusableBeforeRetrieval = database.getVaultItems([reusableVaultItemId])[0]
    if (
      !reusableBeforeRetrieval?.reusable ||
      reusableBeforeRetrieval.state !== 'ingested' ||
      (reusableBeforeRetrieval.payload as { stackCount?: number }).stackCount !== 1
    ) {
      throw new Error('Reusable supply ingest did not retain one normalized dispensable template.')
    }
    const reusableRetrievalOperationId = randomUUID()
    database.prepareRetrievalOperation({
      operationId: reusableRetrievalOperationId,
      stashPath: 'smoke-test-transfer.gsh',
      sourceSha256: 'smoke-reusable-retrieval-source',
      startedAtUtc: new Date().toISOString(),
      vaultItemIds: [reusableVaultItemId],
      detail: { phase: 'prepared', smokeTest: true, reusable: true }
    })
    database.completeRetrievalOperation({
      operationId: reusableRetrievalOperationId,
      backupPath: 'smoke-reusable-retrieval-backup',
      completedAtUtc: new Date().toISOString(),
      vaultItemIds: [reusableVaultItemId],
      detail: { phase: 'committed', smokeTest: true, reusable: true }
    })
    const reusableAfterRetrieval = database.getVaultItems([reusableVaultItemId])[0]
    const listedReusable = database.listVaultItems().find((item) => item.id === reusableVaultItemId)
    if (
      reusableAfterRetrieval?.state !== 'ingested' ||
      !reusableAfterRetrieval.reusable ||
      listedReusable?.state !== 'ingested' ||
      !listedReusable.reusable ||
      listedReusable.slot !== 'warrant'
    ) {
      throw new Error('Dispensing a reusable supply consumed its stored unlock.')
    }
    const clarityVaultItemId = randomUUID()
    const clarityIngestOperationId = randomUUID()
    database.prepareIngestOperation({
      operationId: clarityIngestOperationId,
      stashPath: 'smoke-test-transfer.gsh',
      sourceSha256: 'smoke-clarity-source',
      startedAtUtc: new Date().toISOString(),
      items: [
        {
          vaultItemId: clarityVaultItemId,
          baseRecord: clarityPotion.record,
          payload: { baseRecord: clarityPotion.record, seed: 43, stackCount: 20 }
        }
      ],
      detail: { phase: 'prepared', smokeTest: true, finiteStack: true }
    })
    database.completeIngestOperation({
      operationId: clarityIngestOperationId,
      backupPath: 'smoke-clarity-ingest-backup',
      completedAtUtc: new Date().toISOString(),
      isHardcore: true,
      detail: { phase: 'committed', smokeTest: true, finiteStack: true }
    })
    const storedClarity = database.getVaultItems([clarityVaultItemId])[0]
    if (
      storedClarity?.state !== 'ingested' ||
      storedClarity.reusable ||
      (storedClarity.payload as { stackCount?: number }).stackCount !== 20
    ) {
      throw new Error('Potion of Clarity did not preserve its finite stack count in Supplies.')
    }
    if (!database.getInfiniteSupplies() || database.setInfiniteSupplies(false) !== false) {
      throw new Error('Infinite-supplies setting did not persist its disabled state.')
    }
    const finiteRetrievalOperationId = randomUUID()
    database.prepareRetrievalOperation({
      operationId: finiteRetrievalOperationId,
      stashPath: 'smoke-test-transfer.gsh',
      sourceSha256: 'smoke-finite-supply-source',
      startedAtUtc: new Date().toISOString(),
      vaultItemIds: [reusableVaultItemId],
      detail: { phase: 'prepared', smokeTest: true, reusable: false }
    })
    database.completeRetrievalOperation({
      operationId: finiteRetrievalOperationId,
      backupPath: 'smoke-finite-supply-backup',
      completedAtUtc: new Date().toISOString(),
      vaultItemIds: [reusableVaultItemId],
      detail: { phase: 'committed', smokeTest: true, reusable: false }
    })
    database.setInfiniteSupplies(true)
    const finiteAfterRetrieval = database.getVaultItems([reusableVaultItemId])[0]
    const clarityAfterSettingToggle = database.getVaultItems([clarityVaultItemId])[0]
    if (
      finiteAfterRetrieval?.state !== 'retrieved' ||
      finiteAfterRetrieval.reusable ||
      clarityAfterSettingToggle?.reusable ||
      (clarityAfterSettingToggle?.payload as { stackCount?: number } | undefined)?.stackCount !== 20 ||
      !database.getInfiniteSupplies()
    ) {
      throw new Error('Disabling infinite supplies did not consume the dispensed stored copy.')
    }
    const migrationInput = {
      sourcePath: 'smoke-gdia-userdata.db',
      sourceSha256: 'smoke-gdia-source',
      backupPath: 'smoke-gdia-backup',
      importedAtUtc: new Date().toISOString(),
      items: [1, 2].map((externalId) => ({
        externalId: String(externalId),
        baseRecord: journalPayload.baseRecord as string,
        isHardcore: true,
        createdAtUtc: new Date().toISOString(),
        payload: journalPayload
      }))
    }
    const migration = database.importVaultItems(migrationInput)
    const repeatedMigration = database.importVaultItems(migrationInput)
    if (
      migration.importedIds.length !== 2 ||
      migration.duplicateIds.length !== 0 ||
      repeatedMigration.importedIds.length !== 0 ||
      repeatedMigration.duplicateIds.length !== 2
    ) {
      throw new Error('GDIA migration did not preserve copy multiplicity or idempotency.')
    }
    let duplicateSelectionRejected = false
    try {
      database.getVaultItems([migration.importedIds[0]!, migration.importedIds[0]!], true)
    } catch (error) {
      duplicateSelectionRejected =
        error instanceof Error && error.message.includes('Duplicate vault item IDs')
    }
    if (!duplicateSelectionRejected) {
      throw new Error('Vault retrieval accepted the same copy ID more than once.')
    }
    const failedRetrievalId = randomUUID()
    database.prepareRetrievalOperation({
      operationId: failedRetrievalId,
      stashPath: 'smoke-full-target.gsh',
      sourceSha256: 'smoke-full-target',
      startedAtUtc: new Date().toISOString(),
      vaultItemIds: [migration.importedIds[0]!],
      detail: { phase: 'prepared', smokeTest: true, scenario: 'full_target' }
    })
    database.failRetrievalOperation(
      failedRetrievalId,
      [migration.importedIds[0]!],
      new Error('Target tab is full.')
    )
    if (database.getVaultItems([migration.importedIds[0]!], true)[0]?.state !== 'ingested') {
      throw new Error('A rejected retrieval did not return its copy to ingested state.')
    }
    const committedDeliveryId = randomUUID()
    database.prepareDeliveryOperation({
      operationId: committedDeliveryId,
      destination: 'live://smoke/personal-inventory',
      payloadSha256: 'smoke-delivery-payload',
      startedAtUtc: new Date().toISOString(),
      detail: { phase: 'prepared', smokeTest: true, transferKind: 'generated_delivery' }
    })
    database.updatePendingOperationDetail(committedDeliveryId, {
      phase: 'queued',
      queues: [{ operationId: `${committedDeliveryId}-0`, semanticSha256: 'smoke-semantic-hash' }]
    })
    database.completeDeliveryOperation({
      operationId: committedDeliveryId,
      receiptPath: 'smoke-delivery-receipt',
      completedAtUtc: new Date().toISOString(),
      detail: { phase: 'committed', smokeTest: true, transferKind: 'generated_delivery' }
    })
    const rejectedDeliveryId = randomUUID()
    database.prepareDeliveryOperation({
      operationId: rejectedDeliveryId,
      destination: 'live://smoke/personal-inventory',
      payloadSha256: 'smoke-rejected-delivery-payload',
      startedAtUtc: new Date().toISOString(),
      detail: { phase: 'prepared', smokeTest: true, transferKind: 'generated_delivery' }
    })
    database.failDeliveryOperation(rejectedDeliveryId, new Error('Target inventory is full.'))
    const deliveryJournal = database.getDiagnosticSummary().journalStates
    if (
      !deliveryJournal.some(
        (entry) => entry.operation === 'retrieve' && entry.state === 'committed' && entry.count >= 2
      ) ||
      !deliveryJournal.some(
        (entry) => entry.operation === 'retrieve' && entry.state === 'failed' && entry.count >= 2
      )
    ) {
      throw new Error('Generated live deliveries did not retain committed and rejected journal outcomes.')
    }
    const rollCacheCandidate = database
      .listAvailableArchiveItems(true)
      .find((item) => item.id === migration.importedIds[0])
    const sourceRoll = archivedSmokeCopy?.rollAnalysis
    if (!rollCacheCandidate || !sourceRoll) {
      throw new Error('Smoke test needs an archived analyzed copy to verify roll caching.')
    }
    database.setVaultRollAnalyses([{ id: rollCacheCandidate.id, rollAnalysis: sourceRoll }])
    if (
      database.listAvailableArchiveItems(true).find((item) => item.id === rollCacheCandidate.id)
        ?.rollAnalysis?.overallEstimatedPercentile !== sourceRoll.overallEstimatedPercentile
    ) {
      throw new Error('Archive roll analysis did not survive a database round trip.')
    }
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
    const recoveryOperationId = randomUUID()
    database.prepareRetrievalOperation({
      operationId: recoveryOperationId,
      stashPath: 'smoke-uncertain-outcome.gsh',
      sourceSha256: 'smoke-uncertain-outcome',
      startedAtUtc: new Date().toISOString(),
      vaultItemIds: [migration.importedIds[1]!],
      detail: { phase: 'prepared', smokeTest: true, scenario: 'helper_timeout' }
    })
    database.markRetrievalNeedsRecovery(recoveryOperationId, new Error('Simulated lost response.'))
    const diagnostics = database.getDiagnosticSummary()
    if (
      diagnostics.quickCheck.some((value) => value.toLocaleLowerCase() !== 'ok') ||
      database.getRecoveryOperationCount() !== 1 ||
      !diagnostics.recoveryOperations.some(
        (operation) => operation.id === recoveryOperationId && operation.state === 'needs_recovery'
      )
    ) {
      throw new Error('Uncertain transfer state was not retained for recovery diagnostics.')
    }
    console.log(
      JSON.stringify({
        helper: 'available',
        writeTransaction: 'verified',
        liveQueue: 'verified',
        migrationDedupe: 'verified',
        duplicateSelection: 'rejected',
        rejectedRetrievalRollback: 'verified',
        generatedDeliveryJournal: 'verified',
        uncertainOutcomeRecovery: 'verified',
        databaseIntegrity: 'verified',
        archiveBackupRestore: 'verified',
        archiveRollCache: 'verified',
        serializerRoundTrips: roundTrips.length,
        ingestPlans: ingestPlans.length,
        retrievalRoundTrips: retrievalRoundTrips.length,
        retrievalJournal: 'verified',
        vaultListing: 'verified',
        analyzedCopies: analyzedCopies.length,
        trustedRolls: trustedRolls.length,
        withheldRolls: analyzedCopies.length - trustedRolls.length,
        pinnedBest: 'verified',
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

async function runIngestCommand(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  command: IngestCommand
): Promise<void> {
  try {
    const snapshot = await helper.request<CollectionSnapshot>('scan-collection')
    database.persistSnapshot(snapshot)
    console.log(JSON.stringify(await executeIngestCommand(helper, database, command)))
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

async function executeIngestCommand(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  command: IngestCommand
): Promise<IngestResult> {
  const operationId = randomUUID()
  let prepared = false
  try {
    const safety = await helper.request<WriteSafetyStatus>('inspect-write-safety')
    if (!safety.permitted) {
      throw new Error('Write safety gate refused permission: ' + safety.reasons.join(' '))
    }

    const selectors = command.items.map(({ tabIndex, itemIndex }) => ({ tabIndex, itemIndex }))
    const plan = await helper.request<IngestPlan>('plan-ingest-items', {
      path: command.path,
      items: selectors
    })
    if (
      plan.sourceSha256.toLowerCase() !== command.expectedSourceSha256.toLowerCase() ||
      !plan.semanticallyValid ||
      !plan.idempotent ||
      plan.replacementItemCount !== plan.sourceItemCount - command.items.length
    ) {
      throw new Error('Ingest plan no longer matches the approved source and transformation.')
    }
    const actualSeeds = plan.items.map((item) => item.seed)
    const expectedSeeds = command.items.map((item) => item.expectedSeed)
    if (
      actualSeeds.length !== expectedSeeds.length ||
      actualSeeds.some((seed, index) => seed !== expectedSeeds[index])
    ) {
      throw new Error('The selected stash items no longer match the approved roll seeds.')
    }

    const vaultItems = plan.items.map((item) => ({
      vaultItemId: randomUUID(),
      baseRecord: item.baseRecord,
      payload: item
    }))
    database.prepareIngestOperation({
      operationId,
      stashPath: plan.path,
      sourceSha256: plan.sourceSha256,
      startedAtUtc: new Date().toISOString(),
      items: vaultItems,
      detail: {
        phase: 'prepared',
        replacementSha256: plan.replacementSha256,
        sourceItemCount: plan.sourceItemCount,
        replacementItemCount: plan.replacementItemCount,
        vaultItemIds: vaultItems.map((item) => item.vaultItemId)
      }
    })
    prepared = true

    const committed = await helper.request<CommittedIngest>('commit-ingest-items', {
      operationId,
      path: plan.path,
      expectedSourceSha256: plan.sourceSha256,
      items: selectors,
      backupDirectory: join(app.getPath('userData'), 'backups')
    })
    if (
      committed.transaction.sourceSha256.toLowerCase() !== plan.sourceSha256.toLowerCase() ||
      committed.transaction.committedSha256.toLowerCase() !== plan.replacementSha256.toLowerCase()
    ) {
      throw new Error('Committed ingest hashes do not match the persisted plan.')
    }

    const completedAtUtc = new Date().toISOString()
    const vaultItemIds = database.completeIngestOperation({
      operationId,
      backupPath: committed.transaction.backupPath,
      completedAtUtc,
      isHardcore: isHardcoreStashPath(plan.path),
      detail: {
        phase: 'committed',
        replacementSha256: committed.transaction.committedSha256,
        rollbackPath: committed.transaction.rollbackPath,
        vaultItemIds: vaultItems.map((item) => item.vaultItemId)
      }
    })
    const verified = await helper.request<{
      sha256: string
      itemCount: number
      tabs: Array<{ items: unknown[] }>
    }>('scan-transfer-stash', { path: plan.path })
    if (
      verified.sha256.toLowerCase() !== committed.transaction.committedSha256.toLowerCase() ||
      verified.itemCount !== plan.replacementItemCount
    ) {
      throw new Error('Post-commit stash verification did not match the committed ingest.')
    }

    return {
      operationId,
      status: 'committed',
      ingested: plan.items.map((item, index) => ({
        vaultItemId: vaultItemIds[index]!,
        baseRecord: item.baseRecord,
        seed: item.seed
      })),
      sourceItems: plan.sourceItemCount,
      remainingItems: verified.itemCount,
      lastTabItems: verified.tabs.at(-1)?.items.length ?? 0,
      sourceSha256: plan.sourceSha256,
      committedSha256: committed.transaction.committedSha256,
      backupPath: committed.transaction.backupPath,
      rollbackPath: committed.transaction.rollbackPath
    }
  } catch (error) {
    if (prepared) {
      database.failIngestOperation(operationId, error)
    }
    throw error
  }
}

async function runRetrievalPlanCommand(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  command: RetrievalPlanCommand
): Promise<void> {
  try {
    const vaultItems = database.getVaultItems(
      command.vaultItemIds,
      isHardcoreStashPath(command.path)
    )
    const unavailable = vaultItems.filter((item) => item.state !== 'ingested')
    if (unavailable.length > 0) {
      throw new Error(
        'Vault items are not available for retrieval: ' + unavailable.map((item) => item.id).join(', ')
      )
    }
    const plan = await helper.request<RetrievalPlan>('plan-retrieve-items', {
      path: command.path,
      targetTabIndex: command.targetTabIndex,
      items: vaultItems.map((item) => item.payload)
    })
    if (
      !plan.restoredExactly ||
      !plan.semanticallyValid ||
      !plan.idempotent ||
      plan.replacementItemCount !== plan.sourceItemCount + vaultItems.length
    ) {
      throw new Error('Retrieval plan failed its item and serializer invariants.')
    }

    console.log(
      JSON.stringify({
        status: 'planned',
        vaultItemIds: command.vaultItemIds,
        ...plan
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

async function runRetrievalCommand(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  command: RetrievalCommand
): Promise<void> {
  try {
    console.log(JSON.stringify(await executeRetrievalCommand(helper, database, command)))
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

async function executeRetrievalCommand(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  command: RetrievalCommand
): Promise<RetrievalResult> {
  const operationId = randomUUID()
  let prepared = false
  let commitAttempted = false
  try {
    const safety = await helper.request<WriteSafetyStatus>('inspect-write-safety')
    if (!safety.permitted) {
      throw new Error('Write safety gate refused permission: ' + safety.reasons.join(' '))
    }

    const vaultItems = database.getVaultItems(
      command.vaultItemIds,
      isHardcoreStashPath(command.path)
    )
    const unavailable = vaultItems.filter((item) => item.state !== 'ingested')
    if (unavailable.length > 0) {
      throw new Error(
        'Vault items are not available for retrieval: ' + unavailable.map((item) => item.id).join(', ')
      )
    }
    const payloads = vaultItems.map((item) => item.payload)
    const plan = await helper.request<RetrievalPlan>('plan-retrieve-items', {
      path: command.path,
      targetTabIndex: command.targetTabIndex,
      items: payloads
    })
    if (
      plan.sourceSha256.toLowerCase() !== command.expectedSourceSha256.toLowerCase() ||
      !plan.restoredExactly ||
      !plan.semanticallyValid ||
      !plan.idempotent ||
      plan.replacementItemCount !== plan.sourceItemCount + vaultItems.length
    ) {
      throw new Error('Retrieval plan no longer matches the approved source and transformation.')
    }

    database.prepareRetrievalOperation({
      operationId,
      stashPath: plan.path,
      sourceSha256: plan.sourceSha256,
      startedAtUtc: new Date().toISOString(),
      vaultItemIds: command.vaultItemIds,
      detail: {
        phase: 'prepared',
        targetTabIndex: command.targetTabIndex,
        replacementSha256: plan.replacementSha256,
        sourceItemCount: plan.sourceItemCount,
        replacementItemCount: plan.replacementItemCount,
        vaultItemIds: command.vaultItemIds
      }
    })
    prepared = true

    commitAttempted = true
    const committed = await helper.request<CommittedRetrieval>('commit-retrieve-items', {
      operationId,
      path: plan.path,
      expectedSourceSha256: plan.sourceSha256,
      targetTabIndex: command.targetTabIndex,
      items: payloads,
      backupDirectory: join(app.getPath('userData'), 'backups')
    })
    if (
      committed.transaction.sourceSha256.toLowerCase() !== plan.sourceSha256.toLowerCase() ||
      committed.transaction.committedSha256.toLowerCase() !== plan.replacementSha256.toLowerCase()
    ) {
      throw new Error('Committed retrieval hashes do not match the persisted plan.')
    }

    const verified = await helper.request<{
      sha256: string
      itemCount: number
      tabs: Array<{ items: Array<{ baseRecord: string; seed: number }> }>
    }>('scan-transfer-stash', { path: plan.path })
    const targetItems = verified.tabs[command.targetTabIndex]?.items ?? []
    if (
      verified.sha256.toLowerCase() !== committed.transaction.committedSha256.toLowerCase() ||
      verified.itemCount !== plan.replacementItemCount ||
      targetItems.length !== plan.items.length ||
      !targetItems.every((item, index) => {
        const planned = plan.items[index]
        return planned !== undefined && item.baseRecord === planned.baseRecord && item.seed === planned.seed
      })
    ) {
      throw new Error('Post-commit stash verification did not match the committed retrieval.')
    }

    const completedAtUtc = new Date().toISOString()
    database.completeRetrievalOperation({
      operationId,
      backupPath: committed.transaction.backupPath,
      completedAtUtc,
      vaultItemIds: command.vaultItemIds,
      detail: {
        phase: 'committed',
        targetTabIndex: command.targetTabIndex,
        replacementSha256: committed.transaction.committedSha256,
        rollbackPath: committed.transaction.rollbackPath,
        vaultItemIds: command.vaultItemIds
      }
    })

    return {
      operationId,
      status: 'committed',
      retrieved: plan.items.map((item, index) => ({
        vaultItemId: command.vaultItemIds[index]!,
        baseRecord: item.baseRecord,
        seed: item.seed
      })),
      sourceItems: plan.sourceItemCount,
      remainingItems: verified.itemCount,
      targetTabItems: targetItems.length,
      sourceSha256: plan.sourceSha256,
      committedSha256: committed.transaction.committedSha256,
      backupPath: committed.transaction.backupPath,
      rollbackPath: committed.transaction.rollbackPath
    }
  } catch (error) {
    if (prepared) {
      if (commitAttempted) {
        database.markRetrievalNeedsRecovery(operationId, error)
      } else {
        database.failRetrievalOperation(operationId, command.vaultItemIds, error)
      }
    }
    throw error
  }
}

async function inspectStagingTab(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  path: string
): Promise<StagingTabInspection> {
  const scan = await helper.request<TransferStashScan>('scan-transfer-stash', { path })
  const lastTab = scan.tabs.at(-1)
  if (!lastTab) throw new Error('The selected transfer stash has no tabs.')
  const names = database.getCatalogNames(lastTab.items.map((item) => item.baseRecord))
  return {
    path: scan.path,
    sha256: scan.sha256,
    tabIndex: lastTab.index,
    tabCount: scan.tabs.length,
    itemCount: lastTab.items.length,
    totalItemCount: scan.itemCount,
    items: lastTab.items.map((item) => ({
      tabIndex: item.tabIndex,
      itemIndex: item.itemIndex,
      baseRecord: item.baseRecord,
      name: names.get(item.baseRecord.toLowerCase()) ?? item.baseRecord,
      seed: item.seed,
      supported: names.has(item.baseRecord.toLowerCase())
    }))
  }
}

async function executeStagingTabIngest(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  path: string
): Promise<IngestResult> {
  const staging = await inspectStagingTab(helper, database, path)
  if (staging.items.length === 0) {
    throw new Error('The final stash tab is empty; there is nothing staged for ingest.')
  }
  const unsupported = staging.items.filter((item) => !item.supported)
  if (unsupported.length > 0) {
    throw new Error(
      'The staging tab contains items that Cairn cannot archive: ' +
        unsupported.map((item) => item.name).join(', ')
    )
  }
  return executeIngestCommand(helper, database, {
    path: staging.path,
    expectedSourceSha256: staging.sha256,
    items: staging.items.map((item) => ({
      tabIndex: item.tabIndex,
      itemIndex: item.itemIndex,
      expectedSeed: item.seed
    }))
  })
}

async function executeLastTabRetrieval(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  path: string,
  vaultItemIds: string[]
): Promise<RetrievalResult> {
  if (vaultItemIds.length === 0) throw new Error('Select at least one vault item to retrieve.')
  const staging = await inspectStagingTab(helper, database, path)
  if (staging.itemCount !== 0) {
    throw new Error('The final stash tab must be empty before retrieving an item.')
  }
  return executeRetrievalCommand(helper, database, {
    path: staging.path,
    expectedSourceSha256: staging.sha256,
    targetTabIndex: staging.tabIndex,
    vaultItemIds
  })
}

async function readWindowState(): Promise<PersistedWindowState | null> {
  try {
    const parsed = JSON.parse(
      await readFile(join(app.getPath('userData'), 'window-state.json'), 'utf8')
    ) as Partial<PersistedWindowState>
    if (
      !Number.isFinite(parsed.x) ||
      !Number.isFinite(parsed.y) ||
      !Number.isFinite(parsed.width) ||
      !Number.isFinite(parsed.height)
    ) return null
    return {
      x: parsed.x!,
      y: parsed.y!,
      width: Math.max(960, parsed.width!),
      height: Math.max(640, parsed.height!),
      maximized: parsed.maximized === true
    }
  } catch {
    return null
  }
}

function visibleWindowBounds(state: PersistedWindowState | null): Electron.Rectangle | null {
  if (!state) return null
  const requested = { x: state.x, y: state.y, width: state.width, height: state.height }
  const display = screen.getAllDisplays().find(({ workArea }) =>
    requested.x < workArea.x + workArea.width &&
    requested.x + requested.width > workArea.x &&
    requested.y < workArea.y + workArea.height &&
    requested.y + requested.height > workArea.y
  )
  if (!display) return null
  const width = Math.min(requested.width, display.workArea.width)
  const height = Math.min(requested.height, display.workArea.height)
  return {
    x: Math.min(Math.max(requested.x, display.workArea.x), display.workArea.x + display.workArea.width - width),
    y: Math.min(Math.max(requested.y, display.workArea.y), display.workArea.y + display.workArea.height - height),
    width,
    height
  }
}

function rememberWindowState(window: BrowserWindow): void {
  if (process.env.CAIRN_CODEX_SCREENSHOT_PATH) return
  const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds()
  void writeFile(
    join(app.getPath('userData'), 'window-state.json'),
    JSON.stringify({ ...bounds, maximized: window.isMaximized() } satisfies PersistedWindowState)
  ).catch((error) => console.warn('Could not persist window placement.', error))
}

async function createWindow(): Promise<void> {
  const screenshotPath = process.env.CAIRN_CODEX_SCREENSHOT_PATH
  const savedState = screenshotPath ? null : await readWindowState()
  const savedBounds = visibleWindowBounds(savedState)
  const window = new BrowserWindow({
    width: savedBounds?.width ?? 1280,
    height: savedBounds?.height ?? 800,
    ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#10100f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !screenshotPath
    }
  })
  window.setMenuBarVisibility(false)
  window.setAutoHideMenuBar(true)
  if (savedState?.maximized) window.maximize()

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleWindowStateSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => rememberWindowState(window), 250)
  }
  window.on('resize', scheduleWindowStateSave)
  window.on('move', scheduleWindowStateSave)
  window.on('maximize', scheduleWindowStateSave)
  window.on('unmaximize', scheduleWindowStateSave)
  window.on('close', () => rememberWindowState(window))

  const revealWindow = (): void => {
    if (screenshotPath || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
  window.once('ready-to-show', revealWindow)
  window.webContents.once('did-finish-load', revealWindow)
  if (!screenshotPath) setTimeout(revealWindow, 1500)

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  window.webContents.on('did-fail-load', (_event, code, description) => {
    console.error('[window] renderer load failed', { code, description })
  })

  if (screenshotPath) {
    window.webContents.once('did-finish-load', () => {
      void captureWindowWhenReady(window, screenshotPath)
    })
  }
}

async function captureWindowWhenReady(window: BrowserWindow, path: string): Promise<void> {
  const captureStartedAt = Date.now()
  const interactionTimings: Record<string, number> = {}
  try {
    const requestedHeight = Number.parseInt(
      process.env.CAIRN_CODEX_SCREENSHOT_HEIGHT ?? '',
      10
    )
    const screenshotHeight = Number.isFinite(requestedHeight)
      ? Math.min(Math.max(requestedHeight, 720), 2400)
      : 1000
    window.setContentSize(1440, screenshotHeight)
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const scanError = await window.webContents.executeJavaScript(
        "document.querySelector('.scan-error')?.textContent"
      )
      if (scanError) throw new Error('Renderer collection scan failed: ' + scanError)
      const ready = await window.webContents.executeJavaScript(
        `Boolean(document.querySelector('.catalog-grid, .set-grid')) &&
         (!document.querySelector('.primary-action')?.disabled ||
          Boolean(document.querySelector('.background-scan'))) &&
         (${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_WAIT_FOR_SCAN === '1')}
           ? !document.querySelector('.background-scan')
           : true)`
      )
      if (ready) {
        const category = process.env.CAIRN_CODEX_SCREENSHOT_CATEGORY
        if (category) {
          interactionTimings.categoryMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              ;[...document.querySelectorAll('.workspace-tabs button, .category-tabs button, .system-nav button')]
                .find((button) =>
                  (button.querySelector('span')?.textContent ?? button.textContent)?.trim() === ${JSON.stringify(category)})
                ?.click()
              await new Promise((resolve) => setTimeout(resolve, 0))
              return performance.now() - started
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_COLLAPSE_TRACKERS === '1') {
          await window.webContents.executeJavaScript(`
            (() => {
              const toggle = document.querySelector('.completion-tracker > header button')
              if (toggle?.getAttribute('aria-expanded') === 'true') toggle.click()
            })()
          `)
        } else if (process.env.CAIRN_CODEX_SCREENSHOT_EXPAND_TRACKERS === '1') {
          await window.webContents.executeJavaScript(`
            (() => {
              const toggle = document.querySelector('.completion-tracker > header button')
              if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click()
            })()
          `)
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_PLANNER_MAP === '1') {
          await window.webContents.executeJavaScript(
            "document.querySelector('.planner-display button:last-child')?.click()"
          )
        }
        const skillScope = process.env.CAIRN_CODEX_SCREENSHOT_SKILL_SCOPE
        if (skillScope) {
          await window.webContents.executeJavaScript(`
            [...document.querySelectorAll('.skill-scope button')]
              .find((button) => button.textContent?.trim() === ${JSON.stringify(skillScope)})
              ?.click()
          `)
        }
        const skillQuery = process.env.CAIRN_CODEX_SCREENSHOT_SKILL_QUERY
        if (skillQuery) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          await window.webContents.executeJavaScript(`
            (() => {
              const input = document.querySelector('.skill-combobox input')
              if (!input) return
              input.value = ${JSON.stringify(skillQuery)}
              input.dispatchEvent(new Event('input', { bubbles: true }))
              input.focus()
              if (${JSON.stringify(process.env.CAIRN_CODEX_SCREENSHOT_SKILL_SELECT_FIRST === '1')}) {
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
              }
            })()
          `)
        }
        const query = process.env.CAIRN_CODEX_SCREENSHOT_QUERY
        if (query) {
          interactionTimings.searchMs = await window.webContents.executeJavaScript(`
            (async () => {
              const started = performance.now()
              const input = document.querySelector('.search-field input')
              if (input) {
                input.value = ${JSON.stringify(query)}
                input.dispatchEvent(new Event('input', { bubbles: true }))
              }
              await new Promise((resolve) => setTimeout(resolve, 150))
              await new Promise((resolve) => setTimeout(resolve, 0))
              return performance.now() - started
            })()
          `)
        }
        const scrollTarget = process.env.CAIRN_CODEX_SCREENSHOT_SCROLL_TARGET
        if (scrollTarget) {
          await window.webContents.executeJavaScript(`
            (() => {
              const target = document.querySelector(${JSON.stringify(scrollTarget)})
              if (!target) return window.scrollTo(0, 0)
              const topbar = document.querySelector('.topbar')
              const offset = (topbar?.getBoundingClientRect().height ?? 0) + 12
              window.scrollTo(0, Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset))
            })()
          `)
        } else {
          await window.webContents.executeJavaScript('window.scrollTo(0, 0)')
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_OPEN_FIRST === '1') {
          await new Promise((resolve) => setTimeout(resolve, 250))
          await window.webContents.executeJavaScript(
            "document.querySelector('.item-card[role=button], .set-card li button')?.click()"
          )
        }
        if (process.env.CAIRN_CODEX_SCREENSHOT_HOVER_FIRST === '1') {
          await new Promise((resolve) => setTimeout(resolve, 250))
          await window.webContents.executeJavaScript(`
            (() => {
              const card = document.querySelector('.item-card[role=button], .set-card li button, .planner-table tbody tr, .atlas-item-list button')
              if (!card) return
              const rect = card.getBoundingClientRect()
              card.dispatchEvent(new MouseEvent('mouseenter', {
                bubbles: false,
                clientX: rect.right - 20,
                clientY: rect.top + 30
              }))
            })()
          `)
        }
        window.setOpacity(0)
        window.showInactive()
        window.webContents.invalidate()
        await new Promise((resolve) => setTimeout(resolve, 1000))
        const renderedState = await window.webContents.executeJavaScript(`({
          heading: document.querySelector('.hero h2')?.textContent,
          results: document.querySelector('.result-count')?.textContent,
          cards: document.querySelectorAll('.item-card').length,
          sets: document.querySelectorAll('.set-card').length,
          copyCards: document.querySelectorAll('.copy-card').length,
          drawer: document.querySelector('.item-drawer h2')?.textContent?.trim(),
          tooltip: document.querySelector('.game-tooltip')?.textContent?.trim(),
          tooltipRect: (() => {
            const tooltip = document.querySelector('.game-tooltip')
            if (!tooltip) return null
            const rect = tooltip.getBoundingClientRect()
            return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }
          })(),
          cacheIssue: document.querySelector('.app-shell')?.getAttribute('data-cache-issue'),
          cacheApi: typeof window.cairnCodex?.getCachedCollection,
          icons: [...document.querySelectorAll('.item-mark img')].map((image) => ({
            src: image.getAttribute('src'),
            complete: image.complete,
            width: image.naturalWidth,
            height: image.naturalHeight
          })),
          scrollX: window.scrollX,
          titleX: document.querySelector('.topbar > div')?.getBoundingClientRect().x,
          mainX: document.querySelector('main')?.getBoundingClientRect().x
        })`)
        const performanceReport = {
          readyMs: Date.now() - captureStartedAt,
          interactions: interactionTimings,
          renderedState
        }
        const image = await window.webContents.capturePage()
        await writeFile(path, image.toPNG())
        if (process.env.CAIRN_CODEX_PERF_REPORT_PATH) {
          await writeFile(
            process.env.CAIRN_CODEX_PERF_REPORT_PATH,
            JSON.stringify(performanceReport, null, 2)
          )
        }
        console.log(
          JSON.stringify({ screenshotPath: path, width: 1440, height: 1000, ...performanceReport })
        )
        app.quit()
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    const diagnostic = await window.webContents.executeJavaScript(`({
      heading: document.querySelector('.hero h2')?.textContent,
      scanError: document.querySelector('.scan-error')?.textContent,
      scanDisabled: document.querySelector('.primary-action')?.disabled,
          backgroundScan: document.querySelector('.background-scan')?.textContent,
          cacheIssue: document.querySelector('.app-shell')?.getAttribute('data-cache-issue'),
          cacheApi: typeof window.cairnCodex?.getCachedCollection,
      cards: document.querySelectorAll('.item-card').length,
      text: document.body.innerText.slice(0, 500)
    })`)
    throw new Error(
      'Renderer did not finish its collection scan before screenshot timeout: ' +
        JSON.stringify(diagnostic)
    )
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
}

// Automated diagnostics run in disposable processes and must not be mistaken
// for user-launched second instances while the ordinary app is open.
const hasSingleInstanceLock = process.env.CAIRN_CODEX_SCREENSHOT_PATH || process.env.CAIRN_CODEX_SMOKE_TEST === '1'
  ? true
  : app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  console.log('[startup] Electron ready; opening Cairn Codex services.')
  Menu.setApplicationMenu(null)
  registerItemIconProtocol()
  console.log('[startup] Item icon protocol registered.')
  const helper = createHelperClient()
  const databaseOverride = process.env.CAIRN_CODEX_DATABASE_PATH
  const databasePath = process.env.CAIRN_CODEX_SMOKE_TEST === '1'
    ? ':memory:'
    : databaseOverride ?? join(app.getPath('userData'), 'cairn-codex.sqlite3')
  const archiveBackupDirectory = process.env.CAIRN_CODEX_ARCHIVE_BACKUP_DIR ??
    join(app.getPath('userData'), 'archive-backups')
  if (databasePath !== ':memory:') {
    try {
      const restored = await ArchiveBackupService.applyPendingRestore(
        databasePath,
        archiveBackupDirectory
      )
      if (restored) console.log('[startup] Staged archive restore applied and verified.')
    } catch (error) {
      const quarantined = await ArchiveBackupService.quarantinePendingRestore(
        archiveBackupDirectory
      ).catch(() => null)
      console.error(
        '[startup] Staged archive restore was rejected; the current archive was preserved.' +
        (quarantined ? ` Request quarantined at ${quarantined}.` : ''),
        error
      )
    }
  }
  const database = new CollectionDatabase(databasePath)
  console.log('[startup] Collection database ready.')

  const ingestCommand = process.env.CAIRN_CODEX_INGEST_REQUEST
  if (ingestCommand) {
    void runIngestCommand(helper, database, JSON.parse(ingestCommand) as IngestCommand)
    return
  }

  const gdiaImportPath = process.env.CAIRN_CODEX_IMPORT_GDIA
  if (gdiaImportPath) {
    void migrateGdiaDatabase(
      database,
      gdiaImportPath,
      process.env.CAIRN_CODEX_MIGRATION_BACKUP_DIR ??
        join(app.getPath('userData'), 'migrations', 'gdia'),
      { requireAllCatalogued: false }
    )
      .then((result) => {
        console.log(JSON.stringify({ migration: 'gdia', ...result }))
        helper.dispose()
        database.close()
        app.exit(0)
      })
      .catch((error) => {
        console.error(error)
        helper.dispose()
        database.close()
        app.exit(1)
      })
    return
  }

  const retrievalPlanCommand = process.env.CAIRN_CODEX_RETRIEVAL_PLAN_REQUEST
  if (retrievalPlanCommand) {
    void runRetrievalPlanCommand(
      helper,
      database,
      JSON.parse(retrievalPlanCommand) as RetrievalPlanCommand
    )
    return
  }

  const retrievalCommand = process.env.CAIRN_CODEX_RETRIEVE_REQUEST
  if (retrievalCommand) {
    void runRetrievalCommand(
      helper,
      database,
      JSON.parse(retrievalCommand) as RetrievalCommand
    )
    return
  }

  if (process.env.CAIRN_CODEX_SMOKE_TEST === '1') {
    void runSmokeTest(helper, database)
    return
  }

  const archiveBackups = new ArchiveBackupService(
    database,
    databasePath,
    archiveBackupDirectory
  )
  const flushIpcWrites = registerIpcHandlers(helper, database, archiveBackups)
  console.log('[startup] IPC handlers registered; creating the main window.')
  void createWindow()
  void archiveBackups.ensureStartupBackup()
    .then((backup) => {
      if (backup) console.log(`[archive-backup] verified ${backup.fileName}`)
    })
    .catch((error) => console.error('[archive-backup] automatic daily backup failed', error))

  let shutdownReady = false
  app.on('before-quit', (event) => {
    if (shutdownReady) return
    event.preventDefault()
    void flushIpcWrites()
      .catch((error) => console.error('[shutdown] queued archive work failed', error))
      .finally(() => {
        helper.dispose()
        database.close()
        shutdownReady = true
        app.quit()
      })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
