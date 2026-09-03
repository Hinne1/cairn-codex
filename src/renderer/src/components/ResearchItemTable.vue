<script setup lang="ts">
import { ref } from 'vue'
import type { CollectionItem } from '@shared/contracts'
import BoundedResultSurface from './BoundedResultSurface.vue'
import type {
  ResearchItemTableColumn,
  ResearchItemTableRow
} from '../workspaces/research-item-table'

const props = withDefaults(defineProps<{
  rows: readonly ResearchItemTableRow[]
  label: string
  emptyTitle: string
  emptyDetail: string
  iconUrlForItem: (item: CollectionItem) => string | null
  page?: number
  pagination?: 'pages' | 'continuous'
  sort?: string
  direction?: 'asc' | 'desc'
  sortColumns?: Partial<Record<ResearchItemTableColumn, string>>
  actions?: boolean
  ignoredView?: boolean
}>(), {
  page: 1,
  pagination: 'pages',
  sort: undefined,
  direction: 'asc',
  sortColumns: () => ({}),
  actions: false,
  ignoredView: false
})

const emit = defineEmits<{
  'update:page': [page: number]
  sort: [sort: string]
  activate: [item: CollectionItem]
  'queue-tooltip': [item: CollectionItem, event: MouseEvent]
  'show-tooltip': [item: CollectionItem, element: HTMLElement]
  'move-tooltip': [event: MouseEvent]
  'scroll-tooltip': [event: WheelEvent]
  'hide-tooltip': []
  favorite: [item: CollectionItem]
  ignore: [item: CollectionItem]
}>()

const columns: readonly { key: ResearchItemTableColumn, label: string }[] = [
  { key: 'item', label: 'Item' },
  { key: 'level', label: 'Level' },
  { key: 'slot', label: 'Slot' },
  { key: 'supports', label: 'Supports' },
  { key: 'modifiers', label: 'Skill modifiers' },
  { key: 'acquisition', label: 'Acquisition' },
  { key: 'archive', label: 'Archive / roll' }
]

const failedIconUrls = ref(new Set<string>())

function itemImageUrl(item: CollectionItem): string | null {
  const url = props.iconUrlForItem(item)
  return url && !failedIconUrls.value.has(url) ? url : null
}

function handleImageError(item: CollectionItem): void {
  const url = props.iconUrlForItem(item)
  if (!url) return
  failedIconUrls.value = new Set([...failedIconUrls.value, url])
}

function ariaSort(column: ResearchItemTableColumn): 'ascending' | 'descending' | undefined {
  if (!props.sort || props.sortColumns[column] !== props.sort) return undefined
  return props.direction === 'asc' ? 'ascending' : 'descending'
}

function showFocusedTooltip(_key: string | number, row: ResearchItemTableRow, element: HTMLElement): void {
  emit('show-tooltip', row.item, element)
}

function scrollTableHorizontally(event: WheelEvent): void {
  if (!event.shiftKey || event.ctrlKey || event.metaKey) return
  const table = event.currentTarget
  if (!(table instanceof HTMLElement)) return
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  const nextScrollLeft = Math.max(0, Math.min(table.scrollLeft + delta, table.scrollWidth - table.clientWidth))
  if (nextScrollLeft === table.scrollLeft) return
  event.preventDefault()
  event.stopPropagation()
  table.scrollLeft = nextScrollLeft
}
</script>

<template>
  <div class="research-table-region">
    <p :id="`${label.replace(/[^a-z0-9]+/gi, '-').toLocaleLowerCase()}-scroll-help`" class="dense-table-scroll-hint">
      Wide comparison table. Focus this region and use Left/Right Arrow, Shift + mouse wheel, or its scrollbar to inspect every field. Item previews open from the item cell.
    </p>
    <BoundedResultSurface
      :page="page"
      class="research-item-table bounded-tooltip-results"
      :items="rows"
      :get-key="row => row.item.record"
      :page-size="50"
      :pagination="pagination"
      :empty-title="emptyTitle"
      :empty-detail="emptyDetail"
      :label="label"
      :aria-describedby="`${label.replace(/[^a-z0-9]+/gi, '-').toLocaleLowerCase()}-scroll-help`"
      tabindex="0"
      layout="table"
      interactive
      item-described-by="item-tooltip"
      @update:page="emit('update:page', $event)"
      @activate="(_key, row) => emit('activate', row.item)"
      @item-focus="showFocusedTooltip"
      @item-blur="emit('hide-tooltip')"
      @wheel.shift="scrollTableHorizontally"
    >
      <template #header>
        <div class="research-table-header" role="row">
          <span
            v-for="column in columns"
            :key="column.key"
            :class="`research-${column.key}`"
            role="columnheader"
            :aria-sort="ariaSort(column.key)"
          >
            <button
              v-if="sortColumns[column.key]"
              type="button"
              @click="emit('sort', sortColumns[column.key]!)"
            >
              {{ column.label }}
              <span v-if="sortColumns[column.key] === sort" aria-hidden="true">{{ direction === 'asc' ? '↑' : '↓' }}</span>
            </button>
            <template v-else>{{ column.label }}</template>
          </span>
        </div>
      </template>
      <template #item="{ item: row }">
        <div class="research-table-row" :class="{ favorite: row.favorite, ignored: row.ignored }">
          <span
            role="gridcell"
            class="research-item"
            @mouseenter="emit('queue-tooltip', row.item, $event)"
            @mousemove="emit('move-tooltip', $event)"
            @mouseleave="emit('hide-tooltip')"
            @wheel="emit('scroll-tooltip', $event)"
          >
            <span class="research-item-identity">
              <span class="research-item-picture">
                <img v-if="itemImageUrl(row.item)" :src="itemImageUrl(row.item)!" alt="" @error="handleImageError(row.item)" />
                <small v-else class="research-item-placeholder" aria-hidden="true">{{ row.item.slot.slice(0, 2).toLocaleUpperCase() }}</small>
              </span>
              <span class="research-item-copy">
                <strong :class="['gd-rarity-name', `rarity-${row.item.rarity}`]">{{ row.item.name }}</strong>
                <small>{{ row.itemType }}</small>
                <span v-if="actions" class="research-item-actions">
                  <button
                    type="button"
                    :class="{ active: row.favorite }"
                    :aria-label="`${row.favorite ? 'Unfavorite' : 'Favorite'} ${row.item.name}`"
                    @click.stop="emit('favorite', row.item)"
                  >★ <span>Favorite</span></button>
                  <button type="button" @click.stop="emit('ignore', row.item)">{{ ignoredView ? 'Restore' : 'Ignore' }}</button>
                </span>
              </span>
            </span>
          </span>
          <span role="gridcell" class="research-level">{{ row.item.levelRequirement }}</span>
          <span role="gridcell" class="research-slot">{{ row.item.slot }}</span>
          <span role="gridcell" class="research-supports">
            <em v-for="(fact, index) in row.supports" :key="`${fact.label}:${fact.text}:${index}`" :data-tone="fact.tone ?? 'default'">
              <b v-if="fact.label">{{ fact.label }}</b>{{ fact.label ? ' ' : '' }}{{ fact.text }}
            </em>
            <small v-if="row.supports.length === 0">—</small>
          </span>
          <span role="gridcell" class="research-modifiers">
            <span v-for="(fact, index) in row.modifiers" :key="`${fact.kind}:${fact.label}:${fact.text}:${index}`" :data-tone="fact.tone ?? 'default'" :data-modifier-kind="fact.kind">
              <b v-if="fact.label">{{ fact.label }}</b>{{ fact.label ? ' ' : '' }}{{ fact.text }}
            </span>
            <small v-if="row.modifiers.length === 0">—</small>
          </span>
          <span role="gridcell" class="research-acquisition">
            <span v-for="(fact, index) in row.acquisition" :key="`${fact.label}:${fact.text}:${index}`" :data-tone="fact.tone ?? 'default'">
              <b v-if="fact.label">{{ fact.label }}</b>{{ fact.label ? ' · ' : '' }}{{ fact.text }}
            </span>
            <small v-if="row.acquisition.length === 0">—</small>
          </span>
          <span role="gridcell" class="research-archive">
            <span v-for="(fact, index) in row.archive" :key="`${fact.label}:${fact.text}:${index}`" :data-tone="fact.tone ?? 'default'">
              <b v-if="fact.label">{{ fact.label }}</b>{{ fact.label ? ' ' : '' }}{{ fact.text }}
            </span>
            <small v-if="row.archive.length === 0">Not archived</small>
          </span>
        </div>
      </template>
    </BoundedResultSurface>
  </div>
</template>

<style scoped>
.research-table-region { min-width: 0; }
.research-item-table {
  max-width: 100%;
  min-width: 0;
  overflow: auto;
  overscroll-behavior-x: contain;
  overscroll-behavior-y: auto;
  scrollbar-gutter: stable;
  border: 1px solid var(--cc-tone-border);
  border-radius: var(--cc-radius-lg);
  background: var(--cc-tone-surface);
}
.research-item-table :deep(.bounded-results-collection) { min-width: 1500px; }
.research-table-header,
.research-table-row {
  display: grid;
  grid-template-columns: 310px 72px 110px 220px minmax(320px, 1fr) 260px 190px;
}
.research-table-header {
  color: var(--cc-tone-muted);
  background: var(--cc-surface-3);
  font-size: var(--cc-font-size-xs);
  letter-spacing: var(--cc-letter-label);
  text-transform: uppercase;
}
.research-table-header > span {
  display: flex;
  min-height: 42px;
  align-items: center;
  padding: var(--cc-space-4) var(--cc-space-5);
  border-right: 1px solid var(--cc-border-subtle);
  border-bottom: 1px solid var(--cc-tone-border);
}
.research-table-header > span:last-child,
.research-table-row > span:last-child { border-right: 0; }
.research-table-header button {
  display: inline-flex;
  min-height: 24px;
  align-items: center;
  gap: var(--cc-space-2);
  padding: 0;
  border: 0;
  color: inherit;
  background: none;
  cursor: pointer;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
}
.research-table-header button:hover { color: var(--cc-tone-accent-soft); }
.research-table-row > span {
  display: grid;
  min-width: 0;
  min-height: 88px;
  align-content: center;
  gap: var(--cc-space-2);
  padding: var(--cc-space-5);
  border-right: 1px solid var(--cc-border-subtle);
  border-bottom: 1px solid var(--cc-border-subtle);
  color: var(--cc-text-secondary);
  font-size: var(--cc-font-size-md);
  line-height: var(--cc-line-body);
}
.research-item-table :deep(.bounded-results-item) { border-radius: 0; transition: background var(--cc-transition-fast); }
.research-item-table :deep(.bounded-results-item:hover) { background: var(--cc-accent-surface-hover); }
.research-table-row.favorite { box-shadow: inset 3px 0 var(--cc-accent); }
.research-table-row.ignored { opacity: .7; }
.research-item-identity { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: var(--cc-space-4); align-items: center; }
.research-item-picture {
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  border: 1px solid var(--cc-border-default);
  border-radius: var(--cc-radius-md);
  background: var(--cc-surface-1);
  cursor: help;
}
.research-item:hover .research-item-picture { border-color: var(--cc-tone-accent); box-shadow: var(--cc-shadow-focus); }
.research-item-picture img { max-width: 58px; max-height: 58px; object-fit: contain; }
.research-item-placeholder { color: var(--cc-tone-accent); font: 600 var(--cc-font-size-xl) var(--cc-font-display); letter-spacing: var(--cc-letter-label); }
.research-item-copy { display: grid; min-width: 0; gap: var(--cc-space-1); }
.research-item-copy strong { font-family: var(--cc-font-display); font-size: var(--cc-font-size-xl); line-height: var(--cc-line-compact); }
.research-item-copy small,
.research-table-row small { color: var(--cc-text-muted); }
.research-table-row .research-level { justify-items: center; color: var(--semantic-level); font: 600 var(--cc-font-size-2xl) var(--cc-font-display); text-align: center; }
.research-supports em {
  width: fit-content;
  padding: var(--cc-space-1) var(--cc-space-2);
  border: 1px solid var(--cc-tone-border);
  border-radius: var(--cc-radius-pill);
  color: var(--cc-tone-accent-soft);
  background: var(--cc-surface-2);
  font-size: var(--cc-font-size-sm);
  font-style: normal;
}
.research-table-row [data-tone='accent'] { color: var(--cc-tone-accent-soft); }
.research-table-row [data-tone='positive'] { color: var(--cc-success); }
.research-table-row [data-tone='muted'] { color: var(--cc-text-muted); }
.research-table-row [data-tone='warning'] { color: var(--cc-warning); }
.research-table-row b { color: var(--cc-text-primary); font-weight: 600; }
.research-item-actions { display: flex; flex-wrap: wrap; gap: var(--cc-space-1); margin-top: var(--cc-space-1); }
.research-item-actions button {
  min-height: 24px;
  padding: 0 var(--cc-space-2);
  border: 1px solid var(--cc-border-default);
  border-radius: var(--cc-radius-xs);
  color: var(--cc-text-muted);
  background: var(--cc-surface-2);
  cursor: pointer;
  font-size: var(--cc-font-size-xs);
}
.research-item-actions button.active { border-color: var(--cc-accent-border); color: var(--cc-accent-strong); background: var(--cc-accent-surface); }
.research-item-actions button:focus-visible { outline: 2px solid var(--cc-focus); outline-offset: 1px; }

@media (max-width: 700px) {
  .research-item-table :deep(.bounded-results-collection) { min-width: 1260px; }
  .research-table-header,
  .research-table-row { grid-template-columns: 250px 62px 92px 180px minmax(270px, 1fr) 220px 170px; }
  .research-table-header > span:first-child,
  .research-table-row > span:first-child {
    position: sticky;
    z-index: 1;
    left: 0;
    background: var(--cc-surface-2);
    box-shadow: 1px 0 var(--cc-border-default);
  }
  .research-table-header > span:first-child { z-index: 3; background: var(--cc-surface-3); }
  .research-item-identity { grid-template-columns: 54px minmax(0, 1fr); }
  .research-item-picture { width: 54px; height: 54px; }
  .research-item-picture img { max-width: 48px; max-height: 48px; }
  .research-item-actions button span { display: none; }
}
</style>
