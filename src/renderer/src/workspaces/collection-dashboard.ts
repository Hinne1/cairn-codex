import { computed } from 'vue'
import type { CollectionItem, CollectionRaritySummary, CollectionSnapshot } from '../../../shared/contracts.ts'
import { isCollectionOwned, isAvailableViaAwakening } from '../../../shared/collection-availability.ts'
import { collectionCategories, matchesCollectionCategory } from './collection-materials.ts'
import { miFamilyKey } from './mi-workshop.ts'
import type { MiCountingMode } from './settings.ts'
import { setItemDiscovered } from '../set-semantics.ts'
import { setReadyFromStorage, setReadyAfterCrafting, setReadyWithQualifiedAvailability, type CollectionSet } from './sets.ts'

export interface RollTrackerSummary {
  median: number | null
  scored: number
}

export interface CollectionTriviaFact {
  id: string
  eyebrow: string
  value: string
  title: string
  detail: string
  tone: 'gold' | 'purple' | 'blue' | 'green' | 'ember'
  itemRecord?: string
}
export type CollectionDashboardData = Pick<CollectionSnapshot,
  'items' | 'materials' | 'affixes' | 'observedItems' | 'rarities' | 'affixSummary' | 'recipeSummary'>

export function medianSummary(values: Array<number | null | undefined>): RollTrackerSummary {
  const scored = values
    .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value))
    .sort((left, right) => left - right)
  if (scored.length === 0) return { median: null, scored: 0 }
  const middle = Math.floor(scored.length / 2)
  return {
    median: scored.length % 2 === 0
      ? (scored[middle - 1]! + scored[middle]!) / 2
      : scored[middle]!,
    scored: scored.length
  }
}

export function percentage(summary: Pick<CollectionRaritySummary, 'total' | 'collected'> | undefined): string {
  if (!summary || summary.total === 0) return '0%'
  return ((summary.collected / summary.total) * 100).toFixed(1) + '%'
}

function formatTriviaDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  })
}
function triviaSlotLabel(slot: string): string {
  const labels: Record<string, string> = {
    head: 'Headgear', chest: 'Chest armor', shoulders: 'Shoulders', hands: 'Gloves',
    legs: 'Leg armor', feet: 'Boots', waist: 'Belts', weapon: 'Weapons', offhand: 'Offhands',
    shield: 'Shields', ring: 'Rings', amulet: 'Amulets', medal: 'Medals', relic: 'Relics'
  }
  return labels[slot] ?? slot.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function createCollectionDashboard(options: {
  snapshot: () => CollectionDashboardData | null
  miCountingMode: () => MiCountingMode
  sets: () => readonly CollectionSet[]
}) {
  const snapshot = computed(options.snapshot)
  const miCountingMode = computed(options.miCountingMode)
  const collectionSets = computed(options.sets)
  const categories = collectionCategories
  function rarity(name: 'epic' | 'legendary' | 'mi'): CollectionRaritySummary | undefined {
    if (!snapshot.value) return undefined
    if (name !== 'mi' || miCountingMode.value === 'tier') {
      return snapshot.value.rarities.find((summary) => summary.rarity === name)
    }
    const families = new Map<string, CollectionItem[]>()
    for (const item of snapshot.value.items.filter((candidate) => candidate.rarity === 'mi')) {
      const key = miFamilyKey(item)
      const family = families.get(key)
      if (family) family.push(item)
      else families.set(key, [item])
    }
    return {
      rarity: 'mi',
      total: families.size,
      collected: [...families.values()].filter((family) => family.some(isCollectionOwned)).length,
      availableCopies: [...families.values()].reduce(
        (count, family) => count + family.reduce((sum, item) => sum + item.availableCount, 0),
        0
      )
    }
  }

  function itemRollSummary(rarity?: 'epic' | 'legendary' | 'mi'): RollTrackerSummary {
    const items = (snapshot.value?.items ?? []).filter((item) =>
      ['epic', 'legendary', 'mi'].includes(item.rarity) && (!rarity || item.rarity === rarity)
    )
    if (miCountingMode.value === 'base' && (rarity === 'mi' || rarity === undefined)) {
      const ordinary = items
        .filter((item) => item.rarity !== 'mi')
        .map((item) => item.bestRollPercentile)
      const bestMiByBase = new Map<string, number>()
      for (const item of items.filter((candidate) => candidate.rarity === 'mi')) {
        if (item.bestRollPercentile === null) continue
        const key = miFamilyKey(item)
        bestMiByBase.set(key, Math.max(bestMiByBase.get(key) ?? -1, item.bestRollPercentile))
      }
      return medianSummary([...ordinary, ...bestMiByBase.values()])
    }
    return medianSummary(items.map((item) => item.bestRollPercentile))
  }

  function itemAvailableByAwakeningOnly(item: CollectionItem): boolean {
    return item.availableCount === 0 && isAvailableViaAwakening(item)
  }

  function affixPercentage(): string {
    const summary = snapshot.value?.affixSummary
    if (!summary || summary.total === 0) return '0%'
    return ((summary.collected / summary.total) * 100).toFixed(1) + '%'
  }

  function recipePercentage(): string {
    const summary = snapshot.value?.recipeSummary
    if (!summary || summary.total === 0) return '0%'
    return ((summary.collected / summary.total) * 100).toFixed(1) + '%'
  }

  const allItemSummary = computed(() => {
    const summaries = ['epic', 'legendary', 'mi']
      .map((name) => rarity(name as 'epic' | 'legendary' | 'mi'))
      .filter((value): value is CollectionRaritySummary => Boolean(value))
    return {
      total: summaries.reduce((sum, value) => sum + value.total, 0),
      collected: summaries.reduce((sum, value) => sum + value.collected, 0),
      availableCopies: summaries.reduce((sum, value) => sum + value.availableCopies, 0)
    }
  })

  const allItemRollSummary = computed(() => itemRollSummary())

  const legendaryRollSummary = computed(() => itemRollSummary('legendary'))

  const epicRollSummary = computed(() => itemRollSummary('epic'))

  const miRollSummary = computed(() => itemRollSummary('mi'))

  const awakeningAvailableLegendaryCount = computed(() =>
    (snapshot.value?.items ?? []).filter((item) =>
      item.rarity === 'legendary' && itemAvailableByAwakeningOnly(item)
    ).length
  )

  const setRollSummary = computed(() => medianSummary(
    collectionSets.value.flatMap((set) => set.items.map((item) => item.bestRollPercentile))
  ))

  const affixRollSummary = computed(() => {
    const recordKeys = new Map<string, string>()
    for (const affix of snapshot.value?.affixes ?? []) {
      for (const record of affix.records) recordKeys.set(record.toLocaleLowerCase(), affix.key)
    }
    const best = new Map<string, number>()
    for (const copy of snapshot.value?.observedItems ?? []) {
      for (const [record, score] of [
        [copy.prefixRecord, copy.rollAnalysis?.prefixEstimatedPercentile],
        [copy.suffixRecord, copy.rollAnalysis?.suffixEstimatedPercentile]
      ] as const) {
        if (!record || score === null || score === undefined) continue
        const key = recordKeys.get(record.toLocaleLowerCase())
        if (!key) continue
        best.set(key, Math.max(best.get(key) ?? -1, score))
      }
    }
    return medianSummary([...best.values()])
  })

  const setSummary = computed(() => ({
    total: collectionSets.value.length,
    collected: collectionSets.value.filter((set) => set.collected === set.items.length).length,
    readyFromStorage: collectionSets.value.filter(setReadyFromStorage).length,
    readyAfterCrafting: collectionSets.value.filter(setReadyAfterCrafting).length,
    readyWithQualifiedAvailability: collectionSets.value.filter(setReadyWithQualifiedAvailability).length
  }))

  const componentSummary = computed<CollectionRaritySummary>(() => {
    const items = (snapshot.value?.materials ?? []).filter((item) => item.rarity === 'component')
    return {
      rarity: 'component',
      total: items.length,
      collected: items.filter((item) => item.discovered).length,
      availableCopies: items.reduce((count, item) => count + item.availableCount, 0)
    }
  })

  const consumableSummary = computed<CollectionRaritySummary>(() => {
    const items = (snapshot.value?.materials ?? []).filter((item) => item.rarity === 'consumable')
    return {
      rarity: 'consumable',
      total: items.length,
      collected: items.filter((item) => item.discovered).length,
      availableCopies: items.reduce((count, item) => count + item.availableCount, 0)
    }
  })

  const categoryProgressByName = computed(() => {
    const progress = new Map<string, string>()
    if (!snapshot.value) {
      for (const category of categories) progress.set(category, '0 / 0')
      return progress
    }
    const entriesByCategory = new Map(categories.map((category) => [category, new Map<string, boolean>()]))
    for (const item of snapshot.value.items) {
      const key = item.rarity === 'mi' && miCountingMode.value === 'base'
        ? `mi:${miFamilyKey(item)}`
        : `item:${item.record.toLocaleLowerCase()}`
      const owned = isCollectionOwned(item)
      for (const category of categories) {
        if (!matchesCollectionCategory(item, category)) continue
        const entries = entriesByCategory.get(category)!
        entries.set(key, Boolean(entries.get(key) || owned))
      }
    }
    for (const category of categories) {
      const entries = entriesByCategory.get(category)!
      let collected = 0
      for (const owned of entries.values()) if (owned) collected += 1
      progress.set(category, `${collected} / ${entries.size}`)
    }
    return progress
  })

  const collectionTrivia = computed<CollectionTriviaFact[]>(() => {
    if (!snapshot.value) return []
    const facts: CollectionTriviaFact[] = []
    const items = snapshot.value.items
    const physicallyOwned = items.filter((item) => item.availableCount > 0)
    const scored = physicallyOwned
      .filter((item) => item.bestRollPercentile !== null)
      .sort((left, right) => right.bestRollPercentile! - left.bestRollPercentile!)
    const byCopies = (left: CollectionItem, right: CollectionItem) =>
      right.availableCount - left.availableCount || left.name.localeCompare(right.name)

    const legendaryHoard = physicallyOwned
      .filter((item) => item.rarity === 'legendary')
      .sort(byCopies)[0]
    if (legendaryHoard) {
      facts.push({
        id: 'legendary-hoard', eyebrow: 'Purple pile', value: `${legendaryHoard.availableCount}×`,
        title: legendaryHoard.name, detail: 'Your most-copied Legendary item.', tone: 'purple',
        itemRecord: legendaryHoard.record
      })
    }

    const copyChampion = [...physicallyOwned].sort(byCopies)[0]
    if (copyChampion) {
      facts.push({
        id: 'copy-champion', eyebrow: 'Duplicate dynasty', value: `${copyChampion.availableCount}×`,
        title: copyChampion.name,
        detail: `${Math.max(0, copyChampion.availableCount - 1)} copies beyond the first. CC respects the commitment.`,
        tone: copyChampion.rarity === 'epic' ? 'blue' : copyChampion.rarity === 'mi' ? 'green' : 'gold',
        itemRecord: copyChampion.record
      })
    }

    const bestRoll = scored[0]
    if (bestRoll) {
      facts.push({
        id: 'best-roll', eyebrow: 'Roll royalty', value: `${bestRoll.bestRollPercentile!.toFixed(1)}%`,
        title: bestRoll.name,
        detail: `Best estimated aggregate roll among ${scored.length.toLocaleString()} scored item bases.`,
        tone: 'gold', itemRecord: bestRoll.record
      })
    }

    if (scored.length) {
      const nearPerfect = scored.filter((item) => item.bestRollPercentile! >= 95).length
      const excellent = scored.filter((item) => item.bestRollPercentile! >= 90).length
      facts.push({
        id: 'near-perfect', eyebrow: 'Top shelf', value: excellent.toLocaleString(),
        title: '90th-percentile rolls',
        detail: `${nearPerfect.toLocaleString()} item bases clear the 95th percentile.`, tone: 'gold'
      })
    }

    const completeSets = collectionSets.value
      .filter((set) => set.collected === set.items.length)
      .sort((left, right) => right.items.length - left.items.length || left.name.localeCompare(right.name))
    if (completeSets[0]) {
      facts.push({
        id: 'largest-complete-set', eyebrow: 'Set archivist',
        value: `${completeSets[0].items.length}/${completeSets[0].items.length}`, title: completeSets[0].name,
        detail: `Your largest completed collection set. ${completeSets.length} sets are complete in total.`, tone: 'ember',
        itemRecord: completeSets[0].items[0]?.record
      })
    }

    const closestSet = collectionSets.value
      .filter((set) => set.collected > 0 && set.collected < set.items.length)
      .sort((left, right) =>
        right.collected / right.items.length - left.collected / left.items.length ||
        right.collected - left.collected || left.name.localeCompare(right.name)
      )[0]
    if (closestSet) {
      const missing = closestSet.items.filter((item) => !setItemDiscovered(item)).map((item) => item.name)
      facts.push({
        id: 'closest-set', eyebrow: 'Almost assembled', value: `${closestSet.collected}/${closestSet.items.length}`,
        title: closestSet.name,
        detail: `Still missing ${missing.slice(0, 2).join(' and ')}${missing.length > 2 ? `, plus ${missing.length - 2} more` : ''}.`,
        tone: 'ember', itemRecord: closestSet.items[0]?.record
      })
    }

    const dated = items
      .filter((item) => item.firstDiscoveredAt && Number.isFinite(Date.parse(item.firstDiscoveredAt)))
      .sort((left, right) => Date.parse(left.firstDiscoveredAt!) - Date.parse(right.firstDiscoveredAt!))
    if (dated[0]) {
      facts.push({
        id: 'oldest-discovery', eyebrow: 'First page', value: formatTriviaDate(dated[0].firstDiscoveredAt!),
        title: dated[0].name, detail: 'The oldest discovery timestamp still recorded in this archive scope.',
        tone: 'blue', itemRecord: dated[0].record
      })
    }
    const newest = dated.at(-1)
    if (newest && newest.record !== dated[0]?.record) {
      facts.push({
        id: 'newest-discovery', eyebrow: 'Fresh ink', value: formatTriviaDate(newest.firstDiscoveredAt!),
        title: newest.name, detail: 'Your most recently discovered item base.', tone: 'green',
        itemRecord: newest.record
      })
    }

    const slotCounts = new Map<string, number>()
    for (const item of items.filter(isCollectionOwned)) {
      slotCounts.set(item.slot, (slotCounts.get(item.slot) ?? 0) + 1)
    }
    const favoriteSlot = [...slotCounts.entries()].sort((left, right) => right[1] - left[1])[0]
    if (favoriteSlot) {
      facts.push({
        id: 'favorite-slot', eyebrow: 'Armory bias', value: favoriteSlot[1].toLocaleString(),
        title: triviaSlotLabel(favoriteSlot[0]),
        detail: 'The equipment slot with the most discovered catalog entries.', tone: 'blue'
      })
    }

    const miItems = items.filter((item) => item.rarity === 'mi')
    const miFamilies = new Set(miItems.map(miFamilyKey))
    const ownedMiFamilies = new Set(miItems.filter(isCollectionOwned).map(miFamilyKey))
    facts.push({
      id: 'mi-menagerie', eyebrow: 'Green menagerie', value: `${ownedMiFamilies.size}/${miFamilies.size}`,
      title: 'Named MI bases',
      detail: `${miItems.filter(isCollectionOwned).length.toLocaleString()} of ${miItems.length.toLocaleString()} individual level tiers have been discovered.`,
      tone: 'green'
    })

    const topAffix = [...snapshot.value.affixes]
      .filter((affix) => affix.availableCount > 0)
      .sort((left, right) => right.availableCount - left.availableCount || left.name.localeCompare(right.name))[0]
    if (topAffix) {
      facts.push({
        id: 'affix-magnet', eyebrow: 'Affix magnet', value: `${topAffix.availableCount}×`,
        title: topAffix.name, detail: `Your most frequently retained ${topAffix.kind}.`,
        tone: topAffix.rarity === 'rare' ? 'green' : 'blue'
      })
    }

    const duplicateCopies = physicallyOwned.reduce(
      (total, item) => total + Math.max(0, item.availableCount - 1), 0
    )
    facts.push({
      id: 'duplicate-reserve', eyebrow: 'Emergency reserves', value: duplicateCopies.toLocaleString(),
      title: 'Copies beyond completion',
      detail: 'Everything after the first physical copy of each stored item tier.', tone: 'purple'
    })

    return facts
  })
  return {
    rarity, affixPercentage, recipePercentage, allItemSummary, allItemRollSummary,
    legendaryRollSummary, epicRollSummary, miRollSummary, awakeningAvailableLegendaryCount,
    setRollSummary, affixRollSummary, setSummary, componentSummary, consumableSummary,
    categoryProgressByName, collectionTrivia
  }
}
export type CollectionDashboard = ReturnType<typeof createCollectionDashboard>
