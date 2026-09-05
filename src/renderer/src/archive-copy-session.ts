import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { VaultItemPage, VaultListItem, VaultPageRequest } from '../../shared/contracts.ts'

/** Legacy Collection/Planner/MI comparisons need all copies; acquire them explicitly
 * in bounded pages, only while a consuming stash-basis workspace is active. */
export function useArchiveCopySession(options: {
  enabled: () => boolean
  context: () => { isHardcore?: boolean; revision: number; source: string }
  query: (request: VaultPageRequest) => Promise<VaultItemPage>
  reportError: (error: unknown) => void
}) {
  const items = shallowRef<VaultListItem[]>([])
  const loaded = ref(false)
  let generation = 0
  let completedContext: string | null = null
  const invalidate = (): void => { generation++ }
  watch([() => JSON.stringify(options.context()), options.enabled], ([context, enabled]) => {
    const current = ++generation
    if (completedContext !== context) { items.value = []; loaded.value = false; completedContext = null }
    if (!enabled || completedContext === context) return
    const { isHardcore } = options.context()
    void (async () => {
      const copies: VaultListItem[] = []
      let offset = 0
      for (;;) {
        const page = await options.query({ state: 'ingested', catalogued: true, isHardcore,
          sort: 'recent', direction: 'desc', offset, limit: 250 })
        if (current !== generation) return
        copies.push(...page.items)
        offset += page.items.length
        if (offset >= page.total) break
        if (page.items.length === 0) throw new Error('Archive copy paging made no progress.')
      }
      if (current !== generation) return
      items.value = copies; loaded.value = true; completedContext = context
    })().catch(error => { if (current === generation) options.reportError(error) })
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(invalidate)
  return { items, loaded }
}
