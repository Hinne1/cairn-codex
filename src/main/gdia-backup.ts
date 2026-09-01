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
import { basename, join } from 'node:path'

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
}

export async function prepareGdiaBackup(
  sourcePath: string,
  backupDirectory: string,
  options: GdiaBackupOptions = {}
): Promise<GdiaBackupResult> {
  const now = options.now ?? (() => new Date())
  const retention = Math.max(1, Math.floor(options.retention ?? GDIA_BACKUP_RETENTION))
  const sourceMetadata = await stat(sourcePath)
  const sourceBytes = sourceMetadata.size
  const sourceSha256 = await hashFile(sourcePath)
  await mkdir(backupDirectory, { recursive: true })

  const existing = await loadBackupEntries(backupDirectory)
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
    const sourceSha256AfterCopy = await hashFile(sourcePath)
    if (backupSha256 !== sourceSha256 || sourceSha256AfterCopy !== sourceSha256) {
      throw new Error('The GDIA database changed during backup; migration was aborted before import.')
    }
    await rename(temporaryPath, backupPath)
    const manifest: GdiaBackupManifest = {
      manifestVersion: MANIFEST_VERSION,
      fileName,
      sourceSha256,
      sourceBytes,
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

async function loadBackupEntries(backupDirectory: string): Promise<BackupEntry[]> {
  const names = (await readdir(backupDirectory))
    .filter((name) => name.toLocaleLowerCase().endsWith('.bak'))
    .sort()
  const entries = await Promise.all(names.map(async (fileName): Promise<BackupEntry | null> => {
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

    // Adopt backups created before manifests were introduced. Their content hash
    // becomes the recorded identity only when it still matches the hash prefix
    // embedded by the legacy Cairn filename. Unrecognized .bak files are left alone.
    const expectedHashPrefix = legacyHashPrefix(fileName)
    if (!expectedHashPrefix) return null
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
    await writeManifest(manifestPath, adopted)
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
  const keep = new Set([
    currentBackupPath,
    ...validNewestFirst.slice(0, retention - 1).map((entry) => entry.backupPath)
  ])
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

function legacyHashPrefix(fileName: string): string | null {
  return fileName.match(/\.([0-9a-f]{12})\.bak$/i)?.[1]?.toLocaleLowerCase() ?? null
}

function formatBytes(value: number | bigint): string {
  const bytes = typeof value === 'bigint' ? value : BigInt(value)
  const mebibyte = 1024n * 1024n
  if (bytes >= mebibyte) return `${Number(bytes / (mebibyte / 10n)) / 10} MiB`
  if (bytes >= 1024n) return `${Number(bytes / 1024n)} KiB`
  return `${bytes} bytes`
}
