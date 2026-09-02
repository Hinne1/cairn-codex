import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { moveBoundedVisualRowKey } from '../src/renderer/src/bounded-results.ts'

const [component, collection, oracle, supplies, main, benchmark, packageJson] = await Promise.all([
  readFile(new URL('../src/renderer/src/components/BoundedResultSurface.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/CollectionMaterialsWorkspace.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/StashOracleWorkspace.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/SuppliesWorkspace.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8'),
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

assert.match(main, /name === 'bounded-grid-a11y'/)
assert.match(main, /CAIRN_CODEX_SCREENSHOT_PATH &&[\s\S]*?CAIRN_CODEX_SCREENSHOT_FIXTURE === 'bounded-grid-a11y'[\s\S]*?Promise\.resolve\(\{ \.\.\.snapshot, basis \}\)/)
assert.match(main, /CAIRN_CODEX_SCREENSHOT_VERIFY_BOUNDED_GRID_SEMANTICS/)
assert.match(main, /direct grid rows/)
assert.match(main, /direct gridcell/)
assert.match(main, /top > firstTop \+ 1\) \?\? first/)
assert.match(main, /key: 'ArrowUp'[\s\S]*?document\.activeElement !== first/)
assert.doesNotMatch(main, /oracleCount === 0/)
assert.match(main, /Supplies selection and disabled semantics/)
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
