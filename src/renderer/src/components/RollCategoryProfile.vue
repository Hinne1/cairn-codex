<script setup lang="ts">
import { computed } from 'vue'
import type { RollCategoryScore } from '@shared/contracts'
import { categoryScoreDescription, formatCategoryScore, rollCategoryLabel } from '../roll-rating'
import RollCategoryIcon from './RollCategoryIcon.vue'
import { damageFamily, damageStyle } from '../damage-types'

const props = withDefaults(defineProps<{
  scores?: readonly RollCategoryScore[]
  maxVisible?: number
  excludeKey?: string | null
  preferredKey?: string | null
  compact?: boolean
}>(), {
  scores: () => [],
  maxVisible: 4,
  excludeKey: null,
  preferredKey: null,
  compact: false
})

const available = computed(() => props.scores.filter((score) => score.key !== props.excludeKey))
const visible = computed(() => {
  if (available.value.length <= props.maxVisible) return available.value
  const preferred = available.value.find((score) => score.key === props.preferredKey)
  const representatives: RollCategoryScore[] = preferred ? [preferred] : []
  for (const category of ['offense', 'defense', 'pet', 'utility', 'retaliation']) {
    if (representatives.some((score) => score.category === category)) continue
    const score = available.value.find((candidate) => candidate.category === category)
    if (score) representatives.push(score)
  }
  return [...representatives, ...available.value.filter((score) => !representatives.includes(score))].slice(0, props.maxVisible)
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
      :class="[`category-${score.category}`, { 'icon-only': compact && (score.category !== 'offense' || damageFamily(score.damageType)) }]"
      :style="score.category === 'offense' ? damageStyle(score.damageType) : undefined"
      :title="categoryScoreDescription(score)"
    >
      <span class="roll-category-label"><RollCategoryIcon :category="score.category" :damage-type="score.damageType" /><small>{{ rollCategoryLabel(score) }}</small></span>
      <strong>{{ formatCategoryScore(score) }}</strong>
    </span>
    <details v-if="compact || hidden.length" class="roll-category-more" @click.stop @keydown.enter.stop @keydown.space.stop>
      <summary :aria-label="compact ? 'Roll details: category names and scores' : `${hidden.length} more roll categories`">{{ compact ? 'Roll details' : `+${hidden.length}` }}</summary>
      <div class="roll-category-overflow">
        <span
          v-for="score in compact ? available : hidden"
          :key="score.key"
          class="roll-category-score"
          :class="`category-${score.category}`"
          :style="score.category === 'offense' ? damageStyle(score.damageType) : undefined"
          :title="categoryScoreDescription(score)"
        >
          <span class="roll-category-label"><RollCategoryIcon :category="score.category" :damage-type="score.damageType" /><small>{{ rollCategoryLabel(score) }}</small></span>
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
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--cc-space-2);
  min-width: 78px;
  padding: var(--cc-space-2) var(--cc-space-3);
  border: 1px solid var(--cc-border-default);
  border-radius: var(--cc-radius-sm);
  background: var(--cc-surface-1);
  color: var(--cc-accent);
}

.roll-category-label { display: inline-flex; min-width: 0; align-items: center; gap: var(--cc-space-1); color: inherit; }
.roll-category-score small {
  overflow: hidden;
  color: inherit;
  font-size: var(--cc-font-size-2xs);
  letter-spacing: .04em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.roll-category-score strong {
  margin-left: auto;
  color: inherit;
  font: 650 var(--cc-font-size-md) var(--cc-font-interface);
  white-space: nowrap;
}

.category-defense { color: var(--cc-info); }
.category-retaliation { color: var(--cc-warning); }
.category-utility { color: var(--semantic-fx); }
.category-pet { color: var(--cc-success); }

.compact {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--cc-space-1) var(--cc-space-3);
}

.compact .roll-category-score {
  flex-direction: column;
  align-items: stretch;
  gap: var(--cc-space-1);
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
}
.compact .roll-category-score strong { margin-left: 0; }
.compact .roll-category-score.icon-only { flex-direction: row; align-items: center; }
.compact .icon-only strong { font-size: var(--cc-font-size-sm); }
.icon-only small {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
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
  grid-template-columns: minmax(0, 1fr);
}
.compact .roll-category-overflow .roll-category-score { flex-direction: row; align-items: center; flex-wrap: wrap; }
.compact .roll-category-overflow small { white-space: normal; }
</style>
