import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { glossaryEntries, glossaryEntry } from '../src/renderer/src/workspaces/glossary.ts'
import { glossarySources, isGlossarySourceUrl } from '../src/shared/glossary-sources.ts'
import { defaultAppRoute, parseAppRoute, appRouteHash, parseAppRouteHash, createAppHistoryEntry } from '../src/renderer/src/app-route.ts'
import { rollStatQuality, averageRollQuality, formatCombinationPercentile } from '../src/renderer/src/roll-rating.ts'
import { validateNavigation } from '../src/main/ipc/validation.ts'

const route = defaultAppRoute('glossary')
assert.deepEqual(validateNavigation({ view: 'glossary' }), { view: 'glossary' })
assert.throws(() => validateNavigation({ view: 'unknown' }))
assert.deepEqual(route.controls, { entry: 'item-rolls' })
assert.deepEqual(parseAppRouteHash(appRouteHash(route)), route)
assert.deepEqual(parseAppRoute({ ...route, itemRecord: 'arbitrary/item', controls: { entry: '<script>', huge: 'x'.repeat(10000) } }), route)
assert.equal(glossaryEntry(null), glossaryEntries[0])
assert.equal(new Set(glossaryEntries.map(entry => entry.id)).size, glossaryEntries.length)
const entry = glossaryEntry('item-rolls')
assert.equal(new Set(entry.sections.map(section => section.id)).size, entry.sections.length)
const stat = { field: 'offensiveVitality', value: 9, rollable: true, observedMinimum: 7, observedMaximum: 9, estimatedPercentile: 250 / 3 }
const rows = entry.sections.find(section => section.id === 'ties').table.rows
for (let index = 0; index < 3; index++) {
  assert.equal(rows[index][1], `${rollStatQuality({ ...stat, value: index + 7 })}%`)
  assert.equal(rows[index][2], formatCombinationPercentile(100 * (index + 0.5) / 3))
}
assert.equal(averageRollQuality([{ ...stat, value: 8 }, stat]), 75)
assert.equal(averageRollQuality([stat, { ...stat, rollable: false, observedMinimum: 9, estimatedPercentile: null }]), 100)
assert.equal(entry.example.quality, '78%')
assert.equal(entry.example.rank, '98th')
assert.ok(entry.sections.find(section => section.id === 'affixes').caution)
for (const id of ['calculation', 'ties', 'elemental']) assert.ok(entry.sections.find(section => section.id === id).expandable)
for (const source of glossarySources) assert.ok(isGlossarySourceUrl(source.url))
for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'https://www.grimdawn.com.evil.test/guide/gameplay/combat/', glossarySources[0].url + '?redirect=evil', 'https://github.com/Hinne1/cairn-codex']) assert.equal(isGlossarySourceUrl(url), false)

const [app, main, helper, sidebar, workspace] = await Promise.all([
  readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/helper/CairnCodex.GrimDawn/ItemRollAnalyzer.cs', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/components/WorkspaceSidebar.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/GlossaryWorkspace.vue', import.meta.url), 'utf8')
])
assert.match(helper, /PercentileSampleSize = 4096/)
assert.match(helper, /ModelVersion = 9/)
assert.match(JSON.stringify(entry), /4,096/)
assert.match(app, /@glossary="openGlossary\(\)"/)
assert.match(app, /function openGlossary[\s\S]*?activeView.value = 'glossary'[\s\S]*?selectedRecord.value = null[\s\S]*?selectedReferenceInstanceKey.value = null/)
assert.equal((app.match(/@open-roll-help="openGlossary\(\)"/g) ?? []).length, 2)
assert.match(sidebar, /data-destination-id="glossary"[\s\S]*?aria-label="Glossary"/)
assert.doesNotMatch(sidebar.slice(sidebar.indexOf('data-destination-id="glossary"'), sidebar.indexOf("emit('glossary')")), /disabled/)
assert.match(main, /isGlossarySourceUrl\(url\)[\s\S]*?shell.openExternal\(url\)[\s\S]*?action: 'deny'/)
assert.doesNotMatch(workspace, /v-html/)
assert.match(workspace, /onMounted\(focusEntry\)/)
const copyRoute = { ...defaultAppRoute(), itemRecord: 'synthetic-copy' }
const source = createAppHistoryEntry(1, copyRoute, 'copy-leader')
const help = createAppHistoryEntry(2, route)
assert.equal(source.referenceInstanceKey, 'copy-leader')
assert.equal(help.route.itemRecord, null)
console.log('Glossary passed: bounded routes, fixed/variable examples, tie ranks, extensible content, permanent navigation, help links, and exact external-reference allowlist.')
