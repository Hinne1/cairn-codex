import { join } from 'node:path';
import type { CollectionDatabase } from '../collection-database.ts';
import type { TransferPorts } from './runtime.ts';
import type { LiveIncomingItem, LiveQueueReceipt } from './contracts.ts';
import type { LiveGameStatus, LiveGameSyncResult, ItemRollAnalysis } from '../../shared/contracts.ts';
import { createHash } from 'node:crypto';
import { createVaultInstanceKey, type LiveVaultPayload } from '../collection-presentation.ts';

export type LiveIncomingDependencies = TransferPorts & {
  database: Pick<CollectionDatabase, 'completeIngestOperation' | 'ensureQuarantineCatalogItem' | 'failIngestOperation' | 'getCatalogNames' | 'hasCommittedOperation' | 'prepareIngestOperation' | 'setVaultRollAnalyses'>
}

export async function syncLiveIncoming(
  dependencies: LiveIncomingDependencies,
  installationPath?: string
): Promise<LiveGameSyncResult> {
  const { helper, database, paths, clock } = dependencies
  const status = await helper.request<LiveGameStatus>('inspect-live-game')
  const incoming = await helper.request<LiveIncomingItem[]>('poll-live-incoming')
  if (status.state !== 'ready' && incoming.length === 0) {
    return { status, ingested: [], issues: [] }
  }
  const ingested: LiveGameSyncResult['ingested'] = []
  const analysisInputs: Array<{ vaultItemId: string; item: LiveVaultPayload }> = []
  const issues: string[] = []
  for (const source of incoming) {
    const catalogName = database.getCatalogNames([source.item.baseRecord]).get(
      source.item.baseRecord.toLowerCase()
    )
    const name = catalogName ?? database.ensureQuarantineCatalogItem(source.item.baseRecord)
    const identity = createHash('sha256')
      .update(source.path.toLowerCase())
      .update('\0')
      .update(source.sha256)
      .digest('hex')
    const operationId = `live-ingest-${identity}`
    const vaultItemId = `live-${identity}`
    if (database.hasCommittedOperation(operationId)) {
      try {
        await helper.request<LiveQueueReceipt>('ack-live-incoming', {
          path: source.path,
          expectedSha256: source.sha256,
          receiptDirectory: join(paths.receipts, 'ingested')
        })
      } catch (error) {
        issues.push(`${name}: committed earlier, but queue acknowledgement still failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      continue
    }
    let prepared = false
    let committed = false
    try {
      const receipt = await helper.request<LiveQueueReceipt>('copy-live-incoming', {
        path: source.path,
        expectedSha256: source.sha256,
        receiptDirectory: join(paths.receipts, 'ingested')
      })
      database.prepareIngestOperation({
        operationId,
        stashPath: `live://gdia/${source.isHardcore ? 'hc' : 'sc'}/${source.path.split(/[\\/]/).at(-1)}`,
        sourceSha256: source.sha256,
        startedAtUtc: clock.nowUtc(),
        items: [{ vaultItemId, baseRecord: source.item.baseRecord, payload: source.item }],
        detail: { phase: 'receipt_verified', adapter: 'gdia-live-v1', receiptPath: receipt.receiptPath }
      })
      prepared = true
      database.completeIngestOperation({
        operationId,
        backupPath: receipt.receiptPath,
        completedAtUtc: clock.nowUtc(),
        isHardcore: source.isHardcore,
        detail: { phase: 'committed', adapter: 'gdia-live-v1', receiptPath: receipt.receiptPath }
      })
      committed = true
      await helper.request<LiveQueueReceipt>('ack-live-incoming', {
        path: source.path,
        expectedSha256: source.sha256,
        receiptDirectory: join(paths.receipts, 'ingested')
      })
      ingested.push({
        vaultItemId,
        baseRecord: source.item.baseRecord,
        prefixRecord: source.item.prefixRecord,
        suffixRecord: source.item.suffixRecord,
        name,
        seed: source.item.seed,
        instanceKey: createVaultInstanceKey(source.item),
        rollAnalysis: null
      })
      analysisInputs.push({ vaultItemId, item: source.item })
      if (!catalogName) {
        issues.push(
          `${name} was safely stored outside the Epic/Legendary/MI collection. ` +
            'It is available in Vault quarantine for an immediate live return.'
        )
      }
    } catch (error) {
      if (prepared && !committed) database.failIngestOperation(operationId, error)
      issues.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (installationPath && analysisInputs.length > 0) {
    try {
      const analyzed = await helper.request<{ items: ItemRollAnalysis[] }>('analyze-item-rolls', {
        installationPath,
        items: analysisInputs.map(({ item }) => ({
          baseRecord: item.baseRecord,
          prefixRecord: item.prefixRecord,
          suffixRecord: item.suffixRecord,
          seed: item.seed
        }))
      })
      const updates = analysisInputs.flatMap(({ vaultItemId }, index) => {
        const rollAnalysis = analyzed.items[index]
        const result = ingested.find((item) => item.vaultItemId === vaultItemId)
        if (!rollAnalysis || !result) return []
        result.rollAnalysis = rollAnalysis
        return [{ id: vaultItemId, rollAnalysis }]
      })
      database.setVaultRollAnalyses(updates)
    } catch (error) {
      issues.push(`Roll analysis will retry in the background: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return {
    status: await helper.request<LiveGameStatus>('inspect-live-game'),
    ingested,
    issues
  }
}
