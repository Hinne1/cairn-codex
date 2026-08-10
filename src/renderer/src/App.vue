<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type {
  AppStatus,
  CollectionItem,
  CollectionRaritySummary,
  CollectionSnapshot,
  GrimDawnDiscovery
} from '@shared/contracts'

type OwnershipFilter = 'all' | 'owned' | 'missing'
type RarityFilter = 'all' | 'epic' | 'legendary'
type SortMode = 'name' | 'level' | 'completion' | 'roll'

interface CollectionSet {
  record: string
  name: string
  items: CollectionItem[]
  collected: number
  availableCopies: number
}

const status = ref<AppStatus | null>(null)
const discovery = ref<GrimDawnDiscovery | null>(null)
const snapshot = ref<CollectionSnapshot | null>(null)
const scanning = ref(false)
const scanError = ref<string | null>(null)
const activeCategory = ref('All')
const query = ref('')
const ownership = ref<OwnershipFilter>('all')
const rarityFilter = ref<RarityFilter>('all')
const sortMode = ref<SortMode>('completion')
const currentPage = ref(1)
const pageSize = 48

const categories = [
  'All',
  'Head',
  'Chest',
  'Shoulders',
  'Hands',
  'Legs',
  'Feet',
  'Waist',
  'Weapons',
  'Offhands',
  'Jewelry',
  'Relics',
  'Sets'
]

const filteredItems = computed(() => {
  if (!snapshot.value || activeCategory.value === 'Sets') return []
  const needle = query.value.trim().toLocaleLowerCase()
  return snapshot.value.items
    .filter((item) => matchesCategory(item, activeCategory.value))
    .filter((item) => rarityFilter.value === 'all' || item.rarity === rarityFilter.value)
    .filter((item) => {
      if (ownership.value === 'owned') return Boolean(item.discovered)
      if (ownership.value === 'missing') return !item.discovered
      return true
    })
    .filter((item) => {
      if (!needle) return true
      return [item.name, item.setName, item.slot, item.contentPack]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(needle))
    })
    .sort(compareItems)
})

const pageCount = computed(() => Math.max(1, Math.ceil(filteredItems.value.length / pageSize)))
const visibleItems = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return filteredItems.value.slice(start, start + pageSize)
})

const collectionSets = computed<CollectionSet[]>(() => {
  if (!snapshot.value) return []
  const grouped = new Map<string, CollectionSet>()
  for (const item of snapshot.value.items) {
    if (!item.setRecord || !item.setName) continue
    const existing = grouped.get(item.setRecord)
    if (existing) {
      existing.items.push(item)
      existing.collected += item.discovered ? 1 : 0
      existing.availableCopies += item.availableCount
    } else {
      grouped.set(item.setRecord, {
        record: item.setRecord,
        name: item.setName,
        items: [item],
        collected: item.discovered ? 1 : 0,
        availableCopies: item.availableCount
      })
    }
  }
  for (const set of grouped.values()) {
    set.items.sort((left, right) => left.slot.localeCompare(right.slot) || left.name.localeCompare(right.name))
  }
  return [...grouped.values()].sort((left, right) => {
    const leftRatio = left.collected / left.items.length
    const rightRatio = right.collected / right.items.length
    return rightRatio - leftRatio || left.name.localeCompare(right.name)
  })
})

const visibleSets = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return collectionSets.value
    .filter(
      (set) =>
        rarityFilter.value === 'all' || set.items.some((item) => item.rarity === rarityFilter.value)
    )
    .filter((set) => {
      if (ownership.value === 'owned') return set.collected > 0
      if (ownership.value === 'missing') return set.collected < set.items.length
      return true
    })
    .filter((set) => {
      if (!needle) return true
      return (
        set.name.toLocaleLowerCase().includes(needle) ||
        set.items.some((item) => item.name.toLocaleLowerCase().includes(needle))
      )
    })
})

const displayedResultCount = computed(() =>
  activeCategory.value === 'Sets' ? visibleSets.value.length : filteredItems.value.length
)

watch(
  [activeCategory, query, ownership, rarityFilter, sortMode],
  () => {
    currentPage.value = 1
  }
)

onMounted(async () => {
  status.value = await window.cairnCodex.getAppStatus()
  await scanCollection()
})

async function scanCollection(): Promise<void> {
  scanning.value = true
  scanError.value = null
  try {
    snapshot.value = await window.cairnCodex.scanCollection()
    discovery.value = snapshot.value.discovery
  } catch (error) {
    scanError.value = error instanceof Error ? error.message : 'Collection scan failed.'
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

function categoryProgress(category: string): string {
  if (!snapshot.value) return '0 / 0'
  if (category === 'Sets') {
    const collected = collectionSets.value.filter((set) => set.collected === set.items.length).length
    return `${collected} / ${collectionSets.value.length}`
  }
  const matches = snapshot.value.items.filter((item) => matchesCategory(item, category))
  return `${matches.filter((item) => item.discovered).length} / ${matches.length}`
}

function compareItems(left: CollectionItem, right: CollectionItem): number {
  if (sortMode.value === 'level') {
    return right.levelRequirement - left.levelRequirement || left.name.localeCompare(right.name)
  }
  if (sortMode.value === 'completion') {
    if (Boolean(left.discovered) !== Boolean(right.discovered)) return left.discovered ? -1 : 1
    if (left.availableCount !== right.availableCount) return right.availableCount - left.availableCount
  }
  if (sortMode.value === 'roll') {
    return (
      (right.bestRollPercentile ?? -1) - (left.bestRollPercentile ?? -1) ||
      left.name.localeCompare(right.name)
    )
  }
  return left.name.localeCompare(right.name)
}

function matchesCategory(item: CollectionItem, category: string): boolean {
  const slots: Record<string, string[]> = {
    Head: ['head'],
    Chest: ['chest'],
    Shoulders: ['shoulders'],
    Hands: ['hands'],
    Legs: ['legs'],
    Feet: ['feet'],
    Waist: ['waist'],
    Weapons: ['weapon'],
    Offhands: ['offhand', 'shield'],
    Jewelry: ['ring', 'amulet', 'medal'],
    Relics: ['relic']
  }
  if (category === 'All') return true
  return slots[category]?.includes(item.slot) ?? false
}

function goToPage(page: number): void {
  currentPage.value = Math.min(Math.max(page, 1), pageCount.value)
  window.scrollTo({ top: 410, behavior: 'smooth' })
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
        <span class="status-dot" :class="{ dim: status?.helper !== 'available' }" />
        {{ status ? `v${status.appVersion} · ${status.helper}` : 'Connecting…' }}
      </div>
    </header>

    <main>
      <section class="hero">
        <div>
          <p class="section-label">Collection</p>
          <h2>{{ snapshot ? 'Your collection has entered the Codex.' : 'Reading the archives of Cairn…' }}</h2>
          <p class="hero-copy">
            <template v-if="discovery?.installations[0]">
              {{ snapshot?.contentPacks.length ?? 0 }} content packs ·
              {{ snapshot?.scannedStashes.length ?? 0 }} transfer stashes ·
              {{ snapshot?.items.length.toLocaleString() ?? 0 }} catalog entries
            </template>
            <template v-else>
              Locating Grim Dawn, its item database, and transfer stashes.
            </template>
          </p>
          <p v-if="scanError" class="scan-error">{{ scanError }}</p>
        </div>
        <button class="primary-action" type="button" :disabled="scanning" @click="scanCollection">
          {{ scanning ? 'Reading the archives…' : 'Refresh collection' }}
        </button>
      </section>

      <section class="metrics" aria-label="Collection completion">
        <article>
          <div class="metric-heading">
            <span>Legendaries</span>
            <strong>{{ rarity('legendary')?.collected ?? 0 }} / {{ rarity('legendary')?.total ?? '—' }}</strong>
          </div>
          <div class="meter"><span :style="{ width: percentage(rarity('legendary')) }" /></div>
          <small>{{ percentage(rarity('legendary')) }} discovered · {{ rarity('legendary')?.availableCopies ?? 0 }} copies available</small>
        </article>
        <article>
          <div class="metric-heading">
            <span>Epics</span>
            <strong>{{ rarity('epic')?.collected ?? 0 }} / {{ rarity('epic')?.total ?? '—' }}</strong>
          </div>
          <div class="meter epic"><span :style="{ width: percentage(rarity('epic')) }" /></div>
          <small>{{ percentage(rarity('epic')) }} discovered · {{ rarity('epic')?.availableCopies ?? 0 }} copies available</small>
        </article>
      </section>

      <nav class="category-tabs" aria-label="Item categories">
        <button
          v-for="category in categories"
          :key="category"
          type="button"
          :class="{ active: category === activeCategory }"
          @click="activeCategory = category"
        >
          <span>{{ category }}</span>
          <small>{{ categoryProgress(category) }}</small>
        </button>
      </nav>

      <section class="filter-bar" aria-label="Collection filters">
        <label class="search-field">
          <span class="sr-only">Search collection</span>
          <input v-model="query" type="search" placeholder="Search items or sets…" />
        </label>
        <div class="segmented-control" aria-label="Ownership filter">
          <button
            v-for="option in (['all', 'owned', 'missing'] as OwnershipFilter[])"
            :key="option"
            type="button"
            :class="{ active: ownership === option }"
            @click="ownership = option"
          >
            {{ option }}
          </button>
        </div>
        <select v-model="rarityFilter" aria-label="Rarity">
          <option value="all">All rarities</option>
          <option value="legendary">Legendary</option>
          <option value="epic">Epic</option>
        </select>
        <select v-if="activeCategory !== 'Sets'" v-model="sortMode" aria-label="Sort collection">
          <option value="completion">Collected first</option>
          <option value="name">Name</option>
          <option value="level">Level</option>
          <option value="roll">Best roll</option>
        </select>
        <span class="result-count">{{ displayedResultCount.toLocaleString() }} results</span>
      </section>

      <section v-if="!snapshot && scanning" class="empty-state">
        <div class="sigil loading" aria-hidden="true">C</div>
        <h3>Opening the Codex</h3>
        <p>Parsing the game database and your transfer stashes.</p>
      </section>

      <section v-else-if="activeCategory === 'Sets'" class="set-grid" aria-label="Item sets">
        <article v-for="set in visibleSets" :key="set.record" class="set-card">
          <header>
            <div>
              <p>Item set</p>
              <h3>{{ set.name }}</h3>
            </div>
            <strong :class="{ complete: set.collected === set.items.length }">
              {{ set.collected }} / {{ set.items.length }}
            </strong>
          </header>
          <div class="set-meter">
            <span :style="{ width: `${(set.collected / set.items.length) * 100}%` }" />
          </div>
          <ul>
            <li v-for="item in set.items" :key="item.record" :class="{ missing: !item.discovered }">
              <span aria-hidden="true">{{ item.discovered ? '✓' : '○' }}</span>
              <div><strong>{{ item.name }}</strong><small>{{ item.slot }}</small></div>
              <em v-if="item.availableCount > 0">×{{ item.availableCount }}</em>
            </li>
          </ul>
        </article>
        <div v-if="visibleSets.length === 0" class="no-results">No sets match these filters.</div>
      </section>

      <template v-else-if="snapshot">
        <section class="catalog-grid" :aria-label="activeCategory + ' collection items'">
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
            <div v-if="item.bestRollPercentile !== null" class="roll-summary">
              <span>Best roll</span>
              <strong>{{ item.bestRollPercentile.toFixed(1) }}%</strong>
            </div>
            <strong v-if="item.availableCount > 0">{{ item.availableCount }} available</strong>
            <strong v-else-if="item.discovered">Discovered · none available</strong>
            <strong v-else>Not found</strong>
          </article>
          <div v-if="visibleItems.length === 0" class="no-results">No items match these filters.</div>
        </section>

        <nav v-if="pageCount > 1" class="pagination" aria-label="Catalog pages">
          <button type="button" :disabled="currentPage === 1" @click="goToPage(currentPage - 1)">Previous</button>
          <span>Page {{ currentPage }} of {{ pageCount }}</span>
          <button type="button" :disabled="currentPage === pageCount" @click="goToPage(currentPage + 1)">Next</button>
        </nav>
      </template>
    </main>
  </div>
</template>
