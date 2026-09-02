import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { appRouteHash, parseAppRoute } from '../src/renderer/src/app-route.ts'

function verifiedRoute(input) {
  const route = parseAppRoute(input)
  if (!route) throw new Error(`Invalid typed-route fixture: ${JSON.stringify(input)}`)
  return appRouteHash(route)
}

function runGate(label, args) {
  const result = spawnSync(process.execPath, [resolve('scripts/benchmark-ui.mjs'), ...args], {
    cwd: resolve('.'),
    env: process.env,
    stdio: 'inherit',
    windowsHide: true
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${label} typed-route Electron gate exited ${result.status ?? 'without a status'}.`)
}

runGate('Collection and MI Workshop', [
  '--electron-source', '--fixture', 'mi-workshop', '--query', 'Bloodsworn',
  '--route-hash', verifiedRoute({
    version: 1,
    workspace: 'collection',
    controls: {
      category: 'All', query: 'Bloodsworn', ownership: 'all', rarity: 'all',
      sort: 'name', direction: 'desc', page: 1
    }
  }),
  '--verify-typed-routes', '--assert-no-overflow', '--disable-gpu',
  '--width', '1440', '--height', '1000', '--screenshot-name', 'typed-routes-verify-wide'
])

runGate('Sets and item drawer', [
  '--electron-source', '--fixture', 'sets-semantics', '--query', ' ',
  '--route-hash', verifiedRoute({
    version: 1,
    workspace: 'sets',
    controls: {
      query: ' ', progress: 'all', feature: 'all', sort: 'name', direction: 'desc', page: 1
    }
  }),
  '--verify-typed-routes', '--assert-no-overflow', '--disable-gpu',
  '--width', '520', '--height', '900', '--screenshot-name', 'typed-routes-verify-narrow'
])

runGate('Planner map atlas selection', [
  '--electron-source', '--fixture', 'planner', '--query', 'Wendigo',
  '--route-hash', verifiedRoute({
    version: 1,
    workspace: 'planner',
    controls: {
      profileId: null, skills: ['Wendigo Totem'], minimumLevel: 1, maximumLevel: 70,
      query: '', ownership: 'all', showIgnored: false, sort: 'level', direction: 'asc',
      display: 'map', page: 1, atlasQuery: 'Wendigo',
      atlasRegion: 'synthetic qa:review hollow:typed route review', mapScope: 'all',
      mapSort: 'items', mapDirection: 'desc'
    }
  }),
  '--verify-typed-routes', '--assert-no-overflow', '--disable-gpu',
  '--width', '1440', '--height', '1000', '--screenshot-name', 'typed-routes-verify-planner'
])

runGate('Custom accessible modal focus', [
  '--electron-source', '--fixture', 'planner', '--query', 'Wendigo',
  '--route-hash', verifiedRoute({
    version: 1,
    workspace: 'planner',
    controls: {
      profileId: null, skills: ['Wendigo Totem'], minimumLevel: 1, maximumLevel: 70,
      query: '', ownership: 'all', showIgnored: false, sort: 'level', direction: 'asc',
      display: 'map', page: 1, atlasQuery: 'Wendigo',
      atlasRegion: 'synthetic qa:review hollow:typed route review', mapScope: 'all',
      mapSort: 'items', mapDirection: 'desc'
    }
  }),
  '--dismiss-onboarding', '--verify-accessible-modal', '--assert-no-overflow', '--disable-gpu',
  '--width', '1440', '--height', '1000', '--screenshot-name', 'accessible-planner-focus'
])

runGate('Accessible modal focus', [
  '--electron-source', '--fixture', 'search-help', '--query', 'wendigo',
  '--category', 'Collection', '--open-search-help', '--verify-responsive-tools',
  '--assert-no-overflow', '--disable-gpu',
  '--width', '520', '--height', '900', '--screenshot-name', 'accessible-dialog-focus'
])

console.log('Typed-route Electron gates passed for Collection, Sets, Planner map restoration, and native/custom accessible modal focus.')
