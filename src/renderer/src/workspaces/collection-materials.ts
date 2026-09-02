import { computed, type ComputedRef, type Ref } from 'vue'
import type { CollectionItem } from '@shared/contracts'
import type { CompiledSearchQuery, SearchDocument } from '@shared/search-query'
import { isCollectionOwned } from '../../../shared/collection-availability.ts'
import type { AppRoute } from '../app-route'

export type CollectionControls = Extract<AppRoute, { workspace: 'collection' }>['controls']
export type MaterialsControls = Extract<AppRoute, { workspace: 'materials' }>['controls']
export type CollectionMaterialsControls = CollectionControls | MaterialsControls

export const collectionCategories = [
  'All', 'Head', 'Chest', 'Shoulders', 'Hands', 'Legs', 'Feet', 'Waist',
  'Weapons', 'Offhands', 'Jewelry', 'Relics'
] as const

export interface CollectionMaterialsProjectionOptions {
  mode: 'collection' | 'materials'
  query: Pick<CompiledSearchQuery, 'matches'>
  doubleRareMiBaseRecords?: ReadonlySet<string>
  searchDocument: (item: CollectionItem) => SearchDocument
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
      (controls.ownership === 'owned' ? isCollectionOwned(item) : !isCollectionOwned(item)))
    .filter((item) => options.query.matches(options.searchDocument(item)))

  return rows.sort((left, right) => compareCollectionItems(left, right, controls))
}

export function compareCollectionItems(
  left: CollectionItem,
  right: CollectionItem,
  controls: Pick<CollectionMaterialsControls, 'sort' | 'direction'>
): number {
  let comparison = 0
  if (controls.sort === 'level') comparison = left.levelRequirement - right.levelRequirement
  else if (controls.sort === 'completion') {
    comparison = Number(isCollectionOwned(left)) - Number(isCollectionOwned(right))
    if (comparison === 0) comparison = left.availableCount - right.availableCount
  } else if (controls.sort === 'recent') {
    comparison = (left.firstDiscoveredAt ? Date.parse(left.firstDiscoveredAt) : 0) -
      (right.firstDiscoveredAt ? Date.parse(right.firstDiscoveredAt) : 0)
  } else if (controls.sort === 'roll') {
    comparison = (left.bestRollPercentile ?? -1) - (right.bestRollPercentile ?? -1)
  } else comparison = left.name.localeCompare(right.name)
  if (comparison === 0) comparison = left.name.localeCompare(right.name)
  return controls.direction === 'asc' ? comparison : -comparison
}
