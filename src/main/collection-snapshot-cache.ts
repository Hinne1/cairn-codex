import { readFile, rename, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { CollectionSnapshot } from '../shared/contracts.ts'

export const COLLECTION_SNAPSHOT_CACHE_VERSION = 1

interface CollectionSnapshotCacheEnvelope {
  version: typeof COLLECTION_SNAPSHOT_CACHE_VERSION
  savedAtUtc: string
  snapshotSha256: string
  snapshot: CollectionSnapshot
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isSnapshot(value: unknown): value is CollectionSnapshot {
  if (!isRecord(value)) return false
  const snapshot = value as Partial<CollectionSnapshot>
  if (!isRecord(snapshot.discovery)) return false
  const discovery = snapshot.discovery
  if (!Array.isArray(discovery.installations) || !Array.isArray(discovery.saveLocations)) return false
  if (!discovery.installations.every((installation) =>
    isRecord(installation) && typeof installation.path === 'string' &&
    typeof installation.source === 'string' && typeof installation.databasePath === 'string'
  )) return false
  if (!discovery.saveLocations.every((location) =>
    isRecord(location) && typeof location.path === 'string' &&
    typeof location.source === 'string' && Array.isArray(location.transferStashes)
  )) return false
  return typeof snapshot.catalogPresentationVersion === 'number' &&
    typeof snapshot.scannedAtUtc === 'string' &&
    Array.isArray(snapshot.contentPacks) &&
    Array.isArray(snapshot.items) &&
    Array.isArray(snapshot.plannerItems) &&
    Array.isArray(snapshot.supplies) &&
    Array.isArray(snapshot.materials) &&
    Array.isArray(snapshot.accountStores) &&
    Array.isArray(snapshot.observedItems) &&
    Array.isArray(snapshot.scannedStashes) &&
    Array.isArray(snapshot.warnings) &&
    Array.isArray(snapshot.rarities) &&
    isRecord(snapshot.recipeSummary) &&
    isRecord(snapshot.affixSummary) &&
    Array.isArray(snapshot.affixes)
}

function snapshotSha256(snapshot: CollectionSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

export async function readCollectionSnapshotCache(path: string): Promise<CollectionSnapshot | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (parsed && typeof parsed === 'object' && 'version' in parsed && 'snapshot' in parsed) {
      const envelope = parsed as Partial<CollectionSnapshotCacheEnvelope>
      if (envelope.version !== COLLECTION_SNAPSHOT_CACHE_VERSION) return null
      if (
        typeof envelope.savedAtUtc !== 'string' ||
        typeof envelope.snapshotSha256 !== 'string' ||
        !isSnapshot(envelope.snapshot) ||
        snapshotSha256(envelope.snapshot) !== envelope.snapshotSha256
      ) return null
      return envelope.snapshot
    }

    // Version 0 stored the snapshot directly. Read it once so existing users do
    // not lose their offline collection; the next successful write upgrades it.
    return isSnapshot(parsed) ? parsed : null
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
    snapshotSha256: snapshotSha256(snapshot),
    snapshot
  }
  const temporaryPath = path + '.tmp'
  await writeFile(temporaryPath, JSON.stringify(envelope), 'utf8')
  await rename(temporaryPath, path)
}
