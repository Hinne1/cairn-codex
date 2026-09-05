import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CollectionDatabase } from '../src/main/collection-database.ts'
import { ArchiveDomainService } from '../src/main/ipc/archive-service.ts'
import { MainOperationCoordinator } from '../src/main/operation-coordinator.ts'
import { LiveGameDomainService } from '../src/main/ipc/live-game-service.ts'
import { reconcileTransferOperations } from '../src/main/transfers/recovery.ts'
import { executeIngestCommand, executeRetrievalCommand, planRetrievalCommand } from '../src/main/transfers/offline-transactions.ts'
import { reconcileLiveIncomingOperations, syncLiveIncoming } from '../src/main/transfers/live-incoming.ts'
import { executeLiveAugmentDispense, executeSahdinasMementoRecovery } from '../src/main/transfers/live-delivery.ts'
import { createLiveTransferService } from '../src/main/transfers/live-retrieval.ts'
import { reconcileLiveRecoveryOperations } from '../src/main/transfers/retained-receipts.ts'

const root = await mkdtemp(join(tmpdir(), 'cairn-transfer-adapters-'))
const sourceHash = 'a'.repeat(64), committedHash = 'b'.repeat(64)
const record = 'records/synthetic/transfer.dbr'
const payload = { baseRecord: record, seed: 123456, prefixRecord: 'prefix', suffixRecord: 'suffix',
  modifierRecord: '', materiaRecord: '', enchantmentRecord: '', xOffset: 3, yOffset: 5,
  extraSerializedFields: { seed: 0xffffffff, flags: [1, 2, 3] } }
const quietDiagnostics = { info() {}, error() {}, operationStarted: () => 0, operationCompleted() {}, operationFailed() {} }
let fixtureId = 0
async function fixture(run) {
  const directory = join(root, String(++fixtureId))
  await mkdir(directory)
  const databasePath = join(directory, 'archive.sqlite3')
  let database = new CollectionDatabase(databasePath)
  database.ensureQuarantineCatalogItem(record)
  let time = 0, operation = 0
  const clock = { now: () => time, nowUtc: () => new Date(time).toISOString(),
    wait: async milliseconds => { time += milliseconds }, operationId: () => `operation-${++operation}`, seed: () => 123456 }
  const calls = []
  const handlers = new Map()
  const dependencies = { database, clock, diagnostics: quietDiagnostics,
    paths: { backups: join(directory, 'backups'), receipts: join(directory, 'receipts') },
    helper: { request: async (method, params = {}) => {
      calls.push({ method, params: structuredClone(params) })
      const handler = handlers.get(method)
      if (!handler) throw new Error('Unexpected helper call: ' + method)
      return handler(params)
    } }
  }
  const path = join(directory, 'synthetic.gst')
  const ingest = { path, expectedSourceSha256: sourceHash, items: [{ tabIndex: 2, itemIndex: 0, expectedSeed: payload.seed }] }
  const plan = { path, sourceSha256: sourceHash, replacementSha256: committedHash,
    sourceItemCount: 1, replacementItemCount: 0, semanticallyValid: true, idempotent: true, items: [structuredClone(payload)] }
  handlers.set('inspect-write-safety', () => ({ permitted: true, reasons: [] }))
  handlers.set('plan-ingest-items', () => structuredClone(plan))
  handlers.set('commit-ingest-items', () => ({ plan, transaction: { sourceSha256: sourceHash,
    committedSha256: committedHash, backupPath: join(directory, 'verified.bak'), rollbackPath: join(directory, 'rollback.bak') } }))
  handlers.set('scan-transfer-stash', () => ({ path, sha256: committedHash, itemCount: 0, tabs: [{ items: [] }, { items: [] }, { items: [] }] }))
  const retrieval = { path, expectedSourceSha256: sourceHash, targetTabIndex: 2, vaultItemIds: ['vault-a'] }
  const retrievalPlan = { ...plan, sourceItemCount: 0, replacementItemCount: 1, targetTabIndex: 2, restoredExactly: true }
  handlers.set('plan-retrieve-items', () => structuredClone(retrievalPlan))
  handlers.set('commit-retrieve-items', () => ({ plan: retrievalPlan, transaction: {
    sourceSha256: sourceHash, committedSha256: committedHash,
    backupPath: join(directory, 'verified.bak'), rollbackPath: join(directory, 'rollback.bak') } }))
  const game = { state: 'ready', detail: 'Synthetic game', activeCharacterName: 'Synthetic', isHardcore: false, depositTabDescription: 'synthetic tab' }
  const collection = { discovery: { installations: [{ path: join(directory, 'synthetic-game') }] },
    supplies: [{ record, name: 'Synthetic augment', slot: 'augment', acquisition: {
      factions: [{ kind: 'item', reputation: 'revered', faction: 'Synthetic faction' }] } }] }
  handlers.set('inspect-live-game', () => structuredClone(game))
  handlers.set('list-characters', () => [{ name: 'Synthetic', isHardcore: false, lastWriteUtc: clock.nowUtc(),
    factions: [{ name: 'Synthetic faction', value: 25000, isUnlocked: true }] }])
  const queue = (operationId, isHardcore = false) => ({ operationId, isHardcore, semanticSha256: sourceHash,
    outgoingPath: join(directory, `${operationId}.csv`), baselineDeleted: [], baselineIncoming: [] })
  handlers.set('enqueue-live-retrieval', input => queue(input.operationId, input.isHardcore))
  handlers.set('inspect-live-retrieval', ({ queue }) => ({ state: 'deposited', receiptPath: `${queue.outgoingPath}.deposited` }))
  handlers.set('copy-live-incoming', ({ expectedSha256 }) => ({ sha256: expectedSha256, receiptPath: join(directory, 'copied.csv') }))
  handlers.set('ack-live-incoming', ({ expectedSha256 }) => ({ sha256: expectedSha256, receiptPath: join(directory, 'acknowledged.csv') }))
  const seed = (ids = ['vault-a'], hardcore = false) => {
    const id = `seed-${ids.join('-')}`
    database.prepareIngestOperation({ operationId: id, stashPath: path, sourceSha256: sourceHash,
      startedAtUtc: clock.nowUtc(), items: ids.map(vaultItemId => ({ vaultItemId, baseRecord: record, payload: structuredClone(payload) })), detail: {} })
    database.completeIngestOperation({ operationId: id, backupPath: 'synthetic-seed', completedAtUtc: clock.nowUtc(), isHardcore: hardcore, detail: {} })
  }
  const reopen = (previousSchema, prepareLegacy = () => {}) => {
    database.close()
    if (previousSchema !== undefined) {
      assert.equal(previousSchema, 12)
      const legacy = new DatabaseSync(databasePath)
      legacy.exec('PRAGMA user_version = 12')
      prepareLegacy(legacy)
      legacy.close()
    }
    database = new CollectionDatabase(databasePath); dependencies.database = database; return database
  }
  try { await run({ dependencies, handlers, calls, path, ingest, plan, seed, reopen, retrieval, retrievalPlan, game, collection, queue }) }
  finally { database.close() }
}

try {
  await fixture(async ({ dependencies, ingest, calls, reopen }) => {
    const result = await executeIngestCommand(dependencies, ingest)
    assert.equal(result.ingested.length, 1)
    assert.deepEqual(reopen().getVaultItems([result.ingested[0].vaultItemId], false)[0].payload, payload)
    assert.equal(dependencies.database.getRecoveryOperationCount(), 0)
    assert.deepEqual(calls.map(call => call.method), ['inspect-write-safety', 'plan-ingest-items', 'commit-ingest-items', 'scan-transfer-stash'])
    assert.equal(calls[2].params.expectedSourceSha256, sourceHash)
    assert.equal(calls[2].params.backupDirectory, dependencies.paths.backups)
  })
  for (const change of [plan => { plan.sourceSha256 = 'c'.repeat(64) }, plan => { plan.items[0].seed++ },
    plan => { plan.semanticallyValid = false }, plan => { plan.idempotent = false }]) {
    await fixture(async ({ dependencies, ingest, plan, calls }) => {
      change(plan)
      await assert.rejects(executeIngestCommand(dependencies, ingest), /approved|seeds/)
      assert.equal(calls.some(call => call.method.startsWith('commit-')), false)
      assert.equal(dependencies.database.getRecoveryOperationCount(), 0)
    })
  }
  await fixture(async ({ dependencies, ingest, handlers, reopen }) => {
    handlers.set('commit-ingest-items', () => { throw new Error('Synthetic response lost after dispatch') })
    await assert.rejects(executeIngestCommand(dependencies, ingest), /response lost/)
    const database = reopen()
    assert.equal(database.getRecoveryOperationCount(), 1, 'a lost ingest response must retain the prepared exact payloads for recovery')
    assert.equal(database.listRecoveryOperations()[0].state, 'needs_recovery')
  })
  for (const failure of ['scan', 'database']) {
    await fixture(async ({ dependencies, ingest, handlers, reopen }) => {
      if (failure === 'scan') handlers.set('scan-transfer-stash', () => { throw new Error('Synthetic scan failure') })
      else dependencies.database.completeIngestOperation = () => { throw new Error('Synthetic database failure') }
      await assert.rejects(executeIngestCommand(dependencies, ingest), /Synthetic/)
      const database = reopen()
      const operation = database.listRecoveryOperations()[0]
      assert.equal(operation.state, 'needs_recovery')
      assert.equal(operation.detail.transaction.committedSha256, committedHash)
      assert.ok(operation.detail.transaction.backupPath.endsWith('verified.bak'))
      // A recovery audit can still complete from the persisted exact payloads.
      const ids = database.completeIngestOperation({ operationId: operation.id,
        backupPath: operation.detail.transaction.backupPath, completedAtUtc: dependencies.clock.nowUtc(), isHardcore: false, detail: { phase: 'audited' } })
      assert.deepEqual(database.getVaultItems(ids, false)[0].payload, payload)
      assert.equal(database.getRecoveryOperationCount(), 0)
    })
  }
  await fixture(async ({ dependencies, ingest, handlers, calls }) => {
    handlers.set('inspect-write-safety', () => ({ permitted: false, reasons: ['Synthetic refusal'] }))
    await assert.rejects(executeIngestCommand(dependencies, ingest), /refused/)
    assert.equal(calls.length, 1)
  })
  for (const failure of ['none', 'hash', 'target', 'commit', 'scan', 'database']) {
    await fixture(async ({ dependencies, retrieval, retrievalPlan, handlers, calls, seed, reopen }) => {
      seed()
      handlers.set('scan-transfer-stash', () => ({ sha256: committedHash, itemCount: 1,
        tabs: [{ items: [] }, { items: [] }, { items: [payload] }] }))
      if (failure === 'hash') retrievalPlan.sourceSha256 = 'c'.repeat(64)
      if (failure === 'target') retrievalPlan.targetTabIndex = 1
      if (failure === 'commit') handlers.set('commit-retrieve-items', () => { throw new Error('Synthetic lost response') })
      if (failure === 'scan') handlers.set('scan-transfer-stash', () => { throw new Error('Synthetic scan failure') })
      if (failure === 'database') dependencies.database.completeRetrievalOperation = () => { throw new Error('Synthetic database failure') }
      if (failure === 'none') {
        const planned = await planRetrievalCommand(dependencies, retrieval)
        assert.equal(planned.targetTabIndex, 2)
        assert.equal((await executeRetrievalCommand(dependencies, retrieval)).retrieved[0].vaultItemId, 'vault-a')
        await assert.rejects(executeRetrievalCommand(dependencies, retrieval), /not available/)
        const commit = calls.find(call => call.method === 'commit-retrieve-items').params
        assert.equal(commit.expectedSourceSha256, sourceHash)
        assert.equal(commit.targetTabIndex, 2)
        assert.deepEqual(commit.items, [payload])
        assert.equal(reopen().getVaultItems(['vault-a'], false)[0].state, 'retrieved')
      } else {
        await assert.rejects(executeRetrievalCommand(dependencies, retrieval), /approved|Synthetic/)
        const database = reopen()
        const beforeDispatch = failure === 'hash' || failure === 'target'
        assert.equal(database.getVaultItems(['vault-a'], false)[0].state, beforeDispatch ? 'ingested' : 'retrieval_pending')
        assert.equal(database.getRecoveryOperationCount(), beforeDispatch ? 0 : 1)
        if (beforeDispatch) assert.equal(calls.some(call => call.method.startsWith('commit-')), false)
      }
    })
  }
  await fixture(async ({ dependencies, retrieval, calls, seed }) => {
    seed(['vault-a'], true)
    await assert.rejects(executeRetrievalCommand(dependencies, retrieval), /mode|Hardcore|vault item/i)
    assert.equal(calls.some(call => call.method.startsWith('plan-')), false)
  })
  // Exercise policy -> concrete transaction -> SQLite under the shared coordinator.
  await fixture(async ({ dependencies, ingest, plan, path, handlers, calls }) => {
    let approvedScans = 0
    const archive = new ArchiveDomainService({ reads: {
      findCatalogNames: records => dependencies.database.getCatalogNames([...records]) },
      stashes: { scan: async () => {
        approvedScans++
        return { path, sha256: sourceHash, itemCount: 1,
          tabs: [{ index: 2, items: [{ tabIndex: 2, itemIndex: 0, baseRecord: record, seed: payload.seed }] }] }
      } },
      transactions: { commitIngest: input => executeIngestCommand(dependencies, input) },
      enqueueArchiveBackup() {} })
    const coordinator = new MainOperationCoordinator({ diagnostics: quietDiagnostics,
      reconcileTransfers: async () => {}, unresolvedTransferCount: () => dependencies.database.getRecoveryOperationCount() })
    let release, dispatched
    const ready = new Promise(resolve => { dispatched = resolve })
    const blocked = new Promise(resolve => { release = resolve })
    const commit = handlers.get('commit-ingest-items')
    handlers.set('commit-ingest-items', async input => { dispatched(); await blocked; return commit(input) })
    const result = coordinator.runTransferExclusive(() => archive.ingestStagingTab(path))
    await ready
    let flushed = false
    const flush = coordinator.flush().then(() => { flushed = true })
    await Promise.resolve()
    assert.equal(flushed, false, 'shutdown must await the dispatched transfer')
    release()
    await result
    await flush
    await archive.flush()
    assert.equal(approvedScans, 1, 'the approved context must not be replaced by a second scan')
    assert.deepEqual(calls.find(call => call.method === 'commit-ingest-items').params.items, [{ tabIndex: 2, itemIndex: 0 }])
    plan.sourceSha256 = 'c'.repeat(64)
    await assert.rejects(coordinator.runTransferExclusive(() => archive.ingestStagingTab(path)), /approved/)
    assert.equal(calls.filter(call => call.method === 'commit-ingest-items').length, 1)
  })
  await fixture(async ({ dependencies, handlers, reopen, path }) => {
    handlers.set('poll-live-incoming', () => [{ path: `${path}.incoming`, sha256: sourceHash,
      isHardcore: true, item: payload, createdAtUtc: dependencies.clock.nowUtc() }])
    handlers.set('ack-live-incoming', () => { throw new Error('Synthetic lost ack response') })
    const first = await syncLiveIncoming(dependencies)
    assert.match(first.issues[0], /lost ack/)
    const database = reopen()
    const stored = database.listVaultItems(true)
    assert.equal(stored.length, 1)
    assert.deepEqual(database.getVaultItems([stored[0].id], true)[0].payload, payload)
    assert.equal(database.listVaultItems(false).length, 0)
    handlers.set('ack-live-incoming', () => ({ sha256: sourceHash, receiptPath: `${path}.ack` }))
    await syncLiveIncoming(dependencies)
    assert.equal(database.listVaultItems(true).length, 1, 'retry acknowledges the committed item without inserting twice')
  })
  for (const outcome of ['deposited', 'rejected', 'pending', 'partial', 'database', 'lost-response']) {
    await fixture(async ({ dependencies, handlers, seed, calls, reopen }) => {
      seed(['vault-a', 'vault-b'])
      if (outcome === 'lost-response') handlers.set('enqueue-live-retrieval', () => { throw new Error('Synthetic response lost') })
      handlers.set('inspect-live-retrieval', ({ queue }) => ({
        state: outcome === 'partial' ? (queue.operationId.endsWith('-0') ? 'deposited' : 'rejected')
          : outcome === 'database' ? 'deposited' : outcome,
        receiptPath: outcome === 'pending' ? null : `${queue.outgoingPath}.${outcome}` }))
      if (outcome === 'database') dependencies.database.completeRetrievalOperation = () => { throw new Error('Synthetic database failure') }
      const service = createLiveTransferService(dependencies)
      const submission = service.retrieveVaultItems(['vault-a', 'vault-b'])
      assert.equal(service.retrieveVaultItems(['vault-b', 'vault-a']), submission, 'repeat submit must share the in-flight operation')
      if (outcome === 'deposited' || outcome === 'partial') {
        const result = await submission
        assert.equal(result.retrieved.length, outcome === 'partial' ? 1 : 2)
      } else await assert.rejects(submission, /full|Timed out|Synthetic/)
      await service.flush()
      const database = reopen()
      const states = database.getVaultItems(['vault-a', 'vault-b'], false).map(item => item.state)
      if (outcome === 'partial') assert.deepEqual(states, ['retrieved', 'ingested'])
      if (outcome === 'rejected') assert.deepEqual(states, ['ingested', 'ingested'])
      if (outcome === 'pending' || outcome === 'database' || outcome === 'lost-response') {
        assert.deepEqual(states, ['retrieval_pending', 'retrieval_pending'])
        assert.equal(database.getRecoveryOperationCount(), 1)
        handlers.set('inspect-live-retrieval', ({ queue }) => ({ state: 'deposited', receiptPath: `${queue.outgoingPath}.deposited` }))
        assert.equal(await reconcileLiveRecoveryOperations(dependencies), outcome === 'lost-response' ? 0 : 1)
        if (outcome === 'lost-response') {
          const restarted = createLiveTransferService(dependencies)
          await assert.rejects(restarted.retrieveVaultItems(['vault-a']), /recovery attention/)
          assert.equal(calls.filter(call => call.method === 'enqueue-live-retrieval').length, 1)
        } else assert.deepEqual(database.getVaultItems(['vault-a', 'vault-b'], false).map(item => item.state), ['retrieved', 'retrieved'])
      }
    })
  }
  for (const kind of ['augment', 'memento']) {
    for (const outcome of ['deposited', 'rejected', 'pending']) {
      await fixture(async ({ dependencies, handlers, collection, calls, reopen }) => {
        handlers.set('inspect-live-retrieval', ({ queue }) => ({ state: outcome,
          receiptPath: outcome === 'pending' ? null : `${queue.outgoingPath}.${outcome}` }))
        const result = kind === 'augment'
          ? executeLiveAugmentDispense(dependencies, collection, [record], 'Synthetic')
          : executeSahdinasMementoRecovery(dependencies, collection, 'character-inventory', 'Synthetic')
        if (outcome === 'deposited') assert.equal((await result).status, 'committed')
        else await assert.rejects(result, /full|Timed out/)
        const database = reopen()
        assert.equal(database.getRecoveryOperationCount(), outcome === 'pending' ? 1 : 0)
        const enqueue = calls.find(call => call.method === 'enqueue-live-retrieval').params
        assert.equal(enqueue.isHardcore, false)
        assert.equal(enqueue.destination, 'character-inventory')
        assert.equal(enqueue.item.seed, 123456)
        if (outcome === 'pending') {
          handlers.set('inspect-live-retrieval', ({ queue }) => ({ state: 'deposited', receiptPath: `${queue.outgoingPath}.deposited` }))
          assert.equal(await reconcileLiveRecoveryOperations(dependencies), 1)
        }
      })
    }
  }
  // A first or later dispatch with a lost response must never be inferred from
  // only the queues whose responses arrived, nor be automatically submitted again.
  for (const lostAt of [1, 2]) {
    await fixture(async ({ dependencies, handlers, collection, calls, queue, reopen }) => {
      const secondRecord = 'records/synthetic/second.dbr'
      collection.supplies.push({ ...structuredClone(collection.supplies[0]), record: secondRecord })
      let dispatched = 0
      handlers.set('enqueue-live-retrieval', input => {
        if (++dispatched === lostAt) throw new Error('Synthetic dispatch response lost')
        return queue(input.operationId, input.isHardcore)
      })
      await assert.rejects(executeLiveAugmentDispense(dependencies, collection, [record, secondRecord]), /response lost/)
      const database = reopen()
      const operation = database.listRecoveryOperations()[0]
      assert.equal(operation.state, 'needs_recovery')
      assert.equal(operation.detail.expectedQueueCount, 2)
      assert.deepEqual(operation.detail.pendingDispatch.item, operation.detail.payloads[lostAt - 1])
      assert.equal(operation.detail.pendingDispatch.isHardcore, false)
      assert.equal(await reconcileLiveRecoveryOperations(dependencies), 0)
      assert.equal(database.getRecoveryOperationCount(), 1)
      const coordinator = new MainOperationCoordinator({ diagnostics: quietDiagnostics,
        reconcileTransfers: () => reconcileLiveRecoveryOperations(dependencies),
        unresolvedTransferCount: () => database.getRecoveryOperationCount() })
      await assert.rejects(coordinator.runTransferExclusive(() => executeLiveAugmentDispense(dependencies, collection, [record])), /recovery attention/)
      assert.equal(calls.filter(call => call.method === 'enqueue-live-retrieval').length, lostAt)
    })
  }
  await fixture(async ({ dependencies, handlers, collection, reopen }) => {
    handlers.set('enqueue-live-retrieval', () => { throw new Error('Synthetic first response lost') })
    await assert.rejects(executeSahdinasMementoRecovery(dependencies, collection, 'shared-stash'), /response lost/)
    const operation = reopen().listRecoveryOperations()[0]
    assert.equal(operation.state, 'needs_recovery')
    assert.equal(operation.detail.pendingDispatch.destination, 'shared-stash')
    assert.equal(operation.detail.pendingDispatch.item.seed, 123456)
  })
  for (const generated of [true, false]) {
    await fixture(async ({ dependencies, handlers, collection, seed, calls, reopen }) => {
      seed()
      handlers.set('inspect-live-retrieval', ({ queue }) => ({ state: 'rejected', receiptPath: `${queue.outgoingPath}.rejected` }))
      handlers.set('ack-live-incoming', () => { throw new Error('Synthetic permission failure') })
      const submission = generated ? executeLiveAugmentDispense(dependencies, collection, [record])
        : createLiveTransferService(dependencies).retrieveVaultItems(['vault-a'])
      await assert.rejects(submission, /permission failure/)
      const database = reopen()
      const operation = database.listRecoveryOperations()[0]
      assert.ok(operation.detail.recoveryResolution.entries[0].copiedReceiptPath)
      const inspectedBefore = calls.filter(call => call.method === 'inspect-live-retrieval').length
      assert.equal(await reconcileLiveRecoveryOperations(dependencies), 0, 'a copy alone does not prove acknowledgement')
      assert.equal(database.getRecoveryOperationCount(), 1)
      if (!generated) assert.equal(database.getVaultItems(['vault-a'], false)[0].state, 'retrieval_pending')
      // The real helper may now prove a prior lost acknowledgement by hashing
      // its retained file. No native reinspection or enqueue is needed.
      handlers.set('ack-live-incoming', () => ({ sha256: sourceHash, receiptPath: 'verified-retained.csv' }))
      assert.equal(await reconcileLiveRecoveryOperations(dependencies), 1)
      assert.equal(calls.filter(call => call.method === 'inspect-live-retrieval').length, inspectedBefore)
      assert.equal(database.getRecoveryOperationCount(), 0)
      if (!generated) assert.equal(database.getVaultItems(['vault-a'], false)[0].state, 'ingested')
    })
  }
  await fixture(async ({ dependencies, handlers, collection, calls, reopen }) => {
    const secondRecord = 'records/synthetic/second.dbr'
    collection.supplies.push({ ...structuredClone(collection.supplies[0]), record: secondRecord })
    handlers.set('inspect-live-retrieval', ({ queue }) => ({ state: queue.operationId.endsWith('-0') ? 'rejected' : 'pending',
      receiptPath: queue.operationId.endsWith('-0') ? `${queue.outgoingPath}.rejected` : null }))
    await assert.rejects(executeLiveAugmentDispense(dependencies, collection, [record, secondRecord]), /Timed out/)
    assert.equal(calls.some(call => call.method === 'ack-live-incoming'), false, 'do not consume rejection evidence from a partially terminal batch')
    reopen()
    handlers.set('inspect-live-retrieval', ({ queue }) => ({ state: 'rejected', receiptPath: `${queue.outgoingPath}.rejected` }))
    assert.equal(await reconcileLiveRecoveryOperations(dependencies), 1)
    assert.equal(dependencies.database.getRecoveryOperationCount(), 0)
  })
  await fixture(async ({ dependencies, handlers, path, reopen }) => {
    const incoming = [{ path: `${path}.incoming`, sha256: sourceHash, isHardcore: true,
      item: payload, createdAtUtc: dependencies.clock.nowUtc() }]
    handlers.set('poll-live-incoming', () => incoming)
    dependencies.database.completeIngestOperation = () => { throw new Error('Synthetic transient database failure') }
    assert.match((await syncLiveIncoming(dependencies)).issues[0], /database failure/)
    let database = reopen()
    assert.equal(database.getRecoveryOperationCount(), 1)
    incoming.push({ ...incoming[0], path: `${path}.unrelated` })
    const coordinator = new MainOperationCoordinator({ diagnostics: quietDiagnostics,
      reconcileTransfers: () => reconcileLiveIncomingOperations(dependencies),
      unresolvedTransferCount: () => database.getRecoveryOperationCount() })
    await coordinator.runTransferExclusive(async () => {
      assert.equal(database.getRecoveryOperationCount(), 0)
      assert.equal(database.listVaultItems(true).length, 1, 'recovery only consumes the previously journaled incoming item')
    })
    database = reopen()
    const stored = database.listVaultItems(true)
    assert.deepEqual(database.getVaultItems([stored[0].id], true)[0].payload, payload)
    await syncLiveIncoming(dependencies)
    assert.equal(database.listVaultItems(true).length, 2, 'normal sync may now consume the unrelated queue exactly once')
    await syncLiveIncoming(dependencies)
    assert.equal(database.listVaultItems(true).length, 2)
  })
  await fixture(async ({ dependencies, handlers, seed, queue, calls }) => {
    seed(['vault-a', 'vault-b'])
    dependencies.database.prepareRetrievalOperation({ operationId: 'malformed-mapping', stashPath: 'live://gdia/sc',
      sourceSha256: sourceHash, startedAtUtc: dependencies.clock.nowUtc(), vaultItemIds: ['vault-a', 'vault-b'],
      detail: { vaultItemIds: ['vault-a', 'vault-b'], queues: [queue('only-one')] } })
    handlers.set('inspect-live-retrieval', ({ queue }) => ({ state: 'rejected', receiptPath: `${queue.outgoingPath}.rejected` }))
    assert.equal(await reconcileLiveRecoveryOperations(dependencies), 0)
    assert.equal(calls.some(call => call.method === 'ack-live-incoming'), false, 'validate complete selection correspondence before consuming receipts')
  })
  await fixture(async ({ dependencies, handlers, path, reopen }) => {
    const source = { path: `${path}.legacy`, sha256: sourceHash, isHardcore: true,
      item: payload, createdAtUtc: dependencies.clock.nowUtc() }
    const identity = createHash('sha256').update(source.path.toLowerCase()).update('\0').update(sourceHash).digest('hex')
    const operationId = `live-ingest-${identity}`
    const input = { operationId, stashPath: `live://gdia/hc/${source.path.split(/[\\/]/).at(-1)}`,
      sourceSha256: sourceHash, startedAtUtc: dependencies.clock.nowUtc(),
      items: [{ vaultItemId: `live-${identity}`, baseRecord: record, payload }],
      detail: { adapter: 'gdia-live-v1', receiptPath: `${path}.copy` } }
    dependencies.database.prepareIngestOperation(input)
    dependencies.database.failIngestOperation(operationId, new Error('Legacy failed database commit'))
    for (const [id, stashPath] of [['offline-failure', path], ['malformed-live-id', input.stashPath]]) {
      dependencies.database.prepareIngestOperation({ ...input, operationId: id, stashPath,
        items: [{ vaultItemId: id, baseRecord: record, payload }] })
      dependencies.database.failIngestOperation(id, new Error('Must remain failed'))
    }
    const corruptId = `live-ingest-${'d'.repeat(64)}`
    dependencies.database.prepareIngestOperation({ ...input, operationId: corruptId,
      items: [{ vaultItemId: `live-${'d'.repeat(64)}`, baseRecord: record, payload }] })
    dependencies.database.failIngestOperation(corruptId, new Error('Corrupt legacy detail negative control'))
    let database = reopen(12, legacy => {
      legacy.prepare('UPDATE operation_journal SET detail_json = ? WHERE id = ?').run('{malformed', corruptId)
    })
    assert.deepEqual(database.listRecoveryOperations().map(operation => operation.id), [operationId])
    assert.equal(database.getRecoveryOperationCount(), 1)
    database = reopen()
    assert.equal(database.getRecoveryOperationCount(), 1, 'migration is idempotent')
    handlers.set('poll-live-incoming', () => [source])
    assert.equal(await reconcileLiveIncomingOperations(dependencies), 1)
    assert.deepEqual(database.getVaultItems([`live-${identity}`], true)[0].payload, payload)
    assert.equal(reopen().getRecoveryOperationCount(), 0)
  })
  // Recovery can run before ordinary sync or from Settings/another transfer.
  // A commit notification must survive even when normal sync has no new deltas.
  for (const trigger of ['sync', 'diagnostics', 'other-transfer']) {
    await fixture(async ({ dependencies, handlers, path, reopen }) => {
      let pending = [{ path: `${path}.recover`, sha256: sourceHash, isHardcore: false,
        item: payload, createdAtUtc: dependencies.clock.nowUtc() }]
      handlers.set('poll-live-incoming', () => pending)
      handlers.set('ack-live-incoming', () => { pending = []; return { sha256: sourceHash, receiptPath: `${path}.ack` } })
      dependencies.database.completeIngestOperation = () => { throw new Error('Synthetic transient database failure') }
      await syncLiveIncoming(dependencies)
      reopen()
      let published = 0
      const reconcile = () => reconcileTransferOperations({ ...dependencies, committed: () => { published++ } })
      const coordinator = new MainOperationCoordinator({ diagnostics: quietDiagnostics,
        reconcileTransfers: reconcile, unresolvedTransferCount: () => dependencies.database.getRecoveryOperationCount() })
      const service = new LiveGameDomainService({ visualDiagnosticsActive: () => false,
        diagnostics: { run: (_event, work) => work() }, runTransferExclusive: work => coordinator.runTransferExclusive(work),
        syncIncoming: () => syncLiveIncoming(dependencies), queueArchiveBackup() {} })
      if (trigger === 'sync') assert.equal((await service.sync()).ingested.length, 0)
      else if (trigger === 'diagnostics') await coordinator.runExclusive(reconcile)
      else await coordinator.runTransferExclusive(async () => {})
      assert.equal(published, 1, 'renderer must learn of the committed recovery even without a sync delta')
      assert.equal(dependencies.database.listVaultItems(false).length, 1)
      await service.sync()
      assert.equal(published, 1, 'unchanged recovery state must not repeatedly invalidate the renderer')
    })
  }
  for (const change of ['operation-id', 'queue-mode', 'vault-mode']) {
    await fixture(async ({ dependencies, seed, handlers, queue, calls, reopen }) => {
      seed(['vault-a'], change === 'vault-mode')
      const retained = queue(change === 'operation-id' ? 'unrelated-transfer-0' : 'original-transfer-0', change === 'queue-mode')
      dependencies.database.prepareRetrievalOperation({ operationId: 'original-transfer', stashPath: 'live://gdia/sc',
        sourceSha256: sourceHash, startedAtUtc: dependencies.clock.nowUtc(), vaultItemIds: ['vault-a'],
        detail: { vaultItemIds: ['vault-a'], queues: [retained], recoveryResolution: { entries: [{
          operationId: retained.operationId, state: 'rejected', receiptPath: 'unrelated.csv',
          semanticSha256: sourceHash, copiedReceiptPath: 'retained/unrelated.csv'
        }] } } })
      reopen()
      assert.equal(await reconcileLiveRecoveryOperations(dependencies), 0)
      assert.equal(calls.some(call => call.method === 'ack-live-incoming'), false)
      assert.equal(dependencies.database.getRecoveryOperationCount(), 1)
    })
  }
  for (const legacy of [true, false]) {
    await fixture(async ({ dependencies, queue }) => {
      const operationId = 'sahdina-synthetic'
      const retained = queue(legacy ? operationId : `${operationId}-0`, true)
      dependencies.database.prepareDeliveryOperation({ operationId, destination: 'live://special-recovery/shared-stash',
        payloadSha256: sourceHash, startedAtUtc: dependencies.clock.nowUtc(),
        detail: { adapter: 'cairn-live-v1', record: 'records/items/gearaccessories/necklaces/b100_necklace_sahdina.dbr',
          isHardcore: true, queues: [retained] } })
      assert.equal(await reconcileLiveRecoveryOperations(dependencies), 1, 'known old and current single-item queue IDs remain supported')
    })
  }
  for (const generated of [true, false]) {
    await fixture(async ({ dependencies, handlers, seed, collection, calls, path, reopen }) => {
      seed(['vault-a', 'vault-b'])
      const secondRecord = 'records/synthetic/second.dbr'
      collection.supplies.push({ ...structuredClone(collection.supplies[0]), record: secondRecord })
      handlers.set('inspect-live-retrieval', ({ queue, allowHashFallback }) => {
        assert.equal(allowHashFallback, false, 'identical payloads must use operation-specific evidence')
        return { state: 'deposited', receiptPath: queue.operationId.endsWith('-0')
          ? `${path}.shared-receipt` : (process.platform === 'win32' ? `${path}.shared-receipt`.toUpperCase() : `${path}.shared-receipt`) }
      })
      const submission = generated ? executeLiveAugmentDispense(dependencies, collection, [record, secondRecord])
        : createLiveTransferService(dependencies).retrieveVaultItems(['vault-a', 'vault-b'])
      await assert.rejects(submission, /reused a terminal receipt/)
      const database = reopen()
      assert.equal(database.getRecoveryOperationCount(), 1)
      assert.equal(await reconcileLiveRecoveryOperations(dependencies), 0)
      assert.equal(calls.some(call => call.method === 'ack-live-incoming'), false)
      if (!generated) assert.deepEqual(database.getVaultItems(['vault-a', 'vault-b'], false).map(item => item.state), ['retrieval_pending', 'retrieval_pending'])
    })
  }
  for (const cached of [true, false]) {
    await fixture(async ({ dependencies, handlers, seed, queue, calls, path }) => {
      seed(['vault-a', 'vault-b'])
      for (const [index, id] of ['vault-a', 'vault-b'].entries()) {
        const operationId = `separate-${index}`
        const retained = queue(`${operationId}-0`)
        dependencies.database.prepareRetrievalOperation({ operationId, stashPath: 'live://gdia/sc',
          sourceSha256: sourceHash, startedAtUtc: dependencies.clock.nowUtc(), vaultItemIds: [id],
          detail: { vaultItemIds: [id], queues: [retained], ...(cached ? { recoveryResolution: { entries: [{
            operationId: retained.operationId, state: 'rejected', receiptPath: `${path}.same`,
            semanticSha256: sourceHash, copiedReceiptPath: `${path}.same-copy`
          }] } } : {}) } })
      }
      handlers.set('inspect-live-retrieval', ({ allowHashFallback }) => {
        assert.equal(allowHashFallback, false, 'fallback uniqueness spans separate retained operations')
        return { state: 'rejected', receiptPath: `${path}.same` }
      })
      assert.equal(await reconcileLiveRecoveryOperations(dependencies), 0)
      assert.equal(dependencies.database.getRecoveryOperationCount(), 2)
      assert.equal(calls.some(call => call.method === 'ack-live-incoming'), false, 'neither operation may consume shared evidence')
    })
  }
  for (const unavailable of ['pending', 'error']) await fixture(async ({ dependencies, handlers, seed, queue, calls, path }) => {
    seed(['vault-a', 'vault-b', 'vault-c'])
    for (const [index, ids] of [['vault-a'], ['vault-b', 'vault-c']].entries()) {
      const operationId = `partial-${index}`
      dependencies.database.prepareRetrievalOperation({ operationId, stashPath: 'live://gdia/sc',
        sourceSha256: sourceHash, startedAtUtc: dependencies.clock.nowUtc(), vaultItemIds: ids,
        detail: { vaultItemIds: ids, queues: ids.map((_id, index) => queue(`${operationId}-${index}`)) } })
    }
    handlers.set('inspect-live-retrieval', ({ queue }) => {
      if (queue.operationId !== 'partial-1-1') return { state: 'deposited', receiptPath: `${path}.shared` }
      if (unavailable === 'error') throw new Error('Synthetic receipt inspection failure')
      return { state: 'pending', receiptPath: null }
    })
    assert.equal(await reconcileLiveRecoveryOperations(dependencies), 0, 'partially terminal operations also reserve their observed evidence')
    assert.equal(dependencies.database.getRecoveryOperationCount(), 2)
  })
  for (const incompletePeer of [false, true]) {
    await fixture(async ({ dependencies, seed, queue, handlers }) => {
      seed(['vault-a', 'vault-b'])
      dependencies.database.prepareRetrievalOperation({ operationId: 'unique', stashPath: 'live://gdia/sc',
        sourceSha256: sourceHash, startedAtUtc: dependencies.clock.nowUtc(), vaultItemIds: ['vault-a'],
        detail: { vaultItemIds: ['vault-a'], queues: [queue('unique-0')] } })
      if (incompletePeer) dependencies.database.prepareRetrievalOperation({ operationId: 'lost-dispatch', stashPath: 'live://gdia/sc',
        sourceSha256: sourceHash, startedAtUtc: dependencies.clock.nowUtc(), vaultItemIds: ['vault-b'],
        detail: { vaultItemIds: ['vault-b'], pendingDispatch: { operationId: 'lost-dispatch-0', item: payload } } })
      handlers.set('inspect-live-retrieval', ({ queue, allowHashFallback }) => {
        assert.equal(allowHashFallback, !incompletePeer)
        return { state: 'deposited', receiptPath: `${queue.outgoingPath}.exact` }
      })
      assert.equal(await reconcileLiveRecoveryOperations(dependencies), 1, 'unique exact evidence still resolves even with another uncertain dispatch')
    })
  }
  console.log('Production transfer adapter checks passed.')
} finally {
  await rm(root, { recursive: true, force: true })
}
