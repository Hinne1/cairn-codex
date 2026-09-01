import type { CollectionItem } from '@shared/contracts'
import type { CompiledSearchQuery, SearchDocument } from '@shared/search-query'
import type { AppRoute } from '../app-route'

export type CollectionFarmingControls = Extract<AppRoute, { workspace: 'farming' }>['controls']
export type CollectionFarmingRarity = CollectionFarmingControls['rarity']

export interface CollectionFarmTarget {
  key: string
  name: string
  contentPack: string
  items: CollectionItem[]
  minimumLevel: number
}

export interface CollectionFarmingTargetOptions {
  rarity: CollectionFarmingRarity
  query: Pick<CompiledSearchQuery, 'matches'>
  isOwned: (item: CollectionItem) => boolean
  searchDocumentForItem: (item: CollectionItem) => SearchDocument
}

export function withCollectionFarmingQuery(
  controls: CollectionFarmingControls,
  query: string
): CollectionFarmingControls {
  return { ...controls, query, page: 1 }
}

export function withCollectionFarmingRarity(
  controls: CollectionFarmingControls,
  rarity: CollectionFarmingRarity
): CollectionFarmingControls {
  return { ...controls, rarity, page: 1 }
}

export function withCollectionFarmingPage(
  controls: CollectionFarmingControls,
  page: number
): CollectionFarmingControls {
  return { ...controls, page }
}

export function buildCollectionFarmingTargets(
  items: readonly CollectionItem[],
  options: CollectionFarmingTargetOptions
): CollectionFarmTarget[] {
  const grouped = new Map<string, CollectionFarmTarget>()
  for (const item of items) {
    if (options.isOwned(item)) continue
    if (options.rarity !== 'all' && item.rarity !== options.rarity) continue
    const locations = item.acquisition?.locations ?? []
    for (const location of locations) {
      const itemDocument = options.searchDocumentForItem(item)
      if (!options.query.matches({
        text: [
          itemDocument.text,
          location.name,
          location.routeName,
          location.contentPack,
          ...(item.acquisition?.sources ?? [])
        ].filter(Boolean).join(' '),
        fields: {
          name: item.name,
          skill: itemDocument.fields?.skill,
          damage: itemDocument.fields?.damage,
          monster: item.acquisition?.sources ?? [],
          source: item.acquisition?.sources ?? [],
          area: [location.name, location.routeName ?? ''],
          rarity: item.rarity,
          level: item.levelRequirement
        }
      })) continue
      const key = `${location.contentPack}:${location.name}:${location.routeName ?? ''}`.toLocaleLowerCase()
      const existing = grouped.get(key)
      if (existing) {
        if (!existing.items.some((candidate) => candidate.record === item.record)) existing.items.push(item)
        existing.minimumLevel = Math.min(existing.minimumLevel, item.levelRequirement)
      } else {
        grouped.set(key, {
          key,
          name: location.name,
          contentPack: location.contentPack,
          items: [item],
          minimumLevel: item.levelRequirement
        })
      }
    }
  }
  return [...grouped.values()]
    .filter((target) => target.items.length > 0)
    .sort((left, right) =>
      right.items.length - left.items.length ||
      left.minimumLevel - right.minimumLevel ||
      left.name.localeCompare(right.name)
    )
}
