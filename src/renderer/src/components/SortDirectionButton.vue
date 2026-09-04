<script setup lang="ts">
import type { SortDirection } from '../app-route'
const direction = defineModel<SortDirection>({ required: true })
</script>

<template>
  <button
    type="button"
    class="sort-direction-button"
    :aria-label="direction === 'asc' ? 'Sort ascending' : 'Sort descending'"
    :aria-pressed="direction === 'desc'"
    @click="direction = direction === 'asc' ? 'desc' : 'asc'"
  ><span aria-hidden="true">{{ direction === 'asc' ? '↑' : '↓' }}</span></button>
</template>

<style scoped>
.sort-direction-button { min-height: var(--cc-control-height); min-width: var(--cc-control-height); padding: var(--cc-space-2); border: 1px solid var(--cc-border-default); border-radius: var(--cc-radius-sm); background: var(--cc-surface-input); color: var(--cc-text-primary); cursor: pointer; font: inherit; }
.sort-direction-button:hover { background: var(--cc-accent-surface); border-color: var(--cc-accent-border); }
.sort-direction-button:focus-visible { outline: 2px solid var(--cc-focus); outline-offset: 2px; }
</style>
