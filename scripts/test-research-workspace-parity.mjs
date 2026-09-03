import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  researchAcquisitionFacts,
  researchItemIsAvailable,
  nextResearchSort,
  researchItemPreferenceKey,
  researchItemTypeLabel,
  researchRollFact,
  researchSkillName
} from '../src/renderer/src/workspaces/research-item-table.ts'
import { parseAppRoute } from '../src/renderer/src/app-route.ts'

const sample = {
  record: 'records/items/gearhead/test.dbr',
  name: 'Test Visage',
  itemClass: 'ArmorProtective_Head',
  slot: 'head',
  rarity: 'legendary',
  levelRequirement: 65,
  bestRollPercentile: 94.25,
  acquisition: {
    sources: ['Random drop'],
    locations: [{ name: 'Ugdenbog', contentPack: 'gdx1' }],
    factions: []
  }
}

assert.equal(researchItemTypeLabel(sample), 'Head armor')
assert.equal(researchItemIsAvailable(sample, new Set([sample.record])), true)
assert.equal(researchItemIsAvailable({ ...sample, recipeUnlocked: true }, new Set()), true)
assert.equal(researchItemIsAvailable({ ...sample, recipeUnlocked: true }, new Set(), false), false, 'Planner recipe availability respects its SC/HC mode')
assert.equal(researchItemIsAvailable({ ...sample, availableViaAwakening: true, awakeningSourceAvailableCount: 1 }, new Set()), true)
assert.equal(researchItemIsAvailable({ ...sample, awakeningSourceRecord: 'records/base.dbr' }, new Set(['records/base.dbr'])), true)
assert.equal(researchItemIsAvailable({ ...sample, discovered: true, availableCount: 0 }, new Set()), false)
assert.equal(researchItemIsAvailable({ ...sample, availableViaAwakening: true, awakeningSourceAvailableCount: 0 }, new Set()), false)
assert.equal(researchItemIsAvailable({ ...sample, availableCount: 1 }, new Set()), false, 'A scanned stash copy alone is not an archived copy')
assert.deepEqual(nextResearchSort('level', 'asc', 'level'), { sort: 'level', direction: 'desc' })
assert.deepEqual(nextResearchSort('level', 'desc', 'level'), { sort: 'level', direction: 'asc' })
assert.deepEqual(nextResearchSort('level', 'desc', 'name'), { sort: 'name', direction: 'asc' })
assert.equal(researchItemPreferenceKey({ ...sample, record: 'records/items/awakened/test.dbr', name: 'Awakened Test Visage' }), 'legendary:head:testvisage')
assert.deepEqual(researchRollFact(sample), {
  label: 'Best roll',
  text: '94.3 percentile',
  tone: 'accent'
})
assert.deepEqual(researchAcquisitionFacts(sample), [
  { text: 'Random drop' },
  { label: 'Area', text: 'Ugdenbog', tone: 'muted' }
])
assert.equal(researchSkillName('wendigo totem'), 'Wendigo Totem')
assert.equal(researchSkillName('curse of frailty'), 'Curse of Frailty')
assert.equal(researchSkillName("Olexra's Flash Freeze"), "Olexra's Flash Freeze")

const [app, skillWorkspace, table, journey, contract, packageSource] = await Promise.all([
  readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/SkillExplorerWorkspace.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/components/ResearchItemTable.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/components/PlannerJourney.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/research-item-table.ts', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8')
])
const packageJson = JSON.parse(packageSource)

assert.match(contract, /export interface ResearchItemTableRow/)
assert.match(contract, /supports: readonly ResearchItemFact\[\][\s\S]*?modifiers: readonly ResearchItemModifier\[\][\s\S]*?acquisition: readonly ResearchItemFact\[\][\s\S]*?archive: readonly ResearchItemFact\[\]/)
assert.match(skillWorkspace, /<ResearchItemTable/)
assert.match(skillWorkspace, /available: researchItemIsAvailable\(row.item, props.archivedRecords\)/)
assert.match(app, /available: researchItemIsAvailable\(row.item, archivedRecordSet.value, recipe \? recipe.known === true/)
assert.match(app, /<ResearchItemTable[\s\S]*?<PlannerJourney/)
assert.match(app, /@sort="sortPlannerTable"/)
assert.match(app, /get: \(\) => plannerProfiles.value.find\([\s\S]*?\?\.ignoredRecords \?\? \[\]/)
assert.doesNotMatch(app, /initialPreferences.planner.ignoredRecords/)
assert.match(app, /tooltip-icon-placeholder[\s\S]*?comparison-icon-placeholder[\s\S]*?copy-icon-placeholder/)
assert.match(app, />Table<\/button>[\s\S]*?>Journey<\/button>[\s\S]*?>MI sources<\/button>/)
assert.doesNotMatch(app, /<button[^>]*>Grid<\/button>/)

assert.match(table, /\{ key: 'item', label: 'Item' \}[\s\S]*?\{ key: 'modifiers', label: 'Skill modifiers' \}[\s\S]*?\{ key: 'archive', label: 'Archive \/ roll' \}/)
assert.match(table, /:items="rows"[\s\S]*?:page-size="50"/)
assert.match(table, /class="research-item"[\s\S]*?@mouseenter="emit\('queue-tooltip', row\.item, \$event\)"[\s\S]*?@mouseleave="emit\('hide-tooltip'\)"[\s\S]*?@wheel="emit\('scroll-tooltip', \$event\)"/)
assert.doesNotMatch(table, /class="research-table-row"[^>]*@mouse(?:enter|move|leave)/)
assert.doesNotMatch(table, /class="research-item-picture"[^>]*tabindex/)
assert.doesNotMatch(table, /class="research-item-picture"[^>]*@mouseenter/)
assert.match(table, /@item-focus="showFocusedTooltip"/)
assert.match(table, /overscroll-behavior-y: auto/)
assert.match(table, /scrollbar-gutter: auto/)
for (const surface of [table, journey]) {
  assert.match(surface, /'is-unavailable': !row.available/)
  assert.match(surface, /<ResearchSkillFx :item="row.item"/)
  assert.match(surface, /row.modifiers.filter\(fact => fact.kind !== 'visual'\)/)
}
assert.match(table, /function scrollTableHorizontally[\s\S]*?table\.scrollLeft = nextScrollLeft[\s\S]*?@wheel\.shift="scrollTableHorizontally"/)
assert.match(table, /\['gd-rarity-name', `rarity-\$\{row\.item\.rarity\}`\]/)
assert.match(table, /@media \(max-width: 700px\)[\s\S]*?position: sticky/)
assert.doesNotMatch(table, /\.research-table-header\s*\{[^}]*position:\s*sticky/s)
assert.match(table, /@error="handleImageError\(row\.item\)"/)

assert.match(journey, /aria-label="Level-ordered build journey"/)
assert.match(journey, /:page-size="50"[\s\S]*?pagination="continuous"/)
assert.match(journey, /class="planner-journey-picture"[\s\S]*?@mouseenter="emit\('queue-tooltip', row\.item, \$event\)"/)
assert.doesNotMatch(journey, /class="planner-journey-row"[^>]*@mouse(?:enter|move|leave)/)
assert.match(journey, /@media \(max-width: 700px\)/)
assert.match(journey, /@error="handleImageError\(row\.item\)"/)

assert.equal(parseAppRoute({ version: 1, workspace: 'planner', controls: { display: 'list' } })?.controls.display, 'table')
assert.equal(parseAppRoute({ version: 1, workspace: 'planner', controls: { display: 'grid' } })?.controls.display, 'journey')
assert.match(packageJson.scripts.verify, /test:research-workspace-parity/)

console.log('Research workspace parity passed: one typed table contract, semantic Planner views, item-cell pointer tooltip triggers, keyboard descriptions, bounded results, and compact sticky identity columns.')
