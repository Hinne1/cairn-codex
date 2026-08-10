<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type {
  AppStatus,
  CollectionItem,
  CollectionRaritySummary,
  CollectionSnapshot,
  GrimDawnDiscovery
} from '@shared/contracts'

const status = ref<AppStatus | null>(null)
const discovery = ref<GrimDawnDiscovery | null>(null)
const snapshot = ref<CollectionSnapshot | null>(null)
const scanning = ref(false)
const scanError = ref<string | null>(null)
const activeCategory = ref('All')

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

const visibleItems = computed(() => {
  if (!snapshot.value) return []
  return snapshot.value.items
    .filter((item) => matchesCategory(item, activeCategory.value))
    .sort((left, right) => {
      if (Boolean(left.discovered) !== Boolean(right.discovered)) {
        return left.discovered ? -1 : 1
      }
      return left.name.localeCompare(right.name)
    })
    .slice(0, 24)
})

onMounted(async () => {
  status.value = await window.cairnCodex.getAppStatus()
})

async function discoverGrimDawn(): Promise<void> {
  scanning.value = true
  scanError.value = null
  try {
    snapshot.value = await window.cairnCodex.scanCollection()
    discovery.value = snapshot.value.discovery
  } catch (error) {
    scanError.value = error instanceof Error ? error.message : 'Discovery failed.'
  } finally {
    scanning.value = false
  }
}

function rarity(name: 'epic' | 'legendary'): CollectionRaritySummary | undefined {
  return snapshot.value?.rarities.find((summary) => summary.rarity === name)
}

function percentage(summary: CollectionRaritySummary | undefined): string {
  if (!summary || summary.total === 0) return '0%'
  return ((summary.collected / summary.total) * 100).toFixed(1) + '%'
}

function matchesCategory(item: CollectionItem, category: string): boolean {
  const slots: Record<string, string[]> = {
    Head: ['head'],
    Chest: ['chest'],
    Shoulders: ['shoulders'],
    Hands: ['hands'],
    Legs: ['legs'],
    Feet: ['feet'],
    Weapons: ['weapon'],
    Offhands: ['offhand', 'shield'],
    Jewelry: ['ring', 'amulet', 'medal'],
    Relics: ['relic']
  }
  if (category === 'All') return true
  if (category === 'Sets') return item.setRecord !== null
  return slots[category]?.includes(item.slot) ?? false
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
          <h2>{{ snapshot ? 'Your collection has entered the Codex.' : 'Your legend begins in an empty archive.' }}</h2>
          <p class="hero-copy">
            <template v-if="discovery?.installations[0]">
              {{ discovery.installations[0].path }} —
              {{ snapshot?.contentPacks.length ?? 0 }} content packs,
              {{ snapshot?.scannedStashes.length ?? 0 }} transfer stashes scanned
            </template>
            <template v-else>
              Connect a Grim Dawn installation to scan its item catalog and transfer stash.
            </template>
          </p>
          <p v-if="scanError" class="scan-error">{{ scanError }}</p>
        </div>
        <button type="button" :disabled="scanning" @click="discoverGrimDawn">
          {{ scanning ? 'Reading the archives...' : snapshot ? 'Scan again' : 'Scan collection' }}
        </button>
      </section>

      <section class="metrics" aria-label="Collection completion">
        <article>
          <div class="metric-heading">
            <span>Legendaries</span>
            <strong>{{ rarity('legendary')?.collected ?? 0 }} / {{ rarity('legendary')?.total ?? '?' }}</strong>
          </div>
          <div class="meter">
            <span :style="{ width: percentage(rarity('legendary')) }" />
          </div>
          <small>{{ percentage(rarity('legendary')) }} discovered · {{ rarity('legendary')?.availableCopies ?? 0 }} copies available</small>
        </article>
        <article>
          <div class="metric-heading">
            <span>Epics</span>
            <strong>{{ rarity('epic')?.collected ?? 0 }} / {{ rarity('epic')?.total ?? '?' }}</strong>
          </div>
          <div class="meter epic">
            <span :style="{ width: percentage(rarity('epic')) }" />
          </div>
          <small>{{ percentage(rarity('epic')) }} discovered · {{ rarity('epic')?.availableCopies ?? 0 }} copies available</small>
        </article>
      </section>

      <nav class="category-tabs" aria-label="Item categories">
        <button
          v-for="(category, index) in categories"
          :key="category"
          type="button"
          :class="{ active: category === activeCategory }"
          @click="activeCategory = category"
        >
          {{ category }}
        </button>
      </nav>

      <section v-if="!snapshot" class="empty-state">
        <div class="sigil" aria-hidden="true">C</div>
        <h3>No catalog loaded</h3>
        <p>Run the read-only collection scan to begin.</p>
      </section>
      <section v-else class="catalog-grid" :aria-label="activeCategory + ' collection items'">
        <article
          v-for="item in visibleItems"
          :key="item.record"
          class="item-card"
          :class="{ missing: !item.discovered, legendary: item.rarity === 'legendary' }"
        >
          <div class="item-mark" aria-hidden="true">{{ item.discovered ? '✓' : '?' }}</div>
          <div class="item-copy">
            <p>{{ item.rarity }} · level {{ item.levelRequirement }}</p>
            <h3>{{ item.name }}</h3>
            <small v-if="item.setName">{{ item.setName }}</small>
            <small v-else>{{ item.slot }}</small>
          </div>
          <strong v-if="item.availableCount > 0">{{ item.availableCount }} available</strong>
          <strong v-else-if="item.discovered">Discovered · none available</strong>
          <strong v-else>Not found</strong>
        </article>
      </section>
      <p v-if="snapshot && snapshot.items.length > visibleItems.length" class="result-note">
        Showing the first {{ visibleItems.length }} matching entries while the full catalog is being indexed.
      </p>
    </main>
  </div>
</template>
