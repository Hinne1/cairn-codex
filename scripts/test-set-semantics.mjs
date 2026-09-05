import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  compareSetCompletion,
  setCompletionCount,
  setItemBadges,
  setItemDiscovered,
  setItemUnqualified,
  setRarity,
  setReadiness,
  setRollRating
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

const incompleteHighDiscovery = [
  item({ discovered: true }),
  item({ discovered: true }),
  item({ discovered: true }),
  missing
]
const readyAfterCrafting = [stored, recipe, item({ recipeUnlocked: true }), item({ recipeUnlocked: true })]
assert(compareSetCompletion(readyAfterCrafting, incompleteHighDiscovery) > 0,
  'A qualified ready-after-crafting set must rank ahead of a more-discovered incomplete set')
assert(compareSetCompletion([stored], readyAfterCrafting) > 0,
  'A set that is ready from storage must rank ahead of a set that still needs crafting')
const mixedQualified = [
  item({ discovered: true, recipeUnlocked: true }),
  item({ availableViaAwakening: true, awakeningSourceAvailableCount: 1 })
]
const craftingQualified = [item({ recipeUnlocked: true }), item({ recipeUnlocked: true })]
assert(compareSetCompletion(mixedQualified, craftingQualified) > 0,
  'Qualification mechanism must not outrank discovered completion within the ready band')
assert.equal(
  Math.sign(compareSetCompletion(readyAfterCrafting, incompleteHighDiscovery)),
  -Math.sign(compareSetCompletion(incompleteHighDiscovery, readyAfterCrafting)),
  'Completion comparison must remain deterministic in either direction'
)

assert.deepEqual(
  setRollRating([
    item({ availableCount: 1, bestRollPercentile: 72.5, analyzedCopyCount: 1 }),
    item({ availableCount: 2, bestRollPercentile: 87.5, analyzedCopyCount: 2 }),
    item({ availableCount: 1 }),
    item({ availableCount: 1, bestRollPercentile: 99, analyzedCopyCount: 0 }),
    item({ bestRollPercentile: 99 })
  ]),
  { average: 80, ratedPieces: 2, availablePieces: 4 }
)
assert.deepEqual(setRollRating([historical, recipe]), {
  average: null, ratedPieces: 0, availablePieces: 0
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
const appSource = readFileSync(new URL('../src/renderer/src/workspaces/SetsWorkspace.vue', import.meta.url), 'utf8')
const styleSource = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8')
assert.match(appSource, /class="set-roll-rating"/,
  'Every set card must render its aggregate roll-rating state')
assert.match(appSource, /set\.rollRating\.ratedPieces.*set\.rollRating\.availablePieces/s,
  'Set cards must disclose rated and physically available piece counts')
assert.match(styleSource, /\.set-roll-rating\.unavailable/,
  'The no-analyzed-roll state must remain visually distinct')
const rollStatusTokens = [
  styleSource.match(/\.set-roll-rating small\s*{[^}]*color:\s*var\((--[\w-]+)\)/s)?.[1],
  styleSource.match(/\.set-roll-rating\.unavailable\s*{[^}]*color:\s*var\((--[\w-]+)\)/s)?.[1]
]
assert(rollStatusTokens.every(Boolean), 'Set roll coverage and unavailable states must use semantic color tokens')
const semanticColors = [...tokenSource.matchAll(/--(?:gd-rarity|semantic)-[\w-]+:\s*(#[0-9a-f]{6})/gi)]
  .map((match) => ({ name: match[0].slice(2, match[0].indexOf(':')), color: match[1] }))
assert(semanticColors.length >= 10, 'Expected every semantic tone to expose a hex token')
const tokenByName = new Map(semanticColors.map(({ name, color }) => [name, color]))
const rarityCardBackgrounds = ['gd-rarity-epic', 'gd-rarity-legendary'].map((name) =>
  compositeHex(tokenByName.get(name), '#2a2720', 0.09)
)
for (const token of rollStatusTokens) {
  const color = tokenSource.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]
  assert(color, `${token} must resolve to a fallback color`)
  for (const background of rarityCardBackgrounds) {
    assert(contrastRatio(color, background) >= 4.5,
      `${token} ${color} must meet 4.5:1 contrast against set-card background ${background}`)
  }
}
for (const { name, color: foreground } of semanticColors) {
  // The first set-card gradient stop mixes 9% rarity color into its base
  // before SemanticBadge adds its own 12% tint. Every badge tone can appear
  // on either rarity card, so test the full foreground/background cross-product.
  const backgrounds = ['#11110f', '#2d252a', ...rarityCardBackgrounds]
  for (const background of backgrounds) {
    const rarityBadge = name.startsWith('gd-rarity-')
    const badgeSurface = rarityBadge
      ? tokenSource.match(/--cc-surface-1:\s*(#[0-9a-f]{6})/i)[1]
      : compositeHex(foreground, background, 0.12)
    assert(contrastRatio(foreground, badgeSurface) >= 4.5,
      `${name} ${foreground} must meet 4.5:1 contrast against its ${badgeSurface} composited badge surface`)
  }
}

const badgeSource = readFileSync(new URL('../src/renderer/src/components/SemanticBadge.vue', import.meta.url), 'utf8')
assert.match(badgeSource, /\.tone-legendary, \.tone-epic\s*\{\s*--badge-surface: var\(--cc-surface-1\);/,
  'Game-reference rarity hues require a solid contrast-checked badge background')

function compositeHex(foreground, background, alpha) {
  const foregroundChannels = hexChannels(foreground)
  const backgroundChannels = hexChannels(background)
  const channels = foregroundChannels.map((value, index) =>
    Math.round(value * alpha + backgroundChannels[index] * (1 - alpha))
  )
  return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function contrastRatio(foreground, background) {
  const [bright, dark] = [relativeLuminance(foreground), relativeLuminance(background)]
    .sort((left, right) => right - left)
  return (bright + 0.05) / (dark + 0.05)
}

function relativeLuminance(hex) {
  const [red, green, blue] = hexChannels(hex).map((value) =>
    value / 255
  ).map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  )
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function hexChannels(hex) {
  return hex.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16))
}

console.log(JSON.stringify({
  passed: true,
  completionExcludesQualifications: true,
  archiveRecipeProjectionPreservesDiscovery: true,
  readinessKinds: ['stored', 'crafting', 'awakening', 'mixed', 'missing'],
  readinessSortsBeforeIncompleteSets: true,
  averageRollRating: true,
  explicitQualificationBadges: true,
  rarityTokens: ['epic', 'legendary'],
  semanticContrast: '>=4.5:1'
}, null, 2))
