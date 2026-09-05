import { resolve } from 'node:path'

interface QueuePayloadIdentity { semanticSha256: string; isHardcore: boolean }

/** Renamed receipts can only identify a payload that is unique among retained queues. */
export function hasUniqueLivePayload(queue: QueuePayloadIdentity, batch: readonly QueuePayloadIdentity[]): boolean {
  return batch.filter(candidate => candidate.isHardcore === queue.isHardcore &&
    candidate.semanticSha256.toLowerCase() === queue.semanticSha256.toLowerCase()).length === 1
}

export function liveReceiptPathKey(receiptPath: string): string {
  const path = resolve(receiptPath)
  return process.platform === 'win32' ? path.toLowerCase() : path
}

export function haveDistinctLiveReceipts(entries: readonly { receiptPath: string }[]): boolean {
  const paths = entries.map(entry => liveReceiptPathKey(entry.receiptPath))
  return new Set(paths).size === paths.length
}
