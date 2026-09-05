import { ref, watch } from 'vue'
import type { ObservedStashItem } from '../../../shared/contracts.ts'

export function createCopyFavorites(options: {
  contextKey: () => string
  modeFor: (copy: ObservedStashItem) => boolean | undefined
  write: (instanceKey: string, isHardcore: boolean, favorite: boolean) => Promise<void>
  apply: (instanceKey: string, isHardcore: boolean, favorite: boolean) => void
  reportError: (error: unknown) => void
}) {
  const busy = ref(false)
  let generation = 0
  watch(options.contextKey, () => { generation++ }, { flush: 'sync' })
  const canToggle = (copy: ObservedStashItem) => /^[a-f0-9]{64}$/i.test(copy.instanceKey ?? '') &&
    typeof copy.isFavorite === 'boolean' && typeof options.modeFor(copy) === 'boolean'
  async function toggle(copy: ObservedStashItem): Promise<void> {
    if (busy.value || !canToggle(copy)) return
    const epoch = generation
    const instanceKey = copy.instanceKey!.toLowerCase()
    const mode = options.modeFor(copy)!
    const favorite = !copy.isFavorite
    busy.value = true
    try {
      await options.write(instanceKey, mode, favorite)
      if (epoch === generation) options.apply(instanceKey, mode, favorite)
    } catch (error) {
      if (epoch === generation) options.reportError(error)
    } finally {
      busy.value = false
    }
  }
  return { busy, canToggle, toggle }
}

export type CopyFavorites = ReturnType<typeof createCopyFavorites>

export function applyCopyFavorite<T extends { instanceKey?: string | null; isHardcore?: boolean; isFavorite?: boolean }>(
  copies: readonly T[], instanceKey: string, isHardcore: boolean, favorite: boolean
): T[] {
  return copies.map(copy => copy.instanceKey?.toLowerCase() === instanceKey && copy.isHardcore === isHardcore
    ? { ...copy, isFavorite: favorite } : copy)
}
