export const IPC_CHANNELS = {
  getAppStatus: 'app:get-status',
  discoverGrimDawn: 'grim-dawn:discover',
  scanCollection: 'grim-dawn:scan-collection',
  setPinnedBest: 'collection:set-pinned-best',
  inspectWriteSafety: 'vault:inspect-write-safety',
  inspectStagingTab: 'vault:inspect-staging-tab',
  listVaultItems: 'vault:list-items',
  ingestStagingTab: 'vault:ingest-staging-tab',
  retrieveVaultItems: 'vault:retrieve-items'
} as const

export interface AppStatus {
  appVersion: string
  helper: 'not-configured' | 'available' | 'unavailable'
  mode: 'read-only'
}

export interface CairnCodexApi {
  getAppStatus: () => Promise<AppStatus>
  discoverGrimDawn: () => Promise<GrimDawnDiscovery>
  scanCollection: () => Promise<CollectionSnapshot>
  setPinnedBest: (record: string, instanceKey: string | null) => Promise<void>
  inspectWriteSafety: () => Promise<WriteSafetyStatus>
  inspectStagingTab: (path: string) => Promise<StagingTabInspection>
  listVaultItems: () => Promise<VaultListItem[]>
  ingestStagingTab: (path: string) => Promise<IngestResult>
  retrieveVaultItems: (path: string, vaultItemIds: string[]) => Promise<RetrievalResult>
}

export interface WriteSafetyStatus {
  permitted: boolean
  reasons: string[]
}

export interface StagingTabInspection {
  path: string
  sha256: string
  tabIndex: number
  tabCount: number
  itemCount: number
  totalItemCount: number
  items: StagedItem[]
}

export interface StagedItem {
  tabIndex: number
  itemIndex: number
  baseRecord: string
  name: string
  seed: number
  supported: boolean
}

export type VaultItemState = 'ingested' | 'retrieval_pending' | 'retrieved'

export interface VaultListItem {
  id: string
  baseRecord: string
  name: string
  rarity: 'epic' | 'legendary'
  state: VaultItemState
  seed: number
  ingestedAtUtc: string
  retrievedAtUtc: string | null
}

export interface IngestResult {
  operationId: string
  status: 'committed'
  ingested: Array<{ vaultItemId: string; baseRecord: string; seed: number }>
  sourceItems: number
  remainingItems: number
  lastTabItems: number
  sourceSha256: string
  committedSha256: string
  backupPath: string
  rollbackPath: string
}

export interface RetrievalResult {
  operationId: string
  status: 'committed'
  retrieved: Array<{ vaultItemId: string; baseRecord: string; seed: number }>
  sourceItems: number
  remainingItems: number
  targetTabItems: number
  sourceSha256: string
  committedSha256: string
  backupPath: string
  rollbackPath: string
}

export interface GrimDawnDiscovery {
  installations: GrimDawnInstallation[]
  saveLocations: GrimDawnSaveLocation[]
}

export interface GrimDawnInstallation {
  path: string
  source: 'steam' | 'gog'
  databasePath: string
}

export interface GrimDawnSaveLocation {
  path: string
  source: 'documents' | 'steam-cloud'
  transferStashes: TransferStashCandidate[]
}

export interface TransferStashCandidate {
  path: string
  version: number | null
  isHardcore: boolean
  modLabel: string | null
  tabCount: number | null
  itemCount: number | null
  fileSize: number | null
  lastWriteUtc: string | null
  error: string | null
}

export interface CollectionSnapshot {
  scannedAtUtc: string
  discovery: GrimDawnDiscovery
  contentPacks: CatalogContentPack[]
  scannedStashes: ScannedStash[]
  observedItems: ObservedStashItem[]
  warnings: CollectionScanWarning[]
  rarities: CollectionRaritySummary[]
  items: CollectionItem[]
}

export interface CatalogContentPack {
  id: string
  databasePath: string
  tagsPath: string
}

export interface ScannedStash {
  path: string
  isHardcore: boolean
  modLabel: string
  itemCount: number
  lastWriteUtc: string
  sha256: string
}

export interface CollectionScanWarning {
  path: string
  message: string
}

export interface CollectionRaritySummary {
  rarity: 'epic' | 'legendary'
  total: number
  collected: number
  availableCopies: number
}

export interface CollectionItem {
  record: string
  name: string
  rarity: 'epic' | 'legendary'
  itemClass: string
  slot: string
  levelRequirement: number
  itemLevel: number
  setName: string | null
  setRecord: string | null
  bitmap: string | null
  contentPack: string
  availableCount: number
  bestRollPercentile: number | null
  analyzedCopyCount: number
  pinnedInstanceKey: string | null
  discovered?: boolean
  firstDiscoveredAt?: string | null
}

export interface ObservedStashItem {
  sourcePath: string
  tabIndex: number
  itemIndex: number
  baseRecord: string
  prefixRecord: string
  suffixRecord: string
  modifierRecord: string
  transmuteRecord: string
  seed: number
  materiaRecord: string
  relicCompletionBonusRecord: string
  relicSeed: number
  enchantmentRecord: string
  ascendantRecord: string
  ascendantRecord2H: string
  enchantmentSeed: number
  materiaCombines: number
  stackCount: number
  rerolls: number
  affixRerolls: number
  rollAnalysis: ItemRollAnalysis | null
  instanceKey?: string
}

export interface ItemRollAnalysis {
  baseRecord: string
  prefixRecord: string
  suffixRecord: string
  seed: number
  supported: boolean
  trusted: boolean
  reason: string | null
  percentileSampleSize: number
  overallEstimatedPercentile: number | null
  stats: RolledStat[]
  unmodeledFields: string[]
}

export interface RolledStat {
  field: string
  value: number
  rollable: boolean
  observedMinimum: number | null
  observedMaximum: number | null
  estimatedPercentile: number | null
}
