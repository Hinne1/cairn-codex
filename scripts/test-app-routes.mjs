import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  APP_ROUTE_VERSION,
  appRouteHash,
  appRouteHref,
  createAppHistoryEntry,
  defaultAppRoute,
  parseAppHistoryEntry,
  parseAppRoute,
  parseAppRouteHash
} from '../src/renderer/src/app-route.ts'

const workspaces = [
  'collection', 'sets', 'materials', 'skills', 'planner', 'oracle', 'mi-workshop',
  'supplies', 'farming', 'dismantling', 'vault', 'settings', 'glossary'
]

for (const workspace of workspaces) {
  const route = defaultAppRoute(workspace)
  assert.equal(route.version, APP_ROUTE_VERSION)
  assert.equal(route.workspace, workspace)
  assert.deepEqual(parseAppRouteHash(appRouteHash(route)), route)
}

const plannerRoute = parseAppRoute({
  version: APP_ROUTE_VERSION,
  workspace: 'planner',
  itemRecord: 'records/items/gear/legendary/test_item.dbr',
  controls: {
    profileId: 'profile-pets',
    skills: ['Summon Briarthorn', 'Wendigo Totem'],
    minimumLevel: 18,
    maximumLevel: 94,
    query: 'skill:"Wendigo Totem"',
    ownership: 'missing',
    showIgnored: true,
    sort: 'rarity',
    direction: 'desc',
    display: 'map',
    page: 3,
    atlasQuery: 'Ugdenbog',
    atlasRegion: 'gdx1:ugdenbog',
    mapScope: 'all',
    mapSort: 'name',
    mapDirection: 'asc',
    results: Array.from({ length: 20_000 }, (_, index) => ({ index }))
  },
  snapshot: { items: Array.from({ length: 20_000 }) }
})
assert.ok(plannerRoute)
assert.equal(plannerRoute.controls.skills.length, 2)
assert.equal('results' in plannerRoute.controls, false)
assert.equal('snapshot' in plannerRoute, false)

const legacyPlannerTableRoute = parseAppRoute({
  version: 1,
  workspace: 'planner',
  controls: { display: 'list' }
})
const legacyPlannerGridRoute = parseAppRoute({
  version: 1,
  workspace: 'planner',
  controls: { display: 'grid' }
})
assert.equal(legacyPlannerTableRoute?.controls.display, 'table')
assert.equal(legacyPlannerGridRoute?.controls.display, 'journey')
assert.equal(defaultAppRoute('planner').controls.display, 'table')

const deepLink = appRouteHref(plannerRoute, 'file:///C:/Cairn%20Codex/index.html?safeMode=0')
const deepLinkUrl = new URL(deepLink)
assert.equal(deepLinkUrl.searchParams.get('safeMode'), '0')
assert.deepEqual(parseAppRouteHash(deepLinkUrl.hash), plannerRoute)
assert.ok(deepLinkUrl.hash.length < 2_000)

const oracleRoute = parseAppRoute({
  version: 1,
  workspace: 'oracle',
  controls: { page: 4, sort: 'name', direction: 'asc' }
})
assert.ok(oracleRoute)
assert.equal(oracleRoute.controls.page, 4)
assert.deepEqual(parseAppRouteHash(appRouteHash(oracleRoute)), oracleRoute)

const suppliesRoute = parseAppRoute({
  version: 1,
  workspace: 'supplies',
  controls: { category: 'augments', slot: 'jewelry', query: 'resistance', mode: 'offline', page: 7 }
})
assert.ok(suppliesRoute)
assert.equal(suppliesRoute.controls.mode, 'offline')
assert.equal(suppliesRoute.controls.page, 7)
assert.deepEqual(parseAppRouteHash(appRouteHash(suppliesRoute)), suppliesRoute)

const categoryMetricRoute = parseAppRoute({
  version: 1,
  workspace: 'mi-workshop',
  controls: { metric: 'category:offense:fire' }
})
assert.ok(categoryMetricRoute)
assert.equal(categoryMetricRoute.controls.metric, 'category:offense:fire')

const defaultSkillRoute = parseAppRoute({
  version: 1,
  workspace: 'skills',
  controls: {}
})
assert.ok(defaultSkillRoute)
assert.equal(defaultSkillRoute.controls.sort, 'level')
assert.equal(defaultSkillRoute.controls.direction, 'asc')

const collectionRollRoute = parseAppRoute({
  version: 1,
  workspace: 'collection',
  controls: { sort: 'roll-fire', direction: 'desc' }
})
assert.ok(collectionRollRoute)
assert.equal(collectionRollRoute.controls.sort, 'roll-fire')
const retaliationRollRoute = parseAppRoute({
  version: 1,
  workspace: 'collection',
  controls: { sort: 'roll-retaliation', direction: 'desc' }
})
assert.ok(retaliationRollRoute)
assert.equal(retaliationRollRoute.controls.sort, 'roll-retaliation')
const legacyCollectionRollRoute = parseAppRoute({
  version: 1,
  workspace: 'collection',
  controls: { sort: 'roll' }
})
assert.ok(legacyCollectionRollRoute)
assert.equal(legacyCollectionRollRoute.controls.sort, 'roll-offense')

const historyEntry = createAppHistoryEntry(7, plannerRoute)
assert.deepEqual(parseAppHistoryEntry(historyEntry), historyEntry)
const copyHistoryEntry = createAppHistoryEntry(8, plannerRoute, 'score-leader')
assert.equal(parseAppHistoryEntry(JSON.parse(JSON.stringify(copyHistoryEntry))).referenceInstanceKey, 'score-leader')
assert.equal(parseAppHistoryEntry({ ...copyHistoryEntry, referenceInstanceKey: undefined }).referenceInstanceKey, null,
  'older history entries must remain valid')
assert.equal(parseAppHistoryEntry({ ...copyHistoryEntry, referenceInstanceKey: {} }).referenceInstanceKey, null)
assert.equal(parseAppHistoryEntry({ ...copyHistoryEntry, referenceInstanceKey: 'x'.repeat(501) }).referenceInstanceKey.length, 500)
assert.equal(createAppHistoryEntry(9, defaultAppRoute('collection'), 'stale-copy').referenceInstanceKey, null,
  'closed drawers must not retain an unrelated copy')
assert.equal(appRouteHash(copyHistoryEntry.route).includes('score-leader'), false,
  'local copy identity must not leak into shareable deep links')
assert.equal(parseAppHistoryEntry({ ...historyEntry, routeVersion: 2 }), null)
assert.equal(parseAppHistoryEntry({ cairnCodex: true, routeVersion: 1, index: 0, route: { version: 1, workspace: 'unknown' } }), null)
assert.equal(parseAppRoute({ version: 2, workspace: 'collection', controls: {} }), null)
assert.equal(parseAppRoute({ version: 1, workspace: 'unknown', controls: {} }), null)
assert.equal(parseAppRouteHash('#cc-route=1&view=sets&controls=%7Bbroken'), null)
assert.equal(parseAppRouteHash(`#cc-route=1&view=sets&controls=${'x'.repeat(8_001)}`), null)

const hostile = parseAppRoute({
  version: 1,
  workspace: 'vault',
  itemRecord: 'x'.repeat(2_000),
  controls: {
    mode: 'unsafe', section: 'unknown', historyQuery: 'q'.repeat(2_000), historyOutcome: 'lost',
    historyPage: -5, vaultPage: Number.MAX_SAFE_INTEGER, quarantinePage: 2.5
  }
})
assert.ok(hostile)
assert.equal(hostile.itemRecord?.length, 500)
assert.equal(hostile.controls.mode, 'live')
assert.equal(hostile.controls.section, 'ingest-history')
assert.equal(hostile.controls.historyQuery.length, 500)
assert.equal(hostile.controls.historyOutcome, 'all')
assert.equal(hostile.controls.historyPage, 1)
assert.equal(hostile.controls.vaultPage, 100_000)
assert.equal(hostile.controls.quarantinePage, 1)

const appSource = await readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8')
const collectionWorkspaceSource = await readFile(new URL('../src/renderer/src/workspaces/CollectionMaterialsWorkspace.vue', import.meta.url), 'utf8')
const plannerSessionSource = await readFile(new URL('../src/renderer/src/workspaces/leveling-planner.ts', import.meta.url), 'utf8')
const benchmarkSource = await readFile(new URL('./benchmark-ui.mjs', import.meta.url), 'utf8')
assert.match(appSource, /function currentAppRoute\(\): AppRoute/)
assert.match(appSource, /appRouteHref\(state\.route, window\.location\.href\)/)
assert.match(appSource, /parseAppRouteHash\(window\.location\.hash\)/)
assert.match(appSource, /createAppHistoryEntry\(index, currentAppRoute\(\), selectedReferenceInstanceKey\.value\)/)
assert.match(appSource, /selectedReferenceInstanceKey\.value = route\.itemRecord \? referenceInstanceKey : null/)
assert.match(appSource, /restoreAppRoute\(route, entry\?\.referenceInstanceKey\)/)
assert.match(appSource, /restoreAppRoute\(initialRoute, existingHistoryEntry\?\.referenceInstanceKey\)/)
assert.match(appSource, /collectionControls, materialsControls,\s+selectedReferenceInstanceKey,/,
  'changing the pinned reference must update the current history entry')
assert.match(appSource, /if \(restoringAppHistory\) return\s+currentPage\.value = 1/)
assert.match(appSource, /const collectionControls = ref<CollectionControls>/)
assert.match(appSource, /const materialsControls = ref<MaterialsControls>/)
assert.match(collectionWorkspaceSource, /function changeSort[\s\S]*?value === 'name' \? 'asc' : 'desc'/)
assert.match(appSource, /watch\(setSortMode,[\s\S]*?if \(restoringAppHistory\) return[\s\S]*?setSortDirection\.value/)
assert.match(plannerSessionSource, /watch\(\[plannerMapScope,[\s\S]*?if \(restoringRoute\) return[\s\S]*?selectedAtlasRegion\.value = null/)
assert.match(plannerSessionSource, /watch\(visibleAtlasRegions,[\s\S]*?if \(restoringRoute\) return[\s\S]*?selectedAtlasRegion\.value/)
assert.doesNotMatch(appSource, /interface AppHistoryState/)
assert.match(benchmarkSource, /--verify-typed-routes/)
assert.match(benchmarkSource, /--route-hash/)

console.log(JSON.stringify({
  passed: true,
  version: APP_ROUTE_VERSION,
  typedWorkspaces: workspaces.length,
  deepLinkRoundTrip: true,
  boundedDecoder: true,
  transientPayloadsExcluded: true,
  rendererIntegration: true,
  electronInteractionGate: true
}, null, 2))
