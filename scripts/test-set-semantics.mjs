import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  setCompletionCount,
  setItemBadges,
  setItemDiscovered,
  setItemUnqualified,
  setRarity,
  setReadiness
} from '../src/renderer/src/set-semantics.ts'
import { withRecipeAvailability } from '../src/shared/recipe-availability.ts'

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
const projectedRecipe = withRecipeAvailability(item({
  acquisition: {
    sources: [],
    crafting: { blueprintRecords: ['records/items/synthetic/recipe.dbr'], knownSoftcore: true, knownHardcore: false }
  }
}), false)

assert.equal(setCompletionCount([stored, historical, recipe, awakening]), 2,
  'Recipes and awakening qualifications must not inflate discovered completion')
assert(setItemDiscovered(stored))
assert(setItemDiscovered(historical))
assert(!setItemDiscovered(recipe))
assert(!setItemDiscovered(awakening))
assert(projectedRecipe.recipeUnlocked)
assert.equal(projectedRecipe.discovered, false,
  'Archive recipe projection must preserve discovered state')
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

const tokenSource = readFileSync(new URL('../src/renderer/src/semantic-tokens.css', import.meta.url), 'utf8')
const semanticColors = [...tokenSource.matchAll(/--(?:gd-rarity|semantic)-[\w-]+:\s*(#[0-9a-f]{6})/gi)]
  .map((match) => match[1])
assert(semanticColors.length >= 10, 'Expected every semantic tone to expose a hex token')
for (const foreground of semanticColors) {
  for (const background of ['#11110f', '#2d252a']) {
    assert(contrastRatio(foreground, background) >= 4.5,
      `${foreground} must meet 4.5:1 contrast against ${background}`)
  }
}

function contrastRatio(foreground, background) {
  const [bright, dark] = [relativeLuminance(foreground), relativeLuminance(background)]
    .sort((left, right) => right - left)
  return (bright + 0.05) / (dark + 0.05)
}

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16) / 255)
  const [red, green, blue] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  )
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

console.log(JSON.stringify({
  passed: true,
  completionExcludesQualifications: true,
  archiveRecipeProjectionPreservesDiscovery: true,
  readinessKinds: ['stored', 'crafting', 'awakening', 'mixed', 'missing'],
  explicitQualificationBadges: true,
  rarityTokens: ['epic', 'legendary'],
  semanticContrast: '>=4.5:1'
}, null, 2))
