import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileSearchQuery } from '../src/shared/search-query.ts'
import {
  buildReusableSupplySummary,
  changeSupplyCategory,
  createSupplyAccessSummary,
  createSupplyOptions,
  updateSupplyControls
} from '../src/renderer/src/workspaces/supplies.ts'

const controls = {
  category: 'writs',
  slot: 'all',
  query: '',
  mode: 'live',
  page: 3
}

assert.deepEqual(updateSupplyControls(controls, { query: 'vitality' }, true), {
  ...controls,
  query: 'vitality',
  page: 1
})
assert.deepEqual(updateSupplyControls(controls, { mode: 'offline' }, false), {
  ...controls,
  mode: 'offline'
})
assert.deepEqual(changeSupplyCategory({ ...controls, slot: 'weapon' }, 'augments'), {
  ...controls,
  category: 'augments',
  slot: 'all',
  page: 1
})

function line(label, minimum, unit = '%') {
  return { label, minimum, maximum: null, unit, prefix: '', suffix: '', tone: 'default' }
}

function catalogItem(overrides = {}) {
  return {
    record: 'records/items/supplies/test.dbr',
    name: 'Test supply',
    rarity: 'supply',
    slot: 'writ',
    levelRequirement: 1,
    discovered: false,
    availableCount: 0,
    presentation: { sections: [] },
    ...overrides
  }
}

function vaultItem(overrides = {}) {
  return {
    id: 'supply-a',
    baseRecord: 'records/items/supplies/test.dbr',
    name: 'Test supply',
    rarity: 'supply',
    slot: 'writ',
    levelRequirement: 1,
    itemLevel: 1,
    catalogued: true,
    reusable: true,
    isHardcore: false,
    state: 'ingested',
    seed: 1,
    stackCount: 1,
    prefixRecord: '',
    suffixRecord: '',
    componentRecord: '',
    augmentRecord: '',
    ascendant: false,
    instanceKey: 'supply-instance-a',
    rollAnalysis: null,
    ingestedAtUtc: '2026-09-01T12:00:00.000Z',
    retrievedAtUtc: null,
    ...overrides
  }
}

const writ = catalogItem()
const rune = catalogItem({
  record: 'records/items/supplies/rune.dbr',
  name: 'Rune of Motion',
  slot: 'rune',
  supplySlotFamilies: ['weapon']
})
const augment = catalogItem({
  record: 'records/items/supplies/augment.dbr',
  name: 'Vitality Ward',
  slot: 'augment',
  supplySlotFamilies: ['jewelry'],
  acquisition: {
    factions: [{ kind: 'vendor', faction: "Devil's Crossing", reputation: 'Revered' }]
  },
  presentation: {
    sections: [{ kind: 'base', heading: null, lines: [line('Vitality Damage', 75)] }]
  }
})
const catalogItems = [writ, rune, augment, { ...writ }]
const vaultItems = [
  vaultItem(),
  vaultItem({ id: 'supply-duplicate', instanceKey: 'supply-instance-b' }),
  vaultItem({ id: 'supply-hc', isHardcore: true, instanceKey: 'supply-instance-hc' }),
  vaultItem({ id: 'potion-a', slot: 'potion', reusable: false, stackCount: 20, instanceKey: 'potion-a' }),
  vaultItem({ id: 'potion-b', slot: 'potion', reusable: false, stackCount: 10, instanceKey: 'potion-b' }),
  vaultItem({
    id: 'rune-a',
    baseRecord: rune.record,
    name: rune.name,
    slot: 'rune',
    instanceKey: 'rune-a'
  }),
  vaultItem({ id: 'retrieved', state: 'retrieved', instanceKey: 'retrieved' })
]

assert.deepEqual(buildReusableSupplySummary(catalogItems, vaultItems), {
  rarity: 'supply',
  total: 2,
  collected: 2,
  availableCopies: 2
})

const baseOptions = {
  catalogItems,
  vaultItems,
  controls,
  activeCharacter: null,
  activeTransferHardcore: false,
  liveReady: true,
  query: compileSearchQuery('')
}
const boosts = createSupplyOptions(baseOptions)
assert.deepEqual(boosts.map((item) => item.id), ['potion-a', 'potion-b', 'supply-a', 'supply-hc'])
assert.equal(boosts.find((item) => item.id === 'supply-a')?.eligible, true)
assert.equal(boosts.find((item) => item.id === 'supply-hc')?.eligible, false)
assert.match(boosts.find((item) => item.id === 'potion-a')?.detail ?? '', /20 stored/)

const activeCharacter = {
  name: 'Avaa',
  isHardcore: false,
  factions: [{ name: 'Devils Crossing', value: 25_000, isUnlocked: true }]
}
assert.equal(createSupplyAccessSummary(catalogItems, activeCharacter), '1 augments available to Avaa')
assert.equal(createSupplyAccessSummary(catalogItems, null), '1 augments indexed · connect a character to check access')

const augmentOptions = createSupplyOptions({
  ...baseOptions,
  activeCharacter,
  controls: { ...controls, category: 'augments', slot: 'all' }
})
assert.deepEqual(augmentOptions.map((item) => item.id).sort(), [`augment:${augment.record}`, 'rune-a'].sort())
const eligibleAugment = augmentOptions.find((item) => item.id.startsWith('augment:'))
const archivedRune = augmentOptions.find((item) => item.id === 'rune-a')
assert.equal(eligibleAugment?.eligible, true)
assert.deepEqual(eligibleAugment?.effects, ['75% Vitality Damage'])
assert.match(eligibleAugment?.detail ?? '', /Available to Avaa/)
assert.doesNotMatch(archivedRune?.detail ?? '', /stored/)

const jewelryOnly = createSupplyOptions({
  ...baseOptions,
  activeCharacter,
  controls: { ...controls, category: 'augments', slot: 'jewelry' }
})
assert.deepEqual(jewelryOnly.map((item) => item.id), [`augment:${augment.record}`])

const effectSearch = createSupplyOptions({
  ...baseOptions,
  activeCharacter,
  controls: { ...controls, category: 'augments', query: 'vitality' },
  query: compileSearchQuery('vitality')
})
assert.deepEqual(effectSearch.map((item) => item.id), [`augment:${augment.record}`])

const lockedAugment = createSupplyOptions({
  ...baseOptions,
  activeCharacter: { ...activeCharacter, factions: [{ name: "Devil's Crossing", value: 24_999, isUnlocked: true }] },
  controls: { ...controls, category: 'augments' }
}).find((item) => item.id.startsWith('augment:'))
assert.equal(lockedAugment?.eligible, false)

const [app, workspace] = await Promise.all([
  readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/SuppliesWorkspace.vue', import.meta.url), 'utf8')
])

assert.match(app, /<SuppliesWorkspace[\s\S]*?v-else-if="activeView === 'supplies'"/)
assert.match(app, /const supplyControls = ref<SupplyControls>/)
assert.match(app, /const supplySession = createSupplySession\(\)/)
assert.match(app, /v-model:controls="supplyControls"/)
assert.match(app, /watch\(transferMode, \(\) => \{[\s\S]*?supplyControls\.value\.mode !== transferMode\.value[\s\S]*?if \(restoringAppHistory\) return/)
assert.doesNotMatch(app, /selectedSupplyIds|supplyVaultItems|visibleSupplyVaultItems|supplyStructuredQuery/)
assert.match(workspace, /defineModel<SupplyControls>\('controls'/)
assert.match(workspace, /<ToolHeader[\s\S]*?<ExplorerToolbar[\s\S]*?<BoundedResultSurface/)
assert.match(workspace, /:page-size="60"/)
assert.match(workspace, /function showFocusedTooltip[\s\S]*?emit\('queue-tooltip', item\.catalogItem, element\)/)
assert.match(workspace, /@item-focus="showFocusedTooltip"/)
assert.doesNotMatch(workspace, /show-tooltip/)
assert.doesNotMatch(workspace, /window\.cairnCodex/)
assert.doesNotMatch(workspace, /createSupplyOptions|vaultItems/)
assert.doesNotMatch(app, /refreshFullVaultItems|cairnCodex\.listVaultItems\(/)
assert.match(workspace, /:remote="true"/)

console.log('Supplies workspace passed: reusable-unlock counting, archived-copy identity, faction access, structured search, slot filtering, typed control ownership, delayed global tooltips, and a bounded 60-card result surface.')
