<script setup lang="ts">
import type { CollectionItem } from '../../../shared/contracts'
import type { CompiledSearchQuery } from '../../../shared/search-query'
import { isAvailableViaAwakening } from '../../../shared/collection-availability'
import ExplorerToolbar from '../components/ExplorerToolbar.vue'
import BoundedResultSurface from '../components/BoundedResultSurface.vue'
import SemanticBadge from '../components/SemanticBadge.vue'
import { searchGuidance } from '../search-guidance'
import { formatPresentationLine } from '../item-presentation'
import { setItemBadges, setItemDiscovered, setItemUnqualified, setRarity, setReadiness } from '../set-semantics'
import { setCompletionPercent, setLevelLabel, setMemberVisualChanges, type SetsSession } from './sets'
const props = defineProps<{ session: SetsSession; available: boolean }>()
const emit = defineEmits<{
  'queue-tooltip': [item: CollectionItem, event: MouseEvent | FocusEvent]
  'move-tooltip': [event: MouseEvent]
  'hide-tooltip': []
  'open-item': [item: CollectionItem]
}>()
const { query, rarityFilter, setProgressFilter, setFeatureFilter, setSortMode, setSortDirection,
  currentPage, setSearchQuery, visibleSets } = props.session
function searchErrorMessage(query: CompiledSearchQuery): string | null {
  if (!query.error) return null
  return query.error.fragment ? `${query.error.message} Check “${query.error.fragment}”.` : query.error.message
}
function itemAvailableByAwakeningOnly(item: CollectionItem): boolean {
  return item.availableCount === 0 && isAvailableViaAwakening(item)
}
</script>

<template>
      <ExplorerToolbar
        v-if="available"
        class="collection-explorer-toolbar"
        v-model="query"
        v-bind="searchGuidance.sets"
        search-label="Search sets"
        placeholder="Name, stat, skill… (try skill:wendigo)"
        :result-count="visibleSets.length"
        result-label="sets"
        :search-error="searchErrorMessage(setSearchQuery)"
      >
        <template #filters>
          <label>
            <span>Set progress</span>
            <select v-model="setProgressFilter" autocomplete="off">
              <option value="all">All sets</option>
              <option value="complete">Complete</option>
              <option value="progress">In progress</option>
              <option value="unstarted">Unstarted</option>
            </select>
          </label>
          <label>
            <span>Rarity</span>
            <select v-model="rarityFilter" autocomplete="off">
              <option value="all">All set rarities</option>
              <option value="legendary">Legendary sets</option>
              <option value="epic">Epic sets</option>
            </select>
          </label>
          <label>
            <span>Special feature</span>
            <select v-model="setFeatureFilter" autocomplete="off">
              <option value="all">All set effects</option>
              <option value="visual">Visual transformations</option>
            </select>
          </label>
        </template>
        <template #sort>
          <label>
            <span>Sort by</span>
            <select v-model="setSortMode" autocomplete="off">
              <option value="completion">Completion</option>
              <option value="level">Required level</option>
              <option value="name">Name</option>
            </select>
          </label>
          <label>
            <span>Order</span>
            <select v-model="setSortDirection" autocomplete="off">
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
        </template>
      </ExplorerToolbar>

      <BoundedResultSurface
        v-model:page="currentPage"
        class="set-results"
        :items="visibleSets"
        :get-key="set => set.record"
        :page-size="50"
        empty-title="No sets match these filters"
        empty-detail="Try changing the current search or set filters."
        label="Item sets"
        layout="grid"
      >
        <template #item="{ item: set }">
          <article
            class="set-card"
            :class="`rarity-${setRarity(set.items)}`"
            :data-set-record="set.record"
          >
          <header>
            <div>
              <div class="set-heading-badges">
                <SemanticBadge :tone="setRarity(set.items)">{{ setRarity(set.items) }}</SemanticBadge>
                <SemanticBadge tone="level">{{ setLevelLabel(set) }}</SemanticBadge>
              </div>
              <h3>{{ set.name }}</h3>
            </div>
            <div class="set-status">
              <SemanticBadge :tone="set.collected === set.items.length ? 'complete' : 'progress'">
                {{ set.collected }} / {{ set.items.length }} discovered
              </SemanticBadge>
              <span class="set-percentage">{{ setCompletionPercent(set) }}</span>
              <span
                class="set-roll-rating"
                :class="{ unavailable: set.rollRating.average === null }"
                :title="set.rollRating.average === null
                  ? 'No physically available set pieces have a trusted roll rating yet.'
                  : `${set.rollRating.ratedPieces} of ${set.rollRating.availablePieces} available set pieces rated.`"
              >
                <template v-if="set.rollRating.average !== null">
                  ★ {{ set.rollRating.average.toFixed(1) }}% avg roll
                  <small>{{ set.rollRating.ratedPieces }}/{{ set.rollRating.availablePieces }} rated</small>
                </template>
                <template v-else>☆ No rated rolls</template>
              </span>
            </div>
          </header>
          <div class="set-meter">
            <span :style="{ width: `${(set.collected / set.items.length) * 100}%` }" />
          </div>
          <div class="set-readiness">
            <span>Readiness</span>
            <SemanticBadge :tone="setReadiness(set.items).tone">
              {{ setReadiness(set.items).label }}
            </SemanticBadge>
          </div>
          <ul>
            <li
              v-for="item in set.items"
              :key="item.record"
              :class="{
                missing: setItemUnqualified(item),
                craftable: item.recipeUnlocked && item.availableCount === 0 && !isAvailableViaAwakening(item),
                awakening: itemAvailableByAwakeningOnly(item)
              }"
            >
              <button
                type="button"
                aria-describedby="item-tooltip"
                @mouseenter="emit('queue-tooltip', item, $event)"
                @mousemove="emit('move-tooltip', $event)"
                @mouseleave="emit('hide-tooltip')"
                @focus="emit('queue-tooltip', item, $event)"
                @blur="emit('hide-tooltip')"
                @click="emit('open-item', item)"
              >
                <span aria-hidden="true">{{ item.availableCount > 0 ? '✓' : setItemDiscovered(item) ? '◇' : itemAvailableByAwakeningOnly(item) ? '✦' : item.recipeUnlocked ? '⊕' : '○' }}</span>
                <div><strong>{{ item.name }}</strong><small>{{ item.slot }}</small></div>
                <span class="set-item-badges">
                  <SemanticBadge
                    v-for="badge in setItemBadges(item)"
                    :key="badge.key"
                    :tone="badge.tone"
                    compact
                  >
                    {{ badge.label }}
                  </SemanticBadge>
                </span>
              </button>
            </li>
          </ul>
          <section v-if="setMemberVisualChanges(set).length" class="set-member-fx">
            <header><h4>Member item FX</h4><SemanticBadge tone="fx" compact>FX change</SemanticBadge></header>
            <button
              v-for="change in setMemberVisualChanges(set)"
              :key="`${change.item.record}:${change.section.heading}`"
              type="button"
              aria-describedby="item-tooltip"
              @mouseenter="emit('queue-tooltip', change.item, $event)"
              @mousemove="emit('move-tooltip', $event)"
              @mouseleave="emit('hide-tooltip')"
              @focus="emit('queue-tooltip', change.item, $event)"
              @blur="emit('hide-tooltip')"
              @click="emit('open-item', change.item)"
            >
              <strong>{{ change.item.name }}</strong>
              <span>{{ change.section.heading?.replace(' · Visual transformation', '') }}</span>
              <small>{{ change.section.lines.map((line) => formatPresentationLine(line)).join(' · ') }}</small>
            </button>
          </section>
          <div v-if="set.items[0]?.setPresentation?.tiers.length" class="set-bonus-tiers">
            <section
              v-for="tier in set.items[0]?.setPresentation?.tiers"
              :key="tier.requiredPieces"
              :class="{ unlocked: set.collected >= tier.requiredPieces }"
            >
              <div class="set-tier-base">
                <h4>({{ tier.requiredPieces }}) Set</h4>
                <p v-for="(line, index) in tier.lines" :key="`${line.label}:${index}`">
                  {{ formatPresentationLine(line) }}
                </p>
                <div v-if="tier.petLines?.length" class="set-tier-group pet-bonus">
                  <h5>Bonus to All Pets</h5>
                  <p v-for="(line, index) in tier.petLines" :key="`pet:${line.label}:${index}`">
                    {{ formatPresentationLine(line) }}
                  </p>
                </div>
              </div>
              <div
                v-for="modifier in tier.skillModifiers ?? []"
                :key="`modifier:${modifier.heading}`"
                class="set-tier-group skill-bonus"
                :class="{ 'visual-bonus': modifier.kind === 'visual-modifier' }"
              >
                <h5>
                  {{ modifier.heading }}
                  <SemanticBadge v-if="modifier.kind === 'visual-modifier'" tone="fx" compact>FX change</SemanticBadge>
                </h5>
                <p v-for="(line, index) in modifier.lines" :key="`${line.label}:${index}`">
                  {{ formatPresentationLine(line) }}
                </p>
              </div>
              <div v-if="tier.grantedSkill" class="set-tier-group skill-bonus">
                <h5>{{ tier.grantedSkill.name }}</h5>
                <p v-if="tier.grantedSkill.trigger">{{ tier.grantedSkill.trigger }}</p>
                <p v-if="tier.grantedSkill.description">{{ tier.grantedSkill.description }}</p>
                <p v-for="(line, index) in tier.grantedSkill.lines" :key="`${line.label}:${index}`">
                  {{ formatPresentationLine(line) }}
                </p>
                <div
                  v-for="linked in tier.grantedSkill.linkedSkills ?? []"
                  :key="linked.name"
                  class="linked-granted-skill"
                >
                  <h6>{{ linked.name }}</h6>
                  <p v-if="linked.description">{{ linked.description }}</p>
                  <p v-for="(line, index) in linked.lines" :key="`${linked.name}:${line.label}:${index}`">
                    {{ formatPresentationLine(line) }}
                  </p>
                </div>
              </div>
            </section>
          </div>
          </article>
        </template>
      </BoundedResultSurface>
</template>
