import assert from 'node:assert/strict'
import { effectScope, nextTick } from 'vue'
import { createPreferenceRepository } from '../src/renderer/src/preference-repository.ts'
import { createLevelingPlannerSession } from '../src/renderer/src/workspaces/leveling-planner.ts'

const copy = (value) => JSON.parse(JSON.stringify(value))
const character = {
  path: 'C:\\Synthetic\\_Refresh\\player.gdc', name: 'Fixture character', level: 84, isHardcore: true,
  classRecord: 'fixture', className: 'Conjurer', factions: [],
  skills: [{ record: 'fixture-skill', name: 'Wendigo Totem', level: 12, enabled: true }],
  lastWriteUtc: '2026-09-06T00:00:00.000Z', error: null
}
function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
async function scenario(run) {
  const storage = new Map()
  const repository = createPreferenceRepository({ getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) })
  const profile = { id: 'linked', name: 'Fixture plan', source: 'character', characterPath: character.path,
    characterLevel: 50, isHardcore: true, skills: [], masteries: [], excludedSkills: [], ignoredRecords: ['fixture-ignore'],
    minimumLevel: 30, levelCap: 94, modifiedAt: '2026-09-01T00:00:00.000Z' }
  repository.update('planner', { profiles: [profile, { ...profile, id: 'other', name: 'Other plan', source: 'manual' }], selectedProfileId: profile.id })
  let discover = async () => [copy(character)]
  let calls = 0
  const problems = [], successes = []
  const scope = effectScope()
  const session = scope.run(() => createLevelingPlannerSession({
    initialPreferences: repository.value, items: () => [], snapshot: () => null, skillNames: () => ['Wendigo Totem'],
    archivedRecords: () => new Set(), isArchivedItem: () => false, ownershipLabel: () => null,
    itemSearchDocument: () => ({ text: '' }), formatPresentationLine: () => '',
    persistPlanner: (patch) => repository.update('planner', copy(patch)), persistDisplay: () => {},
    listCharacters: () => { calls += 1; return discover() }, readableError: (error) => error.message,
    reportProblem: (message) => problems.push(message), reportSuccess: (message) => successes.push(message)
  }))
  try {
    const first = await session.loadCharacterProfiles()
    assert.equal(first.status, 'success')
    assert.equal(first.characters[0].level, 84)
    await nextTick()
    await run({ session, repository, problems, successes, setDiscovery: (value) => { discover = value }, calls: () => calls })
  } finally { scope.stop() }
}

await scenario(async ({ session, repository, setDiscovery, problems, successes }) => {
  const before = copy(repository.value.planner)
  setDiscovery(async () => { throw new Error('Synthetic failure') })
  await session.refreshSelectedCharacterProfile()
  await nextTick()
  assert.equal(session.discoveredCharacters.value.length, 1, 'Stale display cache remains populated for this regression')
  assert.equal(session.characterImportError.value, 'Synthetic failure')
  assert.deepEqual(copy(repository.value.planner), before, 'A failed refresh cannot import the stale cached save')
  assert.equal(successes.length, 0)
  assert.match(problems[0], /Synthetic failure/)
  assert.equal(session.characterImportLoading.value, false)
})
for (const result of [[], [{ ...character, error: 'Synthetic unreadable save' }]]) {
  await scenario(async ({ session, repository, setDiscovery, problems, successes }) => {
    const before = copy(repository.value.planner)
    setDiscovery(async () => copy(result))
    await session.refreshSelectedCharacterProfile()
    await nextTick()
    assert.deepEqual(copy(repository.value.planner), before, 'Missing or unreadable saves preserve the plan')
    assert.equal(successes.length, 0)
    assert.equal(problems.length, 1)
  })
}
await scenario(async ({ session, repository, successes, problems }) => {
  await session.refreshSelectedCharacterProfile()
  await nextTick()
  const refreshed = repository.value.planner.profiles.find((profile) => profile.id === 'linked')
  assert.equal(refreshed.characterLevel, 84)
  assert.deepEqual(refreshed.skills, ['Wendigo Totem'])
  assert.deepEqual(refreshed.ignoredRecords, ['fixture-ignore'])
  assert.equal(refreshed.minimumLevel, 30)
  assert.equal(refreshed.isHardcore, true)
  assert.equal(repository.value.planner.selectedProfileId, 'linked')
  assert.equal(successes.length, 1)
  assert.equal(problems.length, 0)
})
for (const change of ['switch', 'switch-back', 'delete', 'route']) {
  await scenario(async ({ session, repository, setDiscovery, successes }) => {
    const wait = deferred()
    setDiscovery(() => wait.promise)
    const pending = session.refreshSelectedCharacterProfile()
    if (change === 'delete') session.deletePlannerProfile()
    else if (change === 'route') session.restoreRoute({ ...copy(session.routeControls.value), profileId: 'other' })
    else {
      session.selectPlannerProfile('other')
      if (change === 'switch-back') session.selectPlannerProfile('linked')
    }
    await nextTick()
    const afterSelection = copy(repository.value.planner)
    wait.resolve([copy(character)])
    await pending
    await nextTick()
    assert.deepEqual(copy(repository.value.planner), afterSelection, `${change} cancels the old selection's refresh`)
    assert.equal(successes.length, 0)
    if (change === 'delete') assert.equal(session.plannerProfiles.value.some((profile) => profile.id === 'linked'), false)
  })
}
await scenario(async ({ session, repository, setDiscovery, successes, calls }) => {
  const before = copy(repository.value.planner)
  const wait = deferred()
  setDiscovery(() => wait.promise)
  const discovery = session.loadCharacterProfiles()
  assert.equal((await session.loadCharacterProfiles()).status, 'busy')
  await session.refreshSelectedCharacterProfile()
  assert.deepEqual(copy(repository.value.planner), before)
  assert.equal(calls(), 2, 'An in-flight discovery cannot trigger another discovery or stale import')
  wait.resolve([copy(character)])
  await discovery
  assert.equal(successes.length, 0)
})
console.log('Planner refresh passed: stale failure, disappeared/unreadable sources, successful refresh, busy discovery and selection/deletion/history races; synthetic profiles only.')
