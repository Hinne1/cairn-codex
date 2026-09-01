import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createBoundedResultWindow } from '../src/renderer/src/bounded-results.ts'

function generatedRoutes(count) {
  return Array.from({ length: count }, (_, index) => ({
    key: `base:area-${String(index + 1).padStart(3, '0')}:route-${index % 7}`,
    name: `Area ${String(index + 1).padStart(3, '0')}`,
    contentPack: index % 2 === 0 ? 'base' : 'gdx1',
    minimumLevel: 1 + index % 94,
    items: Array.from({ length: 1 + index % 16 }, (_, itemIndex) => ({
      record: `records/items/synthetic/route_${index}_item_${itemIndex}.dbr`
    }))
  }))
}

const routes = generatedRoutes(214)
const first = createBoundedResultWindow({
  items: routes,
  getKey: (route) => route.key,
  page: 1,
  pageSize: 50
})
assert.equal(first.totalCount, 214)
assert.equal(first.entries.length, 50)
assert.equal(first.entries[0].index + 1, 1)
assert.equal(first.entries.at(-1).index + 1, 50)
assert.equal(first.entries[0].key, routes[0].key)

const last = createBoundedResultWindow({
  items: routes,
  getKey: (route) => route.key,
  page: 5,
  pageSize: 50
})
assert.equal(last.entries.length, 14)
assert.equal(last.entries[0].index + 1, 201)
assert.equal(last.entries.at(-1).index + 1, 214)

const normal = createBoundedResultWindow({
  items: routes.slice(0, 17),
  getKey: (route) => route.key,
  page: 1,
  pageSize: 50
})
assert.equal(normal.entries.length, 17)
assert.equal(normal.pageCount, 1)

const empty = createBoundedResultWindow({
  items: [],
  getKey: (route) => route.key,
  page: 1,
  pageSize: 50
})
assert.equal(empty.entries.length, 0)
assert.equal(empty.totalCount, 0)

const [app, styles, main] = await Promise.all([
  readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
])

const farmingStart = app.indexOf('activeView === \'farming\'')
const farmingEnd = app.indexOf('activeView === \'settings\'', farmingStart)
assert.ok(farmingStart >= 0 && farmingEnd > farmingStart, 'Collection Farming template section was not found.')
const farmingTemplate = app.slice(farmingStart, farmingEnd)

assert.match(app, /const farmingPage = ref\(1\)/)
assert.match(app, /watch\(\[farmingQuery, farmingRarity\], \(\) => \{\s*if \(restoringAppHistory\) return\s*farmingPage\.value = 1\s*\}\)/)
assert.match(farmingTemplate, /v-model:page="farmingPage"[\s\S]*?:items="farmTargets"[\s\S]*?:get-key="target => target\.key"[\s\S]*?:page-size="50"/)
assert.match(farmingTemplate, /#item="\{ item: target, index \}"[\s\S]*?farm-rank">\{\{ index \+ 1 \}\}/)
assert.match(farmingTemplate, /<article :data-route-key="target\.key">/)
assert.match(farmingTemplate, /target\.items\.slice\(0, 12\)/)
assert.match(farmingTemplate, /target\.items\.length - 12/)
assert.match(farmingTemplate, /@mouseenter="queueTooltip\(item, \$event\)"[\s\S]*?@click="openItem\(item\)"/)
assert.doesNotMatch(farmingTemplate, /<article v-for="\(target, index\) in farmTargets"/)
assert.match(styles, /\.farm-list \.bounded-results-item > article/)
assert.match(main, /name === 'farming-routes'/)
assert.match(main, /CAIRN_CODEX_SCREENSHOT_VERIFY_FARMING_PAGING/)
assert.match(main, /farmingRows: document\.querySelectorAll\('\.farm-list \.bounded-results-item > article'\)\.length/)

console.log('Collection Farming bounded results passed: 214 total routes, 50 mounted per full page, 14 on the final page, with normal and empty states preserved.')
