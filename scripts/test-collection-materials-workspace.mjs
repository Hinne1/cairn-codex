import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { computed, ref } from 'vue'
import { compileSearchQuery } from '../src/shared/search-query.ts'
import {
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
const options = (mode, query = '') => ({
  mode, query: compileSearchQuery(query), searchDocument: document,
  doubleRareMiBaseRecords: new Set(['records/items/double-rare.dbr'])
})

assert.deepEqual(updateCollectionMaterialsControls(baseControls, { query: 'helm' }), { ...baseControls, query: 'helm', page: 1 })
assert.deepEqual(updateCollectionMaterialsControls(baseControls, { page: 5 }, false), { ...baseControls, page: 5 })
assert.equal(collectionCategories.length, 12)
assert.equal(matchesCollectionCategory(item(), 'Head'), true)
assert.equal(matchesCollectionCategory(item(), 'Weapons'), false)

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

const reactiveControls = ref({ ...baseControls })
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
assert.match(model, /options\.mode === 'materials'/)
assert.match(model, /doubleRareMiBaseRecords/)

console.log(`Collection/materials workspace checks passed. 50k projection: ${projectionMs.toFixed(1)} ms.`)
