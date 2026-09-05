import assert from 'node:assert/strict'
import { effectScope, shallowRef, nextTick } from 'vue'
import { createItemInspectionSession } from '../src/renderer/src/inspection/item-inspection.ts'
import { presentRolledStats as present } from '../src/renderer/src/inspection/inspection-presentation.ts'
import { createAppHistoryEntry, defaultAppRoute, parseAppHistoryEntry } from '../src/renderer/src/app-route.ts'
import { categoryScoreDescription, formatCategoryScore, rollCategoryScores, rollStatQuality, averageRollQuality } from '../src/renderer/src/roll-rating.ts'

const score = { key: 'pet', category: 'pet', damageType: null, qualityPercent: 90, estimatedPercentile: 90, combinationPercentile: 90, statCount: 1 }
assert.equal(formatCategoryScore(score), '90% (90th)')
assert.match(categoryScoreDescription(score), /below this score plus half of tied rolls/)
assert.doesNotMatch(categoryScoreDescription(score), /about 10%|scored as high or higher/)
assert.match(categoryScoreDescription({ ...score, combinationPercentile: null }), /1 variable stat group\./)
assert.doesNotMatch(categoryScoreDescription({ ...score, combinationPercentile: null }), /percentile as a combination/)

const vitality = { field: 'offensiveVitality', value: 9, rollable: true, observedMinimum: 7, observedMaximum: 9, estimatedPercentile: 250 / 3 }
assert.equal(rollStatQuality(vitality), 100)
assert.equal(rollStatQuality({ ...vitality, value: 7 }), 0)
assert.equal(rollStatQuality({ ...vitality, value: 8 }), 50)
assert.equal(rollStatQuality({ ...vitality, value: 10 }), 100)
assert.equal(rollStatQuality({ ...vitality, value: 6 }), 0)
assert.equal(rollStatQuality({ ...vitality, observedMinimum: 9 }), null)
assert.equal(rollStatQuality({ ...vitality, estimatedPercentile: null }), null)
assert.equal(rollStatQuality({ ...vitality, value: NaN }), null)
assert.equal(formatCategoryScore({ ...score, qualityPercent: 100, combinationPercentile: 250 / 3 }), '100% (83rd)')
assert.deepEqual(rollCategoryScores({ trusted: true, categoryScores: [{ ...score, qualityPercent: undefined }] }), [],
  'old cached category percentiles must not be relabeled as range quality')
assert.deepEqual(rollCategoryScores({ trusted: false, categoryScores: [score] }), [])
assert.equal(formatCategoryScore({ ...score, qualityPercent: undefined }), '—')

// Exercise the production reference selection and route restoration with synthetic copies.
// No Electron API, profile, persistence, or game data is involved.
assert.equal(present([vitality])[0].qualityPercent, 100, 'the actual drawer projection must fill the meter at maximum')
const range = present([{ ...vitality, field: 'offensiveVitalityMin' }, { ...vitality, field: 'offensiveVitalityMax', value: 18, observedMinimum: 14, observedMaximum: 18 }])
assert.equal(range.length, 1)
assert.equal(range[0].qualityPercent, 100, 'min/max members must normalize independently before averaging')
assert.equal(range[0].rankLabel, null, 'do not invent a combination percentile by averaging marginal ranks')
assert.equal(present([{ ...vitality, field: 'offensiveVitalityMin' }, { ...vitality, field: 'offensiveVitalityMax', rollable: false, value: 18, observedMinimum: 18, observedMaximum: 18, estimatedPercentile: null }], true)[0].qualityPercent, 100,
  'a fixed range member must not hide or dilute the variable member quality')
const record = 'records/items/test.dbr'
const copies = shallowRef([
  { baseRecord: record, instanceKey: 'pinned-other', sourcePath: 'synthetic-sc', prefixRecord: '', suffixRecord: '' },
  { baseRecord: record, instanceKey: 'score-leader', sourcePath: 'synthetic-hc', prefixRecord: '', suffixRecord: '' }
])
const items = shallowRef([{ record, rarity: 'legendary', pinnedInstanceKey: 'pinned-other' }])
const writes = []
let finishPin
let rejectPin
const scope = effectScope()
const harness = scope.run(() => createItemInspectionSession({
  available: () => true, items: () => items.value, copies: () => copies.value,
  observedCopies: () => [], affixes: () => new Map(), metric: () => 'overall',
  metricDirection: () => 'desc', storedCopyFor: () => null,
  modeFor: copy => copy.sourcePath === 'synthetic-hc',
  setPinnedBest: (...args) => { writes.push(args); return new Promise((resolve, reject) => { finishPin = resolve; rejectPin = reject }) }
}))
const restoreAppRoute = (route, reference) => harness.restore(route.itemRecord, reference)
const itemRoute = { ...defaultAppRoute('collection'), itemRecord: 'records/items/test.dbr' }
const history = [
  createAppHistoryEntry(0, defaultAppRoute('collection')),
  createAppHistoryEntry(1, itemRoute, 'score-leader'),
  createAppHistoryEntry(2, defaultAppRoute('collection'))
]
function restore(index) {
  const entry = parseAppHistoryEntry(JSON.parse(JSON.stringify(history[index])))
  restoreAppRoute(entry.route, entry.referenceInstanceKey)
}
restore(1)
assert.equal(harness.comparisonReferenceCopy.value.instanceKey, 'score-leader')
restore(2)
assert.equal(harness.comparisonReferenceCopy.value, null)
restore(1) // Back must not fall back to the different pinned copy.
assert.equal(harness.comparisonReferenceCopy.value.instanceKey, 'score-leader')
restore(0)
restore(1) // Forward also restores the exact score leader.
assert.equal(harness.comparisonReferenceCopy.value.instanceKey, 'score-leader')
restoreAppRoute(itemRoute) // Shared links/old entries have no local copy selection.
assert.equal(harness.comparisonReferenceCopy.value.instanceKey, 'pinned-other')
restoreAppRoute(itemRoute, 'removed-copy')
assert.equal(harness.comparisonReferenceCopy.value.instanceKey, 'pinned-other', 'missing copies fall back safely')

harness.open(items.value[0], 'score-leader')
const pendingPin = harness.pinCopy(copies.value[1])
assert.deepEqual(writes, [[record, 'score-leader', true]], 'pinning keeps the exact source mode')
await harness.pinCopy(copies.value[1])
assert.equal(writes.length, 1, 'a repeated pin cannot overlap the outstanding write')
harness.close()
harness.open({ record: 'different', rarity: 'legendary' })
finishPin()
await pendingPin
assert.equal(items.value[0].pinnedInstanceKey, 'score-leader')
assert.equal(harness.selectedRecord.value, 'different')
assert.equal(harness.selectedReferenceInstanceKey.value, null, 'completed pin does not change the newly inspected item')
harness.restore(record, 'score-leader')
harness.toggleCopyAffix(copies.value[0], 'records/affixes/test.dbr')
assert.ok(harness.activeCopyAffixTarget.value)
harness.close()
await nextTick()
assert.equal(harness.activeCopyAffixTarget.value, null)
harness.restore(record, 'score-leader')
const rejectedPin = harness.pinCopy(copies.value[0])
rejectPin(new Error('synthetic pin failure'))
await assert.rejects(rejectedPin, /synthetic pin failure/)
assert.equal(harness.pinning.value, false)
assert.equal(items.value[0].pinnedInstanceKey, 'score-leader', 'failed writes cannot invent a pin')
assert.equal(harness.selectedReferenceInstanceKey.value, 'score-leader')
const refreshedPin = harness.pinCopy(copies.value[0])
items.value = [{ ...items.value[0] }]
finishPin()
await refreshedPin
assert.equal(items.value[0].pinnedInstanceKey, 'pinned-other', 'completed pin updates the refreshed catalog object')
assert.equal(harness.selectedReferenceInstanceKey.value, 'pinned-other')
const disposedPin = harness.pinCopy(copies.value[1])
scope.stop()
finishPin()
await disposedPin
assert.equal(harness.selectedReferenceInstanceKey.value, 'pinned-other', 'disposed owner cannot alter history selection')

console.log('Roll rating regressions passed: tie-aware wording, exact reference Back/Forward, legacy routes, and missing-copy fallback.')
