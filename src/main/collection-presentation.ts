import { createHash } from 'node:crypto'
import type { CollectionBasis, CollectionSnapshot, ObservedStashItem } from '../shared/contracts.ts'
import { isCollectionOwned, withAwakeningAvailability } from '../shared/collection-availability.ts'
import { withRecipeAvailability } from '../shared/recipe-availability.ts'
import type { CollectionDatabase } from './collection-database.ts'

// This presenter cannot resolve records or mutate archive metadata.
type CollectionReadStore = Pick<CollectionDatabase,
  'presentSnapshot' | 'presentArchiveSnapshot' | 'listAvailableArchiveItems' | 'countArchiveRollAnalysisCandidates'>

export interface LiveVaultPayload {
  stashVersion: number
  sourceTabIndex: number
  sourceItemIndex: number
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
  unknown: number
  enchantmentSeed: number
  materiaCombines: number
  stackCount: number
  rerolls: number
  affixRerolls: number
  xOffset: number
  yOffset: number
}

function lifetimeMode(snapshot: CollectionSnapshot): boolean | undefined {
  const modes = new Set(snapshot.scannedStashes.map((stash) => stash.isHardcore))
  return modes.size === 1 ? [...modes][0] : undefined
}

export async function presentCollection(
  database: CollectionReadStore,
  snapshot: CollectionSnapshot,
  basis: CollectionBasis,
  rollAnalysisVersion: number
): Promise<CollectionSnapshot> {
  const mode = lifetimeMode(snapshot)
  if (basis !== 'archive') {
    return withRecipeCollection(
      database.presentSnapshot({ ...snapshot, basis: 'stashes' }, mode),
      mode
    )
  }

  const installation = snapshot.discovery.installations[0]
  const archived = database.listAvailableArchiveItems(mode)
  if (!installation || archived.length === 0) {
    return withRecipeCollection(database.presentArchiveSnapshot(snapshot, [], mode), mode)
  }
  const payloads = archived.map((item) => item.payload as LiveVaultPayload)
  const observedItems = archived.map((item, index): ObservedStashItem => {
    const payload = payloads[index]!
    return {
      sourcePath: `vault://${item.id}`,
      tabIndex: -1,
      itemIndex: index,
      baseRecord: payload.baseRecord,
      prefixRecord: payload.prefixRecord,
      suffixRecord: payload.suffixRecord,
      modifierRecord: payload.modifierRecord,
      transmuteRecord: payload.transmuteRecord,
      seed: payload.seed,
      materiaRecord: payload.materiaRecord,
      relicCompletionBonusRecord: payload.relicCompletionBonusRecord,
      relicSeed: payload.relicSeed,
      enchantmentRecord: payload.enchantmentRecord,
      ascendantRecord: payload.ascendantRecord,
      ascendantRecord2H: payload.ascendantRecord2H,
      enchantmentSeed: payload.enchantmentSeed,
      materiaCombines: payload.materiaCombines,
      stackCount: payload.stackCount,
      rerolls: payload.rerolls,
      affixRerolls: payload.affixRerolls,
      rollAnalysis: archived[index]!.rollAnalysis,
      instanceKey: createVaultInstanceKey(payload)
    }
  })
  return {
    ...withRecipeCollection(database.presentArchiveSnapshot(snapshot, observedItems, mode), mode),
    rollHydrationPending: database.countArchiveRollAnalysisCandidates(rollAnalysisVersion, mode)
  }
}

export function withRecipeCollection(
  snapshot: CollectionSnapshot,
  isHardcore?: boolean
): CollectionSnapshot {
  const decorate = (item: CollectionSnapshot['items'][number]) =>
    withRecipeAvailability(item, isHardcore)
  const recipeItemsCatalog = snapshot.items.map(decorate)
  const recipePlannerItems = (snapshot.plannerItems ?? []).map(decorate)
  const materials = (snapshot.materials ?? []).map(decorate)
  const awakeningSources = [...recipeItemsCatalog, ...recipePlannerItems]
  const items = withAwakeningAvailability(recipeItemsCatalog, awakeningSources)
  const plannerItems = withAwakeningAvailability(recipePlannerItems, awakeningSources)
  const recipeItems = [...items, ...plannerItems, ...materials].filter(
    (item, index, all) =>
      Boolean(item.acquisition?.crafting) &&
      all.findIndex((candidate) => candidate.record.toLowerCase() === item.record.toLowerCase()) === index
  )
  const rarities = snapshot.rarities.map((summary) => {
    const matching = items.filter((item) => item.rarity === summary.rarity)
    return {
      ...summary,
      total: matching.length,
      collected: matching.filter(isCollectionOwned).length,
      availableCopies: matching.reduce((count, item) => count + item.availableCount, 0)
    }
  })
  const collectedRecipes = recipeItems.filter((item) => item.recipeUnlocked).length
  return {
    ...snapshot,
    items,
    plannerItems,
    materials,
    rarities,
    recipeSummary: {
      total: recipeItems.length,
      collected: collectedRecipes,
      unlockedItems: collectedRecipes
    }
  }
}

export function createVaultInstanceKey(item: LiveVaultPayload): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        item.baseRecord,
        item.prefixRecord,
        item.suffixRecord,
        item.modifierRecord,
        item.transmuteRecord,
        item.seed,
        item.materiaRecord,
        item.relicCompletionBonusRecord,
        item.relicSeed,
        item.enchantmentRecord,
        item.ascendantRecord,
        item.ascendantRecord2H,
        item.enchantmentSeed,
        item.materiaCombines,
        item.stackCount,
        item.rerolls,
        item.affixRerolls
      ])
    )
    .digest('hex')
}
