import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { computed, ref } from 'vue'
import { compileSearchQuery } from '../src/shared/search-query.ts'
import {
  buildCollectionRollSummaries,
  collectionRollFocusForSort,
  collectionCategories,
  createCollectionMaterialsProjectionControls,
  createCollectionMaterialsQueryDebouncer,
  createCollectionMaterialsRows,
  matchesCollectionCategory,
  updateCollectionMaterialsControls
} from '../src/renderer/src/workspaces/collection-materials.ts'

const baseControls = {
  category: 'All', query: '', ownership: 'all', rarity: 'all', sort: 'recent', direction: 'desc', page: 4
}

function item(overrides = {}) {
  return {
    record: 'records/items/test.dbr', name: 'Test Item', rarity: 'epic', slot: 'head',
    levelRequirement: 50, itemLevel: 50, discovered: false, availableCount: 0,
    recipeUnlocked: false, firstDiscoveredAt: null, bestRollPercentile: null,
    presentation: { sections: [] }, ...overrides
  }
}

const document = (candidate) => ({
  text: `${candidate.name} ${candidate.rarity} ${candidate.slot}`,
  fields: { name: candidate.name, rarity: candidate.rarity, slot: candidate.slot, owned: candidate.availableCount > 0 }
})
const options = (mode, query = '', rollSummaries) => ({
  mode, query: compileSearchQuery(query), searchDocument: document,
  doubleRareMiBaseRecords: new Set(['records/items/double-rare.dbr']),
  rollSummaries
})

assert.deepEqual(updateCollectionMaterialsControls(baseControls, { query: 'helm' }), { ...baseControls, query: 'helm', page: 1 })
assert.deepEqual(updateCollectionMaterialsControls(baseControls, { page: 5 }, false), { ...baseControls, page: 5 })
assert.equal(collectionCategories.length, 12)
assert.equal(matchesCollectionCategory(item(), 'Head'), true)
assert.equal(matchesCollectionCategory(item(), 'Weapons'), false)
assert.equal(collectionRollFocusForSort('recent'), null)
assert.equal(collectionRollFocusForSort('roll-fire'), 'fire')
assert.equal(collectionRollFocusForSort('roll-retaliation'), 'retaliation')

const rollCopies = [
  {
    baseRecord: 'records/items/roll-a.dbr', instanceKey: 'roll-a-1',
    rollAnalysis: { trusted: true, categoryScores: [
      { key: 'offense:fire', category: 'offense', damageType: 'fire', qualityPercent: 70, estimatedPercentile: 70, combinationPercentile: 92, statCount: 3 },
      { key: 'retaliation', category: 'retaliation', damageType: null, qualityPercent: 91, estimatedPercentile: 91, combinationPercentile: 97, statCount: 2 },
      { key: 'defense', category: 'defense', damageType: null, qualityPercent: 84, estimatedPercentile: 84, combinationPercentile: 96, statCount: 2 }
    ] }
  },
  {
    baseRecord: 'records/items/roll-a.dbr', instanceKey: 'roll-a-2',
    rollAnalysis: { trusted: true, categoryScores: [
      { key: 'offense:fire', category: 'offense', damageType: 'fire', qualityPercent: 88, estimatedPercentile: 88, combinationPercentile: 98, statCount: 3 }
    ] }
  },
  {
    baseRecord: 'records/items/roll-b.dbr', instanceKey: 'roll-b-1',
    rollAnalysis: { trusted: true, categoryScores: [
      { key: 'offense:fire', category: 'offense', damageType: 'fire', qualityPercent: 81, estimatedPercentile: 81, combinationPercentile: 99, statCount: 3 }
    ] }
  }
]
const fireRollSummaries = buildCollectionRollSummaries(rollCopies, 'fire')
const conflictingScores = structuredClone(rollCopies)
conflictingScores[0].rollAnalysis.categoryScores[0].qualityPercent = 100
assert.equal(buildCollectionRollSummaries(conflictingScores, 'fire').get('records/items/roll-a.dbr').copy.instanceKey, 'roll-a-1',
  'range quality must choose the leader even when the marginal percentile favors another copy')
assert.equal(buildCollectionRollSummaries([{ ...rollCopies[0], rollAnalysis: { trusted: true, categoryScores: [{ key: 'offense:fire', category: 'offense', damageType: 'fire', estimatedPercentile: 99 }] } }], 'fire').size, 0,
  'pre-v9 category caches must await recalculation')
assert.equal(fireRollSummaries.get('records/items/roll-a.dbr')?.score.estimatedPercentile, 88)
assert.equal(buildCollectionRollSummaries(rollCopies, 'retaliation').get('records/items/roll-a.dbr')?.score.estimatedPercentile, 91)
assert.equal(buildCollectionRollSummaries(rollCopies, null).get('records/items/roll-a.dbr')?.score.key, 'retaliation')

const committedQueries = []
const queryDebouncer = createCollectionMaterialsQueryDebouncer((value) => committedQueries.push(value), 15)
queryDebouncer.update('b')
queryDebouncer.update('bl')
queryDebouncer.update('blood')
assert.deepEqual(committedQueries, [], 'rapid edits must not synchronously run the catalog projection')
await new Promise((resolve) => setTimeout(resolve, 30))
assert.deepEqual(committedQueries, ['blood'], 'rapid edits must coalesce into one projected query')
queryDebouncer.update('canceled')
queryDebouncer.cancel()
await new Promise((resolve) => setTimeout(resolve, 30))
assert.deepEqual(committedQueries, ['blood'], 'unmount cancellation must prevent a stale projection')

const catalog = [
  item({ record: 'records/items/owned.dbr', name: 'Owned Helm', availableCount: 2, discovered: true, firstDiscoveredAt: '2026-01-01T00:00:00Z', bestRollPercentile: 45 }),
  item({ record: 'records/items/missing.dbr', name: 'Missing Helm', rarity: 'legendary', levelRequirement: 94 }),
  item({ record: 'records/items/double-rare.dbr', name: 'Double Rare Medal', rarity: 'mi', slot: 'medal', availableCount: 1, discovered: true }),
  item({ record: 'records/items/not-double-rare.dbr', name: 'Ordinary MI Medal', rarity: 'mi', slot: 'medal', availableCount: 1, discovered: true }),
  item({ record: 'records/items/recipe.dbr', name: 'Crafted Blade', slot: 'weapon', acquisition: { crafting: { blacksmith: 'Test' } } })
]

const rollCatalog = [
  item({ record: 'records/items/roll-a.dbr', name: 'Roll A', availableCount: 2, discovered: true }),
  item({ record: 'records/items/roll-b.dbr', name: 'Roll B', availableCount: 1, discovered: true }),
  item({ record: 'records/items/roll-unscored.dbr', name: 'Roll Unscored', availableCount: 1, discovered: true }),
  item({ record: 'records/items/roll-missing.dbr', name: 'Roll Missing', availableCount: 0 })
]
assert.deepEqual(
  createCollectionMaterialsRows(
    rollCatalog,
    { ...baseControls, sort: 'roll-fire', direction: 'desc' },
    options('collection', '', fireRollSummaries)
  ).map((entry) => entry.name),
  ['Roll A', 'Roll B', 'Roll Unscored', 'Roll Missing']
)

const reactiveControls = ref({ ...baseControls })
for (const direction of ['asc', 'desc']) {
  const rows = createCollectionMaterialsRows(
    rollCatalog, { ...baseControls, sort: 'roll-fire', direction }, options('collection', '', fireRollSummaries)
  )
  assert.deepEqual(rows.map((entry) => entry.name), [
    ...(direction === 'asc' ? ['Roll B', 'Roll A'] : ['Roll A', 'Roll B']),
    'Roll Unscored', 'Roll Missing'
  ], 'missing category scores must stay last, with owned unscored copies before missing items')
  const zeroScores = new Map(fireRollSummaries)
  zeroScores.set('records/items/roll-b.dbr', {
    ...zeroScores.get('records/items/roll-b.dbr'), score: { qualityPercent: 0, estimatedPercentile: 0, combinationPercentile: 0 }
  })
  const zeroRows = createCollectionMaterialsRows(
    rollCatalog, { ...baseControls, sort: 'roll-fire', direction, ownership: 'owned' }, options('collection', '', zeroScores)
  )
  assert.deepEqual(zeroRows.map((entry) => entry.name), [
    ...(direction === 'asc' ? ['Roll B', 'Roll A'] : ['Roll A', 'Roll B']), 'Roll Unscored'
  ], 'a genuine zero is rated, not unavailable')
}
const projectedQuery = ref(baseControls.query)
const reactiveProjectionControls = createCollectionMaterialsProjectionControls(reactiveControls, projectedQuery)
let reactiveProjectionExecutions = 0
const reactiveRows = computed(() => {
  reactiveProjectionExecutions += 1
  return createCollectionMaterialsRows(
    catalog,
    reactiveProjectionControls.value,
    options('collection', reactiveProjectionControls.value.query)
  )
})
const initialProjectionControls = reactiveProjectionControls.value
const initialReactiveRows = reactiveRows.value
reactiveControls.value = updateCollectionMaterialsControls(reactiveControls.value, { query: 'b' })
reactiveControls.value = updateCollectionMaterialsControls(reactiveControls.value, { query: 'bl' })
reactiveControls.value = updateCollectionMaterialsControls(reactiveControls.value, { query: 'blood' })
assert.strictEqual(reactiveProjectionControls.value, initialProjectionControls)
assert.strictEqual(reactiveRows.value, initialReactiveRows)
assert.equal(reactiveProjectionExecutions, 1, 'raw query replacements must not rerun the catalog projection')
projectedQuery.value = 'blood'
assert.notStrictEqual(reactiveProjectionControls.value, initialProjectionControls)
assert.equal(reactiveRows.value.length, 0)
assert.equal(reactiveProjectionExecutions, 2, 'a debounced query commit must rerun the catalog projection once')
const queryProjectionControls = reactiveProjectionControls.value
const queryReactiveRows = reactiveRows.value
reactiveControls.value = updateCollectionMaterialsControls(reactiveControls.value, { page: 4 }, false)
assert.strictEqual(reactiveProjectionControls.value, queryProjectionControls)
assert.strictEqual(reactiveRows.value, queryReactiveRows)
assert.equal(reactiveProjectionExecutions, 2, 'page-only navigation must not rerun the catalog projection')
reactiveControls.value = updateCollectionMaterialsControls(reactiveControls.value, { ownership: 'owned' })
assert.notStrictEqual(reactiveProjectionControls.value, queryProjectionControls)
void reactiveRows.value
assert.equal(reactiveProjectionExecutions, 3, 'a real projection filter change must rerun the catalog projection')

assert.deepEqual(
  createCollectionMaterialsRows(catalog, { ...baseControls, category: 'Head', sort: 'name', direction: 'asc' }, options('collection')).map((entry) => entry.name),
  ['Missing Helm', 'Owned Helm']
)
assert.deepEqual(
  createCollectionMaterialsRows(catalog, { ...baseControls, rarity: 'double-rare' }, options('collection')).map((entry) => entry.name),
  ['Double Rare Medal']
)
assert.deepEqual(
  createCollectionMaterialsRows(catalog, { ...baseControls, rarity: 'recipe' }, options('collection')).map((entry) => entry.name),
  ['Crafted Blade']
)
assert.deepEqual(
  createCollectionMaterialsRows(catalog, { ...baseControls, ownership: 'missing', sort: 'name', direction: 'asc' }, options('collection')).map((entry) => entry.name),
  ['Crafted Blade', 'Missing Helm']
)
assert.deepEqual(
  createCollectionMaterialsRows(catalog, { ...baseControls, query: 'name:"owned helm"' }, options('collection', 'name:"owned helm"')).map((entry) => entry.name),
  ['Owned Helm']
)

const materials = [
  item({ record: 'component', name: 'Ancient Armor Plate', rarity: 'component', slot: 'component', availableCount: 10 }),
  item({ record: 'material', name: 'Dynamite', rarity: 'consumable', slot: 'material', availableCount: 3 }),
  item({ record: 'formula', name: 'Potion Formula', rarity: 'consumable', slot: 'potion-formula', recipeUnlocked: true })
]
assert.deepEqual(
  createCollectionMaterialsRows(materials, { ...baseControls, category: 'component' }, options('materials')).map((entry) => entry.name),
  ['Ancient Armor Plate']
)
assert.deepEqual(
  createCollectionMaterialsRows(materials, { ...baseControls, category: 'potion-formula' }, options('materials')).map((entry) => entry.name),
  ['Potion Formula']
)

const largeCatalog = Array.from({ length: 50_000 }, (_, index) => item({
  record: `records/items/large-${index}.dbr`, name: `Catalog Item ${String(index).padStart(5, '0')}`,
  levelRequirement: index % 100, availableCount: index % 3 === 0 ? 1 : 0, discovered: index % 3 === 0
}))
const started = performance.now()
const largeRows = createCollectionMaterialsRows(largeCatalog, { ...baseControls, sort: 'level' }, options('collection'))
const projectionMs = performance.now() - started
assert.equal(largeRows.length, 50_000)
assert.equal(largeRows[0].levelRequirement >= largeRows.at(-1).levelRequirement, true)
assert.ok(projectionMs < 500, `50k catalog projection exceeded 500 ms: ${projectionMs.toFixed(1)} ms`)

const [app, workspace, model] = await Promise.all([
  readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/CollectionMaterialsWorkspace.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/collection-materials.ts', import.meta.url), 'utf8')
])
assert.match(app, /const collectionControls = ref<CollectionControls>/)
assert.match(app, /const materialsControls = ref<MaterialsControls>/)
assert.match(app, /<CollectionMaterialsWorkspace[\s\S]*?v-model:controls="activeCollectionMaterialsControls"/)
assert.match(app, /case 'collection':[\s\S]*?collectionControls\.value = \{ \.\.\.route\.controls \}/)
assert.match(app, /case 'materials':[\s\S]*?materialsControls\.value = \{ \.\.\.route\.controls \}/)
assert.doesNotMatch(app, /const filteredItems = computed/)
assert.doesNotMatch(app, /const collectionSearchQuery = computed/)
assert.match(workspace, /defineModel<CollectionMaterialsControls>\('controls'/)
assert.match(workspace, /createCollectionMaterialsQueryDebouncer[\s\S]*?onBeforeUnmount\(queryDebouncer\.cancel\)/)
assert.match(workspace, /createCollectionMaterialsProjectionControls\(controls, projectionQuery\)[\s\S]*?projectionControls\.value/)
assert.match(workspace, /<ExplorerToolbar[\s\S]*?<BoundedResultSurface/)
assert.match(workspace, /:page-size="48"/)
assert.match(workspace, /rarity === 'double-rare'|value="double-rare"/)
assert.match(workspace, /collectionRollSortOptions/)
assert.match(workspace, /rollSummaries: props\.rollSummaries/)
assert.match(workspace, /value\.startsWith\('roll-'\)[\s\S]*?ownership: 'owned'/)
assert.match(workspace, /watch\(\[\(\) => props\.mode, sort\][\s\S]*?ownership\.value = 'owned'[\s\S]*?immediate: true/)
assert.match(workspace, /formatCategoryScore\(rollSummary\(item\)!\.score\)/)
assert.match(workspace, /rollSummary\(item\)\?\.copy\.instanceKey/)
assert.doesNotMatch(workspace, /item\.bestRollPercentile/)
assert.match(model, /options\.mode === 'materials'/)
assert.match(model, /doubleRareMiBaseRecords/)
assert.match(model, /buildCollectionRollSummaries/)
assert.match(model, /controls\.sort\.startsWith\('roll-'\)/)

console.log(`Collection/materials workspace checks passed. 50k projection: ${projectionMs.toFixed(1)} ms.`)
