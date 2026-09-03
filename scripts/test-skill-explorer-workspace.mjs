import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileSearchQuery } from '../src/shared/search-query.ts'
import {
  buildSkillNames,
  createSkillExplorerRows,
  nextSkillSuggestionIndex,
  nextSkillSortControls,
  skillSortAriaValue,
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
assert.deepEqual(nextSkillSortControls({ ...controls, sort: 'amount' }, 'level'), {
  ...controls,
  sort: 'level',
  direction: 'asc',
  page: 1
})
assert.equal(nextSkillSuggestionIndex(7, 10, 'next', false), 0)
assert.equal(nextSkillSuggestionIndex(7, 10, 'previous', false), 9)
assert.equal(nextSkillSuggestionIndex(9, 10, 'next', true), 0)
assert.equal(nextSkillSuggestionIndex(0, 10, 'previous', true), 9)
assert.equal(nextSkillSuggestionIndex(4, 0, 'next', true), 0)
assert.equal(skillSortAriaValue('level', 'asc', 'level'), 'ascending')
assert.equal(skillSortAriaValue('level', 'desc', 'level'), 'descending')
assert.equal(skillSortAriaValue('level', 'desc', 'item'), undefined)

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
const visualItem = item({
  record: 'visual',
  name: 'Wendigo Visage',
  levelRequirement: 65,
  presentation: {
    sections: [{
      kind: 'visual-modifier',
      heading: 'Wendigo Totem · Visual transformation',
      lines: [line('Alternate crimson spirit effect', null, 'visual')]
    }]
  }
})
const archivedMiHigh = item({ record: 'mi-high', name: 'Wendigo Barb', rarity: 'mi', slot: 'weapon', levelRequirement: 94, presentation: rankItem.presentation })
const archivedMiLow = item({ record: 'mi-low', name: 'Wendigo Barb', rarity: 'mi', slot: 'weapon', levelRequirement: 70, presentation: rankItem.presentation })
const unrelated = item({ record: 'other', name: 'Other', presentation: { sections: [] } })
const items = [rankItem, modifierItem, visualItem, archivedMiHigh, archivedMiLow, unrelated]

assert.deepEqual(buildSkillNames(items, { 'Bloody Pox': 'Occultist' }), ['Bloody Pox', 'Wendigo Totem'])
assert.deepEqual(skillMatchForItem(rankItem, 'wendigo totem'), {
  skill: 'wendigo totem',
  amount: 3,
  conversionTarget: '',
  conversionDetails: '',
  special: '',
  visualTransformation: ''
})
assert.deepEqual(skillMatchForItem(modifierItem, 'Wendigo Totem'), {
  skill: 'Wendigo Totem',
  amount: 0,
  conversionTarget: 'Vitality',
  conversionDetails: 'Skill: 50% Fire Damage converted to Vitality Damage; Global: 100% Physical Damage converted to Vitality Damage',
  special: '-2% Skill Recharge',
  visualTransformation: ''
})
assert.deepEqual(skillMatchForItem(visualItem, 'Wendigo Totem'), {
  skill: 'Wendigo Totem',
  amount: 0,
  conversionTarget: '',
  conversionDetails: '',
  special: '',
  visualTransformation: 'Alternate crimson spirit effect'
})
assert.equal(skillMatchForItem(unrelated, 'Wendigo Totem'), null)

const archived = new Set(['rank', 'mi-low'])
const allRows = createSkillExplorerRows(items, controls, {
  isArchivedItem: (candidate) => archived.has(candidate.record),
  query: compileSearchQuery('')
})
assert.deepEqual(allRows.map((row) => row.item.record), ['visual', 'modifier', 'rank', 'mi-low'])
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

const defaultRows = createSkillExplorerRows(items, { ...controls, sort: 'level', direction: 'asc' }, {
  isArchivedItem: (candidate) => archived.has(candidate.record),
  query: compileSearchQuery('')
})
assert.deepEqual(defaultRows.map((row) => row.item.levelRequirement), [65, 70, 82, 94])

const [app, workspace, table, model, packageSource] = await Promise.all([
  readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/SkillExplorerWorkspace.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/components/ResearchItemTable.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/skill-explorer.ts', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8')
])
const packageJson = JSON.parse(packageSource)

assert.match(app, /<SkillExplorerWorkspace[\s\S]*?v-(?:else-)?if="activeView === 'skills'"/)
assert.match(app, /const skillExplorerControls = ref<SkillExplorerControls>/)
assert.match(app, /v-model:controls="skillExplorerControls"/)
assert.doesNotMatch(app, /const skillItemRows|const skillSuggestions|const skillItemPage|const skillPickerOpen/)
assert.match(workspace, /defineModel<SkillExplorerControls>\('controls'/)
assert.match(workspace, /<ExplorerToolbar[\s\S]*?<ResearchItemTable/)
assert.match(table, /<BoundedResultSurface[\s\S]*?:page-size="50"/)
assert.match(table, /class="research-item"[\s\S]*?@mouseenter="emit\('queue-tooltip', row\.item, \$event\)"/)
assert.doesNotMatch(table, /class="research-table-row"[^>]*@mouseenter/)
assert.match(table, /function showFocusedTooltip[\s\S]*?emit\('show-tooltip', row\.item, element\)/)
assert.match(table, /@item-focus="showFocusedTooltip"/)
assert.match(workspace, /@activate="emit\('open-item', \$event\)"/)
assert.match(workspace, /:aria-activedescendant="activeSuggestionId"/)
assert.match(workspace, /:aria-controls="pickerOpen \? skillListboxId : undefined"/)
assert.match(workspace, /props\.skillNames\.map\(\(skill, index\) => \[skill, `\$\{skillListboxId\}-option-\$\{index\}`\]\)/)
assert.match(workspace, /role="option"[\s\S]*?tabindex="-1"[\s\S]*?:aria-selected="index === pickerIndex"/)
assert.match(workspace, /@mousedown\.prevent[\s\S]*?@click="selectSkill\(skill\)"/)
assert.match(workspace, /function revealActiveSuggestion[\s\S]*?listbox\.scrollTop/)
assert.match(table, /\{ key: 'item', label: 'Item' \}[\s\S]*?\{ key: 'modifiers', label: 'Skill modifiers' \}[\s\S]*?\{ key: 'archive', label: 'Archive \/ roll' \}/)
assert.match(table, /:aria-sort="ariaSort\(column\.key\)"/)
assert.match(workspace, /label: 'Visual'[\s\S]*?row\.visualTransformation/)
assert.match(app, /const skillExplorerControls = ref<SkillExplorerControls>\(\{[\s\S]*?sort: 'level',[\s\S]*?direction: 'asc'/)
assert.match(app, /function scrollTooltip\(event: WheelEvent\)[\s\S]*?event\.currentTarget === tooltip[\s\S]*?tooltipBoundaryScroll\.value === 'contain'[\s\S]*?animateTooltipScroll/)
assert.match(app, /tooltip-boundary-\$\{tooltipBoundaryScroll\}[\s\S]*?tooltip-icon-placeholder/)
assert.match(app, /@mouseenter="cancelTooltipHide"[\s\S]*?@wheel="scrollTooltip"/)
assert.match(app, /<SkillExplorerWorkspace[\s\S]*?@show-tooltip="showTooltip"/)
assert.doesNotMatch(workspace, /window\.cairnCodex/)
assert.match(model, /export function createSkillExplorerRows/)
assert.match(model, /export function skillMatchForItem/)
assert.match(packageJson.scripts['test:skill-explorer-workspace:electron'], /test-skill-explorer-workspace-electron\.mjs/)
assert.match(packageJson.scripts.verify, /test:skill-explorer-workspace:electron/)

console.log('Skill Explorer workspace passed: typed control ownership, accessible combobox traversal and sorting, skill matching, MI tier collapse, structured filtering, global tooltip adapters, and a bounded 50-row result surface.')
