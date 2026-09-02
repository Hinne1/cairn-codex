import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileSearchQuery } from '../src/shared/search-query.ts'
import {
  buildMiMetricOptions,
  compareCopiesByMiMetric,
  createMiWorkshopRows,
  miFamilyKey,
  miMetricLabel,
  miMetricResult,
  updateMiWorkshopControls
} from '../src/renderer/src/workspaces/mi-workshop.ts'

const controls = {
  query: '',
  affix: 'all',
  metric: 'overall',
  metricDirection: 'desc',
  sort: 'metric',
  page: 3
}

assert.deepEqual(updateMiWorkshopControls(controls, { query: 'bloodsworn' }, true), {
  ...controls,
  query: 'bloodsworn',
  page: 1
})
assert.deepEqual(updateMiWorkshopControls(controls, { page: 4 }, false), { ...controls, page: 4 })

function item(overrides = {}) {
  return {
    record: 'records/items/mi/test.dbr',
    name: 'Bloodsworn Codex',
    rarity: 'mi',
    slot: 'offhand',
    levelRequirement: 94,
    itemLevel: 94,
    discovered: true,
    availableCount: 1,
    presentation: { sections: [] },
    ...overrides
  }
}

function analysis(overall, base, prefix, suffix, fire, petHealth = null) {
  return {
    baseRecord: 'records/items/mi/test.dbr',
    prefixRecord: '',
    suffixRecord: '',
    seed: overall,
    supported: true,
    trusted: true,
    reason: null,
    percentileSampleSize: 100,
    overallEstimatedPercentile: overall,
    baseEstimatedPercentile: base,
    prefixEstimatedPercentile: prefix,
    suffixEstimatedPercentile: suffix,
    stats: [{ field: 'offensiveFireModifier', value: fire, rollable: true, observedMinimum: 50, observedMaximum: 100, estimatedPercentile: fire }],
    petStats: petHealth === null ? [] : [{ field: 'characterLifeModifier', value: petHealth, rollable: true, observedMinimum: 10, observedMaximum: 20, estimatedPercentile: petHealth }],
    unmodeledFields: []
  }
}

function copy(prefixRecord, suffixRecord, rollAnalysis, overrides = {}) {
  return {
    sourcePath: 'vault://copy',
    tabIndex: 0,
    itemIndex: 0,
    baseRecord: 'records/items/mi/test.dbr',
    prefixRecord,
    suffixRecord,
    modifierRecord: '',
    transmuteRecord: '',
    seed: rollAnalysis?.seed ?? 0,
    materiaRecord: '',
    relicCompletionBonusRecord: '',
    relicSeed: 0,
    enchantmentRecord: '',
    ascendantRecord: '',
    ascendantRecord2H: '',
    enchantmentSeed: 0,
    materiaCombines: 0,
    stackCount: 1,
    rerolls: 0,
    affixRerolls: 0,
    rollAnalysis,
    instanceKey: `${prefixRecord}|${suffixRecord}|${rollAnalysis?.seed ?? 0}`,
    ...overrides
  }
}

const affixes = [
  { key: 'magic-prefix', name: 'Impervious', kind: 'prefix', rarity: 'magical', records: ['affix/magic-prefix.dbr'], availableCount: 1 },
  { key: 'rare-prefix', name: "Subjugator's", kind: 'prefix', rarity: 'rare', records: ['affix/rare-prefix.dbr'], availableCount: 2 },
  { key: 'magic-suffix', name: 'of Alacrity', kind: 'suffix', rarity: 'magical', records: ['affix/magic-suffix.dbr'], availableCount: 1 },
  {
    key: 'rare-suffix',
    name: 'of Binding',
    kind: 'suffix',
    rarity: 'rare',
    records: ['affix/rare-suffix.dbr'],
    availableCount: 2,
    presentations: {
      'affix/rare-suffix.dbr': {
        sections: [{ kind: 'skill-modifier', heading: 'Summon Familiar', lines: [{ prefix: '', minimum: 20, maximum: null, unit: '%', label: 'Vitality Damage', suffix: '', tone: 'default' }] }]
      }
    }
  }
]

const magicPair = copy('affix/magic-prefix.dbr', 'affix/magic-suffix.dbr', analysis(91, 80, 95, 88, 70))
const rareLow = copy('affix/rare-prefix.dbr', 'affix/rare-suffix.dbr', analysis(45, 40, 51, 38, 90, 15))
const rareHigh = copy('affix/rare-prefix.dbr', 'affix/rare-suffix.dbr', analysis(72, 68, 80, 70, 55, 20))
const items = [item(), item({ record: 'records/items/legendary/not-mi.dbr', rarity: 'legendary' })]
const copies = [magicPair, rareLow, rareHigh]

const rows = createMiWorkshopRows({ items, affixes, copies, controls, query: compileSearchQuery('') })
assert.equal(rows.length, 2)
assert.equal(rows[0].leader.instanceKey, magicPair.instanceKey)
const rareRow = rows.find((row) => row.prefix === "Subjugator's")
assert.equal(rareRow?.copies.length, 2)
assert.equal(rareRow?.leader.instanceKey, rareHigh.instanceKey)
assert.equal(rareRow?.selectedMetric.display, '72.0%')

const doubleRareRows = createMiWorkshopRows({
  items,
  affixes,
  copies,
  controls: { ...controls, affix: 'double-rare' },
  query: compileSearchQuery('')
})
assert.deepEqual(doubleRareRows.map((row) => [row.prefix, row.suffix]), [["Subjugator's", 'of Binding']])
assert.equal(doubleRareRows.some((row) => row.prefix === 'Impervious'), false, 'magic + magic must never pass the double-rare filter')

const structuredRows = createMiWorkshopRows({
  items,
  affixes,
  copies,
  controls: { ...controls, query: 'skill:"summon familiar" AND damage:vitality' },
  query: compileSearchQuery('skill:"summon familiar" AND damage:vitality')
})
assert.deepEqual(structuredRows.map((row) => row.prefix), ["Subjugator's"])

const levelRows = createMiWorkshopRows({
  items: [item(), item({ record: 'records/items/mi/low.dbr', name: 'Leafmane Trophy', levelRequirement: 70 })],
  affixes,
  copies: [...copies, copy('affix/rare-prefix.dbr', 'affix/magic-suffix.dbr', analysis(30, 30, 30, 30, 30), { baseRecord: 'records/items/mi/low.dbr' })],
  controls: { ...controls, sort: 'level', metricDirection: 'asc' },
  query: compileSearchQuery('')
})
assert.equal(levelRows[0].base.name, 'Leafmane Trophy')

const options = buildMiMetricOptions(copies)
assert.equal(miMetricLabel(options, 'item:offensiveFireModifier'), 'Fire damage')
assert.equal(miMetricLabel(options, 'pet:characterLifeModifier'), 'Pet · Health')
assert.deepEqual(miMetricResult(rareLow, 'item:offensiveFireModifier'), { value: 90, percentile: 90, display: '90 · 90%' })
assert.equal(compareCopiesByMiMetric(rareLow, rareHigh, 'item:offensiveFireModifier', 'desc') < 0, true)
assert.equal(miFamilyKey(item({ name: '  BLOODSWORN CODEX  ' })), miFamilyKey(item()))

const largeCopies = Array.from({ length: 20_000 }, (_, index) => copy(
  index % 2 === 0 ? 'affix/rare-prefix.dbr' : 'affix/magic-prefix.dbr',
  Math.floor(index / 2) % 2 === 0 ? 'affix/rare-suffix.dbr' : 'affix/magic-suffix.dbr',
  analysis(20 + index % 79, 15 + index % 79, 25 + index % 74, 18 + index % 79, 50 + index % 51),
  { itemIndex: index, instanceKey: `large-mi-${index}` }
))
const largeStarted = performance.now()
const largeRows = createMiWorkshopRows({ items, affixes, copies: largeCopies, controls, query: compileSearchQuery('') })
const largeProjectionMs = performance.now() - largeStarted
assert.equal(largeRows.length, 4)
assert.equal(largeRows.reduce((total, row) => total + row.copies.length, 0), 20_000)

const [app, workspace, model] = await Promise.all([
  readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/MiWorkshopWorkspace.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/mi-workshop.ts', import.meta.url), 'utf8')
])

assert.match(app, /<MiWorkshopWorkspace[\s\S]*?v-else-if="activeView === 'mi-workshop'"/)
assert.match(app, /const miWorkshopControls = ref<MiWorkshopControls>/)
assert.match(app, /const miWorkshopSession = createMiWorkshopSession\(\)/)
assert.match(app, /case 'mi-workshop':[\s\S]*?miWorkshopControls\.value = \{ \.\.\.route\.controls \}/)
assert.match(app, /v-model:controls="miWorkshopControls"/)
assert.match(app, /miWorkshopWorkspace\.value\?\.syncNativeControls\(\)/)
assert.doesNotMatch(app, /const miWorkshopRows|const miWorkshopQuery|syncMiWorkshopControlElements/)
assert.match(workspace, /defineModel<MiWorkshopControls>\('controls'/)
assert.match(workspace, /defineExpose\(\{ syncNativeControls \}\)/)
assert.match(workspace, /<ToolHeader[\s\S]*?<ExplorerToolbar[\s\S]*?<BoundedResultSurface/)
assert.match(workspace, /:page-size="50"/)
assert.match(workspace, /const projectionControls = computed<MiWorkshopControls>[\s\S]*?page: 1[\s\S]*?controls: projectionControls\.value/)
assert.doesNotMatch(workspace, /controls: controls\.value/)
assert.match(workspace, /function showFocusedTooltip[\s\S]*?emit\('show-tooltip', row\.base, element, row\.leader\)/)
assert.match(workspace, /emit\('queue-tooltip', row\.base, \$event, row\.leader\)/)
assert.match(workspace, /emit\('open-item', row\.base\)/)
assert.doesNotMatch(workspace, /window\.cairnCodex/)
assert.match(model, /group\.prefixRarity === 'rare' && group\.suffixRarity === 'rare'/)
assert.match(model, /export function createMiWorkshopRows/)

console.log(`MI Workshop workspace passed: typed control ownership, exact rare/rare filtering, grouping, structured affix search, metric leadership, level sorting, global tooltip adapters, and a bounded 50-row comparison surface. The generated 20k-copy projection completed in ${largeProjectionMs.toFixed(1)} ms.`)
