import assert from 'node:assert/strict'
import { effectScope, ref } from 'vue'
import { useArchiveCopySession } from '../src/renderer/src/archive-copy-session.ts'

const enabled = ref(false), context = ref({ isHardcore: false, revision: 1, source: 'stash-sc' })
const calls = [], errors = []
const scope = effectScope()
const session = scope.run(() => useArchiveCopySession({ enabled: () => enabled.value, context: () => context.value,
  query: request => new Promise((resolve, reject) => calls.push({ request, resolve, reject })),
  reportError: error => errors.push(error.message) }))
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const respond = (call, ids, total = ids.length) => call.resolve({ items: ids.map(id => ({ id })), total, offset: call.request.offset, limit: 250 })
assert.equal(calls.length, 0, 'Supplies/Dismantling and archive-basis contexts do not acquire legacy copies')
enabled.value = true
assert.equal(calls[0].request.limit, 250)
assert.equal(calls[0].request.isHardcore, false)
respond(calls[0], Array.from({ length: 250 }, (_, i) => `old-${i}`), 251)
await settle()
assert.equal(calls[1].request.offset, 250)
assert.deepEqual(session.items.value, [], 'do not publish a partial comparison set')
context.value = { ...context.value, revision: 2 }
respond(calls[1], ['old-last'], 251)
respond(calls[2], ['current-copy'])
await settle()
assert.deepEqual(session.items.value.map(item => item.id), ['current-copy'])
assert.equal(session.loaded.value, true)
enabled.value = false; enabled.value = true
assert.equal(calls.length, 3, 'a completed unchanged context can be reused')
context.value = { isHardcore: true, revision: 3, source: 'stash-hc' }
assert.deepEqual(session.items.value, [])
assert.equal(calls[3].request.isHardcore, true)
calls[3].reject(new Error('current-page-failure'))
await settle()
assert.deepEqual(errors, ['current-page-failure'])
enabled.value = false
context.value = { isHardcore: false, revision: 2, source: 'stash-sc' }
enabled.value = true
assert.equal(calls.length, 5, 'returning to a discarded context must reload')
scope.stop()
respond(calls[4], ['after-unmount'])
await settle()
assert.deepEqual(session.items.value, [])
assert.equal(session.loaded.value, false)
console.log('Archive comparison owner passed: bounded acquisition, atomic presentation, mode/source/revision invalidation, inactive consumers, failures and disposal.')
