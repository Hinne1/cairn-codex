import type { CharacterSaveProfile, CollectionItem, CollectionRaritySummary, VaultListItem } from './contracts.ts'

export const WORKSPACE_PAGE_LIMIT = 250
export const ARCHIVE_SELECTION_LIMIT = 10_000

export type ArchiveItemSummary = Omit<VaultListItem, 'instanceKey' | 'rollAnalysis'> & {
  rollPercentile: number | null
}

export interface DismantlingQueryRequest {
  source: 'archive'
  isHardcore?: boolean
  rarity?: 'epic' | 'legendary' | 'mi' | 'rare'
  query: string
  offset: number
  limit: number
}

export interface DismantlingPage {
  items: ArchiveItemSummary[]
  total: number
  offset: number
  limit: number
}

export interface DismantlingSelection {
  ids: string[]
  total: number
  limit: number
}

export type SupplyCategory = 'writs' | 'augments'
export type SupplySlotFilter = 'all' | 'weapon' | 'armor' | 'jewelry'
export type SupplyCharacter = Pick<CharacterSaveProfile, 'name' | 'isHardcore'> & {
  factions: Array<Pick<CharacterSaveProfile['factions'][number], 'name' | 'isUnlocked' | 'value'>>
}

export interface SupplyQueryRequest {
  source: 'all' | 'archive' | 'faction'
  category: SupplyCategory
  slot: SupplySlotFilter
  query: string
  isHardcore?: boolean
  activeCharacter: SupplyCharacter | null
  activeTransferHardcore?: boolean
  liveReady: boolean
  offset: number
  limit: number
}

export interface SupplySelectionItem {
  id: string
  record: string
  name: string
  slot: string
  isHardcore: boolean
  source: 'archive' | 'faction'
  eligible: boolean
}

export interface SupplyOption extends SupplySelectionItem {
  slotFamilies: Array<Exclude<SupplySlotFilter, 'all'>>
  reusable: boolean
  stackCount: number
  detail: string
  catalogItem: CollectionItem | null
  effects: string[]
  effectCount: number
}

export interface SupplyPage {
  items: SupplyOption[]
  total: number
  offset: number
  limit: number
  summary: CollectionRaritySummary
  accessSummary: string
}

export interface SupplySelection {
  items: SupplySelectionItem[]
  total: number
  limit: number
}
