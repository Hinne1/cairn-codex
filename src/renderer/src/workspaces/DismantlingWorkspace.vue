<script setup lang="ts">
import { computed, watch } from 'vue'
import type { DismantlingPreview, VaultListItem } from '@shared/contracts'
import { compileSearchQuery } from '@shared/search-query'
import { searchQueryOptions, searchSchemas } from '@shared/search-schema'
import ExplorerToolbar from '../components/ExplorerToolbar.vue'
import ToolHeader from '../components/ToolHeader.vue'
import { searchGuidance } from '../search-guidance'
import {
  eligibleDismantlingCandidates,
  filterDismantlingCandidates,
  selectRedundantDismantlingCandidateIds,
  type DismantlingControls,
  type DismantlingSession,
  updateDismantlingControls
} from './dismantling'

const props = defineProps<{
  items: readonly VaultListItem[]
  session: DismantlingSession
  previewDismantling: (itemIds: string[]) => Promise<DismantlingPreview>
  formatError: (error: unknown) => string
}>()

const controls = defineModel<DismantlingControls>('controls', { required: true })
const { visibleCount, selectedIds, preview, busy, error, filterKey } = props.session
const query = computed({
  get: () => controls.value.query,
  set: (query: string) => { controls.value = updateDismantlingControls(controls.value, { query }) }
})
const mode = computed({
  get: () => controls.value.mode,
  set: (mode: DismantlingControls['mode']) => { controls.value = updateDismantlingControls(controls.value, { mode }) }
})
const rarity = computed({
  get: () => controls.value.rarity,
  set: (rarity: DismantlingControls['rarity']) => { controls.value = updateDismantlingControls(controls.value, { rarity }) }
})
const structuredQuery = computed(() => compileSearchQuery(query.value, searchQueryOptions(searchSchemas.dismantling)))
const eligibleCandidates = computed(() => eligibleDismantlingCandidates(props.items))
const filteredCandidates = computed(() => filterDismantlingCandidates(
  eligibleCandidates.value,
  controls.value,
  structuredQuery.value
))
const visibleCandidates = computed(() => filteredCandidates.value.slice(0, visibleCount.value))
const selectedCandidates = computed(() => {
  const selected = new Set(selectedIds.value)
  return eligibleCandidates.value.filter((item) => selected.has(item.id))
})
const selectedAttachments = computed(() =>
  selectedCandidates.value.filter((item) => item.componentRecord || item.augmentRecord).length
)
const searchError = computed(() => {
  const queryError = structuredQuery.value.error
  if (!queryError) return null
  return queryError.fragment ? `${queryError.message} Check “${queryError.fragment}”.` : queryError.message
})

watch([query, mode, rarity], ([currentQuery, currentMode, currentRarity]) => {
  const nextFilterKey = JSON.stringify([currentQuery, currentMode, currentRarity])
  if (filterKey.value === nextFilterKey) return
  filterKey.value = nextFilterKey
  visibleCount.value = 120
}, { immediate: true })
watch(selectedIds, () => {
  preview.value = null
  error.value = null
}, { deep: true })
watch(
  () => eligibleCandidates.value.map((item) => item.id).join('\u0000'),
  () => {
    const available = new Set(eligibleCandidates.value.map((item) => item.id))
    selectedIds.value = selectedIds.value.filter((id) => available.has(id))
  },
  { immediate: true }
)

function toggleCandidate(id: string): void {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((candidate) => candidate !== id)
    : [...selectedIds.value, id]
}

function selectVisible(): void {
  selectedIds.value = [...new Set([
    ...selectedIds.value,
    ...visibleCandidates.value.map((item) => item.id)
  ])]
}

function selectSafeDuplicates(): void {
  selectedIds.value = selectRedundantDismantlingCandidateIds(filteredCandidates.value)
}

async function buildPreview(): Promise<void> {
  if (busy.value || selectedIds.value.length === 0) return
  busy.value = true
  error.value = null
  try {
    preview.value = await props.previewDismantling([...selectedIds.value])
  } catch (previewError) {
    error.value = props.formatError(previewError)
  } finally {
    busy.value = false
  }
}

function formatPercentile(value: number | null | undefined): string {
  return value == null ? '—' : `${value.toFixed(1)}%`
}
</script>

<template>
  <section class="dismantling-workspace" aria-label="Read-only dismantling simulator">
    <ToolHeader
      eyebrow="Inventor research · read only"
      title="Dismantling Lab"
      description="Select exact archived copies and preview what Grim Dawn's installed dismantling tables can produce. Nothing here changes the archive, game, Iron, Dynamite, components, or materials."
    >
      <template #aside><span class="read-only-seal">No write path</span></template>
    </ToolHeader>

    <div class="dismantling-resource-gaps">
      <article>
        <small>Iron Bits</small><strong>Balance not indexed</strong>
        <p>CC can calculate the exact fee, but does not yet read or debit character money.</p>
      </article>
      <article>
        <small>Dynamite</small><strong>Balance not indexed</strong>
        <p>Account materials live outside the transfer tabs CC currently owns.</p>
      </article>
      <article>
        <small>Material store</small><strong>Untouched</strong>
        <p>Expected rewards are simulated only; the component/material stash remains read-only.</p>
      </article>
    </div>

    <ExplorerToolbar
      v-model="query"
      v-bind="searchGuidance.dismantling"
      search-label="Search candidates"
      placeholder="Item, base, prefix, suffix…"
      :result-count="filteredCandidates.length"
      result-label="candidate copies"
      :search-error="searchError"
    >
      <template #filters>
        <label>
          <span>Game mode</span>
          <select v-model="mode" autocomplete="off">
            <option value="all">Hardcore + Softcore</option>
            <option value="hardcore">Hardcore</option>
            <option value="softcore">Softcore</option>
          </select>
        </label>
        <label>
          <span>Rarity</span>
          <select v-model="rarity" autocomplete="off">
            <option value="all">All eligible rarities</option>
            <option value="legendary">Legendary</option>
            <option value="epic">Epic</option>
            <option value="mi">Monster Infrequent</option>
            <option value="rare">Rare</option>
          </select>
        </label>
      </template>
      <template #actions>
        <button type="button" @click="selectVisible">Select visible</button>
        <button
          type="button"
          title="Keeps the highest-scored or newest copy of each base; skips socketed and augmented extras."
          @click="selectSafeDuplicates"
        >Select safe duplicates</button>
        <button type="button" :disabled="selectedIds.length === 0" @click="selectedIds = []">Clear</button>
      </template>
    </ExplorerToolbar>

    <div class="dismantling-layout">
      <section class="dismantling-candidates">
        <header>
          <div><p class="section-label">Codex Archive</p><h3>Candidate copies</h3></div>
          <strong>{{ selectedIds.length.toLocaleString() }} selected</strong>
        </header>
        <p class="dismantling-help">
          “Safe duplicates” preserves one best-scored copy per base and game mode, then excludes extras carrying a component or augment.
        </p>
        <div class="dismantling-list">
          <label
            v-for="item in visibleCandidates"
            :key="item.id"
            :class="['dismantling-row', item.rarity, { attached: item.componentRecord || item.augmentRecord }]"
          >
            <input type="checkbox" :checked="selectedIds.includes(item.id)" @change="toggleCandidate(item.id)" />
            <div>
              <strong>{{ item.name }}</strong>
              <small>{{ item.isHardcore ? 'HC' : 'SC' }} · {{ item.rarity === 'mi' ? 'Monster Infrequent' : item.rarity }} · Lv{{ item.itemLevel }} · Seed {{ item.seed }}</small>
              <em v-if="item.componentRecord || item.augmentRecord">
                {{ [item.componentRecord && 'component', item.augmentRecord && 'augment'].filter(Boolean).join(' + ') }} attached
              </em>
            </div>
            <span>{{ formatPercentile(item.rollAnalysis?.overallEstimatedPercentile) }}</span>
          </label>
        </div>
        <button
          v-if="visibleCandidates.length < filteredCandidates.length"
          class="dismantling-more"
          type="button"
          @click="visibleCount += 120"
        >Show 120 more · {{ (filteredCandidates.length - visibleCandidates.length).toLocaleString() }} remaining</button>
        <p v-if="filteredCandidates.length === 0" class="vault-empty">No archived copies match these filters.</p>
      </section>

      <aside class="dismantling-preview">
        <header>
          <div><p class="section-label">Probability model</p><h3>Inventor preview</h3></div>
          <small v-if="preview">Rules: {{ preview.contentPack.toUpperCase() }}</small>
        </header>
        <p v-if="selectedAttachments" class="dismantling-warning">{{ selectedAttachments }} selected {{ selectedAttachments === 1 ? 'copy has' : 'copies have' }} a component or augment. A future destructive workflow must make their fate explicit.</p>
        <button class="dismantling-run" type="button" :disabled="busy || selectedIds.length === 0" @click="buildPreview">
          {{ busy ? 'Reading installed loot tables…' : `Preview ${selectedIds.length.toLocaleString()} selected` }}
        </button>
        <p v-if="error" class="vault-notice error">{{ error }}</p>
        <template v-if="preview">
          <div class="dismantling-costs">
            <article><small>Iron fee</small><strong>{{ preview.ironCost.toLocaleString() }}</strong></article>
            <article><small>Dynamite</small><strong>{{ preview.dynamiteCost.toLocaleString() }}</strong></article>
            <article><small>Scrap</small><strong>{{ preview.scrapExpected.toFixed(1) }} expected</strong><span>{{ preview.scrapMinimum }}–{{ preview.scrapMaximum }} possible</span></article>
          </div>
          <section class="scrap-distribution">
            <h4>Scrap per item</h4>
            <div><span v-for="outcome in preview.scrapOutcomes" :key="outcome.count"><b>{{ outcome.count }}</b><small>{{ (outcome.probability * 100).toFixed(0) }}%</small></span></div>
          </section>
          <section class="dismantling-rewards">
            <h4>Bonus reward expectations</h4>
            <p>Expected count is the long-run average for this batch; “any” is the chance this run yields at least one.</p>
            <div v-for="reward in preview.rewards" :key="reward.record" :class="`reward-${reward.category}`">
              <span><strong>{{ reward.name }}</strong><small>{{ reward.category }}</small></span>
              <b>{{ reward.expectedCount.toFixed(3) }} expected</b>
              <em>{{ (reward.chanceAtLeastOne * 100).toFixed(1) }}% any</em>
            </div>
          </section>
          <footer>This is probability math from <code>{{ preview.ruleRecord }}</code>. No random roll has been performed or saved.</footer>
        </template>
        <div v-else class="dismantling-empty">
          <strong>Assemble a hypothetical batch.</strong>
          <p>The preview will show exact costs, Scrap range, and installed component/material probabilities.</p>
        </div>
      </aside>
    </div>
  </section>
</template>
