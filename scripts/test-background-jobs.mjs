import assert from 'node:assert/strict'
import {
  BackgroundJobCanceledError,
  BackgroundJobCoordinator
} from '../src/main/background-jobs.ts'
import { BACKGROUND_JOB_KINDS } from '../src/shared/background-jobs.ts'

assert.deepEqual(BACKGROUND_JOB_KINDS, [
  'collection-scan',
  'game-data-rebuild',
  'roll-hydration',
  'item-assistant-import',
  'archive-backup',
  'icon-extraction',
  'map-indexing'
])

const progress = {
  completed: 0,
  total: 2,
  percent: 0,
  unit: 'steps',
  label: 'Starting test job',
  detail: 'No archive payload is present.'
}

const coordinator = new BackgroundJobCoordinator()
const events = []
coordinator.subscribe((job) => events.push(job))

let release
const gate = new Promise((resolve) => { release = resolve })
let executions = 0
const first = coordinator.run({
  kind: 'collection-scan',
  dedupeKey: 'collection:all',
  stage: 'queued',
  progress,
  completedStage: 'complete',
  failedStage: 'failed',
  canceledStage: 'canceled'
}, async (job) => {
  executions += 1
  job.update({ stage: 'scanning', progress: { completed: 1 } })
  await gate
  return 42
}, (value) => ({ summary: 'Test scan complete.', metrics: { value } }))
const duplicate = coordinator.run({
  kind: 'collection-scan',
  dedupeKey: 'collection:all',
  stage: 'queued',
  progress,
  completedStage: 'complete',
  failedStage: 'failed',
  canceledStage: 'canceled'
}, async () => 99, () => ({ summary: 'Unexpected.', metrics: {} }))

assert.equal(duplicate.coalesced, true)
assert.equal(duplicate.id, first.id)
release()
assert.equal(await first.result, 42)
assert.equal(await duplicate.result, 42)
assert.equal(executions, 1, 'duplicate work executes once')
const completed = coordinator.list().find((job) => job.id === first.id)
assert.equal(completed?.status, 'succeeded')
assert.equal(completed?.result?.metrics.value, 42)
assert.equal(completed?.persistence.navigation, 'main-process-session')
assert.equal(completed?.persistence.restart, 'discard-in-flight')
assert.ok(JSON.stringify(events).includes('No archive payload is present.'))
assert.ok(!JSON.stringify(events).includes('observedItems'), 'progress events stay lightweight')

let enterBoundary
const boundary = new Promise((resolve) => { enterBoundary = resolve })
let continueJob
const paused = new Promise((resolve) => { continueJob = resolve })
const cancelable = coordinator.run({
  kind: 'roll-hydration',
  dedupeKey: 'rolls:sc',
  stage: 'queued',
  progress: { ...progress, label: 'Rate archived rolls' },
  completedStage: 'complete',
  failedStage: 'failed',
  canceledStage: 'canceled'
}, async (job) => {
  job.update({ stage: 'analyzing', canCancel: false })
  enterBoundary()
  await paused
  job.safeBoundary('between bounded batches')
  return 1
}, () => ({ summary: 'Unexpected.', metrics: {} }))
await boundary
assert.equal(coordinator.requestCancellation(cancelable.id)?.cancellation.requested, false,
  'unsafe stages reject cancellation requests')
continueJob()
assert.equal(await cancelable.result, 1)

let releaseCancelable
const cancellableGate = new Promise((resolve) => { releaseCancelable = resolve })
const canceled = coordinator.run({
  kind: 'archive-backup',
  dedupeKey: 'backup:manual',
  stage: 'queued',
  progress: { ...progress, label: 'Prepare backup' },
  canCancel: true,
  boundary: 'before checkpoint',
  completedStage: 'complete',
  failedStage: 'failed',
  canceledStage: 'canceled'
}, async (job) => {
  await cancellableGate
  job.throwIfCancellationRequested()
  return 1
}, () => ({ summary: 'Unexpected.', metrics: {} }))
assert.equal(coordinator.requestCancellation(canceled.id)?.cancellation.requested, true)
releaseCancelable()
await assert.rejects(canceled.result, BackgroundJobCanceledError)
assert.equal(coordinator.list().find((job) => job.id === canceled.id)?.status, 'canceled')

console.log(JSON.stringify({
  passed: true,
  typedLifecycle: true,
  duplicateCoalescing: true,
  safeCancellation: true,
  navigationPersistence: true,
  restartPolicy: 'discard-in-flight',
  lightweightProgress: true
}, null, 2))
