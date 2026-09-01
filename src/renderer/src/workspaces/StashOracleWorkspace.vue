<script setup lang="ts">
import { computed } from 'vue'
import type { CollectionItem } from '@shared/contracts'
import { compileSearchQuery } from '@shared/search-query'
import { searchQueryOptions, searchSchemas } from '@shared/search-schema'
import BoundedResultSurface from '../components/BoundedResultSurface.vue'
import ExplorerToolbar from '../components/ExplorerToolbar.vue'
import ToolHeader from '../components/ToolHeader.vue'
import { searchGuidance } from '../search-guidance'
import {
  buildStashOracle,
  type OracleCandidate,
  type OracleReadiness,
  type OracleStyle
} from '../stash-oracle'
import {
  createStashOracleView,
  surpriseStashOracle,
  type StashOracleControls,
  updateStashOracleControls
} from './stash-oracle'

const props = defineProps<{
  items: readonly CollectionItem[]
  skillMasteries?: Record<string, string>
  skillClassNames?: Record<string, string>
  isArchivedItem: (item: CollectionItem) => boolean
  iconUrlForItem: (item: CollectionItem) => string | null
  ownershipLabelForItem: (item: CollectionItem) => string | null
}>()

const emit = defineEmits<{
  'open-set': [name: string]
  'queue-tooltip': [item: CollectionItem, event: MouseEvent | FocusEvent]
  'move-tooltip': [event: MouseEvent]
  'hide-tooltip': []
  'open-item': [item: CollectionItem]
  'build-plan': [candidate: OracleCandidate]
  'inspect-skill': [skill: string]
}>()

const controls = defineModel<StashOracleControls>('controls', { required: true })
const query = computed({
  get: () => controls.value.query,
  set: (query: string) => { controls.value = updateStashOracleControls(controls.value, { query }, true) }
})
const characterClass = computed({
  get: () => controls.value.characterClass,
  set: (characterClass: string) => { controls.value = updateStashOracleControls(controls.value, { characterClass }, true) }
})
const style = computed({
  get: () => controls.value.style,
  set: (style: OracleStyle) => { controls.value = updateStashOracleControls(controls.value, { style }, true) }
})
const readiness = computed({
  get: () => controls.value.readiness,
  set: (readiness: 'all' | OracleReadiness) => { controls.value = updateStashOracleControls(controls.value, { readiness }, true) }
})
const minimumLevel = computed({
  get: () => controls.value.minimumLevel,
  set: (minimumLevel: number) => { controls.value = updateStashOracleControls(controls.value, { minimumLevel }, true) }
})
const maximumLevel = computed({
  get: () => controls.value.maximumLevel,
  set: (maximumLevel: number) => { controls.value = updateStashOracleControls(controls.value, { maximumLevel }, true) }
})
const sort = computed({
  get: () => controls.value.sort,
  set: (sort: StashOracleControls['sort']) => { controls.value = updateStashOracleControls(controls.value, { sort }, false) }
})
const direction = computed({
  get: () => controls.value.direction,
  set: (direction: StashOracleControls['direction']) => { controls.value = updateStashOracleControls(controls.value, { direction }, false) }
})
const page = computed({
  get: () => controls.value.page,
  set: (page: number) => { controls.value = updateStashOracleControls(controls.value, { page }, false) }
})
const structuredQuery = computed(() => compileSearchQuery(query.value, searchQueryOptions(searchSchemas.oracle)))
const allCandidates = computed(() => buildStashOracle(
  [...props.items],
  props.isArchivedItem,
  {
    minimumLevel: Math.min(minimumLevel.value, maximumLevel.value),
    maximumLevel: Math.max(minimumLevel.value, maximumLevel.value),
    mastery: 'all',
    style: style.value,
    skillMasteries: props.skillMasteries,
    skillClassNames: props.skillClassNames
  }
))
const view = computed(() => createStashOracleView(allCandidates.value, controls.value, structuredQuery.value))
const searchError = computed(() => {
  const error = structuredQuery.value.error
  if (!error) return null
  return error.fragment ? `${error.message} Check “${error.fragment}”.` : error.message
})

function readinessLabel(value: OracleReadiness): string {
  if (value === 'ready') return 'Ready now'
  if (value === 'near') return 'Nearly there'
  return 'Wild card'
}

function styleLabel(value: Exclude<OracleStyle, 'all'>): string {
  if (value === 'pets') return 'Pet build'
  if (value === 'retaliation') return 'Retaliation'
  if (value === 'weapon') return 'Weapon build'
  return 'Caster build'
}

function surprise(): void {
  controls.value = surpriseStashOracle(controls.value)
}
</script>

<template>
  <section class="stash-oracle" aria-label="Stash Oracle build recommendations">
    <ToolHeader
      eyebrow="Archetype assembler"
      title="What build is your stash trying to make you play?"
      description="CC follows the mechanical evidence: archived skill modifiers, conversions, set progress, high-level MIs, and the slots those items need. Every recommendation shows its work."
      tone="ember"
    />
    <ExplorerToolbar
      v-model="query"
      v-bind="searchGuidance.oracle"
      class="oracle-explorer-toolbar"
      search-label="Search archetypes"
      placeholder="Skill, damage type, set, item…"
      :result-count="view.filteredCandidates.length"
      result-label="build archetypes"
      :search-error="searchError"
    >
      <template #filters>
        <label><span>Class</span><select v-model="characterClass" autocomplete="off"><option value="all">Any class</option><option v-for="className in view.classOptions" :key="className" :value="className">{{ className }}</option></select></label>
        <label><span>Build style</span><select v-model="style" autocomplete="off"><option value="all">Any style</option><option value="pets">Pets</option><option value="caster">Caster</option><option value="weapon">Weapon</option><option value="retaliation">Retaliation</option></select></label>
        <label><span>Readiness</span><select v-model="readiness" autocomplete="off"><option value="all">All ({{ view.candidates.length }})</option><option value="ready">Ready now ({{ view.readinessCounts.ready }})</option><option value="near">Nearly there ({{ view.readinessCounts.near }})</option><option value="wildcard">Wild cards ({{ view.readinessCounts.wildcard }})</option></select></label>
        <label class="explorer-range-control"><span>Item level</span><span><input v-model.number="minimumLevel" type="number" min="1" :max="maximumLevel" aria-label="Minimum item level" /><b>to</b><input v-model.number="maximumLevel" type="number" :min="minimumLevel" max="100" aria-label="Maximum item level" /></span></label>
      </template>
      <template #sort>
        <label><span>Sort by</span><select v-model="sort" autocomplete="off"><option value="score">Stash fit</option><option value="readiness">Readiness</option><option value="name">Build name</option><option value="class">Class</option></select></label>
        <label><span>Order</span><select v-model="direction" autocomplete="off"><option value="desc">Highest first</option><option value="asc">Lowest first</option></select></label>
      </template>
      <template #actions><button type="button" @click="surprise">Surprise me</button></template>
    </ExplorerToolbar>
    <p class="explorer-context-note">Scores measure archived mechanical support and equipability—not whether a build is fashionable.</p>
    <BoundedResultSurface v-model:page="page" class="oracle-results" :items="view.filteredCandidates" :get-key="candidate => candidate.key" :page-size="12" label="Stash Oracle build recommendations" layout="grid" navigable>
      <template #item="{ item: candidate }">
        <article class="oracle-card" :class="`readiness-${candidate.readiness}`">
          <header><div><span class="oracle-readiness">{{ readinessLabel(candidate.readiness) }}</span><h3>{{ candidate.title }}</h3><p><span>{{ styleLabel(candidate.style) }}</span><span :title="candidate.masteries.join(' + ')">{{ candidate.className }}</span></p></div><div class="oracle-score" :title="candidate.summary"><strong>{{ candidate.score }}</strong><small>stash fit</small></div></header>
          <p class="oracle-summary">{{ candidate.summary }}</p>
          <div v-if="candidate.sets.length" class="oracle-set-progress"><button v-for="set in candidate.sets" :key="set.name" type="button" :class="{ complete: set.owned === set.total }" :title="`Open ${set.name} and inspect every set bonus`" @click="emit('open-set', set.name)"><strong>{{ set.name }}</strong><small>{{ set.owned }}/{{ set.total }}<template v-if="!set.capstoneUnlocked"> · capstone {{ set.capstonePieces }}</template></small></button></div>
          <div class="oracle-evidence"><p><span>Strongest evidence</span><small>{{ candidate.ownedCore }}/{{ candidate.coreSize }} core signals archived</small></p><div><button v-for="evidence in candidate.evidence.slice(0, 7)" :key="evidence.item.record" type="button" :class="{ owned: evidence.owned, missing: !evidence.owned }" :title="evidence.reasons.join(' · ')" @mouseenter="emit('queue-tooltip', evidence.item, $event)" @mousemove="emit('move-tooltip', $event)" @mouseleave="emit('hide-tooltip')" @focus="emit('queue-tooltip', evidence.item, $event)" @blur="emit('hide-tooltip')" @click="emit('open-item', evidence.item)"><img v-if="iconUrlForItem(evidence.item)" :src="iconUrlForItem(evidence.item)!" alt="" /><span><strong>{{ evidence.item.name }}</strong><small>{{ evidence.owned ? (ownershipLabelForItem(evidence.item) ?? 'Archived') : 'Missing' }} · {{ evidence.reasons.slice(0, 2).join(' · ') }}</small></span></button></div></div>
          <div v-if="candidate.conflicts.length" class="oracle-conflicts"><strong>Choices required</strong><span v-for="conflict in candidate.conflicts" :key="conflict">{{ conflict }}</span></div>
          <div v-if="candidate.relatedSkills.length" class="oracle-related"><small>Also supported</small><span v-for="skill in candidate.relatedSkills" :key="skill">{{ skill }}</span></div>
          <footer><button type="button" @click="emit('build-plan', candidate)">Build a shopping list</button><button type="button" @click="emit('inspect-skill', candidate.skill)">Inspect {{ candidate.skill }}</button></footer>
        </article>
      </template>
      <template #empty><div class="oracle-empty"><strong>The Oracle found no coherent signal with these filters.</strong><p>Try a lower item-level floor, another mastery, or “Surprise me.” One archived supporting item is enough to seed a wild card.</p><button type="button" @click="surprise">Clear filters</button></div></template>
    </BoundedResultSurface>
  </section>
</template>
