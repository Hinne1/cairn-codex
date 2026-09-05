<script setup lang="ts">
import type { CollectionTriviaFact } from './collection-dashboard'
defineProps<{ open: boolean; collectionTrivia: readonly CollectionTriviaFact[] }>()
const emit = defineEmits<{ close: []; 'open-item': [record?: string] }>()
</script>

<template>
    <div v-if="open" class="trivia-backdrop" @click.self="emit('close')">
      <section class="trivia-dialog" role="dialog" aria-modal="true" aria-labelledby="trivia-title">
        <header>
          <div>
            <p class="section-label">Collection trivia</p>
            <h2 id="trivia-title">Codex Curiosities</h2>
            <p>Odd records and minor triumphs from the currently selected archive scope.</p>
          </div>
          <button type="button" class="todo-close" aria-label="Close collection trivia" @click="emit('close')">×</button>
        </header>
        <div class="trivia-scroll">
          <div v-if="collectionTrivia.length" class="trivia-grid">
            <component
              :is="fact.itemRecord ? 'button' : 'article'"
              v-for="fact in collectionTrivia"
              :key="fact.id"
              :type="fact.itemRecord ? 'button' : undefined"
              class="trivia-fact"
              :class="[`tone-${fact.tone}`, { actionable: fact.itemRecord }]"
              @click="emit('open-item', fact.itemRecord)"
            >
              <span class="trivia-eyebrow">{{ fact.eyebrow }}</span>
              <strong class="trivia-value">{{ fact.value }}</strong>
              <h3>{{ fact.title }}</h3>
              <p>{{ fact.detail }}</p>
              <small v-if="fact.itemRecord">Inspect item →</small>
            </component>
          </div>
          <p v-else class="todo-empty">The Codex needs a few discoveries before it can become nosy.</p>
        </div>
        <footer>
          <span>{{ collectionTrivia.length }} curiosities · recalculated from live collection data</span>
          <button type="button" @click="emit('close')">Close</button>
        </footer>
      </section>
    </div>
</template>
