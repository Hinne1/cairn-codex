import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import type { CollectionItem } from '../../../shared/contracts.ts'
import type { CompiledSearchQuery, SearchDocument } from '../../../shared/search-query.ts'
import { compileSearchQuery } from '../../../shared/search-query.ts'
import { searchQueryOptions, searchSchemas } from '../../../shared/search-schema.ts'
import { isAvailableViaAwakening } from '../../../shared/collection-availability.ts'
import type { AppRoute, RarityFilter, SetFeatureFilter, SetProgressFilter, SetSortMode, SortDirection } from '../app-route.ts'
import { compareSetCompletion, setCompletionCount, setItemDiscovered, setRollRating, type SetRollRating } from '../set-semantics.ts'

export interface CollectionSet {
  record: string
  name: string
  items: CollectionItem[]
  collected: number
  availableCopies: number
  minimumLevel: number
  maximumLevel: number
  rollRating: SetRollRating
}
export interface SetFilters {
  rarity: RarityFilter
  progress: SetProgressFilter
  feature: SetFeatureFilter
  sort: SetSortMode
  direction: SortDirection
}
export type SetsRouteControls = Extract<AppRoute, { workspace: 'sets' }>['controls']

export function buildCollectionSets(items: readonly CollectionItem[]): CollectionSet[] {
  const grouped = new Map<string, CollectionSet>()
  for (const item of items) {
    if (!item.setRecord || !item.setName) continue
    const existing = grouped.get(item.setRecord)
    if (existing) {
      existing.items.push(item)
      existing.collected += setItemDiscovered(item) ? 1 : 0
      existing.availableCopies += item.availableCount
      if (item.levelRequirement > 0) {
        existing.minimumLevel = existing.minimumLevel > 0
          ? Math.min(existing.minimumLevel, item.levelRequirement)
          : item.levelRequirement
        existing.maximumLevel = Math.max(existing.maximumLevel, item.levelRequirement)
      }
    } else {
      grouped.set(item.setRecord, {
        record: item.setRecord,
        name: item.setName,
        items: [item],
        collected: setItemDiscovered(item) ? 1 : 0,
        availableCopies: item.availableCount,
        minimumLevel: item.levelRequirement > 0 ? item.levelRequirement : 0,
        maximumLevel: item.levelRequirement > 0 ? item.levelRequirement : 0,
        rollRating: setRollRating([item])
      })
    }
  }
  for (const set of grouped.values()) {
    set.items.sort((left, right) => left.slot.localeCompare(right.slot) || left.name.localeCompare(right.name))
    set.collected = setCompletionCount(set.items)
    set.rollRating = setRollRating(set.items)
  }
  return [...grouped.values()]
}

export function filterCollectionSets(collectionSets: readonly CollectionSet[], controls: SetFilters, structuredQuery: CompiledSearchQuery, itemSearchDocument: (item: CollectionItem) => SearchDocument): CollectionSet[] {
  const sets = collectionSets
    .filter(
      (set) =>
        controls.rarity === 'all' || set.items.some((item) => item.rarity === controls.rarity)
    )
    .filter((set) => {
      if (controls.progress === 'complete') return set.collected === set.items.length
      if (controls.progress === 'progress') {
        return set.collected > 0 && set.collected < set.items.length
      }
      if (controls.progress === 'unstarted') return set.collected === 0
      return true
    })
    .filter((set) => controls.feature === 'all' || setHasVisualChanges(set))
    .filter((set) => {
      if (!structuredQuery.expression || structuredQuery.error) return structuredQuery.matches({ text: '' })
      return set.items.some((item) => structuredQuery.matches(setStructuredSearchDocument(item, set, itemSearchDocument)))
    })
  return sets.sort((left, right) => compareSets(left, right, controls.sort, controls.direction))
}

export function setCompletionPercent(set: CollectionSet): string {
  return ((set.collected / set.items.length) * 100).toFixed(1) + '%'
}

export function setReadyFromStorage(set: CollectionSet): boolean {
  return set.items.every((item) => item.availableCount > 0)
}

export function setReadyAfterCrafting(set: CollectionSet): boolean {
  return set.items.every((item) => item.availableCount > 0 || item.recipeUnlocked)
}

export function setReadyWithQualifiedAvailability(set: CollectionSet): boolean {
  return set.items.every((item) =>
    item.availableCount > 0 || item.recipeUnlocked || isAvailableViaAwakening(item)
  )
}

export function setLevelLabel(set: CollectionSet): string {
  if (set.maximumLevel <= 0) return 'No level requirement'
  if (set.minimumLevel === set.maximumLevel) return `Level ${set.minimumLevel}`
  return `Levels ${set.minimumLevel}–${set.maximumLevel}`
}

export function compareSets(left: CollectionSet, right: CollectionSet, sort: SetSortMode, direction: SortDirection): number {
  let comparison = 0
  if (sort === 'level') {
    comparison = left.minimumLevel - right.minimumLevel || left.maximumLevel - right.maximumLevel
  } else if (sort === 'completion') {
    comparison = compareSetCompletion(left.items, right.items)
  } else {
    comparison = left.name.localeCompare(right.name)
  }
  if (comparison === 0) comparison = left.name.localeCompare(right.name)
  return direction === 'asc' ? comparison : -comparison
}

export function setStructuredSearchDocument(item: CollectionItem, set: CollectionSet, itemSearchDocument: (item: CollectionItem) => SearchDocument): SearchDocument {
  const document = itemSearchDocument(item)
  const fx = (item.presentation?.sections ?? []).some((section) => section.kind === 'visual-modifier') ||
    (item.setPresentation?.tiers ?? []).some((tier) =>
      (tier.skillModifiers ?? []).some((section) => section.kind === 'visual-modifier')
    )
  return {
    text: document.text,
    fields: {
      ...document.fields,
      owned: setItemDiscovered(item),
      complete: set.collected === set.items.length,
      craftable: item.recipeUnlocked === true,
      awakening: isAvailableViaAwakening(item),
      fx
    }
  }
}

export function setMemberVisualChanges(set: CollectionSet) {
  return set.items.flatMap((item) =>
    (item.presentation?.sections ?? [])
      .filter((section) => section.kind === 'visual-modifier')
      .map((section) => ({ item, section }))
  )
}

export function setHasVisualChanges(set: CollectionSet): boolean {
  return setMemberVisualChanges(set).length > 0 ||
    (set.items[0]?.setPresentation?.tiers ?? []).some((tier) =>
      (tier.skillModifiers ?? []).some((section) => section.kind === 'visual-modifier')
    )
}

/** Retains controls and the debounced query across workspace unmounts. */
export function createSetsSession(options: {
  items: () => readonly CollectionItem[]
  itemSearchDocument: (item: CollectionItem) => SearchDocument
  restoringHistory: () => boolean
}) {
  const query = ref('')
  const searchQuery = ref('')
  const rarityFilter = ref<RarityFilter>('all')
  const setProgressFilter = ref<SetProgressFilter>('all')
  const setFeatureFilter = ref<SetFeatureFilter>('all')
  const setSortMode = ref<SetSortMode>('completion')
  const setSortDirection = ref<SortDirection>('desc')
  const currentPage = ref(1)
  let timer: ReturnType<typeof setTimeout> | null = null
  let restoring = false
  const isRestoring = () => restoring || options.restoringHistory()
  const setSearchQuery = computed(() => compileSearchQuery(searchQuery.value, searchQueryOptions(searchSchemas.sets)))
  const collectionSets = computed(() => buildCollectionSets(options.items()))
  const visibleSets = computed(() => filterCollectionSets(collectionSets.value, {
    rarity: rarityFilter.value, progress: setProgressFilter.value, feature: setFeatureFilter.value,
    sort: setSortMode.value, direction: setSortDirection.value
  }, setSearchQuery.value, options.itemSearchDocument))
  const routeControls = computed<SetsRouteControls>(() => ({
    query: query.value, progress: setProgressFilter.value, feature: setFeatureFilter.value,
    sort: setSortMode.value, direction: setSortDirection.value, page: currentPage.value
  }))
  watch([query, rarityFilter, setProgressFilter, setFeatureFilter, setSortMode, setSortDirection], () => {
    if (!isRestoring()) currentPage.value = 1
  })
  watch(query, value => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { searchQuery.value = value; timer = null }, 120)
  })
  watch(setSortMode, mode => {
    if (!isRestoring()) setSortDirection.value = mode === 'completion' ? 'desc' : 'asc'
  })
  function restoreRoute(controls: SetsRouteControls): void {
    restoring = true
    if (timer) clearTimeout(timer)
    timer = null
    query.value = controls.query
    searchQuery.value = controls.query
    setProgressFilter.value = controls.progress
    setFeatureFilter.value = controls.feature
    setSortMode.value = controls.sort
    setSortDirection.value = controls.direction
    currentPage.value = controls.page
    void nextTick(() => { restoring = false })
  }
  onScopeDispose(() => { if (timer) clearTimeout(timer) })
  return { query, rarityFilter, setProgressFilter, setFeatureFilter, setSortMode, setSortDirection,
    currentPage, setSearchQuery, collectionSets, visibleSets, routeControls, restoreRoute }
}
export type SetsSession = ReturnType<typeof createSetsSession>
