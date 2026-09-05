import assert from 'node:assert/strict'
import { effectScope, ref } from 'vue'
import { useRemoteWorkspacePage } from '../src/renderer/src/workspaces/remote-workspace-page.ts'

const delay = () => new Promise(resolve => setTimeout(resolve, 5))
const input = ref({ mode: 'sc', query: 'first', offset: 0, limit: 60 })
const revision = ref(0), enabled = ref(true)
const calls = []
const scope = effectScope()
const session = scope.run(() => useRemoteWorkspacePage({
  request: () => input.value, revision: () => revision.value, enabled: () => enabled.value,
  fetch: request => new Promise((resolve, reject) => calls.push({ request, resolve, reject })),
  empty: { items: [], total: 0 }, formatError: error => error.message, delayMs: 0
}))
await delay()
assert.equal(calls.length, 1)
input.value = { ...input.value, mode: 'hc' }
await delay()
input.value = { ...input.value, mode: 'sc' }
await delay()
assert.equal(calls.length, 3)
calls[0].resolve({ items: ['obsolete-sc'], total: 1 })
calls[1].reject(new Error('obsolete-hc-error'))
await delay()
assert.deepEqual(session.data.value.items, [])
assert.equal(session.error.value, null)
assert.equal(session.loading.value, true)
calls[2].resolve({ items: ['current-sc'], total: 1 })
await delay()
assert.deepEqual(session.data.value.items, ['current-sc'])
assert.equal(session.loading.value, false)
revision.value++
await delay()
assert.equal(calls.length, 4)
enabled.value = false
calls[3].resolve({ items: ['stale-after-invalid-query'], total: 1 })
await delay()
assert.deepEqual(session.data.value.items, [])
assert.equal(session.loading.value, false)
enabled.value = true
await delay()
calls[4].reject(new Error('current-error'))
await delay()
assert.equal(session.error.value, 'current-error')
session.reload()
await delay()
assert.equal(calls.length, 6)
scope.stop()
calls[5].resolve({ items: ['after-unmount'], total: 1 })
await delay()
assert.deepEqual(session.data.value.items, [])
console.log('Remote workspace pages retain only the current request, revision and component lifetime.')
