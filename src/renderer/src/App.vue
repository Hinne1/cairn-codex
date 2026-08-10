<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AppStatus } from '@shared/contracts'

const status = ref<AppStatus | null>(null)

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
        {{ status ? `${status.mode} · v${status.appVersion}` : 'Connecting…' }}
      </div>
    </header>

    <main>
      <section class="hero">
        <div>
          <p class="section-label">Collection</p>
          <h2>Your legend begins in an empty archive.</h2>
          <p class="hero-copy">
            Connect a Grim Dawn installation to scan its item catalog and transfer stash.
          </p>
        </div>
        <button type="button" disabled>Scan game files</button>
      </section>

      <section class="metrics" aria-label="Collection completion">
        <article>
          <div class="metric-heading"><span>Legendaries</span><strong>0 / —</strong></div>
          <div class="meter"><span /></div>
          <small>Waiting for the game catalog</small>
        </article>
        <article>
          <div class="metric-heading"><span>Epics</span><strong>0 / —</strong></div>
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
        <h3>No catalog loaded</h3>
        <p>The read-only scanner is the next milestone.</p>
      </section>
    </main>
  </div>
</template>
