import { computed, type ComputedRef, type Ref } from 'vue'
import type { CollectionItem, ObservedStashItem, RollCategoryScore } from '@shared/contracts'
import type { CompiledSearchQuery, SearchDocument } from '@shared/search-query'
import { isCollectionOwned } from '../../../shared/collection-availability.ts'
import type { AppRoute, CollectionRollFocus, RollSortMode, SortMode } from '../app-route'
import { rollCategoryScores } from '../roll-rating.ts'

export type CollectionControls = Extract<AppRoute, { workspace: 'collection' }>['controls']
export type MaterialsControls = Extract<AppRoute, { workspace: 'materials' }>['controls']
export type CollectionMaterialsControls = CollectionControls | MaterialsControls

export const collectionCategories = [
  'All', 'Head', 'Chest', 'Shoulders', 'Hands', 'Legs', 'Feet', 'Waist',
  'Weapons', 'Offhands', 'Jewelry', 'Relics'
] as const

export const collectionRollSortOptions: ReadonlyArray<{ value: RollSortMode, label: string }> = [
  { value: 'roll-offense', label: 'Offense · strongest type' },
  { value: 'roll-physical', label: 'Offense · Physical' },
  { value: 'roll-pierce', label: 'Offense · Pierce' },
  { value: 'roll-bleeding', label: 'Offense · Bleeding' },
  { value: 'roll-fire', label: 'Offense · Fire' },
  { value: 'roll-cold', label: 'Offense · Cold' },
  { value: 'roll-lightning', label: 'Offense · Lightning' },
  { value: 'roll-acid', label: 'Offense · Acid' },
  { value: 'roll-vitality', label: 'Offense · Vitality' },
  { value: 'roll-aether', label: 'Offense · Aether' },
  { value: 'roll-chaos', label: 'Offense · Chaos' },
  { value: 'roll-elemental', label: 'Offense · Elemental' },
  { value: 'roll-retaliation', label: 'Retaliation' },
  { value: 'roll-defense', label: 'Defense' },
  { value: 'roll-utility', label: 'Utility' },
  { value: 'roll-pet', label: 'Pet' }
]

export interface CollectionRollSummary {
  score: RollCategoryScore
  copy: ObservedStashItem
}

export type CollectionRollSummaries = ReadonlyMap<string, CollectionRollSummary>

export interface CollectionMaterialsProjectionOptions {
  mode: 'collection' | 'materials'
  query: Pick<CompiledSearchQuery, 'matches'>
  doubleRareMiBaseRecords?: ReadonlySet<string>
  favoriteRecords?: ReadonlySet<string>
  searchDocument: (item: CollectionItem) => SearchDocument
  rollSummaries?: CollectionRollSummaries
}

export interface CollectionMaterialsQueryDebouncer {
  update: (value: string) => void
  cancel: () => void
}

export function createCollectionMaterialsQueryDebouncer(
  commit: (value: string) => void,
  delayMs = 120
): CollectionMaterialsQueryDebouncer {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    update(value) {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        commit(value)
      }, delayMs)
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
}

export function updateCollectionMaterialsControls<T extends CollectionMaterialsControls>(
  controls: T,
  patch: Partial<T>,
  resetPage = true
): T {
  return { ...controls, ...patch, ...(resetPage ? { page: 1 } : {}) }
}

export function createCollectionMaterialsProjectionControls(
  controls: Ref<CollectionMaterialsControls>,
  projectedQuery: Ref<string>
): ComputedRef<CollectionMaterialsControls> {
  // Route snapshots are replaced for every raw query edit and page change. Depend on one
  // primitive computed per expensive projection input so those replacements do not invalidate
  // the catalog traversal until the debouncer commits the query (or a real filter changes).
  const category = computed(() => controls.value.category)
  const ownership = computed(() => controls.value.ownership)
  const rarity = computed(() => controls.value.rarity)
  const sort = computed(() => controls.value.sort)
  const direction = computed(() => controls.value.direction)
  return computed(() => ({
    category: category.value,
    query: projectedQuery.value,
    ownership: ownership.value,
    rarity: rarity.value,
    sort: sort.value,
    direction: direction.value,
    page: 1
  }) as CollectionMaterialsControls)
}

export function matchesCollectionCategory(item: CollectionItem, category: string): boolean {
  const slots: Record<string, readonly string[]> = {
    Head: ['head'], Chest: ['chest'], Shoulders: ['shoulders'], Hands: ['hands'],
    Legs: ['legs'], Feet: ['feet'], Waist: ['waist'], Weapons: ['weapon'],
    Offhands: ['offhand', 'shield'], Jewelry: ['ring', 'amulet', 'medal'], Relics: ['relic']
  }
  return category === 'All' || Boolean(slots[category]?.includes(item.slot))
}

export function collectionRollFocusForSort(sort: SortMode): CollectionRollFocus | null {
  return sort.startsWith('roll-') ? sort.slice('roll-'.length) as CollectionRollFocus : null
}

export function buildCollectionRollSummaries(
  copies: readonly ObservedStashItem[],
  focus: CollectionRollFocus | null
): Map<string, CollectionRollSummary> {
  const summaries = new Map<string, CollectionRollSummary>()
  for (const copy of copies) {
    if (!copy.rollAnalysis?.trusted) continue
    for (const score of rollCategoryScores(copy.rollAnalysis)) {
      if (!matchesRollFocus(score, focus)) continue
      const key = copy.baseRecord.toLocaleLowerCase()
      const current = summaries.get(key)
      if (!current || compareCategoryScores(score, current.score) > 0) {
        summaries.set(key, { score, copy })
      }
    }
  }
  return summaries
}

function matchesRollFocus(score: RollCategoryScore, focus: CollectionRollFocus | null): boolean {
  if (focus === null) return true
  if (focus === 'offense') return score.category === 'offense'
  if (focus === 'retaliation' || focus === 'defense' || focus === 'utility' || focus === 'pet') {
    return score.category === focus
  }
  return score.category === 'offense' && score.damageType === focus
}

function compareCategoryScores(left: RollCategoryScore, right: RollCategoryScore): number {
  return (left.qualityPercent ?? -1) - (right.qualityPercent ?? -1) ||
    (left.combinationPercentile ?? -1) - (right.combinationPercentile ?? -1)
}

export function createCollectionMaterialsRows(
  items: readonly CollectionItem[],
  controls: CollectionMaterialsControls,
  options: CollectionMaterialsProjectionOptions
): CollectionItem[] {
  const rows = items
    .filter((item) => options.mode === 'materials' || matchesCollectionCategory(item, controls.category))
    .filter((item) => options.mode !== 'materials' || controls.category === 'all' ||
      (controls.category === 'component' ? item.rarity === 'component' : item.slot === controls.category))
    .filter((item) => options.mode === 'materials' || controls.rarity === 'all' ||
      (controls.rarity === 'recipe'
        ? Boolean(item.acquisition?.crafting)
        : controls.rarity === 'double-rare'
          ? item.rarity === 'mi' && Boolean(options.doubleRareMiBaseRecords?.has(item.record.toLocaleLowerCase()))
          : item.rarity === controls.rarity))
    .filter((item) => controls.ownership === 'all' ||
      (controls.ownership === 'favorite' ? Boolean(options.favoriteRecords?.has(item.record.toLocaleLowerCase())) :
        controls.ownership === 'owned' ? isCollectionOwned(item) : !isCollectionOwned(item)))
    .filter((item) => options.query.matches(options.searchDocument(item)))

  return rows.sort((left, right) => compareCollectionItems(left, right, controls, options.rollSummaries))
}

export function compareCollectionItems(
  left: CollectionItem,
  right: CollectionItem,
  controls: Pick<CollectionMaterialsControls, 'sort' | 'direction'>,
  rollSummaries?: CollectionRollSummaries
): number {
  let comparison = 0
  if (controls.sort === 'level') comparison = left.levelRequirement - right.levelRequirement
  else if (controls.sort === 'completion') {
    comparison = Number(isCollectionOwned(left)) - Number(isCollectionOwned(right))
    if (comparison === 0) comparison = left.availableCount - right.availableCount
  } else if (controls.sort === 'recent') {
    comparison = (left.firstDiscoveredAt ? Date.parse(left.firstDiscoveredAt) : 0) -
      (right.firstDiscoveredAt ? Date.parse(right.firstDiscoveredAt) : 0)
  } else if (controls.sort.startsWith('roll-')) {
    const leftScore = rollSummaries?.get(left.record.toLocaleLowerCase())?.score
    const rightScore = rollSummaries?.get(right.record.toLocaleLowerCase())?.score
    // Availability is not a numeric roll: keep unrated items last in either direction.
    if (Boolean(leftScore) !== Boolean(rightScore)) return leftScore ? -1 : 1
    if (!leftScore && !rightScore) {
      return Number(isCollectionOwned(right)) - Number(isCollectionOwned(left)) || left.name.localeCompare(right.name)
    }
    comparison = (leftScore?.qualityPercent ?? -1) - (rightScore?.qualityPercent ?? -1)
    if (comparison === 0) {
      comparison = (leftScore?.combinationPercentile ?? -1) - (rightScore?.combinationPercentile ?? -1)
    }
    if (comparison === 0) {
      comparison = Number(isCollectionOwned(left)) - Number(isCollectionOwned(right))
    }
  } else comparison = left.name.localeCompare(right.name)
  if (comparison === 0) comparison = left.name.localeCompare(right.name)
  return controls.direction === 'asc' ? comparison : -comparison
}
