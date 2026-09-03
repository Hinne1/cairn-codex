import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  COLLECTION_SNAPSHOT_CACHE_VERSION,
  readCollectionSnapshotCache,
  writeCollectionSnapshotCache
} from '../src/main/collection-snapshot-cache.ts'

const presentationVersion = 32
const snapshot = {
  catalogPresentationVersion: presentationVersion,
  scannedAtUtc: '2026-09-03T12:00:00.000Z',
  discovery: { installations: [], saveLocations: [] },
  contentPacks: [], warnings: [], rarities: [], affixes: [],
  recipeSummary: { total: 0, collected: 0, unlockedItems: 0 },
  affixSummary: { total: 0, collected: 0, availableCopies: 0 },
  items: [], plannerItems: [], supplies: [], materials: [], accountStores: [],
  observedItems: [], scannedStashes: []
}
const directory = await mkdtemp(join(tmpdir(), 'cairn-collection-cache-'))
const path = join(directory, 'collection-snapshot.json')

try {
  await writeCollectionSnapshotCache(path, snapshot, '2026-09-03T12:01:00.000Z')
  assert.deepEqual(await readCollectionSnapshotCache(path), snapshot)
  const envelope = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(envelope.version, COLLECTION_SNAPSHOT_CACHE_VERSION)
  assert.equal(envelope.savedAtUtc, '2026-09-03T12:01:00.000Z')
  assert.equal(envelope.snapshotSha256, createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'))

  await writeFile(path, JSON.stringify(snapshot), 'utf8')
  assert.deepEqual(
    await readCollectionSnapshotCache(path),
    snapshot,
    'legacy unversioned snapshots must survive the cache-format upgrade'
  )

  const olderPresentation = { ...snapshot, catalogPresentationVersion: presentationVersion - 1 }
  await writeCollectionSnapshotCache(path, olderPresentation)
  assert.deepEqual(
    await readCollectionSnapshotCache(path),
    olderPresentation,
    'presentation upgrades must retain the old snapshot for knowledge reconciliation'
  )

  await writeFile(path, JSON.stringify({ version: 99, snapshot }), 'utf8')
  assert.equal(await readCollectionSnapshotCache(path), null)

  const malformed = { ...snapshot, discovery: null }
  await writeFile(path, JSON.stringify({
    version: COLLECTION_SNAPSHOT_CACHE_VERSION,
    savedAtUtc: '2026-09-03T12:01:00.000Z',
    snapshotSha256: createHash('sha256').update(JSON.stringify(malformed)).digest('hex'),
    snapshot: malformed
  }), 'utf8')
  assert.equal(await readCollectionSnapshotCache(path), null)

  await writeFile(path, '{corrupted', 'utf8')
  assert.equal(await readCollectionSnapshotCache(path), null)
} finally {
  await rm(directory, { recursive: true, force: true })
}

console.log('Versioned collection snapshot cache checks passed.')
