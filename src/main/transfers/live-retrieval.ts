import { join } from 'node:path';
import type { CollectionDatabase } from '../collection-database.ts';
import type { LiveVaultPayload } from '../collection-presentation.ts';
import type { LiveGameStatus } from '../../shared/contracts.ts';
import type { LiveQueueReceipt, LiveRetrievalQueue, LiveRetrievalStatus } from './contracts.ts';
import { LiveTransferDomainService } from '../ipc/live-transfer-service.ts';
import { reconcileLiveRecoveryOperations, type RetainedReceiptsDependencies } from './retained-receipts.ts';
import { hasUniqueLivePayload } from '../live-receipt-policy.ts'

export type LiveRetrievalDependencies = RetainedReceiptsDependencies & {
  database: Pick<CollectionDatabase, 'listVaultItems' | 'getVaultItems' | 'prepareRetrievalOperation' | 'markRetrievalNeedsRecovery' | 'getRecoveryOperationCount'>
}

/** The caller owns the shared transfer queue; these bindings never re-enter it. */
export function createLiveTransferService(dependencies: LiveRetrievalDependencies): LiveTransferDomainService {
  const { helper, database, paths, clock } = dependencies
  return new LiveTransferDomainService({
    clock,
    journal: {
      readVaultItems: (vaultItemIds, isHardcore) => {
        const summaries = new Map(
          database.listVaultItems(isHardcore).map((item) => [item.id, item])
        )
        const matchingIds = vaultItemIds.filter((id) => summaries.has(id))
        if (matchingIds.length === 0) return []
        return database.getVaultItems(matchingIds, isHardcore).map((item) => {
          const summary = summaries.get(item.id)!
          const payload = item.payload as LiveVaultPayload
          return {
            id: item.id,
            baseRecord: item.baseRecord,
            seed: payload.seed ?? summary.seed,
            isHardcore,
            state: item.state,
            payload: item.payload
          }
        })
      },
      prepareRetrieval: (input) => database.prepareRetrievalOperation({
        operationId: input.operationId,
        stashPath: input.stashPath,
        sourceSha256: input.sourceIdentity,
        startedAtUtc: input.startedAtUtc,
        vaultItemIds: input.vaultItemIds,
        detail: input.detail
      }),
      updatePendingDetail: (operationId, detail) =>
        database.updatePendingOperationDetail(operationId, detail),
      completeRetrieval: (input) => database.completeRetrievalOperation({
        operationId: input.operationId,
        vaultItemIds: input.vaultItemIds,
        backupPath: input.receiptPaths[0]!,
        completedAtUtc: input.completedAtUtc,
        detail: input.detail
      }),
      completePartialRetrieval: (input) => database.completePartialRetrievalOperation(input),
      failRetrieval: (operationId, vaultItemIds, error) =>
        database.failRetrievalOperation(operationId, [...vaultItemIds], error),
      markRetrievalNeedsRecovery: (operationId, error) =>
        database.markRetrievalNeedsRecovery(operationId, error)
    },
    adapter: {
      inspectGame: () => helper.request<LiveGameStatus>('inspect-live-game'),
      enqueueRetrieval: (input) => helper.request<LiveRetrievalQueue>('enqueue-live-retrieval', input),
      inspectRetrieval: (queue, batch) =>
        helper.request<LiveRetrievalStatus>('inspect-live-retrieval', { queue, allowHashFallback: hasUniqueLivePayload(queue, batch) }),
      copyRejectedReceipt: (input) => helper.request<LiveQueueReceipt>('copy-live-incoming', {
        ...input,
        receiptDirectory: join(paths.receipts, 'rejected-returns')
      }),
      acknowledgeRejectedReceipt: (input) => helper.request<LiveQueueReceipt>('ack-live-incoming', {
        ...input,
        receiptDirectory: join(paths.receipts, 'rejected-returns')
      }).then(() => undefined)
    },
    recovery: {
      reconcile: () => reconcileLiveRecoveryOperations(dependencies).then(() => undefined),
      unresolvedCount: () => database.getRecoveryOperationCount()
    }
  })
}
