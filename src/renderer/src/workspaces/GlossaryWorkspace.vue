<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import ToolHeader from '../components/ToolHeader.vue'
import { glossaryEntries, glossaryEntry } from './glossary'

const props = defineProps<{ entryId: string }>()
const emit = defineEmits<{ 'select-entry': [id: string] }>()
const entry = computed(() => glossaryEntry(props.entryId))
const heading = ref<HTMLElement | null>(null)
const focusEntry = () => nextTick(() => heading.value?.focus())
onMounted(focusEntry)
watch(() => props.entryId, focusEntry)

function jumpTo(id: string): void {
  const target = document.getElementById(`glossary-${id}`)
  if (target instanceof HTMLDetailsElement) target.open = true
  const focusTarget = target?.querySelector<HTMLElement>('summary, h4')
  focusTarget?.focus()
  target?.scrollIntoView({ block: 'start' })
}
</script>

<template>
  <section class="glossary-workspace" aria-label="Glossary">
    <ToolHeader eyebrow="Field guide" title="Glossary" description="Understand the numbers behind your collection." />
    <div class="glossary-layout">
      <nav class="glossary-index" aria-label="Glossary entries">
        <p class="section-label">Entries</p>
        <button v-for="item in glossaryEntries" :key="item.id" type="button"
          :aria-current="entry.id === item.id ? 'page' : undefined"
          @click="emit('select-entry', item.id)">{{ item.title }}</button>
        <details class="glossary-contents">
          <summary>In this entry</summary>
          <div>
            <button v-for="section in entry.sections" :key="section.id" type="button"
              @click="jumpTo(section.id)">{{ section.title }}</button>
          </div>
        </details>
      </nav>
      <article :key="entry.id" class="glossary-entry" aria-labelledby="glossary-entry-title">
        <header>
          <h3 id="glossary-entry-title" ref="heading" tabindex="-1">{{ entry.title }}</h3>
          <p class="glossary-lede">{{ entry.summary }}</p>
        </header>
        <section class="glossary-example" aria-label="Reading a roll score">
          <p>{{ entry.example.label }}</p>
          <div class="glossary-score">
            <span><strong>{{ entry.example.quality }}</strong><small>Average quality</small></span>
            <span><strong>({{ entry.example.rank }})</strong><small>Sampled percentile</small></span>
          </div>
          <p>{{ entry.example.explanation }}</p>
        </section>
        <component :is="section.expandable ? 'details' : 'section'" v-for="section in entry.sections"
          :id="`glossary-${section.id}`" :key="section.id" class="glossary-section"
          :class="{ 'glossary-caution': section.caution }">
          <summary v-if="section.expandable">{{ section.title }}</summary>
          <h4 v-else tabindex="-1">{{ section.title }}</h4>
          <template v-for="(paragraph, index) in section.paragraphs" :key="paragraph">
            <p>{{ paragraph }}</p>
            <table v-if="index === 0 && section.table">
              <caption>{{ section.table.caption }}</caption>
              <thead><tr><th v-for="label in section.table.headings" :key="label" scope="col">{{ label }}</th></tr></thead>
              <tbody><tr v-for="row in section.table.rows" :key="row[0]"><td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td></tr></tbody>
            </table>
          </template>
          <ul v-if="section.bullets"><li v-for="bullet in section.bullets" :key="bullet">{{ bullet }}</li></ul>
        </component>
        <footer class="glossary-sources">
          <h4>Sources & implementation notes</h4>
          <p>The game guide explains mechanics; the implementation documents describe these ratings. Links open in your browser.</p>
          <ul><li v-for="source in entry.sources" :key="source.url"><a :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.label }}</a></li></ul>
        </footer>
      </article>
    </div>
  </section>
</template>

<style scoped>
.glossary-workspace { min-width: 0; display: grid; gap: var(--cc-space-7); }
.glossary-layout { display: grid; grid-template-columns: minmax(180px, 230px) minmax(0, 800px); gap: var(--cc-space-8); align-items: start; }
.glossary-index { display: grid; gap: var(--cc-space-2); position: sticky; top: 110px; }
.glossary-contents > div { display: grid; gap: var(--cc-space-2); }
.glossary-contents > summary { padding: var(--cc-space-3); font-size: var(--cc-font-size-sm); }
.glossary-index button { text-align: left; padding: var(--cc-space-3); border: 1px solid transparent; border-radius: var(--cc-radius-sm); color: var(--cc-text-muted); background: transparent; cursor: pointer; font: inherit; }
.glossary-index button:hover, .glossary-index button[aria-current] { color: var(--cc-accent-strong); border-color: var(--cc-accent-border); background: var(--cc-accent-surface); }
.glossary-entry { min-width: 0; color: var(--cc-text-primary); line-height: var(--cc-line-body); overflow-wrap: anywhere; }
.glossary-entry h3 { margin: 0; color: var(--cc-text-strong); font: 500 var(--cc-font-size-3xl)/1.2 var(--cc-font-display); }
.glossary-entry h4, summary { color: var(--cc-text-strong); font-size: var(--cc-font-size-2xl); font-weight: 650; }
.glossary-entry h4 { margin: 0; }
.glossary-entry p { margin: var(--cc-space-3) 0; }
.glossary-lede, .glossary-sources p { color: var(--cc-text-muted); }
.glossary-example { margin: var(--cc-space-6) 0; padding: var(--cc-space-6); border: 1px solid var(--cc-accent-border); border-radius: var(--cc-radius-lg); background: var(--cc-accent-surface); }
.glossary-example > p:first-child { color: var(--cc-text-muted); margin-top: 0; }
.glossary-score { display: flex; flex-wrap: wrap; gap: var(--cc-space-8); margin-block: var(--cc-space-5); }
.glossary-score span { display: grid; gap: var(--cc-space-2); }
.glossary-score strong { color: var(--cc-accent-strong); font: 500 var(--cc-font-size-5xl)/1 var(--cc-font-display); }
.glossary-score small { color: var(--cc-text-muted); }
.glossary-section { padding: var(--cc-space-6) 0; border-top: 1px solid var(--cc-border-subtle); scroll-margin-top: 110px; }
.glossary-caution { padding: var(--cc-space-5); margin-bottom: var(--cc-space-5); border: 1px solid var(--cc-accent-border); border-left: 3px solid var(--cc-accent); border-radius: var(--cc-radius-sm); background: var(--cc-surface-2); }
summary { cursor: pointer; padding-block: var(--cc-space-2); }
li + li { margin-top: var(--cc-space-3); }
ul { padding-left: var(--cc-space-6); }
table { width: 100%; margin-block: var(--cc-space-5); border-collapse: collapse; font-size: var(--cc-font-size-sm); }
caption { text-align: left; color: var(--cc-text-muted); margin-bottom: var(--cc-space-2); }
th, td { text-align: left; padding: var(--cc-space-3); border-bottom: 1px solid var(--cc-border-subtle); }
th { color: var(--cc-text-strong); }
.glossary-sources { padding-top: var(--cc-space-6); border-top: 1px solid var(--cc-border-subtle); }
a { color: var(--cc-accent-strong); text-decoration: underline; text-underline-offset: 3px; }
button:focus-visible, summary:focus-visible, a:focus-visible, [tabindex='-1']:focus-visible { outline: 2px solid var(--cc-focus); outline-offset: 3px; }
@media (max-width: 1100px) {
  .glossary-layout { grid-template-columns: minmax(0, 1fr); }
  .glossary-index { position: static; }
  .glossary-index button { padding-block: var(--cc-space-2); }
}
@media (max-width: 600px) {
  .glossary-example { padding: var(--cc-space-4); }
  .glossary-score { gap: var(--cc-space-5); }
  th, td { padding: var(--cc-space-2); }
}
</style>
