<script setup lang="ts">
import { computed } from 'vue'
import type { CollectionItem } from '@shared/contracts'
import { isCollectionOwned } from '@shared/collection-availability'
import { compileSearchQuery, type SearchDocument } from '@shared/search-query'
import { searchQueryOptions, searchSchemas } from '@shared/search-schema'
import BoundedResultSurface from '../components/BoundedResultSurface.vue'
import ExplorerToolbar from '../components/ExplorerToolbar.vue'
import ToolHeader from '../components/ToolHeader.vue'
import { searchGuidance } from '../search-guidance'
import {
  buildCollectionFarmingTargets,
  type CollectionFarmingControls,
  type CollectionFarmingRarity,
  withCollectionFarmingPage,
  withCollectionFarmingQuery,
  withCollectionFarmingRarity
} from './collection-farming'

const props = defineProps<{
  items: readonly CollectionItem[]
  searchDocumentForItem: (item: CollectionItem) => SearchDocument
  iconUrlForItem: (item: CollectionItem) => string | null
  contentPackLabel: (contentPack: string) => string
}>()

const emit = defineEmits<{
  'queue-tooltip': [item: CollectionItem, event: MouseEvent]
  'hide-tooltip': []
  'open-item': [item: CollectionItem]
}>()

const controls = defineModel<CollectionFarmingControls>('controls', { required: true })
const query = computed({
  get: () => controls.value.query,
  set: (query: string) => {
    controls.value = withCollectionFarmingQuery(controls.value, query)
  }
})
const rarity = computed({
  get: () => controls.value.rarity,
  set: (rarity: CollectionFarmingRarity) => {
    controls.value = withCollectionFarmingRarity(controls.value, rarity)
  }
})
const page = computed({
  get: () => controls.value.page,
  set: (page: number) => {
    controls.value = withCollectionFarmingPage(controls.value, page)
  }
})
const structuredQuery = computed(() => compileSearchQuery(query.value, searchQueryOptions(searchSchemas.farming)))
const targets = computed(() => buildCollectionFarmingTargets(props.items, {
  rarity: rarity.value,
  query: structuredQuery.value,
  isOwned: isCollectionOwned,
  searchDocumentForItem: props.searchDocumentForItem
}))
const searchError = computed(() => {
  const error = structuredQuery.value.error
  if (!error) return null
  return error.fragment ? `${error.message} Check “${error.fragment}”.` : error.message
})

</script>

<template>
  <section class="farming-workspace" aria-label="Collection farming planner">
    <ToolHeader
      eyebrow="Collection completion"
      title="Where should I farm?"
      description="Areas are ranked by how many currently missing item bases their indexed enemies can drop."
    >
      <template #aside><strong>{{ targets.length }} useful areas</strong></template>
    </ToolHeader>
    <ExplorerToolbar
      v-model="query"
      v-bind="searchGuidance.farming"
      search-label="Search farming targets"
      placeholder="Item, monster, area…"
      :result-count="targets.length"
      result-label="useful areas"
      :search-error="searchError"
    >
      <template #filters>
        <label>
          <span>Rarity</span>
          <select v-model="rarity" autocomplete="off">
            <option value="all">All tracked rarities</option>
            <option value="mi">Monster Infrequents</option>
            <option value="epic">Epics</option>
            <option value="legendary">Legendaries</option>
          </select>
        </label>
      </template>
    </ExplorerToolbar>
    <BoundedResultSurface
      v-model:page="page"
      class="farm-list farming-route-results bounded-tooltip-results"
      :items="targets"
      :get-key="target => target.key"
      :page-size="50"
      empty-title="No useful farming areas"
      empty-detail="No missing items have indexed locations under this filter."
      label="Collection farming routes"
      layout="list"
    >
      <template #item="{ item: target, index }">
        <article :data-route-key="target.key">
          <span class="farm-rank">{{ index + 1 }}</span>
          <div>
            <h3>{{ target.name }} <small>{{ contentPackLabel(target.contentPack) }}</small></h3>
            <p>{{ target.items.length }} missing base{{ target.items.length === 1 ? '' : 's' }} · earliest item Lv{{ target.minimumLevel }}</p>
            <div class="farm-items">
              <button
                v-for="item in target.items.slice(0, 12)"
                :key="item.record"
                type="button"
                @mouseenter="emit('queue-tooltip', item, $event)"
                @mouseleave="emit('hide-tooltip')"
                @click="emit('open-item', item)"
              >
                <img v-if="iconUrlForItem(item)" :src="iconUrlForItem(item)!" alt="" />
                <span>{{ item.name }}</span>
              </button>
              <small v-if="target.items.length > 12">+{{ target.items.length - 12 }} more</small>
            </div>
          </div>
        </article>
      </template>
    </BoundedResultSurface>
  </section>
</template>
