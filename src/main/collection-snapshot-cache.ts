import { readFile, rename, writeFile } from 'node:fs/promises'
import type { CollectionSnapshot } from '../shared/contracts.ts'

export const COLLECTION_SNAPSHOT_CACHE_VERSION = 1

interface CollectionSnapshotCacheEnvelope {
  version: typeof COLLECTION_SNAPSHOT_CACHE_VERSION
  savedAtUtc: string
  snapshot: CollectionSnapshot
}

function isSnapshot(value: unknown, catalogPresentationVersion: number): value is CollectionSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<CollectionSnapshot>
  return snapshot.catalogPresentationVersion === catalogPresentationVersion &&
    Array.isArray(snapshot.items) &&
    Array.isArray(snapshot.plannerItems) &&
    Array.isArray(snapshot.supplies) &&
    Array.isArray(snapshot.materials) &&
    Array.isArray(snapshot.accountStores) &&
    Array.isArray(snapshot.observedItems) &&
    Array.isArray(snapshot.scannedStashes)
}

export async function readCollectionSnapshotCache(
  path: string,
  catalogPresentationVersion: number
): Promise<CollectionSnapshot | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (parsed && typeof parsed === 'object' && 'version' in parsed && 'snapshot' in parsed) {
      const envelope = parsed as Partial<CollectionSnapshotCacheEnvelope>
      if (envelope.version !== COLLECTION_SNAPSHOT_CACHE_VERSION) return null
      return isSnapshot(envelope.snapshot, catalogPresentationVersion) ? envelope.snapshot : null
    }

    // Version 0 stored the snapshot directly. Read it once so existing users do
    // not lose their offline collection; the next successful write upgrades it.
    return isSnapshot(parsed, catalogPresentationVersion) ? parsed : null
  } catch {
    return null
  }
}

export async function writeCollectionSnapshotCache(
  path: string,
  snapshot: CollectionSnapshot,
  nowUtc = new Date().toISOString()
): Promise<void> {
  const envelope: CollectionSnapshotCacheEnvelope = {
    version: COLLECTION_SNAPSHOT_CACHE_VERSION,
    savedAtUtc: nowUtc,
    snapshot
  }
  const temporaryPath = path + '.tmp'
  await writeFile(temporaryPath, JSON.stringify(envelope), 'utf8')
  await rename(temporaryPath, path)
}
