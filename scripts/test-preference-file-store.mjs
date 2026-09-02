import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  PREFERENCE_BACKUP_RETENTION,
  PreferenceFileStore
} from '../src/main/preference-file-store.ts'
import { validatePreferenceBootstrap } from '../src/main/ipc/validation.ts'

function preferences(profiles) {
  return {
    version: 1,
    meta: { profileKind: 'returning', updatedAtUtc: '2026-09-02T08:00:00.000Z' },
    planner: { profiles, selectedProfileId: profiles[0]?.id ?? '', ignoredRecords: [], favoriteRecords: [] },
    notes: { todos: [] }
  }
}

function profile(id, name, skill = 'Wendigo Totem') {
  return {
    id, name, skills: [skill], excludedSkills: [], minimumLevel: 1, levelCap: 100,
    source: 'manual', modifiedAt: '2026-09-02T08:00:00.000Z'
  }
}

function bootstrapThroughValidation(store, origin, candidateSerialized) {
  const validated = validatePreferenceBootstrap({ origin, candidateSerialized })
  return store.bootstrap(validated.origin, validated.candidateSerialized)
}

const directory = await mkdtemp(join(tmpdir(), 'cairn-preference-store-'))
const path = join(directory, 'preferences.json')

try {
  const store = new PreferenceFileStore(path)
  const packaged = JSON.stringify(preferences([profile('packaged', 'Packaged plan')]))
  const development = JSON.stringify(preferences([profile('development', 'Development plan')]))

  const seeded = await store.bootstrap('file://', packaged)
  assert.equal(seeded.importedOrigin, true)
  assert.deepEqual(JSON.parse(seeded.serialized).planner.profiles.map(({ id }) => id), ['packaged'])

  const healthyWithCorruptMirror = await bootstrapThroughValidation(store, 'file://', '{corrupt')
  assert.deepEqual(
    JSON.parse(healthyWithCorruptMirror.serialized).planner.profiles.map(({ id }) => id),
    ['packaged']
  )

  const emptyPath = join(directory, 'empty-preferences.json')
  const emptyStore = new PreferenceFileStore(emptyPath, join(directory, 'empty-backups'))
  const emptyWithCorruptMirror = await bootstrapThroughValidation(emptyStore, 'file://', '{corrupt')
  assert.equal(emptyWithCorruptMirror.serialized, null)

  const merged = await store.bootstrap('http://localhost:5173', development)
  assert.equal(merged.importedOrigin, true)
  assert.deepEqual(
    JSON.parse(merged.serialized).planner.profiles.map(({ id }) => id),
    ['packaged', 'development']
  )

  await store.save(JSON.stringify(preferences([profile('packaged', 'Packaged plan')])))
  const afterDelete = await store.bootstrap('http://localhost:5173', development)
  assert.equal(afterDelete.importedOrigin, false)
  assert.deepEqual(JSON.parse(afterDelete.serialized).planner.profiles.map(({ id }) => id), ['packaged'])

  const newerMirror = preferences([
    profile('packaged', 'Packaged plan'),
    profile('unsaved', 'Recovered unsaved plan')
  ])
  newerMirror.meta.updatedAtUtc = '2099-01-01T00:00:00.000Z'
  const recoveredMirror = await store.bootstrap('http://localhost:5173', JSON.stringify(newerMirror))
  assert.equal(recoveredMirror.importedOrigin, false)
  assert.deepEqual(
    JSON.parse(recoveredMirror.serialized).planner.profiles.map(({ id }) => id),
    ['packaged', 'unsaved']
  )

  await writeFile(path, '{corrupt', 'utf8')
  const recoveredStore = new PreferenceFileStore(path)
  const recovered = await recoveredStore.bootstrap('http://localhost:5173', development)
  assert.equal(recovered.recovered, true)
  assert.deepEqual(
    JSON.parse(recovered.serialized).planner.profiles.map(({ id }) => id),
    ['packaged']
  )

  for (let index = 0; index < PREFERENCE_BACKUP_RETENTION + 8; index += 1) {
    await recoveredStore.save(JSON.stringify(preferences([
      profile('packaged', 'Packaged plan', `Skill ${index}`),
      profile('development', 'Development plan')
    ])))
  }
  await recoveredStore.flush()
  const backups = (await readdir(join(directory, 'preference-backups')))
    .filter((name) => name.endsWith('.json'))
  assert.ok(backups.length <= PREFERENCE_BACKUP_RETENTION)
  const current = await readFile(path, 'utf8')
  assert.doesNotThrow(() => JSON.parse(current))
  assert.equal((await readdir(directory)).some((name) => name.endsWith('.tmp')), false)

  console.log(JSON.stringify({
    passed: true,
    originIndependent: true,
    corruptBrowserMirrorIgnored: true,
    deletionDoesNotResurrect: true,
    newerSameOriginMirrorRecovered: true,
    corruptPrimaryRecovered: true,
    retainedBackups: backups.length
  }, null, 2))
} finally {
  await rm(directory, { recursive: true, force: true })
}
