import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createBoundedResultWindow,
  moveBoundedResultKey,
  updateBoundedSelection
} from '../src/renderer/src/bounded-results.ts'

function generatedItems(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `item-${index}`, index }))
}

for (const count of [20_000, 50_000]) {
  const items = generatedItems(count)
  const first = createBoundedResultWindow({ items, getKey: (item) => item.id, page: 1, pageSize: 50 })
  assert.equal(first.entries.length, 50, `${count.toLocaleString()} items mounted more than one page`)
  assert.equal(first.entries[0].index, 0)
  assert.equal(first.entries.at(-1).index, 49)
  assert.equal(first.totalCount, count)
  assert.equal(first.pageCount, count / 50)

  const last = createBoundedResultWindow({ items, getKey: (item) => item.id, page: Number.MAX_SAFE_INTEGER, pageSize: 50 })
  assert.equal(last.page, count / 50)
  assert.equal(last.entries.length, 50)
  assert.equal(last.entries.at(-1).index, count - 1)
}

const remote = createBoundedResultWindow({
  items: generatedItems(120),
  getKey: (item) => item.id,
  page: 2,
  pageSize: 50,
  totalCount: 50_000,
  remote: true
})
assert.equal(remote.entries.length, 50, 'Remote pages must remain bounded even if an endpoint over-delivers')
assert.equal(remote.entries[0].index, 50)
assert.equal(remote.pageCount, 1_000)

assert.throws(() => createBoundedResultWindow({
  items: [{ id: 'same' }, { id: 'same' }],
  getKey: (item) => item.id
}), /stable unique keys/i)

const keys = ['a', 'b', 'c', 'd', 'e', 'f']
assert.equal(moveBoundedResultKey(keys, 'c', 'first'), 'a')
assert.equal(moveBoundedResultKey(keys, 'c', 'last'), 'f')
assert.equal(moveBoundedResultKey(keys, 'c', 'previous'), 'b')
assert.equal(moveBoundedResultKey(keys, 'c', 'next'), 'd')
assert.equal(moveBoundedResultKey(keys, 'e', 'row-up', 2), 'c')
assert.equal(moveBoundedResultKey(keys, 'b', 'row-down', 2), 'd')
assert.equal(moveBoundedResultKey(keys, 'a', 'previous'), 'a')
assert.equal(moveBoundedResultKey(keys, 'f', 'next'), 'f')
assert.equal(moveBoundedResultKey([], null, 'next'), null)

assert.deepEqual(updateBoundedSelection([], 'a', 'none'), [])
assert.deepEqual(updateBoundedSelection(['a'], 'b', 'single'), ['b'])
assert.deepEqual(updateBoundedSelection(['a'], 'b', 'multiple'), ['a', 'b'])
assert.deepEqual(updateBoundedSelection(['a', 'b'], 'a', 'multiple'), ['b'])

const [appSource, researchTableSource, plannerJourneySource, surfaceSource, styleSource] = await Promise.all([
  readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/components/ResearchItemTable.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/components/PlannerJourney.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/components/BoundedResultSurface.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8')
])
assert.match(researchTableSource, /:pagination="pagination"/u,
  'The shared research table must pass its pagination mode to the bounded result surface.')
assert.match(appSource, /<ResearchItemTable[\s\S]*?label="Leveling Planner item results"[\s\S]*?pagination="continuous"/u,
  'The planner table must request continuous bounded results instead of explicit page navigation.')
assert.match(plannerJourneySource, /pagination="continuous"[\s\S]*?label="Leveling Planner journey items"/u,
  'The Planner journey must use continuous bounded results instead of explicit page navigation.')
assert.match(appSource, />Table<\/button>[\s\S]*?>Journey<\/button>/u,
  'The planner display switcher must expose clear Table and Journey choices.')
assert.match(appSource, /function scrollTooltip\(event: WheelEvent\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?tooltip\.scrollTop = nextScrollTop/u,
  'Overflowing tooltips must scroll with an ordinary wheel from either the tooltip or its item trigger.')
assert.match(appSource, /@mouseenter="cancelTooltipHide"[\s\S]*?@mouseleave="scheduleTooltipHide"[\s\S]*?@wheel="scrollTooltip"/u,
  'Pointer users must be able to enter and scroll the tooltip without dismissing it.')
assert.match(appSource, /function scrollTooltipFromKeyboard\(event: KeyboardEvent\)[\s\S]*?PageDown[\s\S]*?PageUp[\s\S]*?aria-describedby[\s\S]*?item-tooltip/u,
  'Focused item triggers must expose direct keyboard scrolling for overflowing tooltip details.')
assert.doesNotMatch(appSource, /id="item-tooltip"[\s\S]{0,400}:aria-label=/u,
  'The tooltip must retain its descendant text as the accessible description of item triggers.')
assert.doesNotMatch(appSource, /Alt \+ Mouse Wheel to Scroll Tooltip/u)
assert.match(styleSource, /\.game-tooltip[\s\S]*?pointer-events: auto;[\s\S]*?scrollbar-width: thin;/u)
assert.match(surfaceSource, /pagination\?: 'pages' \| 'continuous'/u)
assert.match(surfaceSource, /continuousEndPage\.value > continuousStartPage\.value/u,
  'Continuous results must discard old pages rather than grow the mounted DOM without a bound.')
assert.match(surfaceSource, /watch\(\(\) => props\.layout[\s\S]*?continuousLeadingSpace\.value = 0/u,
  'Continuous results must invalidate layout-specific spacer measurements when List/Grid geometry changes.')
assert.match(surfaceSource, /focus\(\{ preventScroll: true \}\)/u,
  'Continuous eviction must restore keyboard focus without undoing its scroll anchor.')
assert.match(surfaceSource, /function unobscuredViewportTop[\s\S]*?querySelector<HTMLElement>\('\.topbar'\)[\s\S]*?getBoundingClientRect\(\)\.bottom/u,
  'Continuous results must treat the sticky topbar as an obscured portion of the viewport.')
assert.match(surfaceSource, /function keepElementInViewport[\s\S]*?rect\.height > availableHeight[\s\S]*?rect\.top - visibleTop[\s\S]*?requestAnimationFrame[\s\S]*?keepElementInViewport\(focusElement\)/u,
  'Continuous layout changes must keep restored keyboard focus visible after reflow settles without oscillating oversized cards.')
assert.match(surfaceSource, /:data-result-key="String\(entry\.key\)"/u,
  'Bounded results must expose stable rendered identity for cross-layout interaction verification.')
assert.doesNotMatch(styleSource, /\.planner-table-wrap\s*\{[^}]*max-height/iu,
  'The planner list must not create a height-bounded nested vertical scroller.')
assert.match(researchTableSource, /overscroll-behavior-x: contain;[\s\S]*?overscroll-behavior-y: auto;/u,
  'Wide research tables must preserve horizontal containment without blocking vertical page scrolling.')
assert.match(researchTableSource, /class="research-item"[\s\S]*?@wheel="emit\('scroll-tooltip', \$event\)"/u,
  'The complete item identity cell must route wheel input to an overflowing tooltip.')

console.log('Bounded result contract passed for 20k and 50k generated collections; mounted entries remained capped at 50.')
