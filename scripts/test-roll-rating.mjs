import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { computed, ref } from 'vue'
import ts from 'typescript'
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
const appSource = await readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8')
const presentedSource = appSource.slice(appSource.indexOf('function presentRolledStats('), appSource.indexOf('function rollStatName('))
const presentJs = ts.transpileModule(presentedSource + '\nreturn presentRolledStats', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText
const present = new Function('rollStatQuality', 'averageRollQuality', 'formatCombinationPercentile', 'rollStatUnit', 'formatRollValue', 'rollStatName', presentJs)(
  rollStatQuality, averageRollQuality, value => value === null ? null : `${Math.round(value)}th`, () => '', String, field => field
)
assert.equal(present([vitality])[0].qualityPercent, 100, 'the actual drawer projection must fill the meter at maximum')
const range = present([{ ...vitality, field: 'offensiveVitalityMin' }, { ...vitality, field: 'offensiveVitalityMax', value: 18, observedMinimum: 14, observedMaximum: 18 }])
assert.equal(range.length, 1)
assert.equal(range[0].qualityPercent, 100, 'min/max members must normalize independently before averaging')
assert.equal(range[0].rankLabel, null, 'do not invent a combination percentile by averaging marginal ranks')
assert.equal(present([{ ...vitality, field: 'offensiveVitalityMin' }, { ...vitality, field: 'offensiveVitalityMax', rollable: false, value: 18, observedMinimum: 18, observedMaximum: 18, estimatedPercentile: null }], true)[0].qualityPercent, 100,
  'a fixed range member must not hide or dilute the variable member quality')
const referenceSource = appSource.slice(appSource.indexOf('const comparisonReferenceCopy = computed('), appSource.indexOf('const selectedStoredCopies = computed('))
const restoreSource = appSource.slice(appSource.indexOf('function restoreAppRoute('), appSource.indexOf('function handlePageShow('))
assert.ok(referenceSource && restoreSource)
const js = ts.transpileModule(`
  let restoringAppHistory = false
  const activeView = ref('collection')
  const selectedRecord = ref(null)
  const selectedReferenceInstanceKey = ref(null)
  const collectionControls = ref({})
  const selectedItem = ref({ pinnedInstanceKey: 'pinned-other' })
  const copies = [{ instanceKey: 'pinned-other' }, { instanceKey: 'score-leader' }]
  const selectedCopies = computed(() => selectedRecord.value ? copies : [])
  const nextTick = () => {} // Workspace follow-up jobs are unrelated to copy identity.
  ${referenceSource}
  ${restoreSource}
  return { restoreAppRoute, comparisonReferenceCopy, selectedItem, selectedReferenceInstanceKey, copies }
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
const harness = new Function('ref', 'computed', js)(ref, computed)
const itemRoute = { ...defaultAppRoute('collection'), itemRecord: 'records/items/test.dbr' }
const history = [
  createAppHistoryEntry(0, defaultAppRoute('collection')),
  createAppHistoryEntry(1, itemRoute, 'score-leader'),
  createAppHistoryEntry(2, defaultAppRoute('collection'))
]
function restore(index) {
  const entry = parseAppHistoryEntry(JSON.parse(JSON.stringify(history[index])))
  harness.restoreAppRoute(entry.route, entry.referenceInstanceKey)
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
harness.restoreAppRoute(itemRoute) // Shared links/old entries have no local copy selection.
assert.equal(harness.comparisonReferenceCopy.value.instanceKey, 'pinned-other')
harness.restoreAppRoute(itemRoute, 'removed-copy')
assert.equal(harness.comparisonReferenceCopy.value.instanceKey, 'pinned-other', 'missing copies fall back safely')

console.log('Roll rating regressions passed: tie-aware wording, exact reference Back/Forward, legacy routes, and missing-copy fallback.')
