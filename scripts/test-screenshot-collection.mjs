import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { presentScreenshotCollection } from '../src/main/screenshot-collection.ts'

const copies = Object.freeze(Array.from({ length: 72 }, (_, index) => Object.freeze({
  instanceKey: `fixture-mi-${index}`, seed: 1000000 + index, sourcePath: 'synthetic-sc',
  baseRecord: `synthetic-${Math.floor(index / 12)}`
})))
const snapshot = Object.freeze({ observedItems: copies, items: Object.freeze([{ record: 'synthetic' }]), basis: 'stashes' })
let creations = 0
const skillItems = [{ record: 'synthetic-skill', availableCount: 2 }]
const createFixture = name => { assert.equal(name, 'skill-explorer'); creations++; return { items: skillItems } }
for (const basis of ['archive', 'stashes']) {
  for (const fixture of ['mi-workshop', 'bounded-grid-a11y']) {
    const result = presentScreenshotCollection(snapshot, basis, 'capture.png', fixture, createFixture)
    assert.equal(result.basis, basis)
    assert.strictEqual(result.observedItems, copies)
    assert.strictEqual(result.items, snapshot.items)
    assert.equal(result.observedItems.length, 72)
  }
}
// Do not resurrect excluded source/SC-HC copies after source projection.
const projected = { ...snapshot, observedItems: copies.slice(0, 12) }
assert.strictEqual(presentScreenshotCollection(projected, 'archive', 'capture.png', 'mi-workshop', createFixture).observedItems, projected.observedItems)
for (const fixture of [undefined, '', 'settings', 'unknown', 'mi-workshop']) {
  assert.equal(presentScreenshotCollection(snapshot, 'archive', undefined, fixture, createFixture), null)
}
for (const fixture of [undefined, '', 'settings', 'unknown']) {
  assert.equal(presentScreenshotCollection(snapshot, 'archive', 'capture.png', fixture, createFixture), null)
}
assert.equal(creations, 0)
assert.strictEqual(presentScreenshotCollection(snapshot, 'archive', 'capture.png', 'skill-explorer', createFixture).items, skillItems)
assert.equal(creations, 1)
assert.equal(snapshot.basis, 'stashes')
const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
const projector = main.slice(main.indexOf('projector: {'), main.indexOf('hydration: {'))
assert.match(projector, /presentScreenshotCollection/)
assert.match(projector, /\?\? presentCollection\(helper, database, snapshot, basis\)/)
assert.doesNotMatch(projector, /VERIFY_GLOSSARY/)
console.log('Screenshot collection passed: named MI fixture, exact/source-filtered copies, immutable presentation, and normal-startup fallback.')
