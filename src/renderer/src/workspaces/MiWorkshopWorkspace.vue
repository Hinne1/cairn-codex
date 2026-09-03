<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CollectionAffix, CollectionItem, ObservedStashItem } from '@shared/contracts'
import { compileSearchQuery } from '@shared/search-query'
import { searchQueryOptions, searchSchemas } from '@shared/search-schema'
import BoundedResultSurface from '../components/BoundedResultSurface.vue'
import ExplorerToolbar from '../components/ExplorerToolbar.vue'
import RollCategoryProfile from '../components/RollCategoryProfile.vue'
import ToolHeader from '../components/ToolHeader.vue'
import { rollCategoryScores } from '../roll-rating'
import { searchGuidance } from '../search-guidance'
import {
  buildMiMetricOptions,
  createMiWorkshopProjectionControls,
  createMiWorkshopRows,
  miMetricLabel,
  miMetricResult,
  type MiWorkshopControls,
  type MiWorkshopRow,
  type MiWorkshopSession,
  updateMiWorkshopControls
} from './mi-workshop'

const props = defineProps<{
  items: readonly CollectionItem[]
  affixes: readonly CollectionAffix[]
  copies: readonly ObservedStashItem[]
  collected: number
  countingMode: 'base' | 'tier'
  affixesDiscovered: number
  session: MiWorkshopSession
  iconUrlForItem: (item: CollectionItem) => string | null
}>()

const emit = defineEmits<{
  'queue-tooltip': [item: CollectionItem, event: MouseEvent | FocusEvent | HTMLElement, copy: ObservedStashItem]
  'show-tooltip': [item: CollectionItem, element: HTMLElement, copy: ObservedStashItem]
  'move-tooltip': [event: MouseEvent]
  'hide-tooltip': []
  'open-item': [item: CollectionItem, referenceInstanceKey?: string]
}>()

const controls = defineModel<MiWorkshopControls>('controls', { required: true })
const workspaceElement = ref<HTMLElement | null>(null)
const affixSelect = ref<HTMLSelectElement | null>(null)
const metricSelect = ref<HTMLSelectElement | null>(null)
const sortSelect = ref<HTMLSelectElement | null>(null)
const directionSelect = ref<HTMLSelectElement | null>(null)

function controlModel<K extends keyof MiWorkshopControls>(key: K, resetPage = true) {
  return computed({
    get: () => controls.value[key],
    set: (value: MiWorkshopControls[K]) => {
      controls.value = updateMiWorkshopControls(controls.value, { [key]: value }, resetPage)
    }
  })
}

const query = controlModel('query')
const affix = controlModel('affix')
const metric = controlModel('metric')
const metricDirection = controlModel('metricDirection')
const sort = controlModel('sort')
const page = controlModel('page', false)
const showReserves = computed({
  get: () => props.session.showReserves.value,
  set: (show: boolean) => { props.session.showReserves.value = show }
})
const structuredQuery = computed(() => compileSearchQuery(query.value, searchQueryOptions(searchSchemas.miWorkshop)))
const metricOptions = computed(() => buildMiMetricOptions(props.copies))
const selectedMetricLabel = computed(() => miMetricLabel(metricOptions.value, metric.value))
const selectedCategoryKey = computed(() => metric.value.startsWith('category:')
  ? metric.value.slice('category:'.length)
  : null)
const projectionControls = createMiWorkshopProjectionControls(controls)
const rows = computed(() => createMiWorkshopRows({
  items: props.items,
  affixes: props.affixes,
  copies: props.copies,
  controls: projectionControls.value,
  query: structuredQuery.value
}))
const searchError = computed(() => {
  const error = structuredQuery.value.error
  if (!error) return null
  return error.fragment ? `${error.message} Check “${error.fragment}”.` : error.message
})

function showFocusedTooltip(_key: string | number, row: MiWorkshopRow, element: HTMLElement): void {
  emit('show-tooltip', row.base, element, row.leader)
}

function syncNativeControls(): void {
  const input = workspaceElement.value?.querySelector('.explorer-search input')
  if (input instanceof HTMLInputElement) input.value = query.value
  if (affixSelect.value) affixSelect.value.value = affix.value
  if (metricSelect.value) metricSelect.value.value = metric.value
  if (sortSelect.value) sortSelect.value.value = sort.value
  if (directionSelect.value) directionSelect.value.value = metricDirection.value
}

defineExpose({ syncNativeControls })
</script>

<template>
  <section ref="workspaceElement" class="mi-workshop" aria-label="Monster Infrequent workshop">
    <ToolHeader
      eyebrow="Monster Infrequent research"
      title="MI Workshop"
      description="Physical copies retain their exact level tier here regardless of the completion-counting preference. Affix combinations are grouped below, with the strongest rolled copy leading each group. Roll quality compares values within that exact base, prefix, and suffix; it does not judge whether the affixes fit a build."
      tone="green"
    >
      <template #aside>
        <label class="reserve-toggle">
          <input v-model="showReserves" type="checkbox" />
          Show archived copies
        </label>
      </template>
    </ToolHeader>
    <div class="mi-workshop-summary">
      <span><strong>{{ collected }}</strong> {{ countingMode === 'base' ? 'MI bases collected' : 'MI tiers collected' }}</span>
      <span><strong>{{ affixesDiscovered }}</strong> affixes discovered</span>
      <span><strong>{{ rows.length }}</strong> combinations retained</span>
    </div>
    <ExplorerToolbar
      v-model="query"
      v-bind="searchGuidance.miWorkshop"
      class="mi-explorer-toolbar"
      search-label="Search workshop"
      placeholder="Base, affix, stat, skill…"
      :result-count="rows.length"
      result-label="affix combinations"
      tone="green"
      :search-error="searchError"
    >
      <template #filters>
        <label>
          <span>Affix quality</span>
          <select ref="affixSelect" v-model="affix" autocomplete="off">
            <option value="all">All combinations</option>
            <option value="double-rare">Double rares only</option>
          </select>
        </label>
        <label>
          <span>Compare copies by</span>
          <select ref="metricSelect" v-model="metric" autocomplete="off">
            <optgroup label="Roll quality">
              <option v-for="option in metricOptions.quality" :key="option.key" :value="option.key">{{ option.label }}</option>
            </optgroup>
            <optgroup label="Item stats">
              <option v-for="option in metricOptions.item" :key="option.key" :value="option.key">{{ option.label }}</option>
            </optgroup>
            <optgroup label="Bonus to All Pets">
              <option v-for="option in metricOptions.pet" :key="option.key" :value="option.key">{{ option.label }}</option>
            </optgroup>
          </select>
        </label>
      </template>
      <template #sort>
        <label>
          <span>Sort by</span>
          <select ref="sortSelect" v-model="sort" autocomplete="off">
            <option value="metric">Selected comparison</option>
            <option value="level">Required level</option>
            <option value="name">MI name</option>
            <option value="copies">Stored copies</option>
          </select>
        </label>
        <label>
          <span>Order</span>
          <select ref="directionSelect" v-model="metricDirection" autocomplete="off">
            <option value="desc">Highest first</option>
            <option value="asc">Lowest first</option>
          </select>
        </label>
      </template>
    </ExplorerToolbar>
    <p id="mi-table-scroll-help" class="dense-table-scroll-hint">Wide comparison table. Focus this region and use Left/Right Arrow, Shift + mouse wheel, or its scrollbar to inspect every field.</p>
    <BoundedResultSurface
      v-model:page="page"
      class="mi-table-wrap mi-table-results bounded-tooltip-results"
      :items="rows"
      :get-key="row => row.key"
      :page-size="50"
      :empty-title="query ? 'No matching Monster Infrequents' : affix === 'double-rare' ? 'No double-rare combinations retained' : 'The Workshop is empty'"
      :empty-detail="query ? `No stored MI matches “${query}”.` : affix === 'double-rare' ? 'No stored MI has both a rare prefix and a rare suffix.' : 'Archive a Monster Infrequent to start building the Workshop.'"
      label="Monster Infrequent affix combinations"
      aria-describedby="mi-table-scroll-help"
      tabindex="0"
      layout="table"
      interactive
      item-described-by="item-tooltip"
      @activate="(_key, row) => emit('open-item', row.base, row.leader.instanceKey)"
      @item-focus="showFocusedTooltip"
      @item-blur="emit('hide-tooltip')"
    >
      <template #header>
        <div class="mi-table-header" role="row">
          <span role="columnheader">MI base</span>
          <span role="columnheader">Level</span>
          <span role="columnheader">Prefix</span>
          <span role="columnheader">Suffix</span>
          <span role="columnheader">{{ selectedMetricLabel }}</span>
          <span role="columnheader">Stored</span>
        </div>
      </template>
      <template #item="{ item: row }">
        <div
          class="mi-table-row"
          @mouseenter="emit('queue-tooltip', row.base, $event, row.leader)"
          @mousemove="emit('move-tooltip', $event)"
          @mouseleave="emit('hide-tooltip')"
        >
          <span role="gridcell">
            <span class="mi-base-cell">
              <img v-if="iconUrlForItem(row.base)" :src="iconUrlForItem(row.base)!" alt="" />
              <strong>{{ row.base.name }}</strong>
            </span>
          </span>
          <span role="gridcell">{{ row.base.levelRequirement }}</span>
          <span role="gridcell" :class="['affix-name', row.prefixRarity]">{{ row.prefix }}</span>
          <span role="gridcell" :class="['affix-name', row.suffixRarity]">{{ row.suffix }}</span>
          <span role="gridcell" class="mi-score-breakdown">
            <span class="mi-selected-score"><small>Selected</small><strong>{{ row.selectedMetric.display }}</strong></span>
            <RollCategoryProfile
              :scores="rollCategoryScores(row.leader.rollAnalysis)"
              :exclude-key="selectedCategoryKey"
              :max-visible="4"
              compact
            />
          </span>
          <span role="gridcell" class="mi-stored-cell">
            <strong>{{ row.copies.length }}</strong>
            <small v-if="row.copies.length > 1">1 leader · {{ row.copies.length - 1 }} archived</small>
            <span v-if="showReserves && row.copies.length > 1" class="reserve-scores">
              {{ row.copies.slice(1).map((copy) => miMetricResult(copy, metric).display).join(' · ') }}
            </span>
          </span>
        </div>
      </template>
    </BoundedResultSurface>
  </section>
</template>
