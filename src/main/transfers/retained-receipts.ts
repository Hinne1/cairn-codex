import { join } from 'node:path';
import type { CollectionDatabase } from '../collection-database.ts';
import type { TransferPorts } from './runtime.ts';
import type { LiveQueueReceipt, LiveRetrievalQueue, LiveRetrievalStatus } from './contracts.ts';
import type { RecoveryJournalOperation } from '../collection-database.ts';
import type { DiagnosticLogger } from '../diagnostics.ts';

export type RetainedReceiptsDependencies = TransferPorts & {
  database: Pick<CollectionDatabase, 'completeDeliveryOperation' | 'completePartialRetrievalOperation' | 'completeRetrievalOperation' | 'failDeliveryOperation' | 'failRetrievalOperation' | 'listRecoveryOperations' | 'updatePendingOperationDetail'>
} & { diagnostics: Pick<DiagnosticLogger, 'info' | 'error'> }

export interface TerminalRecoveryEntry {
  operationId: string
  state: 'deposited' | 'rejected'
  receiptPath: string
  semanticSha256: string
  copiedReceiptPath: string | null
}

export function retainedRecoveryQueues(operation: RecoveryJournalOperation): LiveRetrievalQueue[] {
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
  return parsed.length === queues.length &&
    new Set(parsed.map((queue) => queue.operationId)).size === parsed.length
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

export async function finalizeLiveRecoveryOperation(
  dependencies: RetainedReceiptsDependencies,
  operation: RecoveryJournalOperation,
  queues: LiveRetrievalQueue[],
  entries: TerminalRecoveryEntry[]
): Promise<boolean> {
  const { helper, database, paths, clock, diagnostics } = dependencies
  if (
    entries.length !== queues.length ||
    entries.some((entry, index) =>
      entry.operationId !== queues[index]?.operationId ||
      entry.semanticSha256.toLowerCase() !== queues[index]?.semanticSha256.toLowerCase()
    )
  ) return false
  const rejected = entries.filter((entry) => entry.state === 'rejected')
  const deposited = entries.filter((entry) => entry.state === 'deposited')
  for (const entry of rejected) {
    try {
      await helper.request<LiveQueueReceipt>('ack-live-incoming', {
        path: entry.receiptPath,
        expectedSha256: entry.semanticSha256,
        receiptDirectory: join(paths.receipts, 'recovered-rejections')
      })
    } catch (error) {
      if (!entry.copiedReceiptPath) throw error
      diagnostics.info('recovery', 'rejected-receipt.already-moved', {
        operationId: operation.id,
        queueOperationId: entry.operationId
      })
    }
  }

  const generated = operation.detail.transferKind === 'generated_delivery'
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
    const vaultItemIds = Array.isArray(operation.detail.vaultItemIds)
      ? operation.detail.vaultItemIds.filter((value): value is string => typeof value === 'string')
      : []
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
  for (const operation of database.listRecoveryOperations()) {
    if (operation.operation !== 'retrieve') continue
    const queues = retainedRecoveryQueues(operation)
    if (queues.length === 0) continue
    try {
      let entries = retainedTerminalResolution(operation)
      if (entries.length !== queues.length) {
        const inspected = await Promise.all(
          queues.map((queue) => helper.request<LiveRetrievalStatus>('inspect-live-retrieval', { queue }))
        )
        if (inspected.some((status) =>
          (status.state !== 'deposited' && status.state !== 'rejected') || !status.receiptPath
        )) continue
        entries = []
        for (const [index, status] of inspected.entries()) {
          const queue = queues[index]!
          let copiedReceiptPath: string | null = null
          if (status.state === 'rejected') {
            const copied = await helper.request<LiveQueueReceipt>('copy-live-incoming', {
              path: status.receiptPath!,
              expectedSha256: queue.semanticSha256,
              receiptDirectory: join(paths.receipts, 'recovered-rejections')
            })
            copiedReceiptPath = copied.receiptPath
          }
          entries.push({
            operationId: queue.operationId,
            state: status.state as 'deposited' | 'rejected',
            receiptPath: status.receiptPath!,
            semanticSha256: queue.semanticSha256,
            copiedReceiptPath
          })
        }
        database.updatePendingOperationDetail(operation.id, {
          recoveryResolution: { recordedAtUtc: clock.nowUtc(), entries }
        })
        operation.detail = {
          ...operation.detail,
          recoveryResolution: { recordedAtUtc: clock.nowUtc(), entries }
        }
      }
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
