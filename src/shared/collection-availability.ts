import type { CollectionItem } from './contracts'

export function withAwakeningAvailability<T extends CollectionItem>(
  items: readonly T[],
  sourceItems: readonly CollectionItem[] = items
): T[] {
  const byRecord = new Map<string, CollectionItem>()
  for (const item of sourceItems) {
    const key = item.record.toLocaleLowerCase()
    const existing = byRecord.get(key)
    if (!existing || item.availableCount > existing.availableCount) byRecord.set(key, item)
  }

  return items.map((item) => {
    if (!item.baseVersionRecord) return item
    const source = byRecord.get(item.baseVersionRecord.toLocaleLowerCase())
    const sourceAvailableCount = source?.availableCount ?? 0
    return {
      ...item,
      availableViaAwakening: sourceAvailableCount > 0,
      awakeningSourceRecord: source?.record ?? item.baseVersionRecord,
      awakeningSourceName: source?.name ?? null,
      awakeningSourceAvailableCount: sourceAvailableCount
    }
  })
}

export function isAvailableViaAwakening(item: CollectionItem): boolean {
  return item.availableViaAwakening === true && (item.awakeningSourceAvailableCount ?? 0) > 0
}

export function isCollectionOwned(item: CollectionItem): boolean {
  return Boolean(item.discovered || isAvailableViaAwakening(item))
}
