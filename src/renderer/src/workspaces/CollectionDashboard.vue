<script setup lang="ts">
import { computed } from 'vue'
import type { CollectionBasis, CollectionRaritySummary, CollectionSnapshot } from '../../../shared/contracts'
import type { MaterialCategory, RarityFilter } from '../app-route'
import type { MiCountingMode } from './settings'
import { percentage, type CollectionDashboard } from './collection-dashboard'
const props = defineProps<{
  model: CollectionDashboard
  available: boolean
  installationFound: boolean
  sourceModeLabel: string
  contentPackCount: number
  scannedStashCount: number
  catalogEntryCount: number
  archivedCopyCount: number
  scanning: boolean
  trackerCollapsed: boolean
  collectionBasis: CollectionBasis
  showLegacyScanner: boolean
  miCountingMode: MiCountingMode
  selectedRarity: RarityFilter
  affixSummary?: CollectionSnapshot['affixSummary']
  recipeSummary?: CollectionSnapshot['recipeSummary']
  reusableSupplySummary: CollectionRaritySummary
  supplyAccessSummary: string
}>()
const emit = defineEmits<{
  refresh: []
  'toggle-tracker': []
  'filter-all': []
  'filter-recipes': []
  'filter-rarity': [rarity: 'epic' | 'legendary' | 'mi']
  'open-affixes': []
  'open-sets': []
  'open-materials': [category: MaterialCategory]
  'open-supplies': []
  'set-basis': [basis: CollectionBasis]
}>()
const collectionBasisLabel = computed(() => props.collectionBasis === 'archive' ? 'Codex Archive' : 'Stash Scanner')
const { rarity, affixPercentage, recipePercentage, allItemSummary, allItemRollSummary,
  legendaryRollSummary, epicRollSummary, miRollSummary, awakeningAvailableLegendaryCount,
  setRollSummary, affixRollSummary, setSummary, componentSummary, consumableSummary } = props.model
</script>

<template>
      <section class="hero">
        <div>
          <p class="section-label">{{ collectionBasisLabel }}</p>
          <h2>{{ available ? 'Your collection has entered the Codex.' : 'Reading the archives of Cairn…' }}</h2>
          <p class="hero-copy">
            <template v-if="installationFound">
              {{ sourceModeLabel }} ·
              {{ contentPackCount }} content packs ·
              {{ scannedStashCount }} transfer stashes ·
              {{ catalogEntryCount.toLocaleString() }} catalog entries ·
              {{ archivedCopyCount.toLocaleString() }} archived copies
            </template>
            <template v-else>
              Locating Grim Dawn, its item database, and transfer stashes.
            </template>
          </p>
        </div>
        <button class="primary-action" type="button" :disabled="scanning" @click="emit('refresh')">
          {{ scanning ? 'Reading the archives…' : 'Refresh collection' }}
        </button>
      </section>

      <section v-if="available" class="completion-tracker" aria-label="Collection completion">
        <header>
          <div><p class="section-label">Collection progress</p><strong>{{ allItemSummary.collected }} / {{ allItemSummary.total }} tracked entries</strong></div>
          <button type="button" :aria-expanded="!trackerCollapsed" @click="emit('toggle-tracker')">{{ trackerCollapsed ? 'Show trackers' : 'Hide trackers' }}</button>
        </header>
        <div v-if="!trackerCollapsed" class="metrics">
        <button
          type="button"
          :aria-pressed="selectedRarity === 'all'"
          @click="emit('filter-all')"
        >
          <div class="metric-heading">
            <span>All items</span>
            <strong>{{ allItemSummary.collected }} / {{ allItemSummary.total || '—' }}</strong>
          </div>
          <div class="meter all"><span :style="{ width: percentage(allItemSummary) }" /></div>
          <small>
            {{ percentage(allItemSummary) }} discovered · Epic, Legendary, and {{ miCountingMode === 'base' ? 'MI bases' : 'MI level tiers' }}
            <template v-if="allItemRollSummary.median !== null"> · median best {{ allItemRollSummary.median.toFixed(1) }}% ({{ allItemRollSummary.scored }} scored)</template>
          </small>
        </button>
        <button
          type="button"
          :aria-pressed="selectedRarity === 'legendary'"
          @click="emit('filter-rarity', 'legendary')"
        >
          <div class="metric-heading">
            <span>Legendaries</span>
            <strong>{{ rarity('legendary')?.collected ?? 0 }} / {{ rarity('legendary')?.total ?? '—' }}</strong>
          </div>
          <div class="meter legendary"><span :style="{ width: percentage(rarity('legendary')) }" /></div>
          <small>
            {{ percentage(rarity('legendary')) }} discovered · {{ rarity('legendary')?.availableCopies ?? 0 }} copies available
            <template v-if="awakeningAvailableLegendaryCount"> · {{ awakeningAvailableLegendaryCount }} available by awakening</template>
            <template v-if="legendaryRollSummary.median !== null"> · median best {{ legendaryRollSummary.median.toFixed(1) }}% ({{ legendaryRollSummary.scored }} scored)</template>
          </small>
        </button>
        <button
          type="button"
          :aria-pressed="selectedRarity === 'epic'"
          @click="emit('filter-rarity', 'epic')"
        >
          <div class="metric-heading">
            <span>Epics</span>
            <strong>{{ rarity('epic')?.collected ?? 0 }} / {{ rarity('epic')?.total ?? '—' }}</strong>
          </div>
          <div class="meter epic"><span :style="{ width: percentage(rarity('epic')) }" /></div>
          <small>
            {{ percentage(rarity('epic')) }} discovered · {{ rarity('epic')?.availableCopies ?? 0 }} copies available
            <template v-if="epicRollSummary.median !== null"> · median best {{ epicRollSummary.median.toFixed(1) }}% ({{ epicRollSummary.scored }} scored)</template>
          </small>
        </button>
        <button
          type="button"
          :aria-pressed="selectedRarity === 'mi'"
          @click="emit('filter-rarity', 'mi')"
        >
          <div class="metric-heading">
            <span>{{ miCountingMode === 'base' ? 'MI Bases' : 'MI Level Tiers' }}</span>
            <strong>{{ rarity('mi')?.collected ?? 0 }} / {{ rarity('mi')?.total ?? '—' }}</strong>
          </div>
          <div class="meter mi"><span :style="{ width: percentage(rarity('mi')) }" /></div>
          <small>
            {{ percentage(rarity('mi')) }} discovered · {{ miCountingMode === 'base' ? 'any owned tier completes its base' : 'every obtainable level tier counted separately' }}
            <template v-if="miRollSummary.median !== null"> · median best {{ miRollSummary.median.toFixed(1) }}% ({{ miRollSummary.scored }} scored)</template>
          </small>
        </button>
        <button
          type="button"
          aria-pressed="false"
          @click="emit('open-affixes')"
        >
          <div class="metric-heading">
            <span>Affixes</span>
            <strong>{{ affixSummary?.collected ?? 0 }} / {{ affixSummary?.total ?? '—' }}</strong>
          </div>
          <div class="meter affix"><span :style="{ width: affixPercentage() }" /></div>
          <small>
            {{ affixPercentage() }} discovered · prefixes and suffixes
            <template v-if="affixRollSummary.median !== null"> · median best {{ affixRollSummary.median.toFixed(1) }}% ({{ affixRollSummary.scored }} scored)</template>
          </small>
        </button>
        <button
          type="button"
          aria-pressed="false"
          @click="emit('open-sets')"
        >
          <div class="metric-heading">
            <span>Sets</span>
            <strong>{{ setSummary.collected }} / {{ setSummary.total || '—' }}</strong>
          </div>
          <div class="meter set"><span :style="{ width: percentage(setSummary) }" /></div>
          <small>
            {{ percentage(setSummary) }} complete · {{ setSummary.readyFromStorage }} ready from storage
            <template v-if="setSummary.readyAfterCrafting > setSummary.readyFromStorage">
              · {{ setSummary.readyAfterCrafting - setSummary.readyFromStorage }} more after crafting
            </template>
            <template v-if="setSummary.readyWithQualifiedAvailability > setSummary.readyAfterCrafting">
              · {{ setSummary.readyWithQualifiedAvailability - setSummary.readyAfterCrafting }} more with awakening
            </template>
            <template v-if="setRollSummary.median !== null"> · median best piece {{ setRollSummary.median.toFixed(1) }}% ({{ setRollSummary.scored }} scored)</template>
          </small>
        </button>
        <button
          type="button"
          aria-pressed="false"
          @click="emit('open-materials', 'component')"
        >
          <div class="metric-heading">
            <span>Components</span>
            <strong>{{ componentSummary.collected }} / {{ componentSummary.total || '—' }}</strong>
          </div>
          <div class="meter component"><span :style="{ width: percentage(componentSummary) }" /></div>
          <small>{{ percentage(componentSummary) }} held or recipe-unlocked · {{ componentSummary.availableCopies.toLocaleString() }} in storage</small>
        </button>
        <button
          type="button"
          aria-pressed="false"
          @click="emit('open-materials', 'all')"
        >
          <div class="metric-heading">
            <span>Consumables</span>
            <strong>{{ consumableSummary.collected }} / {{ consumableSummary.total || '—' }}</strong>
          </div>
          <div class="meter consumable"><span :style="{ width: percentage(consumableSummary) }" /></div>
          <small>{{ percentage(consumableSummary) }} tracked · materials, Dynamite, and potion formulas</small>
        </button>
        <button
          type="button"
          aria-pressed="false"
          @click="emit('open-supplies')"
        >
          <div class="metric-heading">
            <span>Supplies</span>
            <strong>{{ reusableSupplySummary.collected }} / {{ reusableSupplySummary.total || '—' }}</strong>
          </div>
          <div class="meter supply"><span :style="{ width: percentage(reusableSupplySummary) }" /></div>
          <small>{{ percentage(reusableSupplySummary) }} reusable unlocks · {{ supplyAccessSummary }}</small>
        </button>
        <button
          type="button"
          :aria-pressed="selectedRarity === 'recipe'"
          @click="emit('filter-recipes')"
        >
          <div class="metric-heading">
            <span>Recipes</span>
            <strong>{{ recipeSummary?.collected ?? 0 }} / {{ recipeSummary?.total ?? '—' }}</strong>
          </div>
          <div class="meter recipe"><span :style="{ width: recipePercentage() }" /></div>
          <small>{{ recipePercentage() }} learned · crafted items count as unlocked</small>
        </button>
        </div>
      </section>

      <section v-if="showLegacyScanner" class="collection-basis" aria-label="Collection persistence">
        <button
          type="button"
          :class="{ active: collectionBasis === 'archive' }"
          :aria-pressed="collectionBasis === 'archive'"
          @click="emit('set-basis', 'archive')"
        >
          <strong>Codex Archive</strong>
          <small>Your durable CC collection. Counts copies stored by CC, even after they leave Grim Dawn.</small>
        </button>
        <button
          type="button"
          :class="{ active: collectionBasis === 'stashes' }"
          :aria-pressed="collectionBasis === 'stashes'"
          @click="emit('set-basis', 'stashes')"
        >
          <strong>Stash Scanner</strong>
          <small>A live inventory of physical copies currently present in the selected Grim Dawn stash files.</small>
        </button>
      </section>
</template>
