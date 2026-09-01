<script setup lang="ts">
import { nextTick, onBeforeUnmount, onErrorCaptured, ref, watch } from 'vue'
import {
  RENDERER_FAILURE_EVENT,
  rendererFailureReport,
  type RendererFailureReport
} from '../renderer-recovery'

const props = defineProps<{
  workspace: string
  report: (failure: RendererFailureReport) => Promise<void>
}>()

const emit = defineEmits<{
  'return-home': []
  'restart-safe': []
  'export-diagnostics': []
}>()

const failure = ref<RendererFailureReport | null>(null)
const retryKey = ref(0)
const retryButton = ref<HTMLButtonElement | null>(null)

function showFailure(report: RendererFailureReport): void {
  failure.value = report
  void props.report(report).catch(() => undefined)
  void nextTick(() => retryButton.value?.focus())
}

function handleGlobalFailure(event: Event): void {
  if (!(event instanceof CustomEvent)) return
  event.preventDefault()
  showFailure({ ...(event.detail as RendererFailureReport), workspace: props.workspace.slice(0, 64) })
}

window.addEventListener(RENDERER_FAILURE_EVENT, handleGlobalFailure)
onBeforeUnmount(() => window.removeEventListener(RENDERER_FAILURE_EVENT, handleGlobalFailure))

onErrorCaptured((error) => {
  const report = rendererFailureReport(error, props.workspace)
  showFailure(report)
  return false
})

watch(() => props.workspace, () => {
  failure.value = null
  retryKey.value += 1
})

function retry(): void {
  failure.value = null
  retryKey.value += 1
}
</script>

<template>
  <div v-if="failure" class="workspace-error" role="alert" aria-labelledby="workspace-error-title">
    <p class="section-label">Workspace recovery</p>
    <h2 id="workspace-error-title">{{ workspace }} could not be displayed.</h2>
    <p>
      Your archive was not changed. CC recorded a redacted diagnostic entry so this failure
      can be traced without including item payloads or character names.
    </p>
    <dl>
      <div><dt>Problem</dt><dd>{{ failure.message }}</dd></div>
      <div><dt>Correlation ID</dt><dd><code>{{ failure.correlationId }}</code></dd></div>
    </dl>
    <div class="workspace-error-actions">
      <button ref="retryButton" type="button" @click="retry">Try this workspace again</button>
      <button type="button" @click="emit('return-home')">Return to Collection</button>
      <button type="button" @click="emit('restart-safe')">Restart in safe mode</button>
      <button type="button" @click="emit('export-diagnostics')">Export diagnostics</button>
    </div>
  </div>
  <slot v-else :key="retryKey" />
</template>
