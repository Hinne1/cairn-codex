import assert from 'node:assert/strict'
import { tooltipWheelIntent, wheelPixels } from '../src/renderer/src/tooltip-scroll.ts'

const input = { deltaX: 0, deltaY: 120, deltaMode: 0, shiftKey: false, ctrlKey: false, metaKey: false }
const state = { top: 100, height: 200, scrollHeight: 1000, target: null, direct: false, boundary: 'page', pageHeight: 900 }
const intent = (wheel = {}, scroll = {}) => tooltipWheelIntent({ ...input, ...wheel }, { ...state, ...scroll })

for (const direct of [false, true]) {
  for (const boundary of ['page', 'contain']) {
    for (const deltaMode of [0, 1, 2]) {
      for (const deltaY of [-0.5, 0.5, -1, 1]) {
        const offset = wheelPixels(deltaY, deltaMode, state.height)
        assert.deepEqual(intent({ deltaY, deltaMode }, { direct, boundary, top: 400 }), { kind: 'tooltip', top: 400 + offset })
        assert.deepEqual(intent({ deltaY, deltaMode }, { direct, boundary, top: deltaY < 0 ? 0 : 800 }), boundary === 'contain'
          ? { kind: 'contain' } : direct ? { kind: 'page', delta: wheelPixels(deltaY, deltaMode, state.pageHeight) } : { kind: 'native' })
        assert.deepEqual(intent({ deltaY, deltaMode }, { direct, boundary, top: 0, scrollHeight: 200 }), direct
          ? { kind: 'page', delta: wheelPixels(deltaY, deltaMode, state.pageHeight) } : { kind: 'native' })
      }
    }
  }
  assert.deepEqual(intent({ deltaY: 900 }, { direct }), { kind: 'tooltip', top: 800 })
  assert.deepEqual(intent({}, { direct, target: 800 }), { kind: 'pending' }, 'Do not hand off before the tooltip visibly reaches its queued boundary')
  assert.deepEqual(intent({ deltaY: -30 }, { direct, target: 800 }), { kind: 'tooltip', top: 70 }, 'Reverse unfinished downward motion immediately')
  assert.deepEqual(intent({ deltaY: 30 }, { direct, target: 0 }), { kind: 'tooltip', top: 130 }, 'Reverse unfinished upward motion immediately')
  assert.deepEqual(intent({ deltaY: 30 }, { direct, target: 140 }), { kind: 'tooltip', top: 170 }, 'Accumulate same-direction trackpad bursts')
  for (const deltaY of [-20, 20, -5, 5]) {
    assert.deepEqual(intent({ deltaY }, { direct, target: deltaY < 0 ? 800 : 0 }), { kind: 'tooltip', top: 100 + deltaY })
  }
  for (const bypass of [{ deltaY: 0 }, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { deltaX: 150 }]) {
    assert.deepEqual(intent(bypass, { direct, boundary: 'contain' }), { kind: 'native' })
  }
}
console.log('Tooltip wheel policy passed: sources/overlay, both boundaries, pixel/line/page modes, fractional deltas, bursts and reversals.')
