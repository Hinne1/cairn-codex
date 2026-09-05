<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'
import type { DismantlingPreview } from '@shared/contracts'
import { ARCHIVE_SELECTION_LIMIT, type DismantlingPage, type DismantlingQueryRequest, type DismantlingSelection } from '@shared/workspace-query-contracts'
import { compileSearchQuery } from '@shared/search-query'
import { searchQueryOptions, searchSchemas } from '@shared/search-schema'
import BoundedResultSurface from '../components/BoundedResultSurface.vue'
import ExplorerToolbar from '../components/ExplorerToolbar.vue'
import ToolHeader from '../components/ToolHeader.vue'
import { searchGuidance } from '../search-guidance'
import { type DismantlingControls, type DismantlingSession, updateDismantlingControls } from './dismantling'
import { useRemoteWorkspacePage } from './remote-workspace-page'

const props = defineProps<{
  queryItems: (request: DismantlingQueryRequest) => Promise<DismantlingPage>
  selectDuplicates: (request: DismantlingQueryRequest) => Promise<DismantlingSelection>
  archiveRevision: number
  session: DismantlingSession
  previewDismantling: (itemIds: string[]) => Promise<DismantlingPreview>
  formatError: (error: unknown) => string
}>()
const controls = defineModel<DismantlingControls>('controls', { required: true })
const { page, selectedIds, selectedItems, preview, busy, error } = props.session
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
const request = computed<DismantlingQueryRequest>(() => ({
  source: 'archive', query: query.value, isHardcore: mode.value === 'all' ? undefined : mode.value === 'hardcore',
  rarity: rarity.value === 'all' ? undefined : rarity.value, offset: (page.value - 1) * 120, limit: 120
}))
const { data, loading, error: loadError, reload } = useRemoteWorkspacePage({
  request: () => request.value, revision: () => props.archiveRevision, fetch: input => props.queryItems(input),
  empty: { items: [], total: 0, offset: 0, limit: 120 } as DismantlingPage,
  formatError: props.formatError, enabled: () => !structuredQuery.value.error
})
const visibleCandidates = computed(() => data.value.items)
const pageReady = computed(() => !loading.value && !structuredQuery.value.error && !loadError.value)
const selectedAttachments = computed(() => [...selectedItems.value.values()].filter(item => item.componentRecord || item.augmentRecord).length)
const selectionBusy = ref(false)
const selectionNotice = ref<string | null>(null)
const contextKey = computed(() => JSON.stringify({ ...request.value, offset: 0, revision: props.archiveRevision }))
let previewGeneration = 0
let selectionGeneration = 0
let disposed = false
watch(contextKey, key => {
  if (props.session.contextKey.value === key) return
  props.session.contextKey.value = key
  selectionGeneration++
  page.value = 1; selectedIds.value = []; selectedItems.value.clear(); selectionNotice.value = null
  previewGeneration++; preview.value = null; error.value = null
}, { immediate: true, flush: 'sync' })
watch(selectedIds, () => {
  previewGeneration++; preview.value = null; error.value = null
  rememberSelection()
}, { deep: true, flush: 'sync' })
watch(visibleCandidates, rememberSelection)
onScopeDispose(() => { disposed = true; previewGeneration++ })
const searchError = computed(() => {
  const queryError = structuredQuery.value.error
  return queryError ? (queryError.fragment ? queryError.message + ' Check “' + queryError.fragment + '”.' : queryError.message) : null
})

function rememberSelection(): void {
  const selected = new Set(selectedIds.value)
  const known = new Map([...selectedItems.value].filter(([id]) => selected.has(id)))
  for (const item of visibleCandidates.value) if (selected.has(item.id)) known.set(item.id, item)
  selectedItems.value = known
}
function setSelection(keys: readonly (string | number)[]): void {
  if (busy.value || selectionBusy.value || !pageReady.value) return
  selectedIds.value = [...new Set(keys.map(String))].slice(0, ARCHIVE_SELECTION_LIMIT)
}
function toggleCandidate(id: string): void {
  setSelection(selectedIds.value.includes(id) ? selectedIds.value.filter(candidate => candidate !== id) : [...selectedIds.value, id])
}
function selectVisible(): void { setSelection([...selectedIds.value, ...visibleCandidates.value.map(item => item.id)]) }
async function selectSafeDuplicates(): Promise<void> {
  if (busy.value || selectionBusy.value || !pageReady.value) return
  const expectedContext = contextKey.value
  const generation = selectionGeneration
  selectionBusy.value = true; error.value = null
  try {
    const result = await props.selectDuplicates(request.value)
    if (disposed || generation !== selectionGeneration || contextKey.value !== expectedContext) return
    selectedIds.value = result.ids
    selectionNotice.value = result.total > result.limit
      ? 'Selected ' + result.limit.toLocaleString() + ' of ' + result.total.toLocaleString() + ' safe duplicates. Refine the filters for a smaller preview.'
      : null
  } catch (problem) { if (!disposed && generation === selectionGeneration && contextKey.value === expectedContext) error.value = props.formatError(problem) }
  finally { selectionBusy.value = false }
}
async function buildPreview(): Promise<void> {
  if (busy.value || selectionBusy.value || !pageReady.value || selectedIds.value.length === 0) return
  const generation = ++previewGeneration
  busy.value = true; error.value = null
  try {
    const result = await props.previewDismantling([...selectedIds.value])
    if (!disposed && generation === previewGeneration) preview.value = result
  } catch (problem) { if (!disposed && generation === previewGeneration) error.value = props.formatError(problem) }
  finally { busy.value = false }
}
function formatPercentile(value: number | null | undefined): string { return value == null ? '—' : value.toFixed(1) + '%' }
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
      :result-count="data.total"
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
        <button type="button" :disabled="busy || !pageReady || selectionBusy || !visibleCandidates.length" @click="selectVisible">Select visible</button>
        <button
          type="button"
          :disabled="busy || !pageReady || selectionBusy || !data.total"
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
        <p v-if="selectionNotice" class="dismantling-help">{{ selectionNotice }}</p>
        <BoundedResultSurface
          v-model:page="page"
          class="dismantling-list"
          :items="visibleCandidates"
          :get-key="item => item.id"
          :remote="true"
          :total-count="loading ? Math.max(data.total, page * 120) : data.total"
          :page-size="120"
          :loading="loading"
          :error="searchError || loadError"
          :selected-keys="selectedIds"
          :selection-disabled="busy || selectionBusy"
          label="Dismantling candidate copies"
          empty-title="No archived copies match these filters."
          selection-mode="multiple"
          @update:selected-keys="setSelection"
          @retry="reload"
        >
          <template #item="{ item }">
          <label
            :class="['dismantling-row', item.rarity, { attached: item.componentRecord || item.augmentRecord }]"
            @click.stop
          >
            <input type="checkbox" :checked="selectedIds.includes(item.id)" :disabled="busy || selectionBusy" @change="toggleCandidate(item.id)" />
            <div>
              <strong>{{ item.name }}</strong>
              <small>{{ item.isHardcore ? 'HC' : 'SC' }} · {{ item.rarity === 'mi' ? 'Monster Infrequent' : item.rarity }} · Lv{{ item.itemLevel }} · Seed {{ item.seed }}</small>
              <em v-if="item.componentRecord || item.augmentRecord">
                {{ [item.componentRecord && 'component', item.augmentRecord && 'augment'].filter(Boolean).join(' + ') }} attached
              </em>
            </div>
            <span>{{ formatPercentile(item.rollPercentile) }}</span>
          </label>
          </template>
        </BoundedResultSurface>
      </section>

      <aside class="dismantling-preview">
        <header>
          <div><p class="section-label">Probability model</p><h3>Inventor preview</h3></div>
          <small v-if="preview">Rules: {{ preview.contentPack.toUpperCase() }}</small>
        </header>
        <p v-if="selectedAttachments" class="dismantling-warning">{{ selectedAttachments }} selected {{ selectedAttachments === 1 ? 'copy has' : 'copies have' }} a component or augment. A future destructive workflow must make their fate explicit.</p>
        <button class="dismantling-run" type="button" :disabled="busy || !pageReady || selectionBusy || selectedIds.length === 0" @click="buildPreview">
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
