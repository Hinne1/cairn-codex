import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createBoundedResultWindow } from '../src/renderer/src/bounded-results.ts'

const sets = Array.from({ length: 202 }, (_, index) => ({
  record: `records/items/synthetic/set-${String(index + 1).padStart(3, '0')}.dbr`,
  name: `Synthetic Set ${String(index + 1).padStart(3, '0')}`
}))

const first = createBoundedResultWindow({
  items: sets,
  getKey: (set) => set.record,
  page: 1,
  pageSize: 50
})
assert.equal(first.totalCount, 202)
assert.equal(first.entries.length, 50)
assert.equal(first.entries[0].key, sets[0].record)
assert.equal(first.entries.at(-1).key, sets[49].record)

const last = createBoundedResultWindow({
  items: sets,
  getKey: (set) => set.record,
  page: 5,
  pageSize: 50
})
assert.equal(last.entries.length, 2)
assert.equal(last.entries[0].key, sets[200].record)
assert.equal(last.entries.at(-1).key, sets[201].record)

const normal = createBoundedResultWindow({
  items: sets.slice(0, 3),
  getKey: (set) => set.record,
  page: 1,
  pageSize: 50
})
assert.equal(normal.entries.length, 3)
assert.equal(normal.pageCount, 1)

const empty = createBoundedResultWindow({
  items: [],
  getKey: (set) => set.record,
  page: 1,
  pageSize: 50
})
assert.equal(empty.entries.length, 0)
assert.equal(empty.totalCount, 0)

const [app, boundedSurface, styles, benchmark, packageJson] = await Promise.all([
  readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/components/BoundedResultSurface.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('./benchmark-ui.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8')
])

assert.match(app, /v-else-if="activeView === 'sets'"[\s\S]*?v-model:page="currentPage"/)
assert.match(app, /:items="visibleSets"[\s\S]*?:get-key="set => set\.record"[\s\S]*?:page-size="50"/)
assert.match(app, /#item="\{ item: set \}"[\s\S]*?:data-set-record="set\.record"/)
assert.match(app, /watch\([\s\S]*?setProgressFilter[\s\S]*?setFeatureFilter[\s\S]*?setSortMode[\s\S]*?setSortDirection[\s\S]*?currentPage\.value = 1/)
assert.match(app, /case 'sets':[\s\S]*?searchQuery\.value = route\.controls\.query[\s\S]*?currentPage\.value = route\.controls\.page/)
assert.doesNotMatch(app, /v-for="set in visibleSets"/)
assert.doesNotMatch(app, /visibleSets\.length === 0/)
assert.match(boundedSurface, /props\.layout === 'grid' && !usesGridSemantics\.value/)
assert.match(boundedSurface, /usesListSemantics\.value[\s\S]*?'list'[\s\S]*?'listitem'/)
assert.match(styles, /\.set-results \.bounded-results-collection\.is-grid/)
assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.set-results \.bounded-results-collection\.is-grid/)
assert.match(benchmark, /--expected-set-cards/)
assert.match(benchmark, /--verify-sets-paging/)
assert.match(packageJson, /test:sets-bounded-results/)

console.log('Sets bounded-result checks passed: stable 202-set paging mounts 50 cards per full page and 2 on the final page.')
