import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileSearchQuery } from '../src/shared/search-query.ts'
import {
  eligibleDismantlingCandidates,
  filterDismantlingCandidates,
  selectRedundantDismantlingCandidateIds,
  updateDismantlingControls
} from '../src/renderer/src/workspaces/dismantling.ts'

const controls = { query: '', mode: 'all', rarity: 'all' }

function copy(overrides = {}) {
  return {
    id: 'copy-a',
    baseRecord: 'records/items/test/base.dbr',
    name: 'Test Legendary',
    rarity: 'legendary',
    slot: 'chest',
    levelRequirement: 94,
    itemLevel: 94,
    catalogued: true,
    reusable: false,
    isHardcore: false,
    state: 'ingested',
    seed: 1,
    stackCount: 1,
    prefixRecord: '',
    suffixRecord: '',
    componentRecord: '',
    augmentRecord: '',
    ascendant: false,
    instanceKey: 'instance-a',
    rollAnalysis: { overallEstimatedPercentile: 90 },
    ingestedAtUtc: '2026-08-30T12:00:00.000Z',
    retrievedAtUtc: null,
    ...overrides
  }
}

const copies = [
  copy(),
  copy({ id: 'copy-b', seed: 2, instanceKey: 'instance-b', rollAnalysis: { overallEstimatedPercentile: 50 }, ingestedAtUtc: '2026-08-31T12:00:00.000Z' }),
  copy({ id: 'copy-c', seed: 3, instanceKey: 'instance-c', componentRecord: 'records/items/materia/test.dbr', rollAnalysis: { overallEstimatedPercentile: 40 } }),
  copy({ id: 'copy-hc', seed: 4, instanceKey: 'instance-hc', isHardcore: true, rollAnalysis: null }),
  copy({ id: 'copy-epic', baseRecord: 'records/items/test/epic.dbr', name: 'Test Epic', rarity: 'epic', seed: 5, instanceKey: 'instance-epic' }),
  copy({ id: 'copy-retrieved', state: 'retrieved', seed: 6, instanceKey: 'instance-retrieved' }),
  copy({ id: 'copy-supply', rarity: 'supply', reusable: true, seed: 7, instanceKey: 'instance-supply' }),
  copy({ id: 'copy-quarantine', catalogued: false, seed: 8, instanceKey: 'instance-quarantine' })
]

const eligible = eligibleDismantlingCandidates(copies)
assert.deepEqual(eligible.map((item) => item.id), ['copy-a', 'copy-b', 'copy-c', 'copy-hc', 'copy-epic'])
assert.deepEqual(updateDismantlingControls(controls, { mode: 'hardcore' }), {
  query: '', mode: 'hardcore', rarity: 'all'
})
assert.deepEqual(controls, { query: '', mode: 'all', rarity: 'all' })

const hardcore = filterDismantlingCandidates(eligible, {
  ...controls,
  mode: 'hardcore'
}, compileSearchQuery(''))
assert.deepEqual(hardcore.map((item) => item.id), ['copy-hc'])

const epic = filterDismantlingCandidates(eligible, {
  ...controls,
  rarity: 'epic'
}, compileSearchQuery('name:"Test Epic" AND level:>=90'))
assert.deepEqual(epic.map((item) => item.id), ['copy-epic'])

assert.deepEqual(selectRedundantDismantlingCandidateIds(eligible), ['copy-b'])

const newestWinsWithoutScores = selectRedundantDismantlingCandidateIds([
  copy({ id: 'older', rollAnalysis: null, ingestedAtUtc: '2026-08-01T00:00:00.000Z' }),
  copy({ id: 'newer', rollAnalysis: null, ingestedAtUtc: '2026-09-01T00:00:00.000Z' })
])
assert.deepEqual(newestWinsWithoutScores, ['older'])

const [app, workspace, viewModel] = await Promise.all([
  readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/DismantlingWorkspace.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/dismantling.ts', import.meta.url), 'utf8')
])

assert.match(app, /<DismantlingWorkspace[\s\S]*?v-else-if="activeView === 'dismantling'"/)
assert.match(app, /const dismantlingControls = ref<DismantlingControls>/)
assert.match(app, /const dismantlingSession = createDismantlingSession\(\)/)
assert.match(app, /v-model:controls="dismantlingControls"/)
assert.match(app, /:preview-dismantling="previewDismantling"/)
assert.match(app, /case 'dismantling':[\s\S]*?dismantlingControls\.value = \{ \.\.\.route\.controls \}/)
assert.doesNotMatch(app, /const dismantlingQuery|const dismantlingMode|const dismantlingPreview|selectedDismantlingIds/)
assert.match(workspace, /defineModel<DismantlingControls>\('controls'/)
assert.match(workspace, /const \{ visibleCount, selectedIds, preview, busy, error, filterKey \} = props\.session/)
assert.match(workspace, /props\.previewDismantling\(\[\.\.\.selectedIds\.value\]\)/)
assert.match(workspace, /selectRedundantDismantlingCandidateIds\(filteredCandidates\.value\)/)
assert.doesNotMatch(workspace, /window\.cairnCodex/)
assert.match(viewModel, /export function eligibleDismantlingCandidates/)
assert.match(viewModel, /export function createDismantlingSession/)
assert.match(viewModel, /export function filterDismantlingCandidates/)
assert.match(viewModel, /export function selectRedundantDismantlingCandidateIds/)

console.log('Dismantling workspace passed: eligibility, structured filters, safe-duplicate selection, typed route ownership, and narrow preview adapter.')
