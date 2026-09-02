import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileSearchQuery } from '../src/shared/search-query.ts'
import {
  buildSkillNames,
  createSkillExplorerRows,
  nextSkillSortControls,
  skillMatchForItem,
  updateSkillExplorerControls
} from '../src/renderer/src/workspaces/skill-explorer.ts'

const controls = {
  skill: 'Wendigo Totem',
  query: '',
  scope: 'all',
  rarity: 'all',
  slot: 'all',
  sort: 'amount',
  direction: 'desc',
  page: 3
}

assert.deepEqual(updateSkillExplorerControls(controls, { query: 'vitality' }, true), {
  ...controls,
  query: 'vitality',
  page: 1
})
assert.deepEqual(updateSkillExplorerControls(controls, { page: 4 }, false), { ...controls, page: 4 })
assert.deepEqual(nextSkillSortControls(controls, 'item'), {
  ...controls,
  sort: 'item',
  direction: 'asc',
  page: 1
})
assert.deepEqual(nextSkillSortControls({ ...controls, sort: 'amount' }, 'amount'), {
  ...controls,
  direction: 'asc',
  page: 1
})

function line(label, minimum, tone = 'default') {
  return { label, minimum, maximum: null, unit: minimum === null ? '' : '%', prefix: '', suffix: '', tone }
}

function item(overrides) {
  return {
    record: 'records/items/test.dbr',
    name: 'Test item',
    rarity: 'legendary',
    slot: 'head',
    levelRequirement: 94,
    discovered: false,
    availableCount: 0,
    presentation: { sections: [] },
    ...overrides
  }
}

const rankItem = item({
  record: 'rank',
  name: 'Wendigo Crown',
  presentation: {
    sections: [{ kind: 'base', heading: null, lines: [line('to Wendigo Totem', 3, 'skill')] }]
  }
})
const modifierItem = item({
  record: 'modifier',
  name: 'Vitality Idol',
  slot: 'offhand',
  levelRequirement: 82,
  presentation: {
    sections: [
      { kind: 'base', heading: null, lines: [line('Physical Damage converted to Vitality Damage', 100)] },
      { kind: 'skill-modifier', heading: 'Wendigo Totem', lines: [line('Skill Recharge', -2), line('Fire Damage converted to Vitality Damage', 50)] }
    ]
  }
})
const archivedMiHigh = item({ record: 'mi-high', name: 'Wendigo Barb', rarity: 'mi', slot: 'weapon', levelRequirement: 94, presentation: rankItem.presentation })
const archivedMiLow = item({ record: 'mi-low', name: 'Wendigo Barb', rarity: 'mi', slot: 'weapon', levelRequirement: 70, presentation: rankItem.presentation })
const unrelated = item({ record: 'other', name: 'Other', presentation: { sections: [] } })
const items = [rankItem, modifierItem, archivedMiHigh, archivedMiLow, unrelated]

assert.deepEqual(buildSkillNames(items, { 'Bloody Pox': 'Occultist' }), ['Bloody Pox', 'Wendigo Totem'])
assert.deepEqual(skillMatchForItem(rankItem, 'wendigo totem'), {
  skill: 'wendigo totem',
  amount: 3,
  conversionTarget: '',
  conversionDetails: '',
  special: ''
})
assert.deepEqual(skillMatchForItem(modifierItem, 'Wendigo Totem'), {
  skill: 'Wendigo Totem',
  amount: 0,
  conversionTarget: 'Vitality',
  conversionDetails: 'Skill: 50% Fire Damage converted to Vitality Damage; Global: 100% Physical Damage converted to Vitality Damage',
  special: '-2% Skill Recharge'
})
assert.equal(skillMatchForItem(unrelated, 'Wendigo Totem'), null)

const archived = new Set(['rank', 'mi-low'])
const allRows = createSkillExplorerRows(items, controls, {
  isArchivedItem: (candidate) => archived.has(candidate.record),
  query: compileSearchQuery('')
})
assert.deepEqual(allRows.map((row) => row.item.record), ['modifier', 'rank', 'mi-low'])
assert.equal(allRows.some((row) => row.item.record === 'mi-high'), false)

const filteredRows = createSkillExplorerRows(items, {
  ...controls,
  query: 'conversion:vitality AND level:<90',
  slot: 'offhand',
  sort: 'level',
  direction: 'asc'
}, {
  isArchivedItem: (candidate) => archived.has(candidate.record),
  query: compileSearchQuery('conversion:vitality AND level:<90')
})
assert.deepEqual(filteredRows.map((row) => row.item.record), ['modifier'])

const archiveRows = createSkillExplorerRows(items, { ...controls, scope: 'archive' }, {
  isArchivedItem: (candidate) => archived.has(candidate.record),
  query: compileSearchQuery('')
})
assert.deepEqual(archiveRows.map((row) => row.item.record), ['rank', 'mi-low'])

const [app, workspace, model] = await Promise.all([
  readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/SkillExplorerWorkspace.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/skill-explorer.ts', import.meta.url), 'utf8')
])

assert.match(app, /<SkillExplorerWorkspace[\s\S]*?v-(?:else-)?if="activeView === 'skills'"/)
assert.match(app, /const skillExplorerControls = ref<SkillExplorerControls>/)
assert.match(app, /v-model:controls="skillExplorerControls"/)
assert.doesNotMatch(app, /const skillItemRows|const skillSuggestions|const skillItemPage|const skillPickerOpen/)
assert.match(workspace, /defineModel<SkillExplorerControls>\('controls'/)
assert.match(workspace, /<ExplorerToolbar[\s\S]*?<BoundedResultSurface/)
assert.match(workspace, /:page-size="50"/)
assert.match(workspace, /emit\('queue-tooltip', row\.item/)
assert.match(workspace, /function showFocusedTooltip[\s\S]*?emit\('show-tooltip', row\.item, element\)/)
assert.match(workspace, /@item-focus="showFocusedTooltip"/)
assert.match(workspace, /emit\('open-item', row\.item/)
assert.match(app, /<SkillExplorerWorkspace[\s\S]*?@show-tooltip="showTooltip"/)
assert.doesNotMatch(workspace, /window\.cairnCodex/)
assert.match(model, /export function createSkillExplorerRows/)
assert.match(model, /export function skillMatchForItem/)

console.log('Skill Explorer workspace passed: typed control ownership, skill matching, MI tier collapse, structured filtering, sorting, global tooltip adapters, and a bounded 50-row result surface.')
