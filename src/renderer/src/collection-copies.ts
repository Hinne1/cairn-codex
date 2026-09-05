import { computed } from 'vue'
import type { CollectionBasis, CollectionItem, ObservedStashItem, VaultListItem } from '../../shared/contracts.ts'
import { useArchiveCopySession } from './archive-copy-session.ts'

/** Owns legacy comparison augmentation. Reads are paged, while this compatibility
 * boundary still publishes all copies so existing ownership/reference semantics remain intact. */
export function useCollectionCopies(options: Parameters<typeof useArchiveCopySession>[0] & {
  observedCopies: () => readonly ObservedStashItem[]
  catalogItems: () => readonly CollectionItem[]
  basis: () => CollectionBasis
}) {
  const archive = useArchiveCopySession(options)
  const copies = computed(() => {
    const copies = [...(options.observedCopies())]
    const observedVaultIds = new Set(
      copies
        .filter((copy) => copy.sourcePath.startsWith('vault://'))
        .map((copy) => copy.sourcePath.slice('vault://'.length))
    )
    if (!archive.loaded.value) return copies
    for (const item of archive.items.value) {
      if (
        observedVaultIds.has(item.id) ||
        !item.catalogued ||
        item.state !== 'ingested' ||
        (options.context().isHardcore !== undefined && item.isHardcore !== options.context().isHardcore)
      ) continue
      copies.push(vaultItemAsObserved(item, copies.length))
    }
    return copies
  })
  const archivedRecords = computed(() => {
    if (options.basis() === 'archive') {
      return new Set(
        options.catalogItems()
          .filter((item) => item.availableCount > 0)
          .map((item) => item.record.toLocaleLowerCase())
      )
    }
    return new Set(
      archive.items.value
        .filter((item) =>
          item.catalogued &&
          item.state === 'ingested' &&
          (options.context().isHardcore === undefined || item.isHardcore === options.context().isHardcore)
        )
        .map((item) => item.baseRecord.toLocaleLowerCase())
    )
  })
  return { archiveItems: archive.items, copies, archivedRecords }
}

export function vaultItemAsObserved(item: VaultListItem, itemIndex: number): ObservedStashItem {
  return {
    sourcePath: `vault://${item.id}`,
    tabIndex: -1,
    itemIndex,
    baseRecord: item.baseRecord,
    prefixRecord: item.prefixRecord,
    suffixRecord: item.suffixRecord,
    modifierRecord: '',
    transmuteRecord: '',
    seed: item.seed,
    materiaRecord: '',
    relicCompletionBonusRecord: '',
    relicSeed: 0,
    enchantmentRecord: '',
    ascendantRecord: '',
    ascendantRecord2H: '',
    enchantmentSeed: 0,
    materiaCombines: 0,
    stackCount: 1,
    rerolls: 0,
    affixRerolls: 0,
    rollAnalysis: item.rollAnalysis,
    instanceKey: item.instanceKey
  }
}
