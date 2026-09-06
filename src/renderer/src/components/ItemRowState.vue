<script setup lang="ts">
defineProps<{ favorite?: boolean; ignored?: boolean }>()
</script>

<template>
  <span v-if="favorite || ignored" class="item-row-state-labels">
    <span v-if="favorite" class="item-favorite-label"><span aria-hidden="true">★</span> Favorite</span>
    <span v-if="ignored" class="item-ignored-label"><span aria-hidden="true">⊘</span> Ignored in this plan</span>
  </span>
</template>

<style>
.item-row-state.is-favorite { --cc-item-state-shadow: inset 3px 0 var(--cc-accent); }
.item-row-state.is-ignored { --cc-item-state-shadow: inset 3px 0 var(--cc-text-muted); }
.item-row-state.is-favorite.is-ignored { --cc-item-state-shadow: inset 3px 0 var(--cc-accent), inset 6px 0 var(--cc-text-muted); }
.item-row-state, .item-row-state .research-item, .item-row-state .planner-journey-card { box-shadow: var(--cc-item-state-shadow, none); }
.item-row-state-labels { display: flex; flex-wrap: wrap; gap: var(--cc-space-2); font: 500 var(--cc-font-size-xs) var(--cc-font-interface); }
.item-favorite-label { color: var(--cc-accent); }
.item-ignored-label { color: var(--cc-text-muted); }
.item-more-actions { min-width: var(--cc-control-height); min-height: var(--cc-control-height); padding: var(--cc-space-1) var(--cc-space-2); border: 1px solid var(--cc-border-default); border-radius: var(--cc-radius-sm); background: var(--cc-surface-input); color: var(--cc-text-primary); cursor: pointer; }
.item-more-actions:focus-visible { outline: 2px solid var(--cc-focus); outline-offset: 2px; }
</style>
