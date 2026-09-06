<script setup lang="ts">
import type { ItemPresentationLine } from '@shared/contracts'
import { formatPresentationLine } from '../item-presentation'
import DamageText from './DamageText.vue'

defineProps<{ line: ItemPresentationLine }>()
</script>

<template>
  <span v-if="line.tone === 'skill' || line.tone === 'mastery' || line.tone === 'visual'">{{ formatPresentationLine(line) }}</span>
  <span v-else>{{ formatPresentationLine({ ...line, label: '', suffix: '' }) }}<DamageText :text="line.label" />{{ line.suffix }}</span>
</template>
