import assert from 'node:assert/strict'
import {
  setCompletionCount,
  setItemBadges,
  setItemDiscovered,
  setItemUnqualified,
  setRarity,
  setReadiness
} from '../src/renderer/src/set-semantics.ts'

let itemSequence = 0
function item(overrides = {}) {
  itemSequence += 1
  return {
    record: overrides.record ?? `records/items/synthetic/${itemSequence}.dbr`,
    name: overrides.name ?? 'Synthetic set piece',
    rarity: 'epic',
    itemClass: 'armor_head',
    slot: 'head',
    levelRequirement: 50,
    itemLevel: 50,
    setName: 'Synthetic Set',
    setRecord: 'records/items/synthetic/set.dbr',
    bitmap: null,
    contentPack: 'Synthetic QA',
    availableCount: 0,
    bestRollPercentile: null,
    analyzedCopyCount: 0,
    pinnedInstanceKey: null,
    discovered: false,
    recipeUnlocked: false,
    ...overrides
  }
}

const stored = item({ availableCount: 2, discovered: true })
const historical = item({ discovered: true })
const recipe = item({ recipeUnlocked: true })
const awakening = item({
  rarity: 'legendary',
  availableViaAwakening: true,
  awakeningSourceAvailableCount: 1,
  awakeningSourceName: 'Synthetic Epic base'
})
const missing = item()

assert.equal(setCompletionCount([stored, historical, recipe, awakening]), 2,
  'Recipes and awakening qualifications must not inflate discovered completion')
assert(setItemDiscovered(stored))
assert(setItemDiscovered(historical))
assert(!setItemDiscovered(recipe))
assert(!setItemDiscovered(awakening))
assert(setItemUnqualified(missing))
assert(!setItemUnqualified(recipe))
assert(!setItemUnqualified(awakening))

assert.equal(setRarity([stored, recipe]), 'epic')
assert.equal(setRarity([stored, awakening]), 'legendary')
assert.deepEqual(setReadiness([stored]), {
  kind: 'stored', label: 'Ready from storage', tone: 'owned', unqualifiedCount: 0
})
assert.equal(setReadiness([stored, recipe]).kind, 'crafting')
assert.equal(setReadiness([stored, awakening]).kind, 'awakening')
assert.equal(setReadiness([recipe, awakening]).kind, 'mixed')
assert.deepEqual(setReadiness([stored, missing]), {
  kind: 'missing', label: '1 unqualified piece', tone: 'missing', unqualifiedCount: 1
})

assert.deepEqual(setItemBadges(recipe).map(({ label, tone }) => ({ label, tone })), [
  { label: 'Recipe', tone: 'crafting' }
])
assert.deepEqual(setItemBadges(awakening).map(({ label, tone }) => ({ label, tone })), [
  { label: 'Awaken base', tone: 'awakening' }
])
assert.deepEqual(setItemBadges(missing).map(({ label, tone }) => ({ label, tone })), [
  { label: 'Missing', tone: 'missing' }
])

console.log(JSON.stringify({
  passed: true,
  completionExcludesQualifications: true,
  readinessKinds: ['stored', 'crafting', 'awakening', 'mixed', 'missing'],
  explicitQualificationBadges: true,
  rarityTokens: ['epic', 'legendary']
}, null, 2))
