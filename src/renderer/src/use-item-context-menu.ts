import { computed, nextTick, onBeforeUnmount, shallowRef, watch, type Ref } from 'vue'
import type { CollectionItem } from '@shared/contracts'
import type { ResearchItemTableRow } from './workspaces/research-item-table'
import { researchItemContextActions, type ItemContextActionId, type ItemContextRequest } from './item-context-menu'

export type ItemMenuDismissal = 'escape' | 'tab' | 'outside' | 'viewport'

export function useItemContextMenu(options: {
  root: Ref<HTMLElement | null>
  rows: () => readonly ResearchItemTableRow[]
  context: () => string
  plannerActions: () => boolean
  dismissTooltip: () => void
  execute: (action: ItemContextActionId, item: CollectionItem) => void
}) {
  const request = shallowRef<ItemContextRequest<ResearchItemTableRow> | null>(null)
  const row = computed(() => request.value ? options.rows().find(row => row.item.record === request.value!.key) : undefined)
  const actions = computed(() => row.value ? researchItemContextActions(row.value, { favorite: options.plannerActions(), ignore: options.plannerActions() }) : [])

  function restore(source: HTMLElement, preventScroll = false): void {
    const fallback = options.root.value?.querySelector<HTMLElement>('[data-result-key][tabindex="0"]')
      ?? options.root.value?.querySelector<HTMLElement>('[data-result-key], button:not([disabled]), [tabindex="0"]')
      ?? document.querySelector<HTMLElement>('.workspace-sidebar button[aria-current="page"]')
    const target = source.isConnected && source.getClientRects().length && !source.matches(':disabled') ? source : fallback
    target?.focus({ preventScroll })
    options.dismissTooltip()
  }

  function dismiss(reason: ItemMenuDismissal = 'escape'): void {
    const previous = request.value
    request.value = null
    if (!previous || reason === 'outside') return
    // Let native Tab continue from the invoker, not the teleported menu.
    if (reason === 'tab') restore(previous.source)
    else void nextTick(() => restore(previous.source, reason === 'viewport'))
  }

  function open(next: ItemContextRequest<ResearchItemTableRow>): void {
    options.dismissTooltip()
    request.value = next
  }

  function openButton(row: ResearchItemTableRow, event: MouseEvent): void {
    if (!(event.currentTarget instanceof HTMLElement)) return
    open({ key: row.item.record, item: row, source: event.currentTarget })
  }

  function execute(id: ItemContextActionId): void {
    const previous = request.value
    const selected = row.value
    if (!previous || !selected || !actions.value.some(action => action.id === id)) return dismiss()
    request.value = null
    if (id === 'inspect') {
      // The comparison dialog captures this invoker and owns subsequent focus.
      restore(previous.source)
      options.execute(id, selected.item)
    } else {
      options.execute(id, selected.item)
      void nextTick(() => restore(previous.source))
    }
  }

  watch([options.rows, options.context, options.plannerActions], (_next, previous) => {
    if (!request.value) return
    if (!row.value || !request.value.source.isConnected || options.context() !== previous[1] || options.plannerActions() !== previous[2]) dismiss()
  }, { flush: 'post' })
  onBeforeUnmount(() => dismiss('outside'))
  return { request, row, actions, open, openButton, dismiss, execute }
}
