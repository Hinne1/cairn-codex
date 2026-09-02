<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { CollectionItem, VaultListItem } from '@shared/contracts'
import { isAvailableViaAwakening, isCollectionOwned } from '@shared/collection-availability'
import { compileSearchQuery, type SearchDocument } from '@shared/search-query'
import { searchQueryOptions, searchSchemas } from '@shared/search-schema'
import BoundedResultSurface from '../components/BoundedResultSurface.vue'
import ExplorerToolbar from '../components/ExplorerToolbar.vue'
import { searchGuidance } from '../search-guidance'
import {
  collectionCategories,
  createCollectionMaterialsProjectionControls,
  createCollectionMaterialsQueryDebouncer,
  createCollectionMaterialsRows,
  updateCollectionMaterialsControls,
  type CollectionMaterialsControls
} from './collection-materials'

const props = defineProps<{
  mode: 'collection' | 'materials'
  items: readonly CollectionItem[]
  doubleRareMiBaseRecords: ReadonlySet<string>
  searchDocumentForItem: (item: CollectionItem) => SearchDocument
  categoryProgress: (category: string) => string
  iconUrlForItem: (item: CollectionItem) => string | null
  bestStoredCopyForItem: (record: string) => VaultListItem | null
  liveReady: boolean
  retrievalBusy: boolean
}>()

const emit = defineEmits<{
  'queue-tooltip': [item: CollectionItem, event: MouseEvent | FocusEvent | HTMLElement]
  'show-tooltip': [item: CollectionItem, element: HTMLElement]
  'move-tooltip': [event: MouseEvent]
  'hide-tooltip': []
  'open-item': [item: CollectionItem]
  'retrieve-live': [id: string]
}>()

const controls = defineModel<CollectionMaterialsControls>('controls', { required: true })

function controlModel<K extends keyof CollectionMaterialsControls>(key: K, resetPage = true) {
  return computed({
    get: () => controls.value[key],
    set: (value: CollectionMaterialsControls[K]) => {
      controls.value = updateCollectionMaterialsControls(controls.value, { [key]: value }, resetPage)
    }
  })
}

const category = controlModel('category')
const query = controlModel('query')
const ownership = controlModel('ownership')
const rarity = controlModel('rarity')
const sort = controlModel('sort')
const direction = controlModel('direction')
const page = controlModel('page', false)
const projectionQuery = ref(query.value)
const projectionControls = createCollectionMaterialsProjectionControls(controls, projectionQuery)
const queryDebouncer = createCollectionMaterialsQueryDebouncer((value) => {
  projectionQuery.value = value
})
watch(query, (value) => queryDebouncer.update(value))
watch(() => props.mode, () => {
  queryDebouncer.cancel()
  projectionQuery.value = query.value
})
onBeforeUnmount(queryDebouncer.cancel)
const structuredQuery = computed(() => compileSearchQuery(
  projectionQuery.value,
  searchQueryOptions(props.mode === 'materials' ? searchSchemas.materials : searchSchemas.collection)
))
const rows = computed(() => createCollectionMaterialsRows(props.items, projectionControls.value, {
  mode: props.mode,
  query: structuredQuery.value,
  doubleRareMiBaseRecords: props.doubleRareMiBaseRecords,
  searchDocument: props.searchDocumentForItem
}))
const searchError = computed(() => {
  const error = structuredQuery.value.error
  return error ? (error.fragment ? `${error.message} Check “${error.fragment}”.` : error.message) : null
})

function changeSort(value: CollectionMaterialsControls['sort']): void {
  const nextDirection = sort.value === value
    ? (direction.value === 'asc' ? 'desc' : 'asc')
    : value === 'name' ? 'asc' : 'desc'
  controls.value = updateCollectionMaterialsControls(controls.value, { sort: value, direction: nextDirection }, true)
}

function itemAvailableByAwakeningOnly(item: CollectionItem): boolean {
  return item.availableCount === 0 && isAvailableViaAwakening(item)
}

function awakeningAvailabilityLabel(item: CollectionItem): string {
  const source = item.awakeningSourceName ?? 'owned Epic base'
  const count = item.awakeningSourceAvailableCount ?? 0
  return `Available by awakening ${source}${count > 1 ? ` (${count} bases)` : ''}`
}

function rarityLabel(item: CollectionItem): string {
  if (item.rarity === 'mi') return 'Monster Infrequent'
  if (item.rarity === 'rare') return 'Rare'
  if (item.rarity === 'faction') return 'Faction Rare'
  if (item.rarity === 'component') return 'Component'
  if (item.rarity === 'consumable') return item.slot === 'potion-formula' ? 'Learned formula' : 'Consumable'
  return item.rarity.charAt(0).toLocaleUpperCase() + item.rarity.slice(1)
}

function showFocusedTooltip(_key: string | number, item: CollectionItem, element: HTMLElement): void {
  emit('show-tooltip', item, element)
}
</script>

<template>
  <section class="collection-materials-workspace" :aria-label="mode === 'materials' ? 'Components and consumables' : 'Item collection'">
    <nav v-if="mode === 'collection'" class="category-tabs" aria-label="Item categories">
      <button v-for="option in collectionCategories" :key="option" type="button" :class="{ active: option === category }" @click="category = option">
        <span>{{ option }}</span><small>{{ categoryProgress(option) }}</small>
      </button>
    </nav>

    <ExplorerToolbar
      v-model="query"
      v-bind="mode === 'materials' ? searchGuidance.materials : searchGuidance.collection"
      class="collection-explorer-toolbar"
      :search-label="mode === 'materials' ? 'Search components & consumables' : 'Search collection'"
      placeholder="Name, stat, skill… (try skill:wendigo)"
      :result-count="rows.length"
      result-label="results"
      :search-error="searchError"
    >
      <template #filters>
        <label><span>Collection status</span><select v-model="ownership" autocomplete="off"><option value="all">All items</option><option value="owned">Collected</option><option value="missing">Missing</option></select></label>
        <label v-if="mode === 'materials'"><span>Category</span><select v-model="category" autocomplete="off"><option value="all">All materials</option><option value="component">Components</option><option value="material">Materials</option><option value="potion-formula">Potion formulas</option></select></label>
        <label v-else><span>Rarity</span><select v-model="rarity" autocomplete="off"><option value="all">All rarities</option><option value="legendary">Legendary</option><option value="epic">Epic</option><option value="mi">Monster Infrequent</option><option value="double-rare">Double rare MIs</option><option value="rare">Rare items</option><option value="recipe">Craftable from recipe</option></select></label>
      </template>
      <template #sort>
        <label><span>Sort by</span><select :value="sort" autocomplete="off" @change="changeSort(($event.target as HTMLSelectElement).value as CollectionMaterialsControls['sort'])"><option value="recent">Recently collected</option><option value="completion">Collected status</option><option value="name">Name</option><option value="level">Level</option><option value="roll">Best roll</option></select></label>
        <label><span>Order</span><select v-model="direction" autocomplete="off"><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
      </template>
    </ExplorerToolbar>

    <BoundedResultSurface
      v-model:page="page"
      class="catalog-results bounded-tooltip-results"
      :items="rows"
      :get-key="item => item.record"
      :page-size="48"
      :empty-title="mode === 'materials' ? 'No matching components or consumables' : 'No matching collection items'"
      empty-detail="Try changing the current search or filters."
      :label="mode === 'materials' ? 'Components and consumables' : `${category} collection items`"
      layout="grid"
      interactive
      item-described-by="item-tooltip"
      @activate="(_key, item) => emit('open-item', item)"
      @item-focus="showFocusedTooltip"
      @item-blur="emit('hide-tooltip')"
    >
      <template #item="{ item }">
        <article
          class="item-card"
          :class="{ missing: !isCollectionOwned(item), 'awakening-available': itemAvailableByAwakeningOnly(item), legendary: item.rarity === 'legendary', epic: item.rarity === 'epic', mi: item.rarity === 'mi', rare: item.rarity === 'rare', component: item.rarity === 'component', consumable: item.rarity === 'consumable' }"
          @mouseenter="emit('queue-tooltip', item, $event)"
          @mousemove="emit('move-tooltip', $event)"
          @mouseleave="emit('hide-tooltip')"
        >
          <div class="item-mark" aria-hidden="true">
            <img v-if="iconUrlForItem(item)" :src="iconUrlForItem(item)!" alt="" />
            <span v-else>{{ isCollectionOwned(item) ? '✓' : '?' }}</span>
            <span v-if="item.upgradeRecord" class="awakening-sigil card-awakening-sigil"><i /></span>
          </div>
          <div class="item-copy">
            <h3>{{ item.name }}</h3>
            <p>{{ rarityLabel(item) }} · {{ item.slot }} · Lv{{ item.levelRequirement }}</p>
            <small v-if="item.upgradeRecord" class="awakening-label">Awakenable</small>
            <small v-if="item.setName">{{ item.setName }}</small>
          </div>
          <div class="card-result">
            <strong v-if="mode !== 'materials' && item.bestRollPercentile !== null" class="roll-score">★ {{ item.bestRollPercentile.toFixed(1) }}%</strong>
            <span v-else-if="mode !== 'materials'" class="roll-score dim">★ —</span>
            <strong v-if="item.availableCount > 0">{{ item.availableCount }} {{ mode === 'materials' ? (item.slot === 'potion-formula' ? 'learned' : 'stored') : item.availableCount === 1 ? 'copy' : 'copies' }}</strong>
            <strong v-else-if="itemAvailableByAwakeningOnly(item)" class="awakening-available">{{ awakeningAvailabilityLabel(item) }}</strong>
            <strong v-else-if="item.recipeUnlocked">Recipe unlocked · no stored copy</strong>
            <strong v-else-if="item.discovered">Discovered · no copies</strong>
            <strong v-else>Not found</strong>
          </div>
          <button v-if="liveReady && bestStoredCopyForItem(item.record)" class="card-live-retrieve" type="button" :disabled="retrievalBusy" title="Return the best stored copy to Grim Dawn" @click.stop="emit('retrieve-live', bestStoredCopyForItem(item.record)!.id)">Retrieve live</button>
          <span v-if="item.pinnedInstanceKey" class="pin-indicator">Pinned choice</span>
        </article>
      </template>
    </BoundedResultSurface>
  </section>
</template>
