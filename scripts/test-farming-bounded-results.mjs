import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createBoundedResultWindow } from '../src/renderer/src/bounded-results.ts'
import {
  buildCollectionFarmingTargets,
  withCollectionFarmingPage,
  withCollectionFarmingQuery,
  withCollectionFarmingRarity
} from '../src/renderer/src/workspaces/collection-farming.ts'

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

const restoredControls = { query: 'restored', rarity: 'legendary', page: 4 }
assert.deepEqual(withCollectionFarmingQuery(restoredControls, 'edited'), {
  query: 'edited', rarity: 'legendary', page: 1
})
assert.deepEqual(withCollectionFarmingRarity(restoredControls, 'epic'), {
  query: 'restored', rarity: 'epic', page: 1
})
assert.deepEqual(withCollectionFarmingPage(restoredControls, 3), {
  query: 'restored', rarity: 'legendary', page: 3
})
assert.deepEqual(restoredControls, { query: 'restored', rarity: 'legendary', page: 4 })

const farmingItems = [
  {
    record: 'records/items/test/legendary_a.dbr',
    name: 'Legendary A',
    rarity: 'legendary',
    levelRequirement: 94,
    acquisition: {
      sources: ['Fleshwarped Commander'],
      locations: [{ name: 'Kurnhold', routeName: 'Kurnhold route', contentPack: 'gdx1' }]
    }
  },
  {
    record: 'records/items/test/epic_b.dbr',
    name: 'Epic B',
    rarity: 'epic',
    levelRequirement: 50,
    acquisition: {
      sources: ['Fleshwarped Commander'],
      locations: [{ name: 'Kurnhold', routeName: 'Kurnhold route', contentPack: 'gdx1' }]
    }
  },
  {
    record: 'records/items/test/owned_mi.dbr',
    name: 'Owned MI',
    rarity: 'mi',
    levelRequirement: 70,
    acquisition: {
      sources: ['Fleshwarped Commander'],
      locations: [{ name: 'Kurnhold', routeName: 'Kurnhold route', contentPack: 'gdx1' }]
    }
  },
  {
    record: 'records/items/test/epic_c.dbr',
    name: 'Epic C',
    rarity: 'epic',
    levelRequirement: 25,
    acquisition: {
      sources: ['Cronley Gang'],
      locations: [{ name: "Cronley's Hideout", routeName: '', contentPack: 'base' }]
    }
  }
]
const targetOptions = {
  rarity: 'all',
  query: { matches: () => true },
  isOwned: (item) => item.record.endsWith('owned_mi.dbr'),
  searchDocumentForItem: (item) => ({ text: item.name, fields: { skill: [], damage: [] } })
}
const builtTargets = buildCollectionFarmingTargets(farmingItems, targetOptions)
assert.equal(builtTargets.length, 2)
assert.equal(builtTargets[0].name, 'Kurnhold')
assert.equal(builtTargets[0].items.length, 2)
assert.equal(builtTargets[0].minimumLevel, 50)
assert.ok(!builtTargets[0].items.some((item) => item.record.endsWith('owned_mi.dbr')))
const legendaryTargets = buildCollectionFarmingTargets(farmingItems, { ...targetOptions, rarity: 'legendary' })
assert.equal(legendaryTargets.length, 1)
assert.deepEqual(legendaryTargets[0].items.map((item) => item.name), ['Legendary A'])
const areaTargets = buildCollectionFarmingTargets(farmingItems, {
  ...targetOptions,
  query: { matches: (document) => document.fields.area.includes('Kurnhold') }
})
assert.equal(areaTargets.length, 1)
assert.equal(areaTargets[0].name, 'Kurnhold')

const [app, workspace, viewModel, styles] = await Promise.all([
  readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/CollectionFarmingWorkspace.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/collection-farming.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8'),
])

assert.match(app, /<CollectionFarmingWorkspace[\s\S]*?v-else-if="activeView === 'farming'"/)
assert.match(app, /const farmingControls = ref<CollectionFarmingControls>/)
assert.match(app, /v-model:controls="farmingControls"/)
assert.match(app, /case 'farming':[\s\S]*?farmingControls\.value = \{ \.\.\.route\.controls \}/)
assert.doesNotMatch(app, /const farmTargets|const farmingQuery|const farmingRarity|const farmingPage/)
assert.match(workspace, /defineModel<CollectionFarmingControls>\('controls'/)
assert.match(workspace, /withCollectionFarmingQuery\(controls\.value, query\)/)
assert.match(workspace, /withCollectionFarmingRarity\(controls\.value, rarity\)/)
assert.match(workspace, /withCollectionFarmingPage\(controls\.value, page\)/)
assert.match(workspace, /v-model:page="page"[\s\S]*?:items="targets"[\s\S]*?:get-key="target => target\.key"[\s\S]*?:page-size="50"/)
assert.match(workspace, /#item="\{ item: target, index \}"[\s\S]*?farm-rank">\{\{ index \+ 1 \}\}/)
assert.match(workspace, /<article :data-route-key="target\.key">/)
assert.match(workspace, /target\.items\.slice\(0, 12\)/)
assert.match(workspace, /target\.items\.length - 12/)
assert.match(workspace, /emit\('queue-tooltip', item, \$event\)[\s\S]*?emit\('open-item', item\)/)
assert.doesNotMatch(workspace, /<article v-for="\(target, index\) in targets"/)
assert.match(viewModel, /export function buildCollectionFarmingTargets/)
assert.match(styles, /\.farm-list \.bounded-results-item > article/)

console.log('Collection Farming workspace passed: extracted view-model grouping/filtering plus 214 bounded routes with 50 mounted per full page and 14 on the final page.')
