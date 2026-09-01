<script setup lang="ts">
import { computed } from 'vue'
import type {
  CharacterSaveProfile,
  CollectionItem,
  CollectionRaritySummary,
  VaultListItem
} from '@shared/contracts'
import { compileSearchQuery } from '@shared/search-query'
import { searchQueryOptions, searchSchemas } from '@shared/search-schema'
import BoundedResultSurface from '../components/BoundedResultSurface.vue'
import ExplorerToolbar from '../components/ExplorerToolbar.vue'
import ToolHeader from '../components/ToolHeader.vue'
import { searchGuidance } from '../search-guidance'
import {
  buildSupplyCatalogIndex,
  changeSupplyCategory,
  createSupplyAccessSummary,
  createSupplyOptions,
  type SupplyControls,
  type SupplyOption,
  type SupplySession,
  updateSupplyControls
} from './supplies'

const props = defineProps<{
  catalogItems: readonly CollectionItem[]
  vaultItems: readonly VaultListItem[]
  activeCharacter: CharacterSaveProfile | null
  activeTransferHardcore: boolean | undefined
  liveReady: boolean
  liveStatusLabel: string
  connectionColorState: string
  offlineReady: boolean
  offlineStagingEmpty: boolean
  busy: boolean
  infiniteSupplies: boolean
  summary: CollectionRaritySummary
  session: SupplySession
  iconUrlForItem: (item: CollectionItem) => string | null
}>()

const emit = defineEmits<{
  'queue-tooltip': [item: CollectionItem, event: MouseEvent | FocusEvent | HTMLElement]
  'move-tooltip': [event: MouseEvent]
  'hide-tooltip': []
  dispense: [items: SupplyOption[], mode: SupplyControls['mode']]
}>()

const controls = defineModel<SupplyControls>('controls', { required: true })
const query = computed({
  get: () => controls.value.query,
  set: (query: string) => { controls.value = updateSupplyControls(controls.value, { query }, true) }
})
const category = computed({
  get: () => controls.value.category,
  set: (category: SupplyControls['category']) => {
    controls.value = changeSupplyCategory(controls.value, category)
    props.session.selectedIds.value = []
  }
})
const slot = computed({
  get: () => controls.value.slot,
  set: (slot: SupplyControls['slot']) => {
    controls.value = updateSupplyControls(controls.value, { slot }, true)
    props.session.selectedIds.value = []
  }
})
const mode = computed({
  get: () => controls.value.mode,
  set: (mode: SupplyControls['mode']) => {
    controls.value = updateSupplyControls(controls.value, { mode }, false)
    props.session.selectedIds.value = []
  }
})
const page = computed({
  get: () => controls.value.page,
  set: (page: number) => { controls.value = updateSupplyControls(controls.value, { page }, false) }
})
const selectedIds = computed({
  get: () => props.session.selectedIds.value,
  set: (selectedIds: string[]) => { props.session.selectedIds.value = selectedIds }
})
const structuredQuery = computed(() => compileSearchQuery(query.value, searchQueryOptions(searchSchemas.supplies)))
const catalogIndex = computed(() => buildSupplyCatalogIndex(props.catalogItems))
const options = computed(() => createSupplyOptions({
  catalogItems: props.catalogItems,
  vaultItems: props.vaultItems,
  controls: controls.value,
  activeCharacter: props.activeCharacter,
  activeTransferHardcore: props.activeTransferHardcore,
  liveReady: props.liveReady,
  query: structuredQuery.value,
  catalogIndex: catalogIndex.value
}))
const accessSummary = computed(() => createSupplyAccessSummary(props.catalogItems, props.activeCharacter))
const searchError = computed(() => {
  const error = structuredQuery.value.error
  if (!error) return null
  return error.fragment ? `${error.message} Check “${error.fragment}”.` : error.message
})
const visibleOptions = computed(() => {
  const start = (page.value - 1) * 60
  return options.value.slice(start, start + 60)
})
const selectedOptions = computed(() => options.value.filter((item) => selectedIds.value.includes(item.id)))
const dispenseDisabled = computed(() => props.busy || selectedIds.value.length === 0 || (
  category.value === 'augments' && selectedIds.value.some((id) => id.startsWith('augment:'))
    ? !props.liveReady
    : mode.value === 'live'
      ? !props.liveReady
      : !props.offlineReady || !props.offlineStagingEmpty
))

function selectVisible(): void {
  selectedIds.value = visibleOptions.value.filter((item) => item.eligible).map((item) => item.id)
}

function dispenseAllBoosts(): void {
  selectedIds.value = options.value
    .filter((item) => ['writ', 'mandate', 'warrant'].includes(item.slot))
    .map((item) => item.id)
  emit('dispense', selectedOptions.value, mode.value)
}

function dispenseSelected(): void {
  emit('dispense', selectedOptions.value, mode.value)
}

function showFocusedTooltip(_key: string | number, item: SupplyOption, element: HTMLElement): void {
  if (item.catalogItem) emit('queue-tooltip', item.catalogItem, element)
}

function queueTooltip(item: SupplyOption, event: MouseEvent | FocusEvent | HTMLElement): void {
  if (item.catalogItem) emit('queue-tooltip', item.catalogItem, event)
}
</script>

<template>
  <section class="supplies-workspace" aria-label="Reusable supplies">
    <ToolHeader
      eyebrow="Reusable collection"
      title="Supplies"
      description="Archived faction boosts, difficulty merits, Nemesis warrants, and runes are reusable. Soulbound augments unlock per character from that character's faction reputation."
    >
      <template #aside>
        <div class="tool-heading-summary">
          <strong>{{ summary.collected }} / {{ summary.total || '—' }} reusable unlocks</strong>
          <small>{{ accessSummary }}</small>
        </div>
      </template>
    </ToolHeader>
    <ExplorerToolbar
      v-model="query"
      v-bind="searchGuidance.supplies"
      search-label="Search supplies"
      placeholder="Name, effect, faction…"
      :result-count="options.length"
      result-label="available supplies"
      :search-error="searchError"
    >
      <template #filters>
        <label>
          <span>Category</span>
          <select v-model="category" autocomplete="off">
            <option value="writs">Boosts, merits & consumables</option>
            <option value="augments">Augments & runes</option>
          </select>
        </label>
        <label v-if="category === 'augments'">
          <span>Compatible slot</span>
          <select v-model="slot" autocomplete="off">
            <option value="all">All slots</option>
            <option value="weapon">Weapons</option>
            <option value="armor">Armor</option>
            <option value="jewelry">Jewelry</option>
          </select>
        </label>
      </template>
      <template #actions>
        <button type="button" :disabled="!visibleOptions.length" @click="selectVisible">
          Select visible
        </button>
        <button
          v-if="category === 'writs'"
          type="button"
          :disabled="busy || !options.length"
          @click="dispenseAllBoosts"
        >
          Dispense all unlocked boosts
        </button>
      </template>
    </ExplorerToolbar>
    <div class="supply-status">
      <span :class="'state-' + connectionColorState">
        {{ mode === 'live' ? liveStatusLabel : offlineReady ? 'Offline staging ready' : 'Offline staging locked' }}
      </span>
      <div class="segmented-control" aria-label="Supply transfer method">
        <button type="button" :class="{ active: mode === 'live' }" @click="mode = 'live'">Live</button>
        <button type="button" :class="{ active: mode === 'offline' }" @click="mode = 'offline'">Offline</button>
      </div>
    </div>
    <BoundedResultSurface
      v-model:page="page"
      v-model:selected-keys="selectedIds"
      class="supply-results bounded-tooltip-results"
      :items="options"
      :get-key="item => item.id"
      :page-size="60"
      :selection-disabled="busy"
      :is-item-disabled="item => !item.eligible"
      :empty-title="query ? 'No matching supplies' : 'No supplies unlocked'"
      :empty-detail="query ? 'No unlocked supplies match this search and category.' : 'No supplies are unlocked in this category yet.'"
      label="Available reusable supplies"
      layout="grid"
      selection-mode="multiple"
      item-described-by="item-tooltip"
      @item-focus="showFocusedTooltip"
      @item-blur="emit('hide-tooltip')"
    >
      <template #item="{ item, selected }">
        <article
          class="supply-card"
          :class="{ locked: !item.eligible }"
          :title="item.catalogItem ? 'Hover for the full in-game tooltip' : undefined"
          @mouseenter="queueTooltip(item, $event)"
          @mousemove="emit('move-tooltip', $event)"
          @mouseleave="emit('hide-tooltip')"
          @focusin="queueTooltip(item, $event)"
          @focusout="emit('hide-tooltip')"
        >
          <input
            type="checkbox"
            :checked="selected"
            :disabled="busy || !item.eligible"
            @click.stop
            @change="selectedIds = selected ? selectedIds.filter((id) => id !== item.id) : [...selectedIds, item.id]"
          />
          <span class="supply-icon">
            <img
              v-if="item.catalogItem && iconUrlForItem(item.catalogItem)"
              :src="iconUrlForItem(item.catalogItem)!"
              alt=""
            />
          </span>
          <span class="supply-card-copy">
            <strong>{{ item.name }}</strong>
            <small>{{ item.detail }}</small>
            <ul v-if="item.effects.length" class="supply-effects">
              <li v-for="(effect, index) in item.effects" :key="`${item.record}:${index}`">
                {{ effect }}
              </li>
              <li v-if="item.effectCount > item.effects.length" class="more">
                +{{ item.effectCount - item.effects.length }} more in tooltip
              </li>
            </ul>
            <small v-else class="supply-no-effects">No visible stat effect is indexed.</small>
          </span>
          <b>{{ item.reusable ? '∞' : item.stackCount }}</b>
        </article>
      </template>
    </BoundedResultSurface>
    <button
      class="supply-dispense"
      type="button"
      :disabled="dispenseDisabled"
      @click="dispenseSelected"
    >
      {{ busy ? 'Verifying…' : (infiniteSupplies ? 'Dispense ' : 'Return ') + selectedIds.length + ' selected' }}
    </button>
  </section>
</template>
