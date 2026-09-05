import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { moveBoundedVisualRowKey } from '../src/renderer/src/bounded-results.ts'
import { presentScreenshotCollection } from '../src/verification/screenshot-collection.ts'

const [component, collection, oracle, supplies, benchmark, packageJson] = await Promise.all([
  readFile(new URL('../src/renderer/src/components/BoundedResultSurface.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/CollectionMaterialsWorkspace.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/StashOracleWorkspace.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/SuppliesWorkspace.vue', import.meta.url), 'utf8'),
  readFile(new URL('./benchmark-ui.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8')
])

assert.match(component, /const usesGridSemantics = computed\(\(\) => props\.layout === 'grid' && focusable\.value\)/)
assert.match(component, /:role="usesGridSemantics \? 'row' : itemRole"/)
assert.match(component, /v-if="usesGridSemantics"[\s\S]*?role="gridcell"/)
assert.match(component, /getBoundingClientRect\(\)\.top/)
assert.match(component, /props\.layout === 'grid' && !usesGridSemantics\.value/)
assert.match(component, /itemElements\.get\(key\)\?\.focus\(\)[\s\S]*?nextTick/)
assert.match(component, /document\.activeElement !== itemElements\.get\(key\)/)
assert.match(component, /navigate\(intent, entry\.key\)/)
assert.match(component, /visualRowKey\(intent, currentKey\)/)

assert.match(collection, /layout="grid"[\s\S]*?interactive/)
assert.match(oracle, /layout="grid" navigable/)
assert.match(supplies, /layout="grid"[\s\S]*?selection-mode="multiple"/)

const gridFixture = { observedItems: [{ instanceKey: 'synthetic-grid-copy' }] }
assert.strictEqual(presentScreenshotCollection(gridFixture, 'archive', 'capture.png', 'bounded-grid-a11y', () => { throw new Error('Must retain projected grid copies') }).observedItems, gridFixture.observedItems)
assert.equal(presentScreenshotCollection(gridFixture, 'archive', undefined, 'bounded-grid-a11y', () => null), null)
assert.match(benchmark, /--verify-bounded-grid-semantics/)
assert.match(packageJson, /test:bounded-grid-semantics:electron/)

const variableHeightGrid = [
  { key: 'a', left: 0, top: 0 },
  { key: 'b', left: 300, top: 0 },
  { key: 'c', left: 0, top: 420 },
  { key: 'd', left: 300, top: 420 }
]
assert.equal(moveBoundedVisualRowKey(variableHeightGrid, 'a', 'row-down'), 'c')
assert.equal(moveBoundedVisualRowKey(variableHeightGrid, 'b', 'row-down'), 'd')
assert.equal(moveBoundedVisualRowKey(variableHeightGrid, 'c', 'row-up'), 'a')
assert.equal(moveBoundedVisualRowKey(variableHeightGrid, 'b', 'row-up'), 'b')
assert.equal(moveBoundedVisualRowKey(variableHeightGrid, 'c', 'row-down'), 'c')
assert.equal(moveBoundedVisualRowKey(variableHeightGrid, 'missing', 'row-down'), null)

const singleRowGrid = [
  { key: 'left', left: 0, top: 0 },
  { key: 'right', left: 300, top: 0 }
]
assert.equal(moveBoundedVisualRowKey(singleRowGrid, 'left', 'row-down'), 'left')
assert.equal(moveBoundedVisualRowKey(singleRowGrid, 'right', 'row-up'), 'right')

console.log('Bounded grid semantics contract passed for interactive, navigable, selectable, and passive visual-grid modes.')
