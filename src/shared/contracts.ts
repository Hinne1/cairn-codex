export const IPC_CHANNELS = {
  getAppStatus: 'app:get-status',
  setZoomFactor: 'app:set-zoom-factor',
  exportDiagnostics: 'app:export-diagnostics',
  openDataDirectory: 'app:open-data-directory',
  getRecoveryStatus: 'app:get-recovery-status',
  getCachedCollection: 'collection:get-cached',
  hydrateArchiveRolls: 'collection:hydrate-archive-rolls',
  discoverGrimDawn: 'grim-dawn:discover',
  listCharacters: 'grim-dawn:list-characters',
  scanCollection: 'grim-dawn:scan-collection',
  rebuildGameDataIndex: 'grim-dawn:rebuild-game-data-index',
  setPinnedBest: 'collection:set-pinned-best',
  getInfiniteSupplies: 'settings:get-infinite-supplies',
  setInfiniteSupplies: 'settings:set-infinite-supplies',
  inspectWriteSafety: 'vault:inspect-write-safety',
  inspectStagingTab: 'vault:inspect-staging-tab',
  listVaultItems: 'vault:list-items',
  ingestStagingTab: 'vault:ingest-staging-tab',
  retrieveVaultItems: 'vault:retrieve-items',
  inspectLiveGame: 'live:inspect',
  approveLiveGameBuild: 'live:approve-build',
  startLiveGame: 'live:start',
  stopLiveGame: 'live:stop',
  syncLiveGame: 'live:sync',
  retrieveLiveVaultItems: 'live:retrieve-items',
  dispenseLiveAugments: 'live:dispense-augments'
} as const

export type CollectionBasis = 'stashes' | 'archive'

export interface AppStatus {
  appVersion: string
  helper: 'not-configured' | 'available' | 'unavailable'
  mode: 'read-only'
}

export interface DiagnosticExportResult {
  canceled: boolean
  path: string | null
}

export interface RecoveryStatus {
  requiresAttention: boolean
  operations: Array<{
    id: string
    operation: string
    state: string
    startedAtUtc: string
    hasBackup: boolean
  }>
}

export interface CairnCodexApi {
  getAppStatus: () => Promise<AppStatus>
  setZoomFactor: (factor: number) => Promise<number>
  exportDiagnostics: () => Promise<DiagnosticExportResult>
  openDataDirectory: () => Promise<string>
  getRecoveryStatus: () => Promise<RecoveryStatus>
  discoverGrimDawn: () => Promise<GrimDawnDiscovery>
  listCharacters: () => Promise<CharacterSaveProfile[]>
  getCachedCollection: (sourcePaths: string[], basis: CollectionBasis) => Promise<CollectionSnapshot | null>
  hydrateArchiveRolls: (sourcePaths: string[]) => Promise<CollectionSnapshot | null>
  scanCollection: (sourcePaths: string[], basis: CollectionBasis) => Promise<CollectionSnapshot>
  rebuildGameDataIndex: (sourcePaths: string[], basis: CollectionBasis) => Promise<CollectionSnapshot>
  setPinnedBest: (record: string, instanceKey: string | null, isHardcore: boolean) => Promise<void>
  getInfiniteSupplies: () => Promise<boolean>
  setInfiniteSupplies: (enabled: boolean) => Promise<boolean>
  inspectWriteSafety: () => Promise<WriteSafetyStatus>
  inspectStagingTab: (path: string) => Promise<StagingTabInspection>
  listVaultItems: () => Promise<VaultListItem[]>
  ingestStagingTab: (path: string) => Promise<IngestResult>
  retrieveVaultItems: (path: string, vaultItemIds: string[]) => Promise<RetrievalResult>
  inspectLiveGame: () => Promise<LiveGameStatus>
  approveLiveGameBuild: () => Promise<LiveGameStatus>
  startLiveGame: () => Promise<LiveGameStatus>
  stopLiveGame: () => Promise<LiveGameStatus>
  syncLiveGame: () => Promise<LiveGameSyncResult>
  retrieveLiveVaultItems: (vaultItemIds: string[]) => Promise<LiveRetrievalResult>
  dispenseLiveAugments: (records: string[], expectedCharacterName?: string) => Promise<LiveSupplyDispenseResult>
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
  activeCharacterName: string | null
  ingestTabSetting: number
  depositTabSetting: number
  ingestTabDescription: string
  depositTabDescription: string
  hostWindowReady: boolean
  injectorOutput: string | null
  messages: Array<{ type: number; dataHex: string; receivedAtUtc: string }>
  gameVersion: string | null
  gameBuildId: string | null
  gameDllSha256: string | null
  gameDllLastWriteUtc: string | null
  hookSha256: string | null
  recommendation: string | null
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
    instanceKey: string
    rollAnalysis: ItemRollAnalysis | null
  }>
  issues: string[]
}

export interface LiveRetrievalResult {
  operationId: string
  status: 'committed'
  retrieved: Array<{ vaultItemId: string; baseRecord: string; seed: number }>
  receiptPaths: string[]
  issues: string[]
}

export interface LiveSupplyDispenseResult {
  operationId: string
  status: 'committed'
  activeCharacter: string
  dispensed: Array<{ record: string; name: string }>
  receiptPaths: string[]
  issues: string[]
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
  slot: string
  catalogued: boolean
  reusable: boolean
  isHardcore: boolean
  state: VaultItemState
  seed: number
  stackCount: number
  prefixRecord: string
  suffixRecord: string
  instanceKey: string
  rollAnalysis: ItemRollAnalysis | null
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

export interface CharacterSaveProfile {
  path: string
  name: string
  level: number
  isHardcore: boolean
  classRecord: string
  className: string
  factions: CharacterSaveFaction[]
  skills: CharacterSaveSkill[]
  lastWriteUtc: string
  error: string | null
}

export interface CharacterSaveFaction {
  index: number
  name: string
  isUnlocked: boolean
  value: number
  rank: 'Hostile' | 'Tolerated' | 'Friendly' | 'Respected' | 'Honored' | 'Revered' | string
}

export interface CharacterSaveSkill {
  record: string
  name: string
  level: number
  enabled: boolean
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
  cacheNeedsRefresh?: boolean
  rollHydrationPending?: number
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
  recipeSummary: CollectionRecipeSummary
  supplySummary?: CollectionRaritySummary
  affixSummary: CollectionAffixSummary
  affixes: CollectionAffix[]
  plannerItems?: CollectionItem[]
  supplies?: CollectionItem[]
  materials?: CollectionItem[]
  accountStores?: ScannedAccountStore[]
  skillMasteries?: Record<string, string>
  skillClassNames?: Record<string, string>
}

export interface ScannedAccountStore {
  path: string
  kind: 'reagents' | 'potions'
  isHardcore: boolean
  itemCount: number
  lastWriteUtc: string
  sha256: string
  entries: AccountStoreEntry[]
}

export interface AccountStoreEntry {
  record: string
  quantity: number
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

export type CollectionItemRarity = 'epic' | 'legendary' | 'mi' | 'rare' | 'faction' | 'supply' | 'component' | 'consumable'

export interface CollectionAffixSummary {
  total: number
  collected: number
  availableCopies: number
}

export interface CollectionRecipeSummary {
  total: number
  collected: number
  unlockedItems: number
}

export interface CollectionAffix {
  key: string
  name: string
  kind: 'prefix' | 'suffix'
  rarity: 'magical' | 'rare'
  records: string[]
  availableCount: number
  presentations?: Record<string, ItemPresentation>
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
  supplySlotFamilies?: Array<'weapon' | 'armor' | 'jewelry'> | null
  upgradeRecord?: string | null
  baseVersionRecord?: string | null
  availableViaAwakening?: boolean
  awakeningSourceRecord?: string | null
  awakeningSourceName?: string | null
  awakeningSourceAvailableCount?: number
  availableCount: number
  bestRollPercentile: number | null
  analyzedCopyCount: number
  pinnedInstanceKey: string | null
  discovered?: boolean
  recipeUnlocked?: boolean
  firstDiscoveredAt?: string | null
}

export interface ItemPresentation {
  flavorText: string | null
  sections: ItemPresentationSection[]
  grantedSkill: ItemGrantedSkillPresentation | null
  searchText: string
}

export interface ItemPresentationSection {
  kind: 'base' | 'pet' | 'skill-modifier' | 'visual-modifier'
  heading: string | null
  lines: ItemPresentationLine[]
}

export interface ItemPresentationLine {
  label: string
  minimum: number | null
  maximum: number | null
  unit: '' | '%' | 's' | 'm' | '°'
  tone: 'standard' | 'skill' | 'mastery' | 'pet' | 'visual'
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
  sourceRecords?: string[]
  locations?: MapRegionLocation[]
  additionalLocationCount?: number
  factions?: ItemFactionRequirement[]
  crafting?: ItemCraftingPresentation | null
}

export interface ItemCraftingPresentation {
  blueprintRecords: string[]
  knownSoftcore: boolean | null
  knownHardcore: boolean | null
}

export interface ItemFactionRequirement {
  faction: string
  reputation: 'Friendly' | 'Respected' | 'Honored' | 'Revered' | string
  vendorRecord: string
}

export interface MapRegionLocation {
  name: string
  routeName?: string
  zoneRecord: string
  levelFile: string
  contentPack: string
  originX: number
  originY: number
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
  modelVersion?: number
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
  petStats?: RolledStat[]
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
