export const IPC_CHANNELS = {
  getAppStatus: 'app:get-status',
  discoverGrimDawn: 'grim-dawn:discover',
  scanCollection: 'grim-dawn:scan-collection'
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
}
