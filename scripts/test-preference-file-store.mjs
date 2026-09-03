import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  MAX_PREFERENCE_ENVELOPE_BYTES,
  PREFERENCE_BACKUP_RETENTION,
  PreferenceFileStore
} from '../src/main/preference-file-store.ts'
import { validateSerializedPreferences } from '../src/main/ipc/validation.ts'
import { canonicalPreferenceCandidate } from '../src/renderer/src/preference-repository.ts'
import { MAX_PREFERENCE_BYTES } from '../src/shared/preference-schema.ts'

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
}

function preferences(profiles) {
  return {
    version: 1,
    meta: { profileKind: 'returning', updatedAtUtc: '2026-09-02T08:00:00.000Z' },
    appearance: { theme: 'cairn', zoomFactor: 1, trackerCollapsed: false, plannerDisplay: 'list', tooltipBoundaryScroll: 'page' },
    workspace: {
      visibleTools: ['sets', 'skills', 'planner'], experimentalToolsEnabled: false,
      showLegacyScanner: false, miCountingMode: 'base'
    },
    search: {
      selectedSkill: 'Wendigo Totem', skillScope: 'all', oracleClass: 'all', oracleStyle: 'all',
      oracleMinimumLevel: 1, oracleMaximumLevel: 100
    },
    planner: { profiles, selectedProfileId: profiles[0]?.id ?? '', ignoredRecords: [], favoriteRecords: [] },
    notes: { todos: [] },
    sources: {
      collectionBasis: 'archive', archivePaths: [], indexPaths: [], retrievalStash: '', autoLiveConnect: true
    },
    onboarding: { version: 1, status: 'completed', step: 3 }
  }
}

function profile(id, name, skill = 'Wendigo Totem') {
  return {
    id, name, skills: [skill], excludedSkills: [], minimumLevel: 1, levelCap: 100,
    source: 'manual', modifiedAt: '2026-09-02T08:00:00.000Z'
  }
}

const directory = await mkdtemp(join(tmpdir(), 'cairn-preference-store-'))
const path = join(directory, 'preferences.json')

try {
  const store = new PreferenceFileStore(path)
  const packaged = JSON.stringify(preferences([profile('packaged', 'Packaged plan')]))
  const development = JSON.stringify(preferences([profile('development', 'Development plan')]))
  assert.doesNotThrow(() => validateSerializedPreferences({ serialized: packaged }))
  const unexpected = preferences([profile('unexpected', 'Unexpected payload')])
  unexpected.planner.profiles[0].archive = { payload: 'must not persist' }
  assert.throws(
    () => validateSerializedPreferences({ serialized: JSON.stringify(unexpected) }),
    /supported schema/
  )

  const seeded = await store.bootstrap('file://', packaged)
  assert.equal(seeded.importedOrigin, true)
  assert.deepEqual(JSON.parse(seeded.serialized).planner.profiles.map(({ id }) => id), ['packaged'])

  const merged = await store.bootstrap('http://localhost:5173', development)
  assert.equal(merged.importedOrigin, true)
  assert.deepEqual(
    JSON.parse(merged.serialized).planner.profiles.map(({ id }) => id),
    ['packaged', 'development']
  )

  await store.save(JSON.stringify(preferences([profile('packaged', 'Packaged plan')])))
  const afterEmptyOrigin = await store.bootstrap('http://localhost:5173', null)
  assert.equal(afterEmptyOrigin.importedOrigin, false)
  assert.deepEqual(
    JSON.parse(afterEmptyOrigin.serialized).planner.profiles.map(({ id }) => id),
    ['packaged']
  )

  const staleMirror = preferences([profile('stale', 'Stale browser plan')])
  staleMirror.meta.updatedAtUtc = '2025-01-01T00:00:00.000Z'
  const afterStaleMirror = await store.bootstrap('http://localhost:5173', JSON.stringify(staleMirror))
  assert.equal(afterStaleMirror.importedOrigin, false)
  assert.deepEqual(
    JSON.parse(afterStaleMirror.serialized).planner.profiles.map(({ id }) => id),
    ['packaged']
  )

  const legacyOnlyStorage = new MemoryStorage()
  legacyOnlyStorage.setItem('cairn-codex-planner-skills', JSON.stringify(['Stale legacy skill']))
  const legacyOnlyCandidate = canonicalPreferenceCandidate(
    legacyOnlyStorage,
    () => '2099-01-01T00:00:00.000Z',
    () => 'stale-legacy-profile'
  )
  assert.equal(JSON.parse(legacyOnlyCandidate).meta.updatedAtUtc, '1970-01-01T00:00:00.000Z')
  const afterRetainedLegacy = await store.bootstrap('http://localhost:5173', legacyOnlyCandidate)
  assert.equal(afterRetainedLegacy.importedOrigin, false)
  assert.deepEqual(
    JSON.parse(afterRetainedLegacy.serialized).planner.profiles.map(({ id }) => id),
    ['packaged']
  )

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

  await writeFile(path, 'x'.repeat(MAX_PREFERENCE_ENVELOPE_BYTES + 1), 'utf8')
  const oversizedStore = new PreferenceFileStore(path)
  const oversizedRecovered = await oversizedStore.bootstrap('http://localhost:5173', null)
  assert.equal(oversizedRecovered.recovered, true)
  assert.deepEqual(
    JSON.parse(oversizedRecovered.serialized).planner.profiles.map(({ id }) => id),
    ['packaged']
  )

  const envelopeWithExtraMetadata = JSON.parse(await readFile(path, 'utf8'))
  envelopeWithExtraMetadata.unexpected = 'must be rejected'
  await writeFile(path, JSON.stringify(envelopeWithExtraMetadata), 'utf8')
  const extraMetadataStore = new PreferenceFileStore(path)
  const extraMetadataRecovered = await extraMetadataStore.bootstrap('http://localhost:5173', null)
  assert.equal(extraMetadataRecovered.recovered, true)
  assert.deepEqual(
    JSON.parse(extraMetadataRecovered.serialized).planner.profiles.map(({ id }) => id),
    ['packaged']
  )

  await writeFile(path, '{corrupt', 'utf8')
  const recoveredStore = new PreferenceFileStore(path)
  const recovered = await recoveredStore.bootstrap('http://localhost:5173', development)
  assert.equal(recovered.recovered, true)
  assert.deepEqual(
    JSON.parse(recovered.serialized).planner.profiles.map(({ id }) => id),
    ['packaged']
  )

  const denseSkill = `Skill-${'x'.repeat(70)}`
  const denseProfiles = Array.from({ length: 100 }, (_, index) => ({
    ...profile(`dense-${index}`, `Dense plan ${index}`),
    skills: Array(128).fill(denseSkill),
    excludedSkills: Array(128).fill(denseSkill)
  }))
  const nearLimitSerialized = JSON.stringify(preferences(denseProfiles))
  const nearLimitBytes = Buffer.byteLength(nearLimitSerialized, 'utf8')
  assert.ok(nearLimitBytes > MAX_PREFERENCE_BYTES - 128 * 1024)
  assert.ok(nearLimitBytes <= MAX_PREFERENCE_BYTES)
  assert.doesNotThrow(() => validateSerializedPreferences({ serialized: nearLimitSerialized }))
  const nearLimitPath = join(directory, 'near-limit', 'preferences.json')
  const nearLimitStore = new PreferenceFileStore(nearLimitPath)
  const nearLimitResult = await nearLimitStore.bootstrap('file://', nearLimitSerialized)
  assert.equal(JSON.parse(nearLimitResult.serialized).planner.profiles.length, 100)
  assert.ok((await readFile(nearLimitPath)).byteLength <= MAX_PREFERENCE_ENVELOPE_BYTES)

  const originCapPath = join(directory, 'origin-cap', 'preferences.json')
  const originCapStore = new PreferenceFileStore(originCapPath)
  await originCapStore.bootstrap('test-origin-0', JSON.stringify(preferences([
    profile('origin-0', 'Origin zero')
  ])))
  for (let index = 1; index < 32; index += 1) {
    const result = await originCapStore.bootstrap(`test-origin-${index}`, JSON.stringify(preferences([
      profile(`origin-${index}`, `Origin ${index}`)
    ])))
    assert.equal(result.importedOrigin, true)
  }
  const unknownFuture = preferences([profile('origin-32', 'Ignored origin')])
  unknownFuture.meta.updatedAtUtc = '2099-01-01T00:00:00.000Z'
  const cappedOrigin = await originCapStore.bootstrap('test-origin-32', JSON.stringify(unknownFuture))
  assert.equal(cappedOrigin.importedOrigin, false)
  assert.equal(JSON.parse(cappedOrigin.serialized).planner.profiles.some(({ id }) => id === 'origin-32'), false)
  const cappedEnvelope = JSON.parse(await readFile(originCapPath, 'utf8'))
  assert.equal(cappedEnvelope.importedOrigins.length, 32)
  assert.ok(cappedEnvelope.importedOrigins.includes('test-origin-0'))

  await originCapStore.save(JSON.stringify(preferences([profile('kept', 'Kept plan')])))
  const staleFirstOrigin = preferences([profile('origin-0', 'Deleted stale plan')])
  staleFirstOrigin.meta.updatedAtUtc = '1971-01-01T00:00:00.000Z'
  const revisited = await originCapStore.bootstrap('test-origin-0', JSON.stringify(staleFirstOrigin))
  assert.deepEqual(JSON.parse(revisited.serialized).planner.profiles.map(({ id }) => id), ['kept'])

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
    deletionDoesNotResurrect: true,
    newerSameOriginMirrorRecovered: true,
    nearLimitRoundTrip: true,
    boundedOriginProvenance: true,
    oversizedAndMalformedEnvelopeRecovered: true,
    corruptPrimaryRecovered: true,
    retainedBackups: backups.length
  }, null, 2))
} finally {
  await rm(directory, { recursive: true, force: true })
}
