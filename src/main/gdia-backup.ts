import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const MANIFEST_VERSION = 1
export const GDIA_BACKUP_RETENTION = 3

interface GdiaBackupManifest {
  manifestVersion: number
  fileName: string
  sourceSha256: string
  sourceBytes: number
  createdAtUtc: string
}

interface BackupEntry {
  backupPath: string
  manifestPath: string
  manifest: GdiaBackupManifest | null
  valid: boolean
}

export interface GdiaBackupResult {
  backupPath: string
  manifestPath: string
  sourceSha256: string
  sourceBytes: number
  reused: boolean
}

export interface GdiaBackupOptions {
  retention?: number
  now?: () => Date
  availableBytes?: (directory: string) => Promise<bigint>
  expectedSourceSha256?: string
}

export interface GdiaBackupInspection {
  sourceSha256: string
  sourceBytes: number
  backupReused: boolean
  requiredFreeBytes: number
  availableFreeBytes: number
}

export async function inspectGdiaBackup(
  sourcePath: string,
  backupDirectory: string,
  options: Pick<GdiaBackupOptions, 'availableBytes'> = {}
): Promise<GdiaBackupInspection> {
  const source = await inspectStableSource(sourcePath)
  const existing = await loadBackupEntries(backupDirectory, basename(sourcePath), false)
  const backupReused = existing.some(
    (entry) => entry.valid && entry.manifest?.sourceSha256 === source.sourceSha256
  )
  const availabilityDirectory = await nearestExistingDirectory(backupDirectory)
  const available = await (options.availableBytes ?? diskAvailableBytes)(availabilityDirectory)
  return {
    ...source,
    backupReused,
    requiredFreeBytes: backupReused ? 0 : source.sourceBytes,
    availableFreeBytes: safeByteNumber(available)
  }
}

export async function prepareGdiaBackup(
  sourcePath: string,
  backupDirectory: string,
  options: GdiaBackupOptions = {}
): Promise<GdiaBackupResult> {
  const now = options.now ?? (() => new Date())
  const retention = Math.max(1, Math.floor(options.retention ?? GDIA_BACKUP_RETENTION))
  const source = await inspectStableSource(sourcePath)
  const { sourceBytes, sourceSha256 } = source
  if (options.expectedSourceSha256 && options.expectedSourceSha256 !== sourceSha256) {
    throw new Error('The Item Assistant database changed after preflight; analyze it again before importing.')
  }
  await mkdir(backupDirectory, { recursive: true })

  const existing = await loadBackupEntries(backupDirectory, basename(sourcePath))
  const reusable = existing
    .filter((entry) => entry.valid && entry.manifest?.sourceSha256 === sourceSha256)
    .sort((left, right) => manifestTime(right) - manifestTime(left))[0]
  if (reusable?.manifest) {
    if ((await hashFile(sourcePath)) !== sourceSha256) {
      throw new Error('The GDIA database changed while its existing backup was being verified; import was aborted.')
    }
    await pruneBackups(existing, reusable.backupPath, retention)
    return {
      backupPath: reusable.backupPath,
      manifestPath: reusable.manifestPath,
      sourceSha256,
      sourceBytes,
      reused: true
    }
  }

  const availableBytes = await (options.availableBytes ?? diskAvailableBytes)(backupDirectory)
  if (availableBytes < BigInt(sourceBytes)) {
    throw new Error(
      `Not enough free space to back up the GDIA database before import: ` +
      `${formatBytes(sourceBytes)} required, ${formatBytes(availableBytes)} available.`
    )
  }

  const stamp = safeStamp(now())
  const identity = `${sourceSha256.slice(0, 16)}-${randomUUID().slice(0, 8)}`
  const fileName = `${basename(sourcePath)}.${stamp}.${identity}.bak`
  const backupPath = join(backupDirectory, fileName)
  const temporaryPath = `${backupPath}.tmp`
  const manifestPath = `${backupPath}.json`
  let manifestPublished = false
  try {
    await copyFile(sourcePath, temporaryPath)
    const backupSha256 = await hashFile(temporaryPath)
    const backupMetadata = await stat(temporaryPath)
    const sourceSha256AfterCopy = await hashFile(sourcePath)
    if (
      backupMetadata.size !== sourceBytes ||
      backupSha256 !== sourceSha256 ||
      sourceSha256AfterCopy !== sourceSha256
    ) {
      throw new Error('The GDIA database changed during backup; migration was aborted before import.')
    }
    await rename(temporaryPath, backupPath)
    const manifest: GdiaBackupManifest = {
      manifestVersion: MANIFEST_VERSION,
      fileName,
      sourceSha256,
      sourceBytes: backupMetadata.size,
      createdAtUtc: now().toISOString()
    }
    await writeManifest(manifestPath, manifest)
    manifestPublished = true
    const current: BackupEntry = { backupPath, manifestPath, manifest, valid: true }
    await pruneBackups([...existing, current], backupPath, retention)
    return { backupPath, manifestPath, sourceSha256, sourceBytes, reused: false }
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    if (!manifestPublished) {
      await rm(backupPath, { force: true }).catch(() => undefined)
      await rm(manifestPath, { force: true }).catch(() => undefined)
    }
    throw error
  }
}

async function loadBackupEntries(
  backupDirectory: string,
  sourceFileName: string,
  reconcile = true
): Promise<BackupEntry[]> {
  let directoryNames: string[]
  try {
    directoryNames = await readdir(backupDirectory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  if (reconcile) {
    await Promise.all(directoryNames
      .filter((name) => isManagedTemporaryName(name, sourceFileName))
      .map((name) => rm(join(backupDirectory, name), { force: true }).catch(() => undefined)))
  }
  const names = directoryNames
    .filter((name) => name.toLocaleLowerCase().endsWith('.bak'))
    .sort()
  const entries = await Promise.all(names.map(async (fileName): Promise<BackupEntry | null> => {
    const expectedHashPrefix = managedHashPrefix(fileName, sourceFileName)
    if (!expectedHashPrefix) return null
    const backupPath = join(backupDirectory, fileName)
    const manifestPath = `${backupPath}.json`
    const manifest = await readManifest(manifestPath)
    if (manifest) {
      const metadata = await stat(backupPath)
      const valid = manifest.fileName === fileName &&
        manifest.sourceBytes === metadata.size &&
        manifest.sourceSha256 === await hashFile(backupPath)
      return { backupPath, manifestPath, manifest, valid }
    }
    if (await fileExists(manifestPath)) {
      return { backupPath, manifestPath, manifest: null, valid: false }
    }

    // Reconcile backups published before their manifest, including legacy files.
    // Only exact Cairn filename formats are managed; every other .bak is left alone.
    const metadata = await stat(backupPath)
    const sourceSha256 = await hashFile(backupPath)
    if (!sourceSha256.startsWith(expectedHashPrefix)) {
      return { backupPath, manifestPath, manifest: null, valid: false }
    }
    const adopted: GdiaBackupManifest = {
      manifestVersion: MANIFEST_VERSION,
      fileName,
      sourceSha256,
      sourceBytes: metadata.size,
      createdAtUtc: metadata.mtime.toISOString()
    }
    if (reconcile) await writeManifest(manifestPath, adopted)
    return { backupPath, manifestPath, manifest: adopted, valid: true }
  }))
  return entries.filter((entry): entry is BackupEntry => entry !== null)
}

async function pruneBackups(
  entries: BackupEntry[],
  currentBackupPath: string,
  retention: number
): Promise<void> {
  const current = entries.find((entry) => entry.backupPath === currentBackupPath && entry.valid)
  if (!current) throw new Error('The current GDIA recovery backup was not verified; retention was not applied.')
  const validNewestFirst = entries
    .filter((entry) => entry.valid && entry.backupPath !== currentBackupPath)
    .sort((left, right) => manifestTime(right) - manifestTime(left))
  const keep = new Set([currentBackupPath])
  const retainedHashes = new Set([current.manifest!.sourceSha256])
  for (const entry of validNewestFirst) {
    const sourceSha256 = entry.manifest!.sourceSha256
    if (retainedHashes.has(sourceSha256)) continue
    retainedHashes.add(sourceSha256)
    if (keep.size < retention) keep.add(entry.backupPath)
  }
  await Promise.all(entries
    .filter((entry) => !keep.has(entry.backupPath))
    .flatMap((entry) => [
      rm(entry.backupPath, { force: true }),
      rm(entry.manifestPath, { force: true })
    ]))
}

async function readManifest(path: string): Promise<GdiaBackupManifest | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as GdiaBackupManifest
    if (
      parsed.manifestVersion !== MANIFEST_VERSION ||
      basename(parsed.fileName) !== parsed.fileName ||
      !/^[0-9a-f]{64}$/.test(parsed.sourceSha256) ||
      !Number.isSafeInteger(parsed.sourceBytes) ||
      parsed.sourceBytes < 0 ||
      !Number.isFinite(Date.parse(parsed.createdAtUtc))
    ) return null
    return parsed
  } catch {
    return null
  }
}

async function writeManifest(path: string, manifest: GdiaBackupManifest): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function diskAvailableBytes(directory: string): Promise<bigint> {
  const information = await statfs(directory, { bigint: true })
  return information.bavail * information.bsize
}

async function inspectStableSource(path: string): Promise<{ sourceSha256: string; sourceBytes: number }> {
  const metadataBeforeHash = await stat(path)
  const sourceSha256 = await hashFile(path)
  const metadataAfterHash = await stat(path)
  if (metadataBeforeHash.size !== metadataAfterHash.size) {
    throw new Error('The GDIA database changed while it was being hashed; import was aborted.')
  }
  return { sourceSha256, sourceBytes: metadataAfterHash.size }
}

async function nearestExistingDirectory(path: string): Promise<string> {
  let candidate = path
  while (!(await fileExists(candidate))) {
    const parent = dirname(candidate)
    if (parent === candidate) throw new Error(`No existing parent directory found for ${path}.`)
    candidate = parent
  }
  return candidate
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function manifestTime(entry: BackupEntry): number {
  return Date.parse(entry.manifest?.createdAtUtc ?? '') || 0
}

function safeStamp(value: Date): string {
  return value.toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z')
}

function managedHashPrefix(fileName: string, sourceFileName: string): string | null {
  const source = escapeRegExp(sourceFileName)
  const legacy = fileName.match(new RegExp(
    `^${source}\\.\\d{8}T\\d{9}Z\\.([0-9a-f]{12})\\.bak$`,
    'i'
  ))
  if (legacy?.[1]) return legacy[1].toLocaleLowerCase()
  return fileName.match(new RegExp(
    `^${source}\\.\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}Z\\.([0-9a-f]{16})-[0-9a-f]{8}\\.bak$`,
    'i'
  ))?.[1]?.toLocaleLowerCase() ?? null
}

function isManagedTemporaryName(fileName: string, sourceFileName: string): boolean {
  const source = escapeRegExp(sourceFileName)
  const current = `${source}\\.\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}Z\\.` +
    `[0-9a-f]{16}-[0-9a-f]{8}\\.bak`
  return new RegExp(`^${current}\\.tmp$`, 'i').test(fileName) ||
    new RegExp(`^${current}\\.json\\.[0-9a-f-]{36}\\.tmp$`, 'i').test(fileName)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatBytes(value: number | bigint): string {
  const bytes = typeof value === 'bigint' ? value : BigInt(value)
  const mebibyte = 1024n * 1024n
  if (bytes >= mebibyte) return `${Number(bytes / (mebibyte / 10n)) / 10} MiB`
  if (bytes >= 1024n) return `${Number(bytes / 1024n)} KiB`
  return `${bytes} bytes`
}

function safeByteNumber(value: bigint): number {
  return Number(value > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : value)
}
