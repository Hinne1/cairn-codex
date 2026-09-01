<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { GdiaImportResult } from '@shared/contracts'
import { ONBOARDING_STEP_COUNT } from '../onboarding'
import ItemAssistantImport from './ItemAssistantImport.vue'

const props = defineProps<{
  step: number
  installCount: number
  saveCount: number
  archivedCopyCount: number
  archiveSummaryStatus: 'loading' | 'ready' | 'unavailable'
  snapshotAvailable: boolean
}>()

const emit = defineEmits<{
  skip: []
  settings: []
  'set-step': [step: number]
  'continue-without-import': []
  finish: []
  'import-completed': [result: GdiaImportResult]
}>()

const dialog = ref<HTMLElement | null>(null)
const previouslyFocused = document.activeElement instanceof HTMLElement
  ? document.activeElement
  : null

onMounted(() => void nextTick(() => dialog.value?.focus()))
onBeforeUnmount(() => void nextTick(() => previouslyFocused?.focus()))

function handleDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('skip')
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return
  const controls = [...dialog.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  )].filter((control) => control.offsetParent !== null)
  if (!controls.length) {
    event.preventDefault()
    dialog.value.focus()
    return
  }
  const first = controls[0]!
  const last = controls[controls.length - 1]!
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <div class="onboarding-backdrop">
    <section
      ref="dialog"
      class="onboarding-dialog"
      :data-onboarding-step="step"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      aria-describedby="onboarding-description"
      @keydown="handleDialogKeydown"
    >
      <header class="onboarding-header">
        <div>
          <p class="section-label">First-run guide · {{ step + 1 }} / {{ ONBOARDING_STEP_COUNT }}</p>
          <h2 id="onboarding-title">Welcome to Cairn Codex</h2>
          <p id="onboarding-description">A four-part tour of discovery, your archive, safe transfers, and the tools worth knowing first.</p>
        </div>
        <button type="button" class="onboarding-skip" @click="emit('skip')">Skip for now</button>
      </header>

      <ol class="onboarding-progress" aria-label="Onboarding progress">
        <li v-for="progressStep in ONBOARDING_STEP_COUNT" :key="progressStep" :class="{ active: step === progressStep - 1, done: step > progressStep - 1 }">
          <span>{{ progressStep }}</span>
        </li>
      </ol>

      <div v-if="step === 0" class="onboarding-page">
        <p class="section-label">Game discovery</p>
        <h3>First, make sure Cairn can see Grim Dawn.</h3>
        <p>Cairn automatically checks Steam, extra Steam libraries, GOG, local saves, and cloud saves. You never need to paste a game path into the app.</p>
        <div class="onboarding-discovery-grid">
          <article :class="{ ready: installCount > 0 }">
            <strong>{{ installCount }}</strong>
            <span>installation{{ installCount === 1 ? '' : 's' }} found</span>
          </article>
          <article :class="{ ready: saveCount > 0 }">
            <strong>{{ saveCount }}</strong>
            <span>save location{{ saveCount === 1 ? '' : 's' }} found</span>
          </article>
        </div>
        <p v-if="installCount === 0" class="onboarding-callout warning">No installation is indexed yet. You can still use recovery and diagnostics; install or launch Grim Dawn, then use Settings → Rebuild game-data index.</p>
        <p v-else class="onboarding-callout">Discovery is ready. The first game-data index can take a few minutes; later cached starts are much faster.</p>
        <small>Physical-stash overrides are optional. Enable the Legacy Stash Scanner in Settings only when you deliberately want to choose individual SC/HC stash files.</small>
      </div>

      <div v-else-if="step === 1" class="onboarding-page onboarding-import-page">
        <p class="section-label">Choose your starting point</p>
        <h3>Import an archive—or continue without importing.</h3>
        <p>Both paths are safe. Continuing without an import switches Collection to your existing Codex Archive view and adds nothing to it.</p>
        <div class="onboarding-safety" role="note">
          <span class="onboarding-safety-mark" aria-hidden="true">✓</span>
          <div>
            <strong>Nothing is deleted or replaced.</strong>
            <p>Your Codex Archive, Grim Dawn stash and saves, and Item Assistant database remain untouched.</p>
          </div>
        </div>
        <div class="onboarding-choice-grid">
          <article>
            <span class="choice-number">01</span>
            <p class="choice-kicker">Optional import</p>
            <h4>Import Item Assistant</h4>
            <p>Select Item Assistant's <code>userdata.db</code>. Cairn analyzes it, verifies a backup, preserves SC/HC identity, and skips copies already imported.</p>
            <ItemAssistantImport compact :disabled="!snapshotAvailable" @completed="emit('import-completed', $event)" />
            <small>Close Item Assistant before starting. Its source database is never modified.</small>
          </article>
          <article class="onboarding-keep-card">
            <span class="choice-number">02</span>
            <p class="choice-kicker">No import</p>
            <h4>Continue without importing</h4>
            <p v-if="archiveSummaryStatus === 'loading'">Cairn is checking your existing Codex Archive. You can continue now; the archive will not be changed.</p>
            <p v-else-if="archiveSummaryStatus === 'unavailable'">Cairn could not read the archive count right now. Continuing still will not clear or replace the archive.</p>
            <p v-else-if="archivedCopyCount > 0"><strong class="retained-count">{{ archivedCopyCount.toLocaleString() }} archived {{ archivedCopyCount === 1 ? 'copy' : 'copies' }}</strong> will remain exactly where they are.</p>
            <p v-else>Your Codex Archive currently has no stored copies. Cairn will simply continue without adding any.</p>
            <ul class="onboarding-untouched-list">
              <li>Does not clear your Codex Archive</li>
              <li>Does not modify any stash or save</li>
              <li>Item Assistant can be imported later</li>
            </ul>
          </article>
        </div>
      </div>

      <div v-else-if="step === 2" class="onboarding-page">
        <p class="section-label">The important mental model</p>
        <h3>Your collection is an archive, not a mirror.</h3>
        <div class="onboarding-concept-grid">
          <article><strong>Codex Archive</strong><p>Durably remembers ingested copies, rolls, affixes, and history even after an item returns to the game.</p></article>
          <article><strong>Live transfer</strong><p>Uses the watched stash tabs while Grim Dawn runs. Every operation is journaled and must receive a matching receipt.</p></article>
          <article><strong>Softcore / Hardcore</strong><p>Every copy keeps its mode. Cairn never mixes SC and HC in one retrieval, and archive scope can show either or both.</p></article>
          <article><strong>Offline staging</strong><p>When the game is closed, Cairn can perform the same verified workflow against a selected shared stash.</p></article>
        </div>
        <p class="onboarding-callout">If a transfer is interrupted, Cairn pauses later writes until the durable queue outcome is reconciled. Browsing, Settings, recovery, and diagnostics remain available.</p>
      </div>

      <div v-else class="onboarding-page">
        <p class="section-label">Safety and workspace</p>
        <h3>You are ready. Two details are worth remembering.</h3>
        <div class="onboarding-concept-grid final">
          <article><strong>Verified backups</strong><p>Cairn rotates archive snapshots automatically. Settings can create, export, restore, and open their folder.</p></article>
          <article><strong>Experimental tools</strong><p>Stash Oracle and Dismantling Lab are disabled for new profiles. Enable them in Settings when you want provisional recommendations or simulations.</p></article>
          <article><strong>Customize the workspace</strong><p>Collection always remains available; specialist tools can be hidden or restored without losing their data.</p></article>
          <article><strong>Get useful diagnostics</strong><p>Debug logging is opt-in and bounded. Exported support bundles redact paths, names, item payloads, saves, and credentials.</p></article>
        </div>
      </div>

      <footer class="onboarding-footer">
        <button type="button" class="secondary" @click="emit('settings')">Recovery & diagnostics</button>
        <span />
        <button v-if="step > 0" type="button" class="secondary" @click="emit('set-step', step - 1)">Back</button>
        <button v-if="step === 0 || step === 2" type="button" @click="emit('set-step', step + 1)">Continue</button>
        <button v-else-if="step === 1" type="button" @click="emit('continue-without-import')">Continue without importing</button>
        <button v-else type="button" @click="emit('finish')">Finish tour</button>
      </footer>
    </section>
  </div>
</template>
