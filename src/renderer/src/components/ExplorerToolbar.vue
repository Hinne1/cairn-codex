<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  searchLabel?: string
  placeholder?: string
  resultCount?: number
  resultLabel?: string
  tone?: 'gold' | 'green'
}>(), {
  searchLabel: 'Search',
  placeholder: 'Search…',
  resultCount: 0,
  resultLabel: 'results',
  tone: 'gold'
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const searchInput = ref<HTMLInputElement | null>(null)

function syncSearchInput(): void {
  void nextTick(() => {
    if (searchInput.value) searchInput.value.value = props.modelValue
  })
}

onMounted(() => window.addEventListener('pageshow', syncSearchInput))
onBeforeUnmount(() => window.removeEventListener('pageshow', syncSearchInput))
</script>

<template>
  <div :class="['explorer-toolbar', `tone-${tone}`]">
    <div v-if="$slots.before" class="explorer-toolbar-before">
      <slot name="before" />
    </div>

    <label class="explorer-search">
      <span>{{ searchLabel }}</span>
      <span class="explorer-search-input">
        <input
          ref="searchInput"
          :value="modelValue"
          type="search"
          autocomplete="off"
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
    </label>

    <div v-if="$slots.filters" class="explorer-toolbar-group explorer-toolbar-filters">
      <slot name="filters" />
    </div>

    <div v-if="$slots.sort" class="explorer-toolbar-group explorer-toolbar-sort">
      <slot name="sort" />
    </div>

    <div v-if="$slots.actions" class="explorer-toolbar-actions">
      <slot name="actions" />
    </div>

    <output class="explorer-result-count">
      <strong>{{ resultCount.toLocaleString() }}</strong>
      <span>{{ resultLabel }}</span>
    </output>
  </div>
</template>

<style scoped>
.explorer-toolbar {
  --explorer-border: #454034;
  --explorer-focus: #8c7040;
  --explorer-glow: rgba(140, 112, 64, .14);
  display: grid;
  grid-template-columns: minmax(260px, 1fr) auto auto auto;
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

.explorer-toolbar-before { grid-column: 1 / -1; }
.explorer-search { position: relative; display: grid; min-width: 0; gap: 5px; }
.explorer-search > span:first-child,
.explorer-toolbar :deep(label > span:first-child) {
  color: #807765;
  font-size: 8px;
  letter-spacing: .09em;
  text-transform: uppercase;
}
.tone-green .explorer-search > span:first-child,
.tone-green :deep(label > span:first-child) { color: #75816d; }
.explorer-search-input { position: relative; display: block; }
.explorer-search input,
.explorer-toolbar :deep(select) {
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
.explorer-toolbar :deep(select:focus) {
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
.explorer-toolbar-group { display: flex; align-items: end; gap: 8px; }
.explorer-toolbar-group :deep(label) { display: grid; min-width: 150px; gap: 5px; }
.explorer-toolbar-sort :deep(label:first-child) { min-width: 190px; }
.explorer-toolbar-actions { display: flex; align-items: center; gap: 8px; }
.explorer-toolbar-actions :deep(button) {
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid #55472f;
  border-radius: 5px;
  color: #d5ba7b;
  background: #2a241b;
  cursor: pointer;
}
.explorer-toolbar-actions :deep(button:disabled) { opacity: .4; cursor: default; }
.explorer-result-count {
  display: flex;
  min-width: 74px;
  flex-direction: column;
  align-items: flex-end;
  padding: 0 3px 5px;
  color: #766f61;
  text-align: right;
}
.explorer-result-count strong { color: #d3aa55; font: 500 16px Georgia, serif; }
.tone-green .explorer-result-count strong { color: #91bd73; }
.explorer-result-count span { font-size: 8px; letter-spacing: .06em; text-transform: uppercase; }

@media (max-width: 1180px) {
  .explorer-toolbar { grid-template-columns: minmax(240px, 1fr) auto; }
  .explorer-toolbar-group { flex-wrap: wrap; }
  .explorer-result-count { grid-column: 2; grid-row: 1; }
}

@media (max-width: 760px) {
  .explorer-toolbar { display: flex; align-items: stretch; flex-direction: column; }
  .explorer-toolbar-group,
  .explorer-toolbar-actions { align-items: stretch; flex-direction: column; }
  .explorer-toolbar-group :deep(label) { min-width: 0; }
  .explorer-result-count { align-items: flex-start; text-align: left; }
}
</style>
