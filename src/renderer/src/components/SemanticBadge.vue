<script setup lang="ts">
import type { SemanticTone } from '../semantic-tokens'

withDefaults(defineProps<{
  tone?: SemanticTone
  compact?: boolean
}>(), {
  tone: 'progress',
  compact: false
})
</script>

<template>
  <span class="semantic-badge" :class="[`tone-${tone}`, { compact }]">
    <slot />
  </span>
</template>

<style scoped>
.semantic-badge {
  --badge-color: var(--semantic-progress);
  --badge-surface: color-mix(in srgb, var(--badge-color), transparent 88%);
  display: inline-flex;
  min-height: 22px;
  align-items: center;
  justify-content: center;
  padding: 3px var(--cc-space-2);
  border: 1px solid color-mix(in srgb, var(--badge-color), transparent 45%);
  border-radius: var(--cc-radius-pill);
  color: var(--badge-color);
  background: var(--badge-surface);
  font-size: var(--cc-font-size-2xs);
  font-weight: 700;
  letter-spacing: .07em;
  line-height: 1.2;
  text-transform: uppercase;
  white-space: nowrap;
}

.semantic-badge.compact { min-height: 18px; padding: 2px var(--cc-space-2); font-size: 7px; }
.tone-legendary { --badge-color: var(--gd-rarity-legendary); }
.tone-epic { --badge-color: var(--gd-rarity-epic); }
.tone-level { --badge-color: var(--semantic-level); }
.tone-complete { --badge-color: var(--semantic-complete); }
.tone-progress { --badge-color: var(--semantic-progress); }
.tone-owned { --badge-color: var(--semantic-owned); }
.tone-discovered { --badge-color: var(--semantic-discovered); }
.tone-crafting { --badge-color: var(--semantic-crafting); }
.tone-awakening { --badge-color: var(--semantic-awakening); }
.tone-fx { --badge-color: var(--semantic-fx); }
.tone-missing { --badge-color: var(--semantic-missing); }
</style>
