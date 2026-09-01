<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CollectionItem } from '@shared/contracts'
import { compileSearchQuery } from '@shared/search-query'
import { searchQueryOptions, searchSchemas } from '@shared/search-schema'
import type { SkillSort } from '../app-route'
import BoundedResultSurface from '../components/BoundedResultSurface.vue'
import ExplorerToolbar from '../components/ExplorerToolbar.vue'
import ToolHeader from '../components/ToolHeader.vue'
import { searchGuidance } from '../search-guidance'
import {
  createSkillExplorerRows,
  nextSkillSortControls,
  type SkillExplorerControls,
  updateSkillExplorerControls
} from './skill-explorer'

const props = defineProps<{
  items: readonly CollectionItem[]
  skillNames: readonly string[]
  isArchivedItem: (item: CollectionItem) => boolean
  iconUrlForItem: (item: CollectionItem) => string | null
  ownershipLabelForItem: (item: CollectionItem) => string | null
}>()

const emit = defineEmits<{
  'queue-tooltip': [item: CollectionItem, event: MouseEvent | FocusEvent | HTMLElement]
  'show-tooltip': [item: CollectionItem, element: HTMLElement]
  'move-tooltip': [event: MouseEvent]
  'hide-tooltip': []
  'open-item': [item: CollectionItem]
}>()

const controls = defineModel<SkillExplorerControls>('controls', { required: true })
const pickerOpen = ref(false)
const pickerIndex = ref(0)

function controlModel<K extends keyof SkillExplorerControls>(key: K, resetPage = true) {
  return computed({
    get: () => controls.value[key],
    set: (value: SkillExplorerControls[K]) => {
      controls.value = updateSkillExplorerControls(controls.value, { [key]: value }, resetPage)
    }
  })
}

const selectedSkill = controlModel('skill')
const query = controlModel('query')
const scope = controlModel('scope')
const rarity = controlModel('rarity')
const slot = controlModel('slot')
const sort = controlModel('sort')
const direction = controlModel('direction')
const page = controlModel('page', false)
const structuredQuery = computed(() => compileSearchQuery(query.value, searchQueryOptions(searchSchemas.skillItems)))
const rows = computed(() => createSkillExplorerRows(props.items, controls.value, {
  isArchivedItem: props.isArchivedItem,
  query: structuredQuery.value
}))
const slotOptions = computed(() => [...new Set(props.items.map((item) => item.slot).filter(Boolean))]
  .sort((left, right) => left.localeCompare(right)))
const suggestions = computed(() => {
  const needle = selectedSkill.value.trim().toLocaleLowerCase()
  return props.skillNames
    .filter((skill) => !needle || skill.toLocaleLowerCase().includes(needle))
    .sort((left, right) => {
      const leftStarts = left.toLocaleLowerCase().startsWith(needle)
      const rightStarts = right.toLocaleLowerCase().startsWith(needle)
      if (leftStarts !== rightStarts) return leftStarts ? -1 : 1
      return left.localeCompare(right)
    })
    .slice(0, 40)
})
const searchError = computed(() => {
  const error = structuredQuery.value.error
  if (!error) return null
  return error.fragment ? `${error.message} Check “${error.fragment}”.` : error.message
})

function openPicker(): void {
  pickerOpen.value = true
  const exact = suggestions.value.findIndex(
    (skill) => skill.toLocaleLowerCase() === selectedSkill.value.trim().toLocaleLowerCase()
  )
  pickerIndex.value = exact >= 0 ? exact : 0
}

function selectSkill(skill: string): void {
  selectedSkill.value = skill
  pickerOpen.value = false
}

function handlePickerKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    pickerOpen.value = false
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!pickerOpen.value) openPicker()
    const step = event.key === 'ArrowDown' ? 1 : -1
    const count = suggestions.value.length
    if (count > 0) pickerIndex.value = (pickerIndex.value + step + count) % count
    return
  }
  if (event.key === 'Enter' && pickerOpen.value) {
    const suggestion = suggestions.value[pickerIndex.value]
    if (suggestion) {
      event.preventDefault()
      selectSkill(suggestion)
    }
  }
}

function handlePickerFocusOut(event: FocusEvent): void {
  const container = event.currentTarget as HTMLElement
  if (event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) return
  pickerOpen.value = false
}

function changeSort(next: SkillSort): void {
  controls.value = nextSkillSortControls(controls.value, next)
}

function showFocusedTooltip(_key: string | number, row: { item: CollectionItem }, element: HTMLElement): void {
  emit('show-tooltip', row.item, element)
}
</script>

<template>
  <section class="skill-explorer" aria-label="Skill item explorer">
    <ToolHeader
      eyebrow="Build research prototype"
      title="Items for a skill"
      description="Choose a skill to compare direct rank bonuses, damage conversions, special modifiers, and level requirements."
    />
    <div class="skill-picker">
      <div class="skill-combobox" @focusout="handlePickerFocusOut">
        <label for="skill-picker-input">Skill</label>
        <span class="skill-input-wrap">
          <input
            id="skill-picker-input"
            v-model="selectedSkill"
            type="text"
            role="combobox"
            autocomplete="off"
            aria-autocomplete="list"
            :aria-expanded="pickerOpen"
            aria-controls="skill-name-options"
            placeholder="Choose or type a skill…"
            @focus="openPicker"
            @input="pickerOpen = true; pickerIndex = 0"
            @keydown="handlePickerKey"
          />
          <button v-if="selectedSkill" type="button" aria-label="Clear selected skill" @click="selectedSkill = ''; openPicker()">×</button>
        </span>
        <span v-if="pickerOpen" id="skill-name-options" class="skill-suggestions" role="listbox">
          <button
            v-for="(skill, index) in suggestions"
            :key="skill"
            type="button"
            role="option"
            :aria-selected="index === pickerIndex"
            :class="{ active: index === pickerIndex }"
            @mouseenter="pickerIndex = index"
            @click="selectSkill(skill)"
          >{{ skill }}</button>
          <small v-if="suggestions.length === 0">No indexed skill matches that text.</small>
        </span>
      </div>
    </div>
    <ExplorerToolbar
      v-model="query"
      v-bind="searchGuidance.skillItems"
      class="skill-explorer-toolbar"
      search-label="Search matching items"
      placeholder="Item, slot, modifier, damage type…"
      :result-count="rows.length"
      result-label="matching items"
      :search-error="searchError"
    >
      <template #filters>
        <label><span>Availability</span><select v-model="scope" autocomplete="off"><option value="all">All catalog items</option><option value="archive">My Archive</option></select></label>
        <label><span>Rarity</span><select v-model="rarity" autocomplete="off"><option value="all">All rarities</option><option value="legendary">Legendary</option><option value="epic">Epic</option><option value="mi">Monster Infrequent</option><option value="rare">Rare</option></select></label>
        <label><span>Slot</span><select v-model="slot" autocomplete="off"><option value="all">All slots</option><option v-for="option in slotOptions" :key="option" :value="option">{{ option }}</option></select></label>
      </template>
      <template #sort>
        <label><span>Sort by</span><select v-model="sort" autocomplete="off"><option value="amount">Ranks & modifiers</option><option value="item">Item name</option><option value="slot">Slot</option><option value="conversion">Conversion target</option><option value="special">Special modifier</option><option value="level">Required level</option></select></label>
        <label><span>Order</span><select v-model="direction" autocomplete="off"><option value="desc">Highest first</option><option value="asc">Lowest first</option></select></label>
      </template>
    </ExplorerToolbar>
    <p id="skill-table-scroll-help" class="dense-table-scroll-hint">Wide comparison table. Focus this region and use Left/Right Arrow, Shift + mouse wheel, or its scrollbar to inspect every field.</p>
    <BoundedResultSurface
      v-model:page="page"
      class="skill-table-wrap skill-table-results bounded-tooltip-results"
      :items="rows"
      :get-key="row => row.item.record"
      :page-size="50"
      :empty-title="selectedSkill ? 'No matching items' : 'Choose a skill to begin'"
      :empty-detail="selectedSkill ? (query || rarity !== 'all' || slot !== 'all' ? 'No items match the current search and filters.' : 'No matching items in this availability scope.') : 'Select an indexed skill to compare its supporting items.'"
      label="Items matching the selected skill"
      aria-describedby="skill-table-scroll-help"
      tabindex="0"
      layout="table"
      interactive
      item-described-by="item-tooltip"
      @activate="(_key, row) => emit('open-item', row.item)"
      @item-focus="showFocusedTooltip"
      @item-blur="emit('hide-tooltip')"
    >
      <template #header>
        <div class="skill-table-header" role="row">
          <span role="columnheader"><button type="button" @click="changeSort('item')">Item {{ sort === 'item' ? (direction === 'asc' ? '↑' : '↓') : '' }}</button></span>
          <span role="columnheader"><button type="button" @click="changeSort('slot')">Slot <template v-if="sort === 'slot'">{{ direction === 'asc' ? '↑' : '↓' }}</template></button></span>
          <span role="columnheader"><button type="button" @click="changeSort('amount')">Ranks {{ sort === 'amount' ? (direction === 'asc' ? '↑' : '↓') : '' }}</button></span>
          <span role="columnheader"><button type="button" @click="changeSort('conversion')">Target {{ sort === 'conversion' ? (direction === 'asc' ? '↑' : '↓') : '' }}</button></span>
          <span role="columnheader">Conversion details</span>
          <span role="columnheader"><button type="button" @click="changeSort('special')">Special modifier <template v-if="sort === 'special'">{{ direction === 'asc' ? '↑' : '↓' }}</template></button></span>
          <span role="columnheader"><button type="button" @click="changeSort('level')">Level {{ sort === 'level' ? (direction === 'asc' ? '↑' : '↓') : '' }}</button></span>
        </div>
      </template>
      <template #item="{ item: row }">
        <div class="skill-table-row" @mouseenter="emit('queue-tooltip', row.item, $event)" @mousemove="emit('move-tooltip', $event)" @mouseleave="emit('hide-tooltip')">
          <span role="gridcell"><span class="skill-item-name"><img v-if="iconUrlForItem(row.item)" :src="iconUrlForItem(row.item)!" alt="" /><span><strong>{{ row.item.name }}</strong><small>{{ row.item.rarity }}<template v-if="ownershipLabelForItem(row.item)"> · {{ ownershipLabelForItem(row.item) }}</template></small></span></span></span>
          <span role="gridcell">{{ row.item.slot }}</span>
          <span role="gridcell" class="skill-amount">{{ row.amount > 0 ? `+${row.amount}` : '—' }}</span>
          <span role="gridcell" class="skill-conversion-target">{{ row.conversionTarget || '—' }}</span>
          <span role="gridcell">{{ row.conversionDetails || '—' }}</span>
          <span role="gridcell">{{ row.special || '—' }}</span>
          <span role="gridcell">{{ row.item.levelRequirement }}</span>
        </div>
      </template>
    </BoundedResultSurface>
  </section>
</template>
