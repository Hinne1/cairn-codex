<script setup lang="ts">
import { ref } from 'vue'
import type { CollectionItem } from '@shared/contracts'
import BoundedResultSurface from './BoundedResultSurface.vue'
import ResearchSkillFx from './ResearchSkillFx.vue'
import type { ResearchItemTableRow } from '../workspaces/research-item-table'

const props = withDefaults(defineProps<{
  rows: readonly ResearchItemTableRow[]
  iconUrlForItem: (item: CollectionItem) => string | null
  page?: number
  ignoredView?: boolean
}>(), {
  page: 1,
  ignoredView: false
})

const emit = defineEmits<{
  'update:page': [page: number]
  activate: [item: CollectionItem]
  'queue-tooltip': [item: CollectionItem, event: MouseEvent]
  'show-tooltip': [item: CollectionItem, element: HTMLElement]
  'move-tooltip': [event: MouseEvent]
  'scroll-tooltip': [event: WheelEvent]
  'hide-tooltip': []
  favorite: [item: CollectionItem]
  ignore: [item: CollectionItem]
}>()

function startsMilestone(index: number, row: ResearchItemTableRow): boolean {
  return index === 0 || props.rows[index - 1]?.item.levelRequirement !== row.item.levelRequirement
}

function showFocusedTooltip(_key: string | number, row: ResearchItemTableRow, element: HTMLElement): void {
  emit('show-tooltip', row.item, element)
}

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
</script>

<template>
  <section class="planner-journey" aria-label="Level-ordered build journey">
    <div class="planner-journey-summary">
      <span>Level-ordered build path</span>
      <span>{{ new Set(rows.map(row => row.item.levelRequirement)).size }} milestones · {{ rows.filter(row => row.item.rarity === 'mi').length }} MI targets</span>
    </div>
    <BoundedResultSurface
      :page="page"
      class="planner-journey-results bounded-tooltip-results"
      :items="rows"
      :get-key="row => row.item.record"
      :page-size="50"
      pagination="continuous"
      :empty-title="ignoredView ? 'No ignored bases' : 'No journey items'"
      :empty-detail="ignoredView ? 'Ignore an item base to keep it out of the active journey.' : 'Select a mastery or skill, widen the item level range, or restore an ignored base.'"
      label="Leveling Planner journey items"
      layout="list"
      interactive
      item-described-by="item-tooltip"
      @update:page="emit('update:page', $event)"
      @activate="(_key, row) => emit('activate', row.item)"
      @item-focus="showFocusedTooltip"
      @item-blur="emit('hide-tooltip')"
    >
      <template #item="{ item: row, index }">
        <article class="planner-journey-row" :class="{ favorite: row.favorite, ignored: row.ignored, 'is-unavailable': !row.available }">
          <div class="planner-journey-level" :class="{ milestone: startsMilestone(index, row) }">
            <span v-if="startsMilestone(index, row)">Lv {{ row.item.levelRequirement }}</span>
          </div>
          <div class="planner-journey-card">
            <span
              class="planner-journey-picture"
              @mouseenter="emit('queue-tooltip', row.item, $event)"
              @mousemove="emit('move-tooltip', $event)"
              @mouseleave="emit('hide-tooltip')"
              @wheel="emit('scroll-tooltip', $event)"
            >
              <img v-if="itemImageUrl(row.item)" :src="itemImageUrl(row.item)!" alt="" @error="handleImageError(row.item)" />
              <small v-else class="planner-journey-placeholder" aria-hidden="true">{{ row.item.slot.slice(0, 2).toLocaleUpperCase() }}</small>
            </span>
            <span class="planner-journey-copy">
              <strong :class="['gd-rarity-name', `rarity-${row.item.rarity}`]">{{ row.item.name }}</strong>
              <small>{{ row.itemType }} · {{ row.item.slot }}</small>
              <span class="planner-journey-facts">
                <ResearchSkillFx :item="row.item" />
                <em v-for="(fact, factIndex) in row.supports" :key="`${fact.text}:${factIndex}`">{{ fact.label }} {{ fact.text }}</em>
                <span v-for="fact in row.modifiers.filter(fact => fact.kind !== 'visual').slice(0, 1)" :key="fact.text"><b>{{ fact.label }}</b> {{ fact.text }}</span>
                <span v-if="row.acquisition[0]"><b>{{ row.acquisition[0].label }}</b>{{ row.acquisition[0].label ? ' · ' : '' }}{{ row.acquisition[0].text }}</span>
              </span>
            </span>
            <span class="planner-journey-status">
              <span v-if="row.archive[0]" :data-tone="row.archive[0].tone ?? 'default'">{{ row.archive[0].text }}</span>
              <span class="planner-journey-actions">
                <button
                  type="button"
                  :class="{ active: row.favorite }"
                  :aria-label="`${row.favorite ? 'Unfavorite' : 'Favorite'} ${row.item.name}`"
                  @click.stop="emit('favorite', row.item)"
                >★</button>
                <button type="button" @click.stop="emit('ignore', row.item)">{{ ignoredView ? 'Restore' : 'Ignore' }}</button>
              </span>
            </span>
          </div>
        </article>
      </template>
    </BoundedResultSurface>
  </section>
</template>

<style scoped>
.planner-journey { min-width: 0; }
.planner-journey-summary {
  display: flex;
  justify-content: space-between;
  gap: var(--cc-space-5);
  margin-bottom: var(--cc-space-3);
  color: var(--cc-text-muted);
  font-size: var(--cc-font-size-sm);
}
.planner-journey-results :deep(.bounded-results-collection) { display: grid; }
.planner-journey-results :deep(.bounded-results-item) { border-radius: 0; }
.planner-journey-row { display: grid; grid-template-columns: 86px minmax(0, 1fr); min-height: 86px; }
.planner-journey-level {
  position: relative;
  display: flex;
  justify-content: flex-end;
  padding: var(--cc-space-5) var(--cc-space-6) 0 0;
  color: var(--semantic-level);
  font: 600 var(--cc-font-size-lg) var(--cc-font-display);
}
.planner-journey-level::after {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 1px;
  background: var(--cc-border-strong);
  content: '';
}
.planner-journey-level.milestone::before {
  position: absolute;
  z-index: 1;
  top: var(--cc-space-6);
  right: -4px;
  width: 7px;
  height: 7px;
  border: 1px solid var(--cc-tone-accent);
  border-radius: 50%;
  background: var(--cc-surface-1);
  content: '';
}
.planner-journey-card {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto;
  gap: var(--cc-space-4);
  align-items: center;
  margin: var(--cc-space-2) 0 var(--cc-space-2) var(--cc-space-6);
  padding: var(--cc-space-4) var(--cc-space-5);
  border: 1px solid var(--cc-tone-border);
  border-radius: var(--cc-radius-md);
  color: var(--cc-text-secondary);
  background: var(--cc-tone-surface);
}
.planner-journey-row.favorite .planner-journey-card { border-color: var(--cc-accent-border); box-shadow: inset 3px 0 var(--cc-accent); }
.planner-journey-row.ignored { opacity: .7; }
.planner-journey-picture {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  border: 1px solid var(--cc-border-default);
  border-radius: var(--cc-radius-md);
  background: var(--cc-surface-1);
  cursor: help;
}
.planner-journey-picture:hover { border-color: var(--cc-tone-accent); box-shadow: var(--cc-shadow-focus); }
.planner-journey-picture img { max-width: 52px; max-height: 52px; object-fit: contain; }
.planner-journey-placeholder { color: var(--cc-tone-accent); font: 600 var(--cc-font-size-lg) var(--cc-font-display); letter-spacing: var(--cc-letter-label); }
.planner-journey-copy { display: grid; min-width: 0; gap: var(--cc-space-1); }
.planner-journey-copy > strong { font: 600 var(--cc-font-size-xl) var(--cc-font-display); }
.planner-journey-copy > small { color: var(--cc-text-muted); }
.planner-journey-facts { display: flex; flex-wrap: wrap; gap: var(--cc-space-2) var(--cc-space-4); font-size: var(--cc-font-size-sm); }
.planner-journey-facts em { color: var(--cc-tone-accent-soft); font-style: normal; }
.planner-journey-facts b { color: var(--cc-text-primary); }
.planner-journey-status { display: grid; justify-items: end; gap: var(--cc-space-3); color: var(--cc-text-muted); font-size: var(--cc-font-size-sm); }
.planner-journey-status [data-tone='positive'] { color: var(--cc-success); }
.planner-journey-status [data-tone='warning'] { color: var(--cc-warning); }
.planner-journey-actions { display: flex; gap: var(--cc-space-1); }
.planner-journey-actions button {
  min-height: 26px;
  padding: 0 var(--cc-space-3);
  border: 1px solid var(--cc-border-default);
  border-radius: var(--cc-radius-xs);
  color: var(--cc-text-muted);
  background: var(--cc-surface-2);
  cursor: pointer;
  font-size: var(--cc-font-size-xs);
}
.planner-journey-actions button.active { border-color: var(--cc-accent-border); color: var(--cc-accent-strong); background: var(--cc-accent-surface); }
.planner-journey-actions button:focus-visible { outline: 2px solid var(--cc-focus); outline-offset: 1px; }

@media (max-width: 700px) {
  .planner-journey-summary { align-items: flex-start; flex-direction: column; }
  .planner-journey-row { grid-template-columns: 56px minmax(0, 1fr); }
  .planner-journey-level { padding-right: var(--cc-space-3); font-size: var(--cc-font-size-sm); }
  .planner-journey-card { grid-template-columns: 50px minmax(0, 1fr); margin-left: var(--cc-space-4); }
  .planner-journey-picture { width: 48px; height: 48px; }
  .planner-journey-picture img { max-width: 44px; max-height: 44px; }
  .planner-journey-status { grid-column: 2; justify-items: start; }
}
</style>
