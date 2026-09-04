<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, type CSSProperties } from 'vue'
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
  tone?: 'gold' | 'green' | 'blue' | 'ember'
  loading?: boolean
  searchError?: string | null
  layout?: 'standard' | 'research'
}>(), {
  searchLabel: 'Search',
  placeholder: 'Search…',
  resultCount: 0,
  resultLabel: 'results',
  tone: 'gold',
  loading: false,
  searchError: null,
  layout: 'standard'
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const searchInput = ref<HTMLInputElement | null>(null)
const searchHelpDetails = ref<HTMLDetailsElement | null>(null)
const searchHelpSummary = ref<HTMLElement | null>(null)
const searchHelpPanel = ref<HTMLElement | null>(null)
const searchHelpPanelStyle = ref<CSSProperties>({})
const searchHelpOpen = ref(false)
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
  searchHelpOpen.value = false
  void nextTick(() => {
    searchInput.value?.focus()
    searchInput.value?.select()
  })
}

async function positionSearchHelpPanel(): Promise<void> {
  if (!searchHelpDetails.value?.open || !searchHelpSummary.value || !searchHelpPanel.value) return
  const gap = 16
  const trigger = searchHelpSummary.value.getBoundingClientRect()
  const width = Math.min(370, Math.max(0, window.innerWidth - gap * 2))
  const maximumHeight = Math.max(120, window.innerHeight - gap * 2)
  const panelHeight = Math.min(searchHelpPanel.value.scrollHeight, maximumHeight)
  const left = Math.min(
    Math.max(gap, trigger.right - width),
    Math.max(gap, window.innerWidth - width - gap)
  )
  const below = trigger.bottom + 7
  const top = below + panelHeight <= window.innerHeight - gap
    ? below
    : Math.max(gap, trigger.top - panelHeight - 7)
  searchHelpPanelStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.round(maximumHeight)}px`
  }
  await nextTick()
  if (!searchHelpPanel.value) return
  const rendered = searchHelpPanel.value.getBoundingClientRect()
  const leftCorrection = left - rendered.left
  const topCorrection = top - rendered.top
  if (Math.abs(leftCorrection) > 0.5 || Math.abs(topCorrection) > 0.5) {
    searchHelpPanelStyle.value = {
      ...searchHelpPanelStyle.value,
      left: `${Math.round(left + leftCorrection)}px`,
      top: `${Math.round(top + topCorrection)}px`
    }
  }
}

function handleSearchHelpToggle(): void {
  searchHelpOpen.value = Boolean(searchHelpDetails.value?.open)
  if (searchHelpOpen.value) void nextTick(positionSearchHelpPanel)
}

function closeSearchHelp(): void {
  if (!searchHelpDetails.value?.open) return
  searchHelpDetails.value.open = false
  searchHelpOpen.value = false
  void nextTick(() => searchHelpSummary.value?.focus())
}

onMounted(() => {
  window.addEventListener('pageshow', syncSearchInput)
  window.addEventListener('resize', positionSearchHelpPanel)
  window.addEventListener('scroll', positionSearchHelpPanel, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('pageshow', syncSearchInput)
  window.removeEventListener('resize', positionSearchHelpPanel)
  window.removeEventListener('scroll', positionSearchHelpPanel, true)
})
</script>

<template>
  <div :class="['explorer-toolbar', `tone-${tone}`, { 'research-toolbar': layout === 'research' }]" :aria-busy="loading">
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
          <details ref="searchHelpDetails" class="explorer-search-help" @toggle="handleSearchHelpToggle">
            <summary ref="searchHelpSummary" :aria-label="`${searchLabel} help and examples`" @keydown.esc.prevent="closeSearchHelp">Search tips</summary>
          </details>
          <Teleport to="body">
            <div v-if="searchHelpOpen" ref="searchHelpPanel" :id="searchHelpId" class="explorer-search-help-panel" :style="searchHelpPanelStyle" @keydown.esc.prevent="closeSearchHelp">
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
          </Teleport>
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

    <div class="explorer-toolbar-results">
      <output class="explorer-result-count" aria-live="polite">
        <span class="explorer-result-value">
          <span v-if="loading" class="explorer-result-spinner" aria-hidden="true" />
          <strong>{{ resultCount.toLocaleString() }}</strong>
        </span>
        <span>{{ loading ? 'Updating…' : resultLabel }}</span>
      </output>
      <div v-if="$slots.sort" class="explorer-toolbar-group explorer-toolbar-sort">
        <slot name="sort" />
      </div>

      <div v-if="$slots.actions" class="explorer-toolbar-actions">
        <slot name="actions" />
      </div>

      <div v-if="$slots.views" class="explorer-toolbar-views"><slot name="views" /></div>
    </div>
    <div v-if="$slots.summary" class="explorer-toolbar-summary"><slot name="summary" /></div>
  </div>
</template>

<style scoped>
.explorer-toolbar {
  --explorer-border: var(--cc-tone-border);
  --explorer-focus: var(--cc-tone-focus);
  --explorer-glow: var(--cc-tone-focus-ring);
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--cc-space-3);
  padding: var(--cc-space-5);
  border: 1px solid var(--cc-border-default);
  border-radius: var(--cc-radius-md);
  background: var(--cc-tone-surface);
}

.explorer-toolbar.tone-green {
  --cc-tone-accent: var(--cc-tone-green-accent);
  --cc-tone-accent-soft: var(--cc-tone-green-accent-soft);
  --cc-tone-border: var(--cc-tone-green-border);
  --cc-tone-surface: var(--cc-tone-green-surface);
  --cc-tone-muted: var(--cc-tone-green-muted);
  --cc-tone-focus: var(--cc-tone-green-focus);
  --cc-tone-focus-ring: var(--cc-tone-green-focus-ring);
  border-color: color-mix(in srgb, var(--cc-tone-border), var(--cc-canvas) 18%);
}
.explorer-toolbar.tone-blue {
  --cc-tone-accent: var(--cc-tone-blue-accent);
  --cc-tone-accent-soft: var(--cc-tone-blue-heading);
  --cc-tone-border: var(--cc-tone-blue-border);
  --cc-tone-surface: var(--cc-tone-blue-surface);
  --cc-tone-muted: var(--cc-tone-blue-muted);
  --cc-tone-focus: var(--cc-tone-blue-accent);
  --cc-tone-focus-ring: color-mix(in srgb, var(--cc-tone-blue-accent), transparent 84%);
}
.explorer-toolbar.tone-ember {
  --cc-tone-accent: var(--cc-tone-ember-accent);
  --cc-tone-accent-soft: var(--cc-warning);
  --cc-tone-border: var(--cc-tone-ember-border);
  --cc-tone-surface: var(--cc-tone-ember-surface);
  --cc-tone-muted: var(--cc-text-muted);
  --cc-tone-focus: var(--cc-tone-ember-accent);
  --cc-tone-focus-ring: var(--cc-tone-ember-glow);
}

.explorer-toolbar-before { flex: 1 0 100%; }
.explorer-toolbar-results { display: contents; }
.explorer-result-count { order: 1; }
.explorer-search { position: relative; display: grid; min-width: 240px; flex: 1 1 280px; gap: var(--cc-space-1); }
.explorer-search-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--cc-space-4); }
.explorer-search-actions { display: flex; align-items: center; gap: var(--cc-space-2); }
.explorer-search-heading > label,
.explorer-toolbar :deep(label > span:first-child) {
  color: var(--cc-tone-muted);
  font-size: var(--cc-font-size-2xs);
  letter-spacing: var(--cc-letter-label);
  text-transform: uppercase;
}
.explorer-search-help { position: relative; }
.explorer-search-help summary {
  padding: 2px var(--cc-space-1);
  border-radius: var(--cc-radius-xs);
  color: var(--cc-tone-muted);
  cursor: pointer;
  font-size: var(--cc-font-size-2xs);
  letter-spacing: .06em;
  list-style: none;
  text-transform: uppercase;
}
.explorer-search-help summary::-webkit-details-marker { display: none; }
.explorer-search-help summary:hover { color: var(--cc-tone-accent-soft); }
.explorer-search-help summary:focus-visible {
  outline: 1px solid var(--explorer-focus);
  outline-offset: 2px;
}
.explorer-search-help[open] summary { color: var(--cc-tone-accent-soft); }
.explorer-search-help-panel {
  position: fixed;
  z-index: 70;
  overflow-y: auto;
  padding: var(--cc-space-5);
  border: 1px solid var(--explorer-border);
  border-radius: var(--cc-radius-sm);
  background: var(--cc-surface-1);
  box-shadow: var(--cc-shadow-popover);
}
.explorer-search-help-panel p {
  margin: 0 0 var(--cc-space-4);
  color: var(--cc-text-secondary);
  font-size: var(--cc-font-size-sm);
  line-height: var(--cc-line-body);
}
.explorer-search-help-panel > span {
  display: block;
  margin-bottom: var(--cc-space-2);
  color: var(--cc-text-subtle);
  font-size: var(--cc-font-size-2xs);
  letter-spacing: .07em;
  text-transform: uppercase;
}
.explorer-search-examples { display: flex; flex-wrap: wrap; gap: var(--cc-space-2); }
.explorer-search-examples button {
  min-height: 28px;
  padding: 5px var(--cc-space-3);
  border: 1px solid var(--cc-accent-border);
  border-radius: var(--cc-radius-xs);
  color: var(--cc-tone-accent-soft);
  background: var(--cc-accent-surface);
  cursor: pointer;
  font: var(--cc-font-size-sm) var(--cc-font-mono);
  text-align: left;
}
.explorer-search-examples button:hover { border-color: var(--explorer-focus); background: var(--cc-accent-surface-hover); }
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
  height: var(--cc-control-height);
  padding: 0 34px 0 11px;
  border: 1px solid var(--explorer-border);
  border-radius: var(--cc-radius-sm);
  color: var(--cc-text-primary);
  outline: none;
  background: var(--cc-surface-input);
  font: inherit;
  font-size: var(--cc-font-size-md);
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
  color: var(--cc-text-subtle);
  background: transparent;
  transform: translateY(-50%);
  cursor: pointer;
}
.explorer-search input[aria-invalid='true'] { border-color: var(--cc-danger-border); box-shadow: 0 0 0 2px color-mix(in srgb, var(--cc-danger), transparent 88%); }
.explorer-search-error { margin: 0; color: var(--cc-danger); font-size: var(--cc-font-size-xs); line-height: 1.4; }
.explorer-toolbar-group { display: flex; flex: 0 1 auto; flex-wrap: wrap; align-items: end; gap: 8px; }
.explorer-toolbar-group :deep(label) { display: grid; min-width: 150px; gap: 5px; }
.explorer-toolbar-sort :deep(label:first-child) { min-width: 190px; }
.explorer-toolbar :deep(.explorer-range-control > span:last-child) { display: grid; grid-template-columns: 72px auto 72px; align-items: center; gap: 5px; }
.explorer-toolbar :deep(.explorer-range-control b) { color: var(--cc-text-subtle); font-size: var(--cc-font-size-xs); font-weight: 400; text-align: center; }
.explorer-toolbar :deep(.explorer-range-control input) { padding: 0 7px; text-align: center; }
.explorer-toolbar-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; }
.explorer-toolbar-actions :deep(button) {
  min-height: var(--cc-control-height);
  padding: 0 var(--cc-space-5);
  border: 1px solid var(--cc-accent-border);
  border-radius: var(--cc-radius-sm);
  color: var(--cc-tone-accent-soft);
  background: var(--cc-accent-surface);
  cursor: pointer;
  transition: border-color var(--cc-transition-fast), background var(--cc-transition-fast);
  white-space: nowrap;
}
.explorer-toolbar-actions :deep(button:hover:not(:disabled)) { border-color: var(--explorer-focus); background: var(--cc-accent-surface-hover); }
.explorer-toolbar-actions :deep(button:focus-visible) { outline: 2px solid var(--explorer-focus); outline-offset: 1px; }
.explorer-toolbar-actions :deep(button:disabled) { opacity: .4; cursor: default; }
.explorer-result-count {
  display: flex;
  min-width: 112px;
  min-height: var(--cc-control-height);
  margin-left: auto;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 3px 0 3px var(--cc-space-4);
  border-left: 1px solid color-mix(in srgb, var(--explorer-border), transparent 35%);
  color: var(--cc-text-subtle);
  text-align: left;
}
.explorer-result-count strong { color: var(--cc-tone-accent); font: 500 var(--cc-font-size-2xl)/1 var(--cc-font-display); }
.explorer-result-value { display: flex; align-items: center; gap: 6px; }
.explorer-result-spinner {
  width: 10px;
  height: 10px;
  border: 1px solid color-mix(in srgb, var(--cc-tone-accent), transparent 70%);
  border-top-color: var(--cc-tone-accent);
  border-radius: 50%;
  animation: explorer-spin .75s linear infinite;
}
.explorer-result-count span { font-size: var(--cc-font-size-2xs); letter-spacing: .06em; text-transform: uppercase; }

@keyframes explorer-spin { to { transform: rotate(360deg); } }

@media (max-width: 1180px) {
  .explorer-toolbar { align-items: stretch; flex-direction: column; }
  .explorer-search { width: 100%; min-width: 0; flex-basis: auto; }
  .explorer-toolbar-group {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  }
  .explorer-toolbar-group :deep(label),
  .explorer-toolbar-sort :deep(label:first-child) { width: 100%; min-width: 0; }
  .explorer-toolbar-actions { width: 100%; flex-wrap: wrap; }
  .explorer-toolbar-actions :deep(button) { min-width: min(210px, 100%); flex: 1 1 auto; white-space: normal; }
  .explorer-result-count { min-height: 0; margin-left: 0; flex-direction: row; align-items: baseline; justify-content: flex-start; gap: var(--cc-space-2); padding: var(--cc-space-2) 0 0; border-top: 1px solid color-mix(in srgb, var(--explorer-border), transparent 45%); border-left: 0; text-align: left; }
}

@media (max-width: 760px) {
  .explorer-toolbar { padding: var(--cc-space-4); }
  .explorer-toolbar-actions { align-items: stretch; flex-direction: column; }
}

/* Research composition is opt-in; other workspaces keep the standard layout. */
.research-toolbar { display: grid; padding: 0; border: 0; background: transparent; gap: var(--cc-space-4); min-width: 0; }
.research-toolbar .explorer-toolbar-before { min-width: 0; padding: var(--cc-space-5); border: 1px solid var(--cc-border-default); border-radius: var(--cc-radius-md); background: var(--cc-surface-1); }
.research-toolbar .explorer-search { min-width: 0; width: 100%; }
.research-toolbar .explorer-toolbar-filters { display: flex; width: 100%; }
.research-toolbar .explorer-toolbar-filters :deep(label) { flex: 1 1 140px; min-width: 0; }
.research-toolbar .explorer-toolbar-results { display: flex; flex-wrap: wrap; align-items: end; gap: var(--cc-space-3); padding-top: var(--cc-space-3); border-top: 1px solid var(--cc-border-default); min-width: 0; }
.research-toolbar .explorer-result-count { order: 0; flex-direction: row; flex-wrap: wrap; align-items: center; gap: var(--cc-space-2); margin: 0 auto 0 0; padding: 0; border: 0; min-height: var(--cc-control-height); }
.research-toolbar .explorer-result-count strong { font: 500 var(--cc-font-size-md) var(--cc-font-interface); }
.research-toolbar .explorer-result-count span { font-size: var(--cc-font-size-sm); text-transform: none; letter-spacing: normal; }
.research-toolbar .explorer-toolbar-sort { display: flex; flex-wrap: nowrap; width: auto; min-width: 0; }
.research-toolbar .explorer-toolbar-sort :deep(label),
.research-toolbar .explorer-toolbar-sort :deep(label:first-child) { min-width: 0; width: auto; flex: 1 1 150px; }
.research-toolbar .explorer-toolbar-summary { display: flex; flex-wrap: wrap; gap: var(--cc-space-4); color: var(--cc-text-muted); font-size: var(--cc-font-size-sm); }
.research-toolbar :deep(.research-context-row) { display: flex; align-items: end; flex-wrap: wrap; gap: var(--cc-space-3); min-width: 0; }
.research-toolbar :deep(.research-subject-field) { display: grid; flex: 1 1 220px; gap: var(--cc-space-2); min-width: 0; }
.research-toolbar :deep(.research-context-label) { color: var(--cc-text-muted); font-size: var(--cc-font-size-xs); }
.research-toolbar :deep(.research-context-input) { width: 100%; height: var(--cc-control-height); padding: 0 var(--cc-control-height) 0 var(--cc-space-3); border: 1px solid var(--cc-border-default); border-radius: var(--cc-radius-sm); color: var(--cc-text-primary); background: var(--cc-surface-input); font: var(--cc-font-size-md) var(--cc-font-interface); }
.research-toolbar :deep(.research-context-button) { min-height: var(--cc-control-height); padding: var(--cc-space-2) var(--cc-space-3); border: 1px solid var(--cc-border-default); border-radius: var(--cc-radius-sm); color: var(--cc-text-primary); background: var(--cc-surface-input); cursor: pointer; font: var(--cc-font-size-md) var(--cc-font-interface); }
.research-toolbar :deep(.research-context-button:hover:not(:disabled)) { border-color: var(--cc-accent-border); background: var(--cc-accent-surface); }
.research-toolbar :deep(.research-context-button:disabled) { opacity: .45; cursor: default; }
.research-toolbar :deep(.research-context-input:focus-visible),
.research-toolbar :deep(.research-context-button:focus-visible) { outline: 2px solid var(--cc-focus); outline-offset: 2px; }
.research-toolbar :deep(.research-context-note) { margin: var(--cc-space-2) 0 0; color: var(--cc-text-muted); font-size: var(--cc-font-size-xs); }
.research-toolbar :deep(.research-view-switch) { display: flex; flex-wrap: wrap; gap: var(--cc-space-1); }
.research-toolbar :deep(.research-view-switch button[aria-pressed='true']) { border-color: var(--cc-accent-border); color: var(--cc-accent); background: var(--cc-accent-surface); }
@media (max-width: 760px) {
  .research-toolbar .explorer-toolbar-before { padding: var(--cc-space-4); }
  .research-toolbar .explorer-result-count { flex-basis: 100%; }
  .research-toolbar .explorer-toolbar-sort { flex: 1 1 180px; }
  .research-toolbar .explorer-search-heading { flex-wrap: wrap; gap: var(--cc-space-2); }
}
</style>
