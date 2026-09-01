import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GDIA_BACKUP_RETENTION,
  inspectGdiaBackup,
  prepareGdiaBackup
} from '../src/main/gdia-backup.ts'
import {
  readLastGdiaImportResult,
  writeLastGdiaImportResult
} from '../src/main/gdia-import-receipt.ts'

const root = await mkdtemp(join(tmpdir(), 'cairn-gdia-backup-'))
const sourcePath = join(root, 'userdata.db')
const backupDirectory = join(root, 'backups')
let clock = Date.parse('2026-09-01T00:00:00.000Z')
const now = () => new Date(clock += 1_000)

try {
  await writeFile(sourcePath, Buffer.alloc(16 * 1024, 0x41))
  const sourceSha256 = await sha256(sourcePath)
  const initialInspection = await inspectGdiaBackup(sourcePath, backupDirectory, {
    availableBytes: async () => 64n * 1024n
  })
  assert(!initialInspection.backupReused, 'Preflight claimed a backup existed before any copy was created.')
  assert(initialInspection.requiredFreeBytes === 16 * 1024, 'Preflight reported the wrong required free space.')
  assert(!(await exists(backupDirectory)), 'Read-only backup preflight created the destination directory.')
  const first = await prepareGdiaBackup(sourcePath, backupDirectory, { now })
  assert(!first.reused, 'The first backup must create a recovery copy.')
  assert(first.sourceSha256 === sourceSha256, 'The source hash was not recorded before backup.')
  assert(await sha256(first.backupPath) === sourceSha256, 'The first backup failed content verification.')

  const repeated = await prepareGdiaBackup(sourcePath, backupDirectory, { now })
  assert(repeated.reused, 'An unchanged import did not reuse its verified backup.')
  assert(repeated.backupPath === first.backupPath, 'An unchanged import selected a different backup.')
  assert((await backupNames(backupDirectory)).length === 1, 'An unchanged import retained another full backup.')
  const repeatInspection = await inspectGdiaBackup(sourcePath, backupDirectory)
  assert(repeatInspection.backupReused, 'Preflight did not recognize the verified unchanged backup.')
  assert(repeatInspection.requiredFreeBytes === 0, 'Preflight required another full copy for an unchanged source.')

  await writeFile(sourcePath, Buffer.alloc(16 * 1024, 0x42))
  let stalePreflightRejected = false
  try {
    await prepareGdiaBackup(sourcePath, backupDirectory, { now, expectedSourceSha256: sourceSha256 })
  } catch (error) {
    stalePreflightRejected = String(error).includes('changed after preflight')
  }
  assert(stalePreflightRejected, 'A source changed after preflight was not rejected before backup mutation.')
  assert((await backupNames(backupDirectory)).length === 1, 'Stale preflight rejection changed retained backups.')
  await writeFile(sourcePath, Buffer.alloc(16 * 1024, 0x41))

  await writeFile(first.backupPath, 'corrupted backup')
  const recovered = await prepareGdiaBackup(sourcePath, backupDirectory, { now })
  assert(!recovered.reused, 'A corrupted backup was incorrectly reused.')
  assert(recovered.backupPath !== first.backupPath, 'A corrupted backup was not replaced safely.')
  assert(await sha256(recovered.backupPath) === sourceSha256, 'Recovery from a corrupted backup was not exact.')
  assert((await backupNames(backupDirectory)).length === 1, 'The corrupted backup was retained after replacement.')

  let latestSha256 = sourceSha256
  for (let revision = 1; revision <= GDIA_BACKUP_RETENTION + 1; revision += 1) {
    await writeFile(sourcePath, Buffer.alloc(16 * 1024, 0x41 + revision))
    latestSha256 = await sha256(sourcePath)
    await prepareGdiaBackup(sourcePath, backupDirectory, { now })
  }
  const retained = await backupNames(backupDirectory)
  assert(retained.length === GDIA_BACKUP_RETENTION, 'The bounded retention policy kept the wrong number of backups.')
  const retainedHashes = await Promise.all(retained.map((name) => sha256(join(backupDirectory, name))))
  assert(retainedHashes.includes(latestSha256), 'Retention removed the latest verified recovery point.')
  for (const name of retained) {
    const manifest = JSON.parse(await readFile(join(backupDirectory, `${name}.json`), 'utf8'))
    assert(manifest.sourceSha256 === await sha256(join(backupDirectory, name)), `Manifest mismatch for ${name}.`)
  }

  await writeFile(sourcePath, Buffer.alloc(32 * 1024, 0x5a))
  const lowSpaceSourceHash = await sha256(sourcePath)
  const beforeLowSpace = await backupNames(backupDirectory)
  let lowSpaceRejected = false
  try {
    await prepareGdiaBackup(sourcePath, backupDirectory, {
      now,
      availableBytes: async () => BigInt((await stat(sourcePath)).size - 1)
    })
  } catch (error) {
    lowSpaceRejected = String(error).includes('Not enough free space')
  }
  assert(lowSpaceRejected, 'Insufficient backup space was not rejected before copying.')
  assert(JSON.stringify(await backupNames(backupDirectory)) === JSON.stringify(beforeLowSpace), 'Low-space rejection changed retained backups.')
  assert(await sha256(sourcePath) === lowSpaceSourceHash, 'Low-space rejection changed the source database.')

  const legacyDirectory = join(root, 'legacy-backups')
  const legacyHash = await sha256(sourcePath)
  const legacyPath = join(legacyDirectory, `userdata.db.20260901T000000000Z.${legacyHash.slice(0, 12)}.bak`)
  await mkdir(legacyDirectory, { recursive: true })
  await writeFile(legacyPath, await readFile(sourcePath))
  const adopted = await prepareGdiaBackup(sourcePath, legacyDirectory, { now })
  assert(adopted.reused && adopted.backupPath === legacyPath, 'A verified legacy backup was not adopted by content hash.')
  await stat(`${legacyPath}.json`)
  const unmanagedPath = join(legacyDirectory, 'manual-recovery.bak')
  const legacyLookingUnmanagedPath = join(legacyDirectory, 'manual-recovery.aaaaaaaaaaaa.bak')
  await writeFile(unmanagedPath, 'unmanaged backup')
  await writeFile(legacyLookingUnmanagedPath, 'unmanaged backup with a hash-like suffix')
  await prepareGdiaBackup(sourcePath, legacyDirectory, { now })
  await stat(unmanagedPath)
  await stat(legacyLookingUnmanagedPath)

  const orphanDirectory = join(root, 'orphan-backups')
  await mkdir(orphanDirectory, { recursive: true })
  const orphanName = `userdata.db.2026-09-01T00-00-00Z.${legacyHash.slice(0, 16)}-deadbeef.bak`
  const orphanPath = join(orphanDirectory, orphanName)
  const staleTemporaryPath = `${orphanPath}.tmp`
  const unmanagedTemporaryPath = join(orphanDirectory, 'manual-recovery.bak.tmp')
  await writeFile(orphanPath, await readFile(sourcePath))
  await writeFile(staleTemporaryPath, 'partial managed copy')
  await writeFile(unmanagedTemporaryPath, 'unmanaged temporary copy')
  const reconciled = await prepareGdiaBackup(sourcePath, orphanDirectory, { now })
  assert(reconciled.reused && reconciled.backupPath === orphanPath, 'A verified publication orphan was not reconciled.')
  await stat(`${orphanPath}.json`)
  assert(!(await exists(staleTemporaryPath)), 'A stale managed temporary copy was not removed.')
  await stat(unmanagedTemporaryPath)

  const distinctDirectory = join(root, 'distinct-backups')
  await mkdir(distinctDirectory, { recursive: true })
  const historical = [
    { byte: 0x61, stamp: '20260901T000001000Z' },
    { byte: 0x62, stamp: '20260901T000002000Z' },
    { byte: 0x63, stamp: '20260901T000003000Z' },
    { byte: 0x63, stamp: '20260901T000004000Z' },
    { byte: 0x63, stamp: '20260901T000005000Z' }
  ]
  for (const [index, revision] of historical.entries()) {
    const bytes = Buffer.alloc(8 * 1024, revision.byte)
    const hash = sha256Bytes(bytes)
    const path = join(distinctDirectory, `userdata.db.${revision.stamp}.${hash.slice(0, 12)}.bak`)
    await writeFile(path, bytes)
    const modified = new Date(Date.parse('2026-09-01T00:00:01.000Z') + index * 1_000)
    await utimes(path, modified, modified)
  }
  const currentBytes = Buffer.alloc(8 * 1024, 0x64)
  await writeFile(sourcePath, currentBytes)
  const currentHash = sha256Bytes(currentBytes)
  await prepareGdiaBackup(sourcePath, distinctDirectory, { now })
  const distinctNames = await backupNames(distinctDirectory)
  const distinctHashes = await Promise.all(distinctNames.map((name) => sha256(join(distinctDirectory, name))))
  assert(distinctNames.length === GDIA_BACKUP_RETENTION, 'Retention did not keep the configured number of recovery points.')
  assert(new Set(distinctHashes).size === GDIA_BACKUP_RETENTION, 'Retention kept duplicate content instead of distinct revisions.')
  assert(distinctHashes.includes(currentHash), 'Distinct retention removed the current recovery point.')
  assert(distinctHashes.includes(sha256Bytes(Buffer.alloc(8 * 1024, 0x63))), 'Distinct retention removed the newest historical revision.')
  assert(distinctHashes.includes(sha256Bytes(Buffer.alloc(8 * 1024, 0x62))), 'Distinct retention did not backfill with an older unique revision.')

  const completedAtUtc = '2026-09-01T00:10:00.000Z'
  await writeLastGdiaImportResult(backupDirectory, {
    canceled: false,
    sourcePath,
    sourceItems: 4,
    sourceDatabaseItems: 3,
    sourceQueueItems: 1,
    sourceHardcoreItems: 2,
    sourceSoftcoreItems: 2,
    importedItems: 3,
    duplicateItems: 0,
    unsupportedItems: 1,
    backupPath: recovered.backupPath,
    backupReused: false,
    receiptPersisted: true,
    completedAtUtc,
    durationMs: 1250
  })
  const durableResult = await readLastGdiaImportResult(backupDirectory)
  assert(durableResult?.completedAtUtc === completedAtUtc, 'The durable import result was not restored exactly.')

  console.log(JSON.stringify({
    passed: true,
    unchangedBackupReused: true,
    preflightReadOnly: true,
    stalePreflightRejected: true,
    corruptedBackupRejected: true,
    retainedBackups: retained.length,
    retention: GDIA_BACKUP_RETENTION,
    latestRecoveryPointRetained: true,
    lowSpaceRejectedBeforeCopy: true,
    legacyBackupAdopted: true,
    unmanagedBackupPreserved: true,
    publicationOrphanReconciled: true,
    managedTemporaryRemoved: true,
    distinctHashRetention: true,
    durableImportResult: true
  }, null, 2))
} finally {
  await rm(root, { recursive: true, force: true })
}

async function backupNames(directory) {
  return (await readdir(directory)).filter((name) => name.endsWith('.bak')).sort()
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
