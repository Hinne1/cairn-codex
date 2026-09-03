<script setup lang="ts">
import { computed } from 'vue'
import type { CollectionItem } from '@shared/contracts'
import { itemSkillVisualTransformations } from '../workspaces/skill-explorer'
import { researchSkillName } from '../workspaces/research-item-table'
import SemanticBadge from './SemanticBadge.vue'

const props = defineProps<{ item: CollectionItem }>()
const transformations = computed(() => itemSkillVisualTransformations(props.item))
</script>

<template>
  <span v-if="transformations.length" class="research-skill-fx" aria-label="Skill FX transformations">
    <SemanticBadge tone="fx" compact>Skill FX</SemanticBadge>
    <span v-for="(change, index) in transformations" :key="`${change.skill}:${index}`" class="research-skill-fx-change">
      <strong v-if="change.skill">{{ researchSkillName(change.skill) }}</strong>
      <span>{{ change.text }}</span>
    </span>
  </span>
</template>

<style scoped>
.research-skill-fx { display: grid; justify-items: start; gap: var(--cc-space-2); }
.research-skill-fx-change { display: grid; gap: var(--cc-space-1); color: var(--cc-text-secondary); }
.research-skill-fx-change > strong { color: var(--semantic-fx); font: inherit; font-weight: 600; }
</style>
