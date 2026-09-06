import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CollectionDatabase } from '../src/main/collection-database.ts'
import { ROLL_ANALYSIS_VERSION, ROLL_DAMAGE_TYPES, isDamageOverTime } from '../src/shared/roll-analysis.ts'
import { rollCategoryScores, rollCategoryLabel } from '../src/renderer/src/roll-rating.ts'
import { damageFamily } from '../src/renderer/src/damage-types.ts'
import { defaultAppRoute, appRouteHash, parseAppRouteHash } from '../src/renderer/src/app-route.ts'
import { buildCollectionRollSummaries, collectionRollSortOptions } from '../src/renderer/src/workspaces/collection-materials.ts'
import { buildMiMetricOptions, createMiWorkshopRows } from '../src/renderer/src/workspaces/mi-workshop.ts'
import { compileSearchQuery } from '../src/shared/search-query.ts'

const pairs = [['physical', 'internal-trauma'], ['fire', 'burn'], ['cold', 'frostburn'],
  ['lightning', 'electrocute'], ['acid', 'poison'], ['vitality', 'vitality-decay'], ['pierce', 'bleeding']]
const score = (damageType, qualityPercent) => ({ key: `offense:${damageType}`, category: 'offense', damageType,
  qualityPercent, combinationPercentile: qualityPercent, estimatedPercentile: qualityPercent, statCount: 1 })
const analysis = categoryScores => ({ modelVersion: ROLL_ANALYSIS_VERSION, trusted: true, categoryScores,
  baseEstimatedPercentile: null, prefixEstimatedPercentile: null, suffixEstimatedPercentile: null, stats: [], petStats: [] })
const record = 'records/synthetic/dot-rolls.dbr'
const catalogItem = { record, name: 'Synthetic paired rolls', rarity: 'mi', slot: 'shoulders',
  itemLevel: 94, levelRequirement: 94, presentation: { sections: [] } }
for (const [direct, dot] of pairs) {
  assert.equal(damageFamily(direct), damageFamily(dot))
  assert.equal(isDamageOverTime(direct), false)
  assert.equal(isDamageOverTime(dot), true)
  const copies = [
    { baseRecord: record, prefixRecord: '', suffixRecord: '', instanceKey: 'direct-leader',
      rollAnalysis: analysis([score(direct, 90), score(dot, 10)]) },
    { baseRecord: record, prefixRecord: '', suffixRecord: '', instanceKey: 'dot-leader',
      rollAnalysis: analysis([score(direct, 20), score(dot, 80)]) }
  ]
  for (const [type, leader] of [[direct, 'direct-leader'], [dot, 'dot-leader']]) {
    const label = ROLL_DAMAGE_TYPES.find(damage => damage.id === type).label
    assert.equal(rollCategoryLabel(score(type, 50)), label)
    const route = { ...defaultAppRoute('collection'), controls: { ...defaultAppRoute('collection').controls, sort: `roll-${type}` } }
    assert.equal(parseAppRouteHash(appRouteHash(route)).controls.sort, `roll-${type}`)
    assert.ok(collectionRollSortOptions.some(option => option.value === `roll-${type}` && option.label.endsWith(label)))
    assert.equal(buildCollectionRollSummaries(copies, type).get(record).copy.instanceKey, leader)
    const metric = `category:offense:${type}`
    assert.ok(buildMiMetricOptions(copies).quality.some(option => option.key === metric && option.label === `${label} roll`))
    for (const metricDirection of ['asc', 'desc']) {
      const miControls = { ...defaultAppRoute('mi-workshop').controls, metric, metricDirection }
      const miRoute = { ...defaultAppRoute('mi-workshop'), controls: miControls }
      assert.equal(parseAppRouteHash(appRouteHash(miRoute)).controls.metric, metric)
      const rows = createMiWorkshopRows({ items: [catalogItem], affixes: [], copies,
        controls: miControls, query: compileSearchQuery('') })
      assert.equal(rows[0].leader.instanceKey, leader, 'MI always chooses the best copy for the exact type')
    }
  }
  for (const version of [undefined, 8, 9, ROLL_ANALYSIS_VERSION + 1]) {
    const stale = copies.map(copy => ({ ...copy, rollAnalysis: { ...copy.rollAnalysis, modelVersion: version } }))
    assert.deepEqual(rollCategoryScores(stale[0].rollAnalysis), [])
    assert.equal(buildCollectionRollSummaries(stale, direct).size, 0, 'old merged scores cannot select a direct leader')
    assert.equal(buildCollectionRollSummaries(stale, dot).size, 0)
    assert.ok(buildMiMetricOptions(stale).quality.every(option => !option.key.startsWith('category:')))
  }
}

// Reopening a partially recalculated archive must resume bounded batches without
// changing exact bytes or confusing SC and HC copies of the same base item.
const root = await mkdtemp(join(tmpdir(), 'cairn-dot-roll-cache-'))
const path = join(root, 'archive.sqlite3')
let database = new CollectionDatabase(path)
let raw = new DatabaseSync(path)
try {
  database.ensureQuarantineCatalogItem(record)
  raw.prepare("UPDATE catalog_item SET rarity='mi', content_pack='base' WHERE record=?").run(record)
  const current = analysis([score('acid', 20), score('poison', 80)])
  const previous = { ...current, modelVersion: 9, categoryScores: [score('acid', 50)] }
  const exact = Buffer.from(JSON.stringify({ baseRecord: record, seed: 123, prefixRecord: 'synthetic-affix',
    suffixRecord: '', stackCount: 1, untouched: 'exact-payload-sentinel' }))
  const insert = raw.prepare(`INSERT INTO vault_item(id, base_record, state, serialized_item, ingested_at_utc,
    is_hardcore, reusable, roll_json) VALUES(?, ?, 'ingested', ?, '2026-09-06T00:00:00Z', ?, 0, ?)`)
  for (const [id, mode, cached] of [['sc-old', 0, previous], ['hc-old', 1, previous], ['sc-current', 0, current]]) {
    insert.run(id, record, exact, mode, JSON.stringify(cached))
  }
  assert.equal(database.countArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION), 2)
  assert.equal(database.countArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION, false), 1)
  assert.equal(database.countArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION, true), 1)
  const first = database.listArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION, 1)
  assert.equal(first.length, 1)
  assert.deepEqual(first[0].payload, JSON.parse(exact))
  database.setVaultRollAnalyses(first.map(candidate => ({ id: candidate.id, rollAnalysis: current })))
  assert.equal(database.countArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION), 1)
  raw.close(); database.close()
  database = new CollectionDatabase(path); raw = new DatabaseSync(path)
  const remaining = database.listArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION, 1)
  assert.equal(remaining.length, 1)
  assert.notEqual(remaining[0].id, first[0].id, 'reopening must not repeat the committed batch')
  database.setVaultRollAnalyses(remaining.map(candidate => ({ id: candidate.id, rollAnalysis: current })))
  raw.close(); database.close()
  database = new CollectionDatabase(path); raw = new DatabaseSync(path)
  assert.equal(database.countArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION), 0)
  assert.equal(database.listArchiveRollAnalysisCandidates(ROLL_ANALYSIS_VERSION, 1).length, 0)
  const saved = raw.prepare('SELECT id, is_hardcore, serialized_item, roll_json FROM vault_item ORDER BY id').all()
  assert.deepEqual(saved.map(row => [row.id, row.is_hardcore]), [['hc-old', 1], ['sc-current', 0], ['sc-old', 0]])
  for (const row of saved) {
    assert.deepEqual(Buffer.from(row.serialized_item), exact, 'recalculation must preserve exact item bytes')
    assert.deepEqual(rollCategoryScores(JSON.parse(row.roll_json)).map(score => score.key), ['offense:acid', 'offense:poison'])
  }
} finally {
  raw.close(); database.close()
  await rm(root, { recursive: true, force: true })
}
console.log('DoT scores passed: seven distinct pairs, routes, sorting and exact MI leaders, stale-score gating, bounded cache resume/reopen, payload and SC/HC preservation.')
