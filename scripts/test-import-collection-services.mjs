import assert from 'node:assert/strict'
import { BackgroundJobCoordinator } from '../src/main/background-jobs.ts'
import { runCollectionRefresh } from '../src/main/ipc/collection-refresh-jobs.ts'
import { CollectionSession } from '../src/renderer/src/collection-session.ts'
import {
  ItemAssistantImportCanceledError,
  ItemAssistantImportInProgressError,
  ItemAssistantImportService,
  migrationOptionsFromRequest
} from '../src/main/ipc/import-service.ts'
import {
  ARCHIVE_ROLL_HYDRATION_BATCH_LIMIT,
  CollectionService,
  preserveUnavailableCollectionKnowledge
} from '../src/main/ipc/collection-service.ts'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function collectionSnapshot(name = 'fixture') {
  return {
    catalogPresentationVersion: 7,
    scannedAtUtc: '2026-09-01T12:00:00.000Z',
    discovery: {
      installations: [{
        path: `C:/fixtures/${name}`,
        source: 'steam',
        databasePath: `C:/fixtures/${name}/database`
      }],
      saveLocations: [],
      warnings: []
    },
    contentPacks: [],
    scannedStashes: [],
    observedItems: [],
    warnings: [],
    rarities: [],
    items: [],
    recipeSummary: { total: 0, collected: 0, unlockedItems: 0 },
    affixSummary: { total: 0, collected: 0, availableCopies: 0 },
    affixes: [],
    fixtureName: name
  }
}

function importAnalysis() {
  return {
    preflight: {
      sourcePath: 'C:/fixtures/userdata.db',
      sourceSha256: 'source-hash',
      sourceItems: 2,
      sourceDatabaseItems: 2,
      sourceQueueItems: 0,
      sourceHardcoreItems: 1,
      sourceSoftcoreItems: 1,
      unsupportedItems: 0,
      backupBytes: 100,
      sourceBackupRequiredBytes: 100,
      queueReceiptBytes: 0,
      archiveGrowthReserveBytes: 200,
      archiveBackupReserveBytes: 200,
      requiredFreeBytes: 600,
      availableFreeBytes: 1_000,
      backupReused: false,
      destinationMode: 'fixture'
    },
    queueFingerprint: 'queue-hash'
  }
}

function importDependencies(overrides = {}) {
  let now = 1_000
  return {
    collection: { readCollection: async () => collectionSnapshot() },
    sourcePicker: { pickDatabase: async () => 'C:/fixtures/userdata.db' },
    analyzer: { analyze: async () => importAnalysis() },
    reviewer: { confirm: async () => true },
    committer: {
      commit: async ({ onStage, onArchiveMutationCommitted }) => {
        onStage('verifying')
        onStage('importing')
        onArchiveMutationCommitted()
        onStage('finalizing')
        return {
          sourceItems: 2,
          sourceDatabaseItems: 2,
          sourceQueueItems: 0,
          sourceHardcoreItems: 1,
          sourceSoftcoreItems: 1,
          sourceSha256: 'source-hash',
          backupPath: 'C:/fixtures/backup.db',
          backupReused: false,
          importedIds: ['one'],
          duplicateIds: ['two'],
          unsupportedIds: []
        }
      }
    },
    receipts: { write: async () => undefined },
    backups: { enqueue: () => undefined },
    diagnostics: { reportFailure: () => undefined },
    clock: {
      nowMs: () => now++,
      nowUtc: () => '2026-09-01T12:00:01.000Z'
    },
    runExclusive: async (operation) => operation(),
    ...overrides
  }
}

// A second interactive import is rejected instead of sharing caller-specific
// selection/progress state with the active request.
{
  const selection = deferred()
  const service = new ItemAssistantImportService(importDependencies({
    sourcePicker: { pickDatabase: () => selection.promise }
  }))
  const request = {
    cancellation: { isCancellationRequested: () => false },
    publishProgress: () => undefined
  }
  const first = service.start(request)
  await Promise.resolve()
  await assert.rejects(
    service.start(request),
    (error) => error instanceof ItemAssistantImportInProgressError &&
      error.code === 'import.already-running'
  )
  selection.resolve(null)
  assert.equal((await first).canceled, true)
}

// Cancellation after preflight but before confirmation returns must prevent the
// mutation dependency from being invoked.
{
  let cancellationRequested = false
  let commitCalls = 0
  const stages = []
  const service = new ItemAssistantImportService(importDependencies({
    analyzer: {
      analyze: async () => {
        cancellationRequested = true
        return importAnalysis()
      }
    },
    committer: {
      commit: async () => {
        commitCalls += 1
        throw new Error('must not run')
      }
    }
  }))
  await assert.rejects(
    service.start({
      cancellation: { isCancellationRequested: () => cancellationRequested },
      publishProgress: (progress) => stages.push(progress.stage)
    }),
    (error) => error instanceof ItemAssistantImportCanceledError &&
      error.code === 'import.canceled-before-mutation'
  )
  assert.equal(commitCalls, 0, 'cancellation must settle before mutation starts')
  assert.deepEqual(stages, ['selecting', 'analyzing', 'canceled'])
}

// A failure after the low-level archive commit still queues exactly one
// protective backup and reports the post-mutation failure state.
{
  const backups = []
  const stages = []
  const writeOrder = []
  const service = new ItemAssistantImportService(importDependencies({
    committer: {
      commit: async (request) => {
        writeOrder.push('commit')
        const options = migrationOptionsFromRequest(request)
        options.onStage('importing')
        options.onArchiveMutationCommitted()
        options.onStage('finalizing')
        throw new Error('receipt publication failed after archive commit')
      }
    },
    backups: { enqueue: (reason) => backups.push(reason) },
    runExclusive: async (operation) => {
      writeOrder.push('exclusive')
      return operation()
    }
  }))
  await assert.rejects(
    service.start({
      cancellation: { isCancellationRequested: () => false },
      publishProgress: (progress) => stages.push(progress)
    }),
    /receipt publication failed after archive commit/
  )
  assert.deepEqual(backups, ['Item Assistant migration'])
  assert.deepEqual(writeOrder, ['exclusive', 'commit'])
  assert.equal(stages.at(-1).stage, 'failed')
  assert.match(stages.at(-1).detail, /protective backup was queued/)
}

function collectionDependencies(overrides = {}) {
  const cached = collectionSnapshot('cached')
  return {
    cache: {
      read: async () => cached,
      write: async () => undefined
    },
    freshness: {
      isMapIndexFresh: async () => true,
      areSourcesFresh: async () => true
    },
    scanner: { scanInstalledData: async () => collectionSnapshot('scanned') },
    icons: {
      attachIcons: async (snapshot) => ({ ...snapshot, iconFixture: true })
    },
    maps: {
      attachLocations: async (snapshot, forceRebuild) => ({
        ...snapshot,
        mapFixture: forceRebuild ? 'rebuilt' : 'cached'
      })
    },
    archive: {
      persistSnapshot: (snapshot) => ({ ...snapshot, archiveFixture: true })
    },
    projector: {
      projectSources: (snapshot, sourcePaths) => ({ ...snapshot, projectedPaths: [...sourcePaths] }),
      present: async (snapshot, basis) => ({ ...snapshot, basis })
    },
    hydration: {
      hydrateAll: async () => ({ processed: 0, pending: 0 })
    },
    diagnostics: { reportMapIndexFailure: () => undefined },
    discovery: {
      discover: async () => collectionSnapshot('discovered').discovery,
      listCharacters: async (installationPath) => [{ name: 'Fixture', path: installationPath }]
    },
    preferences: {
      setPinnedBest: () => undefined,
      getInfiniteSupplies: () => false,
      setInfiniteSupplies: (enabled) => enabled,
      runExclusive: async (operation) => operation(),
      queueArchiveBackup: () => undefined
    },
    catalogPresentationVersion: 7,
    ...overrides
  }
}

// Production job coalescing shares the committed raw catalog, never the first
// caller's SC/HC selection or archive/stash presentation. Scan and rebuild stay distinct.
for (const kind of ['collection-scan', 'game-data-rebuild']) {
  const scanned = deferred()
  let scans = 0
  let writes = 0
  const rebuildFlags = []
  const dependencies = collectionDependencies({
    scanner: { scanInstalledData: () => { scans++; return scanned.promise } },
    cache: { read: async () => null, write: async () => { writes++ } },
    maps: { attachLocations: async (snapshot, rebuild) => { rebuildFlags.push(rebuild); return snapshot } }
  })
  const service = new CollectionService(dependencies)
  const jobs = new BackgroundJobCoordinator()
  const refresh = kind === 'collection-scan' ? () => service.scanCatalog() : () => service.rebuildCatalog()
  const callers = [
    { sourcePaths: ['C:/fixtures/transfer.gst'], basis: 'archive' },
    { sourcePaths: ['C:/fixtures/transfer.gsh'], basis: 'archive' },
    { sourcePaths: ['C:/fixtures/transfer.gst'], basis: 'stashes' },
    { sourcePaths: ['C:/fixtures/transfer.gsh'], basis: 'stashes' }
  ]
  const results = callers.map(caller => runCollectionRefresh(jobs, kind, refresh, snapshot => service.present(snapshot, caller)))
  await new Promise(resolve => setImmediate(resolve))
  const opposite = kind === 'collection-scan' ? 'game-data-rebuild' : 'collection-scan'
  await assert.rejects(runCollectionRefresh(jobs, opposite,
    () => opposite === 'collection-scan' ? service.scanCatalog() : service.rebuildCatalog(),
    snapshot => service.present(snapshot, callers[0])), { code: 'collection.refresh-already-running' })
  scanned.resolve(collectionSnapshot('shared-catalog'))
  const presented = await Promise.all(results)
  assert.equal(scans, 1)
  assert.equal(writes, 1)
  assert.deepEqual(rebuildFlags, [kind === 'game-data-rebuild'])
  assert.deepEqual(presented.map(value => ({ basis: value.basis, sourcePaths: value.projectedPaths })), callers)
  assert.equal(new Set(presented).size, callers.length, 'each caller receives its own presentation')
}

// A selected-source cache can complete before an older scan commits a new
// catalog. The production session must request a fresh current-context projection.
for (const kind of ['scan', 'rebuild']) {
  const scanned = deferred()
  const service = new CollectionService(collectionDependencies({
    scanner: { scanInstalledData: () => scanned.promise }
  }))
  const jobs = new BackgroundJobCoordinator()
  let context = { sourcePaths: ['C:/fixtures/transfer.gst'], basis: 'archive' }
  let visible
  let refreshed
  const session = new CollectionSession({
    context: () => context,
    install: value => { visible = value },
    pendingChanged: () => {}, reportError: error => { throw error },
    reload: () => { refreshed = readCache() }
  })
  const readCache = () => session.run('cache', async read => read.install(await service.getCached(read.context)))
  await readCache()
  const scan = session.run(kind, async read => read.install(await runCollectionRefresh(
    jobs, kind === 'scan' ? 'collection-scan' : 'game-data-rebuild',
    () => kind === 'scan' ? service.scanCatalog() : service.rebuildCatalog(),
    snapshot => service.present(snapshot, read.context)
  )))
  context = { sourcePaths: ['C:/fixtures/transfer.gsh'], basis: 'stashes' }
  session.contextChanged()
  await readCache()
  assert.equal(visible.fixtureName, 'cached')
  scanned.resolve(collectionSnapshot('new-catalog'))
  await scan
  await refreshed
  assert.equal(visible.fixtureName, 'new-catalog')
  assert.deepEqual(visible.projectedPaths, context.sourcePaths)
  assert.equal(visible.basis, 'stashes')
}

// Discovery and character enumeration are concrete collection service methods,
// not composition-root IPC closures.
{
  const service = new CollectionService(collectionDependencies())
  assert.equal((await service.discoverGrimDawn()).installations.length, 1)
  const characters = await service.listCharacters()
  assert.equal(characters.length, 1)
  assert.equal(characters[0].path, 'C:/fixtures/cached')
}

{
  const events = []
  const service = new CollectionService(collectionDependencies({
    preferences: {
      setPinnedBest: () => events.push('pin'),
      getInfiniteSupplies: () => true,
      setInfiniteSupplies: (enabled) => { events.push(`supplies:${enabled}`); return enabled },
      runExclusive: async (operation) => { events.push('exclusive'); return operation() },
      queueArchiveBackup: (reason) => events.push(`backup:${reason}`)
    }
  }))
  await service.setPinnedBest({ record: 'records/a.dbr', instanceKey: null, isHardcore: false })
  assert.equal(service.getInfiniteSupplies(), true)
  assert.equal(await service.setInfiniteSupplies({ enabled: false }), false)
  assert.deepEqual(events, [
    'exclusive', 'pin', 'backup:pinned copy changed',
    'exclusive', 'supplies:false', 'backup:supply settings changed'
  ])
}

// Cache persistence failure propagates and leaves the previously loaded snapshot
// visible instead of publishing an unpersisted refresh.
{
  const oldSnapshot = collectionSnapshot('old-cache')
  let presentCalls = 0
  const dependencies = collectionDependencies({
    cache: {
      read: async () => oldSnapshot,
      write: async () => { throw new Error('cache disk full') }
    }
  })
  dependencies.projector = {
    projectSources: (snapshot, sourcePaths) => ({ ...snapshot, projectedPaths: [...sourcePaths] }),
    present: async (snapshot, basis) => {
      presentCalls += 1
      return { ...snapshot, basis }
    }
  }
  const service = new CollectionService(dependencies)
  const initial = await service.getCached({ sourcePaths: ['old.gst'], basis: 'stashes' })
  assert.equal(initial.fixtureName, 'old-cache')
  await assert.rejects(
    service.scan({ sourcePaths: ['new.gst'], basis: 'stashes' }),
    /cache disk full/
  )
  const afterFailure = await service.getCached({ sourcePaths: ['old.gst'], basis: 'stashes' })
  assert.equal(afterFailure.fixtureName, 'old-cache')
  assert.equal(presentCalls, 2, 'failed persistence must not present the new scan')
}

// A stale or temporarily unreadable map index must not hide durable character/account
// knowledge. The caller receives the cache with an explicit refresh marker.
{
  const service = new CollectionService(collectionDependencies({
    freshness: {
      isMapIndexFresh: async () => false,
      areSourcesFresh: async () => true
    }
  }))
  const cached = await service.getCached({ sourcePaths: [], basis: 'stashes' })
  assert.equal(cached.fixtureName, 'cached')
  assert.equal(cached.cacheNeedsRefresh, true)
}

// Explicit read failures retain only the affected source. A successfully read
// empty source remains empty, rather than resurrecting an old quantity.
{
  const failedPath = 'C:/saves/failed.gst'
  const emptyPath = 'C:/saves/empty.gst'
  const previous = {
    ...collectionSnapshot('previous'),
    discovery: {
      ...collectionSnapshot('previous').discovery,
      saveLocations: [{ path: 'C:/saves', source: 'documents', transferStashes: [] }]
    },
    scannedStashes: [
      { path: failedPath, isHardcore: false, modLabel: '', itemCount: 1, lastWriteUtc: '2026-09-01T10:00:00Z', sha256: 'failed-old' },
      { path: emptyPath, isHardcore: false, modLabel: '', itemCount: 1, lastWriteUtc: '2026-09-01T10:00:00Z', sha256: 'empty-old' }
    ],
    observedItems: [
      { sourcePath: failedPath, baseRecord: 'records/failed.dbr' },
      { sourcePath: emptyPath, baseRecord: 'records/empty.dbr' }
    ],
    accountStores: [{
      path: 'C:/saves/reagents.gst', kind: 'reagents', isHardcore: false,
      itemCount: 2, lastWriteUtc: '2026-09-01T10:00:00Z', sha256: 'store-old',
      entries: [{ record: 'records/component.dbr', quantity: 2 }]
    }]
  }
  const current = {
    ...collectionSnapshot('current'),
    discovery: {
      ...collectionSnapshot('current').discovery,
      saveLocations: [{ path: 'C:/saves', source: 'documents', transferStashes: [] }]
    },
    scannedStashes: [
      { path: emptyPath, isHardcore: false, modLabel: '', itemCount: 0, lastWriteUtc: '2026-09-01T12:00:00Z', sha256: 'empty-new' }
    ],
    warnings: [
      { path: failedPath, message: 'locked' },
      { path: 'C:/saves/reagents.gst', message: 'locked' }
    ],
    accountStores: []
  }
  const reconciled = preserveUnavailableCollectionKnowledge(current, previous)
  assert.deepEqual(
    reconciled.scannedStashes.map((stash) => [stash.path, stash.itemCount]),
    [[emptyPath, 0], [failedPath, 1]]
  )
  assert.deepEqual(
    reconciled.observedItems.map((item) => item.baseRecord),
    ['records/failed.dbr'],
    'the successfully read empty stash must not retain its previous item'
  )
  assert.equal(reconciled.accountStores[0].entries[0].quantity, 2)
  assert.equal(reconciled.cacheNeedsRefresh, true)
  assert.equal(reconciled.cachedDataAsOfUtc, previous.scannedAtUtc)
}

// A source omitted from an otherwise successfully enumerated same save root was
// removed, not taken offline, and must not become immortal cached inventory.
{
  const root = 'C:/saves'
  const previous = {
    ...collectionSnapshot('before-deletion'),
    discovery: {
      ...collectionSnapshot('before-deletion').discovery,
      saveLocations: [{ path: root, source: 'documents', transferStashes: [] }]
    },
    scannedStashes: [{
      path: `${root}/transfer.gst`, isHardcore: false, modLabel: '', itemCount: 1,
      lastWriteUtc: '2026-09-01T10:00:00Z', sha256: 'deleted-stash'
    }],
    observedItems: [{ sourcePath: `${root}/transfer.gst`, baseRecord: 'records/deleted.dbr' }],
    accountStores: [{
      path: `${root}/reagents.gst`, kind: 'reagents', isHardcore: false, itemCount: 1,
      lastWriteUtc: '2026-09-01T10:00:00Z', sha256: 'deleted-store',
      entries: [{ record: 'records/deleted-component.dbr', quantity: 1 }]
    }]
  }
  const current = {
    ...collectionSnapshot('after-deletion'),
    discovery: {
      ...collectionSnapshot('after-deletion').discovery,
      saveLocations: [{ path: root, source: 'documents', transferStashes: [] }]
    }
  }
  const reconciled = preserveUnavailableCollectionKnowledge(current, previous)
  assert.deepEqual(reconciled.scannedStashes, [])
  assert.deepEqual(reconciled.observedItems, [])
  assert.deepEqual(reconciled.accountStores, [])
  assert.equal(reconciled.cacheNeedsRefresh, false)
}

// A newly discovered account root replaces a disappeared root of the same kind;
// quantities from different Steam accounts must never be combined implicitly.
{
  const previousRoot = 'D:/Steam/userdata/42/219990/remote/save'
  const currentRoot = 'D:/Steam/userdata/99/219990/remote/save'
  const previous = {
    ...collectionSnapshot('account-42'),
    discovery: {
      ...collectionSnapshot('account-42').discovery,
      saveLocations: [{ path: previousRoot, source: 'steam-cloud', transferStashes: [] }]
    },
    scannedStashes: [{
      path: `${previousRoot}/transfer.gst`, isHardcore: false, modLabel: '', itemCount: 1,
      lastWriteUtc: '2026-09-01T10:00:00Z', sha256: 'account-42'
    }],
    observedItems: [{ sourcePath: `${previousRoot}/transfer.gst`, baseRecord: 'records/account-42.dbr' }],
    items: [{
      record: 'records/account-recipe.dbr',
      acquisition: { crafting: { blueprintRecords: ['records/account-formula.dbr'], knownSoftcore: true, knownHardcore: false } }
    }]
  }
  const current = {
    ...collectionSnapshot('account-99'),
    discovery: {
      ...collectionSnapshot('account-99').discovery,
      saveLocations: [{ path: currentRoot, source: 'steam-cloud', transferStashes: [] }]
    },
    scannedStashes: [{
      path: `${currentRoot}/transfer.gst`, isHardcore: false, modLabel: '', itemCount: 0,
      lastWriteUtc: '2026-09-01T12:00:00Z', sha256: 'account-99'
    }],
    items: [{
      record: 'records/account-recipe.dbr',
      acquisition: { crafting: { blueprintRecords: ['records/account-formula.dbr'], knownSoftcore: false, knownHardcore: false } }
    }]
  }
  const reconciled = preserveUnavailableCollectionKnowledge(current, previous)
  assert.deepEqual(reconciled.scannedStashes.map((stash) => stash.path), [`${currentRoot}/transfer.gst`])
  assert.deepEqual(reconciled.observedItems, [])
  assert.equal(reconciled.items[0].acquisition.crafting.knownSoftcore, false)
  assert.equal(reconciled.cacheNeedsRefresh, false)
}

// If an entire previously known save root is temporarily absent from discovery,
// its stash and account-store knowledge remains available offline.
{
  const previous = {
    ...collectionSnapshot('online'),
    discovery: {
      ...collectionSnapshot('online').discovery,
      saveLocations: [{ path: 'D:/Steam/userdata/42/219990/remote/save', source: 'steam-cloud', transferStashes: [] }]
    },
    scannedStashes: [{
      path: 'D:/Steam/userdata/42/219990/remote/save/transfer.gst', isHardcore: false,
      modLabel: '', itemCount: 1, lastWriteUtc: '2026-09-01T10:00:00Z', sha256: 'stash-online'
    }],
    observedItems: [{
      sourcePath: 'D:/Steam/userdata/42/219990/remote/save/transfer.gst',
      baseRecord: 'records/supply.dbr'
    }],
    accountStores: [{
      path: 'D:/Steam/userdata/42/219990/remote/save/reagents.gst', kind: 'reagents',
      isHardcore: false, itemCount: 4, lastWriteUtc: '2026-09-01T10:00:00Z',
      sha256: 'store-online', entries: [{ record: 'records/component.dbr', quantity: 4 }]
    }]
  }
  const offline = collectionSnapshot('offline')
  const reconciled = preserveUnavailableCollectionKnowledge(offline, previous)
  assert.equal(reconciled.scannedStashes[0].itemCount, 1)
  assert.equal(reconciled.observedItems[0].baseRecord, 'records/supply.dbr')
  assert.equal(reconciled.accountStores[0].entries[0].quantity, 4)
  assert.equal(reconciled.cacheNeedsRefresh, true)
  assert.equal(reconciled.cachedDataAsOfUtc, previous.scannedAtUtc)
}

// A catalog-presentation upgrade cannot render the old snapshot directly, but
// the subsequent compatible scan still reconciles its durable recipe knowledge.
{
  const item = (knownSoftcore) => ({
    record: 'records/relic.dbr',
    acquisition: { crafting: { blueprintRecords: ['records/formula.dbr'], knownSoftcore, knownHardcore: false } }
  })
  const previous = {
    ...collectionSnapshot('old-presentation'),
    catalogPresentationVersion: 6,
    items: [item(true)]
  }
  const current = { ...collectionSnapshot('current-presentation'), items: [item(false)] }
  let written = null
  const service = new CollectionService(collectionDependencies({
    cache: {
      read: async () => previous,
      write: async (snapshot) => { written = snapshot }
    },
    scanner: { scanInstalledData: async () => current }
  }))
  const cached = await service.getCached({ sourcePaths: [], basis: 'stashes' })
  assert.equal(cached.catalogPresentationVersion, 6)
  assert.equal(cached.cacheNeedsRefresh, true)
  await service.scan({ sourcePaths: [], basis: 'stashes' })
  assert.equal(written.catalogPresentationVersion, 7)
  assert.equal(written.items[0].acquisition.crafting.knownSoftcore, true)
}

// Learned recipes are monotonic even when a later scan has only a partial view
// of the formula files.
{
  const item = (knownSoftcore) => ({
    record: 'records/relic.dbr',
    acquisition: { crafting: { blueprintRecords: ['records/formula.dbr'], knownSoftcore, knownHardcore: false } }
  })
  const previous = { ...collectionSnapshot('previous'), items: [item(true)] }
  const current = { ...collectionSnapshot('current'), items: [item(false)] }
  const reconciled = preserveUnavailableCollectionKnowledge(current, previous)
  assert.equal(reconciled.items[0].acquisition.crafting.knownSoftcore, true)
}

// Rebuild requests force map regeneration before durable publication.
{
  const forced = []
  const service = new CollectionService(collectionDependencies({
    maps: {
      attachLocations: async (snapshot, forceRebuild) => {
        forced.push(forceRebuild)
        return snapshot
      }
    }
  }))
  const rebuilt = await service.rebuild({ sourcePaths: ['fixture.gst'], basis: 'archive' })
  assert.deepEqual(forced, [true])
  assert.equal(rebuilt.catalogPresentationVersion, 7)
  assert.equal(rebuilt.basis, 'archive')
}

// Hydration delegates one globally bounded batch contract and applies caller
// projection only to the resulting presentation.
{
  const hydrationRequests = []
  const progress = []
  const service = new CollectionService(collectionDependencies({
    hydration: {
      hydrateAll: async (request) => {
        hydrationRequests.push(request)
        request.onProgress({ processed: 128, pending: 4 })
        return { processed: 128.9, pending: 4.8 }
      }
    }
  }))
  const hydrated = await service.hydrateArchiveRolls({
    sourcePaths: ['softcore.gst'],
    onProgress: (value) => progress.push(value)
  })
  assert.equal(hydrationRequests.length, 1)
  assert.equal(hydrationRequests[0].batchLimit, ARCHIVE_ROLL_HYDRATION_BATCH_LIMIT)
  assert.equal(hydrationRequests[0].batchLimit, 256)
  assert.match(hydrationRequests[0].installationPath, /cached$/)
  assert.deepEqual(progress, [{ processed: 128, pending: 4 }])
  assert.equal(hydrated.processed, 128)
  assert.equal(hydrated.pending, 4)
  assert.deepEqual(hydrated.snapshot.projectedPaths, ['softcore.gst'])
  assert.equal(hydrated.snapshot.basis, 'archive')
}

console.log('Import and collection service checks passed without Electron or filesystem access.')
