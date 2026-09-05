import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { effectScope, ref } from 'vue'
import { CollectionDatabase } from '../src/main/collection-database.ts'
import { createVaultInstanceKey, presentCollection } from '../src/main/collection-presentation.ts'
import { validateFavoriteItem } from '../src/main/ipc/validation.ts'
import { createMainIpcDomains } from '../src/main/ipc/domains.ts'
import { CollectionService } from '../src/main/ipc/collection-service.ts'
import { IPC_CHANNELS } from '../src/shared/contracts.ts'
import { createScreenshotCollectionFixture } from '../src/verification/fixtures.ts'
import { createCopyFavorites, applyCopyFavorite } from '../src/renderer/src/inspection/copy-favorites.ts'
import { createCollectionMaterialsRows } from '../src/renderer/src/workspaces/collection-materials.ts'
import { createMiWorkshopRows } from '../src/renderer/src/workspaces/mi-workshop.ts'
import { defaultAppRoute, parseAppRoute } from '../src/renderer/src/app-route.ts'

const root = await mkdtemp(join(tmpdir(), 'cairn-favorites-'))
const path = join(root, 'archive.sqlite3')
let database = new CollectionDatabase(path)
let raw = new DatabaseSync(path)
const template = createScreenshotCollectionFixture('search-help')
const baseRecord = template.items[0].record
const payload = { baseRecord, prefixRecord: '', suffixRecord: '', modifierRecord: '', transmuteRecord: '',
  seed: 123, materiaRecord: '', relicCompletionBonusRecord: '', relicSeed: 0, enchantmentRecord: '',
  ascendantRecord: '', ascendantRecord2H: '', enchantmentSeed: 0, materiaCombines: 0, stackCount: 1,
  rerolls: 0, affixRerolls: 0, preservedUnknownProperty: 'Exact payload sentinel' }
const fingerprint = createVaultInstanceKey(payload)
const page = () => database.queryVaultItems({ state: 'ingested', sort: 'recent', direction: 'desc', offset: 0, limit: 100 }).items
try {
  database.ensureQuarantineCatalogItem(baseRecord)
  raw.prepare("UPDATE catalog_item SET content_pack='base', rarity='legendary' WHERE record=?").run(baseRecord)
  const insert = raw.prepare(`INSERT INTO vault_item(id,base_record,state,serialized_item,ingested_at_utc,is_hardcore)
    VALUES(?,?,'ingested',?,'2026-09-05T00:00:00Z',?)`)
  for (const [id, mode, seed] of [['sc-a', 0, 123], ['sc-identical', 0, 123], ['hc-a', 1, 123], ['sc-other-roll', 0, 456]]) {
    insert.run(id, baseRecord, Buffer.from(JSON.stringify({ ...payload, seed })), mode)
  }
  const payloadHash = () => {
    const hash = createHash('sha256')
    for (const row of raw.prepare('SELECT id,serialized_item FROM vault_item ORDER BY id').all()) hash.update(row.id).update(row.serialized_item)
    return hash.digest('hex')
  }
  const before = payloadHash()
  raw.exec('DROP TABLE favorite_item; PRAGMA user_version=14')
  raw.close(); database.close()
  database = new CollectionDatabase(path); raw = new DatabaseSync(path)
  assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 15)
  assert.equal(payloadHash(), before)
  const handlers = new Map()
  const domains = createMainIpcDomains({ handle: (channel, handler) => handlers.set(channel, handler) })
  const backups = []
  const service = new CollectionService({ preferences: {
    setFavoriteItem: (...args) => database.setFavoriteItem(...args),
    runExclusive: async operation => operation(), queueArchiveBackup: reason => backups.push(reason)
  } })
  domains.collection.handle(IPC_CHANNELS.setFavoriteItem, (_event, input) => service.setFavoriteItem(input), validateFavoriteItem)
  const invoke = input => handlers.get(IPC_CHANNELS.setFavoriteItem)({}, input)
  for (const input of [null, [], {}, { instanceKey: 'a', isHardcore: false, favorite: true },
    { instanceKey: fingerprint, isHardcore: 'false', favorite: true },
    { instanceKey: fingerprint, isHardcore: false, favorite: 1 }]) await assert.rejects(invoke(input))
  assert.equal(backups.length, 0, 'invalid boundary input cannot write or queue backups')
  const write = { instanceKey: fingerprint.toUpperCase(), isHardcore: false, favorite: true }
  await invoke(write); await invoke(write)
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM favorite_item').get().n, 1, 'repeated submissions are idempotent')
  assert.deepEqual(page().filter(item => item.isFavorite).map(item => item.id).sort(), ['sc-a', 'sc-identical'])
  assert.equal(page().find(item => item.id === 'sc-a').instanceKey, fingerprint)
  assert.equal(backups.at(-1), 'favorite copy changed')
  database.close(); database = new CollectionDatabase(path)
  assert.equal(page().filter(item => item.isFavorite).length, 2, 'favorites survive restart')
  const snapshot = { ...template, scannedStashes: [], observedItems: [], discovery: { ...template.discovery, installations: [{ path: 'C:/synthetic-game' }] } }
  const presented = await presentCollection(database, snapshot, 'archive', 9)
  assert.deepEqual(presented.observedItems.filter(item => item.isFavorite).map(item => item.sourcePath).sort(), ['vault://sc-a', 'vault://sc-identical'])
  assert.equal(presented.observedItems.find(item => item.sourcePath === 'vault://hc-a').isHardcore, true)
  const stashSnapshot = { ...snapshot, scannedStashes: [{ path: 'synthetic.gst', isHardcore: false }],
    observedItems: [{ ...payload, sourcePath: 'synthetic.gst', tabIndex: 0, itemIndex: 0, instanceKey: fingerprint }] }
  assert.equal(database.presentSnapshot(stashSnapshot, false).observedItems[0].isFavorite, true, 'stash rescan projects the saved preference')
  await invoke({ ...write, isHardcore: true })
  await invoke({ ...write, favorite: false })
  assert.deepEqual(page().filter(item => item.isFavorite).map(item => item.id), ['hc-a'])
  assert.equal(payloadHash(), before, 'favoriting never changes exact payloads')
  raw.exec('BEGIN')
  const remember = raw.prepare('INSERT OR IGNORE INTO favorite_item VALUES(?,0,?)')
  for (let index = 0; index < 20_000; index++) remember.run(index.toString(16).padStart(64, '0'), '2026-09-05T00:00:00Z')
  raw.exec('COMMIT')
  const queries = []
  const originalPrepare = DatabaseSync.prototype.prepare
  DatabaseSync.prototype.prepare = function(sql, ...args) { queries.push(sql); return originalPrepare.call(this, sql, ...args) }
  const queryStart = performance.now()
  try {
    for (let index = 0; index < 50; index++) database.queryVaultItems({ state: 'ingested', sort: 'recent', direction: 'desc', offset: 0, limit: 1 })
  } finally { DatabaseSync.prototype.prepare = originalPrepare }
  assert.ok(queries.filter(sql => sql.includes('FROM favorite_item')).every(sql => /WHERE instance_key = \? AND is_hardcore = \?/.test(sql)),
    'bounded pages only look up their own fingerprints through the composite primary key')
  console.log('50 single-row pages with 20k retained favorites: ' + (performance.now() - queryStart).toFixed(1) + 'ms')
  const item = { ...template.items[0], rarity: 'mi', availableCount: 3 }
  const copies = [{ ...payload, instanceKey: fingerprint, isHardcore: false, isFavorite: true },
    { ...payload, seed: 456, instanceKey: createVaultInstanceKey({ ...payload, seed: 456 }), isHardcore: false, isFavorite: false }]
  const controls = { ...defaultAppRoute('collection').controls, ownership: 'favorite' }
  assert.equal(createCollectionMaterialsRows([item], controls, { mode: 'collection', favoriteRecords: new Set([baseRecord.toLowerCase()]), query: { matches: () => true }, searchDocument: () => ({ text: '' }) }).length, 1)
  const miControls = { ...defaultAppRoute('mi-workshop').controls, favoritesOnly: true }
  assert.deepEqual(createMiWorkshopRows({ items: [item], affixes: [], copies, controls: miControls, query: { matches: () => true } })[0].copies, [copies[0]], 'MI favorites filter operates on exact copies before grouping')
  for (const [workspace, routeControls] of [['collection', controls], ['mi-workshop', miControls]]) {
    assert.deepEqual(parseAppRoute({ version: 1, workspace, itemRecord: null, controls: routeControls }).controls, routeControls)
  }
  assert.equal('favoritesOnly' in defaultAppRoute('mi-workshop').controls, false, 'old routes retain their default shape')
  const context = ref('sc-a')
  const scope = effectScope()
  let finish, reject, writes = 0
  const applied = [], errors = [], reconciled = []
  const favorites = scope.run(() => createCopyFavorites({ contextKey: () => context.value, modeFor: copy => copy.isHardcore,
    write: () => { writes++; return new Promise((resolve, fail) => { finish = resolve; reject = fail }) },
    apply: (...args) => applied.push(args), reconcile: () => reconciled.push(context.value), reportError: error => errors.push(error) }))
  const pending = favorites.toggle(copies[0]); await favorites.toggle(copies[0])
  assert.equal(writes, 1); assert.equal(favorites.busy.value, true)
  context.value = 'hc'; context.value = 'sc-a'; finish(); await pending
  assert.equal(applied.length, 0, 'ABA context changes reject stale completions')
  assert.deepEqual(reconciled, ['sc-a'], 'a durable completion reloads the current context even after ABA')
  const failed = favorites.toggle(copies[0]); reject(new Error('disk unavailable')); await failed
  assert.equal(errors.length, 1); assert.equal(applied.length, 0); assert.equal(favorites.busy.value, false)
  assert.equal(reconciled.length, 2, 'uncertain rejected responses also reconcile durable state')
  const retried = favorites.toggle(copies[0]); finish(); await retried
  assert.deepEqual(applied, [[fingerprint, false, false]])
  const changed = applyCopyFavorite([...copies, { ...copies[0], isHardcore: true }], fingerprint, false, false)
  assert.equal(changed[0].isFavorite, false); assert.equal(changed[2].isFavorite, true)
  assert.equal(favorites.canToggle({ ...copies[0], isHardcore: undefined }), false)
  const optimisticIngest = { ...payload, instanceKey: fingerprint, sourcePath: 'vault://sc-a', tabIndex: -1, itemIndex: 0 }
  assert.equal(favorites.canToggle(optimisticIngest), false, 'partial live-ingest receipts cannot guess a favorite or its mode')
  const writeCount = writes
  await favorites.toggle(optimisticIngest)
  assert.equal(writes, writeCount)
  const authoritativeIngest = presented.observedItems.find(item => item.sourcePath === 'vault://sc-a')
  assert.equal(favorites.canToggle(authoritativeIngest), true)
  assert.equal(authoritativeIngest.isFavorite, true, 'reingest restores the saved favorite through authoritative projection')
  assert.equal(applyCopyFavorite([authoritativeIngest], fingerprint, false, false)[0].isFavorite, false)
  const beforeDispose = { applied: applied.length, reconciled: reconciled.length, errors: errors.length }
  const disposedWrite = favorites.toggle(copies[0]); scope.stop(); finish(); await disposedWrite
  assert.deepEqual({ applied: applied.length, reconciled: reconciled.length, errors: errors.length }, beforeDispose,
    'disposed sessions cannot publish a late response or request reload')
  await favorites.toggle(copies[0]); assert.equal(favorites.busy.value, false)
  const app = await readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8')
  assert.match(app, /applyLiveIngests\(result.ingested\)[\s\S]*?await reloadCollection\(\)[\s\S]*?reportSuccess\(`Live-ingested/)
  const preload = await readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8')
  assert.match(preload, /setFavoriteItem:[\s\S]*?IPC_CHANNELS\.setFavoriteItem/)
  console.log('Copy favorites passed: schema14 migration, exact bytes, real SQLite + validated domain service, SC/HC, identical/different fingerprints, restart/rescan, filters/routes, repeated/pending/failed writes and context changes.')
} finally { raw.close(); database.close(); await rm(root, { recursive: true, force: true }) }
