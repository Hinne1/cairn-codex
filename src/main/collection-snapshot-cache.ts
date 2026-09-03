import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import type { CollectionSnapshot } from '../shared/contracts.ts'

export const COLLECTION_SNAPSHOT_CACHE_VERSION = 1

interface CollectionSnapshotCacheEnvelope {
  version: typeof COLLECTION_SNAPSHOT_CACHE_VERSION
  savedAtUtc: string
  snapshotSha256: string
  snapshot: CollectionSnapshot
}

interface CollectionSnapshotCacheWriteOptions {
  renameFile?: typeof rename
  wait?: (milliseconds: number) => Promise<void>
  retryDelaysMs?: readonly number[]
}

const EMPTY_RECIPE_SUMMARY = Object.freeze({
  total: 0,
  collected: 0,
  unlockedItems: 0
})

const WINDOWS_REPLACE_RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1_000] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string'
}

function isPresentationLine(value: unknown): boolean {
  return isRecord(value) && typeof value.label === 'string' &&
    (value.minimum === null || isFiniteNumber(value.minimum)) &&
    (value.maximum === null || isFiniteNumber(value.maximum)) &&
    typeof value.unit === 'string' && typeof value.tone === 'string' &&
    typeof value.prefix === 'string' && typeof value.suffix === 'string'
}

function isGrantedSkill(value: unknown, depth = 0): boolean {
  if (!isRecord(value) || depth > 8) return false
  return typeof value.name === 'string' && isNullableString(value.description) &&
    isNullableString(value.trigger) && Array.isArray(value.lines) &&
    value.lines.every(isPresentationLine) && Array.isArray(value.linkedSkills) &&
    value.linkedSkills.every((skill) => isGrantedSkill(skill, depth + 1))
}

function isPresentationSection(value: unknown): boolean {
  return isRecord(value) && typeof value.kind === 'string' &&
    isNullableString(value.heading) && Array.isArray(value.lines) &&
    value.lines.every(isPresentationLine)
}

function isItemPresentation(value: unknown): boolean {
  return isRecord(value) && isNullableString(value.flavorText) &&
    Array.isArray(value.sections) && value.sections.every(isPresentationSection) &&
    (value.grantedSkill === null || isGrantedSkill(value.grantedSkill)) &&
    typeof value.searchText === 'string'
}

function isSetPresentation(value: unknown): boolean {
  return isRecord(value) && typeof value.name === 'string' &&
    isNullableString(value.description) && Array.isArray(value.members) &&
    value.members.every((member) => typeof member === 'string') &&
    Array.isArray(value.tiers) && value.tiers.every((tier) =>
      isRecord(tier) && isFiniteNumber(tier.requiredPieces) &&
      Array.isArray(tier.lines) && tier.lines.every(isPresentationLine) &&
      Array.isArray(tier.petLines) && tier.petLines.every(isPresentationLine) &&
      Array.isArray(tier.skillModifiers) && tier.skillModifiers.every(isPresentationSection) &&
      (tier.grantedSkill === null || isGrantedSkill(tier.grantedSkill))
    )
}

function isAcquisition(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.sources) ||
    !value.sources.every((source) => typeof source === 'string')) return false
  if (value.crafting !== undefined && value.crafting !== null) {
    const crafting = value.crafting
    if (!isRecord(crafting) || !Array.isArray(crafting.blueprintRecords) ||
      !crafting.blueprintRecords.every((record) => typeof record === 'string') ||
      ![true, false, null].includes(crafting.knownSoftcore as boolean | null) ||
      ![true, false, null].includes(crafting.knownHardcore as boolean | null)) return false
  }
  return true
}

function isCatalogItem(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.record === 'string' && typeof value.name === 'string' &&
    typeof value.rarity === 'string' && typeof value.itemClass === 'string' &&
    typeof value.slot === 'string' && isFiniteNumber(value.availableCount) &&
    (value.presentation === undefined || value.presentation === null || isItemPresentation(value.presentation)) &&
    (value.setPresentation === undefined || value.setPresentation === null || isSetPresentation(value.setPresentation)) &&
    (value.acquisition === undefined || isAcquisition(value.acquisition))
}

function isScannedStash(value: unknown): boolean {
  return isRecord(value) && typeof value.path === 'string' &&
    typeof value.isHardcore === 'boolean' && isFiniteNumber(value.itemCount) &&
    typeof value.lastWriteUtc === 'string' && typeof value.sha256 === 'string'
}

function isObservedItem(value: unknown): boolean {
  return isRecord(value) && typeof value.sourcePath === 'string' &&
    typeof value.baseRecord === 'string'
}

function isAccountStore(value: unknown): boolean {
  return isRecord(value) && typeof value.path === 'string' &&
    (value.kind === 'reagents' || value.kind === 'potions') &&
    typeof value.isHardcore === 'boolean' && isFiniteNumber(value.itemCount) &&
    typeof value.lastWriteUtc === 'string' && typeof value.sha256 === 'string' &&
    Array.isArray(value.entries) && value.entries.every((entry) =>
      isRecord(entry) && typeof entry.record === 'string' && isFiniteNumber(entry.quantity)
    )
}

function isCountSummary(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.total) &&
    isFiniteNumber(value.collected) && isFiniteNumber(value.availableCopies)
}

function isRecipeSummary(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.total) &&
    isFiniteNumber(value.collected) && isFiniteNumber(value.unlockedItems)
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
    typeof location.source === 'string' && Array.isArray(location.transferStashes) &&
    location.transferStashes.every((stash) => isRecord(stash) && typeof stash.path === 'string')
  )) return false
  return typeof snapshot.catalogPresentationVersion === 'number' &&
    typeof snapshot.scannedAtUtc === 'string' &&
    Array.isArray(snapshot.contentPacks) && snapshot.contentPacks.every((pack) =>
      isRecord(pack) && typeof pack.id === 'string' &&
      typeof pack.databasePath === 'string' && typeof pack.tagsPath === 'string'
    ) &&
    Array.isArray(snapshot.items) && snapshot.items.every(isCatalogItem) &&
    Array.isArray(snapshot.plannerItems) && snapshot.plannerItems.every(isCatalogItem) &&
    Array.isArray(snapshot.supplies) && snapshot.supplies.every(isCatalogItem) &&
    Array.isArray(snapshot.materials) && snapshot.materials.every(isCatalogItem) &&
    Array.isArray(snapshot.accountStores) && snapshot.accountStores.every(isAccountStore) &&
    Array.isArray(snapshot.observedItems) && snapshot.observedItems.every(isObservedItem) &&
    Array.isArray(snapshot.scannedStashes) && snapshot.scannedStashes.every(isScannedStash) &&
    Array.isArray(snapshot.warnings) && snapshot.warnings.every((warning) =>
      isRecord(warning) && typeof warning.path === 'string' && typeof warning.message === 'string'
    ) &&
    Array.isArray(snapshot.rarities) && snapshot.rarities.every((summary) =>
      isCountSummary(summary) && isRecord(summary) && typeof summary.rarity === 'string'
    ) &&
    (snapshot.recipeSummary === undefined || isRecipeSummary(snapshot.recipeSummary)) &&
    isCountSummary(snapshot.affixSummary) &&
    Array.isArray(snapshot.affixes) && snapshot.affixes.every((affix) =>
      isRecord(affix) && typeof affix.key === 'string' && Array.isArray(affix.records)
    )
}

function normalizeSnapshot(snapshot: CollectionSnapshot): CollectionSnapshot {
  if (isRecipeSummary(snapshot.recipeSummary)) return snapshot
  return { ...snapshot, recipeSummary: { ...EMPTY_RECIPE_SUMMARY } }
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
      return normalizeSnapshot(envelope.snapshot)
    }

    // Version 0 stored the snapshot directly. Read it once so existing users do
    // not lose their offline collection; the next successful write upgrades it.
    return isSnapshot(parsed) ? normalizeSnapshot(parsed) : null
  } catch {
    return null
  }
}

export async function writeCollectionSnapshotCache(
  path: string,
  snapshot: CollectionSnapshot,
  nowUtc = new Date().toISOString(),
  options: CollectionSnapshotCacheWriteOptions = {}
): Promise<void> {
  const normalized = normalizeSnapshot(snapshot)
  const envelope: CollectionSnapshotCacheEnvelope = {
    version: COLLECTION_SNAPSHOT_CACHE_VERSION,
    savedAtUtc: nowUtc,
    snapshotSha256: snapshotSha256(normalized),
    snapshot: normalized
  }
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, JSON.stringify(envelope), 'utf8')
  const renameFile = options.renameFile ?? rename
  const wait = options.wait ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const retryDelaysMs = options.retryDelaysMs ?? WINDOWS_REPLACE_RETRY_DELAYS_MS
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await renameFile(temporaryPath, path)
        return
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : ''
        const delay = retryDelaysMs[attempt]
        if (!['EACCES', 'EBUSY', 'EPERM'].includes(code) || delay === undefined) throw error
        await wait(delay)
      }
    }
  } finally {
    // A failed replacement must leave the last valid final snapshot untouched.
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}
