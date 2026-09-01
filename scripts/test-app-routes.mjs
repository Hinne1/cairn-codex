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
  'supplies', 'farming', 'dismantling', 'vault', 'settings'
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

const historyEntry = createAppHistoryEntry(7, plannerRoute)
assert.deepEqual(parseAppHistoryEntry(historyEntry), historyEntry)
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
const mainSource = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
const benchmarkSource = await readFile(new URL('./benchmark-ui.mjs', import.meta.url), 'utf8')
assert.match(appSource, /function currentAppRoute\(\): AppRoute/)
assert.match(appSource, /appRouteHref\(state\.route, window\.location\.href\)/)
assert.match(appSource, /parseAppRouteHash\(window\.location\.hash\)/)
assert.match(appSource, /if \(restoringAppHistory\) return\s+currentPage\.value = 1/)
assert.match(appSource, /watch\(sortMode,[\s\S]*?if \(restoringAppHistory\) return[\s\S]*?sortDirection\.value/)
assert.match(appSource, /watch\(setSortMode,[\s\S]*?if \(restoringAppHistory\) return[\s\S]*?setSortDirection\.value/)
assert.match(appSource, /watch\(\[plannerMapScope,[\s\S]*?if \(restoringAppHistory\) return[\s\S]*?selectedAtlasRegion\.value = null/)
assert.doesNotMatch(appSource, /interface AppHistoryState/)
assert.match(mainSource, /CAIRN_CODEX_SCREENSHOT_VERIFY_TYPED_ROUTES/)
assert.match(mainSource, /Back did not restore the MI item drawer route/)
assert.match(mainSource, /Forward did not restore the set item route/)
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
