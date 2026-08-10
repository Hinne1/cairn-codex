<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type {
  AppStatus,
  CollectionItem,
  CollectionRaritySummary,
  CollectionSnapshot,
  GrimDawnDiscovery,
  ObservedStashItem,
  StagingTabInspection,
  VaultListItem,
  WriteSafetyStatus
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
const selectedRecord = ref<string | null>(null)
const pinning = ref(false)
const vaultItems = ref<VaultListItem[]>([])
const staging = ref<StagingTabInspection | null>(null)
const writeSafety = ref<WriteSafetyStatus | null>(null)
const selectedStashPath = ref('')
const selectedVaultIds = ref<string[]>([])
const vaultBusy = ref(false)
const vaultError = ref<string | null>(null)
const vaultMessage = ref<string | null>(null)
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
  'Sets',
  'Vault'
]

const availableVaultItems = computed(() =>
  vaultItems.value.filter((item) => item.state === 'ingested')
)
const retrievedVaultItems = computed(() =>
  vaultItems.value.filter((item) => item.state === 'retrieved')
)
const stashChoices = computed(() => snapshot.value?.scannedStashes ?? [])
const stagingHasUnsupported = computed(() => staging.value?.items.some((item) => !item.supported) ?? false)

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
  activeCategory.value === 'Vault'
    ? availableVaultItems.value.length
    : activeCategory.value === 'Sets'
      ? visibleSets.value.length
      : filteredItems.value.length
)

const selectedItem = computed(() =>
  snapshot.value?.items.find((item) => item.record === selectedRecord.value) ?? null
)

const selectedCopies = computed(() => {
  if (!snapshot.value || !selectedRecord.value) return []
  const pinned = selectedItem.value?.pinnedInstanceKey
  return snapshot.value.observedItems
    .filter((item) => item.baseRecord === selectedRecord.value && item.instanceKey)
    .sort((left, right) => {
      if ((left.instanceKey === pinned) !== (right.instanceKey === pinned)) {
        return left.instanceKey === pinned ? -1 : 1
      }
      return (
        (right.rollAnalysis?.overallEstimatedPercentile ?? -1) -
        (left.rollAnalysis?.overallEstimatedPercentile ?? -1)
      )
    })
})

watch(
  [activeCategory, query, ownership, rarityFilter, sortMode],
  () => {
    currentPage.value = 1
  }
)

watch(selectedStashPath, async (path) => {
  if (path) await refreshStaging()
})

watch(activeCategory, async (category) => {
  if (category === 'Vault') await refreshVault()
})

onMounted(async () => {
  status.value = await window.cairnCodex.getAppStatus()
  await scanCollection()
  await refreshVault()
})

async function scanCollection(): Promise<void> {
  scanning.value = true
  scanError.value = null
  try {
    snapshot.value = await window.cairnCodex.scanCollection()
    discovery.value = snapshot.value.discovery
    if (!selectedStashPath.value || !snapshot.value.scannedStashes.some((stash) => stash.path === selectedStashPath.value)) {
      selectedStashPath.value = preferredStashPath(snapshot.value)
    }
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
  if (category === 'Vault') return `${availableVaultItems.value.length} ready`
  if (category === 'Sets') {
    const collected = collectionSets.value.filter((set) => set.collected === set.items.length).length
    return `${collected} / ${collectionSets.value.length}`
  }
  const matches = snapshot.value.items.filter((item) => matchesCategory(item, category))
  return `${matches.filter((item) => item.discovered).length} / ${matches.length}`
}

function preferredStashPath(value: CollectionSnapshot): string {
  const normalizedName = (path: string) => path.replaceAll('/', '\\').toLocaleLowerCase()
  const documentsHardcore = value.scannedStashes.find((stash) => {
    const path = normalizedName(stash.path)
    return path.includes('\\documents\\') && path.endsWith('\\transfer.gsh')
  })
  return (
    documentsHardcore?.path ??
    value.scannedStashes.find((stash) => {
      const path = normalizedName(stash.path)
      return path.includes('\\documents\\') && path.endsWith('\\transfer.gst')
    })?.path ??
    value.scannedStashes.find((stash) => normalizedName(stash.path).endsWith('\\transfer.gsh'))?.path ??
    value.scannedStashes.find((stash) => normalizedName(stash.path).endsWith('\\transfer.gst'))?.path ??
    value.scannedStashes.find((stash) => stash.isHardcore)?.path ??
    value.scannedStashes[0]?.path ??
    ''
  )
}

async function refreshVault(): Promise<void> {
  if (!selectedStashPath.value) return
  vaultError.value = null
  try {
    const [items, safety] = await Promise.all([
      window.cairnCodex.listVaultItems(),
      window.cairnCodex.inspectWriteSafety()
    ])
    vaultItems.value = items
    writeSafety.value = safety
    selectedVaultIds.value = selectedVaultIds.value.filter((id) =>
      items.some((item) => item.id === id && item.state === 'ingested')
    )
    await refreshStaging()
  } catch (error) {
    vaultError.value = readableError(error)
  }
}

async function refreshStaging(): Promise<void> {
  if (!selectedStashPath.value) return
  try {
    staging.value = await window.cairnCodex.inspectStagingTab(selectedStashPath.value)
  } catch (error) {
    staging.value = null
    vaultError.value = readableError(error)
  }
}

async function ingestStagingTab(): Promise<void> {
  if (!staging.value || staging.value.itemCount === 0 || vaultBusy.value) return
  const confirmed = window.confirm(
    `Ingest ${staging.value.itemCount} item${staging.value.itemCount === 1 ? '' : 's'} from the final shared stash tab? A verified backup will be created first.`
  )
  if (!confirmed) return
  vaultBusy.value = true
  vaultError.value = null
  vaultMessage.value = null
  try {
    const result = await window.cairnCodex.ingestStagingTab(selectedStashPath.value)
    vaultMessage.value = `Safely ingested ${result.ingested.length} item${result.ingested.length === 1 ? '' : 's'}. Backup: ${result.backupPath}`
    await scanCollection()
    await refreshVault()
  } catch (error) {
    vaultError.value = readableError(error)
    await refreshVault()
  } finally {
    vaultBusy.value = false
  }
}

async function retrieveSelected(): Promise<void> {
  if (selectedVaultIds.value.length === 0 || vaultBusy.value) return
  const confirmed = window.confirm(
    `Retrieve ${selectedVaultIds.value.length} item${selectedVaultIds.value.length === 1 ? '' : 's'} into the empty final shared stash tab? A verified backup will be created first.`
  )
  if (!confirmed) return
  vaultBusy.value = true
  vaultError.value = null
  vaultMessage.value = null
  try {
    const result = await window.cairnCodex.retrieveVaultItems(
      selectedStashPath.value,
      selectedVaultIds.value
    )
    selectedVaultIds.value = []
    vaultMessage.value = `Safely retrieved ${result.retrieved.length} item${result.retrieved.length === 1 ? '' : 's'}. Backup: ${result.backupPath}`
    await scanCollection()
    await refreshVault()
  } catch (error) {
    vaultError.value = readableError(error)
    await refreshVault()
  } finally {
    vaultBusy.value = false
  }
}

function toggleVaultItem(id: string): void {
  selectedVaultIds.value = selectedVaultIds.value.includes(id)
    ? selectedVaultIds.value.filter((candidate) => candidate !== id)
    : [...selectedVaultIds.value, id]
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '')
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

function openItem(item: CollectionItem): void {
  selectedRecord.value = item.record
}

async function pinCopy(copy: ObservedStashItem): Promise<void> {
  if (!selectedItem.value || !copy.instanceKey || pinning.value) return
  pinning.value = true
  try {
    const next = selectedItem.value.pinnedInstanceKey === copy.instanceKey ? null : copy.instanceKey
    await window.cairnCodex.setPinnedBest(selectedItem.value.record, next)
    selectedItem.value.pinnedInstanceKey = next
  } finally {
    pinning.value = false
  }
}

function isAutoBest(copy: ObservedStashItem): boolean {
  const score = copy.rollAnalysis?.overallEstimatedPercentile
  const best = selectedItem.value?.bestRollPercentile
  return score !== null && score !== undefined && best !== null && best !== undefined && Math.abs(score - best) < 0.0000001
}

function rollableStats(copy: ObservedStashItem) {
  const stats = (copy.rollAnalysis?.stats ?? [])
    .filter((stat) => stat.estimatedPercentile !== null)
  const byField = new Map(stats.map((stat) => [stat.field, stat]))
  const consumed = new Set<string>()
  return stats
    .flatMap((stat) => {
      if (consumed.has(stat.field)) return []
      if (stat.field.endsWith('Min')) {
        const root = stat.field.slice(0, -3)
        const maximum = byField.get(root + 'Max')
        if (maximum?.estimatedPercentile !== null && maximum?.estimatedPercentile !== undefined) {
          consumed.add(maximum.field)
          const valueLabel =
            stat.value === maximum.value
              ? formatRollValue(stat.value)
              : `${formatRollValue(stat.value)}–${formatRollValue(maximum.value)}`
          return [
            {
              key: root,
              label: humanStatName(root),
              valueLabel,
              percentile: (stat.estimatedPercentile! + maximum.estimatedPercentile) / 2,
              rangeLabel: `${formatRollValue(stat.observedMinimum ?? stat.value)}–${formatRollValue(maximum.observedMaximum ?? maximum.value)}`
            }
          ]
        }
      }
      return [
        {
          key: stat.field,
          label: humanStatName(stat.field),
          valueLabel: formatRollValue(stat.value),
          percentile: stat.estimatedPercentile!,
          rangeLabel: `${formatRollValue(stat.observedMinimum ?? stat.value)}–${formatRollValue(stat.observedMaximum ?? stat.value)}`
        }
      ]
    })
    .sort((left, right) => left.label.localeCompare(right.label))
}

function humanStatName(field: string): string {
  const names: Record<string, string> = {
    characterAttackSpeedModifier: 'Attack speed',
    characterSpellCastSpeedModifier: 'Cast speed',
    characterIntelligence: 'Spirit',
    characterDefensiveAbility: 'Defensive ability',
    characterOffensiveAbility: 'Offensive ability',
    conversionPercentage: 'Damage conversion',
    offensiveFireModifier: 'Fire damage',
    offensiveSlowFire: 'Burn damage',
    offensiveSlowFireModifier: 'Burn damage bonus'
  }
  return names[field] ?? field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (value) => value.toUpperCase())
}

function formatRollValue(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1)
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

      <section v-if="activeCategory !== 'Vault'" class="filter-bar" aria-label="Collection filters">
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

      <section v-if="activeCategory === 'Vault'" class="vault-workspace" aria-label="Item vault">
        <header class="vault-heading">
          <div>
            <p class="section-label">Transfer vault</p>
            <h2>One tab in. One tab out.</h2>
            <p>
              The final shared stash tab is the staging area. Every commit is process-gated,
              backed up, written atomically, reparsed, and hash-verified.
            </p>
          </div>
          <button type="button" :disabled="vaultBusy" @click="refreshVault">
            {{ vaultBusy ? 'Working…' : 'Recheck' }}
          </button>
        </header>

        <div class="vault-target">
          <label>
            <span>Shared stash</span>
            <select v-model="selectedStashPath" :disabled="vaultBusy">
              <option v-for="stash in stashChoices" :key="stash.path" :value="stash.path">
                {{ stash.isHardcore ? 'Hardcore' : 'Softcore' }} · {{ stash.path }}
              </option>
            </select>
          </label>
          <div class="safety-state" :class="{ safe: writeSafety?.permitted }">
            <span class="status-dot" :class="{ dim: !writeSafety?.permitted }" />
            <div>
              <strong>{{ writeSafety?.permitted ? 'Writes unlocked' : 'Writes locked' }}</strong>
              <small v-if="writeSafety?.permitted">Grim Dawn and Item Assistant are closed.</small>
              <small v-else>{{ writeSafety?.reasons.join(' ') || 'Checking running processes…' }}</small>
            </div>
          </div>
        </div>

        <p v-if="vaultError" class="vault-notice error">{{ vaultError }}</p>
        <p v-if="vaultMessage" class="vault-notice success">{{ vaultMessage }}</p>

        <div class="vault-columns">
          <article class="vault-panel staging-panel">
            <header>
              <div>
                <p>Final stash tab</p>
                <h3>Staged for ingest</h3>
              </div>
              <strong>{{ staging?.itemCount ?? '—' }}</strong>
            </header>
            <p class="panel-help">
              Put only the Epics and Legendaries you want archived into tab
              {{ staging ? staging.tabIndex + 1 : '—' }}.
            </p>
            <div v-if="staging?.items.length" class="vault-item-list">
              <div
                v-for="item in staging.items"
                :key="`${item.itemIndex}:${item.seed}`"
                class="vault-row"
                :class="{ unsupported: !item.supported }"
              >
                <span class="item-rune">{{ item.supported ? '◆' : '!' }}</span>
                <div>
                  <strong>{{ item.name }}</strong>
                  <small>Seed {{ item.seed }}{{ item.supported ? '' : ' · not an Epic/Legendary' }}</small>
                </div>
              </div>
            </div>
            <div v-else class="vault-empty">The staging tab is empty.</div>
            <button
              class="vault-action"
              type="button"
              :disabled="vaultBusy || !writeSafety?.permitted || !staging?.itemCount || stagingHasUnsupported"
              @click="ingestStagingTab"
            >
              {{ vaultBusy ? 'Verifying…' : `Ingest ${staging?.itemCount ?? 0} staged` }}
            </button>
          </article>

          <article class="vault-panel">
            <header>
              <div>
                <p>Codex vault</p>
                <h3>Ready to retrieve</h3>
              </div>
              <strong>{{ availableVaultItems.length }}</strong>
            </header>
            <p class="panel-help">
              Retrieval requires the final stash tab to be empty. Select one or more archived copies.
            </p>
            <div v-if="availableVaultItems.length" class="vault-item-list selectable">
              <label v-for="item in availableVaultItems" :key="item.id" class="vault-row">
                <input
                  type="checkbox"
                  :checked="selectedVaultIds.includes(item.id)"
                  :disabled="vaultBusy"
                  @change="toggleVaultItem(item.id)"
                />
                <div>
                  <strong>{{ item.name }}</strong>
                  <small>{{ item.rarity }} · seed {{ item.seed }}</small>
                </div>
              </label>
            </div>
            <div v-else class="vault-empty">No archived items are waiting.</div>
            <button
              class="vault-action"
              type="button"
              :disabled="vaultBusy || !writeSafety?.permitted || staging?.itemCount !== 0 || selectedVaultIds.length === 0"
              @click="retrieveSelected"
            >
              {{ vaultBusy ? 'Verifying…' : `Retrieve ${selectedVaultIds.length} selected` }}
            </button>
          </article>
        </div>

        <section v-if="retrievedVaultItems.length" class="vault-history">
          <div>
            <p class="section-label">History</p>
            <h3>Previously retrieved</h3>
          </div>
          <div class="history-chips">
            <span v-for="item in retrievedVaultItems" :key="item.id">
              {{ item.name }} · seed {{ item.seed }}
            </span>
          </div>
        </section>
      </section>

      <section v-else-if="!snapshot && scanning" class="empty-state">
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
            :role="item.availableCount > 0 ? 'button' : undefined"
            :tabindex="item.availableCount > 0 ? 0 : undefined"
            @click="item.availableCount > 0 && openItem(item)"
            @keydown.enter="item.availableCount > 0 && openItem(item)"
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
            <span v-if="item.pinnedInstanceKey" class="pin-indicator">★ Pinned choice</span>
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

    <div v-if="selectedItem" class="drawer-backdrop" @click.self="selectedRecord = null">
      <aside class="item-drawer" :aria-label="selectedItem.name + ' roll comparison'">
        <button class="drawer-close" type="button" aria-label="Close comparison" @click="selectedRecord = null">×</button>
        <p class="section-label">Copy comparison</p>
        <h2>{{ selectedItem.name }}</h2>
        <p class="drawer-intro">
          Auto-best averages the estimated percentile of each variable stat line. Pin whichever copy you actually prefer.
        </p>
        <p
          v-if="selectedItem.pinnedInstanceKey && !selectedCopies.some((copy) => copy.instanceKey === selectedItem?.pinnedInstanceKey)"
          class="pinned-away"
        >
          Your pinned copy is remembered, but it is not in a currently scanned stash.
        </p>

        <div class="copy-list">
          <article
            v-for="(copy, index) in selectedCopies"
            :key="copy.instanceKey"
            class="copy-card"
            :class="{ pinned: copy.instanceKey === selectedItem.pinnedInstanceKey }"
          >
            <header>
              <div>
                <p>Copy {{ index + 1 }} · seed {{ copy.seed }}</p>
                <strong v-if="copy.rollAnalysis?.overallEstimatedPercentile !== null">
                  {{ copy.rollAnalysis?.overallEstimatedPercentile?.toFixed(1) }}%
                </strong>
                <strong v-else>Score withheld</strong>
              </div>
              <div class="copy-actions">
                <span v-if="isAutoBest(copy)" class="auto-badge">Auto-best</span>
                <button type="button" :disabled="pinning" @click="pinCopy(copy)">
                  {{ copy.instanceKey === selectedItem.pinnedInstanceKey ? 'Unpin' : 'Pin this copy' }}
                </button>
              </div>
            </header>

            <p v-if="copy.rollAnalysis && !copy.rollAnalysis.trusted" class="withheld-note">
              {{ copy.rollAnalysis.reason }}
            </p>
            <div v-else class="stat-list">
              <div v-for="stat in rollableStats(copy)" :key="stat.key" class="stat-row">
                <div class="stat-heading">
                  <span>{{ stat.label }}</span>
                  <strong>{{ stat.valueLabel }} · {{ stat.percentile.toFixed(0) }}%</strong>
                </div>
                <div class="stat-meter"><span :style="{ width: `${stat.percentile}%` }" /></div>
                <small>{{ stat.rangeLabel }} sampled range</small>
              </div>
            </div>
          </article>
        </div>
      </aside>
    </div>
  </div>
</template>
