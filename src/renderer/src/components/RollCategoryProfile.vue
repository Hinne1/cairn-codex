<script setup lang="ts">
import { computed } from 'vue'
import type { RollCategoryScore } from '@shared/contracts'
import { categoryScoreDescription, formatCategoryScore, rollCategoryLabel } from '../roll-rating'

const props = withDefaults(defineProps<{
  scores?: readonly RollCategoryScore[]
  maxVisible?: number
  excludeKey?: string | null
  compact?: boolean
}>(), {
  scores: () => [],
  maxVisible: 4,
  excludeKey: null,
  compact: false
})

const available = computed(() => props.scores.filter((score) => score.key !== props.excludeKey))
const visible = computed(() => {
  if (available.value.length <= props.maxVisible) return available.value
  const supporting = available.value.filter((score) => score.category !== 'offense')
  const offenseSlots = Math.max(1, props.maxVisible - supporting.length)
  return [
    ...available.value.filter((score) => score.category === 'offense').slice(0, offenseSlots),
    ...supporting
  ].slice(0, props.maxVisible)
})
const hidden = computed(() => {
  const shown = new Set(visible.value.map((score) => score.key))
  return available.value.filter((score) => !shown.has(score.key))
})
</script>

<template>
  <div v-if="visible.length" class="roll-category-profile" :class="{ compact }" aria-label="Roll quality by category">
    <span
      v-for="score in visible"
      :key="score.key"
      class="roll-category-score"
      :class="`category-${score.category}`"
      :title="categoryScoreDescription(score)"
    >
      <small>{{ rollCategoryLabel(score) }}</small>
      <strong>{{ formatCategoryScore(score) }}</strong>
    </span>
    <details v-if="hidden.length" class="roll-category-more" @click.stop @keydown.enter.stop @keydown.space.stop>
      <summary :aria-label="`${hidden.length} more roll categories`">+{{ hidden.length }}</summary>
      <div class="roll-category-overflow">
        <span
          v-for="score in hidden"
          :key="score.key"
          class="roll-category-score"
          :class="`category-${score.category}`"
          :title="categoryScoreDescription(score)"
        >
          <small>{{ rollCategoryLabel(score) }}</small>
          <strong>{{ formatCategoryScore(score) }}</strong>
        </span>
      </div>
    </details>
  </div>
</template>

<style scoped>
.roll-category-profile {
  display: flex;
  flex-wrap: wrap;
  gap: var(--cc-space-2);
}

.roll-category-score {
  display: inline-flex;
  align-items: baseline;
  gap: var(--cc-space-2);
  min-width: 78px;
  padding: var(--cc-space-2) var(--cc-space-3);
  border: 1px solid var(--cc-border-default);
  border-radius: var(--cc-radius-sm);
  background: var(--cc-surface-1);
}

.roll-category-score small {
  overflow: hidden;
  color: var(--cc-text-muted);
  font-size: var(--cc-font-size-2xs);
  letter-spacing: .04em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.roll-category-score strong {
  margin-left: auto;
  color: var(--cc-accent);
  font: 650 var(--cc-font-size-md) var(--cc-font-interface);
  white-space: nowrap;
}

.category-defense strong { color: var(--cc-info); }
.category-retaliation strong { color: var(--cc-warning); }
.category-utility strong { color: var(--semantic-fx); }
.category-pet strong { color: var(--cc-success); }

.compact {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--cc-space-1) var(--cc-space-3);
}

.compact .roll-category-score {
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
}

.roll-category-more {
  align-self: center;
  min-width: 0;
  color: var(--cc-text-muted);
  font-size: var(--cc-font-size-xs);
}

.roll-category-more[open] {
  flex-basis: 100%;
  grid-column: 1 / -1;
}

.roll-category-more summary {
  width: fit-content;
  padding: var(--cc-space-1);
  border-radius: var(--cc-radius-sm);
  cursor: pointer;
}

.roll-category-more summary:focus-visible {
  outline: 2px solid var(--cc-focus);
  outline-offset: 2px;
}

.roll-category-overflow {
  display: flex;
  flex-wrap: wrap;
  gap: var(--cc-space-2);
  margin-top: var(--cc-space-2);
}

.compact .roll-category-overflow {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
</style>
