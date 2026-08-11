export const IPC_CHANNELS = {
  getAppStatus: 'app:get-status',
  setZoomFactor: 'app:set-zoom-factor',
  getCachedCollection: 'collection:get-cached',
  discoverGrimDawn: 'grim-dawn:discover',
  scanCollection: 'grim-dawn:scan-collection',
  setPinnedBest: 'collection:set-pinned-best',
  inspectWriteSafety: 'vault:inspect-write-safety',
  inspectStagingTab: 'vault:inspect-staging-tab',
  listVaultItems: 'vault:list-items',
  ingestStagingTab: 'vault:ingest-staging-tab',
  retrieveVaultItems: 'vault:retrieve-items',
  inspectLiveGame: 'live:inspect',
  startLiveGame: 'live:start',
  stopLiveGame: 'live:stop',
  syncLiveGame: 'live:sync',
  retrieveLiveVaultItems: 'live:retrieve-items'
} as const

export type CollectionBasis = 'stashes' | 'archive'

export interface AppStatus {
  appVersion: string
  helper: 'not-configured' | 'available' | 'unavailable'
  mode: 'read-only'
}

export interface CairnCodexApi {
  getAppStatus: () => Promise<AppStatus>
  setZoomFactor: (factor: number) => Promise<number>
  discoverGrimDawn: () => Promise<GrimDawnDiscovery>
  getCachedCollection: (sourcePaths: string[], basis: CollectionBasis) => Promise<CollectionSnapshot | null>
  scanCollection: (sourcePaths: string[], basis: CollectionBasis) => Promise<CollectionSnapshot>
  setPinnedBest: (record: string, instanceKey: string | null, isHardcore: boolean) => Promise<void>
  inspectWriteSafety: () => Promise<WriteSafetyStatus>
  inspectStagingTab: (path: string) => Promise<StagingTabInspection>
  listVaultItems: () => Promise<VaultListItem[]>
  ingestStagingTab: (path: string) => Promise<IngestResult>
  retrieveVaultItems: (path: string, vaultItemIds: string[]) => Promise<RetrievalResult>
  inspectLiveGame: () => Promise<LiveGameStatus>
  startLiveGame: () => Promise<LiveGameStatus>
  stopLiveGame: () => Promise<LiveGameStatus>
  syncLiveGame: () => Promise<LiveGameSyncResult>
  retrieveLiveVaultItems: (vaultItemIds: string[]) => Promise<LiveRetrievalResult>
}

export interface WriteSafetyStatus {
  permitted: boolean
  reasons: string[]
}

export type LiveGameState = 'unavailable' | 'available' | 'connecting' | 'ready' | 'blocked'

export interface LiveGameStatus {
  state: LiveGameState
  detail: string
  grimDawnProcessIds: number[]
  itemAssistantProcessIds: number[]
  hookAvailable: boolean
  adapterDirectory: string | null
  hookVersion: string | null
  connectedProcessId: number | null
  isHardcore: boolean | null
  ingestTabSetting: number
  depositTabSetting: number
  ingestTabDescription: string
  depositTabDescription: string
  hostWindowReady: boolean
  injectorOutput: string | null
  messages: Array<{ type: number; dataHex: string; receivedAtUtc: string }>
}

export interface LiveGameSyncResult {
  status: LiveGameStatus
  ingested: Array<{
    vaultItemId: string
    baseRecord: string
    prefixRecord: string
    suffixRecord: string
    name: string
    seed: number
  }>
  issues: string[]
}

export interface LiveRetrievalResult {
  operationId: string
  status: 'committed'
  retrieved: Array<{ vaultItemId: string; baseRecord: string; seed: number }>
  receiptPaths: string[]
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
  rarity: CollectionItemRarity
  catalogued: boolean
  isHardcore: boolean
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
  catalogPresentationVersion?: number
  basis?: CollectionBasis
  isHardcore?: boolean
  availableStashes?: ScannedStash[]
  scannedAtUtc: string
  discovery: GrimDawnDiscovery
  contentPacks: CatalogContentPack[]
  scannedStashes: ScannedStash[]
  observedItems: ObservedStashItem[]
  warnings: CollectionScanWarning[]
  rarities: CollectionRaritySummary[]
  items: CollectionItem[]
  affixSummary: CollectionAffixSummary
  affixes: CollectionAffix[]
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
  rarity: CollectionItemRarity
  total: number
  collected: number
  availableCopies: number
}

export type CollectionItemRarity = 'epic' | 'legendary' | 'mi'

export interface CollectionAffixSummary {
  total: number
  collected: number
  availableCopies: number
}

export interface CollectionAffix {
  key: string
  name: string
  kind: 'prefix' | 'suffix'
  rarity: 'magical' | 'rare'
  records: string[]
  availableCount: number
}

export interface CollectionItem {
  record: string
  name: string
  rarity: CollectionItemRarity
  itemClass: string
  slot: string
  levelRequirement: number
  itemLevel: number
  setName: string | null
  setRecord: string | null
  bitmap: string | null
  iconKey?: string | null
  contentPack: string
  setPresentation?: ItemSetPresentation | null
  acquisition?: ItemAcquisitionPresentation
  presentation?: ItemPresentation
  availableCount: number
  bestRollPercentile: number | null
  analyzedCopyCount: number
  pinnedInstanceKey: string | null
  discovered?: boolean
  firstDiscoveredAt?: string | null
}

export interface ItemPresentation {
  flavorText: string | null
  sections: ItemPresentationSection[]
  grantedSkill: ItemGrantedSkillPresentation | null
  searchText: string
}

export interface ItemPresentationSection {
  kind: 'base' | 'pet' | 'skill-modifier'
  heading: string | null
  lines: ItemPresentationLine[]
}

export interface ItemPresentationLine {
  label: string
  minimum: number | null
  maximum: number | null
  unit: '' | '%' | 's' | 'm' | '°'
  tone: 'standard' | 'skill' | 'mastery' | 'pet'
  prefix: string
  suffix: string
}

export interface ItemGrantedSkillPresentation {
  name: string
  description: string | null
  trigger: string | null
  lines: ItemPresentationLine[]
}

export interface ItemSetPresentation {
  name: string
  description: string | null
  members: string[]
  tiers: ItemSetBonusTier[]
}

export interface ItemSetBonusTier {
  requiredPieces: number
  lines: ItemPresentationLine[]
  petLines: ItemPresentationLine[]
  skillModifiers: ItemPresentationSection[]
  grantedSkill: ItemGrantedSkillPresentation | null
}

export interface ItemAcquisitionPresentation {
  sources: string[]
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
  baseEstimatedPercentile: number | null
  prefixEstimatedPercentile: number | null
  suffixEstimatedPercentile: number | null
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
