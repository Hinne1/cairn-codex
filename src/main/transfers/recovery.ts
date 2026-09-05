import { reconcileLiveIncomingOperations, type LiveIncomingDependencies } from './live-incoming.ts'
import { reconcileLiveRecoveryOperations, type RetainedReceiptsDependencies } from './retained-receipts.ts'

type RecoveryDependencies = LiveIncomingDependencies & RetainedReceiptsDependencies & {
  committed(): void
}

/** Caller holds the shared coordinator. Publish once for every pass that resolves durable state. */
export async function reconcileTransferOperations(dependencies: RecoveryDependencies): Promise<number> {
  const pending = dependencies.database.listRecoveryOperations().map(operation => operation.id)
  try {
    const resolved = await reconcileLiveRecoveryOperations(dependencies)
    return resolved + await reconcileLiveIncomingOperations(dependencies)
  } finally {
    const remaining = new Set(dependencies.database.listRecoveryOperations().map(operation => operation.id))
    if (pending.some(id => !remaining.has(id))) dependencies.committed()
  }
}
