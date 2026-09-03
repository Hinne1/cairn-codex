import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  researchAcquisitionFacts,
  researchItemTypeLabel,
  researchRollFact
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
assert.deepEqual(researchRollFact(sample), {
  label: 'Best roll',
  text: '94.3 percentile',
  tone: 'accent'
})
assert.deepEqual(researchAcquisitionFacts(sample), [
  { text: 'Random drop' },
  { label: 'Area', text: 'Ugdenbog', tone: 'muted' }
])

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
assert.match(contract, /supports: readonly ResearchItemFact\[\][\s\S]*?evidence: readonly ResearchItemFact\[\][\s\S]*?acquisition: readonly ResearchItemFact\[\][\s\S]*?archive: readonly ResearchItemFact\[\]/)
assert.match(skillWorkspace, /<ResearchItemTable/)
assert.match(app, /<ResearchItemTable[\s\S]*?<PlannerJourney/)
assert.match(app, />Table<\/button>[\s\S]*?>Journey<\/button>[\s\S]*?>MI sources<\/button>/)
assert.doesNotMatch(app, /<button[^>]*>Grid<\/button>/)

assert.match(table, /\{ key: 'item', label: 'Item' \}[\s\S]*?\{ key: 'archive', label: 'Archive \/ roll' \}/)
assert.match(table, /:items="rows"[\s\S]*?:page-size="50"/)
assert.match(table, /class="research-item-picture"[\s\S]*?@mouseenter="emit\('queue-tooltip', row\.item, \$event\)"[\s\S]*?@mouseleave="emit\('hide-tooltip'\)"/)
assert.doesNotMatch(table, /class="research-table-row"[^>]*@mouse(?:enter|move|leave)/)
assert.doesNotMatch(table, /class="research-item-picture"[^>]*tabindex/)
assert.match(table, /@item-focus="showFocusedTooltip"/)
assert.match(table, /@media \(max-width: 700px\)[\s\S]*?position: sticky/)

assert.match(journey, /aria-label="Level-ordered build journey"/)
assert.match(journey, /:page-size="50"[\s\S]*?pagination="continuous"/)
assert.match(journey, /class="planner-journey-picture"[\s\S]*?@mouseenter="emit\('queue-tooltip', row\.item, \$event\)"/)
assert.doesNotMatch(journey, /class="planner-journey-row"[^>]*@mouse(?:enter|move|leave)/)
assert.match(journey, /@media \(max-width: 700px\)/)

assert.equal(parseAppRoute({ version: 1, workspace: 'planner', controls: { display: 'list' } })?.controls.display, 'table')
assert.equal(parseAppRoute({ version: 1, workspace: 'planner', controls: { display: 'grid' } })?.controls.display, 'journey')
assert.match(packageJson.scripts.verify, /test:research-workspace-parity/)

console.log('Research workspace parity passed: one typed table contract, semantic Planner views, picture-only pointer tooltip triggers, keyboard descriptions, bounded results, and compact sticky identity columns.')
