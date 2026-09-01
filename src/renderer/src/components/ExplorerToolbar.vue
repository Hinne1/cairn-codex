<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import type { SearchWorkspaceSchema } from '@shared/search-schema'
import AdvancedSearchDialog from './AdvancedSearchDialog.vue'

const props = withDefaults(defineProps<{
  modelValue: string
  searchLabel?: string
  searchHelp: string
  searchExamples: readonly string[]
  searchSchema: SearchWorkspaceSchema
  placeholder?: string
  resultCount?: number
  resultLabel?: string
  tone?: 'gold' | 'green'
  loading?: boolean
  searchError?: string | null
}>(), {
  searchLabel: 'Search',
  placeholder: 'Search…',
  resultCount: 0,
  resultLabel: 'results',
  tone: 'gold',
  loading: false,
  searchError: null
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const searchInput = ref<HTMLInputElement | null>(null)
const searchHelpDetails = ref<HTMLDetailsElement | null>(null)
const searchInputId = `explorer-search-${useId()}`
const searchHelpId = `${searchInputId}-help`
const searchErrorId = `${searchInputId}-error`

function syncSearchInput(): void {
  void nextTick(() => {
    if (searchInput.value) searchInput.value.value = props.modelValue
  })
}

function applySearchExample(example: string): void {
  emit('update:modelValue', example)
  if (searchHelpDetails.value) searchHelpDetails.value.open = false
  void nextTick(() => {
    searchInput.value?.focus()
    searchInput.value?.select()
  })
}

onMounted(() => window.addEventListener('pageshow', syncSearchInput))
onBeforeUnmount(() => window.removeEventListener('pageshow', syncSearchInput))
</script>

<template>
  <div :class="['explorer-toolbar', `tone-${tone}`]" :aria-busy="loading">
    <div v-if="$slots.before" class="explorer-toolbar-before">
      <slot name="before" />
    </div>

    <div class="explorer-search">
      <div class="explorer-search-heading">
        <label :for="searchInputId">{{ searchLabel }}</label>
        <span class="explorer-search-actions">
          <AdvancedSearchDialog
            :model-value="modelValue"
            :search-label="searchLabel"
            :schema="searchSchema"
            @update:model-value="emit('update:modelValue', $event)"
          />
          <details ref="searchHelpDetails" class="explorer-search-help">
            <summary :aria-label="`${searchLabel} help and examples`">Search tips</summary>
            <div :id="searchHelpId" class="explorer-search-help-panel">
              <p>{{ searchHelp }}</p>
              <span>Try an example</span>
              <div class="explorer-search-examples">
                <button
                  v-for="example in searchExamples"
                  :key="example"
                  type="button"
                  @click="applySearchExample(example)"
                >{{ example }}</button>
              </div>
            </div>
          </details>
        </span>
      </div>
      <span class="explorer-search-input">
        <input
          :id="searchInputId"
          ref="searchInput"
          :value="modelValue"
          type="search"
          autocomplete="off"
          :aria-invalid="Boolean(searchError)"
          :aria-describedby="searchError ? `${searchHelpId} ${searchErrorId}` : undefined"
          :aria-details="searchHelpId"
          :placeholder="placeholder"
          @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        />
        <button
          v-if="modelValue"
          type="button"
          :aria-label="`Clear ${searchLabel.toLocaleLowerCase()}`"
          @click="emit('update:modelValue', '')"
        >×</button>
      </span>
      <p v-if="searchError" :id="searchErrorId" class="explorer-search-error" role="alert">{{ searchError }}</p>
    </div>

    <div v-if="$slots.filters" class="explorer-toolbar-group explorer-toolbar-filters">
      <slot name="filters" />
    </div>

    <div v-if="$slots.sort" class="explorer-toolbar-group explorer-toolbar-sort">
      <slot name="sort" />
    </div>

    <div v-if="$slots.actions" class="explorer-toolbar-actions">
      <slot name="actions" />
    </div>

    <output class="explorer-result-count" aria-live="polite">
      <span class="explorer-result-value">
        <span v-if="loading" class="explorer-result-spinner" aria-hidden="true" />
        <strong>{{ resultCount.toLocaleString() }}</strong>
      </span>
      <span>{{ loading ? 'Updating…' : resultLabel }}</span>
    </output>
  </div>
</template>

<style scoped>
.explorer-toolbar {
  --explorer-border: #454034;
  --explorer-focus: #8c7040;
  --explorer-glow: rgba(140, 112, 64, .14);
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 9px;
  padding: 11px;
  border: 1px solid #39352c;
  border-radius: 8px;
  background: rgba(23, 23, 20, .96);
}

.explorer-toolbar.tone-green {
  --explorer-border: #46523e;
  --explorer-focus: #73955f;
  --explorer-glow: rgba(105, 145, 83, .15);
  border-color: #394333;
  background: #181a16;
}

.explorer-toolbar-before { flex: 1 0 100%; }
.explorer-search { position: relative; display: grid; min-width: 240px; flex: 1 1 280px; gap: 5px; }
.explorer-search-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.explorer-search-actions { display: flex; align-items: center; gap: 7px; }
.explorer-search-heading > label,
.explorer-toolbar :deep(label > span:first-child) {
  color: #807765;
  font-size: 8px;
  letter-spacing: .09em;
  text-transform: uppercase;
}
.tone-green .explorer-search-heading > label,
.tone-green :deep(label > span:first-child) { color: #75816d; }
.explorer-search-help { position: relative; }
.explorer-search-help summary {
  padding: 2px 4px;
  border-radius: 3px;
  color: #a18e65;
  cursor: pointer;
  font-size: 8px;
  letter-spacing: .06em;
  list-style: none;
  text-transform: uppercase;
}
.explorer-search-help summary::-webkit-details-marker { display: none; }
.explorer-search-help summary:hover { color: #d3b777; }
.explorer-search-help summary:focus-visible {
  outline: 1px solid var(--explorer-focus);
  outline-offset: 2px;
}
.explorer-search-help[open] summary { color: #d3b777; }
.explorer-search-help-panel {
  position: absolute;
  z-index: 30;
  top: calc(100% + 7px);
  right: 0;
  width: min(370px, calc(100vw - 48px));
  padding: 12px;
  border: 1px solid var(--explorer-border);
  border-radius: 6px;
  background: #191813;
  box-shadow: 0 12px 28px rgba(0, 0, 0, .42);
}
.explorer-search-help-panel p {
  margin: 0 0 10px;
  color: #b5ab98;
  font-size: 10px;
  line-height: 1.5;
}
.explorer-search-help-panel > span {
  display: block;
  margin-bottom: 6px;
  color: #756e61;
  font-size: 8px;
  letter-spacing: .07em;
  text-transform: uppercase;
}
.explorer-search-examples { display: flex; flex-wrap: wrap; gap: 6px; }
.explorer-search-examples button {
  min-height: 28px;
  padding: 5px 8px;
  border: 1px solid #4b4231;
  border-radius: 4px;
  color: #d5ba7b;
  background: #262117;
  cursor: pointer;
  font: 10px Consolas, monospace;
  text-align: left;
}
.explorer-search-examples button:hover { border-color: var(--explorer-focus); background: #30281a; }
.explorer-search-examples button:focus-visible {
  outline: 2px solid var(--explorer-focus);
  outline-offset: 1px;
}
.explorer-search-input { position: relative; display: block; }
.explorer-search input,
.explorer-toolbar :deep(select),
.explorer-toolbar :deep(label input:not([type='checkbox']):not([type='range'])) {
  width: 100%;
  min-width: 0;
  height: 38px;
  padding: 0 34px 0 11px;
  border: 1px solid var(--explorer-border);
  border-radius: 5px;
  color: #ded4bf;
  outline: none;
  background: #11110f;
  font: inherit;
  font-size: 11px;
}
.explorer-toolbar :deep(select) { padding-right: 30px; }
.explorer-search input:focus,
.explorer-toolbar :deep(select:focus),
.explorer-toolbar :deep(label input:not([type='checkbox']):not([type='range']):focus) {
  border-color: var(--explorer-focus);
  box-shadow: 0 0 0 2px var(--explorer-glow);
}
.explorer-search-input button {
  position: absolute;
  top: 50%;
  right: 7px;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  color: #817865;
  background: transparent;
  transform: translateY(-50%);
  cursor: pointer;
}
.explorer-search input[aria-invalid='true'] { border-color: #a95d4c; box-shadow: 0 0 0 2px rgba(169,93,76,.12); }
.explorer-search-error { margin: 0; color: #cf8e7e; font-size: 9px; line-height: 1.4; }
.explorer-toolbar-group { display: flex; flex: 0 1 auto; flex-wrap: wrap; align-items: end; gap: 8px; }
.explorer-toolbar-group :deep(label) { display: grid; min-width: 150px; gap: 5px; }
.explorer-toolbar-sort :deep(label:first-child) { min-width: 190px; }
.explorer-toolbar :deep(.explorer-range-control > span:last-child) { display: grid; grid-template-columns: 72px auto 72px; align-items: center; gap: 5px; }
.explorer-toolbar :deep(.explorer-range-control b) { color: #756e61; font-size: 9px; font-weight: 400; text-align: center; }
.explorer-toolbar :deep(.explorer-range-control input) { padding: 0 7px; text-align: center; }
.explorer-toolbar-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; }
.explorer-toolbar-actions :deep(button) {
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid #55472f;
  border-radius: 5px;
  color: #d5ba7b;
  background: #2a241b;
  cursor: pointer;
  white-space: nowrap;
}
.explorer-toolbar-actions :deep(button:disabled) { opacity: .4; cursor: default; }
.explorer-result-count {
  display: flex;
  min-width: 74px;
  margin-left: auto;
  flex-direction: column;
  align-items: flex-end;
  padding: 0 3px 5px;
  color: #766f61;
  text-align: right;
}
.explorer-result-count strong { color: #d3aa55; font: 500 16px Georgia, serif; }
.explorer-result-value { display: flex; align-items: center; gap: 6px; }
.explorer-result-spinner {
  width: 10px;
  height: 10px;
  border: 1px solid rgba(211, 170, 85, .3);
  border-top-color: #d3aa55;
  border-radius: 50%;
  animation: explorer-spin .75s linear infinite;
}
.tone-green .explorer-result-count strong { color: #91bd73; }
.tone-green .explorer-result-spinner { border-color: rgba(145, 189, 115, .3); border-top-color: #91bd73; }
.explorer-result-count span { font-size: 8px; letter-spacing: .06em; text-transform: uppercase; }

@keyframes explorer-spin { to { transform: rotate(360deg); } }

@media (max-width: 1180px) {
  .explorer-search { flex-basis: 100%; }
}

@media (max-width: 760px) {
  .explorer-toolbar { display: flex; align-items: stretch; flex-direction: column; }
  .explorer-toolbar-group,
  .explorer-toolbar-actions { align-items: stretch; flex-direction: column; }
  .explorer-toolbar-group :deep(label) { min-width: 0; }
  .explorer-result-count { align-items: flex-start; text-align: left; }
}
</style>
