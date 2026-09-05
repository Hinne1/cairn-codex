import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { createScreenshotCollectionFixture as createFixture } from '../src/verification/fixtures.ts'
import { readCollectionSnapshotCache, writeCollectionSnapshotCache } from '../src/main/collection-snapshot-cache.ts'
import { CATALOG_PRESENTATION_VERSION } from '../src/main/catalog-versions.ts'
import { assertReleaseEntry, releaseVerificationBoundary } from './release-entry-boundary.mjs'
import { verificationEnvironment } from './verification-environment.mjs'

const expected = { 'search-help': 1, onboarding: 1, settings: 1, 'bounded-grid-a11y': 120,
  'farming-routes': 226, planner: 120, 'sets-bounded': 404, 'sets-semantics': 7,
  'mi-workshop': 6, 'skill-explorer': 120 }
const root = await mkdtemp(join(tmpdir(), 'cairn-verification-boundary-'))
assert.deepEqual(verificationEnvironment({ PATH: 'runtime', CAIRN_CODEX_DATABASE_PATH: 'must-not-inherit',
  CAIRN_CODEX_INGEST_REQUEST: '{}', cairn_codex_retrieve_request: '{}', CAIRN_CODEX_SCREENSHOT_VERIFY_GLOSSARY: '1' }),
{ PATH: 'runtime', CAIRN_CODEX_SCREENSHOT_VERIFY_GLOSSARY: '1' })
try {
  for (const [name, count] of Object.entries(expected)) {
    const snapshot = createFixture(name)
    assert.equal(snapshot.items.length, count, name)
    assert.equal(snapshot.catalogPresentationVersion, CATALOG_PRESENTATION_VERSION)
    assert.deepEqual(createFixture(name), snapshot, `${name} must be deterministic`)
    const path = join(root, `${name}.json`)
    await writeCollectionSnapshotCache(path, snapshot)
    const restored = await readCollectionSnapshotCache(path)
    assert.ok(restored, `${name} must be usable by the ordinary cached-startup reader`)
    assert.deepEqual(restored.items, JSON.parse(JSON.stringify(snapshot.items)))
  }
  assert.throws(() => createFixture('unknown'), /Unknown screenshot fixture/)
  assert.equal(new Set(createFixture('sets-bounded').items.map(item => item.setRecord)).size, 202)
  const mi = createFixture('mi-workshop')
  assert.equal(mi.observedItems.length, 72)
  assert.equal(new Set(mi.observedItems.map(item => item.instanceKey)).size, 72)
  assert.deepEqual(createFixture('settings').scannedStashes.map(stash => stash.isHardcore), [false, true])

  // Exercise the actual bundler graph: even an indirect fixture import is forbidden.
  const entry = join(root, 'entry.js')
  const bridge = join(root, 'bridge.js')
  const bundle = () => build({ configFile: false, logLevel: 'silent',
    plugins: [releaseVerificationBoundary()], build: { write: false, minify: false,
      lib: { entry, formats: ['es'] } } })
  await writeFile(entry, `export { CATALOG_PRESENTATION_VERSION } from ${JSON.stringify(resolve('src/main/catalog-versions.ts'))}`)
  await bundle()
  await writeFile(bridge, `export { createScreenshotCollectionFixture } from ${JSON.stringify(resolve('src/verification/fixtures.ts'))}`)
  await writeFile(entry, `export * from './bridge.js'`)
  await assert.rejects(bundle, /Verification module entered the release build/)
  assert.doesNotThrow(() => assertReleaseEntry('out/main/index.js', 'startCairnApplication()'))
  for (const path of ['out/verification/main/index.js', 'local-cache/verification-build/main/index.js']) {
    assert.throws(() => assertReleaseEntry(path, ''), /Verification output/)
  }
  for (const body of ['createScreenshotCollectionFixture', 'CAIRN_CODEX_SCREENSHOT_VERIFY_TYPED_ROUTES', 'Synthetic QA']) {
    assert.throws(() => assertReleaseEntry('out/main/index.js', body), /Verification body/)
  }
  const entrySource = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(entrySource, /verification|SMOKE_TEST|SCREENSHOT_FIXTURE/)
} finally {
  await rm(root, { recursive: true, force: true })
}
console.log('Verification boundary passed: ten deterministic cache-readable fixtures, exact MI copies, indirect-import rejection, and artifact controls.')
