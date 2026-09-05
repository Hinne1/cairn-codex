import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { effectScope, nextTick, shallowRef } from 'vue'
import { createPreferenceRepository } from '../src/renderer/src/preference-repository.ts'
import { createLevelingPlannerSession } from '../src/renderer/src/workspaces/leveling-planner.ts'
import { buildPlannerRows } from '../src/renderer/src/workspaces/planner-results.ts'
import { researchItemPreferenceKey } from '../src/renderer/src/workspaces/research-item-table.ts'
import { compileSearchQuery } from '../src/shared/search-query.ts'

const copy = (value) => JSON.parse(JSON.stringify(value))
const storageValues = new Map()
const storage = {
  getItem: (key) => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, value)
}
const repository = createPreferenceRepository(storage)
const profile = (id, extra = {}) => ({
  id, name: id, source: 'manual', skills: ['Wendigo Totem'], masteries: [],
  excludedSkills: [], ignoredRecords: [], minimumLevel: 1, levelCap: 100,
  modifiedAt: '2026-09-04T00:00:00.000Z', ...extra
})
repository.update('planner', {
  profiles: [profile('softcore', { isHardcore: false }), profile('hardcore', { isHardcore: true })],
  selectedProfileId: 'softcore', ignoredRecords: ['legacy-unassigned'], favoriteRecords: []
})
const line = (label, tone = 'skill', minimum = 2) => ({
  label, tone, minimum, maximum: null, unit: '', prefix: '+', suffix: ''
})
const item = (name, level, extra = {}) => ({
  record: `records/${name}.dbr`, name, levelRequirement: level, rarity: 'mi', slot: 'legs',
  itemClass: 'ArmorProtective_Legs', discovered: false, availableCount: 0, bestRollPercentile: null,
  presentation: { sections: [{ kind: 'base', lines: [line('to Wendigo Totem')] }] },
  acquisition: {
    sources: ['Fixture monster'], factions: [],
    locations: [{ name: 'Fixture area', routeName: '', contentPack: 'base', zoneRecord: 'fixture', originX: 10, originY: 20 }]
  }, ...extra
})
const craftable = item('Alpha', 20, {
  recipeUnlocked: true,
  acquisition: { sources: [], locations: [], factions: [], crafting: { knownSoftcore: true, knownHardcore: false } }
})
const awakened = item('Beta', 40, { awakeningSourceRecord: 'records/source.dbr' })
const mastery = item('Gamma', 60, {
  presentation: { sections: [{ kind: 'base', lines: [line('to all skills in Shaman', 'mastery', 1)] }] }
})
const items = shallowRef([craftable, awakened, mastery])
const snapshot = shallowRef({ items: items.value, skillClassNames: { 'Occultist|Shaman': 'Conjurer' }, skillMasteries: { 'Wendigo Totem': 'Shaman' } })
const archived = new Set(['records/source.dbr'])
const problems = []
let discover = async () => []
const scope = effectScope()
const session = scope.run(() => createLevelingPlannerSession({
  initialPreferences: repository.value,
  items: () => items.value, snapshot: () => snapshot.value,
  skillNames: () => ['Wendigo Totem', 'Curse of Frailty'],
  archivedRecords: () => archived,
  isArchivedItem: (candidate) => archived.has(candidate.record),
  ownershipLabel: () => null,
  itemSearchDocument: (candidate) => ({ text: candidate.name, fields: {} }),
  formatPresentationLine: (value) => `${value.minimum} ${value.label}`,
  persistPlanner: (patch) => repository.update('planner', copy(patch)),
  persistDisplay: (plannerDisplay) => repository.update('appearance', { plannerDisplay }),
  listCharacters: () => discover(), readableError: (error) => error.message,
  reportProblem: (message) => problems.push(message), reportSuccess: () => {}
}))
try {
  assert.deepEqual(session.plannerRows.value.map(({ item }) => item.name), ['Alpha', 'Beta'])
  assert.ok(session.plannerResearchRows.value.every((row) => row.available), 'Crafting and archived awakening sources remain available')
  assert.equal(session.recipeStatus(craftable).label, 'Recipe learned (SC)')
  session.togglePlannerIgnored(craftable)
  await nextTick()
  assert.deepEqual(session.plannerRows.value.map(({ item }) => item.name), ['Beta'])
  session.selectPlannerProfile('hardcore')
  await nextTick()
  assert.equal(session.plannerIgnoredRecords.value.length, 0)
  assert.equal(session.plannerResearchRows.value.find((row) => row.item.name === 'Alpha').available, false)
  assert.equal(session.recipeStatus(craftable).label, 'Recipe not learned (HC)')
  session.togglePlannerFavorite(awakened)
  await nextTick()
  session.selectPlannerProfile('softcore')
  await nextTick()
  assert.equal(session.plannerIgnoredRecords.value[0], researchItemPreferenceKey(craftable))
  assert.equal(session.isPlannerFavorite(awakened), true, 'Favorites retain their existing cross-plan scope')
  assert.deepEqual(repository.value.planner.ignoredRecords, ['legacy-unassigned'])

  session.plannerShowIgnored.value = true
  await nextTick()
  assert.deepEqual(session.plannerRows.value.map(({ item }) => item.name), ['Alpha'])
  session.plannerShowIgnored.value = false
  session.togglePlannerIgnored(craftable)
  session.sortPlannerTable('level')
  await nextTick()
  assert.deepEqual(session.plannerRows.value.map(({ item }) => item.name), ['Beta', 'Alpha'])
  session.sortPlannerTable('name')
  assert.equal(session.plannerSortDirection.value, 'asc')
  session.plannerMinimumLevelDraft.value = 35
  session.commitPlannerMinimumLevel()
  await nextTick()
  assert.deepEqual(session.plannerRows.value.map(({ item }) => item.name), ['Beta'])
  assert.equal(repository.value.planner.profiles[0].minimumLevel, 35)
  session.plannerLevelCapDraft.value = 10
  session.commitPlannerLevelCap()
  await nextTick()
  assert.equal(session.plannerLevelCap.value, 35)

  const savedProfiles = copy(session.plannerProfiles.value)
  const route = { ...copy(session.routeControls.value), profileId: 'hardcore', skills: ['Wendigo Totem'],
    minimumLevel: 1, maximumLevel: 100, query: '', display: 'map', page: 3,
    mapScope: 'all', atlasQuery: '', atlasRegion: 'base:fixture area:', mapSort: 'name', mapDirection: 'asc' }
  session.restoreRoute(route)
  await nextTick()
  assert.deepEqual(copy(session.routeControls.value), route, 'Route restoration retains page and area through reactive flush')
  assert.deepEqual(copy(session.plannerProfiles.value), savedProfiles, 'History does not overwrite stored profiles')
  assert.equal(session.selectedAtlasItems.value.length, 2)
  assert.ok(session.atlasMapPins.value.every((pin) => Number.isFinite(pin.left) && Number.isFinite(pin.top)))
  const forward = { ...route, profileId: 'softcore', query: 'Alpha', page: 2, display: 'journey' }
  session.restoreRoute(forward)
  await nextTick()
  session.restoreRoute(route)
  await nextTick()
  assert.deepEqual(copy(session.routeControls.value), route, 'Back/Forward restores all Planner controls')
  session.plannerQuery.value = 'Beta'
  await nextTick()
  assert.equal(session.plannerPage.value, 1, 'User filter changes reset paging outside history restoration')
  assert.equal(repository.value.appearance.plannerDisplay, 'map')

  session.openPlannerSetup()
  session.completePlannerSetup({ source: 'blank', name: 'New plan', className: 'Conjurer', masteries: ['Shaman'],
    skills: [], minimumLevel: 1, levelCap: 100 })
  await nextTick()
  assert.equal(session.plannerSetupOpen.value, false)
  assert.deepEqual(session.plannerIgnoredRecords.value, [])
  session.plannerQuery.value = ''
  await nextTick()
  assert.deepEqual(session.plannerRows.value.map(({ item }) => item.name), ['Gamma'], 'Mastery-only plans retain mastery-wide matches')
  session.plannerSkillDraft.value = 'curse of frailty'
  session.addPlannerSkill()
  await nextTick()
  assert.deepEqual(session.plannerSkills.value, ['Curse of Frailty'])
  session.removePlannerSkill('Curse of Frailty')
  await nextTick()
  session.deletePlannerProfile()
  await nextTick()
  assert.equal(session.plannerProfiles.value.length, 2)

  let finishDiscovery
  discover = () => new Promise((resolve) => { finishDiscovery = resolve })
  const pending = session.loadCharacterProfiles()
  assert.equal(session.characterImportLoading.value, true)
  await session.loadCharacterProfiles()
  finishDiscovery([])
  await pending
  assert.equal(session.characterImportLoading.value, false)
  discover = async () => { throw new Error('Synthetic discovery failure') }
  await session.loadCharacterProfiles()
  assert.equal(session.characterImportError.value, 'Synthetic discovery failure')
  assert.equal(session.characterImportLoading.value, false)

  session.buildFromOracle({ skill: 'Wendigo Totem', relatedSkills: ['Wendigo Totem', 'Curse of Frailty'] }, 10, 100)
  await nextTick()
  assert.deepEqual(session.plannerSkills.value, ['Wendigo Totem', 'Curse of Frailty'])
  assert.equal(session.plannerQuery.value, '')
  assert.equal(session.plannerOwnership.value, 'all')
  const reloaded = createPreferenceRepository(storage)
  assert.deepEqual(copy(reloaded.value.planner), copy(repository.value.planner), 'Extracted session persists through the production preference repository')
  items.value = []
  snapshot.value = { ...snapshot.value, items: [] }
  await nextTick()
  assert.equal(session.plannerRows.value.length, 0)
  assert.equal(session.atlasMapPins.value.length, 0)
  assert.equal(session.selectedAtlasRegion.value, null)
} finally {
  scope.stop()
}

const many = Array.from({ length: 20_000 }, (_, index) => item(`Fixture ${index}`, 1 + index % 100))
const started = performance.now()
const projected = buildPlannerRows({
  items: many, controls: { skills: ['Wendigo Totem'], minimumLevel: 1, maximumLevel: 100,
    ownership: 'all', sort: 'level', direction: 'asc', showIgnored: false }, masteries: [],
  query: compileSearchQuery(''), searchDocument: (candidate) => ({ text: candidate.name }),
  isArchivedItem: () => false, formatPresentationLine: (value) => value.label, ignoredRecords: new Set()
})
const projectionMs = performance.now() - started
assert.equal(projected.length, many.length)
assert.ok(projectionMs < 5000, `20k projection exceeded 5s: ${projectionMs}`)
const app = await readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8')
const workspace = await readFile(new URL('../src/renderer/src/workspaces/LevelingPlannerWorkspace.vue', import.meta.url), 'utf8')
const model = await readFile(new URL('../src/renderer/src/workspaces/leveling-planner.ts', import.meta.url), 'utf8')
assert.match(app, /<LevelingPlannerWorkspace[\s\S]*?:session="plannerSession"/)
assert.match(app, /plannerSession.restoreRoute\(route.controls\)/)
assert.match(app, /controls: plannerSession.routeControls.value/)
assert.doesNotMatch(app, /const plannerProfiles =|const plannerResearchRows =|function selectPlannerProfile|class="planner-controls"/)
assert.doesNotMatch(model, /window\.|document\.|localStorage/)
assert.doesNotMatch(workspace, /window\.cairnCodex|preferenceRepository|compileSearchQuery/)
assert.match(workspace, /@scroll-tooltip="scrollTooltip"/)
console.log(`Planner workspace passed: session isolation, profiles, history, persistence, recipes, map, discovery states, and pure 20k projection (${projectionMs.toFixed(1)} ms). Shared table/Journey retain 50-row batches and continuous-scroll gates.`)
