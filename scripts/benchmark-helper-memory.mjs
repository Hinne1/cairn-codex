import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { GrimDawnHelperClient } from '../src/main/grim-dawn/helper-client.ts'

const helper = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(
      'src',
      'helper',
      'CairnCodex.GrimDawn',
      'bin',
      'Debug',
      'net10.0-windows',
      'CairnCodex.GrimDawn.exe'
    )
const requestedInstallation = process.argv[3] ? resolve(process.argv[3]) : null
const idleTimeoutMs = 5_000
const retainedPrivateBudgetBytes = 2.5 * 1024 ** 3
const freshPrivateBudgetBytes = 128 * 1024 ** 2
const warmRequestBudgetMs = 1_000
const client = new GrimDawnHelperClient({
  command: helper,
  args: [],
  requestTimeoutMs: 10 * 60_000,
  workerIdleTimeoutMs: idleTimeoutMs
})

const elapsed = async (operation) => {
  const startedAt = performance.now()
  const result = await operation()
  return { result, durationMs: Math.round(performance.now() - startedAt) }
}

try {
  const discovery = requestedInstallation
    ? null
    : await client.request('discover-grim-dawn')
  const installationPath = requestedInstallation ?? discovery?.installations?.[0]?.path
  if (!installationPath) throw new Error('No Grim Dawn installation was discovered.')

  const baseline = await client.request('measure-memory', { collect: true })
  const cold = await elapsed(() => client.request('build-item-catalog', { installationPath }))
  const retained = await client.request('measure-memory', { collect: true })
  const sampleRecord = cold.result.items?.[0]?.record
  if (!sampleRecord) throw new Error('The installed catalog did not contain a sample item.')
  const warm = await elapsed(() => client.request('resolve-archive-items', {
    installationPath,
    records: [sampleRecord]
  }))

  await delay(idleTimeoutMs + 1_000)
  const afterEviction = await client.request('measure-memory', { collect: true })

  assert.ok(retained.privateBytes <= retainedPrivateBudgetBytes,
    `Retained helper private bytes exceeded 2.5 GiB: ${retained.privateBytes}`)
  assert.ok(afterEviction.privateBytes <= freshPrivateBudgetBytes,
    `Fresh helper private bytes exceeded 128 MiB: ${afterEviction.privateBytes}`)
  assert.ok(warm.durationMs <= warmRequestBudgetMs,
    `Warm helper request exceeded 1 second: ${warm.durationMs} ms`)
  assert.notEqual(retained.processId, afterEviction.processId,
    'The worker process was not replaced after its idle deadline.')

  console.log(JSON.stringify({
    installationPath,
    catalogItems: cold.result.items.length,
    coldDurationMs: cold.durationMs,
    warmDurationMs: warm.durationMs,
    baseline,
    retained,
    afterEviction,
    budgets: {
      retainedPrivateBudgetBytes,
      freshPrivateBudgetBytes,
      warmRequestBudgetMs
    },
    workerRestarted: retained.processId !== afterEviction.processId,
    releasedPrivateBytes: Math.max(0, retained.privateBytes - afterEviction.privateBytes),
    releasedWorkingSetBytes: Math.max(0, retained.workingSetBytes - afterEviction.workingSetBytes)
  }, null, 2))
} finally {
  client.dispose()
}
