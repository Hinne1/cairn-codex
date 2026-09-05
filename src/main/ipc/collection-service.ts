import type {
  ArchiveRollHydrationResult,
  CharacterSaveProfile,
  CollectionBasis,
  CollectionSnapshot,
  GrimDawnDiscovery
} from '../../shared/contracts.ts'
import { copyCollectionRequest, type CollectionRequestContext } from '../../shared/collection-request.ts'

export const ARCHIVE_ROLL_HYDRATION_BATCH_LIMIT = 256

export class CollectionRefreshInProgressError extends Error {
  readonly code = 'collection.refresh-already-running'

  constructor() {
    super('A collection scan or rebuild is already running.')
    this.name = 'CollectionRefreshInProgressError'
  }
}

export class CollectionInstallationUnavailableError extends Error {
  readonly code = 'collection.installation-unavailable'

  constructor() {
    super('No Grim Dawn installation is available.')
    this.name = 'CollectionInstallationUnavailableError'
  }
}

export interface CollectionSnapshotCache {
  read(): Promise<CollectionSnapshot | null>
  write(snapshot: CollectionSnapshot): Promise<void>
}

export interface CollectionCacheFreshness {
  isMapIndexFresh(): Promise<boolean>
  areSourcesFresh(snapshot: CollectionSnapshot): Promise<boolean>
}

export interface CollectionCatalogScanner {
  scanInstalledData(): Promise<CollectionSnapshot>
}

export interface CollectionIconEnricher {
  attachIcons(snapshot: CollectionSnapshot): Promise<CollectionSnapshot>
}

export interface CollectionMapEnricher {
  attachLocations(snapshot: CollectionSnapshot, forceRebuild: boolean): Promise<CollectionSnapshot>
}

export interface CollectionArchiveRepository {
  persistSnapshot(snapshot: CollectionSnapshot): CollectionSnapshot
}

export interface CollectionProjector {
  projectSources(snapshot: CollectionSnapshot, sourcePaths: string[]): CollectionSnapshot
  present(snapshot: CollectionSnapshot, basis: CollectionBasis): Promise<CollectionSnapshot>
}

export interface CollectionHydrationProgress {
  processed: number
  pending: number
}

export interface CollectionRollHydrationRequest {
  installationPath: string
  batchLimit: number
  onProgress(progress: CollectionHydrationProgress): void
}

export interface CollectionRollHydrator {
  hydrateAll(request: CollectionRollHydrationRequest): Promise<CollectionHydrationProgress>
}

export interface CollectionServiceDiagnostics {
  reportMapIndexFailure(error: unknown): void
}

export interface CollectionDiscoveryService {
  discover(): Promise<GrimDawnDiscovery>
  listCharacters(installationPath: string): Promise<CharacterSaveProfile[]>
}

export interface CollectionPreferenceStore {
  setFavoriteItem(instanceKey: string, isHardcore: boolean, favorite: boolean): void
  setPinnedBest(record: string, instanceKey: string | null, isHardcore: boolean): void
  getInfiniteSupplies(): boolean
  setInfiniteSupplies(enabled: boolean): boolean
  runExclusive<T>(operation: () => Promise<T>): Promise<T>
  queueArchiveBackup(reason: string): void
}

export interface CollectionServiceDependencies {
  cache: CollectionSnapshotCache
  freshness: CollectionCacheFreshness
  scanner: CollectionCatalogScanner
  icons: CollectionIconEnricher
  maps: CollectionMapEnricher
  archive: CollectionArchiveRepository
  projector: CollectionProjector
  hydration: CollectionRollHydrator
  diagnostics: CollectionServiceDiagnostics
  discovery: CollectionDiscoveryService
  preferences: CollectionPreferenceStore
  catalogPresentationVersion: number
  afterCatalogCommit(snapshot: CollectionSnapshot): Promise<void>
}

export type CollectionRequest = CollectionRequestContext

export interface CollectionHydrationServiceRequest {
  sourcePaths: string[]
  onProgress?(progress: CollectionHydrationProgress): void
}

function normalizedPath(path: string): string {
  return path.replaceAll('\\', '/').toLocaleLowerCase()
}

function saveLocationKey(location: CollectionSnapshot['discovery']['saveLocations'][number]): string {
  return `${location.source}:${normalizedPath(location.path).replace(/\/+$/, '')}`
}

function sourceSaveLocation(
  sourcePath: string,
  snapshot: CollectionSnapshot
): CollectionSnapshot['discovery']['saveLocations'][number] | null {
  const path = normalizedPath(sourcePath)
  return snapshot.discovery.saveLocations
    .filter((location) => {
      const root = normalizedPath(location.path).replace(/\/+$/, '')
      return path === root || path.startsWith(root + '/')
    })
    .sort((left, right) => right.path.length - left.path.length)[0] ?? null
}

function shouldRetainMissingSource(
  sourcePath: string,
  current: CollectionSnapshot,
  previous: CollectionSnapshot,
  failedPaths: ReadonlySet<string>
): boolean {
  if (failedPaths.has(normalizedPath(sourcePath))) return true
  const priorRoot = sourceSaveLocation(sourcePath, previous)
  if (!priorRoot) return false
  const currentRootKeys = new Set(current.discovery.saveLocations.map(saveLocationKey))
  if (currentRootKeys.has(saveLocationKey(priorRoot))) return false

  const previousRootKeys = new Set(previous.discovery.saveLocations.map(saveLocationKey))
  const replacementRootAppeared = current.discovery.saveLocations.some((location) =>
    location.source === priorRoot.source && !previousRootKeys.has(saveLocationKey(location))
  )
  return !replacementRootAppeared
}

function recipeKnowledgeCanCarryForward(
  current: CollectionSnapshot,
  previous: CollectionSnapshot
): boolean {
  if (current.discovery.saveLocations.length === 0) return true
  const previousRootKeys = new Set(previous.discovery.saveLocations.map(saveLocationKey))
  return current.discovery.saveLocations.some((location) =>
    previousRootKeys.has(saveLocationKey(location))
  )
}

function mergeKnownFlag(
  current: boolean | null,
  previous: boolean | null
): boolean | null {
  if (current === true || previous === true) return true
  if (current === false) return false
  return previous
}

function preserveRecipeKnowledge(
  current: CollectionSnapshot['items'],
  previous: CollectionSnapshot['items']
): CollectionSnapshot['items'] {
  const previousByRecord = new Map(
    previous.map((item) => [item.record.toLocaleLowerCase(), item])
  )
  return current.map((item) => {
    const priorCrafting = previousByRecord.get(item.record.toLocaleLowerCase())
      ?.acquisition?.crafting
    const crafting = item.acquisition?.crafting
    if (!crafting || !priorCrafting) return item
    const knownSoftcore = mergeKnownFlag(crafting.knownSoftcore, priorCrafting.knownSoftcore)
    const knownHardcore = mergeKnownFlag(crafting.knownHardcore, priorCrafting.knownHardcore)
    if (
      knownSoftcore === crafting.knownSoftcore &&
      knownHardcore === crafting.knownHardcore
    ) return item
    return {
      ...item,
      acquisition: {
        ...item.acquisition!,
        crafting: { ...crafting, knownSoftcore, knownHardcore }
      }
    }
  })
}

/**
 * Keeps durable knowledge from sources which the latest scan did not positively
 * read. A successfully scanned empty source is present in the new snapshot and
 * replaces the old quantity; mere absence never gets interpreted as zero.
 *
 * Recipe ownership is learned account knowledge, so a later partial formula
 * scan cannot revoke a blueprint the app has already observed.
 */
export function preserveUnavailableCollectionKnowledge(
  current: CollectionSnapshot,
  previous: CollectionSnapshot | null
): CollectionSnapshot {
  if (!previous) return current

  const failedPaths = new Set(current.warnings.map((warning) => normalizedPath(warning.path)))
  const currentStashPaths = new Set(current.scannedStashes.map((stash) => normalizedPath(stash.path)))
  const retainedStashes = previous.scannedStashes.filter(
    (stash) => !currentStashPaths.has(normalizedPath(stash.path)) &&
      shouldRetainMissingSource(stash.path, current, previous, failedPaths)
  )
  const retainedStashPaths = new Set(retainedStashes.map((stash) => normalizedPath(stash.path)))

  const currentStoreKeys = new Set((current.accountStores ?? []).map((store) =>
    `${normalizedPath(store.path)}:${store.kind}:${store.isHardcore}`
  ))
  const retainedStores = (previous.accountStores ?? []).filter((store) =>
    !currentStoreKeys.has(`${normalizedPath(store.path)}:${store.kind}:${store.isHardcore}`) &&
      shouldRetainMissingSource(store.path, current, previous, failedPaths)
  )

  const mergeCatalog = (
    latest: CollectionSnapshot['items'] | undefined,
    prior: CollectionSnapshot['items'] | undefined
  ): CollectionSnapshot['items'] | undefined => {
    if (!latest) return latest
    return preserveRecipeKnowledge(latest, prior ?? [])
  }

  const retainedSourceCount = retainedStashes.length + retainedStores.length
  const previousAsOfUtc = previous.cachedDataAsOfUtc ?? previous.scannedAtUtc
  const recipePrevious = recipeKnowledgeCanCarryForward(current, previous) ? previous : null
  return {
    ...current,
    scannedStashes: [...current.scannedStashes, ...retainedStashes],
    observedItems: [
      ...current.observedItems,
      ...previous.observedItems.filter((item) => retainedStashPaths.has(normalizedPath(item.sourcePath)))
    ],
    accountStores: [...(current.accountStores ?? []), ...retainedStores],
    items: preserveRecipeKnowledge(current.items, recipePrevious?.items ?? []),
    plannerItems: mergeCatalog(current.plannerItems, recipePrevious?.plannerItems),
    supplies: mergeCatalog(current.supplies, recipePrevious?.supplies),
    materials: mergeCatalog(current.materials, recipePrevious?.materials),
    cacheNeedsRefresh: retainedSourceCount > 0,
    cachedDataAsOfUtc: retainedSourceCount > 0 ? previousAsOfUtc : undefined
  }
}

/**
 * Owns collection cache, refresh, rebuild, and bounded hydration orchestration.
 * No dependency knows about Electron; each one represents a concrete low-level
 * scanner, persistence, enrichment, projection, or hydration capability.
 */
export class CollectionService {
  private readonly dependencies: CollectionServiceDependencies
  private latest: CollectionSnapshot | null = null
  private refresh: Promise<CollectionSnapshot> | null = null

  constructor(dependencies: CollectionServiceDependencies) {
    this.dependencies = dependencies
  }

  discoverGrimDawn(): Promise<GrimDawnDiscovery> {
    return this.dependencies.discovery.discover()
  }

  async listCharacters(): Promise<CharacterSaveProfile[]> {
    const cached = await this.loadLatest()
    const discovered = cached?.discovery ?? await this.dependencies.discovery.discover()
    const installationPath = discovered.installations[0]?.path
    if (!installationPath) return []
    return this.dependencies.discovery.listCharacters(installationPath)
  }

  setPinnedBest(input: {
    record: string
    instanceKey: string | null
    isHardcore: boolean
  }): Promise<void> {
    return this.dependencies.preferences.runExclusive(async () => {
      this.dependencies.preferences.setPinnedBest(
        input.record, input.instanceKey, input.isHardcore
      )
      this.dependencies.preferences.queueArchiveBackup('pinned copy changed')
    })
  }

  setFavoriteItem(input: { instanceKey: string; isHardcore: boolean; favorite: boolean }): Promise<void> {
    return this.dependencies.preferences.runExclusive(async () => {
      this.dependencies.preferences.setFavoriteItem(input.instanceKey, input.isHardcore, input.favorite)
      this.dependencies.preferences.queueArchiveBackup('favorite copy changed')
    })
  }

  getInfiniteSupplies(): boolean {
    return this.dependencies.preferences.getInfiniteSupplies()
  }

  setInfiniteSupplies(input: { enabled: boolean }): Promise<boolean> {
    return this.dependencies.preferences.runExclusive(async () => {
      const enabled = this.dependencies.preferences.setInfiniteSupplies(input.enabled)
      this.dependencies.preferences.queueArchiveBackup('supply settings changed')
      return enabled
    })
  }

  async getCached(request: CollectionRequest): Promise<CollectionSnapshot | null> {
    const snapshot = await this.loadLatest()
    if (!snapshot) return null
    const presentationFresh =
      snapshot.catalogPresentationVersion === this.dependencies.catalogPresentationVersion
    const [mapIndexFresh, sourcesFresh] = await Promise.all([
      this.dependencies.freshness.isMapIndexFresh(),
      this.dependencies.freshness.areSourcesFresh(snapshot)
    ])
    const cacheNeedsRefresh =
      !presentationFresh || !mapIndexFresh || !sourcesFresh || snapshot.cacheNeedsRefresh === true
    const projected = this.dependencies.projector.projectSources(snapshot, request.sourcePaths)
    return {
      ...(await this.dependencies.projector.present(projected, request.basis)),
      cacheNeedsRefresh,
      cachedDataAsOfUtc: cacheNeedsRefresh
        ? snapshot.cachedDataAsOfUtc ?? snapshot.scannedAtUtc
        : undefined
    }
  }

  async scan(request: CollectionRequest): Promise<CollectionSnapshot> {
    const caller = copyCollectionRequest(request)
    return this.present(await this.scanCatalog(), caller)
  }

  async rebuild(request: CollectionRequest): Promise<CollectionSnapshot> {
    const caller = copyCollectionRequest(request)
    return this.present(await this.rebuildCatalog(), caller)
  }

  present(snapshot: CollectionSnapshot, request: CollectionRequest): Promise<CollectionSnapshot> {
    const projected = this.dependencies.projector.projectSources(snapshot, request.sourcePaths)
    return this.dependencies.projector.present(projected, request.basis)
  }

  scanCatalog(): Promise<CollectionSnapshot> {
    return this.startRefresh(async () => {
      const scanned = await this.dependencies.scanner.scanInstalledData()
      const withIcons = await this.dependencies.icons.attachIcons(scanned)
      let enriched = withIcons
      if (withIcons.discovery.installations[0]) {
        try {
          enriched = await this.dependencies.maps.attachLocations(withIcons, false)
        } catch (error) {
          // A normal catalog scan keeps existing fail-open map behavior. The
          // collection remains usable when optional location indexing fails.
          this.dependencies.diagnostics.reportMapIndexFailure(error)
        }
      }
      return this.persist(enriched)
    })
  }

  rebuildCatalog(): Promise<CollectionSnapshot> {
    return this.startRefresh(async () => {
      const scanned = await this.dependencies.scanner.scanInstalledData()
      const withIcons = await this.dependencies.icons.attachIcons(scanned)
      if (!withIcons.discovery.installations[0]) {
        throw new CollectionInstallationUnavailableError()
      }
      const withLocations = await this.dependencies.maps.attachLocations(withIcons, true)
      return this.persist(withLocations)
    })
  }

  async hydrateArchiveRolls(
    request: CollectionHydrationServiceRequest
  ): Promise<ArchiveRollHydrationResult | null> {
    const snapshot = await this.loadLatest()
    if (!snapshot) return null

    const projected = this.dependencies.projector.projectSources(snapshot, request.sourcePaths)
    const installation = projected.discovery.installations[0]
    if (!installation) {
      return {
        processed: 0,
        pending: 0,
        snapshot: await this.dependencies.projector.present(projected, 'archive')
      }
    }

    const result = await this.dependencies.hydration.hydrateAll({
      installationPath: installation.path,
      batchLimit: ARCHIVE_ROLL_HYDRATION_BATCH_LIMIT,
      onProgress: request.onProgress ?? (() => undefined)
    })
    return {
      processed: Math.max(0, Math.trunc(result.processed)),
      pending: Math.max(0, Math.trunc(result.pending)),
      snapshot: await this.dependencies.projector.present(projected, 'archive')
    }
  }

  private async loadLatest(): Promise<CollectionSnapshot | null> {
    if (this.latest) return this.latest
    this.latest = await this.dependencies.cache.read()
    return this.latest
  }

  private startRefresh(operation: () => Promise<CollectionSnapshot>): Promise<CollectionSnapshot> {
    if (this.refresh) return Promise.reject(new CollectionRefreshInProgressError())
    // Install the in-flight marker before invoking scanner/enricher dependencies,
    // which may synchronously call application observers.
    const refresh = Promise.resolve().then(operation)
    const tracked = refresh.then(
      (result) => {
        if (this.refresh === tracked) this.refresh = null
        return result
      },
      (error: unknown) => {
        if (this.refresh === tracked) this.refresh = null
        throw error
      }
    )
    this.refresh = tracked
    return tracked
  }

  private async persist(snapshot: CollectionSnapshot): Promise<CollectionSnapshot> {
    const previous = await this.loadLatest()
    const reconciled = preserveUnavailableCollectionKnowledge(snapshot, previous)
    const persisted = {
      ...this.dependencies.archive.persistSnapshot(reconciled),
      catalogPresentationVersion: this.dependencies.catalogPresentationVersion
    }
    // Publish the new in-memory snapshot only after the cache write succeeds.
    // A failed durable write therefore cannot masquerade as a completed refresh.
    await this.dependencies.cache.write(persisted)
    this.latest = persisted
    await this.dependencies.afterCatalogCommit(persisted)
    return persisted
  }
}
