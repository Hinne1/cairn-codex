
import type { CollectionDatabase } from '../collection-database.ts';
import type { TransferPorts } from './runtime.ts';

import type { IngestResult, RetrievalResult, WriteSafetyStatus } from '../../shared/contracts.ts';
import { isHardcoreStashPath } from './runtime.ts';

export type OfflineTransactionsDependencies = TransferPorts & {
  database: Pick<CollectionDatabase, 'completeIngestOperation' | 'completeRetrievalOperation' | 'failIngestOperation' | 'failRetrievalOperation' | 'getVaultItems' | 'markRetrievalNeedsRecovery' | 'prepareIngestOperation' | 'prepareRetrievalOperation'>
}

export interface IngestCommand {
  path: string
  expectedSourceSha256: string
  items: Array<{ tabIndex: number; itemIndex: number; expectedSeed: number }>
}

export interface IngestPlan {
  path: string
  sourceSha256: string
  sourceItemCount: number
  replacementItemCount: number
  replacementSha256: string
  semanticallyValid: boolean
  idempotent: boolean
  items: Array<{ baseRecord: string; seed: number; [key: string]: unknown }>
}

export interface CommittedIngest {
  plan: IngestPlan
  transaction: {
    backupPath: string
    rollbackPath: string
    sourceSha256: string
    committedSha256: string
  }
}

export interface RetrievalCommand {
  path: string
  expectedSourceSha256: string
  targetTabIndex: number
  vaultItemIds: string[]
}

export interface RetrievalPlan {
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

export interface CommittedRetrieval {
  plan: RetrievalPlan
  transaction: {
    backupPath: string
    rollbackPath: string
    sourceSha256: string
    committedSha256: string
  }
}

export async function executeIngestCommand(
  dependencies: OfflineTransactionsDependencies,
  command: IngestCommand
): Promise<IngestResult> {
  const { helper, database, paths, clock } = dependencies
  const operationId = clock.operationId()
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
      vaultItemId: clock.operationId(),
      baseRecord: item.baseRecord,
      payload: item
    }))
    database.prepareIngestOperation({
      operationId,
      stashPath: plan.path,
      sourceSha256: plan.sourceSha256,
      startedAtUtc: clock.nowUtc(),
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
      backupDirectory: paths.backups
    })
    if (
      committed.transaction.sourceSha256.toLowerCase() !== plan.sourceSha256.toLowerCase() ||
      committed.transaction.committedSha256.toLowerCase() !== plan.replacementSha256.toLowerCase()
    ) {
      throw new Error('Committed ingest hashes do not match the persisted plan.')
    }

    const completedAtUtc = clock.nowUtc()
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

export async function executeRetrievalCommand(
  dependencies: OfflineTransactionsDependencies,
  command: RetrievalCommand
): Promise<RetrievalResult> {
  const { helper, database, paths, clock } = dependencies
  const operationId = clock.operationId()
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
      startedAtUtc: clock.nowUtc(),
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
      backupDirectory: paths.backups
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

    const completedAtUtc = clock.nowUtc()
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

export async function planRetrievalCommand(
  dependencies: OfflineTransactionsDependencies,
  command: Omit<RetrievalCommand, 'expectedSourceSha256'>
): Promise<{ status: 'planned'; vaultItemIds: string[] } & RetrievalPlan> {
  const { helper, database } = dependencies
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

  return {
      status: 'planned',
      vaultItemIds: command.vaultItemIds,
      ...plan
  }
}
