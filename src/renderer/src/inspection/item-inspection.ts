import { computed, ref, watch, onScopeDispose } from 'vue'
import type { CollectionItem, ItemPresentation, ObservedStashItem, VaultListItem } from '../../../shared/contracts.ts'
import type { MiWorkshopControls } from '../workspaces/mi-workshop.ts'
import { compareCopiesByMiMetric } from '../workspaces/mi-workshop.ts'
import { createComparisonProjection, copyAffixDelta } from './inspection-presentation.ts'

export interface InspectionAffix {
  name: string
  kind: 'prefix' | 'suffix'
  rarity: 'magical' | 'rare'
  presentation?: ItemPresentation
}
export interface ItemInspectionOptions {
  available: () => boolean
  items: () => readonly CollectionItem[]
  copies: () => readonly ObservedStashItem[]
  observedCopies: () => readonly ObservedStashItem[]
  affixes: () => ReadonlyMap<string, InspectionAffix>
  metric: () => MiWorkshopControls['metric']
  metricDirection: () => MiWorkshopControls['metricDirection']
  storedCopyFor: (copy: ObservedStashItem) => VaultListItem | null
  modeFor: (copy: ObservedStashItem) => boolean
  setPinnedBest: (record: string, instanceKey: string | null, isHardcore: boolean) => Promise<unknown>
}

/** Shell-lifetime selection survives workspace unmounts and route restoration. */
export function createItemInspectionSession(options: ItemInspectionOptions) {
  const selectedRecord = ref<string | null>(null)
  const selectedReferenceInstanceKey = ref<string | null>(null)
  const activeCopyAffixTarget = ref<{ copyKey: string; record: string } | null>(null)
  const pinning = ref(false)
  let selectionRevision = 0
  let disposed = false
  watch([selectedRecord, selectedReferenceInstanceKey], () => { selectionRevision++ }, { flush: 'sync' })
  watch(selectedRecord, () => { activeCopyAffixTarget.value = null })
  onScopeDispose(() => { disposed = true; selectionRevision++ })

  const selectedItem = computed(() =>
    options.items().find((item) => item.record === selectedRecord.value) ?? null
  )

  const selectedCopies = computed(() => {
    if (!options.available() || !selectedRecord.value) return []
    const pinned = selectedItem.value?.pinnedInstanceKey
    const requestedReference = selectedReferenceInstanceKey.value
    const copies = options.copies()
      .filter((item) => item.baseRecord === selectedRecord.value && item.instanceKey)
    return copies
      .sort((left, right) => {
        if ((left.instanceKey === requestedReference) !== (right.instanceKey === requestedReference)) {
          return left.instanceKey === requestedReference ? -1 : 1
        }
        if ((left.instanceKey === pinned) !== (right.instanceKey === pinned)) {
          return left.instanceKey === pinned ? -1 : 1
        }
        if (selectedItem.value?.rarity !== 'mi') return 0
        return compareCopiesByMiMetric(
          left,
          right,
          options.metric(),
          options.metricDirection()
        )
      })
  })

  const comparisonReferenceCopy = computed(() => {
    const copies = selectedCopies.value
    if (!copies.length) return null
    const requestedReference = selectedReferenceInstanceKey.value
    const requested = copies.find((copy) => copy.instanceKey === requestedReference)
    if (requested) return requested
    const pinned = selectedItem.value?.pinnedInstanceKey
    return copies.find((copy) => copy.instanceKey === pinned) ?? copies[0]!
  })

  const selectedStoredCopies = computed(() => {
    if (!selectedRecord.value) return []
    return (options.observedCopies())
      .filter((observed) =>
        observed.sourcePath.startsWith('vault://') &&
        observed.baseRecord.toLocaleLowerCase() === selectedRecord.value?.toLocaleLowerCase()
      )
      .flatMap((observed) => {
        const item = options.storedCopyFor(observed)
        return item ? [item] : []
      })
  })

  const activeCopyAffix = computed(() =>
    activeCopyAffixTarget.value
      ? options.affixes().get(activeCopyAffixTarget.value.record.toLocaleLowerCase()) ?? null
      : null
  )

  function restore(record: string | null, referenceInstanceKey: string | null = null): void {
    selectedReferenceInstanceKey.value = record ? referenceInstanceKey : null
    selectedRecord.value = record
  }
  function open(item: CollectionItem, referenceInstanceKey: string | null = null): void {
    restore(item.record, referenceInstanceKey)
  }
  function close(): void { selectedRecord.value = null }
  async function pinCopy(copy: ObservedStashItem): Promise<void> {
    const item = selectedItem.value
    if (!item || !copy.instanceKey || pinning.value) return
    const revision = selectionRevision
    const next = item.pinnedInstanceKey === copy.instanceKey ? null : copy.instanceKey
    pinning.value = true
    try {
      await options.setPinnedBest(item.record, next, options.modeFor(copy))
      // A completed write belongs to its item, even if navigation occurred meanwhile.
      item.pinnedInstanceKey = next
      if (!disposed) {
        const currentItem = options.items().find(candidate => candidate.record === item.record)
        if (currentItem) currentItem.pinnedInstanceKey = next
      }
      if (!disposed && revision === selectionRevision) selectedReferenceInstanceKey.value = next
    } finally { pinning.value = false }
  }

  function copyAffixName(record: string, emptyLabel: string): string {
    if (!record) return emptyLabel
    return options.affixes().get(record.toLocaleLowerCase())?.name ??
      record.replaceAll('\\', '/').split('/').at(-1)?.replace(/\.dbr$/i, '') ?? record
  }

  function copyAffixRarity(record: string): 'magical' | 'rare' | null {
    if (!record) return null
    return options.affixes().get(record.toLocaleLowerCase())?.rarity ?? null
  }

  function copyAffixRarityLabel(record: string): string {
    const rarity = copyAffixRarity(record)
    return rarity === 'magical' ? 'Magic' : rarity === 'rare' ? 'Rare' : 'Unknown rarity'
  }

  function copyAffixKey(copy: ObservedStashItem, record: string): string {
    return `${copy.instanceKey ?? `${copy.sourcePath}:${copy.tabIndex}:${copy.itemIndex}`}|${record}`
  }

  function copyAffixIsOpen(copy: ObservedStashItem, record: string): boolean {
    return Boolean(record) && activeCopyAffixTarget.value?.copyKey === copyAffixKey(copy, record)
  }

  function toggleCopyAffix(copy: ObservedStashItem, record: string): void {
    if (!record) return
    const copyKey = copyAffixKey(copy, record)
    activeCopyAffixTarget.value = activeCopyAffixTarget.value?.copyKey === copyKey
      ? null
      : { copyKey, record }
  }

  function copySourceLabel(copy: ObservedStashItem): string {
    if (options.storedCopyFor(copy)) return 'Stored in Codex Archive'
    const name = copy.sourcePath.replaceAll('\\', '/').split('/').at(-1)
    return name ? `Currently in ${name}` : 'Currently scanned copy'
  }

  const itemComparison = computed(() => createComparisonProjection(false, selectedCopies.value, comparisonReferenceCopy.value, selectedItem.value))
  const petComparison = computed(() => createComparisonProjection(true, selectedCopies.value, comparisonReferenceCopy.value, selectedItem.value))
  return {
    selectedRecord, selectedReferenceInstanceKey, selectedItem, selectedCopies,
    comparisonReferenceCopy, selectedStoredCopies, activeCopyAffixTarget, activeCopyAffix, pinning,
    restore, open, close, pinCopy, copyAffixName, copyAffixRarity, copyAffixRarityLabel,
    copyAffixIsOpen, toggleCopyAffix, copySourceLabel,
    comparisonItemStats: (copy: ObservedStashItem) => itemComparison.value(copy),
    comparisonPetStats: (copy: ObservedStashItem) => petComparison.value(copy),
    copyAffixDelta: (copy: ObservedStashItem, kind: 'prefix' | 'suffix') => copyAffixDelta(copy, kind, comparisonReferenceCopy.value)
  }
}
export type ItemInspectionSession = ReturnType<typeof createItemInspectionSession>
