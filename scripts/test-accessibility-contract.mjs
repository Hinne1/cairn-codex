import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { nextModalFocusTarget } from '../src/renderer/src/modal-focus.ts'
import { preferredScrollBehavior } from '../src/renderer/src/motion-preference.ts'

const root = { id: 'dialog' }
const first = { id: 'first' }
const middle = { id: 'middle' }
const last = { id: 'last' }
const outside = { id: 'outside' }
const controls = [first, middle, last]

assert.equal(nextModalFocusTarget(root, controls, root, false), first)
assert.equal(nextModalFocusTarget(root, controls, root, true), last)
assert.equal(nextModalFocusTarget(root, controls, first, true), last)
assert.equal(nextModalFocusTarget(root, controls, last, false), first)
assert.equal(nextModalFocusTarget(root, controls, middle, false), null)
assert.equal(nextModalFocusTarget(root, controls, outside, false), first)
assert.equal(nextModalFocusTarget(root, controls, outside, true), last)
assert.equal(nextModalFocusTarget(root, [], outside, false), root)
assert.equal(preferredScrollBehavior(true), 'auto')
assert.equal(preferredScrollBehavior(false), 'smooth')

const componentPaths = [
  '../src/renderer/src/components/AdvancedSearchDialog.vue',
  '../src/renderer/src/components/OnboardingDialog.vue',
  '../src/renderer/src/components/PlannerSetupDialog.vue'
]
const [components, controller, app, tokens] = await Promise.all([
  Promise.all(componentPaths.map(async (path) => ({
    path,
    source: await readFile(new URL(path, import.meta.url), 'utf8')
  }))),
  readFile(new URL('../src/renderer/src/modal-focus.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/semantic-tokens.css', import.meta.url), 'utf8')
])

for (const { path, source } of components) {
  assert.match(source, /useModalDialogFocus/iu, `${path} must use the shared modal focus controller.`)
  assert.match(source, /aria-(?:modal|labelledby)/iu, `${path} must expose dialog semantics.`)
  assert.doesNotMatch(source, /querySelectorAll<HTMLElement>\(/u, `${path} must not carry a private focus-trap implementation.`)
}

assert.match(controller, /document\.addEventListener\('focusin', retainFocus, true\)/u)
assert.match(controller, /event\.key === 'Escape'/u)
assert.match(controller, /previouslyFocused/u)
assert.match(controller, /target\?\.isConnected/u)

const legacyAppDialogCount = (app.match(/role="dialog"/gu) ?? []).length
assert.equal(legacyAppDialogCount, 4, 'App.vue dialog debt changed; migrate or document it instead of adding another private modal.')
assert.doesNotMatch(app, /behavior:\s*['"]smooth['"]/u, 'JavaScript scrolling must honor reduced motion.')
assert.match(app, /behavior: preferredScrollBehavior\(\)/u)

assert.match(tokens, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration: 0\.01ms !important/iu)
assert.match(tokens, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-iteration-count: 1 !important/iu)
assert.match(tokens, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition-duration: 0\.01ms !important/iu)
assert.match(tokens, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?scroll-behavior: auto !important/iu)

console.log(JSON.stringify({
  passed: true,
  sharedDialogComponents: components.length,
  legacyAppDialogs: legacyAppDialogCount,
  tabCycle: true,
  escapedFocusRecovery: true,
  focusRestoration: true,
  reducedMotionOverride: true
}, null, 2))
