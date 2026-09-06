<script setup lang="ts">
import type { RollCategoryScore } from '@shared/contracts'
import { isDamageOverTime } from '../../../shared/roll-analysis.ts'

defineProps<{ category: RollCategoryScore['category']; damageType?: string | null }>()
</script>

<template>
  <svg class="roll-category-icon" :data-category="category" :data-damage-type="category === 'offense' ? damageType : undefined" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false">
    <template v-if="category === 'offense'">
      <path v-if="damageType === 'pierce'" d="m21 3-4 11-3-4-4-3zM14 10 3 21M3 16v5h5" />
      <template v-else-if="isDamageOverTime(damageType)">
        <path d="M5 3h14M5 21h14M7 3v4l10 10v4M17 3v4L7 17v4" />
        <path d="M9 6h6M9 18h6" />
      </template>
      <path v-else d="m8 16 12-12v5L11 18M6 13l5 5M3 21l5-5M3 18l3 3" />
    </template>
    <template v-else-if="category === 'defense'">
      <path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6zM12 7v10" />
    </template>
    <template v-else-if="category === 'pet'">
      <path d="m4 3 6 4h4l6-4-1 9 2 3-5 2-4 5-4-5-5-2 2-3zM7 11l2 1M17 11l-2 1M10 16h4l-2 2z" />
    </template>
    <template v-else-if="category === 'retaliation'">
      <path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6zM14 7l-5 6h6l-5 5" />
    </template>
    <template v-else>
      <circle cx="12" cy="12" r="9" />
      <path d="m16 8-2.5 5.5L8 16l2.5-5.5z" />
    </template>
  </svg>
</template>

<style scoped>
.roll-category-icon { width: 16px; height: 16px; flex: 0 0 16px; }
</style>
