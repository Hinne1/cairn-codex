import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GDIA_BACKUP_RETENTION,
  prepareGdiaBackup
} from '../src/main/gdia-backup.ts'

const root = await mkdtemp(join(tmpdir(), 'cairn-gdia-backup-'))
const sourcePath = join(root, 'userdata.db')
const backupDirectory = join(root, 'backups')
let clock = Date.parse('2026-09-01T00:00:00.000Z')
const now = () => new Date(clock += 1_000)

try {
  await writeFile(sourcePath, Buffer.alloc(16 * 1024, 0x41))
  const sourceSha256 = await sha256(sourcePath)
  const first = await prepareGdiaBackup(sourcePath, backupDirectory, { now })
  assert(!first.reused, 'The first backup must create a recovery copy.')
  assert(first.sourceSha256 === sourceSha256, 'The source hash was not recorded before backup.')
  assert(await sha256(first.backupPath) === sourceSha256, 'The first backup failed content verification.')

  const repeated = await prepareGdiaBackup(sourcePath, backupDirectory, { now })
  assert(repeated.reused, 'An unchanged import did not reuse its verified backup.')
  assert(repeated.backupPath === first.backupPath, 'An unchanged import selected a different backup.')
  assert((await backupNames(backupDirectory)).length === 1, 'An unchanged import retained another full backup.')

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
  await writeFile(unmanagedPath, 'unmanaged backup')
  await prepareGdiaBackup(sourcePath, legacyDirectory, { now })
  await stat(unmanagedPath)

  console.log(JSON.stringify({
    passed: true,
    unchangedBackupReused: true,
    corruptedBackupRejected: true,
    retainedBackups: retained.length,
    retention: GDIA_BACKUP_RETENTION,
    latestRecoveryPointRetained: true,
    lowSpaceRejectedBeforeCopy: true,
    legacyBackupAdopted: true,
    unmanagedBackupPreserved: true
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

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
