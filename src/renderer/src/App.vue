<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AppStatus, GrimDawnDiscovery } from '@shared/contracts'

const status = ref<AppStatus | null>(null)
const discovery = ref<GrimDawnDiscovery | null>(null)
const scanning = ref(false)
const scanError = ref<string | null>(null)

const categories = [
  'All',
  'Head',
  'Chest',
  'Shoulders',
  'Hands',
  'Legs',
  'Feet',
  'Weapons',
  'Offhands',
  'Jewelry',
  'Relics',
  'Sets'
]

onMounted(async () => {
  status.value = await window.cairnCodex.getAppStatus()
})

async function discoverGrimDawn(): Promise<void> {
  scanning.value = true
  scanError.value = null
  try {
    discovery.value = await window.cairnCodex.discoverGrimDawn()
  } catch (error) {
    scanError.value = error instanceof Error ? error.message : 'Discovery failed.'
  } finally {
    scanning.value = false
  }
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Grim Dawn collection atlas</p>
        <h1>Cairn Codex</h1>
      </div>
      <div class="status-pill">
        <span class="status-dot" />
        {{ status ? `${status.mode} - v${status.appVersion}` : 'Connecting...' }}
      </div>
    </header>

    <main>
      <section class="hero">
        <div>
          <p class="section-label">Collection</p>
          <h2>{{ discovery ? 'Grim Dawn is connected.' : 'Your legend begins in an empty archive.' }}</h2>
          <p class="hero-copy">
            <template v-if="discovery?.installations[0]">
              {{ discovery.installations[0].path }} -
              {{ discovery.saveLocations.reduce((count, save) => count + save.transferStashes.length, 0) }}
              transfer stashes found
            </template>
            <template v-else>
              Connect a Grim Dawn installation to scan its item catalog and transfer stash.
            </template>
          </p>
          <p v-if="scanError" class="scan-error">{{ scanError }}</p>
        </div>
        <button type="button" :disabled="scanning" @click="discoverGrimDawn">
          {{ scanning ? 'Scanning...' : discovery ? 'Scan again' : 'Scan game files' }}
        </button>
      </section>

      <section class="metrics" aria-label="Collection completion">
        <article>
          <div class="metric-heading"><span>Legendaries</span><strong>0 / ?</strong></div>
          <div class="meter"><span /></div>
          <small>Waiting for the game catalog</small>
        </article>
        <article>
          <div class="metric-heading"><span>Epics</span><strong>0 / ?</strong></div>
          <div class="meter epic"><span /></div>
          <small>Waiting for the game catalog</small>
        </article>
      </section>

      <nav class="category-tabs" aria-label="Item categories">
        <button
          v-for="(category, index) in categories"
          :key="category"
          type="button"
          :class="{ active: index === 0 }"
        >
          {{ category }}
        </button>
      </nav>

      <section class="empty-state">
        <div class="sigil" aria-hidden="true">C</div>
        <h3>{{ discovery ? 'Catalog import is next' : 'No catalog loaded' }}</h3>
        <p>
          {{ discovery ? 'Installation and transfer stashes are ready.' : 'Run read-only discovery to begin.' }}
        </p>
      </section>
    </main>
  </div>
</template>
