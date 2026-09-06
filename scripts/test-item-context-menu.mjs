import assert from 'node:assert/strict'
import { isItemContextShortcut, researchItemContextActions, itemMenuPosition } from '../src/renderer/src/item-context-menu.ts'

const key = { key: 'ContextMenu', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false }
assert.equal(isItemContextShortcut(key), true)
assert.equal(isItemContextShortcut({ ...key, key: 'F10', shiftKey: true }), true)
assert.equal(isItemContextShortcut({ ...key, key: 'F10' }), false)
for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) assert.equal(isItemContextShortcut({ ...key, [modifier]: true }), false)
assert.deepEqual(researchItemContextActions({}, { favorite: false, ignore: false }).map(action => action.id), ['inspect'])
assert.deepEqual(researchItemContextActions({}, { favorite: true, ignore: false }).map(action => action.id), ['inspect', 'favorite'])
assert.deepEqual(researchItemContextActions({}, { favorite: false, ignore: true }).map(action => action.id), ['inspect', 'ignore'])
const actions = researchItemContextActions({ favorite: true, ignored: true }, { favorite: true, ignore: true })
assert.deepEqual(actions.map(action => action.id), ['inspect', 'favorite', 'ignore'])
assert.equal(actions[1].label, 'Unfavorite')
assert.equal(actions[2].label, 'Restore base to this plan')
assert.match(actions[1].description, /across your plans/)
assert.match(actions[2].description, /current plan/)
assert.deepEqual(itemMenuPosition({ x: 1000, y: 1000 }, { width: 288, height: 240 }, { width: 520, height: 600 }), { left: 224, top: 352 })
assert.deepEqual(itemMenuPosition({ x: -10, y: -10 }, { width: 288, height: 240 }, { width: 520, height: 600 }), { left: 8, top: 8 })
console.log('Item context policy passed: keyboard entry, capability scopes, state-aware actions and viewport clamping.')
