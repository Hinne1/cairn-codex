import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { GrimDawnHelperClient, usesLiveLane } from '../src/main/grim-dawn/helper-client.ts'

const fixture = resolve('scripts', 'fixtures', 'fake-grim-dawn-helper.mjs')
const client = new GrimDawnHelperClient({
  command: process.execPath,
  args: [fixture],
  requestTimeoutMs: 2_000,
  workerIdleTimeoutMs: 120
})

try {
  for (const method of [
    'inspect-live-game',
    'approve-live-game-build',
    'start-live-game',
    'stop-live-game',
    'poll-live-incoming',
    'copy-live-incoming',
    'ack-live-incoming',
    'enqueue-live-retrieval',
    'inspect-live-retrieval',
    'self-test-live-queue'
  ]) assert.equal(usesLiveLane(method), true, `${method} must remain on the live lane`)
  assert.equal(usesLiveLane('build-item-catalog'), false)
  assert.equal(usesLiveLane('scan-collection'), false)

  const live = await client.request('health')
  const firstWorker = await client.request('build-item-catalog')
  const warmWorker = await client.request('scan-collection')

  assert.notEqual(live.processId, firstWorker.processId, 'live and worker requests must use separate helpers')
  assert.equal(firstWorker.processId, warmWorker.processId, 'active worker requests should reuse their cache')

  const slowWorker = await client.request('analyze-item-rolls', { delayMs: 180 })
  assert.equal(slowWorker.processId, firstWorker.processId, 'an in-flight request must prevent idle eviction')

  await delay(220)
  const restartedWorker = await client.request('resolve-archive-items')
  assert.notEqual(restartedWorker.processId, firstWorker.processId, 'an idle worker should be replaced')

  const liveAfterEviction = await client.request('inspect-live-game')
  assert.equal(liveAfterEviction.processId, live.processId, 'worker eviction must not interrupt live mode')

  console.log(JSON.stringify({
    passed: true,
    liveProcessId: live.processId,
    firstWorkerProcessId: firstWorker.processId,
    restartedWorkerProcessId: restartedWorker.processId
  }, null, 2))
} finally {
  client.dispose()
}
