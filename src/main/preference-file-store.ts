import { mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  isPreferenceDocument,
  MAX_PLANNER_PROFILES,
  MAX_PREFERENCE_BYTES,
  MAX_PREFERENCE_TODOS
} from '../shared/preference-schema.ts'

export const PREFERENCE_FILE_SCHEMA_VERSION = 1
export const PREFERENCE_BACKUP_RETENTION = 12
export const MAX_PREFERENCE_ENVELOPE_BYTES = MAX_PREFERENCE_BYTES + 256 * 1024
const MAX_IMPORTED_ORIGINS = 32

interface PreferenceEnvelope {
  version: 1
  revision: number
  updatedAtUtc: string
  importedOrigins: string[]
  preferences: Record<string, unknown>
}

export interface PreferenceBootstrapResult {
  serialized: string | null
  importedOrigin: boolean
  recovered: boolean
  backupCount: number
}

function preferenceDocument(serialized: string | null): Record<string, unknown> | null {
  if (serialized === null || Buffer.byteLength(serialized, 'utf8') > MAX_PREFERENCE_BYTES) return null
  try {
    const parsed = JSON.parse(serialized) as unknown
    return isPreferenceDocument(parsed) ? parsed : null
  } catch {
    return null
  }
}

function validEnvelope(value: unknown): value is PreferenceEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const envelope = value as Partial<PreferenceEnvelope>
  const exactKeys = Object.keys(envelope).length === 5 &&
    ['version', 'revision', 'updatedAtUtc', 'importedOrigins', 'preferences']
      .every((key) => Object.prototype.hasOwnProperty.call(envelope, key))
  return exactKeys && envelope.version === PREFERENCE_FILE_SCHEMA_VERSION &&
    Number.isSafeInteger(envelope.revision) && Number(envelope.revision) >= 1 &&
    typeof envelope.updatedAtUtc === 'string' && envelope.updatedAtUtc.length > 0 &&
    envelope.updatedAtUtc.length <= 64 && Number.isFinite(Date.parse(envelope.updatedAtUtc)) &&
    Array.isArray(envelope.importedOrigins) && envelope.importedOrigins.length <= MAX_IMPORTED_ORIGINS &&
    envelope.importedOrigins.every((origin) => typeof origin === 'string' && origin.length <= 2048) &&
    new Set(envelope.importedOrigins).size === envelope.importedOrigins.length &&
    isPreferenceDocument(envelope.preferences) &&
    Buffer.byteLength(JSON.stringify(envelope.preferences), 'utf8') <= MAX_PREFERENCE_BYTES
}

async function readEnvelope(path: string): Promise<PreferenceEnvelope | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(path, 'r')
    const buffer = Buffer.allocUnsafe(MAX_PREFERENCE_ENVELOPE_BYTES + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > MAX_PREFERENCE_ENVELOPE_BYTES) return null
    const parsed = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as unknown
    return validEnvelope(parsed) ? parsed : null
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    : []
}

function mergeById(current: unknown, incoming: unknown, maximumEntries: number): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>()
  const anonymous: Array<Record<string, unknown>> = []
  const add = (entry: Record<string, unknown>): void => {
    if (typeof entry.id !== 'string' || !entry.id) {
      anonymous.push(entry)
      return
    }
    const existing = merged.get(entry.id)
    if (!existing) {
      merged.set(entry.id, entry)
      return
    }
    const existingTime = typeof existing.modifiedAt === 'string' ? Date.parse(existing.modifiedAt) : Number.NaN
    const incomingTime = typeof entry.modifiedAt === 'string' ? Date.parse(entry.modifiedAt) : Number.NaN
    if (Number.isFinite(incomingTime) && (!Number.isFinite(existingTime) || incomingTime > existingTime)) {
      merged.set(entry.id, entry)
    }
  }
  recordArray(current).forEach(add)
  recordArray(incoming).forEach(add)
  return [...merged.values(), ...anonymous].slice(0, maximumEntries)
}

function stringUnion(current: unknown, incoming: unknown): string[] {
  return [...new Set([
    ...(Array.isArray(current) ? current.filter((entry): entry is string => typeof entry === 'string') : []),
    ...(Array.isArray(incoming) ? incoming.filter((entry): entry is string => typeof entry === 'string') : [])
  ])].slice(0, 512)
}

export function mergeOriginPreferences(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const currentPlanner = current.planner && typeof current.planner === 'object' && !Array.isArray(current.planner)
    ? current.planner as Record<string, unknown>
    : {}
  const incomingPlanner = incoming.planner && typeof incoming.planner === 'object' && !Array.isArray(incoming.planner)
    ? incoming.planner as Record<string, unknown>
    : {}
  const currentNotes = current.notes && typeof current.notes === 'object' && !Array.isArray(current.notes)
    ? current.notes as Record<string, unknown>
    : {}
  const incomingNotes = incoming.notes && typeof incoming.notes === 'object' && !Array.isArray(incoming.notes)
    ? incoming.notes as Record<string, unknown>
    : {}
  return {
    ...current,
    planner: {
      ...currentPlanner,
      profiles: mergeById(currentPlanner.profiles, incomingPlanner.profiles, MAX_PLANNER_PROFILES),
      ignoredRecords: stringUnion(currentPlanner.ignoredRecords, incomingPlanner.ignoredRecords),
      favoriteRecords: stringUnion(currentPlanner.favoriteRecords, incomingPlanner.favoriteRecords)
    },
    notes: {
      ...currentNotes,
      todos: mergeById(currentNotes.todos, incomingNotes.todos, MAX_PREFERENCE_TODOS)
    }
  }
}

function durableDigest(preferences: Record<string, unknown>): string {
  return JSON.stringify({ planner: preferences.planner, notes: preferences.notes })
}

function preferenceUpdatedAt(preferences: Record<string, unknown>): number {
  const meta = preferences.meta && typeof preferences.meta === 'object' && !Array.isArray(preferences.meta)
    ? preferences.meta as Record<string, unknown>
    : null
  const timestamp = typeof meta?.updatedAtUtc === 'string' ? Date.parse(meta.updatedAtUtc) : Number.NaN
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY
}

export class PreferenceFileStore {
  private readonly path: string
  private readonly previousPath: string
  private readonly backupDirectory: string
  private pending: Promise<void> = Promise.resolve()

  constructor(path: string, backupDirectory = join(dirname(path), 'preference-backups')) {
    this.path = path
    this.previousPath = join(dirname(path), `${basename(path, '.json')}.previous.json`)
    this.backupDirectory = backupDirectory
  }

  bootstrap(origin: string, candidateSerialized: string | null): Promise<PreferenceBootstrapResult> {
    return this.serialize(async () => {
      const loaded = await this.loadRecoverable()
      let envelope = loaded.envelope
      const candidate = preferenceDocument(candidateSerialized)
      let importedOrigin = false
      if (!envelope && candidate) {
        envelope = {
          version: PREFERENCE_FILE_SCHEMA_VERSION,
          revision: 1,
          updatedAtUtc: new Date().toISOString(),
          importedOrigins: [origin],
          preferences: candidate
        }
        importedOrigin = true
        await this.publish(envelope, null)
      } else if (envelope && candidate && !envelope.importedOrigins.includes(origin) &&
        envelope.importedOrigins.length < MAX_IMPORTED_ORIGINS) {
        const previous = envelope
        const merged = mergeOriginPreferences(previous.preferences, candidate)
        const boundedMerge = preferenceDocument(JSON.stringify(merged)) ?? previous.preferences
        envelope = {
          ...previous,
          revision: previous.revision + 1,
          updatedAtUtc: new Date().toISOString(),
          importedOrigins: [...previous.importedOrigins, origin],
          preferences: boundedMerge
        }
        importedOrigin = true
        await this.publish(envelope, previous)
      } else if (envelope && candidate && envelope.importedOrigins.includes(origin) &&
        preferenceUpdatedAt(candidate) > Date.parse(envelope.updatedAtUtc)) {
        // localStorage is written before its main-process mirror. If that IPC/file write failed,
        // the same origin's strictly newer document is the recovery source on the next launch.
        const previous = envelope
        envelope = {
          ...previous,
          revision: previous.revision + 1,
          updatedAtUtc: new Date().toISOString(),
          preferences: candidate
        }
        await this.publish(envelope, previous)
      }
      return {
        serialized: envelope ? JSON.stringify(envelope.preferences) : null,
        importedOrigin,
        recovered: loaded.recovered,
        backupCount: await this.backupCount()
      }
    })
  }

  save(serialized: string): Promise<void> {
    return this.serialize(async () => {
      const preferences = preferenceDocument(serialized)
      if (!preferences) throw new Error('The preference document is invalid or outside its safe bounds.')
      const loaded = await this.loadRecoverable()
      const previous = loaded.envelope
      if (previous && JSON.stringify(previous.preferences) === JSON.stringify(preferences)) return
      const envelope: PreferenceEnvelope = {
        version: PREFERENCE_FILE_SCHEMA_VERSION,
        revision: (previous?.revision ?? 0) + 1,
        updatedAtUtc: new Date().toISOString(),
        importedOrigins: previous?.importedOrigins ?? [],
        preferences
      }
      await this.publish(envelope, previous)
    })
  }

  async flush(): Promise<void> {
    await this.pending
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation, operation)
    this.pending = result.then(() => undefined, () => undefined)
    return result
  }

  private async loadRecoverable(): Promise<{ envelope: PreferenceEnvelope | null; recovered: boolean }> {
    const primary = await readEnvelope(this.path)
    if (primary) return { envelope: primary, recovered: false }
    const previous = await readEnvelope(this.previousPath)
    if (previous) {
      await this.publish(previous, null)
      return { envelope: previous, recovered: true }
    }
    const backups = await this.backupNames()
    for (const name of backups) {
      const backup = await readEnvelope(join(this.backupDirectory, name))
      if (!backup) continue
      await this.publish(backup, null)
      return { envelope: backup, recovered: true }
    }
    return { envelope: null, recovered: false }
  }

  private async publish(next: PreferenceEnvelope, previous: PreferenceEnvelope | null): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const serialized = JSON.stringify(next)
    if (!validEnvelope(next) || Buffer.byteLength(serialized, 'utf8') > MAX_PREFERENCE_ENVELOPE_BYTES) {
      throw new Error('The preference document is outside its safe bounds.')
    }
    if (previous) {
      await writeFile(this.previousPath, JSON.stringify(previous), 'utf8')
      if (durableDigest(previous.preferences) !== durableDigest(next.preferences)) {
        await mkdir(this.backupDirectory, { recursive: true })
        const backupPath = join(
          this.backupDirectory,
          `preferences-${String(previous.revision).padStart(10, '0')}.json`
        )
        await writeFile(backupPath, JSON.stringify(previous), 'utf8')
      }
    }
    const temporary = `${this.path}.${randomUUID()}.tmp`
    await writeFile(temporary, serialized, 'utf8')
    await rename(temporary, this.path)
    await this.pruneBackups()
  }

  private async backupNames(): Promise<string[]> {
    try {
      return (await readdir(this.backupDirectory))
        .filter((name) => /^preferences-\d{10}\.json$/.test(name))
        .sort((left, right) => right.localeCompare(left))
    } catch {
      return []
    }
  }

  private async backupCount(): Promise<number> {
    return (await this.backupNames()).length
  }

  private async pruneBackups(): Promise<void> {
    const names = await this.backupNames()
    await Promise.all(names.slice(PREFERENCE_BACKUP_RETENTION).map((name) =>
      rm(join(this.backupDirectory, name), { force: true })
    ))
    // A failed publish can leave only an expendable temporary file behind.
    const directory = dirname(this.path)
    try {
      const entries = await readdir(directory)
      await Promise.all(entries
        .filter((name) => name.startsWith(`${basename(this.path)}.`) && name.endsWith('.tmp'))
        .map((name) => rm(join(directory, name), { force: true })))
    } catch {
      // The parent is created by publish; a concurrent teardown may remove it in tests.
    }
  }
}
