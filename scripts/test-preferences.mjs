import assert from 'node:assert/strict'
import {
  createPreferenceRepository,
  MAX_PLANNER_PROFILES,
  PREFERENCE_STORAGE_KEY
} from '../src/renderer/src/preference-repository.ts'

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
}

const fixedNow = () => '2026-09-01T08:00:00.000Z'
let nextId = 0
const createId = () => `profile-${++nextId}`

const freshStorage = new MemoryStorage()
const fresh = createPreferenceRepository(freshStorage, fixedNow, createId)
assert.equal(fresh.diagnostics.source, 'fresh')
assert.equal(fresh.value.meta.profileKind, 'fresh')
assert.equal(fresh.value.workspace.experimentalToolsEnabled, false)
assert.equal(fresh.value.onboarding.status, 'in-progress')

const legacyStorage = new MemoryStorage()
legacyStorage.setItem('cairn-codex-workspace-tools-version', '1')
legacyStorage.setItem('cairn-codex-visible-workspace-tools', JSON.stringify(['sets', 'oracle']))
legacyStorage.setItem('cairn-codex-planner-profiles', JSON.stringify([{
  id: 'build-1', name: 'Pet build', skills: ['Summon Briarthorn'], excludedSkills: [],
  minimumLevel: 12, levelCap: 94, source: 'manual', modifiedAt: fixedNow()
}]))
legacyStorage.setItem('cairn-codex-planner-profile', 'build-1')
legacyStorage.setItem('cairn-codex-todos', JSON.stringify([{
  id: 'todo-1', text: 'Farm the set', done: false, createdAt: fixedNow()
}]))
legacyStorage.setItem('cairn-codex-archive-sources', JSON.stringify(['archive-a']))
legacyStorage.setItem('cairn-codex-index-sources', JSON.stringify(['stash-a']))
legacyStorage.setItem('cairn-codex-collection-basis-default-version', '2')
legacyStorage.setItem('cairn-codex-collection-basis', 'stashes')
legacyStorage.setItem('cairn-codex-onboarding-version', '1')
legacyStorage.setItem('cairn-codex-onboarding-status', 'completed')
legacyStorage.setItem('cairn-codex-onboarding-step', '3')

const migrated = createPreferenceRepository(legacyStorage, fixedNow, createId)
assert.equal(migrated.diagnostics.source, 'legacy')
assert.equal(migrated.diagnostics.migrated, true)
assert.equal(migrated.value.meta.profileKind, 'returning')
assert.equal(migrated.value.workspace.experimentalToolsEnabled, true)
assert.ok(migrated.value.workspace.visibleTools.includes('dismantling'))
assert.equal(migrated.value.planner.profiles[0]?.name, 'Pet build')
assert.equal(migrated.value.planner.profiles[0]?.className, undefined)
assert.equal(migrated.value.planner.profiles[0]?.masteries, undefined)
assert.equal(migrated.value.notes.todos[0]?.text, 'Farm the set')
assert.equal(migrated.value.sources.collectionBasis, 'stashes')
assert.deepEqual(migrated.value.sources.archivePaths, ['archive-a'])
assert.equal(migrated.value.onboarding.status, 'completed')

const beforeResetPlanner = JSON.stringify(migrated.value.planner)
const beforeResetNotes = JSON.stringify(migrated.value.notes)
const beforeResetSources = JSON.stringify(migrated.value.sources)
migrated.update('workspace', { miCountingMode: 'tier' })
migrated.update('search', { selectedSkill: 'Raise Skeletons' })
assert.equal(migrated.resetInterface(), 3)
assert.equal(migrated.value.workspace.miCountingMode, 'base')
assert.equal(migrated.value.search.selectedSkill, 'Wendigo Totem')
assert.equal(JSON.stringify(migrated.value.planner), beforeResetPlanner)
assert.equal(JSON.stringify(migrated.value.notes), beforeResetNotes)
assert.equal(JSON.stringify(migrated.value.sources), beforeResetSources)

const plannerMetadataStorage = new MemoryStorage()
const plannerMetadataPreferences = JSON.parse(fresh.exportJson())
plannerMetadataPreferences.planner = {
  profiles: [{
    id: 'build-2', name: 'Death Knight', className: 'Death Knight', masteries: ['Necromancer', 'Soldier'],
    skills: ['Raise Skeletons', 'Field Command'], excludedSkills: [], minimumLevel: 1, levelCap: 100,
    source: 'manual', modifiedAt: fixedNow()
  }],
  selectedProfileId: 'build-2', ignoredRecords: [], favoriteRecords: []
}
plannerMetadataStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(plannerMetadataPreferences))
const plannerMetadata = createPreferenceRepository(plannerMetadataStorage, fixedNow, createId)
assert.equal(plannerMetadata.value.planner.profiles[0]?.className, 'Death Knight')
assert.deepEqual(plannerMetadata.value.planner.profiles[0]?.masteries, ['Necromancer', 'Soldier'])

const recoverablePlannerStorage = new MemoryStorage()
const recoverablePlannerPreferences = JSON.parse(fresh.exportJson())
recoverablePlannerPreferences.planner.profiles = [{ name: 'Old custom build', skills: ['Field Command'] }]
recoverablePlannerPreferences.planner.selectedProfileId = 'missing-id'
recoverablePlannerStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(recoverablePlannerPreferences))
const recoverablePlanner = createPreferenceRepository(recoverablePlannerStorage, fixedNow, createId)
assert.equal(recoverablePlanner.value.planner.profiles.length, 1)
assert.equal(recoverablePlanner.value.planner.profiles[0]?.name, 'Old custom build')
assert.match(recoverablePlanner.value.planner.profiles[0]?.id ?? '', /^recovered-[0-9a-f]{8}$/)
assert.equal(recoverablePlanner.value.planner.profiles[0]?.levelCap, 70)
assert.equal(
  recoverablePlanner.value.planner.selectedProfileId,
  recoverablePlanner.value.planner.profiles[0]?.id
)

const boundedPlannerStorage = new MemoryStorage()
const boundedPlannerPreferences = JSON.parse(fresh.exportJson())
boundedPlannerPreferences.planner.profiles = Array.from({ length: MAX_PLANNER_PROFILES + 5 }, (_, index) =>
  index < 2
    ? { name: 'Duplicate recovered build', skills: ['Field Command'] }
    : { id: `bounded-${index}`, name: `Bounded build ${index}`, skills: [] }
)
boundedPlannerPreferences.planner.selectedProfileId = 'missing-bounded-id'
boundedPlannerStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(boundedPlannerPreferences))
const boundedPlanner = createPreferenceRepository(boundedPlannerStorage, fixedNow, createId)
assert.equal(boundedPlanner.value.planner.profiles.length, MAX_PLANNER_PROFILES - 1)
assert.equal(
  new Set(boundedPlanner.value.planner.profiles.map(({ id }) => id)).size,
  boundedPlanner.value.planner.profiles.length
)
assert.equal(boundedPlanner.value.planner.selectedProfileId, boundedPlanner.value.planner.profiles[0]?.id)
assert.ok(boundedPlanner.diagnostics.invalidFields.includes('planner.profiles'))
assert.ok(boundedPlanner.diagnostics.invalidFields.includes('planner.selectedProfileId'))

const corruptStorage = new MemoryStorage()
const corrupt = JSON.parse(fresh.exportJson())
corrupt.appearance.zoomFactor = 'huge'
corrupt.workspace.visibleTools = 'everything'
corrupt.search.oracleMinimumLevel = null
corrupt.notes.todos = [{ id: 'invalid' }]
corruptStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(corrupt))
const recovered = createPreferenceRepository(corruptStorage, fixedNow, createId)
assert.equal(recovered.diagnostics.source, 'stored')
assert.ok(recovered.diagnostics.invalidFields.includes('appearance.zoomFactor'))
assert.ok(recovered.diagnostics.invalidFields.includes('workspace.visibleTools'))
assert.ok(recovered.diagnostics.invalidFields.includes('search.oracleMinimumLevel'))
assert.ok(recovered.diagnostics.invalidFields.includes('notes.todos'))
assert.equal(recovered.value.appearance.zoomFactor, 1)
assert.deepEqual(recovered.value.notes.todos, [])

const exported = JSON.parse(migrated.exportJson())
assert.equal(exported.version, 1)
assert.equal('archive' in exported, false)
assert.equal('database' in exported, false)

console.log(JSON.stringify({
  passed: true,
  freshDefaults: true,
  returningMigration: true,
  fieldRecovery: recovered.diagnostics.invalidFields,
  nonDestructiveReset: true,
  plannerMetadataRoundTrip: true,
  recoverablePlannerProfilesPreserved: true,
  boundedPlannerProfiles: boundedPlanner.value.planner.profiles.length,
  settingsOnlyExport: true
}, null, 2))
