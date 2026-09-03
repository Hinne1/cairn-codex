import assert from 'node:assert/strict'
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
  assert.equal(await service.getCached({ sourcePaths: [], basis: 'stashes' }), null)
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
