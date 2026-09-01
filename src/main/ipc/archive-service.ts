import type {
  DismantlingPreview,
  IngestResult,
  OperationHistoryPage,
  OperationHistoryRequest,
  RetrievalResult,
  StagingTabInspection,
  VaultItemPage,
  VaultListItem,
  VaultPageRequest,
  VaultSummary
} from '../../shared/contracts.ts'
import { SerializedServiceQueue } from './service-registry.ts'

export interface OfflineStashItem {
  tabIndex: number
  itemIndex: number
  baseRecord: string
  seed: number
}

export interface OfflineStashTab {
  index: number
  items: OfflineStashItem[]
}

export interface OfflineStashScan {
  path: string
  sha256: string
  itemCount: number
  tabs: OfflineStashTab[]
}

export interface ArchiveReadStore {
  findCatalogNames(baseRecords: readonly string[]): ReadonlyMap<string, string>
  readVaultItems(): VaultListItem[]
  readVaultPage(request: VaultPageRequest): VaultItemPage
  readOperationHistory(request: OperationHistoryRequest): OperationHistoryPage
  readVaultSummary(): VaultSummary
}

export interface OfflineStashReader {
  scan(path: string): Promise<OfflineStashScan>
}

export interface ApprovedOfflineIngest {
  path: string
  expectedSourceSha256: string
  items: Array<{ tabIndex: number; itemIndex: number; expectedSeed: number }>
}

export interface ApprovedOfflineRetrieval {
  path: string
  expectedSourceSha256: string
  targetTabIndex: number
  vaultItemIds: string[]
}

/**
 * Performs the already-approved low-level archive transaction. Implementations
 * retain responsibility for atomic replacement, hash verification and journals.
 */
export interface OfflineArchiveTransactionWriter {
  commitIngest(input: ApprovedOfflineIngest): Promise<IngestResult>
  commitRetrieval(input: ApprovedOfflineRetrieval): Promise<RetrievalResult>
}

export interface ArchiveServiceDependencies {
  reads: ArchiveReadStore
  stashes: OfflineStashReader
  transactions: OfflineArchiveTransactionWriter
  enqueueArchiveBackup(reason: string): void
  reportBackupSchedulingFailure?(reason: string, error: unknown): void
  discoverInstallationPath(): Promise<string | null>
  simulateDismantling(
    installationPath: string,
    items: Array<{
      vaultItemId: string
      name: string
      rarity: 'epic' | 'legendary' | 'mi' | 'rare'
      itemLevel: number
      ascendant: boolean
    }>
  ): Promise<DismantlingPreview>
}

interface InspectedStagingTab {
  publicResult: StagingTabInspection
  sourceItems: OfflineStashItem[]
}

export class ArchiveServiceError extends Error {
  readonly code: string

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ArchiveServiceError'
    this.code = code
  }
}

function archiveError(error: unknown, code: string, fallback: string): ArchiveServiceError {
  if (error instanceof ArchiveServiceError) return error
  return new ArchiveServiceError(
    error instanceof Error ? error.message : fallback,
    code,
    { cause: error }
  )
}

function assertBoundedPage(
  page: { items: unknown[]; total: number; offset: number; limit: number },
  request: { offset: number; limit: number },
  code: string
): void {
  if (
    page.offset !== request.offset ||
    page.limit !== request.limit ||
    page.items.length > request.limit ||
    !Number.isSafeInteger(page.total) ||
    page.total < page.items.length
  ) {
    throw new ArchiveServiceError(
      'The archive query returned an invalid or unbounded page.',
      code
    )
  }
}

/**
 * Archive-domain policy independent of Electron. The service turns raw stash
 * scans into approved mutations and serializes all archive writes.
 */
export class ArchiveDomainService {
  private readonly dependencies: ArchiveServiceDependencies
  private readonly mutations = new SerializedServiceQueue()

  constructor(dependencies: ArchiveServiceDependencies) {
    this.dependencies = dependencies
  }

  listVaultItems(): VaultListItem[] {
    return this.dependencies.reads.readVaultItems()
  }

  queryVaultItems(request: VaultPageRequest): VaultItemPage {
    try {
      const page = this.dependencies.reads.readVaultPage(request)
      assertBoundedPage(page, request, 'archive.vault-query-invalid')
      return page
    } catch (error) {
      throw archiveError(error, 'archive.vault-query-failed', 'The archive query failed.')
    }
  }

  queryOperationHistory(request: OperationHistoryRequest): OperationHistoryPage {
    try {
      const page = this.dependencies.reads.readOperationHistory(request)
      assertBoundedPage(page, request, 'archive.history-query-invalid')
      return page
    } catch (error) {
      throw archiveError(error, 'archive.history-query-failed', 'The operation-history query failed.')
    }
  }

  getVaultSummary(): VaultSummary {
    return this.dependencies.reads.readVaultSummary()
  }

  async previewDismantling(vaultItemIds: readonly string[]): Promise<DismantlingPreview> {
    if (new Set(vaultItemIds).size !== vaultItemIds.length) {
      throw new ArchiveServiceError(
        'Duplicate dismantling candidate IDs are not allowed.',
        'archive.dismantling-duplicate'
      )
    }
    const byId = new Map(this.dependencies.reads.readVaultItems().map((item) => [item.id, item]))
    const items = vaultItemIds.map((id) => {
      const item = byId.get(id)
      if (!item || item.state !== 'ingested' || !item.catalogued || item.reusable ||
          !['epic', 'legendary', 'mi', 'rare'].includes(item.rarity)) {
        throw new ArchiveServiceError(
          `Archive copy is not eligible for dismantling preview: ${id}`,
          'archive.dismantling-ineligible'
        )
      }
      return {
        vaultItemId: item.id,
        name: item.name,
        rarity: item.rarity as 'epic' | 'legendary' | 'mi' | 'rare',
        itemLevel: item.itemLevel,
        ascendant: item.ascendant
      }
    })
    const installationPath = await this.dependencies.discoverInstallationPath()
    if (!installationPath) {
      throw new ArchiveServiceError(
        'No Grim Dawn installation is available.',
        'archive.installation-unavailable'
      )
    }
    return this.dependencies.simulateDismantling(installationPath, items)
  }

  async inspectStagingTab(path: string): Promise<StagingTabInspection> {
    try {
      return (await this.inspect(path)).publicResult
    } catch (error) {
      throw archiveError(error, 'archive.staging-inspection-failed', 'The staging tab could not be inspected.')
    }
  }

  ingestStagingTab(path: string): Promise<IngestResult> {
    return this.mutations.run(async () => {
      try {
        const staging = await this.inspect(path)
        if (staging.sourceItems.length === 0) {
          throw new ArchiveServiceError(
            'The final stash tab is empty; there is nothing staged for ingest.',
            'archive.ingest-empty'
          )
        }
        const unsupported = staging.publicResult.items.filter((item) => !item.supported)
        if (unsupported.length > 0) {
          throw new ArchiveServiceError(
            'The staging tab contains items that CC cannot archive: ' +
              unsupported.map((item) => item.name).join(', '),
            'archive.ingest-unsupported'
          )
        }
        const result = await this.dependencies.transactions.commitIngest({
          path: staging.publicResult.path,
          expectedSourceSha256: staging.publicResult.sha256,
          items: staging.sourceItems.map((item) => ({
            tabIndex: item.tabIndex,
            itemIndex: item.itemIndex,
            expectedSeed: item.seed
          }))
        })
        if (result.ingested.length > 0) this.scheduleBackup('offline ingest')
        return result
      } catch (error) {
        throw archiveError(error, 'archive.ingest-failed', 'Offline ingest failed.')
      }
    })
  }

  retrieveVaultItems(path: string, vaultItemIds: readonly string[]): Promise<RetrievalResult> {
    const requestedIds = [...vaultItemIds]
    return this.mutations.run(async () => {
      try {
        if (requestedIds.length === 0) {
          throw new ArchiveServiceError(
            'Select at least one vault item to retrieve.',
            'archive.retrieval-empty'
          )
        }
        if (new Set(requestedIds).size !== requestedIds.length) {
          throw new ArchiveServiceError(
            'The retrieval selection contains a duplicate archive item.',
            'archive.retrieval-duplicate'
          )
        }
        const staging = await this.inspect(path)
        if (staging.publicResult.itemCount !== 0) {
          throw new ArchiveServiceError(
            'The final stash tab must be empty before retrieving an item.',
            'archive.retrieval-staging-not-empty'
          )
        }
        const result = await this.dependencies.transactions.commitRetrieval({
          path: staging.publicResult.path,
          expectedSourceSha256: staging.publicResult.sha256,
          targetTabIndex: staging.publicResult.tabIndex,
          vaultItemIds: requestedIds
        })
        if (result.retrieved.length > 0) this.scheduleBackup('offline retrieval')
        return result
      } catch (error) {
        throw archiveError(error, 'archive.retrieval-failed', 'Offline retrieval failed.')
      }
    })
  }

  flush(): Promise<void> {
    return this.mutations.flush()
  }

  private async inspect(path: string): Promise<InspectedStagingTab> {
    const scan = await this.dependencies.stashes.scan(path)
    const lastTab = scan.tabs.at(-1)
    if (!lastTab) {
      throw new ArchiveServiceError(
        'The selected transfer stash has no tabs.',
        'archive.staging-tab-missing'
      )
    }
    const names = this.dependencies.reads.findCatalogNames(
      lastTab.items.map((item) => item.baseRecord)
    )
    return {
      sourceItems: lastTab.items,
      publicResult: {
        path: scan.path,
        sha256: scan.sha256,
        tabIndex: lastTab.index,
        tabCount: scan.tabs.length,
        itemCount: lastTab.items.length,
        totalItemCount: scan.itemCount,
        items: lastTab.items.map((item) => ({
          tabIndex: item.tabIndex,
          itemIndex: item.itemIndex,
          baseRecord: item.baseRecord,
          name: names.get(item.baseRecord.toLowerCase()) ?? item.baseRecord,
          seed: item.seed,
          supported: names.has(item.baseRecord.toLowerCase())
        }))
      }
    }
  }

  private scheduleBackup(reason: string): void {
    try {
      this.dependencies.enqueueArchiveBackup(reason)
    } catch (error) {
      // The mutation is already committed. Reporting backup queue failure must
      // not misrepresent it as rolled back or invite an unsafe repeated write.
      this.dependencies.reportBackupSchedulingFailure?.(reason, error)
    }
  }
}
