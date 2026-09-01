import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CollectionDatabase } from '../src/main/collection-database.ts'
import {
  ArchiveDomainService,
  ArchiveServiceError
} from '../src/main/ipc/archive-service.ts'
import {
  LiveTransferDomainService,
  LiveTransferServiceError
} from '../src/main/ipc/live-transfer-service.ts'

const emptySummary = {
  total: 0,
  ingested: 0,
  retrievalPending: 0,
  retrieved: 0,
  quarantined: 0,
  supplies: 0
}

function ingestResult(id = 'ingest-1') {
  return {
    operationId: id,
    status: 'committed',
    ingested: [{ vaultItemId: 'vault-a', baseRecord: 'records/a.dbr', seed: 7 }],
    sourceItems: 1,
    remainingItems: 0,
    lastTabItems: 0,
    sourceSha256: 'source',
    committedSha256: 'committed',
    backupPath: 'verified-backup',
    rollbackPath: 'rollback'
  }
}

function retrievalResult(id = 'retrieve-1') {
  return {
    operationId: id,
    status: 'committed',
    retrieved: [{ vaultItemId: 'vault-a', baseRecord: 'records/a.dbr', seed: 7 }],
    sourceItems: 0,
    remainingItems: 1,
    targetTabItems: 1,
    sourceSha256: 'source',
    committedSha256: 'committed',
    backupPath: 'verified-backup',
    rollbackPath: 'rollback'
  }
}

function archiveFixture(overrides = {}) {
  const order = []
  const backups = []
  const backupFailures = []
  const dependencies = {
    reads: {
      findCatalogNames: () => new Map([['records/a.dbr', 'Fixture A']]),
      readVaultItems: () => [],
      readVaultPage: (request) => ({ items: [], total: 0, offset: request.offset, limit: request.limit }),
      readOperationHistory: (request) => ({ items: [], total: 0, offset: request.offset, limit: request.limit }),
      readVaultSummary: () => emptySummary,
      ...overrides.reads
    },
    stashes: {
      scan: async (path) => ({
        path,
        sha256: `sha:${path}`,
        itemCount: path.includes('ingest') ? 1 : 0,
        tabs: [{
          index: 2,
          items: path.includes('ingest')
            ? [{ tabIndex: 2, itemIndex: 0, baseRecord: 'records/a.dbr', seed: 7 }]
            : []
        }]
      }),
      ...overrides.stashes
    },
    transactions: {
      commitIngest: async () => {
        order.push('ingest:commit')
        return ingestResult()
      },
      commitRetrieval: async () => {
        order.push('retrieve:commit')
        return retrievalResult()
      },
      ...overrides.transactions
    },
    enqueueArchiveBackup: (reason) => {
      order.push(`backup:${reason}`)
      backups.push(reason)
    },
    reportBackupSchedulingFailure: (reason, error) => backupFailures.push([reason, error]),
    discoverInstallationPath: async () => 'fixture/game',
    simulateDismantling: async (_installationPath, items) => ({
      ruleRecord: 'records/dismantle.dbr', contentPack: 'base', itemCount: items.length,
      dynamiteCost: 1, ironCost: 100, scrapMinimum: 1, scrapMaximum: 2,
      scrapExpected: 1.5, scrapOutcomes: [], rewards: [], items: []
    }),
    ...overrides.dependencies
  }
  return { service: new ArchiveDomainService(dependencies), order, backups, backupFailures }
}

{
  const eligible = {
    id: 'vault-a', baseRecord: 'records/a.dbr', name: 'Fixture A', rarity: 'epic',
    slot: 'weapon', levelRequirement: 1, itemLevel: 10, catalogued: true,
    reusable: false, isHardcore: false, state: 'ingested', seed: 7, stackCount: 1,
    prefixRecord: '', suffixRecord: '', componentRecord: '', augmentRecord: '',
    ascendant: false, instanceKey: 'fixture', rollAnalysis: null,
    ingestedAtUtc: new Date(0).toISOString(), retrievedAtUtc: null
  }
  let simulated = null
  const fixture = archiveFixture({
    reads: { readVaultItems: () => [eligible] },
    dependencies: {
      simulateDismantling: async (installationPath, items) => {
        simulated = { installationPath, items }
        return {
          ruleRecord: 'records/dismantle.dbr', contentPack: 'base', itemCount: 1,
          dynamiteCost: 1, ironCost: 100, scrapMinimum: 1, scrapMaximum: 2,
          scrapExpected: 1.5, scrapOutcomes: [], rewards: [], items: []
        }
      }
    }
  })
  assert.equal((await fixture.service.previewDismantling(['vault-a'])).itemCount, 1)
  assert.equal(simulated.installationPath, 'fixture/game')
  assert.equal(simulated.items[0].vaultItemId, 'vault-a')
  await assert.rejects(fixture.service.previewDismantling(['vault-a', 'vault-a']),
    (error) => error instanceof ArchiveServiceError && error.code === 'archive.dismantling-duplicate')
}

{
  const fixture = archiveFixture()
  const request = { state: 'ingested', sort: 'recent', direction: 'desc', offset: 0, limit: 25 }
  assert.deepEqual(fixture.service.queryVaultItems(request), {
    items: [], total: 0, offset: 0, limit: 25
  })
  const invalid = archiveFixture({
    reads: {
      readVaultPage: () => ({ items: new Array(26).fill({}), total: 26, offset: 0, limit: 25 })
    }
  })
  assert.throws(
    () => invalid.service.queryVaultItems(request),
    (error) => error instanceof ArchiveServiceError && error.code === 'archive.vault-query-invalid'
  )
}

{
  let releaseIngest
  let signalIngestStarted
  const gate = new Promise((resolve) => { releaseIngest = resolve })
  const ingestStarted = new Promise((resolve) => { signalIngestStarted = resolve })
  const fixture = archiveFixture({
    transactions: {
      commitIngest: async () => {
        fixture.order.push('ingest:start')
        signalIngestStarted()
        await gate
        fixture.order.push('ingest:commit')
        return ingestResult()
      }
    }
  })
  const ingest = fixture.service.ingestStagingTab('fixture-ingest.gst')
  const retrieve = fixture.service.retrieveVaultItems('fixture-retrieve.gst', ['vault-a'])
  await ingestStarted
  assert.deepEqual(fixture.order, ['ingest:start'], 'offline mutations must serialize')
  releaseIngest()
  assert.equal((await ingest).status, 'committed')
  assert.equal((await retrieve).status, 'committed')
  assert.deepEqual(fixture.order, [
    'ingest:start',
    'ingest:commit',
    'backup:offline ingest',
    'retrieve:commit',
    'backup:offline retrieval'
  ])
}

{
  const fixture = archiveFixture({
    transactions: { commitIngest: async () => { throw new Error('commit failed') } }
  })
  await assert.rejects(fixture.service.ingestStagingTab('fixture-ingest.gst'), /commit failed/)
  assert.deepEqual(fixture.backups, [], 'failed mutations must not request a backup')
}

{
  const fixture = archiveFixture({
    dependencies: { enqueueArchiveBackup: () => { throw new Error('queue offline') } }
  })
  assert.equal((await fixture.service.ingestStagingTab('fixture-ingest.gst')).status, 'committed')
  assert.equal(fixture.backupFailures.length, 1, 'post-commit backup queue failures are reported')
}

function readyStatus(isHardcore = false) {
  return {
    state: 'ready',
    detail: 'Ready.',
    grimDawnProcessIds: [1],
    itemAssistantProcessIds: [],
    hookAvailable: true,
    adapterDirectory: 'fixture',
    hookVersion: 'fixture',
    connectedProcessId: 1,
    isHardcore,
    activeCharacterName: 'Fixture',
    ingestTabSetting: 4,
    depositTabSetting: 5,
    ingestTabDescription: 'ingest tab',
    depositTabDescription: 'deposit tab',
    hostWindowReady: true,
    injectorOutput: null,
    messages: [],
    gameVersion: 'fixture',
    gameBuildId: 'fixture',
    gameDllSha256: 'a'.repeat(64),
    gameDllLastWriteUtc: '2026-09-01T00:00:00.000Z',
    hookSha256: 'b'.repeat(64),
    recommendation: null
  }
}

function transferFixture(options = {}) {
  let now = 0
  let sequence = 0
  const events = []
  const details = new Map()
  const states = new Map(options.initialStates ?? [
    ['a', 'ingested'],
    ['b', 'ingested']
  ])
  const unresolved = { count: options.unresolved ?? 0 }
  const journal = {
    readVaultItems(ids, isHardcore) {
      if (isHardcore) return []
      return ids.flatMap((id) => states.has(id) ? [{
        id,
        baseRecord: `records/${id}.dbr`,
        seed: id === 'a' ? 1 : 2,
        isHardcore: false,
        state: states.get(id),
        payload: { id }
      }] : [])
    },
    prepareRetrieval(input) {
      events.push(['prepare', input.operationId])
      if (options.prepareError) throw options.prepareError
      for (const id of input.vaultItemIds) states.set(id, 'retrieval_pending')
    },
    updatePendingDetail(operationId, detail) {
      events.push(['detail', operationId, detail.phase])
      details.set(operationId, detail)
    },
    completeRetrieval(input) {
      events.push(['complete', input.operationId, ...input.receiptPaths])
      for (const id of input.vaultItemIds) states.set(id, 'retrieved')
    },
    completePartialRetrieval(input) {
      events.push([
        'complete-partial',
        input.operationId,
        [...input.depositedVaultItemIds],
        [...input.rejectedVaultItemIds],
        [...input.receiptPaths]
      ])
      if (options.partialCompleteError) throw options.partialCompleteError
      for (const id of input.depositedVaultItemIds) states.set(id, 'retrieved')
      for (const id of input.rejectedVaultItemIds) states.set(id, 'ingested')
    },
    failRetrieval(operationId, ids) {
      events.push(['fail', operationId])
      for (const id of ids) states.set(id, 'ingested')
    },
    markRetrievalNeedsRecovery(operationId) {
      events.push(['needs-recovery', operationId])
      unresolved.count += 1
    }
  }
  const adapter = {
    inspectGame: async () => options.status ?? readyStatus(),
    enqueueRetrieval: async (input) => {
      events.push(['enqueue', input.operationId])
      if (options.enqueue) return options.enqueue(input, events)
      return {
        operationId: input.operationId,
        outgoingPath: `queue/${input.operationId}.csv`,
        semanticSha256: (input.operationId.endsWith('-0') ? 'a' : 'b').repeat(64),
        isHardcore: input.isHardcore,
        baselineDeleted: [],
        baselineIncoming: []
      }
    },
    inspectRetrieval: async (queue) => options.inspect
      ? options.inspect(queue, events)
      : { state: 'deposited', receiptPath: `receipt/${queue.operationId}.csv` },
    copyRejectedReceipt: async (input) => {
      events.push(['copy-rejected', input.path])
      if (options.copyError) throw options.copyError
      return { receiptPath: `copied/${input.path}` }
    },
    acknowledgeRejectedReceipt: async (input) => {
      events.push(['ack-rejected', input.path])
      if (options.ackError) throw options.ackError
    }
  }
  const recovery = {
    reconcile: async () => {
      events.push(['reconcile'])
      await options.reconcile?.({ journal, states, unresolved, events })
    },
    unresolvedCount: () => unresolved.count
  }
  const clock = {
    now: () => now,
    wait: async (milliseconds) => { now += milliseconds },
    operationId: () => `operation-${++sequence}`
  }
  return {
    service: new LiveTransferDomainService({
      journal,
      adapter,
      recovery,
      clock,
      timeoutMs: options.timeoutMs ?? 10,
      pollIntervalMs: options.pollIntervalMs ?? 5
    }),
    events,
    details,
    unresolved,
    states
  }
}

{
  const fixture = transferFixture({ unresolved: 1 })
  await assert.rejects(
    fixture.service.retrieveVaultItems(['a']),
    (error) => error instanceof LiveTransferServiceError && error.code === 'live-transfer.recovery-required'
  )
  assert.equal(fixture.events.some(([event]) => event === 'enqueue'), false,
    'recovery gating must run before native writes')
}

{
  let releaseFirst
  let signalFirstStarted
  const firstGate = new Promise((resolve) => { releaseFirst = resolve })
  const firstStarted = new Promise((resolve) => { signalFirstStarted = resolve })
  const fixture = transferFixture({
    enqueue: async (input, events) => {
      if (input.operationId === 'operation-1-0') {
        signalFirstStarted()
        await firstGate
      }
      events.push(['enqueue-returned', input.operationId])
      return {
        operationId: input.operationId,
        outgoingPath: `queue/${input.operationId}.csv`,
        semanticSha256: 'c'.repeat(64),
        isHardcore: false,
        baselineDeleted: [],
        baselineIncoming: []
      }
    }
  })
  const first = fixture.service.retrieveVaultItems(['a'])
  const repeated = fixture.service.retrieveVaultItems(['a'])
  const second = fixture.service.retrieveVaultItems(['b'])
  assert.equal(first, repeated, 'a repeated in-flight submission must share the original result')
  await firstStarted
  assert.equal(fixture.events.filter(([event]) => event === 'enqueue').length, 1)
  releaseFirst()
  assert.deepEqual((await first).receiptPaths, ['receipt/operation-1-0.csv'])
  assert.deepEqual((await second).receiptPaths, ['receipt/operation-2-0.csv'])
  assert.deepEqual(
    fixture.events.filter(([event]) => event === 'enqueue').map(([, operationId]) => operationId),
    ['operation-1-0', 'operation-2-0'],
    'different submissions must serialize'
  )
}

{
  const fixture = transferFixture({ prepareError: new Error('journal unavailable') })
  await assert.rejects(fixture.service.retrieveVaultItems(['a']), /journal unavailable/)
  assert.equal(fixture.events.some(([event]) => event === 'enqueue'), false,
    'journal preparation must precede native writes')
  assert.equal(fixture.events.some(([event]) => event === 'needs-recovery'), false,
    'a pre-enqueue failure is not an uncertain native outcome')
}

{
  const fixture = transferFixture({ inspect: async () => ({ state: 'pending', receiptPath: null }) })
  await assert.rejects(
    fixture.service.retrieveVaultItems(['a']),
    (error) => error instanceof LiveTransferServiceError && error.code === 'live-transfer.outcome-uncertain'
  )
  assert.equal(fixture.events.some(([event]) => event === 'complete'), false)
  assert.equal(fixture.events.some(([event]) => event === 'fail'), false)
  assert.equal(fixture.events.some(([event]) => event === 'needs-recovery'), true)
  const enqueueCount = fixture.events.filter(([event]) => event === 'enqueue').length
  await assert.rejects(
    fixture.service.retrieveVaultItems(['a']),
    (error) => error instanceof LiveTransferServiceError && error.code === 'live-transfer.recovery-required'
  )
  assert.equal(fixture.events.filter(([event]) => event === 'enqueue').length, enqueueCount,
    'an uncertain operation cannot be resubmitted through recovery gating')
  assert.equal(fixture.states.get('a'), 'retrieval_pending')
}

{
  const fixture = transferFixture({
    inspect: async (queue) => queue.operationId.endsWith('-0')
      ? { state: 'deposited', receiptPath: `deposited/${queue.operationId}.csv` }
      : { state: 'rejected', receiptPath: `rejected/${queue.operationId}.csv` }
  })
  const result = await fixture.service.retrieveVaultItems(['a', 'b'])
  assert.deepEqual(result.retrieved, [
    { vaultItemId: 'a', baseRecord: 'records/a.dbr', seed: 1 }
  ])
  assert.deepEqual(result.receiptPaths, ['deposited/operation-1-0.csv'])
  assert.equal(result.issues.length, 1)
  assert.match(result.issues[0], /1 of 2 selected items were deposited/i)
  assert.match(result.issues[0], /1 item remains safely stored/i)
  const phases = fixture.events.map(([event]) => event)
  const copiedDetailIndex = fixture.events.findIndex(([, , phase]) =>
    phase === 'terminal-receipts-copied'
  )
  assert.ok(phases.indexOf('copy-rejected') < copiedDetailIndex)
  assert.ok(copiedDetailIndex < phases.indexOf('ack-rejected'),
    'copied receipt destination must persist before rejected acknowledgement')
  assert.ok(phases.indexOf('ack-rejected') < phases.indexOf('complete-partial'),
    'mixed completion must follow durable rejected-receipt acknowledgement')
  assert.equal(fixture.events.some(([event]) => event === 'needs-recovery'), false)
  assert.equal(fixture.states.get('a'), 'retrieved')
  assert.equal(fixture.states.get('b'), 'ingested')
}

// A process failure after acknowledgement but before journal completion remains
// recoverable because the durable copied receipt destination was persisted first.
{
  const fixture = transferFixture({
    inspect: async (queue) => queue.operationId.endsWith('-0')
      ? { state: 'deposited', receiptPath: `deposited/${queue.operationId}.csv` }
      : { state: 'rejected', receiptPath: `rejected/${queue.operationId}.csv` },
    partialCompleteError: new Error('simulated process exit after acknowledgement')
  })
  await assert.rejects(
    fixture.service.retrieveVaultItems(['a', 'b']),
    /simulated process exit after acknowledgement/
  )
  const resolution = fixture.details.get('operation-1').recoveryResolution
  assert.equal(resolution.entries[1].copiedReceiptPath,
    'copied/rejected/operation-1-1.csv')
  const phases = fixture.events.map(([event]) => event)
  assert.ok(phases.indexOf('copy-rejected') < phases.indexOf('ack-rejected'))
  assert.ok(phases.indexOf('ack-rejected') < phases.indexOf('needs-recovery'))
  assert.equal(fixture.unresolved.count, 1)
}

{
  const fixture = transferFixture({
    inspect: async (queue) => queue.operationId.endsWith('-0')
      ? { state: 'deposited', receiptPath: `deposited/${queue.operationId}.csv` }
      : { state: 'rejected', receiptPath: `rejected/${queue.operationId}.csv` },
    ackError: new Error('durable acknowledgement failed')
  })
  await assert.rejects(
    fixture.service.retrieveVaultItems(['a', 'b']),
    /durable acknowledgement failed/
  )
  assert.equal(fixture.events.some(([event]) => event === 'complete-partial'), false)
  assert.equal(fixture.events.some(([event]) => event === 'needs-recovery'), true)
  assert.equal(fixture.states.get('a'), 'retrieval_pending')
  assert.equal(fixture.states.get('b'), 'retrieval_pending')
}

{
  const fixture = transferFixture({
    unresolved: 1,
    initialStates: [
      ['a', 'retrieval_pending'],
      ['b', 'retrieval_pending'],
      ['c', 'ingested']
    ],
    reconcile: ({ journal, unresolved }) => {
      journal.completePartialRetrieval({
        operationId: 'restarted-mixed-operation',
        depositedVaultItemIds: ['a'],
        rejectedVaultItemIds: ['b'],
        receiptPaths: ['deposited/restarted-mixed-operation-0.csv'],
        completedAtUtc: new Date(0).toISOString(),
        detail: { phase: 'recovered_committed_partial' }
      })
      unresolved.count = 0
    }
  })
  const result = await fixture.service.retrieveVaultItems(['c'])
  assert.equal(result.retrieved[0]?.vaultItemId, 'c')
  assert.equal(fixture.states.get('a'), 'retrieved')
  assert.equal(fixture.states.get('b'), 'ingested')
  assert.equal(fixture.states.get('c'), 'retrieved')
  assert.deepEqual(
    fixture.events.filter(([event]) => event === 'reconcile' || event === 'complete-partial' || event === 'enqueue')
      .map(([event]) => event),
    ['reconcile', 'complete-partial', 'enqueue'],
    'a fresh service must reconcile a retained mixed operation before accepting another native write'
  )
  assert.equal(fixture.unresolved.count, 0)
}

{
  const fixture = transferFixture({
    inspect: async (queue) => ({ state: 'rejected', receiptPath: `rejected/${queue.operationId}.csv` })
  })
  await assert.rejects(
    fixture.service.retrieveVaultItems(['a']),
    (error) => error instanceof LiveTransferServiceError && error.code === 'live-transfer.rejected'
  )
  const phases = fixture.events.map(([event]) => event)
  assert.ok(phases.indexOf('detail') < phases.indexOf('ack-rejected'),
    'terminal receipt details must persist before acknowledgement')
  assert.ok(phases.indexOf('ack-rejected') < phases.indexOf('fail'),
    'a rejected receipt must be acknowledged before releasing the archive copy')
  assert.equal(fixture.events.some(([event]) => event === 'needs-recovery'), false)
  assert.equal(fixture.states.get('a'), 'ingested')
}

{
  const databaseRoot = await mkdtemp(join(tmpdir(), 'cairn-partial-retrieval-'))
  const databasePath = join(databaseRoot, 'collection.sqlite')
  let database = new CollectionDatabase(databasePath)
  try {
    const importedIds = []
    for (const id of ['a', 'b', 'c', 'd']) {
      const baseRecord = `records/${id}.dbr`
      database.ensureQuarantineCatalogItem(baseRecord)
      const imported = database.importVaultItems({
        sourcePath: `fixture-${id}.db`,
        sourceSha256: `fixture-${id}-sha`,
        backupPath: `fixture-${id}.backup`,
        importedAtUtc: new Date(0).toISOString(),
        items: [{
          externalId: id,
          baseRecord,
          isHardcore: false,
          createdAtUtc: new Date(0).toISOString(),
          payload: { baseRecord, seed: id.charCodeAt(0) }
        }]
      })
      assert.equal(imported.importedIds.length, 1)
      importedIds.push(imported.importedIds[0])
    }

    const operationId = 'database-mixed-operation'
    const vaultItemIds = importedIds.slice(0, 2)
    database.prepareRetrievalOperation({
      operationId,
      stashPath: 'live://gdia/sc',
      sourceSha256: 'database-mixed-source',
      startedAtUtc: new Date(1).toISOString(),
      vaultItemIds,
      detail: { phase: 'prepared', vaultItemIds }
    })
    database.completePartialRetrievalOperation({
      operationId,
      depositedVaultItemIds: [vaultItemIds[0]],
      rejectedVaultItemIds: [vaultItemIds[1]],
      receiptPaths: ['deposited/database-mixed-operation-0.csv'],
      completedAtUtc: new Date(2).toISOString(),
      detail: { phase: 'committed_partial', vaultItemIds }
    })
    const completedStates = new Map(
      database.getVaultItems(vaultItemIds, false).map((item) => [item.id, item.state])
    )
    assert.equal(completedStates.get(vaultItemIds[0]), 'retrieved')
    assert.equal(completedStates.get(vaultItemIds[1]), 'ingested')
    assert.equal(database.hasCommittedOperation(operationId), true)
    assert.equal(database.getRecoveryOperationCount(), 0)

    const restartedOperationId = 'database-restarted-mixed-operation'
    const restartedIds = importedIds.slice(2)
    database.prepareRetrievalOperation({
      operationId: restartedOperationId,
      stashPath: 'live://gdia/sc',
      sourceSha256: 'database-restarted-mixed-source',
      startedAtUtc: new Date(3).toISOString(),
      vaultItemIds: restartedIds,
      detail: { phase: 'prepared', vaultItemIds: restartedIds }
    })
    database.updatePendingOperationDetail(restartedOperationId, {
      phase: 'terminal-receipts-verified',
      recoveryResolution: { entries: [
        { state: 'deposited', receiptPath: 'deposited/restarted-0.csv' },
        { state: 'rejected', receiptPath: 'rejected/restarted-1.csv' }
      ] }
    })
    database.markRetrievalNeedsRecovery(restartedOperationId, new Error('simulated restart'))
    database.close()
    database = new CollectionDatabase(databasePath)
    const circularDetail = { phase: 'recovered_committed_partial', vaultItemIds: restartedIds }
    circularDetail.self = circularDetail
    assert.throws(() => database.completePartialRetrievalOperation({
      operationId: restartedOperationId,
      depositedVaultItemIds: [restartedIds[0]],
      rejectedVaultItemIds: [restartedIds[1]],
      receiptPaths: ['deposited/restarted-0.csv'],
      completedAtUtc: new Date(4).toISOString(),
      detail: circularDetail
    }), /circular/i)
    assert.deepEqual(
      database.getVaultItems(restartedIds, false).map((item) => item.state),
      ['retrieval_pending', 'retrieval_pending'],
      'a partial-completion failure must roll back every item state change'
    )
    assert.equal(database.getRecoveryOperationCount(), 1)
    database.completePartialRetrievalOperation({
      operationId: restartedOperationId,
      depositedVaultItemIds: [restartedIds[0]],
      rejectedVaultItemIds: [restartedIds[1]],
      receiptPaths: ['deposited/restarted-0.csv'],
      completedAtUtc: new Date(4).toISOString(),
      detail: { phase: 'recovered_committed_partial', vaultItemIds: restartedIds }
    })
    const restartedStates = new Map(
      database.getVaultItems(restartedIds, false).map((item) => [item.id, item.state])
    )
    assert.equal(restartedStates.get(restartedIds[0]), 'retrieved')
    assert.equal(restartedStates.get(restartedIds[1]), 'ingested')
    assert.equal(database.hasCommittedOperation(restartedOperationId), true)
    assert.equal(database.getRecoveryOperationCount(), 0)
  } finally {
    database.close()
    await rm(databaseRoot, { recursive: true, force: true })
  }
}

console.log('Archive and live-transfer domain service checks passed.')
