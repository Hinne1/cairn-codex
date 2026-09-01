import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  STARTUP_FAILURE_THRESHOLD,
  STARTUP_FAILURE_WINDOW_MS,
  StartupRecoveryService
} from '../src/main/startup-recovery.ts'
import {
  rendererFailureReport,
  resetUiPreferences
} from '../src/renderer/src/renderer-recovery.ts'
import { createPreferenceRepository } from '../src/renderer/src/preference-repository.ts'

const root = await mkdtemp(join(tmpdir(), 'cairn-safe-mode-'))
try {
  const statePath = join(root, 'startup-recovery.json')
  const startedAt = new Date('2026-09-01T08:00:00.000Z')

  for (let failure = 0; failure <= STARTUP_FAILURE_THRESHOLD; failure += 1) {
    const service = new StartupRecoveryService(statePath, false)
    const status = await service.markStarted(new Date(startedAt.getTime() + failure * 1_000))
    assert.equal(status.failedStarts, failure)
    assert.equal(status.suggested, failure >= STARTUP_FAILURE_THRESHOLD)
  }

  const safeService = new StartupRecoveryService(statePath, true)
  const safeStatus = await safeService.markStarted(new Date(startedAt.getTime() + 5_000))
  assert.equal(safeStatus.active, true)
  assert.equal(safeStatus.suggested, false)
  await safeService.markHealthy(new Date(startedAt.getTime() + 6_000))

  const healthyRestart = new StartupRecoveryService(statePath, false)
  const healthyStatus = await healthyRestart.markStarted(new Date(startedAt.getTime() + 7_000))
  assert.equal(healthyStatus.failedStarts, 0)
  assert.equal(healthyStatus.suggested, false)

  const stalePath = join(root, 'stale-recovery.json')
  const staleFirst = new StartupRecoveryService(stalePath, false)
  await staleFirst.markStarted(startedAt)
  const staleRestart = new StartupRecoveryService(stalePath, false)
  const staleStatus = await staleRestart.markStarted(
    new Date(startedAt.getTime() + STARTUP_FAILURE_WINDOW_MS + 1)
  )
  assert.equal(staleStatus.failedStarts, 0)
  assert.equal(staleStatus.suggested, false)

  const concurrentPath = join(root, 'concurrent-recovery.json')
  const concurrentService = new StartupRecoveryService(concurrentPath, false)
  await concurrentService.markStarted(startedAt)
  await Promise.all([
    concurrentService.markHealthy(new Date(startedAt.getTime() + 100)),
    concurrentService.markRendererFailure(new Date(startedAt.getTime() + 101))
  ])
  const afterConcurrentFailure = new StartupRecoveryService(concurrentPath, false)
  assert.equal(
    (await afterConcurrentFailure.markStarted(new Date(startedAt.getTime() + 200))).failedStarts,
    1
  )

  class MemoryStorage {
    values = new Map()
    getItem(key) { return this.values.get(key) ?? null }
    setItem(key, value) { this.values.set(key, String(value)) }
    removeItem(key) { this.values.delete(key) }
  }
  const storage = new MemoryStorage()
  const repository = createPreferenceRepository(
    storage,
    () => '2026-09-01T08:00:00.000Z',
    () => 'profile-safe-mode'
  )
  repository.update('workspace', { experimentalToolsEnabled: true, visibleTools: ['oracle'] })
  repository.update('notes', { todos: [{ id: 'todo-1', text: 'Preserve me', done: false, createdAt: '2026-09-01T08:00:00.000Z' }] })
  repository.update('sources', { collectionBasis: 'stashes', archivePaths: ['archive'], indexPaths: ['stash'] })

  assert.equal(resetUiPreferences(storage), 3)
  const afterReset = createPreferenceRepository(storage).value
  assert.equal(afterReset.workspace.experimentalToolsEnabled, false)
  assert.deepEqual(afterReset.workspace.visibleTools.includes('sets'), true)
  assert.equal(afterReset.notes.todos[0]?.text, 'Preserve me')
  assert.equal(afterReset.sources.collectionBasis, 'stashes')
  assert.deepEqual(afterReset.sources.archivePaths, ['archive'])
  assert.deepEqual(afterReset.sources.indexPaths, ['stash'])

  const report = rendererFailureReport(new Error('Synthetic workspace failure'), 'MI Workshop')
  assert.match(report.correlationId, /^[0-9a-f-]{36}$/i)
  assert.equal(report.workspace, 'MI Workshop')
  assert.equal(report.message, 'Synthetic workspace failure')
  assert.ok(report.stack?.includes('Synthetic workspace failure'))

  console.log('Safe-mode startup detection and non-destructive preference reset passed.')
} finally {
  await rm(root, { recursive: true, force: true })
}
