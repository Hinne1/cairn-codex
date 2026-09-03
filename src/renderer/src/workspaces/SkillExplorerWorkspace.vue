<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import type { CollectionItem } from '@shared/contracts'
import { compileSearchQuery } from '@shared/search-query'
import { searchQueryOptions, searchSchemas } from '@shared/search-schema'
import ExplorerToolbar from '../components/ExplorerToolbar.vue'
import ResearchItemTable from '../components/ResearchItemTable.vue'
import ToolHeader from '../components/ToolHeader.vue'
import { searchGuidance } from '../search-guidance'
import {
  createSkillExplorerRows,
  nextSkillSuggestionIndex,
  nextSkillSortControls,
  type SkillExplorerControls,
  updateSkillExplorerControls
} from './skill-explorer'
import {
  researchAcquisitionFacts,
  researchItemTypeLabel,
  researchRollFact,
  researchSkillName,
  type ResearchItemTableColumn,
  type ResearchItemTableRow
} from './research-item-table'

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
  'scroll-tooltip': [event: WheelEvent]
  'hide-tooltip': []
  'open-item': [item: CollectionItem]
}>()

const controls = defineModel<SkillExplorerControls>('controls', { required: true })
const pickerOpen = ref(false)
const pickerIndex = ref(0)
const skillListboxId = `skill-name-options-${useId()}`

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
const researchRows = computed<ResearchItemTableRow[]>(() => rows.value.map((row) => {
  const ownership = props.ownershipLabelForItem(row.item)
  const roll = researchRollFact(row.item)
  return {
    item: row.item,
    itemType: researchItemTypeLabel(row.item),
    supports: [{
      label: researchSkillName(row.skill),
      text: row.amount > 0 ? `+${row.amount}` : 'Modifier',
      tone: 'accent'
    }],
    modifiers: [
      ...(row.conversionTarget ? [{
        kind: 'conversion' as const,
        label: 'Converts to',
        text: row.conversionTarget,
        tone: 'accent' as const,
        skill: researchSkillName(row.skill),
        targetDamageType: row.conversionTarget
      }] : []),
      ...(row.conversionDetails ? [{ kind: 'conversion' as const, text: row.conversionDetails, skill: researchSkillName(row.skill) }] : []),
      ...(row.special ? [{ kind: 'special' as const, label: 'Modifier', text: row.special, skill: researchSkillName(row.skill) }] : []),
      ...(row.visualTransformation ? [{ kind: 'visual' as const, label: 'Visual', text: row.visualTransformation, tone: 'positive' as const, skill: researchSkillName(row.skill) }] : [])
    ],
    acquisition: researchAcquisitionFacts(row.item),
    archive: [
      ...(ownership ? [{ text: ownership, tone: 'positive' as const }] : [{ text: 'Not archived', tone: 'muted' as const }]),
      ...(roll ? [roll] : [])
    ]
  }
}))
const tableSortColumns = computed<Partial<Record<ResearchItemTableColumn, string>>>(() => ({
  item: 'item',
  level: 'level',
  slot: 'slot',
  supports: 'amount',
  modifiers: sort.value === 'conversion' ? 'conversion' : 'special'
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
const skillOptionIds = computed(() => new Map(
  props.skillNames.map((skill, index) => [skill, `${skillListboxId}-option-${index}`])
))
const activeSuggestion = computed(() => pickerOpen.value ? suggestions.value[pickerIndex.value] : undefined)
const activeSuggestionId = computed(() => {
  const skill = activeSuggestion.value
  return skill ? skillOptionIds.value.get(skill) : undefined
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
  revealActiveSuggestion()
}

function revealActiveSuggestion(): void {
  void nextTick(() => {
    const optionId = activeSuggestionId.value
    const listbox = document.getElementById(skillListboxId)
    const option = optionId ? document.getElementById(optionId) : null
    if (!(listbox instanceof HTMLElement) || !(option instanceof HTMLElement)) return
    const optionTop = option.offsetTop
    const optionBottom = optionTop + option.offsetHeight
    if (optionTop < listbox.scrollTop) listbox.scrollTop = optionTop
    else if (optionBottom > listbox.scrollTop + listbox.clientHeight) {
      listbox.scrollTop = optionBottom - listbox.clientHeight
    }
  })
}

function handlePickerInput(): void {
  pickerOpen.value = true
  pickerIndex.value = 0
  revealActiveSuggestion()
}

function selectSkill(skill: string): void {
  selectedSkill.value = researchSkillName(skill)
  pickerOpen.value = false
}

function handlePickerKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    pickerOpen.value = false
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const pickerWasOpen = pickerOpen.value
    if (!pickerWasOpen) openPicker()
    const count = suggestions.value.length
    pickerIndex.value = nextSkillSuggestionIndex(
      pickerIndex.value,
      count,
      event.key === 'ArrowDown' ? 'next' : 'previous',
      pickerWasOpen
    )
    revealActiveSuggestion()
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

function changeSort(next: string): void {
  if (!['item', 'level', 'slot', 'amount', 'conversion', 'special'].includes(next)) return
  controls.value = nextSkillSortControls(controls.value, next as SkillExplorerControls['sort'])
}
</script>

<template>
  <section class="skill-explorer" aria-label="Skill item explorer">
    <ToolHeader
      eyebrow="Build research prototype"
      title="Items for a skill"
      description="Choose a skill to compare direct rank bonuses, damage conversions, special modifiers, visual transformations, and level requirements."
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
            aria-haspopup="listbox"
            :aria-controls="pickerOpen ? skillListboxId : undefined"
            :aria-activedescendant="activeSuggestionId"
            placeholder="Choose or type a skill…"
            @focus="openPicker"
            @input="handlePickerInput"
            @keydown="handlePickerKey"
          />
          <button v-if="selectedSkill" type="button" aria-label="Clear selected skill" @click="selectedSkill = ''; openPicker()">×</button>
        </span>
        <span v-if="pickerOpen" :id="skillListboxId" class="skill-suggestions" role="listbox" aria-label="Indexed skills">
          <button
            v-for="(skill, index) in suggestions"
            :key="skill"
            :id="skillOptionIds.get(skill)"
            type="button"
            role="option"
            tabindex="-1"
            :aria-selected="index === pickerIndex"
            :class="{ active: index === pickerIndex }"
            @mouseenter="pickerIndex = index"
            @mousedown.prevent
            @click="selectSkill(skill)"
          >{{ researchSkillName(skill) }}</button>
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
        <label><span>Sort by</span><select v-model="sort" autocomplete="off"><option value="level">Required level</option><option value="amount">Ranks & modifiers</option><option value="item">Item name</option><option value="slot">Slot</option><option value="conversion">Conversion target</option><option value="special">Special modifier</option></select></label>
        <label><span>Order</span><select v-model="direction" autocomplete="off"><option value="asc">Lowest first</option><option value="desc">Highest first</option></select></label>
      </template>
    </ExplorerToolbar>
    <ResearchItemTable
      v-model:page="page"
      :rows="researchRows"
      :icon-url-for-item="iconUrlForItem"
      :sort="sort"
      :direction="direction"
      :sort-columns="tableSortColumns"
      :empty-title="selectedSkill ? 'No matching items' : 'Choose a skill to begin'"
      :empty-detail="selectedSkill ? (query || rarity !== 'all' || slot !== 'all' ? 'No items match the current search and filters.' : 'No matching items in this availability scope.') : 'Select an indexed skill to compare its supporting items.'"
      label="Items matching the selected skill"
      @sort="changeSort"
      @activate="emit('open-item', $event)"
      @queue-tooltip="(item, event) => emit('queue-tooltip', item, event)"
      @show-tooltip="(item, element) => emit('show-tooltip', item, element)"
      @move-tooltip="emit('move-tooltip', $event)"
      @scroll-tooltip="emit('scroll-tooltip', $event)"
      @hide-tooltip="emit('hide-tooltip')"
    />
  </section>
</template>
