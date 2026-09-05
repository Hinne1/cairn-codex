<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CollectionItem, ObservedStashItem, VaultListItem } from '../../../shared/contracts'
import type { ItemInspectionSession } from './item-inspection'
import type { MiWorkshopControls } from '../workspaces/mi-workshop'
import { miMetricLabel, miMetricResult, buildMiMetricOptions } from '../workspaces/mi-workshop'
import { researchItemTypeLabel, researchRarityLabel } from '../workspaces/research-item-table'
import BoundedResultSurface from '../components/BoundedResultSurface.vue'
import RollCategoryProfile from '../components/RollCategoryProfile.vue'
import { rollCategoryScores } from '../roll-rating'
import { formatPresentationLine } from '../item-presentation'
import { isAvailableViaAwakening } from '../../../shared/collection-availability'

const props = defineProps<{
  session: ItemInspectionSession
  itemIconUrl: (item: CollectionItem) => string | null
  catalogItemByRecord: (record: string | null | undefined) => CollectionItem | null
  vaultCopyForObserved: (copy: ObservedStashItem) => VaultListItem | null
  isDoubleRareMiCopy: (copy: ObservedStashItem) => boolean
  miMetricOptions: ReturnType<typeof buildMiMetricOptions>
  doubleRareIcon?: string | null
  depositTabDescription: string
  busy: boolean
  liveReady: boolean
}>()
const emit = defineEmits<{
  'icon-error': [item: CollectionItem]
  'open-roll-help': []
  'open-mi-workshop': []
  'open-item': [item: CollectionItem]
  'retrieve-copy': [id: string]
}>()
const selectedMiMetric = defineModel<MiWorkshopControls['metric']>('metric', { required: true })
const selectedMiMetricDirection = defineModel<MiWorkshopControls['metricDirection']>('metricDirection', { required: true })
const selectedMiMetricLabel = computed(() => miMetricLabel(props.miMetricOptions, selectedMiMetric.value))
const {
  selectedItem, selectedCopies, comparisonReferenceCopy, selectedStoredCopies,
  activeCopyAffixTarget, activeCopyAffix, pinning, pinCopy, copyAffixName, copyAffixRarity,
  copyAffixRarityLabel, copyAffixIsOpen, toggleCopyAffix, copySourceLabel,
  comparisonItemStats, comparisonPetStats, copyAffixDelta
} = props.session
const copyPage = ref(1)
watch([selectedItem, selectedMiMetric, selectedMiMetricDirection, comparisonReferenceCopy], () => { copyPage.value = 1 })
function itemAvailableByAwakeningOnly(item: CollectionItem): boolean {
  return item.availableCount === 0 && isAvailableViaAwakening(item)
}
function awakeningAvailabilityLabel(item: CollectionItem): string {
  const source = item.awakeningSourceName ?? 'owned Epic base'
  const count = item.awakeningSourceAvailableCount ?? 0
  return `Available by awakening ${source}${count > 1 ? ` (${count} bases)` : ''}`
}
</script>

<template>
    <div v-if="selectedItem" class="drawer-backdrop comparison-backdrop" @click.self="session.close()">
      <aside class="item-drawer comparison-workspace" :aria-label="selectedItem.name + ' copy comparison'">
        <button class="drawer-close" type="button" aria-label="Close comparison" @click="session.close()">×</button>
        <header class="comparison-heading">
          <img v-if="itemIconUrl(selectedItem)" :src="itemIconUrl(selectedItem)!" alt="" @error="emit('icon-error', selectedItem)" />
          <span v-else class="item-icon-placeholder comparison-icon-placeholder" aria-hidden="true">{{ selectedItem.slot.slice(0, 2).toLocaleUpperCase() }}</span>
          <div>
            <p class="section-label">Copy comparison</p>
            <h2>{{ selectedItem.name }}</h2>
            <p class="drawer-intro">
              One copy is the reference. Every other copy shows its exact value and quality deltas against it.
              Saving a reference also remembers that copy as your preferred roll.
            </p>
            <button type="button" class="roll-help-link" @click="emit('open-roll-help')">How item rolls are rated → Glossary</button>
          </div>
          <div class="comparison-count">
            <strong>{{ selectedCopies.length }}</strong>
            <span>{{ selectedCopies.length === 1 ? 'copy' : 'copies' }}</span>
          </div>
        </header>
        <section v-if="selectedItem.rarity === 'mi'" class="drawer-mi-tools">
          <button type="button" @click="emit('open-mi-workshop')">Open in MI Workshop</button>
          <label>
            <span>Compare these copies by</span>
            <select v-model="selectedMiMetric">
              <optgroup label="Roll quality">
                <option v-for="option in miMetricOptions.quality" :key="option.key" :value="option.key">{{ option.label }}</option>
              </optgroup>
              <optgroup label="Item stats">
                <option v-for="option in miMetricOptions.item" :key="option.key" :value="option.key">{{ option.label }}</option>
              </optgroup>
              <optgroup label="Bonus to All Pets">
                <option v-for="option in miMetricOptions.pet" :key="option.key" :value="option.key">{{ option.label }}</option>
              </optgroup>
            </select>
          </label>
          <label>
            <span>Order</span>
            <select v-model="selectedMiMetricDirection">
              <option value="desc">Highest first</option>
              <option value="asc">Lowest first</option>
            </select>
          </label>
        </section>
        <section v-if="selectedStoredCopies.length" class="drawer-stored-copies">
          <header>
            <div>
              <p class="section-label">Codex Archive</p>
              <strong>{{ selectedStoredCopies.length }} stored {{ selectedStoredCopies.length === 1 ? 'copy' : 'copies' }}</strong>
            </div>
            <small>Returns land in the {{ depositTabDescription }}.</small>
          </header>
          <p>Select the exact copy below. Roll, affixes, seed, pin state, and retrieval now stay together.</p>
        </section>
        <section v-else-if="itemAvailableByAwakeningOnly(selectedItem)" class="drawer-awakening-source">
          <span class="awakening-sigil"><i /></span>
          <div>
            <p class="section-label">Qualified availability</p>
            <strong>{{ awakeningAvailabilityLabel(selectedItem) }}</strong>
            <small>This Legendary is not stored yet. Awakening consumes one qualifying Epic base.</small>
          </div>
          <button
            v-if="catalogItemByRecord(selectedItem.awakeningSourceRecord)"
            type="button"
            @click="emit('open-item', catalogItemByRecord(selectedItem.awakeningSourceRecord)!)"
          >View Epic base</button>
        </section>
        <p
          v-if="selectedItem.pinnedInstanceKey && !selectedCopies.some((copy) => copy.instanceKey === selectedItem?.pinnedInstanceKey)"
          class="pinned-away"
        >
          Your pinned copy is remembered, but it is not in a currently scanned stash.
        </p>

        <div class="copy-list">
          <p v-if="selectedCopies.length === 0 && !itemAvailableByAwakeningOnly(selectedItem)" class="drawer-empty">
            No currently scanned copy is available. The catalog tooltip will show this item's possible ranges.
          </p>
          <BoundedResultSurface
            v-if="selectedCopies.length"
            v-model:page="copyPage"
            class="inspection-copies"
            :class="{ 'paged-copies': selectedCopies.length > 50 }"
            :items="selectedCopies"
            :get-key="copy => copy.instanceKey!"
            :page-size="50"
            label="Item copies"
            layout="grid"
          >
          <template #item="{ item: copy, index }">
          <article
            class="copy-card"
            :class="{
              pinned: copy.instanceKey === selectedItem.pinnedInstanceKey,
              reference: copy.instanceKey === comparisonReferenceCopy?.instanceKey
            }"
          >
            <header>
              <div class="copy-identity">
                <div class="copy-item-heading" :class="selectedItem.rarity">
                  <img v-if="itemIconUrl(selectedItem)" :src="itemIconUrl(selectedItem)!" alt="" @error="emit('icon-error', selectedItem)" />
                  <span v-else class="item-icon-placeholder copy-icon-placeholder" aria-hidden="true">{{ selectedItem.slot.slice(0, 2).toLocaleUpperCase() }}</span>
                  <div>
                    <p>
                      {{ copy.instanceKey === comparisonReferenceCopy?.instanceKey ? 'Reference copy' : `Copy ${index + 1}` }}
                      <span v-if="vaultCopyForObserved(copy)" class="stored-badge">Stored</span>
                      <img
                        v-if="selectedItem.rarity === 'mi' && isDoubleRareMiCopy(copy) && doubleRareIcon"
                        class="double-rare-icon"
                        :src="`cairn-icon://asset/${doubleRareIcon}.png`"
                        alt="Double rare"
                        title="Double rare Monster Infrequent"
                      />
                      <span
                        v-else-if="selectedItem.rarity === 'mi' && isDoubleRareMiCopy(copy)"
                        class="double-rare-badge"
                      >Double rare</span>
                    </p>
                    <h3 class="copy-colored-name">
                      <span
                        v-if="copy.prefixRecord"
                        class="copy-name-affix"
                        :class="copyAffixRarity(copy.prefixRecord)"
                      >{{ copyAffixName(copy.prefixRecord, '') }}</span>
                      <span class="copy-name-base">{{ selectedItem.name }}</span>
                      <span
                        v-if="copy.suffixRecord"
                        class="copy-name-affix"
                        :class="copyAffixRarity(copy.suffixRecord)"
                      >{{ copyAffixName(copy.suffixRecord, '') }}</span>
                    </h3>
                    <small>{{ researchRarityLabel(selectedItem) }} · {{ researchItemTypeLabel(selectedItem) }} · Lv{{ selectedItem.levelRequirement }}</small>
                  </div>
                </div>
                <div class="copy-roll-profile">
                  <small :title="selectedItem.rarity === 'mi'
                    ? 'Category badges rate variable values for this exact base, prefix, and suffix. They do not rate affix suitability.'
                    : 'Category badges show average range quality (0% minimum, 100% maximum), then its sampled percentile in parentheses.'">
                    {{ selectedItem.rarity === 'mi' ? 'Roll profile · exact affix rolls' : 'Roll profile · average (rarity)' }}
                  </small>
                  <RollCategoryProfile
                    :scores="rollCategoryScores(copy.rollAnalysis)"
                    :max-visible="5"
                  />
                  <span v-if="!rollCategoryScores(copy.rollAnalysis).length" class="copy-roll-unscored">
                    {{ copy.rollAnalysis?.trusted ? ((copy.rollAnalysis.modelVersion ?? 0) < 9 ? 'Quality recalculation pending' : 'No variable rolls') : 'Unscored' }}
                  </span>
                </div>
                <p
                  v-if="selectedItem.rarity === 'mi' && (selectedMiMetric.startsWith('item:') || selectedMiMetric.startsWith('pet:'))"
                  class="copy-selected-metric"
                >
                  <span>{{ selectedMiMetricLabel }}</span>
                  <strong>{{ miMetricResult(copy, selectedMiMetric).display }}</strong>
                </p>
                <div class="copy-affixes">
                  <button
                    type="button"
                    :disabled="!copy.prefixRecord"
                    :class="[copyAffixRarity(copy.prefixRecord), { active: copyAffixIsOpen(copy, copy.prefixRecord) }]"
                    :title="copy.prefixRecord ? 'Show this prefix’s bonuses' : 'This copy has no prefix'"
                    @click="toggleCopyAffix(copy, copy.prefixRecord)"
                  ><small>Prefix · {{ copyAffixRarityLabel(copy.prefixRecord) }}</small><strong>{{ copyAffixName(copy.prefixRecord, 'No prefix') }}</strong><em>{{ copyAffixDelta(copy, 'prefix') }}</em></button>
                  <button
                    type="button"
                    :disabled="!copy.suffixRecord"
                    :class="[copyAffixRarity(copy.suffixRecord), { active: copyAffixIsOpen(copy, copy.suffixRecord) }]"
                    :title="copy.suffixRecord ? 'Show this suffix’s bonuses' : 'This copy has no suffix'"
                    @click="toggleCopyAffix(copy, copy.suffixRecord)"
                  ><small>Suffix · {{ copyAffixRarityLabel(copy.suffixRecord) }}</small><strong>{{ copyAffixName(copy.suffixRecord, 'No suffix') }}</strong><em>{{ copyAffixDelta(copy, 'suffix') }}</em></button>
                </div>
                <section
                  v-if="activeCopyAffix && activeCopyAffixTarget && [copy.prefixRecord, copy.suffixRecord].includes(activeCopyAffixTarget.record) && copyAffixIsOpen(copy, activeCopyAffixTarget.record)"
                  class="copy-affix-detail"
                  :class="activeCopyAffix.rarity"
                >
                  <header>
                    <span><small>{{ activeCopyAffix.kind }}</small><strong>{{ activeCopyAffix.name }}</strong></span>
                    <button type="button" aria-label="Close affix details" @click="activeCopyAffixTarget = null">×</button>
                  </header>
                  <template v-if="activeCopyAffix.presentation?.sections.some((section) => section.lines.length)">
                    <div v-for="section in activeCopyAffix.presentation?.sections ?? []" :key="`${activeCopyAffixTarget.record}:${section.kind}:${section.heading}`" class="copy-affix-section">
                      <h4 v-if="section.heading">{{ section.heading }}</h4>
                      <p v-for="line in section.lines" :key="`${line.label}:${line.minimum}:${line.maximum}`" :class="`tone-${line.tone}`">
                        {{ formatPresentationLine(line) }}
                      </p>
                    </div>
                  </template>
                  <p v-else class="copy-affix-empty">This affix changes non-rollable item rules rather than visible stats.</p>
                </section>
                <p class="copy-provenance">{{ copySourceLabel(copy) }} · Seed {{ copy.seed }}</p>
              </div>
              <div class="copy-actions">
                <span v-if="copy.instanceKey === comparisonReferenceCopy?.instanceKey" class="reference-badge">Reference</span>
                <button
                  v-if="vaultCopyForObserved(copy)"
                  class="retrieve-copy"
                  type="button"
                  :disabled="busy || !liveReady"
                  @click="emit('retrieve-copy', vaultCopyForObserved(copy)!.id)"
                >
                  Retrieve this copy
                </button>
                <button type="button" :disabled="pinning" @click="pinCopy(copy)">
                  {{ copy.instanceKey === selectedItem.pinnedInstanceKey
                    ? 'Clear saved reference'
                    : copy.instanceKey === comparisonReferenceCopy?.instanceKey
                      ? 'Save this reference'
                      : 'Use as reference' }}
                </button>
              </div>
            </header>

            <p v-if="copy.rollAnalysis && !copy.rollAnalysis.trusted" class="withheld-note">
              {{ copy.rollAnalysis.reason }}
            </p>
            <div v-else-if="copy.rollAnalysis && (comparisonItemStats(copy).length || comparisonPetStats(copy).length)" class="copy-roll-sections">
              <section v-if="comparisonItemStats(copy).length">
                <h3>Item differences</h3>
                <p class="copy-roll-guide">Actual value · delta from reference · range quality (0–100%); parentheses show sampled percentile</p>
                <div class="stat-list">
                  <div v-for="stat in comparisonItemStats(copy)" :key="stat.key" class="stat-row" :class="{ missing: stat.missingFromCopy }">
                    <div class="stat-heading">
                      <span>{{ stat.label }}</span>
                      <strong :title="stat.rankDescription">{{ stat.valueLabel }}<template v-if="stat.qualityPercent !== null"> · {{ stat.qualityPercent.toFixed(0) }}%<template v-if="stat.rankLabel"> ({{ stat.rankLabel }})</template></template><template v-else> · fixed</template></strong>
                    </div>
                    <div class="stat-delta" :class="`delta-${stat.deltaTone}`">
                      <b>{{ stat.deltaLabel }}</b>
                      <small v-if="stat.qualityDeltaLabel">{{ stat.qualityDeltaLabel }}</small>
                    </div>
                    <div v-if="stat.qualityPercent !== null" class="stat-meter"><span :style="{ width: `${stat.qualityPercent}%` }" /></div>
                    <small>{{ stat.qualityPercent === null ? 'Fixed value' : `${stat.rangeLabel} sampled range` }}</small>
                  </div>
                </div>
              </section>
              <section v-if="comparisonPetStats(copy).length" class="pet-roll-section">
                <h3>Bonus to All Pets differences</h3>
                <p class="copy-roll-guide">Includes inherent and affix-granted pet bonuses, compared to the reference copy</p>
                <div class="stat-list">
                  <div v-for="stat in comparisonPetStats(copy)" :key="`pet:${stat.key}`" class="stat-row pet-stat-row" :class="{ missing: stat.missingFromCopy }">
                    <div class="stat-heading">
                      <span>{{ stat.label }}</span>
                      <strong :title="stat.rankDescription">{{ stat.valueLabel }}<template v-if="stat.qualityPercent !== null"> · {{ stat.qualityPercent.toFixed(0) }}%<template v-if="stat.rankLabel"> ({{ stat.rankLabel }})</template></template><template v-else> · fixed</template></strong>
                    </div>
                    <div class="stat-delta" :class="`delta-${stat.deltaTone}`">
                      <b>{{ stat.deltaLabel }}</b>
                      <small v-if="stat.qualityDeltaLabel">{{ stat.qualityDeltaLabel }}</small>
                    </div>
                    <div v-if="stat.qualityPercent !== null" class="stat-meter"><span :style="{ width: `${stat.qualityPercent}%` }" /></div>
                    <small>{{ stat.qualityPercent === null ? 'Fixed value' : `${stat.rangeLabel} sampled range` }}</small>
                  </div>
                </div>
              </section>
            </div>
            <p v-else class="withheld-note">
              Roll analysis is pending. This copy remains safe and retrievable; its score will appear without reopening the drawer.
            </p>
          </article>
          </template>
          </BoundedResultSurface>
        </div>
      </aside>
    </div>
</template>

<style scoped>
.copy-list { display: block; }
.inspection-copies :deep(.bounded-results-collection) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(560px, 100%), 1fr));
  align-items: start;
  gap: 16px;
}
.inspection-copies:not(.paged-copies) :deep(.bounded-results-footer) { display: none; }
</style>
