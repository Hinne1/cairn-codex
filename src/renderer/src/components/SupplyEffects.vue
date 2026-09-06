<script setup lang="ts">
import type { SupplyEffect } from '@shared/workspace-query-contracts'
import PresentationLine from './PresentationLine.vue'

defineProps<{ effects: readonly string[]; details?: readonly SupplyEffect[]; total: number }>()
</script>

<template>
  <ul v-if="effects.length" class="supply-effects">
    <li v-for="(effect, index) in effects" :key="index">
      <template v-if="details?.[index]?.text === effect && details[index]?.line">{{ details[index]?.scope === 'pet' ? 'Pets · ' : '' }}<PresentationLine :line="details[index]!.line!" /></template>
      <template v-else>{{ effect }}</template>
    </li>
    <li v-if="total > effects.length" class="more">+{{ total - effects.length }} more in tooltip</li>
  </ul>
  <small v-else class="supply-no-effects">No visible stat effect is indexed.</small>
</template>
