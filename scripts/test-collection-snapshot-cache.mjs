import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
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

  const malformedItems = { ...snapshot, items: [null] }
  await writeFile(path, JSON.stringify({
    version: COLLECTION_SNAPSHOT_CACHE_VERSION,
    savedAtUtc: '2026-09-03T12:01:00.000Z',
    snapshotSha256: createHash('sha256').update(JSON.stringify(malformedItems)).digest('hex'),
    snapshot: malformedItems
  }), 'utf8')
  assert.equal(await readCollectionSnapshotCache(path), null)

  const malformedPresentation = {
    ...snapshot,
    items: [{
      record: 'records/item.dbr', name: 'Broken', rarity: 'legendary', itemClass: 'Armor',
      slot: 'chest', availableCount: 1, presentation: {}
    }]
  }
  await writeFile(path, JSON.stringify({
    version: COLLECTION_SNAPSHOT_CACHE_VERSION,
    savedAtUtc: '2026-09-03T12:01:00.000Z',
    snapshotSha256: createHash('sha256').update(JSON.stringify(malformedPresentation)).digest('hex'),
    snapshot: malformedPresentation
  }), 'utf8')
  assert.equal(await readCollectionSnapshotCache(path), null)

  await writeFile(path, '{corrupted', 'utf8')
  assert.equal(await readCollectionSnapshotCache(path), null)

  const rawScannerSnapshot = { ...snapshot }
  delete rawScannerSnapshot.recipeSummary
  await writeFile(path, JSON.stringify({
    version: COLLECTION_SNAPSHOT_CACHE_VERSION,
    savedAtUtc: '2026-09-03T12:02:00.000Z',
    snapshotSha256: createHash('sha256').update(JSON.stringify(rawScannerSnapshot)).digest('hex'),
    snapshot: rawScannerSnapshot
  }), 'utf8')
  assert.deepEqual(
    (await readCollectionSnapshotCache(path))?.recipeSummary,
    { total: 0, collected: 0, unlockedItems: 0 },
    'already-persisted raw scanner snapshots must gain safe derived recipe totals'
  )

  await writeCollectionSnapshotCache(path, rawScannerSnapshot, '2026-09-03T12:02:00.000Z')
  assert.deepEqual(
    (await readCollectionSnapshotCache(path))?.recipeSummary,
    { total: 0, collected: 0, unlockedItems: 0 },
    'raw scanner snapshots must gain safe derived recipe totals'
  )

  const replacement = { ...snapshot, scannedAtUtc: '2026-09-03T12:03:00.000Z' }
  await writeCollectionSnapshotCache(path, replacement)
  assert.deepEqual(await readCollectionSnapshotCache(path), replacement)

  let attempts = 0
  const retryReplacement = { ...snapshot, scannedAtUtc: '2026-09-03T12:04:00.000Z' }
  await writeCollectionSnapshotCache(path, retryReplacement, undefined, {
    retryDelaysMs: [0, 0],
    wait: async () => undefined,
    renameFile: async (source, destination) => {
      attempts += 1
      if (attempts < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' })
      await rename(source, destination)
    }
  })
  assert.equal(attempts, 3)
  assert.deepEqual(await readCollectionSnapshotCache(path), retryReplacement)

  const preserved = await readFile(path, 'utf8')
  await assert.rejects(
    writeCollectionSnapshotCache(path, snapshot, undefined, {
      retryDelaysMs: [0],
      wait: async () => undefined,
      renameFile: async () => { throw Object.assign(new Error('locked'), { code: 'EPERM' }) }
    }),
    (error) => error?.code === 'EPERM'
  )
  assert.equal(await readFile(path, 'utf8'), preserved, 'failed replacement must preserve the final cache')
  assert.deepEqual(
    (await readdir(directory)).filter((name) => name.endsWith('.tmp')),
    [],
    'failed replacement must clean up its unique temporary file'
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}

console.log('Versioned collection snapshot cache checks passed.')
