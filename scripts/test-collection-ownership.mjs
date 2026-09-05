import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { effectScope, nextTick, ref, shallowRef } from 'vue'
import { createScreenshotCollectionFixture } from '../src/verification/fixtures.ts'
import { createCollectionDashboard, medianSummary, percentage } from '../src/renderer/src/workspaces/collection-dashboard.ts'
import { buildCollectionSets, createSetsSession, setReadyFromStorage, setReadyAfterCrafting, setReadyWithQualifiedAvailability } from '../src/renderer/src/workspaces/sets.ts'
import { useCollectionCopies } from '../src/renderer/src/collection-copies.ts'
import { createComparisonProjection, copyAffixDelta } from '../src/renderer/src/inspection/inspection-presentation.ts'
import { inspectionCopyKey } from '../src/renderer/src/inspection/item-inspection.ts'
import { createBoundedResultWindow } from '../src/renderer/src/bounded-results.ts'

// Owners may depend on shared contracts and renderer presentation, never on the shell
// or privileged process implementations. Effects enter through explicit typed ports.
const ownerPaths = [
  'collection-copies.ts', 'item-presentation.ts',
  'inspection/item-inspection.ts', 'inspection/inspection-presentation.ts',
  'inspection/ItemInspectionDrawer.vue', 'workspaces/sets.ts',
  'workspaces/SetsWorkspace.vue', 'workspaces/collection-dashboard.ts',
  'workspaces/CollectionDashboard.vue', 'workspaces/CollectionTriviaDialog.vue'
]
for (const path of ownerPaths) {
  const source = await readFile(new URL('../src/renderer/src/' + path, import.meta.url), 'utf8')
  assert.doesNotMatch(source, /(?:from\s*|import\s*\()['"][^'"]*(?:App\.vue|\/main\/|\/preload\/|\/verification\/|node:|electron)/, path + ': dependency direction')
  assert.doesNotMatch(source, /window\.cairnCodex|\b(?:localStorage|sessionStorage|ipcRenderer)\b/, path + ': effects need a typed port')
  assert.doesNotMatch(source, /\binject\s*\(/, path + ': effects need explicit typed ports')
  const script = path.endsWith('.vue') ? source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1] : source
  const syntax = ts.createSourceFile(path, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  function assertTyped(node) {
    assert.notEqual(node.kind, ts.SyntaxKind.AnyKeyword, path + ': no untyped shell context')
    ts.forEachChild(node, assertTyped)
  }
  assertTyped(syntax)
}

const template = createScreenshotCollectionFixture('search-help')
const item = (record, overrides = {}) => ({ ...template.items[0], record, name: record, rarity: 'legendary',
  slot: 'head', discovered: false, availableCount: 0, bestRollPercentile: null,
  recipeUnlocked: false, availableViaAwakening: false, awakeningSourceAvailableCount: 0,
  setRecord: 'set-a', setName: 'Set A', firstDiscoveredAt: null, ...overrides })
const items = [
  item('a', { availableCount: 2, discovered: true, bestRollPercentile: 90, levelRequirement: 10 }),
  item('b', { recipeUnlocked: true, levelRequirement: 30 }),
  item('c', { availableViaAwakening: true, awakeningSourceAvailableCount: 1, levelRequirement: 20 }),
  item('d', { setRecord: 'set-b', setName: 'Set B', availableCount: 1, discovered: true, bestRollPercentile: 70 }),
  item('mi-1', { setRecord: null, rarity: 'mi', name: 'Same MI', availableCount: 1, discovered: true, bestRollPercentile: 20 }),
  item('mi-2', { setRecord: null, rarity: 'mi', name: 'Same MI', bestRollPercentile: 80 })
]
const snapshot = shallowRef({ ...template, items, observedItems: [], affixes: [], materials: [],
  rarities: [{ rarity: 'legendary', collected: 2, total: 4, availableCopies: 3 },
    { rarity: 'mi', collected: 1, total: 2, availableCopies: 1 }] })
const countingMode = ref('base')
const scope = effectScope()
const document = candidate => ({ text: candidate.name, fields: { name: candidate.name, level: candidate.levelRequirement } })
const sets = scope.run(() => createSetsSession({ items: () => snapshot.value?.items ?? [], itemSearchDocument: document, restoringHistory: () => false }))
const dashboard = scope.run(() => createCollectionDashboard({ snapshot: () => snapshot.value, miCountingMode: () => countingMode.value, sets: () => sets.collectionSets.value }))
assert.equal(sets.collectionSets.value.length, 2)
const setA = sets.collectionSets.value.find(set => set.record === 'set-a')
assert.equal(setA.collected, 1, 'recipe and awakening readiness do not invent discoveries')
assert.equal(setA.minimumLevel, 10)
assert.equal(setA.maximumLevel, 30)
assert.equal(setReadyFromStorage(setA), false)
assert.equal(setReadyAfterCrafting(setA), false)
assert.equal(setReadyWithQualifiedAvailability(setA), true)
assert.deepEqual(dashboard.setSummary.value, { total: 2, collected: 1, readyFromStorage: 1, readyAfterCrafting: 1, readyWithQualifiedAvailability: 2 })
assert.equal(dashboard.rarity('mi').total, 1)
assert.equal(dashboard.miRollSummary.value.median, 80)
countingMode.value = 'tier'
assert.equal(dashboard.rarity('mi').total, 2)
assert.equal(dashboard.miRollSummary.value.median, 50)
assert.deepEqual(medianSummary([null, undefined, NaN, Infinity, 10, 30]), { median: 20, scored: 2 })
assert.equal(percentage(undefined), '0%')
assert.ok(dashboard.collectionTrivia.value.some(fact => fact.id === 'closest-set'))
sets.currentPage.value = 3
sets.query.value = 'a'
await nextTick()
assert.equal(sets.currentPage.value, 1)
sets.restoreRoute({ query: 'name:d', progress: 'all', feature: 'all', sort: 'name', direction: 'desc', page: 4 })
await nextTick()
assert.equal(sets.currentPage.value, 4)
assert.equal(sets.setSortDirection.value, 'desc', 'restored direction is not overwritten by sort defaults')
assert.deepEqual(sets.visibleSets.value.map(set => set.record), ['set-b'])
await new Promise(resolve => setTimeout(resolve, 150))
assert.deepEqual(sets.visibleSets.value.map(set => set.record), ['set-b'], 'older debounced queries cannot replace restored search')
sets.setSortMode.value = 'level'
await nextTick()
assert.equal(sets.setSortDirection.value, 'asc')
sets.restoreRoute({ query: 'unknown:broken', progress: 'all', feature: 'all', sort: 'name', direction: 'asc', page: 1 })
assert.ok(sets.setSearchQuery.value.error)
assert.equal(sets.visibleSets.value.length, 2, 'retain the existing query-error presentation with its unfiltered results')
snapshot.value = null
assert.equal(dashboard.allItemSummary.value.total, 0)
assert.equal(dashboard.collectionTrivia.value.length, 0)
assert.equal(sets.collectionSets.value.length, 0)

const mode = ref(false)
const revision = ref(0)
const basis = ref('stashes')
const observed = shallowRef([{ baseRecord: 'same', sourcePath: 'vault://same', instanceKey: 'same-key' }])
const archive = [
  { id: 'same', baseRecord: 'same', instanceKey: 'same-key', catalogued: true, state: 'ingested', isHardcore: false },
  { id: 'sc', baseRecord: 'sc', instanceKey: 'sc-key', catalogued: true, state: 'ingested', isHardcore: false, seed: 42 },
  { id: 'hc', baseRecord: 'hc', instanceKey: 'hc-key', catalogued: true, state: 'ingested', isHardcore: true }
]
const requests = []
const owner = scope.run(() => useCollectionCopies({
  enabled: () => basis.value === 'stashes', context: () => ({ isHardcore: mode.value, revision: revision.value, source: 'synthetic' }),
  observedCopies: () => observed.value, catalogItems: () => items, basis: () => basis.value,
  query: async request => { requests.push(request); return { items: archive, total: archive.length, offset: 0, limit: 250 } },
  reportError: error => { throw error }
}))
await nextTick()
assert.equal(requests[0].limit, 250)
assert.deepEqual(owner.copies.value.map(copy => copy.instanceKey), ['same-key', 'sc-key'])
assert.equal(owner.copies.value[1].seed, 42)
assert.deepEqual([...owner.archivedRecords.value], ['same', 'sc'])
mode.value = true
observed.value = []
assert.deepEqual(owner.copies.value, [], 'mode invalidation hides stale augmented copies')
await nextTick()
assert.deepEqual(owner.copies.value.map(copy => copy.instanceKey), ['hc-key'])
basis.value = 'archive'
revision.value++
assert.deepEqual([...owner.archivedRecords.value], ['a', 'd', 'mi-1'])

const stat = (field, value, overrides = {}) => ({ field, value, rollable: true, observedMinimum: 0, observedMaximum: 10, estimatedPercentile: 50, ...overrides })
const copy = (key, stats) => ({ instanceKey: key, prefixRecord: '', suffixRecord: '', rollAnalysis: { stats, petStats: [] } })
const reference = copy('reference', [stat('offensiveFire', 5), stat('offensiveCold', 7)])
const variant = copy('variant', [stat('offensiveFire', 8), stat('offensiveLightning', 4)])
const identicalCopies = [
  { ...reference, sourcePath: 'vault://copy-a', tabIndex: -1, itemIndex: 0 },
  { ...reference, sourcePath: 'vault://copy-b', tabIndex: -1, itemIndex: 1 },
  { ...reference, sourcePath: 'synthetic.gst', tabIndex: 0, itemIndex: 0 },
  { ...reference, sourcePath: 'synthetic.gst', tabIndex: 0, itemIndex: 1 }
]
const identicalWindow = createBoundedResultWindow({ items: identicalCopies, getKey: inspectionCopyKey, page: 1, pageSize: 50 })
assert.equal(identicalWindow.entries.length, 4, 'same fingerprint does not collapse distinct physical copies')
assert.equal(new Set(identicalWindow.entries.map(entry => entry.key)).size, 4)
assert.equal(inspectionCopyKey(identicalCopies[0]), inspectionCopyKey({ ...identicalCopies[0], itemIndex: 100 }), 'vault row identity survives aggregation reorder')
const comparison = createComparisonProjection(false, [reference, variant], reference)
const rows = comparison(variant)
assert.equal(rows.find(row => row.key === 'offensiveFire').deltaTone, 'positive')
assert.equal(rows.find(row => row.key === 'offensiveCold').deltaTone, 'missing')
assert.equal(rows.find(row => row.key === 'offensiveLightning').deltaTone, 'unique')
assert.equal(comparison(variant), rows, 'rendering the same visible copy reuses its projection')
assert.equal(copyAffixDelta({ ...variant, prefixRecord: 'added' }, 'prefix', reference), 'Added vs reference')
const largeItems = Array.from({ length: 20_000 }, (_, index) => item(`large-${index}`, { setRecord: `set-${Math.floor(index / 5)}`, setName: `Set ${Math.floor(index / 5)}`, availableCount: 1 }))
const started = performance.now()
const largeSets = buildCollectionSets(largeItems)
assert.equal(largeSets.length, 4000)
const setMs = performance.now() - started
const largeCopies = Array.from({ length: 20_000 }, (_, index) => copy(`large-${index}`, [stat('offensiveFire', index % 11)]))
const compareStarted = performance.now()
const largeProjection = createComparisonProjection(false, largeCopies, largeCopies[0])
for (const candidate of largeCopies.slice(0, 50)) assert.equal(largeProjection(candidate).length, 1)
const comparisonMs = performance.now() - compareStarted
assert.ok(setMs < 3000 && comparisonMs < 3000, `20k projection exceeded budget: ${setMs} / ${comparisonMs}`)
scope.stop()
console.log(JSON.stringify({ passed: true, directOwners: true, routeAndModeIsolation: true, catalogItems: 20000, sets: 4000, setMs, comparedCopies: 20000, visibleCopies: 50, comparisonMs }))
