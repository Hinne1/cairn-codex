<script setup lang="ts" generic="T">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  createBoundedResultWindow,
  moveBoundedResultKey,
  moveBoundedVisualRowKey,
  updateBoundedSelection,
  type BoundedNavigationIntent,
  type BoundedResultKey,
  type BoundedSelectionMode
} from '../bounded-results'

const props = withDefaults(defineProps<{
  items: readonly T[]
  getKey: (item: T, index: number) => BoundedResultKey
  label: string
  page?: number
  pageSize?: number
  totalCount?: number
  remote?: boolean
  pagination?: 'pages' | 'continuous'
  layout?: 'list' | 'grid' | 'table'
  loading?: boolean
  error?: string | null
  emptyTitle?: string
  emptyDetail?: string
  selectionMode?: BoundedSelectionMode
  selectedKeys?: readonly BoundedResultKey[]
  selectionDisabled?: boolean
  isItemDisabled?: (item: T) => boolean
  navigable?: boolean
  interactive?: boolean
  itemDescribedBy?: string
  keyboardColumns?: number
}>(), {
  page: 1,
  pageSize: 50,
  totalCount: undefined,
  remote: false,
  pagination: 'pages',
  layout: 'list',
  loading: false,
  error: null,
  emptyTitle: 'No results',
  emptyDetail: 'Try changing the search or filters.',
  selectionMode: 'none',
  selectedKeys: () => [],
  selectionDisabled: false,
  isItemDisabled: undefined,
  navigable: false,
  interactive: false,
  itemDescribedBy: undefined,
  keyboardColumns: 1
})

const emit = defineEmits<{
  'update:page': [page: number]
  'update:selectedKeys': [keys: BoundedResultKey[]]
  activate: [key: BoundedResultKey, item: T]
  'item-focus': [key: BoundedResultKey, item: T, element: HTMLElement]
  'item-blur': [key: BoundedResultKey, item: T, event: FocusEvent]
  retry: []
}>()

const itemElements = new Map<BoundedResultKey, HTMLElement>()
const activeKey = ref<BoundedResultKey | null>(null)
const continuousStartPage = ref(1)
const continuousEndPage = ref(1)
const continuousLeadingSpace = ref(0)
const continuousChanging = ref(false)
const continuousTopSentinel = ref<HTMLElement | null>(null)
const continuousBottomSentinel = ref<HTMLElement | null>(null)
const discardedPageHeights = new Map<number, number>()
let continuousObserver: IntersectionObserver | null = null
const resultWindow = computed(() => createBoundedResultWindow({
  items: props.items,
  getKey: props.getKey,
  page: props.page,
  pageSize: props.pageSize,
  totalCount: props.totalCount,
  remote: props.remote
}))
const continuousEnabled = computed(() => props.pagination === 'continuous' && !props.remote)
const continuousEntries = computed(() => {
  const firstIndex = Math.max(0, (continuousStartPage.value - 1) * props.pageSize)
  const lastIndex = Math.min(props.items.length, continuousEndPage.value * props.pageSize)
  return props.items.slice(firstIndex, lastIndex).map((item, offset) => {
    const index = firstIndex + offset
    return { item, index, key: props.getKey(item, index) }
  })
})
const visibleEntries = computed(() => continuousEnabled.value ? continuousEntries.value : resultWindow.value.entries)
const entryKeys = computed(() => visibleEntries.value.map((entry) => entry.key))
const visibleFirstIndex = computed(() => (visibleEntries.value[0]?.index ?? 0) + 1)
const visibleLastIndex = computed(() => (visibleEntries.value.at(-1)?.index ?? 0) + 1)
const showResults = computed(() => !props.loading && !props.error && visibleEntries.value.length > 0)
const selectable = computed(() => props.selectionMode !== 'none')
const focusable = computed(() => selectable.value || props.navigable || props.interactive)
const usesGridSemantics = computed(() => props.layout === 'grid' && focusable.value)
const usesListSemantics = computed(() => props.layout === 'list' || (props.layout === 'grid' && !usesGridSemantics.value))
const collectionRole = computed(() => usesListSemantics.value
  ? (selectable.value ? 'listbox' : 'list')
  : 'grid')
const itemRole = computed(() => usesListSemantics.value
  ? (selectable.value ? 'option' : 'listitem')
  : 'row')

watch(entryKeys, (keys) => {
  const selectedVisible = props.selectedKeys.find((key) => keys.includes(key)) ?? null
  const activeVisible = activeKey.value !== null && keys.includes(activeKey.value)
  if (!activeVisible) activeKey.value = selectedVisible ?? (keys[0] ?? null)
}, { immediate: true })

watch(() => [props.page, resultWindow.value.pageCount] as const, () => {
  if (props.page !== resultWindow.value.page) emit('update:page', resultWindow.value.page)
})

watch(() => props.page, (page) => {
  if (!continuousEnabled.value || page === continuousEndPage.value) return
  resetContinuousWindow(page)
})

watch(() => [props.items, props.pagination] as const, () => {
  resetContinuousWindow(props.page)
}, { immediate: true })

watch(() => props.layout, () => {
  if (!continuousEnabled.value) return
  const anchor = viewportAnchor()
  const anchorTop = elementTop(anchor?.key)
  const focusedKey = focusedEntry()?.key
  continuousChanging.value = true
  continuousLeadingSpace.value = 0
  discardedPageHeights.clear()
  void settleContinuousWindow(anchor?.key, anchorTop, focusedKey)
})

function rememberElement(key: BoundedResultKey, element: Element | null): void {
  if (element instanceof HTMLElement) itemElements.set(key, element)
  else itemElements.delete(key)
}

function rememberSemanticElement(key: BoundedResultKey, element: Element | null, gridCell: boolean): void {
  if (usesGridSemantics.value !== gridCell) return
  rememberElement(key, element)
}

function entryDisabled(entry: { item: T }): boolean {
  return props.selectionDisabled || Boolean(props.isItemDisabled?.(entry.item))
}

function select(entry: { key: BoundedResultKey, item: T }): void {
  activeKey.value = entry.key
  if (entryDisabled(entry)) return
  if (selectable.value) {
    emit('update:selectedKeys', updateBoundedSelection(props.selectedKeys, entry.key, props.selectionMode))
  }
}

function activateEntry(entry: { key: BoundedResultKey, item: T }): void {
  select(entry)
  if (props.interactive && !entryDisabled(entry)) emit('activate', entry.key, entry.item)
}

function handleItemFocus(event: FocusEvent, entry: { key: BoundedResultKey, item: T }): void {
  activeKey.value = entry.key
  const element = event.target instanceof HTMLElement ? event.target : itemElements.get(entry.key)
  if (element) emit('item-focus', entry.key, entry.item, element)
}

function focusKey(key: BoundedResultKey | null): void {
  if (key === null) return
  activeKey.value = key
  // Keyboard targets are already mounted in the current bounded page. Focus immediately so
  // assistive technology and synthetic keyboard gates observe the same deterministic handoff,
  // then retry after Vue flushes in case the active-key update replaced the element.
  itemElements.get(key)?.focus()
  void nextTick(() => {
    if (document.activeElement !== itemElements.get(key)) itemElements.get(key)?.focus()
  })
}

function visualRowKey(intent: 'row-up' | 'row-down'): BoundedResultKey | null {
  return moveBoundedVisualRowKey(entryKeys.value.flatMap((key) => {
    const rect = itemElements.get(key)?.getBoundingClientRect()
    return rect ? [{ key, left: rect.left, top: rect.top }] : []
  }), activeKey.value, intent)
}

function navigate(intent: BoundedNavigationIntent): void {
  if (props.layout === 'grid' && (intent === 'row-up' || intent === 'row-down')) {
    const visualKey = visualRowKey(intent)
    if (visualKey !== null) {
      focusKey(visualKey)
      return
    }
  }
  const columns = props.layout === 'grid' ? visibleGridColumns() : props.keyboardColumns
  focusKey(moveBoundedResultKey(entryKeys.value, activeKey.value, intent, columns))
}

function visibleGridColumns(): number {
  const first = itemElements.get(entryKeys.value[0] ?? '')
  if (!first) return Math.max(1, props.keyboardColumns)
  const firstTop = first.getBoundingClientRect().top
  const count = entryKeys.value.findIndex((key) => {
    const top = itemElements.get(key)?.getBoundingClientRect().top
    return top !== undefined && Math.abs(top - firstTop) > 1
  })
  return count > 0 ? count : Math.max(1, entryKeys.value.length)
}

function handleKeydown(event: KeyboardEvent, entry: { key: BoundedResultKey, item: T }): void {
  const intent = event.key === 'Home' ? 'first'
    : event.key === 'End' ? 'last'
      : event.key === 'ArrowLeft' ? 'previous'
        : event.key === 'ArrowRight' ? 'next'
          : event.key === 'ArrowUp' ? 'row-up'
            : event.key === 'ArrowDown' ? 'row-down'
              : null

  if (intent) {
    event.preventDefault()
    navigate(intent)
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    if (entryDisabled(entry)) return
    activateEntry(entry)
  }
}

function changePage(page: number): void {
  const bounded = Math.min(Math.max(page, 1), resultWindow.value.pageCount)
  if (bounded !== resultWindow.value.page) emit('update:page', bounded)
}

function resetContinuousWindow(page: number): void {
  const boundedPage = Math.min(Math.max(page, 1), resultWindow.value.pageCount)
  continuousEndPage.value = boundedPage
  continuousStartPage.value = Math.max(1, boundedPage - 1)
  continuousLeadingSpace.value = 0
  discardedPageHeights.clear()
}

function entryAtIndex(index: number): { key: BoundedResultKey } | undefined {
  return visibleEntries.value.find((entry) => entry.index === index)
}

function focusedEntry(): { key: BoundedResultKey, index: number } | undefined {
  const focused = document.activeElement
  return visibleEntries.value.find((entry) => itemElements.get(entry.key) === focused)
}

function unobscuredViewportTop(): number {
  const topbar = document.querySelector<HTMLElement>('.topbar')
  if (!topbar) return 0
  const position = window.getComputedStyle(topbar).position
  if (position !== 'fixed' && position !== 'sticky') return 0
  return Math.min(window.innerHeight, Math.max(0, topbar.getBoundingClientRect().bottom))
}

function viewportAnchor(): { key: BoundedResultKey, index: number } | undefined {
  const visibleTop = unobscuredViewportTop()
  const focused = focusedEntry()
  if (focused) {
    const rect = itemElements.get(focused.key)?.getBoundingClientRect()
    if (rect && rect.bottom > visibleTop && rect.top < window.innerHeight) return focused
  }
  return visibleEntries.value.find((entry) => {
    const rect = itemElements.get(entry.key)?.getBoundingClientRect()
    return Boolean(rect && rect.bottom > visibleTop && rect.top < window.innerHeight)
  })
}

function elementTop(key: BoundedResultKey | undefined): number | null {
  if (key === undefined) return null
  return itemElements.get(key)?.getBoundingClientRect().top ?? null
}

function keepElementInViewport(element: HTMLElement): void {
  const rect = element.getBoundingClientRect()
  const visibleTop = unobscuredViewportTop()
  const availableHeight = Math.max(0, window.innerHeight - visibleTop)
  const offset = rect.height > availableHeight
    ? rect.top - visibleTop
    : rect.top < visibleTop
      ? rect.top - visibleTop
      : rect.bottom > window.innerHeight
        ? rect.bottom - window.innerHeight
        : 0
  if (offset !== 0) window.scrollBy(0, offset)
}

async function settleContinuousWindow(
  anchorKey?: BoundedResultKey,
  anchorTop?: number | null,
  focusKey?: BoundedResultKey
): Promise<void> {
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  if (anchorKey !== undefined && anchorTop !== null && anchorTop !== undefined) {
    const nextTop = elementTop(anchorKey)
    if (nextTop !== null) window.scrollBy(0, nextTop - anchorTop)
  }
  if (focusKey !== undefined) {
    const focusElement = itemElements.get(focusKey)
    if (focusElement) {
      keepElementInViewport(focusElement)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      keepElementInViewport(focusElement)
      focusElement.focus({ preventScroll: true })
    }
  }
  continuousChanging.value = false
}

function loadNextContinuousPage(): void {
  if (!continuousEnabled.value || continuousChanging.value || continuousEndPage.value >= resultWindow.value.pageCount) return
  continuousChanging.value = true
  const spansTwoPages = continuousEndPage.value > continuousStartPage.value
  const retained = spansTwoPages ? entryAtIndex(continuousStartPage.value * props.pageSize) : undefined
  const first = visibleEntries.value[0]
  const anchor = viewportAnchor() ?? retained
  const focused = focusedEntry()
  const restoreFocus = focused && retained && focused.index < continuousStartPage.value * props.pageSize
    ? anchor?.key
    : undefined
  const retainedTop = elementTop(retained?.key)
  const anchorTop = elementTop(anchor?.key)
  if (spansTwoPages && first && retainedTop !== null) {
    const firstTop = elementTop(first.key)
    if (firstTop !== null) {
      const discardedHeight = Math.max(0, retainedTop - firstTop)
      discardedPageHeights.set(continuousStartPage.value, discardedHeight)
      continuousLeadingSpace.value += discardedHeight
    }
    continuousStartPage.value += 1
  }
  continuousEndPage.value += 1
  emit('update:page', continuousEndPage.value)
  void settleContinuousWindow(anchor?.key, anchorTop, restoreFocus)
}

function loadPreviousContinuousPage(): void {
  if (!continuousEnabled.value || continuousChanging.value || continuousStartPage.value <= 1) return
  continuousChanging.value = true
  const anchor = viewportAnchor() ?? visibleEntries.value[0]
  const focused = focusedEntry()
  const trailingPageFirstIndex = (continuousEndPage.value - 1) * props.pageSize
  const restoreFocus = focused && focused.index >= trailingPageFirstIndex ? anchor?.key : undefined
  const anchorTop = elementTop(anchor?.key)
  const previousPage = continuousStartPage.value - 1
  continuousLeadingSpace.value = Math.max(
    0,
    continuousLeadingSpace.value - (discardedPageHeights.get(previousPage) ?? 0)
  )
  continuousStartPage.value = previousPage
  continuousEndPage.value = Math.max(previousPage, continuousEndPage.value - 1)
  emit('update:page', continuousEndPage.value)
  void settleContinuousWindow(anchor?.key, anchorTop, restoreFocus)
}

function connectContinuousObserver(): void {
  continuousObserver?.disconnect()
  continuousObserver = null
  if (!continuousEnabled.value || !showResults.value || typeof IntersectionObserver === 'undefined') return
  continuousObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      if (entry.target === continuousBottomSentinel.value) loadNextContinuousPage()
      else if (entry.target === continuousTopSentinel.value) loadPreviousContinuousPage()
    }
  }, { root: null, rootMargin: '500px 0px' })
  if (continuousTopSentinel.value) continuousObserver.observe(continuousTopSentinel.value)
  if (continuousBottomSentinel.value) continuousObserver.observe(continuousBottomSentinel.value)
}

watch(
  () => [continuousEnabled.value, showResults.value, continuousTopSentinel.value, continuousBottomSentinel.value] as const,
  () => void nextTick(connectContinuousObserver)
)

onMounted(() => void nextTick(connectContinuousObserver))
onBeforeUnmount(() => continuousObserver?.disconnect())
</script>

<template>
  <section class="bounded-results" :aria-busy="loading" :aria-label="label">
    <div v-if="loading" class="bounded-results-state" role="status">
      <slot name="loading">
        <span class="bounded-results-spinner" aria-hidden="true" />
        <strong>Loading results…</strong>
      </slot>
    </div>

    <div v-else-if="error" class="bounded-results-state is-error" role="alert">
      <slot name="error" :message="error" :retry="() => emit('retry')">
        <strong>Results could not be loaded.</strong>
        <p>{{ error }}</p>
        <button type="button" @click="emit('retry')">Try again</button>
      </slot>
    </div>

    <div v-else-if="resultWindow.entries.length === 0" class="bounded-results-state is-empty">
      <slot name="empty">
        <strong>{{ emptyTitle }}</strong>
        <p>{{ emptyDetail }}</p>
      </slot>
    </div>

    <div
      v-if="continuousEnabled && continuousLeadingSpace > 0"
      class="bounded-results-leading-space"
      :style="{ height: `${continuousLeadingSpace}px` }"
      aria-hidden="true"
    />

    <div
      v-if="showResults && continuousEnabled"
      ref="continuousTopSentinel"
      class="bounded-results-continuation is-previous"
    >
      <button v-if="continuousStartPage > 1" type="button" @click="loadPreviousContinuousPage">Load previous results</button>
    </div>

    <div
      v-if="showResults"
      :class="['bounded-results-collection', `is-${layout}`]"
      :role="collectionRole"
      :aria-label="label"
      :aria-multiselectable="selectionMode === 'multiple' ? true : undefined"
    >
      <slot name="header" />
      <div
        v-for="entry in visibleEntries"
        :key="entry.key"
        :ref="(element) => rememberSemanticElement(entry.key, element as Element | null, false)"
        :class="usesGridSemantics ? 'bounded-results-row' : ['bounded-results-item', { 'is-selected': selectable && selectedKeys.includes(entry.key), 'is-disabled': entryDisabled(entry) }]"
        :data-result-key="!usesGridSemantics ? String(entry.key) : undefined"
        :role="usesGridSemantics ? 'row' : itemRole"
        :aria-selected="!usesGridSemantics && selectable ? selectedKeys.includes(entry.key) : undefined"
        :aria-disabled="!usesGridSemantics && selectable && entryDisabled(entry) ? true : undefined"
        :aria-describedby="!usesGridSemantics ? itemDescribedBy : undefined"
        :tabindex="!usesGridSemantics && focusable ? (activeKey === entry.key ? 0 : -1) : undefined"
        @focus="!usesGridSemantics && handleItemFocus($event, entry)"
        @blur="!usesGridSemantics && emit('item-blur', entry.key, entry.item, $event)"
        @click="!usesGridSemantics && activateEntry(entry)"
        @keydown="!usesGridSemantics && handleKeydown($event, entry)"
      >
        <div
          v-if="usesGridSemantics"
          :ref="(element) => rememberSemanticElement(entry.key, element as Element | null, true)"
          class="bounded-results-item"
          :data-result-key="String(entry.key)"
          :class="{ 'is-selected': selectable && selectedKeys.includes(entry.key), 'is-disabled': entryDisabled(entry) }"
          role="gridcell"
          :aria-selected="selectable ? selectedKeys.includes(entry.key) : undefined"
          :aria-disabled="selectable && entryDisabled(entry) ? true : undefined"
          :aria-describedby="itemDescribedBy"
          :tabindex="activeKey === entry.key ? 0 : -1"
          @focus="handleItemFocus($event, entry)"
          @blur="emit('item-blur', entry.key, entry.item, $event)"
          @click="activateEntry(entry)"
          @keydown="handleKeydown($event, entry)"
        >
          <slot
            name="item"
            :item="entry.item"
            :item-key="entry.key"
            :index="entry.index"
            :selected="selectable && selectedKeys.includes(entry.key)"
          />
        </div>
        <slot
          v-else
          name="item"
          :item="entry.item"
          :item-key="entry.key"
          :index="entry.index"
          :selected="selectable && selectedKeys.includes(entry.key)"
        />
      </div>
    </div>

    <div
      v-if="showResults && continuousEnabled"
      ref="continuousBottomSentinel"
      class="bounded-results-continuation is-next"
    >
      <button v-if="continuousEndPage < resultWindow.pageCount" type="button" @click="loadNextContinuousPage">Load next results</button>
    </div>

    <footer v-if="showResults" class="bounded-results-footer">
      <span v-if="continuousEnabled">
        Showing {{ visibleFirstIndex.toLocaleString() }}–{{ visibleLastIndex.toLocaleString() }}
        of {{ resultWindow.totalCount.toLocaleString() }}
      </span>
      <span v-else>
        {{ (resultWindow.firstIndex + 1).toLocaleString() }}–{{ resultWindow.lastIndex.toLocaleString() }}
        of {{ resultWindow.totalCount.toLocaleString() }}
      </span>
      <nav v-if="!continuousEnabled && resultWindow.pageCount > 1" aria-label="Result pages">
        <button type="button" :disabled="!resultWindow.hasPrevious" @click="changePage(resultWindow.page - 1)">Previous</button>
        <span>Page {{ resultWindow.page }} of {{ resultWindow.pageCount }}</span>
        <button type="button" :disabled="!resultWindow.hasNext" @click="changePage(resultWindow.page + 1)">Next</button>
      </nav>
    </footer>
  </section>
</template>

<style scoped>
.bounded-results { min-width: 0; }
.bounded-results-collection { min-width: 0; }
.bounded-results-collection.is-list,
.bounded-results-collection.is-table { display: grid; }
.bounded-results-collection.is-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
  gap: var(--cc-space-5);
}
.bounded-results-row,
.bounded-results-item { min-width: 0; }
.bounded-results-row { height: 100%; }
.bounded-results-row > .bounded-results-item { height: 100%; }
.bounded-results-item { border-radius: var(--cc-radius-sm); }
.bounded-results-item[tabindex] { cursor: pointer; }
.bounded-results-item[tabindex]:focus-visible {
  outline: 2px solid var(--cc-focus);
  outline-offset: 2px;
}
.bounded-results-item.is-selected {
  background: var(--cc-accent-surface);
  box-shadow: inset 3px 0 var(--cc-accent);
}
.bounded-results-state {
  display: grid;
  min-height: 180px;
  place-items: center;
  align-content: center;
  gap: var(--cc-space-3);
  padding: var(--cc-space-8);
  border: 1px dashed var(--cc-border-default);
  border-radius: var(--cc-radius-md);
  color: var(--cc-text-muted);
  background: var(--cc-surface-1);
  text-align: center;
}
.bounded-results-state strong { color: var(--cc-text-primary); font-size: var(--cc-font-size-xl); }
.bounded-results-state p { max-width: 520px; margin: 0; line-height: var(--cc-line-body); }
.bounded-results-state.is-error { border-color: var(--cc-danger-border); background: var(--cc-danger-surface); }
.bounded-results-state button,
.bounded-results-footer button {
  min-height: var(--cc-control-height-sm);
  padding: 0 var(--cc-space-5);
  border: 1px solid var(--cc-border-strong);
  border-radius: var(--cc-radius-sm);
  color: var(--cc-text-primary);
  background: var(--cc-surface-3);
  cursor: pointer;
}
.bounded-results-state button:focus-visible,
.bounded-results-footer button:focus-visible { outline: 2px solid var(--cc-focus); outline-offset: 1px; }
.bounded-results-footer button:disabled { opacity: .35; cursor: default; }
.bounded-results-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--cc-border-strong);
  border-top-color: var(--cc-accent);
  border-radius: 50%;
  animation: bounded-results-spin .75s linear infinite;
}
.bounded-results-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--cc-space-5);
  padding: var(--cc-space-5) 0;
  color: var(--cc-text-muted);
  font-size: var(--cc-font-size-sm);
}
.bounded-results-footer nav { display: flex; align-items: center; gap: var(--cc-space-5); }
.bounded-results-leading-space { min-height: 0; pointer-events: none; }
.bounded-results-continuation {
  display: flex;
  min-height: 1px;
  justify-content: center;
}
.bounded-results-continuation button {
  min-height: var(--cc-control-height-sm);
  margin: var(--cc-space-3) 0;
  padding: 0 var(--cc-space-5);
  border: 1px solid var(--cc-border-strong);
  border-radius: var(--cc-radius-sm);
  color: var(--cc-text-primary);
  background: var(--cc-surface-3);
  cursor: pointer;
}

@keyframes bounded-results-spin { to { transform: rotate(360deg); } }

@media (max-width: 600px) {
  .bounded-results-footer { align-items: stretch; flex-direction: column; }
  .bounded-results-footer nav { justify-content: space-between; }
}
</style>
