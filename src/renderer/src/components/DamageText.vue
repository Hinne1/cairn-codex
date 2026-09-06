<script setup lang="ts">
import { computed } from 'vue'
import { damageTextSpans, damageStyle } from '../damage-types'

const props = withDefaults(defineProps<{ text: string; typesOnly?: boolean }>(), { typesOnly: false })
const spans = computed(() => damageTextSpans(props.text, props.typesOnly))
</script>

<template>
  <span class="damage-text"><template v-for="(span, index) in spans" :key="index"><span v-if="span.family" :data-damage-family="span.family" :data-conversion-role="span.conversionRole" :style="damageStyle(span.family)">{{ span.text }}</span><template v-else>{{ span.text }}</template></template></span>
</template>
