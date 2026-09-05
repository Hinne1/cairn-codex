import { dirname, join } from 'node:path';
import type { CollectionDatabase } from '../collection-database.ts';
import type { TransferPorts } from './runtime.ts';
import type { LiveQueueReceipt, LiveRetrievalQueue, LiveRetrievalStatus } from './contracts.ts';
import type { RecoveryJournalOperation } from '../collection-database.ts';
import type { DiagnosticLogger } from '../diagnostics.ts';
import { hasUniqueLivePayload, haveDistinctLiveReceipts, liveReceiptPathKey } from '../live-receipt-policy.ts'

export type RetainedReceiptsDependencies = TransferPorts & {
  database: Pick<CollectionDatabase, 'completeDeliveryOperation' | 'completePartialRetrievalOperation' | 'completeRetrievalOperation' | 'failDeliveryOperation' | 'failRetrievalOperation' | 'getVaultItems' | 'listRecoveryOperations' | 'updatePendingOperationDetail'>
} & { diagnostics: Pick<DiagnosticLogger, 'info' | 'error'> }

export interface TerminalRecoveryEntry {
  operationId: string
  state: 'deposited' | 'rejected'
  receiptPath: string
  semanticSha256: string
  copiedReceiptPath: string | null
}

export function retainedRecoveryQueues(operation: RecoveryJournalOperation): LiveRetrievalQueue[] {
  if (operation.detail.pendingDispatch || operation.detail.dispatchComplete === false) return []
  const queues = operation.detail.queues
  if (!Array.isArray(queues)) return []
  const parsed = queues.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const queue = candidate as Record<string, unknown>
    if (
      typeof queue.operationId !== 'string' ||
      typeof queue.outgoingPath !== 'string' ||
      typeof queue.semanticSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(queue.semanticSha256) ||
      typeof queue.isHardcore !== 'boolean' ||
      !Array.isArray(queue.baselineDeleted) ||
      !queue.baselineDeleted.every((value) => typeof value === 'string') ||
      !Array.isArray(queue.baselineIncoming) ||
      !queue.baselineIncoming.every((value) => typeof value === 'string')
    ) return []
    return [{
      operationId: queue.operationId,
      outgoingPath: queue.outgoingPath,
      semanticSha256: queue.semanticSha256,
      isHardcore: queue.isHardcore,
      baselineDeleted: queue.baselineDeleted as string[],
      baselineIncoming: queue.baselineIncoming as string[]
    }]
  })
  const generated = operation.detail.transferKind === 'generated_delivery'
  const expectedMode = generated ? operation.detail.isHardcore
    : operation.destination === 'live://gdia/hc' ? true : operation.destination === 'live://gdia/sc' ? false : undefined
  const selection = generated ? operation.detail.records : operation.detail.vaultItemIds
  const expectedCount = generated && typeof operation.detail.record === 'string' ? 1
    : Array.isArray(selection) && selection.every(id => typeof id === 'string') ? selection.length : undefined
  const legacySahdina = generated && operation.id.startsWith('sahdina-') &&
    operation.detail.adapter === 'cairn-live-v1' &&
    operation.detail.record === 'records/items/gearaccessories/necklaces/b100_necklace_sahdina.dbr' &&
    operation.destination.startsWith('live://special-recovery/') && expectedCount === 1
  return typeof expectedMode === 'boolean' && expectedCount === queues.length &&
    (operation.detail.expectedQueueCount === undefined || operation.detail.expectedQueueCount === expectedCount) &&
    parsed.length === queues.length &&
    parsed.every((queue, index) => queue.isHardcore === expectedMode && (
      queue.operationId === `${operation.id}-${index}` || (legacySahdina && queue.operationId === operation.id)
    )) && new Set(parsed.map((queue) => queue.operationId)).size === parsed.length
    ? parsed
    : []
}

export function retainedTerminalResolution(operation: RecoveryJournalOperation): TerminalRecoveryEntry[] {
  const resolution = operation.detail.recoveryResolution
  if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution)) return []
  const entries = (resolution as Record<string, unknown>).entries
  if (!Array.isArray(entries)) return []
  const parsed = entries.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const entry = candidate as Record<string, unknown>
    if (
      typeof entry.operationId !== 'string' ||
      (entry.state !== 'deposited' && entry.state !== 'rejected') ||
      typeof entry.receiptPath !== 'string' ||
      typeof entry.semanticSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(entry.semanticSha256) ||
      (entry.copiedReceiptPath !== null && typeof entry.copiedReceiptPath !== 'string')
    ) return []
    return [{
      operationId: entry.operationId,
      state: entry.state as 'deposited' | 'rejected',
      receiptPath: entry.receiptPath,
      semanticSha256: entry.semanticSha256,
      copiedReceiptPath: entry.copiedReceiptPath as string | null
    }]
  })
  return parsed.length === entries.length &&
    new Set(parsed.map((entry) => entry.operationId)).size === parsed.length
    ? parsed
    : []
}

function receiptClaims(entries: readonly unknown[]): Array<{ receiptPath: string }> {
  return entries.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const path = (entry as Record<string, unknown>).receiptPath
    return typeof path === 'string' && path.trim() ? [{ receiptPath: path }] : []
  })
}

/** Legacy or damaged metadata can reserve evidence without authorizing finalization. */
function retainedReceiptClaims(operation: RecoveryJournalOperation): Array<{ receiptPath: string }> {
  const resolution = operation.detail.recoveryResolution
  if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution)) return []
  const entries = (resolution as Record<string, unknown>).entries
  if (!Array.isArray(entries)) return []
  return receiptClaims(entries)
}

function isTerminalReceipt(status: unknown): status is LiveRetrievalStatus & { state: 'deposited' | 'rejected'; receiptPath: string } {
  if (!status || typeof status !== 'object' || Array.isArray(status)) return false
  const entry = status as Record<string, unknown>
  return (entry.state === 'deposited' || entry.state === 'rejected') &&
    typeof entry.receiptPath === 'string' && Boolean(entry.receiptPath.trim())
}

export async function finalizeLiveRecoveryOperation(
  dependencies: RetainedReceiptsDependencies,
  operation: RecoveryJournalOperation,
  queues: LiveRetrievalQueue[],
  entries: TerminalRecoveryEntry[]
): Promise<boolean> {
  const { helper, database, clock, diagnostics } = dependencies
  if (
    queues.length === 0 || entries.length !== queues.length ||
    !haveDistinctLiveReceipts(entries) ||
    JSON.stringify(retainedRecoveryQueues(operation)) !== JSON.stringify(queues) ||
    entries.some((entry, index) =>
      entry.operationId !== queues[index]?.operationId ||
      entry.semanticSha256.toLowerCase() !== queues[index]?.semanticSha256.toLowerCase()
    )
  ) return false
  const rejected = entries.filter((entry) => entry.state === 'rejected')
  const deposited = entries.filter((entry) => entry.state === 'deposited')
  const generated = operation.detail.transferKind === 'generated_delivery'
  const vaultItemIds = Array.isArray(operation.detail.vaultItemIds)
    ? operation.detail.vaultItemIds.filter((value): value is string => typeof value === 'string')
    : []
  const expectedCount = generated
    ? operation.detail.expectedQueueCount ?? (Array.isArray(operation.detail.records)
      ? operation.detail.records.length : typeof operation.detail.record === 'string' ? 1 : undefined)
    : vaultItemIds.length
  if (
    (!generated && (vaultItemIds.length === 0 || new Set(vaultItemIds).size !== vaultItemIds.length)) ||
    (typeof expectedCount === 'number' && expectedCount !== queues.length) ||
    rejected.some(entry => !entry.copiedReceiptPath)
  ) return false
  if (!generated) {
    const selected = database.getVaultItems(vaultItemIds, queues[0]!.isHardcore)
    if (selected.some(item => item.state !== 'retrieval_pending')) return false
  }
  for (const entry of rejected) {
    await helper.request<LiveQueueReceipt>('ack-live-incoming', {
      path: entry.receiptPath,
      expectedSha256: entry.semanticSha256,
      receiptDirectory: dirname(entry.copiedReceiptPath!)
    })
  }

  const completedAtUtc = clock.nowUtc()
  if (generated) {
    if (deposited.length === 0) {
      database.failDeliveryOperation(
        operation.id,
        new Error('The game rejected every retained delivery; no generated item was delivered.')
      )
    } else {
      database.completeDeliveryOperation({
        operationId: operation.id,
        receiptPath: deposited[0]!.receiptPath,
        completedAtUtc,
        detail: {
          ...operation.detail,
          phase: 'recovered_committed',
          receiptPaths: deposited.map((entry) => entry.receiptPath),
          rejectedCount: rejected.length
        }
      })
    }
  } else {
    if (vaultItemIds.length === 0 || vaultItemIds.length !== queues.length) return false
    if (deposited.length === entries.length) {
      database.completeRetrievalOperation({
        operationId: operation.id,
        backupPath: deposited[0]!.receiptPath,
        completedAtUtc,
        vaultItemIds,
        detail: {
          ...operation.detail,
          phase: 'recovered_committed',
          receiptPaths: deposited.map((entry) => entry.receiptPath),
          vaultItemIds
        }
      })
    } else if (rejected.length === entries.length) {
      database.failRetrievalOperation(
        operation.id,
        vaultItemIds,
        new Error('The game rejected the retained retrieval; every archive copy remains stored.')
      )
    } else {
      const depositedVaultItemIds = entries.flatMap((entry, index) =>
        entry.state === 'deposited' ? [vaultItemIds[index]!] : []
      )
      const rejectedVaultItemIds = entries.flatMap((entry, index) =>
        entry.state === 'rejected' ? [vaultItemIds[index]!] : []
      )
      database.completePartialRetrievalOperation({
        operationId: operation.id,
        depositedVaultItemIds,
        rejectedVaultItemIds,
        receiptPaths: deposited.map((entry) => entry.receiptPath),
        completedAtUtc,
        detail: {
          ...operation.detail,
          phase: 'recovered_committed_partial',
          receiptPaths: deposited.map((entry) => entry.receiptPath),
          rejectedReceiptPaths: rejected.map((entry) => entry.receiptPath),
          depositedVaultItemIds,
          rejectedVaultItemIds,
          vaultItemIds
        }
      })
    }
  }
  diagnostics.info('recovery', 'operation.resolved', {
    operationId: operation.id,
    outcome: deposited.length > 0 ? 'committed' : 'rejected',
    depositedItems: deposited.length,
    rejectedItems: rejected.length
  })
  return true
}

export async function reconcileLiveRecoveryOperations(
  dependencies: RetainedReceiptsDependencies
): Promise<number> {
  const { helper, database, paths, clock, diagnostics } = dependencies
  let resolved = 0
  const operations = database.listRecoveryOperations()
  const retrievals = operations.filter(operation => operation.operation === 'retrieve')
  const allQueuesKnown = retrievals.every(operation => retainedRecoveryQueues(operation).length > 0)
  const allQueues = retrievals.flatMap(retainedRecoveryQueues)
  const plans: Array<{ operation: RecoveryJournalOperation; queues: LiveRetrievalQueue[]; entries: TerminalRecoveryEntry[] }> = []
  const owners = new Map<string, Set<string>>()
  const observe = (operationId: string, entries: readonly unknown[]): void => {
    for (const entry of receiptClaims(entries)) {
      const key = liveReceiptPathKey(entry.receiptPath)
      const set = owners.get(key) ?? new Set<string>()
      set.add(operationId)
      owners.set(key, set)
    }
  }
  for (const operation of operations) {
    if (operation.operation !== 'retrieve') continue
    let entries = retainedTerminalResolution(operation)
    observe(operation.id, retainedReceiptClaims(operation))
    const queues = retainedRecoveryQueues(operation)
    if (queues.length === 0) continue
    try {
      if (entries.length !== queues.length || entries.some(entry => entry.state === 'rejected' && !entry.copiedReceiptPath)) {
        const inspections = await Promise.allSettled(
          queues.map((queue) => helper.request<LiveRetrievalStatus>('inspect-live-retrieval', {
            queue, allowHashFallback: allQueuesKnown && hasUniqueLivePayload(queue, allQueues)
          }))
        )
        const inspected = inspections.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
        observe(operation.id, inspected)
        const failed = inspections.find(result => result.status === 'rejected')
        if (failed?.status === 'rejected') throw failed.reason
        if (!inspected.every(isTerminalReceipt)) continue
        if (!haveDistinctLiveReceipts(inspected)) continue
        entries = []
        for (const [index, status] of inspected.entries()) {
          const queue = queues[index]!
          entries.push({
            operationId: queue.operationId,
            state: status.state as 'deposited' | 'rejected',
            receiptPath: status.receiptPath!,
            semanticSha256: queue.semanticSha256,
            copiedReceiptPath: null
          })
        }
      }
      plans.push({ operation, queues, entries })
    } catch (error) {
      diagnostics.error('recovery', 'operation.inspect-failed', error, { operationId: operation.id })
    }
  }
  // Observe the entire retained set before any acknowledgement: even a partial
  // operation may already claim evidence another operation tries to reuse.
  for (const { operation, queues, entries } of plans) {
    if (!haveDistinctLiveReceipts(entries) || entries.some(entry => owners.get(liveReceiptPathKey(entry.receiptPath))!.size > 1)) continue
    try {
      for (const entry of entries) {
        if (entry.state !== 'rejected' || entry.copiedReceiptPath) continue
        const copied = await helper.request<LiveQueueReceipt>('copy-live-incoming', {
          path: entry.receiptPath, expectedSha256: entry.semanticSha256,
          receiptDirectory: join(paths.receipts, 'recovered-rejections')
        })
        entry.copiedReceiptPath = copied.receiptPath
      }
      const recoveryResolution = { recordedAtUtc: clock.nowUtc(), entries }
      database.updatePendingOperationDetail(operation.id, { recoveryResolution })
      operation.detail = { ...operation.detail, recoveryResolution }
      if (await finalizeLiveRecoveryOperation(
        dependencies, operation, queues, entries
      )) resolved += 1
    } catch (error) {
      diagnostics.error('recovery', 'operation.reconcile-failed', error, {
        operationId: operation.id
      })
    }
  }
  return resolved
}
