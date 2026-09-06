import { posix } from 'node:path'

export const forbiddenDataExtensions = new Set([
  '.db', '.sqlite', '.sqlite3', '.gsh', '.gst', '.gdc', '.bak', '.dmp',
  '.pdb', '.csv', '.arz', '.arc', '.tex'
])

export function isForbiddenDataFile(path) {
  const normalized = path.replaceAll('\\', '/').toLowerCase()
  // SQLite sidecars can contain records even when the database itself is absent.
  const withoutSidecar = normalized.replace(/-(?:wal|shm|journal)$/, '')
  return forbiddenDataExtensions.has(posix.extname(withoutSidecar))
}

const forbiddenSegments = new Set([
  'backups', 'live-adapter', 'live-receipts', 'item-icons', 'quarantine',
  'local-cache', 'user-data', 'saves'
])

export function assertPackageDataPath(path, { inAsar = false } = {}) {
  const normalized = path.replaceAll('\\', '/').replace(/^\//, '').toLowerCase()
  const segments = normalized.split('/')
  if (!normalized || normalized.includes('\0') || /^[a-z]:/.test(normalized) || segments.some((part) => part === '..' || part === '.' || !part)) {
    throw new Error(`Invalid package entry path: ${path}`)
  }
  // The generated helper's portable PDB is deliberately shipped for diagnostics.
  // This exception never permits source/debug files inside the application ASAR.
  const helperSymbols = !inAsar && normalized === 'resources/helper/cairncodex.grimdawn.pdb'
  if ((!helperSymbols && isForbiddenDataFile(normalized)) || segments.some((part) => forbiddenSegments.has(part))) {
    throw new Error(`Personal or game-state data is present in the package: ${path}`)
  }
  if (posix.extname(normalized) === '.asar' && (inAsar || normalized !== 'resources/app.asar')) {
    throw new Error(`Unexpected nested or unaudited ASAR archive: ${path}`)
  }
}
