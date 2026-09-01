import type { CompiledSearchQuery } from '@shared/search-query'
import type { DismantlingPreview, VaultListItem } from '@shared/contracts'
import { ref, type Ref } from 'vue'
import type { AppRoute } from '../app-route'

export type DismantlingControls = Extract<AppRoute, { workspace: 'dismantling' }>['controls']

export interface DismantlingSession {
  visibleCount: Ref<number>
  selectedIds: Ref<string[]>
  preview: Ref<DismantlingPreview | null>
  busy: Ref<boolean>
  error: Ref<string | null>
  filterKey: Ref<string | null>
}

export function createDismantlingSession(): DismantlingSession {
  return {
    visibleCount: ref(120),
    selectedIds: ref([]),
    preview: ref(null),
    busy: ref(false),
    error: ref(null),
    filterKey: ref(null)
  }
}

export function updateDismantlingControls(
  controls: DismantlingControls,
  patch: Partial<DismantlingControls>
): DismantlingControls {
  return { ...controls, ...patch }
}

export function eligibleDismantlingCandidates(items: readonly VaultListItem[]): VaultListItem[] {
  return items.filter((item) =>
    item.catalogued &&
    !item.reusable &&
    item.state === 'ingested' &&
    ['epic', 'legendary', 'mi', 'rare'].includes(item.rarity)
  )
}

export function filterDismantlingCandidates(
  items: readonly VaultListItem[],
  controls: DismantlingControls,
  query: Pick<CompiledSearchQuery, 'matches'>
): VaultListItem[] {
  return items.filter((item) =>
    (controls.mode === 'all' || (controls.mode === 'hardcore') === item.isHardcore) &&
    (controls.rarity === 'all' || item.rarity === controls.rarity) &&
    query.matches({
      text: [
        item.name,
        item.baseRecord,
        item.prefixRecord,
        item.suffixRecord,
        item.rarity,
        item.isHardcore ? 'hardcore' : 'softcore'
      ].join(' '),
      fields: {
        name: item.name,
        base: item.baseRecord,
        prefix: item.prefixRecord,
        suffix: item.suffixRecord,
        affix: [item.prefixRecord, item.suffixRecord],
        rarity: item.rarity,
        mode: item.isHardcore ? 'hardcore' : 'softcore',
        level: item.levelRequirement
      }
    })
  )
}

export function selectRedundantDismantlingCandidateIds(items: readonly VaultListItem[]): string[] {
  const groups = new Map<string, VaultListItem[]>()
  for (const item of items) {
    const key = `${item.isHardcore ? 'hc' : 'sc'}:${item.baseRecord.toLocaleLowerCase()}`
    const group = groups.get(key) ?? []
    group.push(item)
    groups.set(key, group)
  }
  const redundant: string[] = []
  for (const copies of groups.values()) {
    copies.sort((left, right) =>
      (right.rollAnalysis?.overallEstimatedPercentile ?? -1) -
        (left.rollAnalysis?.overallEstimatedPercentile ?? -1) ||
      Date.parse(right.ingestedAtUtc) - Date.parse(left.ingestedAtUtc)
    )
    redundant.push(...copies.slice(1)
      .filter((item) => !item.componentRecord && !item.augmentRecord)
      .map((item) => item.id))
  }
  return redundant
}
