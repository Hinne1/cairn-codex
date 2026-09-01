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
  RESETTABLE_UI_PREFERENCE_KEYS,
  rendererFailureReport,
  resetUiPreferences
} from '../src/renderer/src/renderer-recovery.ts'

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
  for (const key of RESETTABLE_UI_PREFERENCE_KEYS) storage.setItem(key, 'test')
  const preserved = [
    'cairn-codex-planner-profiles',
    'cairn-codex-planner-ignored-records',
    'cairn-codex-todos',
    'cairn-codex-collection-basis',
    'cairn-codex-source-paths-archive',
    'cairn-codex-retrieval-stash',
    'cairn-codex-auto-live-connect',
    'cairn-codex-onboarding'
  ]
  for (const key of preserved) storage.setItem(key, 'preserved')

  assert.equal(resetUiPreferences(storage), RESETTABLE_UI_PREFERENCE_KEYS.length)
  for (const key of RESETTABLE_UI_PREFERENCE_KEYS) assert.equal(storage.getItem(key), null)
  for (const key of preserved) assert.equal(storage.getItem(key), 'preserved')

  const report = rendererFailureReport(new Error('Synthetic workspace failure'), 'MI Workshop')
  assert.match(report.correlationId, /^[0-9a-f-]{36}$/i)
  assert.equal(report.workspace, 'MI Workshop')
  assert.equal(report.message, 'Synthetic workspace failure')
  assert.ok(report.stack?.includes('Synthetic workspace failure'))

  console.log('Safe-mode startup detection and non-destructive preference reset passed.')
} finally {
  await rm(root, { recursive: true, force: true })
}
