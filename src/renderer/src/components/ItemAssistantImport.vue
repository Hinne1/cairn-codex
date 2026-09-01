<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { GdiaImportProgress, GdiaImportResult } from '@shared/contracts'

defineProps<{ disabled?: boolean }>()

const emit = defineEmits<{
  completed: [result: GdiaImportResult]
}>()

const busy = ref(false)
const progress = ref<GdiaImportProgress | null>(null)
const result = ref<GdiaImportResult | null>(null)
const error = ref<string | null>(null)
let stopProgress: (() => void) | null = null

onMounted(async () => {
  stopProgress = window.cairnCodex.onGdiaImportProgress((value) => {
    progress.value = value
  })
  try {
    result.value = await window.cairnCodex.getLastGdiaImportResult()
  } catch (loadError) {
    console.warn('The last Item Assistant import result could not be restored.', loadError)
  }
})

onBeforeUnmount(() => stopProgress?.())

async function startImport(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  progress.value = null
  try {
    const completed = await window.cairnCodex.importGdiaDatabase()
    if (completed.canceled) return
    result.value = completed
    emit('completed', completed)
  } catch (importError) {
    error.value = readableError(importError)
  } finally {
    busy.value = false
  }
}

function readableError(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

function formatCompletedAt(value: string | null): string {
  if (!value) return 'Unknown time'
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString()
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds} ms`
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`
}
</script>

<template>
  <article class="settings-card migration-settings">
    <p class="section-label">Migration</p>
    <h3>Import from Item Assistant</h3>
    <p>Choose Item Assistant's <code>userdata.db</code>. Cairn analyzes the source without changing it, shows the exact import plan for confirmation, then imports only from a verified immutable backup.</p>
    <button class="settings-action" type="button" :disabled="busy || disabled" @click="startImport">
      {{ busy ? (progress?.label ?? 'Preparing import…') : 'Choose and analyze Item Assistant database…' }}
    </button>
    <small>Close Item Assistant first. Cancel is available during source selection and confirmation, before any backup or archive mutation begins.</small>

    <div v-if="progress && busy" class="migration-progress" role="status" aria-live="polite">
      <div><strong>{{ progress.label }}</strong><span>{{ progress.percent }}%</span></div>
      <progress :value="progress.percent" max="100">{{ progress.percent }}%</progress>
      <p>{{ progress.detail }}</p>
      <small>{{ progress.canCancel ? 'Safe cancellation boundary.' : 'This verified stage runs to completion.' }}</small>
    </div>

    <p v-if="error" class="migration-error" role="alert">{{ error }}</p>

    <section v-if="result" class="migration-summary" aria-label="Last Item Assistant import result">
      <header>
        <div><strong>Last completed import</strong><small>{{ formatCompletedAt(result.completedAtUtc) }} · {{ formatDuration(result.durationMs) }}</small></div>
        <span :class="{ warning: !result.receiptPersisted }">{{ result.receiptPersisted ? 'Durable receipt saved' : 'Receipt could not be saved' }}</span>
      </header>
      <p class="migration-source" :title="result.sourcePath ?? ''">{{ result.sourcePath }}</p>
      <dl class="migration-result">
        <div><dt>Imported</dt><dd>{{ result.importedItems.toLocaleString() }}</dd></div>
        <div><dt>Already present</dt><dd>{{ result.duplicateItems.toLocaleString() }}</dd></div>
        <div><dt>Unsupported</dt><dd>{{ result.unsupportedItems.toLocaleString() }}</dd></div>
        <div><dt>Modes</dt><dd>{{ result.sourceSoftcoreItems.toLocaleString() }} SC · {{ result.sourceHardcoreItems.toLocaleString() }} HC</dd></div>
        <div><dt>Pending queue</dt><dd>{{ result.sourceQueueItems.toLocaleString() }}</dd></div>
        <div><dt>Source backup</dt><dd>{{ result.backupReused ? 'Verified copy reused' : 'Verified copy created' }}</dd></div>
      </dl>
    </section>
  </article>
</template>

<style scoped>
.migration-progress,
.migration-summary {
  display: grid;
  gap: 9px;
  margin-top: 14px;
  padding: 12px;
  border: 1px solid #464034;
  border-radius: 7px;
  background: rgba(17, 17, 15, .72);
}
.migration-progress > div,
.migration-summary > header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.migration-progress span,
.migration-summary header > span { color: #bca264; font-size: 10px; }
.migration-progress progress { width: 100%; accent-color: #b99345; }
.migration-progress p,
.migration-source { margin: 0; color: #a9a08e; font-size: 11px; }
.migration-summary header div { display: grid; gap: 3px; }
.migration-summary header small { color: #817968; }
.migration-summary header > span.warning,
.migration-error { color: #d88b73; }
.migration-source { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.migration-result { margin: 0; }
@media (max-width: 680px) {
  .migration-progress > div,
  .migration-summary > header { align-items: flex-start; flex-direction: column; }
}
</style>
