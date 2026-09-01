<script setup lang="ts" generic="T">
import { computed, nextTick, ref, watch } from 'vue'
import {
  createBoundedResultWindow,
  moveBoundedResultKey,
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
  layout?: 'list' | 'grid' | 'table'
  loading?: boolean
  error?: string | null
  emptyTitle?: string
  emptyDetail?: string
  selectionMode?: BoundedSelectionMode
  selectedKeys?: readonly BoundedResultKey[]
  selectionDisabled?: boolean
  interactive?: boolean
  itemDescribedBy?: string
  keyboardColumns?: number
}>(), {
  page: 1,
  pageSize: 50,
  totalCount: undefined,
  remote: false,
  layout: 'list',
  loading: false,
  error: null,
  emptyTitle: 'No results',
  emptyDetail: 'Try changing the search or filters.',
  selectionMode: 'none',
  selectedKeys: () => [],
  selectionDisabled: false,
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
const resultWindow = computed(() => createBoundedResultWindow({
  items: props.items,
  getKey: props.getKey,
  page: props.page,
  pageSize: props.pageSize,
  totalCount: props.totalCount,
  remote: props.remote
}))
const entryKeys = computed(() => resultWindow.value.entries.map((entry) => entry.key))
const showResults = computed(() => !props.loading && !props.error && resultWindow.value.entries.length > 0)
const selectable = computed(() => props.selectionMode !== 'none')
const focusable = computed(() => selectable.value || props.interactive)
const collectionRole = computed(() => props.layout === 'list'
  ? (selectable.value ? 'listbox' : 'list')
  : 'grid')
const itemRole = computed(() => props.layout === 'list'
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

function rememberElement(key: BoundedResultKey, element: Element | null): void {
  if (element instanceof HTMLElement) itemElements.set(key, element)
  else itemElements.delete(key)
}

function select(key: BoundedResultKey): void {
  activeKey.value = key
  if (selectable.value && !props.selectionDisabled) {
    emit('update:selectedKeys', updateBoundedSelection(props.selectedKeys, key, props.selectionMode))
  }
}

function activateEntry(entry: { key: BoundedResultKey, item: T }): void {
  select(entry.key)
  if (props.interactive) emit('activate', entry.key, entry.item)
}

function handleItemFocus(event: FocusEvent, entry: { key: BoundedResultKey, item: T }): void {
  activeKey.value = entry.key
  const element = event.target instanceof HTMLElement ? event.target : itemElements.get(entry.key)
  if (element) emit('item-focus', entry.key, entry.item, element)
}

function focusKey(key: BoundedResultKey | null): void {
  if (key === null) return
  activeKey.value = key
  void nextTick(() => itemElements.get(key)?.focus())
}

function navigate(intent: BoundedNavigationIntent): void {
  const columns = props.layout === 'grid' ? visibleGridColumns() : props.keyboardColumns
  focusKey(moveBoundedResultKey(entryKeys.value, activeKey.value, intent, columns))
}

function visibleGridColumns(): number {
  const first = itemElements.get(entryKeys.value[0] ?? '')
  if (!first) return Math.max(1, props.keyboardColumns)
  const firstTop = first.offsetTop
  const count = entryKeys.value.findIndex((key) => itemElements.get(key)?.offsetTop !== firstTop)
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
    if (props.selectionDisabled) return
    activateEntry(entry)
  }
}

function changePage(page: number): void {
  const bounded = Math.min(Math.max(page, 1), resultWindow.value.pageCount)
  if (bounded !== resultWindow.value.page) emit('update:page', bounded)
}
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
      v-if="showResults"
      :class="['bounded-results-collection', `is-${layout}`]"
      :role="collectionRole"
      :aria-label="label"
      :aria-multiselectable="selectionMode === 'multiple' ? true : undefined"
    >
      <slot name="header" />
      <div
        v-for="entry in resultWindow.entries"
        :key="entry.key"
        :ref="(element) => rememberElement(entry.key, element as Element | null)"
        class="bounded-results-item"
        :class="{ 'is-selected': selectable && selectedKeys.includes(entry.key) }"
        :role="itemRole"
        :aria-selected="selectable ? selectedKeys.includes(entry.key) : undefined"
        :aria-disabled="selectable && selectionDisabled ? true : undefined"
        :aria-describedby="itemDescribedBy"
        :tabindex="focusable ? (activeKey === entry.key ? 0 : -1) : undefined"
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
    </div>

    <footer v-if="showResults" class="bounded-results-footer">
      <span>
        {{ (resultWindow.firstIndex + 1).toLocaleString() }}–{{ resultWindow.lastIndex.toLocaleString() }}
        of {{ resultWindow.totalCount.toLocaleString() }}
      </span>
      <nav v-if="resultWindow.pageCount > 1" aria-label="Result pages">
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
.bounded-results-item { min-width: 0; border-radius: var(--cc-radius-sm); }
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

@keyframes bounded-results-spin { to { transform: rotate(360deg); } }

@media (max-width: 600px) {
  .bounded-results-footer { align-items: stretch; flex-direction: column; }
  .bounded-results-footer nav { justify-content: space-between; }
}
</style>
