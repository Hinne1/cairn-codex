import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createHash } from 'node:crypto'
import { CollectionDatabase } from '../src/main/collection-database.ts'
import { ArchiveDomainService } from '../src/main/ipc/archive-service.ts'

const root = await mkdtemp(join(tmpdir(), 'cairn-workspace-queries-'))
const path = join(root, 'archive.sqlite3')
let database = new CollectionDatabase(path)
let raw = new DatabaseSync(path)
const records = ['records/synthetic/gear.dbr', 'records/synthetic/boost.dbr', 'records/synthetic/potion.dbr', 'records/synthetic/rune.dbr']
const catalog = records.map((record, index) => ({ record, name: ['Gear', 'Faction boost', 'Potion', 'Rune'][index],
  rarity: index ? 'supply' : 'legendary', slot: ['chest', 'writ', 'potion', 'rune'][index],
  levelRequirement: 50, itemLevel: 50, discovered: true, availableCount: 1, presentation: { sections: [] } }))
for (const item of catalog) {
  database.ensureQuarantineCatalogItem(item.record)
  raw.prepare("UPDATE catalog_item SET name=?, rarity=?, slot=?, level_requirement=50, item_level=50, content_pack='base' WHERE record=?")
    .run(item.name, item.rarity, item.slot, item.record)
}
const payload = (index, extra = {}) => ({ baseRecord: records[0], seed: index, stackCount: 1,
  prefixRecord: index === 0 ? 'best' : 'ordinary', suffixRecord: '', materiaRecord: index === 2 ? 'component' : '',
  enchantmentRecord: index === 3 ? 'augment' : '', ascendantRecord: '', ascendantRecord2H: '',
  unrelatedPayloadSentinel: 'preserved exact data '.repeat(50), ...extra })
const insertSql = `INSERT INTO vault_item(id, base_record, state, serialized_item, ingested_at_utc,
  is_hardcore, reusable, roll_json) VALUES(?, ?, 'ingested', ?, ?, ?, ?, ?)`
let insert = raw.prepare(insertSql)
const add = (id, index, record = records[0], mode = false, extra = {}) => insert.run(id, record,
  Buffer.from(JSON.stringify(payload(index, { baseRecord: record, ...extra }))), new Date(1700000000000 + index).toISOString(),
  Number(mode), Number(record === records[1] || record === records[3]), JSON.stringify({ overallEstimatedPercentile: index === 0 ? 100 : 50 }))
const query = { source: 'archive', query: '', offset: 0, limit: 120 }
const supplies = { source: 'all', category: 'writs', slot: 'all', query: '', activeCharacter: null,
  activeTransferHardcore: false, liveReady: false, offset: 0, limit: 60 }
try {
  raw.exec('BEGIN')
  for (let index = 0; index < 20_000; index++) add(`gear-${index}`, index, records[0], index >= 10_000)
  for (let index = 0; index < 140; index++) add(`potion-${index}`, index, records[2])
  add('boost-sc-old', 1, records[1]); add('boost-sc-new', 2, records[1]); add('boost-hc', 3, records[1], true)
  add('rune-sc', 1, records[3]); add('rune-hc', 2, records[3], true)
  raw.exec('COMMIT')

  const corruptPayloads = ['{broken', 'null', '[]', '{"seed":{}}', '{"prefixRecord":42}',
    ...['seed', 'stackCount'].flatMap(field => ['9223372036854775808', '-9223372036854775809',
      '9223372036854775807', '9007199254740992', '-9007199254740992'].map(value => `{"${field}":${value}}`))]
  for (const [index, value] of corruptPayloads.entries()) insert.run(`corrupt-${index}`, records[0],
    Buffer.from(value), '2026-09-05T00:00:00.000Z', 0, 0, '{broken-roll')
  const payloadHash = () => {
    const hash = createHash('sha256')
    const statement = raw.prepare('SELECT id, serialized_item FROM vault_item ORDER BY id LIMIT 100 OFFSET ?')
    for (let offset = 0; ; offset += 100) {
      const batch = statement.all(offset)
      if (batch.length === 0) break
      for (const row of batch) { hash.update(row.id); hash.update(row.serialized_item) }
    }
    return hash.digest('hex')
  }

  // Represent a real v13 archive; reopening must backfill once without changing payloads.
  const hashBefore = payloadHash()
  raw.exec(`DROP TRIGGER vault_item_projection_insert; DROP TRIGGER vault_item_projection_update;
    DROP TABLE vault_item_projection; DROP INDEX vault_item_group_idx; DROP TABLE favorite_item; PRAGMA user_version=13;`)
  raw.close(); database.close()
  const migrationStart = performance.now()
  database = new CollectionDatabase(path)
  const migrationMs = performance.now() - migrationStart
  raw = new DatabaseSync(path)
  insert = raw.prepare(insertSql)
  assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 15)
  assert.equal(payloadHash(), hashBefore, 'every exact payload remains byte-identical through migration')
  assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM vault_item_projection').get().count, 20_145 + corruptPayloads.length)
  assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM vault_item_projection WHERE payload_valid=0').get().count, corruptPayloads.length)
  assert.equal(database.workspaceQueries.itemsByIds(corruptPayloads.map((_, index) => `corrupt-${index}`)).length, corruptPayloads.length, 'malformed numeric metadata cannot poison a bounded read')
  database.close(); database = new CollectionDatabase(path)

  const statements = []
  const originalPrepare = DatabaseSync.prototype.prepare
  DatabaseSync.prototype.prepare = function(sql, ...args) { statements.push(sql); return originalPrepare.call(this, sql, ...args) }
  const originalParse = JSON.parse
  let payloadParses = 0
  JSON.parse = function(text, ...args) { if (typeof text === 'string' && text.includes('unrelatedPayloadSentinel')) payloadParses++;
    return originalParse(text, ...args) }
  let page
  const timings = {}
  const measure = (name, run) => { const started = performance.now(); const result = run(); timings[name] = performance.now() - started; return result }
  const start = performance.now(), memoryBefore = process.memoryUsage()
  try {
    page = measure('dismantlingPageMs', () => database.workspaceQueries.dismantlingPage(query))
    assert.equal(page.total, 20_000); assert.equal(page.items.length, 120)
    assert.equal(database.workspaceQueries.dismantlingPage({ ...query, isHardcore: true }).total, 10_000)
    assert.equal(database.workspaceQueries.dismantlingPage({ ...query, isHardcore: false }).total, 10_000)
    assert.equal(database.workspaceQueries.dismantlingPage({ ...query, query: 'name:absent' }).total, 0)
    const extras = measure('duplicateSelectionMs', () => database.workspaceQueries.dismantlingDuplicates({ ...query, isHardcore: false, query: 'prefix:ordinary' }))
    assert.equal(extras.total, 9997, 'best remains protected even outside the search; attached extras stay excluded')
    assert.equal(extras.ids.includes('gear-0'), false); assert.equal(extras.ids.includes('gear-1'), true)
    assert.equal(extras.ids.includes('gear-2'), false); assert.equal(extras.ids.includes('gear-3'), false)
    assert.equal(database.workspaceQueries.dismantlingDuplicates(query).ids.length, 10_000)
    assert.equal(database.workspaceQueries.itemsByIds(['gear-1']).length, 1)

    const supplyPage = measure('supplyPageMs', () => database.workspaceQueries.suppliesPage(supplies, catalog))
    assert.equal(supplyPage.total, 142, '140 individual potions plus one boost per mode')
    assert.equal(supplyPage.items.length, 60)
    const second = database.workspaceQueries.suppliesPage({ ...supplies, offset: 60 }, catalog)
    assert.equal(second.items.length, 60)
    assert.equal(second.items.some(item => supplyPage.items.some(first => first.id === item.id)), false)
    const boost = database.workspaceQueries.supplyBoostSelection(supplies, catalog)
    assert.equal(boost.items[0].reusable, true, 'compact selection retains confirmation metadata')
    assert.deepEqual(boost.items.map(item => item.id), ['boost-sc-new'], 'active mode and newest reusable group representative')
    assert.equal(database.workspaceQueries.suppliesPage({ ...supplies, isHardcore: true }, catalog).total, 1)
    assert.equal(database.workspaceQueries.suppliesPage({ ...supplies, category: 'augments' }, catalog).total, 2)
    assert.equal(database.workspaceQueries.suppliesPage({ ...supplies, source: 'faction' }, catalog).total, 0)
  } finally { JSON.parse = originalParse; DatabaseSync.prototype.prepare = originalPrepare }
  const queryMs = performance.now() - start, memoryAfter = process.memoryUsage()
  assert.equal(payloadParses, 0, 'no unrelated or selected exact payload is parsed by metadata queries')
  assert.equal(statements.some(sql => /serialized_item|roll_json/.test(sql)), false, 'paging and selection read stored projections only')

  let simulated = 0, lookedUp = []
  const service = new ArchiveDomainService({ reads: {
    readVaultItems: () => { throw new Error('Full vault lookup is forbidden') },
    readDismantlingItems: ids => { lookedUp.push([...ids]); return database.workspaceQueries.itemsByIds(ids) }
  }, discoverInstallationPath: async () => 'synthetic-installation', simulateDismantling: async (_path, items) => { simulated++; return { itemCount: items.length } } })
  assert.equal((await service.previewDismantling(['gear-1'])).itemCount, 1)
  assert.deepEqual(lookedUp, [['gear-1']])
  await assert.rejects(service.previewDismantling(['missing']), /not eligible/)
  await assert.rejects(service.previewDismantling(['gear-1', 'gear-1']), /Duplicate/)
  await assert.rejects(service.previewDismantling(['boost-sc-new']), /not eligible/)
  await assert.rejects(service.previewDismantling([]), /safe bounds/)
  await assert.rejects(service.previewDismantling(Array.from({ length: 10_001 }, (_, index) => `gear-${index}`)), /safe bounds/)
  assert.equal(simulated, 1)
  await assert.rejects(service.previewDismantling(['corrupt-0']), /not eligible/)

  // Preserve all original eligibility and unscored-copy policies after moving them out of Vue.
  for (const rarity of ['epic', 'mi', 'rare', 'faction']) {
    const record = `records/synthetic/${rarity}.dbr`
    database.ensureQuarantineCatalogItem(record)
    raw.prepare("UPDATE catalog_item SET rarity=?, content_pack='base' WHERE record=?").run(rarity, record)
    add(`${rarity}-old`, 21, record); add(`${rarity}-new`, 22, record)
    raw.prepare('UPDATE vault_item SET roll_json=NULL WHERE base_record=?').run(record)
    const scoped = { ...query, query: `base:${record}` }
    assert.equal(database.workspaceQueries.dismantlingPage(scoped).total, rarity === 'faction' ? 0 : 2)
    assert.deepEqual(database.workspaceQueries.dismantlingDuplicates(scoped).ids, rarity === 'faction' ? [] : [`${rarity}-old`], 'unscored group protects newest copy')
    raw.prepare("UPDATE vault_item SET state='retrieved' WHERE id=?").run(`${rarity}-new`)
    assert.equal(database.workspaceQueries.dismantlingPage(scoped).total, rarity === 'faction' ? 0 : 1)
    raw.prepare('UPDATE vault_item SET reusable=1 WHERE id=?').run(`${rarity}-old`)
    assert.equal(database.workspaceQueries.dismantlingPage(scoped).total, 0)
  }
  const quarantine = 'records/synthetic/uncatalogued.dbr'
  database.ensureQuarantineCatalogItem(quarantine); add('quarantined', 23, quarantine)
  assert.equal(database.workspaceQueries.dismantlingPage({ ...query, query: `base:${quarantine}` }).total, 0)
  for (const change of [{ limit: 251 }, { offset: -1 }, { isHardcore: 'false' }, { rarity: 'common' }, { query: 'x'.repeat(201) }]) {
    assert.throws(() => database.workspaceQueries.dismantlingPage({ ...query, ...change }), /bounds/)
  }
  raw.prepare("UPDATE vault_item SET serialized_item=?, roll_json=? WHERE id='gear-1'")
    .run(Buffer.from(JSON.stringify(payload(123, { prefixRecord: 'updated', materiaRecord: 'attached' }))), JSON.stringify({ overallEstimatedPercentile: 99 }))
  const changed = database.workspaceQueries.itemsByIds(['gear-1'])[0]
  assert.equal(changed.prefixRecord, 'updated'); assert.equal(changed.componentRecord, 'attached'); assert.equal(changed.rollPercentile, 99)
  raw.prepare("UPDATE vault_item SET state='retrieval_pending' WHERE id='gear-1'").run()
  await assert.rejects(service.previewDismantling(['gear-1']), /not eligible/)
  console.log(JSON.stringify({ passed: true, measuredArchiveItems: 20_145 + corruptPayloads.length, migrationMs: Math.round(migrationMs), queryBatchMs: Math.round(queryMs), timings,
    ipcBytes: Buffer.byteLength(JSON.stringify(page)), returnedPageRows: page.items.length, payloadParses,
    heapDeltaBytes: memoryAfter.heapUsed - memoryBefore.heapUsed, rssBytes: memoryAfter.rss,
    processPeakRssKiB: process.resourceUsage().maxRSS }, null, 2))
} finally { raw.close(); database.close(); await rm(root, { recursive: true, force: true }) }
