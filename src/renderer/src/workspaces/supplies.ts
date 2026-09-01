import { ref, type Ref } from 'vue'
import type {
  CharacterSaveProfile,
  CollectionItem,
  CollectionRaritySummary,
  ItemPresentationLine,
  VaultListItem
} from '@shared/contracts'
import type { CompiledSearchQuery, SearchDocument } from '@shared/search-query'
import type { AppRoute, SupplyCategory, SupplySlotFilter } from '../app-route'

export type SupplyControls = Extract<AppRoute, { workspace: 'supplies' }>['controls']

export interface SupplyOption {
  id: string
  record: string
  name: string
  slot: string
  slotFamilies: Array<Exclude<SupplySlotFilter, 'all'>>
  isHardcore: boolean
  reusable: boolean
  stackCount: number
  eligible: boolean
  detail: string
  source: 'archive' | 'faction'
  catalogItem: CollectionItem | null
  effects: string[]
  effectCount: number
}

export interface SupplySession {
  selectedIds: Ref<string[]>
}

export interface SupplyViewOptions {
  catalogItems: readonly CollectionItem[]
  vaultItems: readonly VaultListItem[]
  controls: SupplyControls
  activeCharacter: CharacterSaveProfile | null
  activeTransferHardcore: boolean | undefined
  liveReady: boolean
  query: Pick<CompiledSearchQuery, 'matches'>
  catalogIndex?: SupplyCatalogIndex
}

export interface SupplyPresentationIndexEntry {
  item: CollectionItem
  effects: string[]
  searchText: string
}

export type SupplyCatalogIndex = ReadonlyMap<string, SupplyPresentationIndexEntry>

export function createSupplySession(): SupplySession {
  return { selectedIds: ref<string[]>([]) }
}

export function updateSupplyControls(
  controls: SupplyControls,
  patch: Partial<SupplyControls>,
  resetPage: boolean
): SupplyControls {
  return { ...controls, ...patch, ...(resetPage ? { page: 1 } : {}) }
}

export function changeSupplyCategory(
  controls: SupplyControls,
  category: SupplyCategory
): SupplyControls {
  return updateSupplyControls(controls, { category, slot: 'all' }, true)
}

export function buildReusableSupplySummary(
  catalogItems: readonly CollectionItem[],
  vaultItems: readonly VaultListItem[]
): CollectionRaritySummary {
  const catalogRecords = new Set(
    catalogItems
      .filter((item) => isReusableUnlockSlot(item.slot))
      .map((item) => item.record.toLocaleLowerCase())
  )
  const unique = new Map<string, VaultListItem>()
  for (const item of vaultItems) {
    if (item.rarity !== 'supply' || item.state !== 'ingested' || !isReusableUnlockSlot(item.slot)) continue
    const key = item.baseRecord.toLocaleLowerCase()
    if (!unique.has(key)) unique.set(key, item)
  }
  const unlocks = [...unique.values()]
  return {
    rarity: 'supply',
    total: catalogRecords.size,
    collected: unlocks.filter((item) => catalogRecords.has(item.baseRecord.toLocaleLowerCase())).length,
    availableCopies: unlocks.length
  }
}

export function createSupplyAccessSummary(
  catalogItems: readonly CollectionItem[],
  activeCharacter: CharacterSaveProfile | null
): string {
  const augmentItems = catalogItems.filter((item) => item.slot === 'augment')
  const reputation = activeCharacter ? characterReputation(activeCharacter) : null
  const eligible = activeCharacter
    ? augmentItems.filter((item) => item.acquisition?.factions?.some((requirement) =>
      requirement.kind !== 'blueprint' && characterMeetsReputation(reputation!, requirement.faction, requirement.reputation)
    )).length
    : 0
  return activeCharacter
    ? `${eligible} augments available to ${activeCharacter.name}`
    : `${augmentItems.length} augments indexed · connect a character to check access`
}

export function createSupplyOptions(options: SupplyViewOptions): SupplyOption[] {
  const presentationByRecord = options.catalogIndex ?? buildSupplyCatalogIndex(options.catalogItems)
  const reputation = options.activeCharacter ? characterReputation(options.activeCharacter) : null
  if (options.controls.category === 'augments') {
    const factionAugments = [...presentationByRecord.values()]
      .filter(({ item }) => item.slot === 'augment')
      .map(({ item, effects, searchText }): SupplyOption & { searchText: string } => {
        const requirements = item.acquisition?.factions ?? []
        const eligible = Boolean(options.activeCharacter && requirements.some((requirement) =>
          requirement.kind !== 'blueprint' && characterMeetsReputation(
            reputation!,
            requirement.faction,
            requirement.reputation
          )
        ))
        return {
          id: `augment:${item.record}`,
          record: item.record,
          name: item.name,
          slot: item.slot,
          slotFamilies: item.supplySlotFamilies ?? [],
          isHardcore: options.activeCharacter?.isHardcore ?? Boolean(options.activeTransferHardcore),
          reusable: true,
          stackCount: 1,
          eligible,
          detail: eligible
            ? `Available to ${options.activeCharacter?.name ?? 'active character'} · ${requirements.map((entry) => `${entry.faction} ${entry.reputation}`).join(' / ')}`
            : !options.activeCharacter && options.liveReady
              ? 'Waiting for active character save metadata · rechecking automatically'
              : requirements.length
                ? `Requires ${requirements.map((entry) => `${entry.faction} ${entry.reputation}`).join(' or ')}`
                : 'Faction requirement is not indexed',
          source: 'faction',
          catalogItem: item,
          effects: effects.slice(0, 5),
          effectCount: effects.length,
          searchText
        }
      })
    const archivedRunes = options.vaultItems
      .filter((item) => item.rarity === 'supply' && item.slot === 'rune' && item.state === 'ingested')
      .map((item): SupplyOption => archiveSupplyOption(item, presentationByRecord, options.activeTransferHardcore, 'movement rune', false))
    return [...factionAugments, ...archivedRunes]
      .filter((item) => options.controls.slot === 'all' || item.slotFamilies.includes(options.controls.slot))
      .filter((item) => options.query.matches(supplySearchDocument(item)))
      .sort((left, right) => Number(right.eligible) - Number(left.eligible) || left.name.localeCompare(right.name))
  }

  const unique = new Map<string, VaultListItem>()
  for (const item of options.vaultItems) {
    if (item.rarity !== 'supply' || item.state !== 'ingested') continue
    const key = item.slot === 'potion'
      ? `${item.isHardcore ? 'hc' : 'sc'}:potion:${item.id}`
      : `${item.isHardcore ? 'hc' : 'sc'}:${item.baseRecord.toLocaleLowerCase()}`
    if (!unique.has(key)) unique.set(key, item)
  }
  return [...unique.values()]
    .filter((item) => ['writ', 'mandate', 'warrant', 'merit', 'potion'].includes(item.slot))
    .filter((item) => {
      const presentation = presentationByRecord.get(item.baseRecord.toLocaleLowerCase())
      return options.query.matches({
        text: [item.name, item.slot, presentation?.searchText, item.isHardcore ? 'hardcore' : 'softcore'].filter(Boolean).join(' '),
        fields: {
          name: item.name,
          category: item.slot,
          effect: presentation?.effects ?? [],
          faction: presentation?.item.acquisition?.factions?.flatMap((entry) => [entry.faction, entry.reputation]) ?? [],
          slot: presentation?.item.supplySlotFamilies ?? [],
          source: 'archive',
          mode: item.isHardcore ? 'hardcore' : 'softcore',
          eligible: options.activeTransferHardcore !== undefined && item.isHardcore === options.activeTransferHardcore
        }
      })
    })
    .sort((left, right) => left.slot.localeCompare(right.slot) || left.name.localeCompare(right.name))
    .map((item) => archiveSupplyOption(item, presentationByRecord, options.activeTransferHardcore, item.slot, true))
}

export function supplySearchDocument(item: SupplyOption): SearchDocument {
  const factions = item.catalogItem?.acquisition?.factions?.flatMap((entry) => [entry.faction, entry.reputation]) ?? []
  return {
    text: [item.name, item.detail, item.slot, item.source, ...item.slotFamilies, ...item.effects, ...factions].join(' '),
    fields: {
      name: item.name,
      category: item.slot,
      effect: item.effects,
      faction: factions,
      slot: item.slotFamilies,
      source: item.source,
      mode: item.isHardcore ? 'hardcore' : 'softcore',
      eligible: item.eligible
    }
  }
}

function archiveSupplyOption(
  item: VaultListItem,
  presentationByRecord: ReadonlyMap<string, SupplyPresentationIndexEntry>,
  activeTransferHardcore: boolean | undefined,
  description: string,
  includeStack: boolean
): SupplyOption {
  const eligible = activeTransferHardcore !== undefined && item.isHardcore === activeTransferHardcore
  const presentation = presentationByRecord.get(item.baseRecord.toLocaleLowerCase())
  const catalogItem = presentation?.item ?? null
  const effects = presentation?.effects ?? []
  return {
    id: item.id,
    record: item.baseRecord,
    name: item.name,
    slot: item.slot,
    slotFamilies: catalogItem?.supplySlotFamilies ?? [],
    isHardcore: item.isHardcore,
    reusable: item.reusable,
    stackCount: item.stackCount,
    eligible,
    detail: `${item.isHardcore ? 'HC' : 'SC'} · ${includeStack ? `${item.stackCount} stored · ` : ''}archived ${description}${eligible ? '' : ' · select a matching character or stash'}`,
    source: 'archive',
    catalogItem,
    effects: effects.slice(0, 5),
    effectCount: effects.length
  }
}

export function buildSupplyCatalogIndex(catalogItems: readonly CollectionItem[]): Map<string, SupplyPresentationIndexEntry> {
  const index = new Map<string, SupplyPresentationIndexEntry>()
  for (const item of catalogItems) {
    const effects = supplyEffectLines(item)
    const requirements = (item.acquisition?.factions ?? [])
      .flatMap((requirement) => [requirement.faction, requirement.reputation])
    const searchText = [
      item.name,
      item.record,
      item.slot,
      ...(item.supplySlotFamilies ?? []),
      ...requirements,
      ...effects
    ].join(' ').toLocaleLowerCase()
    index.set(item.record.toLocaleLowerCase(), { item, effects, searchText })
  }
  return index
}

function supplyEffectLines(item: CollectionItem): string[] {
  const flavor = item.presentation?.flavorText ? [item.presentation.flavorText] : []
  const direct = (item.presentation?.sections ?? [])
    .flatMap((section) => section.lines.map((line) => {
      const formatted = formatPresentationLine(line)
      return section.kind === 'pet' ? `Pets · ${formatted}` : formatted
    }))
  const granted = item.presentation?.grantedSkill
  if (!granted) return [...flavor, ...direct]
  return [
    ...flavor,
    ...direct,
    `Grants ${granted.name}${granted.trigger ? ` (${granted.trigger})` : ''}`,
    ...granted.lines.map(formatPresentationLine)
  ]
}

function formatPresentationLine(line: ItemPresentationLine): string {
  const minimum = line.minimum === null ? '' : formatRollValue(line.minimum)
  const maximum = line.maximum === null ? '' : formatRollValue(line.maximum)
  const range = maximum ? `${minimum}${line.unit} - ${maximum}${line.unit}` : `${minimum}${line.unit}`
  return `${line.prefix}${range}${range ? ' ' : ''}${line.label}${line.suffix}`
}

function formatRollValue(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1)
}

function isReusableUnlockSlot(slot: string): boolean {
  return ['writ', 'mandate', 'warrant', 'merit', 'rune'].includes(slot)
}

function characterMeetsReputation(
  reputationByFaction: ReadonlyMap<string, CharacterSaveProfile['factions'][number]>,
  factionName: string,
  requiredRank: string
): boolean {
  const thresholds: Record<string, number> = {
    tolerated: 0,
    friendly: 1_500,
    respected: 5_000,
    honored: 10_000,
    revered: 25_000
  }
  const threshold = thresholds[requiredRank.toLocaleLowerCase()]
  if (threshold === undefined) return false
  const reputation = reputationByFaction.get(normalizeFactionName(factionName))
  return Boolean(reputation?.isUnlocked && reputation.value >= threshold)
}

function characterReputation(character: CharacterSaveProfile): Map<string, CharacterSaveProfile['factions'][number]> {
  return new Map((character.factions ?? []).map((faction) => [normalizeFactionName(faction.name), faction]))
}

function normalizeFactionName(value: string): string {
  return value.toLocaleLowerCase().replaceAll('’', "'").replace(/[^a-z0-9]/g, '')
}
