import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { CollectionDatabase } from '../src/main/collection-database.ts'
import { presentCollection } from '../src/main/collection-presentation.ts'
import { CollectionService } from '../src/main/ipc/collection-service.ts'
import { MainOperationCoordinator } from '../src/main/operation-coordinator.ts'
import { BackgroundJobCoordinator } from '../src/main/background-jobs.ts'
import { QuarantineReconciliationService, QUARANTINE_BATCH_LIMIT } from '../src/main/quarantine-reconciliation.ts'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const resolvedItem = (record, overrides = {}) => ({
  record, found: true, name: `Resolved ${record}`, baseClassification: 'Rare', itemClass: 'Armor',
  slot: 'head', levelRequirement: 1, itemLevel: 1, bitmap: null, contentPack: 'base',
  catalogEligible: true, reason: 'synthetic fixture', ...overrides
})
const operations = () => new MainOperationCoordinator({
  diagnostics: { operationStarted: () => 0, operationCompleted: () => {}, operationFailed: () => {} },
  reconcileTransfers: async () => {}, unresolvedTransferCount: () => 0
})
function fakeService(records, overrides = {}) {
  const pending = new Set(records)
  const batches = [], backups = [], events = []
  const jobs = new BackgroundJobCoordinator()
  jobs.subscribe(job => events.push(job))
  const coordinator = operations()
  const service = new QuarantineReconciliationService({
    jobs, listRecords: () => [...pending],
    resolve: async (_path, records) => { batches.push(records); return records.map(record => resolvedItem(record)) },
    commit: items => {
      let releasedRecords = 0
      for (const item of items) if (item.found && pending.delete(item.record)) releasedRecords++
      return { releasedRecords, recoveryRecords: 0, missingRecords: items.filter(item => !item.found).length }
    },
    runExclusive: operation => coordinator.runExclusive(operation),
    queueBackup: reason => backups.push(reason), ...overrides
  })
  return { service, pending, batches, backups, events, jobs }
}

// A failed second batch preserves the first commit. Restart retries only unresolved
// records, while a missing installed record stays eligible for later retries.
{
  const records = Array.from({ length: QUARANTINE_BATCH_LIMIT + 2 }, (_, i) => `record-${i}`)
  let calls = 0
  const state = fakeService(records, { resolve: async (_path, batch) => {
    calls++
    if (calls === 2) throw new Error('synthetic helper rejection')
    return batch.map(record => resolvedItem(record))
  } })
  await assert.rejects(state.service.reconcile('fixture-install'), /helper rejection/)
  assert.equal(state.pending.size, 2)
  assert.equal(state.backups.length, 1)
  assert.equal((await state.service.reconcile('fixture-install')).releasedRecords, 2)
  assert.equal(state.pending.size, 0)
  assert.equal(state.backups.length, 2)
  await state.service.shutdown()
  for (const event of state.events) {
    assert.ok(Buffer.byteLength(JSON.stringify(event.result ?? {})) < 8192)
    assert.equal('snapshot' in event, false)
  }
}
{
  const records = Array.from({ length: QUARANTINE_BATCH_LIMIT + 1 }, (_, i) => `bounded-${i}`)
  const state = fakeService(records)
  const first = state.service.reconcile('fixture-install')
  const duplicate = state.service.reconcile('fixture-install')
  assert.equal(first, duplicate)
  await first
  assert.deepEqual(state.batches.map(batch => batch.length), [QUARANTINE_BATCH_LIMIT, 1])
  assert.equal((await state.service.reconcile('fixture-install')).releasedRecords, 0)
  await state.service.shutdown()
}
for (const response of [[], [resolvedItem('unrequested')], [resolvedItem('one', { catalogEligible: 'yes' })]]) {
  const state = fakeService(['one'], { resolve: async () => response })
  await assert.rejects(state.service.reconcile('fixture-install'), /incomplete batch|invalid record/)
  assert.equal(state.pending.size, 1)
  assert.equal(state.backups.length, 0)
  await state.service.shutdown()
}

const directory = await mkdtemp(join(tmpdir(), 'cairn-quarantine-'))
assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep))
const path = join(directory, 'archive.sqlite3')
let database = new CollectionDatabase(path)
let observer
try {
  const records = ['records/rare.dbr', 'records/generic.dbr', 'records/missing.dbr']
  for (const record of records) database.ensureQuarantineCatalogItem(record)
  const payload = record => ({ baseRecord: record, prefixRecord: '', suffixRecord: '', modifierRecord: '',
    transmuteRecord: '', seed: 17, materiaRecord: '', relicCompletionBonusRecord: '', relicSeed: 0,
    enchantmentRecord: '', ascendantRecord: '', ascendantRecord2H: '', enchantmentSeed: 0,
    materiaCombines: 0, stackCount: 1, rerolls: 0, affixRerolls: 0, preservedUnknownField: 'exact fixture bytes' })
  database.importVaultItems({ sourcePath: 'fixture-import', sourceSha256: 'fixture-hash', backupPath: 'fixture-backup',
    importedAtUtc: '2026-09-05T00:00:00Z', requireAllSupported: false,
    items: records.flatMap(record => [false, true].map(isHardcore => ({
      externalId: `${record}:${isHardcore}`, baseRecord: record, isHardcore,
      createdAtUtc: '2026-09-05T00:00:00Z', payload: payload(record)
    })))
  })
  observer = new DatabaseSync(path, { readOnly: true })
  const storedItems = () => observer.prepare('SELECT id, serialized_item, is_hardcore, state FROM vault_item ORDER BY id').all()
  const originalItems = storedItems()
  const dataVersion = () => Number(observer.prepare('PRAGMA data_version').get().data_version)
  const coordinator = operations(), response = deferred(), archiveOperation = deferred()
  const backups = []
  let helperCalls = 0
  const reconciliation = new QuarantineReconciliationService({
    jobs: new BackgroundJobCoordinator(), listRecords: () => database.listQuarantineCatalogRecords(),
    resolve: async () => { helperCalls++; return response.promise },
    commit: items => database.resolveQuarantineCatalogItems(items),
    runExclusive: operation => coordinator.runExclusive(operation), queueBackup: reason => backups.push(reason)
  })
  const snapshot = { scannedAtUtc: '2026-09-05T00:00:00Z', catalogPresentationVersion: 7,
    discovery: { installations: [{ path: 'fixture-install' }], saveLocations: [], warnings: [] },
    contentPacks: [], scannedStashes: [{ path: 'SC.gst', isHardcore: false }, { path: 'HC.gsh', isHardcore: true }],
    observedItems: [], warnings: [], items: [], affixes: [], rarities: [],
    recipeSummary: { total: 0, collected: 0, unlockedItems: 0 }, affixSummary: { total: 0, collected: 0, availableCopies: 0 } }
  const collection = new CollectionService({
    cache: { read: async () => snapshot, write: async () => {} },
    freshness: { isMapIndexFresh: async () => true, areSourcesFresh: async () => true },
    projector: {
      projectSources: (snapshot, paths) => ({ ...snapshot, scannedStashes: snapshot.scannedStashes.filter(stash => paths.includes(stash.path)) }),
      present: (snapshot, basis) => presentCollection(database, snapshot, basis, 9)
    }, catalogPresentationVersion: 7
  })
  const sc = { sourcePaths: ['SC.gst'], basis: 'archive' }, hc = { sourcePaths: ['HC.gsh'], basis: 'archive' }
  const version = dataVersion()
  for (const context of [sc, hc, { ...sc, basis: 'stashes' }]) await collection.getCached(context)
  assert.equal(dataVersion(), version, 'cached APIs must not mutate SQLite')
  assert.equal(helperCalls, 0, 'cached reads cannot trigger resolution')
  const command = reconciliation.reconcile('fixture-install')
  assert.equal(command, reconciliation.reconcile('fixture-install'))
  await tick()
  for (const context of [sc, hc]) assert.equal((await collection.getCached(context)).observedItems.length, 0)
  assert.equal(dataVersion(), version, 'reads during resolution retain committed state')
  const serializedArchiveWrite = coordinator.runExclusive(async () => {
    await archiveOperation.promise
    database.setInfiniteSupplies(true)
  })
  response.resolve(records.map(record => resolvedItem(record, record.includes('missing') ? { found: false } :
    record.includes('generic') ? { catalogEligible: false } : {})))
  await tick()
  assert.equal(dataVersion(), version, 'reconciliation waits for the shared archive operation')
  archiveOperation.resolve()
  await serializedArchiveWrite
  assert.deepEqual(await command, { releasedRecords: 1, recoveryRecords: 1, missingRecords: 1 })
  assert.equal(helperCalls, 1)
  assert.equal(backups.length, 1)
  assert.deepEqual(storedItems(), originalItems, 'payload bytes, mode, identities and vault state are preserved')
  for (const context of [sc, hc]) assert.equal((await collection.getCached(context)).observedItems.length, 1)
  const afterCommit = dataVersion()
  await collection.getCached(sc); await collection.getCached(hc)
  assert.equal(dataVersion(), afterCommit)
  assert.deepEqual(database.listQuarantineCatalogRecords(), ['records/missing.dbr'])
  const repeated = database.resolveQuarantineCatalogItems([resolvedItem('records/generic.dbr', { catalogEligible: false })])
  assert.equal(repeated.recoveryRecords, 0, 'already resolved generic metadata is not committed twice')
  await reconciliation.shutdown()

  // Shutdown includes the helper wait and the eventual serialized commit. A reopened
  // archive retries its missing record from durable state, without a saved job promise.
  database.close()
  database = new CollectionDatabase(path)
  const late = deferred()
  const restarted = new QuarantineReconciliationService({
    jobs: new BackgroundJobCoordinator(), listRecords: () => database.listQuarantineCatalogRecords(),
    resolve: async () => late.promise, commit: items => database.resolveQuarantineCatalogItems(items),
    runExclusive: operation => coordinator.runExclusive(operation), queueBackup: reason => backups.push(reason)
  })
  const recovery = restarted.reconcile('fixture-install')
  await tick()
  let stopped = false
  const shutdown = restarted.shutdown().then(() => { stopped = true })
  await tick()
  assert.equal(stopped, false)
  await assert.rejects(restarted.reconcile('fixture-install'), /shutting down/)
  late.resolve([resolvedItem('records/missing.dbr')])
  assert.equal((await recovery).releasedRecords, 1)
  await shutdown
  assert.equal(stopped, true)
  assert.deepEqual(database.listQuarantineCatalogRecords(), [])
  assert.deepEqual(storedItems(), originalItems)
  assert.equal(backups.length, 2)
} finally {
  observer?.close()
  database.close()
  await rm(directory, { recursive: true, force: true })
}
console.log('Quarantine reconciliation passed: pure cached reads, bounded/coalesced work, partial failure, serialization, exact payloads, retry and shutdown/restart.')
