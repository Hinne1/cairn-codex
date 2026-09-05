<script setup lang="ts">
import { computed, nextTick } from 'vue'
import type { CollectionItem } from '@shared/contracts'
import type { PlannerDisplay } from '../app-route'
import type { CompiledSearchQuery } from '@shared/search-query'
import type { LevelingPlannerSession } from './leveling-planner'
import ToolHeader from '../components/ToolHeader.vue'
import ExplorerToolbar from '../components/ExplorerToolbar.vue'
import SortDirectionButton from '../components/SortDirectionButton.vue'
import PlannerSetupDialog from '../components/PlannerSetupDialog.vue'
import PlannerJourney from '../components/PlannerJourney.vue'
import ResearchItemTable from '../components/ResearchItemTable.vue'
import { researchItemTypeLabel, researchSkillName } from './research-item-table'
import { searchGuidance } from '../search-guidance'

const props = defineProps<{
  session: LevelingPlannerSession
  iconUrlForItem: (item: CollectionItem) => string | null
  contentPackLabel: (pack: string) => string
}>()
const emit = defineEmits<{
  'queue-tooltip': [item: CollectionItem, event: MouseEvent]
  'show-tooltip': [item: CollectionItem, element: HTMLElement]
  'move-tooltip': [event: MouseEvent]
  'scroll-tooltip': [event: WheelEvent]
  'hide-tooltip': []
  'open-item': [item: CollectionItem]
  'icon-error': [item: CollectionItem]
}>()
const {
  plannerProfiles,
  selectedPlannerProfileId,
  plannerSkills,
  plannerSkillDraft,
  plannerSetupOpen,
  plannerMinimumLevelDraft,
  plannerLevelCapDraft,
  plannerDisplay,
  plannerPage,
  plannerMapScope,
  plannerMapSortMode,
  plannerMapSortDirection,
  plannerQuery,
  plannerOwnership,
  plannerSortMode,
  plannerSortDirection,
  plannerIgnoredRecords,
  plannerShowIgnored,
  discoveredCharacters,
  characterImportLoading,
  characterImportError,
  atlasRegionQuery,
  selectedAtlasRegion,
  plannerStructuredQuery,
  atlasStructuredQuery,
  selectedPlannerProfile,
  plannerClassOptions,
  plannerSkillOptions,
  plannerRows,
  plannerResearchRows,
  plannerMiItems,
  atlasRegions,
  unlocatedPlannerMiItems,
  visibleAtlasRegions,
  atlasMapPins,
  selectedAtlasItems,
  addPlannerSkill,
  removePlannerSkill,
  restorePlannerSkill,
  selectPlannerProfile,
  commitPlannerMinimumLevel,
  commitPlannerLevelCap,
  openPlannerSetup,
  loadCharacterProfiles,
  completePlannerSetup,
  refreshSelectedCharacterProfile,
  deletePlannerProfile,
  sortPlannerTable,
  togglePlannerFavorite,
  togglePlannerIgnored,
  skillNames,
  skillMasteries
} = props.session

const toolbarQuery = computed({
  get: () => plannerDisplay.value === 'map' ? atlasRegionQuery.value : plannerQuery.value,
  set: (value: string) => {
    if (plannerDisplay.value === 'map') atlasRegionQuery.value = value
    else plannerQuery.value = value
  }
})

const itemIconUrl = (item: CollectionItem) => props.iconUrlForItem(item)
const contentPackShortLabel = (pack: string) => props.contentPackLabel(pack)
const queueTooltip = (item: CollectionItem, event: MouseEvent) => emit('queue-tooltip', item, event)
const showTooltip = (item: CollectionItem, element: HTMLElement) => emit('show-tooltip', item, element)
const moveTooltip = (event: MouseEvent) => emit('move-tooltip', event)
const scrollTooltip = (event: WheelEvent) => emit('scroll-tooltip', event)
const scheduleTooltipHide = () => emit('hide-tooltip')
const openItem = (item: CollectionItem) => emit('open-item', item)
const handleItemIconError = (item: CollectionItem) => emit('icon-error', item)

function switchPlannerDisplay(display: PlannerDisplay): void {
  const focused = document.activeElement instanceof HTMLElement
    ? document.activeElement.dataset.resultKey
    : undefined
  plannerDisplay.value = display
  if (!focused) return
  void nextTick(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const target = [...document.querySelectorAll<HTMLElement>('[data-result-key]')]
      .find((element) => element.dataset.resultKey === focused)
    target?.scrollIntoView({ block: 'center' })
    target?.focus({ preventScroll: true })
  })
}


function searchErrorMessage(query: CompiledSearchQuery): string | null {
  if (!query.error) return null
  return query.error.fragment
    ? `${query.error.message} Check “${query.error.fragment}”.`
    : query.error.message
}


</script>

<template>
  <section class="leveling-planner" aria-label="Character leveling shopping list">
    <ToolHeader
      eyebrow="Character shopping list"
      title="Leveling Planner"
      description="Plan equipment around your build, from first upgrades to endgame."
      tone="blue"
    />
    <ExplorerToolbar
      v-model="toolbarQuery"
      v-bind="plannerDisplay === 'map' ? searchGuidance.atlas : searchGuidance.planner"
      :class="plannerDisplay === 'map' ? 'planner-map-explorer-toolbar' : 'planner-explorer-toolbar'"
      layout="research"
      :search-label="plannerDisplay === 'map' ? 'Search MI sources' : 'Search items'"
      :placeholder="plannerDisplay === 'map' ? 'Area, MI, monster…' : 'Item, skill modifier, source…'"
      :result-count="plannerDisplay === 'map' ? visibleAtlasRegions.length : plannerRows.length"
      :result-label="plannerDisplay === 'map' ? 'source areas' : 'relevant item tiers'"
      :search-error="searchErrorMessage(plannerDisplay === 'map' ? atlasStructuredQuery : plannerStructuredQuery)"
    >
      <template #before>
        <div class="planner-build-context" aria-label="Build controls">
          <div class="research-context-row">
            <label class="research-subject-field" for="planner-profile-select">
              <span>Active plan</span>
              <select id="planner-profile-select" :value="selectedPlannerProfileId" @change="selectPlannerProfile(($event.target as HTMLSelectElement).value)">
                <option v-for="profile in plannerProfiles" :key="profile.id" :value="profile.id">
                  {{ profile.name }}{{ profile.className ? ` · ${profile.className}` : '' }}{{ profile.source === 'character' ? ' · character' : '' }}
                </option>
              </select>
            </label>
            <div class="planner-level-range" aria-label="Item level range">
              <label class="research-subject-field">
                <span>Min. item level</span>
                <input v-model.number="plannerMinimumLevelDraft" type="number" min="1" :max="plannerLevelCapDraft" @change="commitPlannerMinimumLevel" @keydown.enter.prevent="commitPlannerMinimumLevel" />
              </label>
              <label class="research-subject-field">
                <span>Level cap</span>
                <input v-model.number="plannerLevelCapDraft" type="number" :min="plannerMinimumLevelDraft" max="100" @change="commitPlannerLevelCap" @keydown.enter.prevent="commitPlannerLevelCap" />
              </label>
            </div>
            <button type="button" class="research-context-button planner-new-plan" @click="openPlannerSetup">New plan</button>
          </div>
          <p class="research-context-note">
            {{ selectedPlannerProfile?.className || 'Class not set' }}
            <template v-if="selectedPlannerProfile?.masteries?.length"> · {{ selectedPlannerProfile.masteries.join(' + ') }}</template>
          </p>
          <div class="planner-inline-skills">
            <span class="research-context-label">Selected skills</span>
            <div class="planner-selected-skills" aria-label="Selected skills">
              <button v-for="skill in plannerSkills" :key="skill" type="button" class="research-context-button" :aria-label="`Remove ${researchSkillName(skill)}`" @click="removePlannerSkill(skill)">
                {{ researchSkillName(skill) }} <span aria-hidden="true">×</span>
              </button>
              <small v-if="plannerSkills.length === 0">Add two or three build-defining skills to begin.</small>
            </div>
            <div v-if="selectedPlannerProfile?.excludedSkills.length" class="planner-restorable-skills">
              <small>Ignored character skills</small>
              <button v-for="skill in selectedPlannerProfile.excludedSkills" :key="skill" type="button" class="research-context-button" @click="restorePlannerSkill(skill)">+ {{ researchSkillName(skill) }}</button>
            </div>
            <div class="research-context-row">
              <label class="research-subject-field" for="planner-skill-input">
                <span>Add a skill</span>
                <input id="planner-skill-input" v-model="plannerSkillDraft" type="search" list="planner-skill-options" autocomplete="off" placeholder="Type a skill name…" @keydown.enter.prevent="addPlannerSkill()" />
              </label>
              <datalist id="planner-skill-options"><option v-for="skill in plannerSkillOptions" :key="skill" :value="skill" /></datalist>
              <button type="button" class="research-context-button" :disabled="plannerSkillOptions.length === 0" @click="addPlannerSkill()">Add</button>
              <button v-if="selectedPlannerProfile?.source === 'character'" type="button" class="research-context-button" :disabled="characterImportLoading" @click="refreshSelectedCharacterProfile">{{ characterImportLoading ? 'Refreshing…' : 'Refresh save' }}</button>
              <button type="button" class="research-context-button" :disabled="plannerProfiles.length <= 1" @click="deletePlannerProfile">Delete plan</button>
            </div>
          </div>
        </div>
      </template>
      <template #filters>
        <template v-if="plannerDisplay !== 'map'">
          <label><span>Archive status</span><select v-model="plannerOwnership" autocomplete="off"><option value="all">All items</option><option value="owned">In Archive</option><option value="missing">Not archived</option></select></label>
          <label><span>List</span><select v-model="plannerShowIgnored" autocomplete="off"><option :value="false">Shopping list</option><option :value="true">Ignored bases ({{ plannerIgnoredRecords.length }})</option></select></label>
        </template>
        <label v-else><span>Catalog scope</span><select v-model="plannerMapScope" autocomplete="off"><option value="selected">Selected build</option><option value="all">All MI tiers</option></select></label>
      </template>
      <template #sort>
        <template v-if="plannerDisplay !== 'map'">
          <label><span>Sort by</span><select v-model="plannerSortMode" autocomplete="off"><option value="level">Required level</option><option value="name">Item name</option><option value="rarity">Rarity</option></select></label>
          <SortDirectionButton v-model="plannerSortDirection" />
        </template>
        <template v-else>
          <label><span>Sort by</span><select v-model="plannerMapSortMode" autocomplete="off"><option value="items">Matching MI tiers</option><option value="level">Earliest item level</option><option value="name">Area name</option></select></label>
          <SortDirectionButton v-model="plannerMapSortDirection" />
        </template>
      </template>
      <template #views>
        <div class="research-view-switch planner-display" role="group" aria-label="Planner display">
          <button type="button" class="research-context-button" :aria-pressed="plannerDisplay === 'table'" @click="switchPlannerDisplay('table')">Table</button>
          <button type="button" class="research-context-button" :aria-pressed="plannerDisplay === 'journey'" @click="switchPlannerDisplay('journey')">Journey</button>
          <button type="button" class="research-context-button" :aria-pressed="plannerDisplay === 'map'" @click="switchPlannerDisplay('map')">MI sources</button>
        </div>
      </template>
      <template #summary>
        <template v-if="plannerDisplay !== 'map'">
          <span>{{ plannerRows.filter((row) => row.item.rarity === 'mi').length }} MIs</span>
          <span>{{ plannerRows.filter((row) => row.item.rarity === 'faction' || row.item.acquisition?.factions?.length).length }} faction purchases</span>
          <span>{{ plannerRows.filter((row) => row.item.acquisition?.crafting).length }} craftable</span>
        </template>
        <span v-else>{{ plannerMiItems.length }} MI tiers indexed<span v-if="unlocatedPlannerMiItems.length"> · {{ unlocatedPlannerMiItems.length }} unlocated</span></span>
      </template>
    </ExplorerToolbar>
    <PlannerSetupDialog
      v-if="plannerSetupOpen"
      :profiles="plannerProfiles"
      :characters="discoveredCharacters"
      :characters-loading="characterImportLoading"
      :characters-error="characterImportError"
      :class-options="plannerClassOptions"
      :skill-names="skillNames"
      :skill-masteries="skillMasteries"
      @cancel="plannerSetupOpen = false"
      @request-characters="loadCharacterProfiles"
      @submit="completePlannerSetup"
    />
    <template v-if="plannerDisplay !== 'map'">
      <ResearchItemTable
        v-if="plannerDisplay === 'table'"
        v-model:page="plannerPage"
        :rows="plannerResearchRows"
        :icon-url-for-item="itemIconUrl"
        :sort="plannerSortMode"
        :direction="plannerSortDirection"
        :sort-columns="{ item: 'name', level: 'level' }"
        :empty-title="plannerShowIgnored ? 'No ignored bases' : 'No shopping-list items'"
        :empty-detail="plannerShowIgnored ? 'Ignore an item base to keep it out of the active shopping list.' : 'Select a mastery or skill, widen the item level range, or restore an ignored base.'"
        label="Leveling Planner item results"
        pagination="continuous"
        actions
        :ignored-view="plannerShowIgnored"
        @sort="sortPlannerTable"
        @activate="openItem"
        @queue-tooltip="queueTooltip"
        @show-tooltip="showTooltip"
        @move-tooltip="moveTooltip"
        @scroll-tooltip="scrollTooltip"
        @hide-tooltip="scheduleTooltipHide"
        @favorite="togglePlannerFavorite"
        @ignore="togglePlannerIgnored"
      />
      <PlannerJourney
        v-else
        v-model:page="plannerPage"
        :rows="plannerResearchRows"
        :icon-url-for-item="itemIconUrl"
        :ignored-view="plannerShowIgnored"
        @activate="openItem"
        @queue-tooltip="queueTooltip"
        @show-tooltip="showTooltip"
        @move-tooltip="moveTooltip"
        @scroll-tooltip="scrollTooltip"
        @hide-tooltip="scheduleTooltipHide"
        @favorite="togglePlannerFavorite"
        @ignore="togglePlannerIgnored"
      />
    </template>

    <template v-else>
      <section class="planner-world-map" aria-label="Cairn item source map">
        <header>
          <span><strong>Campaign source map</strong><small>Positions come directly from Grim Dawn's world-region coordinates.</small></span>
          <span class="planner-map-legend">
            <i class="base" />GD <i class="gdx1" />AoM <i class="gdx2" />FG <i class="gdx3" />FoA
          </span>
        </header>
        <div v-if="atlasMapPins.length" class="planner-map-canvas">
          <button
            v-for="pin in atlasMapPins"
            :key="pin.key"
            type="button"
            class="planner-map-pin"
            :class="[pin.contentPack, { active: selectedAtlasRegion === pin.key }]"
            :style="{ left: `${pin.left}%`, top: `${pin.top}%` }"
            :aria-label="`${pin.name}, ${pin.items.length} matching item tiers`"
            :title="`${pin.name} (${contentPackShortLabel(pin.contentPack)}) · ${pin.items.length} tiers`"
            @click="selectedAtlasRegion = pin.key"
          >
            <b>{{ pin.items.length }}</b>
            <span>{{ pin.name }}</span>
          </button>
        </div>
        <p v-else class="skill-empty">No campaign coordinates are available for the current filter.</p>
      </section>
      <div class="mi-source-layout">
        <aside class="mi-atlas-regions">
          <button
            v-for="region in visibleAtlasRegions"
            :key="region.key"
            type="button"
            :data-region-key="region.key"
            :class="{ active: selectedAtlasRegion === region.key }"
            @click="selectedAtlasRegion = region.key"
          >
            <span>
              <strong>{{ region.name }} ({{ contentPackShortLabel(region.contentPack) }})</strong>
              <small>{{ [...new Set(region.items.flatMap((item) => item.acquisition?.sources ?? []))].slice(0, 2).join(' · ') }}</small>
            </span>
            <b>{{ region.items.length }} tiers · earliest item Lv{{ region.minimumItemLevel }}</b>
          </button>
        </aside>
        <section class="mi-source-detail">
          <header v-if="selectedAtlasRegion">
            <p class="section-label">Area drops</p>
            <h3>{{ atlasRegions.find((region) => region.key === selectedAtlasRegion)?.name }} ({{ contentPackShortLabel(atlasRegions.find((region) => region.key === selectedAtlasRegion)?.contentPack ?? '') }})</h3>
            <p>Item tiers whose indexed monster source can appear in this area.</p>
          </header>
          <div v-if="selectedAtlasItems.length" class="atlas-item-list">
            <button
              v-for="item in selectedAtlasItems"
              :key="item.record"
              type="button"
              @mouseenter="queueTooltip(item, $event)"
              @mousemove="moveTooltip"
              @mouseleave="scheduleTooltipHide"
              @click="openItem(item)"
            >
              <img v-if="itemIconUrl(item)" :src="itemIconUrl(item)!" alt="" @error="handleItemIconError(item)" />
              <span>
                <strong>{{ item.name }}</strong>
                <small>Lv{{ item.levelRequirement }} · {{ researchItemTypeLabel(item) }}</small>
                <small>{{ item.acquisition?.sources[0] }}</small>
              </span>
            </button>
          </div>
          <p v-else class="skill-empty">No indexed MIs match this area filter.</p>
        </section>
      </div>
    </template>
  </section>
</template>

<style scoped>
.planner-build-context { min-width: 0; }
.planner-level-range { flex: 0 1 200px; }
.planner-inline-skills { display: grid; gap: var(--cc-space-3); margin-top: var(--cc-space-4); }
.planner-selected-skills, .planner-restorable-skills { display: flex; flex-wrap: wrap; align-items: center; gap: var(--cc-space-2); color: var(--cc-text-muted); }
.planner-selected-skills .research-context-button { min-height: var(--cc-control-height-sm); padding: var(--cc-space-1) var(--cc-space-3); border-radius: var(--cc-radius-pill); font-size: var(--cc-font-size-sm); }
.planner-restorable-skills .research-context-button { border-style: dashed; }
</style>
