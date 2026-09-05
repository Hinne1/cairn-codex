import type { LiveVaultPayload } from '../collection-presentation.ts';

export interface LiveIncomingItem {
  path: string
  sha256: string
  isHardcore: boolean
  item: LiveVaultPayload
  createdAtUtc: string
}

export interface LiveQueueReceipt {
  sha256: string
  receiptPath: string
}

export interface LiveRetrievalQueue {
  operationId: string
  outgoingPath: string
  semanticSha256: string
  isHardcore: boolean
  baselineDeleted: string[]
  baselineIncoming: string[]
}

export interface LiveRetrievalStatus {
  state: 'pending' | 'deposited' | 'rejected' | 'unknown'
  receiptPath: string | null
}
