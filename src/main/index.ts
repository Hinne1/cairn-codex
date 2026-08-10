import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { app, BrowserWindow, ipcMain } from 'electron'
import {
  IPC_CHANNELS,
  type AppStatus,
  type CollectionSnapshot,
  type GrimDawnDiscovery
} from '@shared/contracts'
import { GrimDawnHelperClient } from './grim-dawn/helper-client'
import { CollectionDatabase } from './collection-database'

interface IngestCommand {
  path: string
  expectedSourceSha256: string
  items: Array<{ tabIndex: number; itemIndex: number; expectedSeed: number }>
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
      detail: { phase: 'committed', smokeTest: true }
    })
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
    if (database.getVaultItems([journalVaultItemId])[0]?.state !== 'retrieved') {
      throw new Error('Vault item did not enter retrieved state.')
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
    console.log(
      JSON.stringify({
        helper: 'available',
        writeTransaction: 'verified',
        serializerRoundTrips: roundTrips.length,
        ingestPlans: ingestPlans.length,
        retrievalRoundTrips: retrievalRoundTrips.length,
        retrievalJournal: 'verified',
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
  const operationId = randomUUID()
  let prepared = false
  try {
    const safety = await helper.request<{ permitted: boolean; reasons: string[] }>(
      'inspect-write-safety'
    )
    if (!safety.permitted) {
      throw new Error('Write safety gate refused permission: ' + safety.reasons.join(' '))
    }

    const snapshot = await helper.request<CollectionSnapshot>('scan-collection')
    database.persistSnapshot(snapshot)
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

    console.log(
      JSON.stringify({
        operationId,
        status: 'committed',
        ingested: plan.items.map((item, index) => ({
          vaultItemId: vaultItemIds[index],
          baseRecord: item.baseRecord,
          seed: item.seed
        })),
        sourceItems: plan.sourceItemCount,
        remainingItems: verified.itemCount,
        lastTabItems: verified.tabs.at(-1)?.items.length ?? null,
        sourceSha256: plan.sourceSha256,
        committedSha256: committed.transaction.committedSha256,
        backupPath: committed.transaction.backupPath,
        rollbackPath: committed.transaction.rollbackPath
      })
    )
    helper.dispose()
    database.close()
    app.exit(0)
  } catch (error) {
    if (prepared) {
      database.failIngestOperation(operationId, error)
    }
    console.error(error)
    helper.dispose()
    database.close()
    app.exit(1)
  }
}

async function runRetrievalPlanCommand(
  helper: GrimDawnHelperClient,
  database: CollectionDatabase,
  command: RetrievalPlanCommand
): Promise<void> {
  try {
    const vaultItems = database.getVaultItems(command.vaultItemIds)
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
  const operationId = randomUUID()
  let prepared = false
  let commitAttempted = false
  try {
    const safety = await helper.request<{ permitted: boolean; reasons: string[] }>(
      'inspect-write-safety'
    )
    if (!safety.permitted) {
      throw new Error('Write safety gate refused permission: ' + safety.reasons.join(' '))
    }

    const vaultItems = database.getVaultItems(command.vaultItemIds)
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

    console.log(
      JSON.stringify({
        operationId,
        status: 'committed',
        retrieved: plan.items.map((item, index) => ({
          vaultItemId: command.vaultItemIds[index],
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
      })
    )
    helper.dispose()
    database.close()
    app.exit(0)
  } catch (error) {
    if (prepared) {
      if (commitAttempted) {
        database.markRetrievalNeedsRecovery(operationId, error)
      } else {
        database.failRetrievalOperation(operationId, command.vaultItemIds, error)
      }
    }
    console.error(error)
    helper.dispose()
    database.close()
    app.exit(1)
  }
}

function createWindow(): void {
  const screenshotPath = process.env.CAIRN_CODEX_SCREENSHOT_PATH
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
      sandbox: true,
      backgroundThrottling: !screenshotPath
    }
  })

  window.once('ready-to-show', () => {
    if (!screenshotPath) window.show()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (screenshotPath) {
    window.webContents.once('did-finish-load', () => {
      void captureWindowWhenReady(window, screenshotPath)
    })
  }
}

async function captureWindowWhenReady(window: BrowserWindow, path: string): Promise<void> {
  try {
    window.setContentSize(1440, 1000)
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const ready = await window.webContents.executeJavaScript(
        `Boolean(document.querySelector('.catalog-grid, .set-grid')) &&
         !document.querySelector('.primary-action')?.disabled`
      )
      if (ready) {
        const category = process.env.CAIRN_CODEX_SCREENSHOT_CATEGORY
        if (category) {
          await window.webContents.executeJavaScript(`
            [...document.querySelectorAll('.category-tabs button')]
              .find((button) => button.querySelector('span')?.textContent === ${JSON.stringify(category)})
              ?.click()
          `)
        }
        await window.webContents.executeJavaScript('window.scrollTo(0, 0)')
        window.setOpacity(0)
        window.showInactive()
        window.webContents.invalidate()
        await new Promise((resolve) => setTimeout(resolve, 1000))
        const renderedState = await window.webContents.executeJavaScript(`({
          heading: document.querySelector('.hero h2')?.textContent,
          results: document.querySelector('.result-count')?.textContent,
          cards: document.querySelectorAll('.item-card').length,
          sets: document.querySelectorAll('.set-card').length,
          scrollX: window.scrollX,
          titleX: document.querySelector('.topbar > div')?.getBoundingClientRect().x,
          mainX: document.querySelector('main')?.getBoundingClientRect().x
        })`)
        const image = await window.webContents.capturePage()
        await writeFile(path, image.toPNG())
        console.log(
          JSON.stringify({ screenshotPath: path, width: 1440, height: 1000, renderedState })
        )
        app.quit()
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error('Renderer did not finish its collection scan before screenshot timeout.')
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
}

app.whenReady().then(() => {
  const helper = createHelperClient()
  const database = new CollectionDatabase(
    process.env.CAIRN_CODEX_SMOKE_TEST === '1'
      ? ':memory:'
      : join(app.getPath('userData'), 'cairn-codex.sqlite3')
  )

  const ingestCommand = process.env.CAIRN_CODEX_INGEST_REQUEST
  if (ingestCommand) {
    void runIngestCommand(helper, database, JSON.parse(ingestCommand) as IngestCommand)
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
