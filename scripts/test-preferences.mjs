import assert from 'node:assert/strict'
import {
  canonicalPreferenceCandidate,
  createPreferenceRepository,
  PREFERENCE_STORAGE_KEY
} from '../src/renderer/src/preference-repository.ts'
import { isPreferenceDocument } from '../src/shared/preference-schema.ts'

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
}

const fixedNow = () => '2026-09-01T08:00:00.000Z'
let nextId = 0
const createId = () => `profile-${++nextId}`

const freshStorage = new MemoryStorage()
assert.equal(canonicalPreferenceCandidate(freshStorage, fixedNow, createId), null)
const fresh = createPreferenceRepository(freshStorage, fixedNow, createId)
assert.equal(fresh.diagnostics.source, 'fresh')
assert.equal(fresh.value.meta.profileKind, 'fresh')
assert.equal(fresh.value.workspace.experimentalToolsEnabled, false)
assert.equal(fresh.value.appearance.tooltipBoundaryScroll, 'page')
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

const legacyCandidate = JSON.parse(canonicalPreferenceCandidate(legacyStorage, fixedNow, createId))
assert.equal(legacyCandidate.meta.profileKind, 'returning')
assert.equal(legacyCandidate.meta.updatedAtUtc, '1970-01-01T00:00:00.000Z')
assert.equal(legacyCandidate.planner.profiles[0]?.name, 'Pet build')

const malformedLegacyStorage = new MemoryStorage()
malformedLegacyStorage.setItem('cairn-codex-skill', 'x'.repeat(500))
malformedLegacyStorage.setItem('cairn-codex-retrieval-stash', 'y'.repeat(5000))
const malformedLegacyCandidate = JSON.parse(canonicalPreferenceCandidate(
  malformedLegacyStorage,
  fixedNow,
  createId
))
assert.equal(isPreferenceDocument(malformedLegacyCandidate), true)
assert.equal(malformedLegacyCandidate.search.selectedSkill.length, 200)
assert.equal(malformedLegacyCandidate.sources.retrievalStash.length, 4096)

const oversizedLegacyStorage = new MemoryStorage()
const maximumPaths = Array.from({ length: 512 }, (_, index) => `${index}-${'x'.repeat(4090)}`)
oversizedLegacyStorage.setItem('cairn-codex-archive-sources', JSON.stringify(maximumPaths))
oversizedLegacyStorage.setItem('cairn-codex-index-sources', JSON.stringify(maximumPaths))
assert.equal(canonicalPreferenceCandidate(oversizedLegacyStorage, fixedNow, createId), null)

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
assert.equal(migrated.value.appearance.tooltipBoundaryScroll, 'page')

migrated.update('appearance', { tooltipBoundaryScroll: 'contain' })
assert.equal(JSON.parse(migrated.exportJson()).appearance.tooltipBoundaryScroll, 'contain')

const beforeResetPlanner = JSON.stringify(migrated.value.planner)
const scopedStorage = new MemoryStorage()
const scoped = createPreferenceRepository(scopedStorage, fixedNow, createId)
const profileTemplate = scoped.value.planner.profiles[0]
scoped.update('planner', { profiles: [
  { ...profileTemplate, id: 'plan-a', ignoredRecords: ['mi:legs:fixture'] },
  { ...profileTemplate, id: 'plan-b' }
], selectedProfileId: 'plan-b', ignoredRecords: ['legacy-global-base'] })
const scopedReload = createPreferenceRepository(scopedStorage, fixedNow, createId)
assert.deepEqual(scopedReload.value.planner.profiles[0].ignoredRecords, ['mi:legs:fixture'])
assert.deepEqual(scopedReload.value.planner.profiles[1].ignoredRecords ?? [], [])
assert.deepEqual(scopedReload.value.planner.ignoredRecords, ['legacy-global-base'], 'Unassigned legacy exclusions remain recoverable')
assert.equal(isPreferenceDocument(scopedReload.value), true)
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
assert.equal(recoverablePlanner.value.planner.selectedProfileId, recoverablePlanner.value.planner.profiles[0]?.id)

const unknownProfileStorage = new MemoryStorage()
const unknownProfilePreferences = JSON.parse(fresh.exportJson())
unknownProfilePreferences.planner.profiles[0].unexpected = { archive: 'leak' }
unknownProfileStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(unknownProfilePreferences))
const unknownProfile = createPreferenceRepository(unknownProfileStorage, fixedNow, createId)
assert.equal('unexpected' in unknownProfile.value.planner.profiles[0], false)
assert.equal(JSON.parse(unknownProfile.exportJson()).planner.profiles[0].unexpected, undefined)

const oversizedProfileStorage = new MemoryStorage()
const oversizedProfilePreferences = JSON.parse(fresh.exportJson())
oversizedProfilePreferences.planner.profiles = Array.from({ length: 250 }, () => ({}))
oversizedProfilePreferences.planner.selectedProfileId = 'missing-id'
oversizedProfileStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(oversizedProfilePreferences))
const oversizedProfiles = createPreferenceRepository(oversizedProfileStorage, fixedNow, createId)
assert.equal(oversizedProfiles.value.planner.profiles.length, 100)
assert.equal(new Set(oversizedProfiles.value.planner.profiles.map(({ id }) => id)).size, 100)
assert.ok(oversizedProfiles.diagnostics.invalidFields.includes('planner.profiles'))

const corruptStorage = new MemoryStorage()
const corrupt = JSON.parse(fresh.exportJson())
corrupt.meta.updatedAtUtc = '2025-01-02T03:04:05.000Z'
corrupt.appearance.zoomFactor = 'huge'
corrupt.appearance.tooltipBoundaryScroll = 'somewhere'
corrupt.workspace.visibleTools = 'everything'
corrupt.search.oracleMinimumLevel = null
corrupt.notes.todos = [{ id: 'invalid' }]
corrupt.unexpected = { archive: 'must not persist' }
corruptStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(corrupt))
const corruptCandidate = JSON.parse(canonicalPreferenceCandidate(corruptStorage, fixedNow, createId))
assert.equal(corruptCandidate.meta.updatedAtUtc, '2025-01-02T03:04:05.000Z')
assert.equal(corruptCandidate.unexpected, undefined)
assert.equal(corruptCandidate.appearance.zoomFactor, 1)

const timestamplessStorage = new MemoryStorage()
const timestampless = structuredClone(corrupt)
delete timestampless.meta.updatedAtUtc
timestamplessStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(timestampless))
const timestamplessCandidate = JSON.parse(canonicalPreferenceCandidate(
  timestamplessStorage,
  fixedNow,
  createId
))
assert.equal(timestamplessCandidate.meta.updatedAtUtc, '1970-01-01T00:00:00.000Z')

const malformedRecordsStorage = new MemoryStorage()
const malformedRecords = structuredClone(corrupt)
malformedRecords.meta.updatedAtUtc = ''
malformedRecords.planner.profiles[0].modifiedAt = ''
malformedRecords.notes.todos = [
  { id: '', text: 'Empty id', done: false, createdAt: fixedNow() },
  { id: 'x'.repeat(201), text: 'Long id', done: false, createdAt: fixedNow() },
  { id: 'valid', text: 'Bad timestamp', done: false, createdAt: '' }
]
malformedRecordsStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(malformedRecords))
const malformedRecordsCandidate = JSON.parse(canonicalPreferenceCandidate(
  malformedRecordsStorage,
  fixedNow,
  createId
))
assert.equal(isPreferenceDocument(malformedRecordsCandidate), true)
assert.equal(malformedRecordsCandidate.meta.updatedAtUtc, '1970-01-01T00:00:00.000Z')
assert.equal(malformedRecordsCandidate.planner.profiles[0].modifiedAt, '1970-01-01T00:00:00.000Z')
assert.deepEqual(malformedRecordsCandidate.notes.todos, [])

const oversizedModernStorage = new MemoryStorage()
const oversizedModern = structuredClone(corrupt)
oversizedModern.sources.archivePaths = maximumPaths
oversizedModern.sources.indexPaths = maximumPaths
oversizedModernStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(oversizedModern))
assert.equal(canonicalPreferenceCandidate(oversizedModernStorage, fixedNow, createId), null)
const recovered = createPreferenceRepository(corruptStorage, fixedNow, createId)
assert.equal(recovered.diagnostics.source, 'stored')
assert.ok(recovered.diagnostics.invalidFields.includes('appearance.zoomFactor'))
assert.ok(recovered.diagnostics.invalidFields.includes('workspace.visibleTools'))
assert.ok(recovered.diagnostics.invalidFields.includes('search.oracleMinimumLevel'))
assert.ok(recovered.diagnostics.invalidFields.includes('notes.todos'))
assert.equal(recovered.value.appearance.zoomFactor, 1)
assert.equal(recovered.value.appearance.tooltipBoundaryScroll, 'page')
assert.ok(recovered.diagnostics.invalidFields.includes('appearance.tooltipBoundaryScroll'))
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
  settingsOnlyExport: true
}, null, 2))
