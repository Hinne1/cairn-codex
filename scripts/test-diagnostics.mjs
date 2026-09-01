import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DiagnosticLogger,
  diagnosticPrivacyViolations,
  redactDiagnosticString,
  redactDiagnosticValue
} from '../src/main/diagnostics.ts'

const root = await mkdtemp(join(tmpdir(), 'cairn-codex-diagnostics-test-'))
const secrets = ['Avaa', 'Hinne']

try {
  const stringFixture = redactDiagnosticString(
    'Active character is Avaa. Source C:\\Users\\Hinne\\Documents\\My Games\\Grim Dawn\\save and token=secret-token for hinne@example.com',
    secrets
  )
  for (const forbidden of ['Avaa', 'Hinne', 'Documents', 'secret-token', 'hinne@example.com']) {
    assert.equal(stringFixture.toLocaleLowerCase().includes(forbidden.toLocaleLowerCase()), false)
  }

  const bundleFixture = redactDiagnosticValue({
    sourcePath: 'C:\\Users\\Hinne\\save.gst',
    expectedCharacterName: 'Avaa',
    serializedItemPayload: { baseRecord: 'records/items/private-item.dbr', seed: 42 },
    nested: {
      email: 'hinne@example.com',
      safeCount: 42,
      message: 'Failed at C:\\Users\\Hinne\\AppData\\queue.json'
    }
  }, secrets)
  const serializedFixture = JSON.stringify(bundleFixture)
  assert.equal(serializedFixture.includes('private-item'), false)
  assert.equal(serializedFixture.includes('save.gst'), false)
  assert.equal(serializedFixture.includes('Avaa'), false)
  assert.equal(serializedFixture.includes('hinne@example.com'), false)
  assert.equal(serializedFixture.includes('"safeCount":42'), true)
  assert.deepEqual(diagnosticPrivacyViolations(serializedFixture, secrets), [])
  assert.deepEqual(
    diagnosticPrivacyViolations('C:\\Users\\Hinne\\save.gst hinne@example.com Avaa', secrets),
    ['absolute-path', 'email', 'registered-secret']
  )

  const logger = new DiagnosticLogger(root)
  await logger.initialize()
  logger.registerSecret('Avaa')
  logger.debugEvent('helper', 'request.completed', { method: 'health' })
  logger.info('startup', 'application.started', {
    sourcePath: 'C:\\Users\\Hinne\\save.gst',
    activeCharacterName: 'Avaa',
    safeCount: 1
  })
  logger.error(
    'transfer',
    'offline-ingest.failed',
    new Error('Active character is Avaa at C:\\Users\\Hinne\\save.gst')
  )
  await logger.flush()
  let entries = await logger.readEntries()
  assert.equal(entries.some((entry) => entry.level === 'debug'), false)

  logger.setDebugMode(true)
  logger.debugEvent('helper', 'request.completed', { method: 'health', durationMs: 12 })
  await logger.flush()
  entries = await logger.readEntries()
  assert.equal(entries.some((entry) => entry.level === 'debug'), true)
  const exported = JSON.stringify(entries)
  for (const forbidden of ['Avaa', 'Hinne', 'save.gst']) assert.equal(exported.includes(forbidden), false)

  logger.setDebugMode(false)
  const padding = 'x'.repeat(1_200)
  for (let index = 0; index < 750; index += 1) {
    logger.info('retention', 'bounded-entry', { index, padding })
  }
  await logger.flush()
  const files = (await readdir(root)).filter((name) => name.endsWith('.jsonl'))
  assert.ok(files.length <= 3, `Expected at most 3 standard log files; found ${files.length}.`)
  for (const file of files) {
    const contents = await readFile(join(root, file), 'utf8')
    assert.equal(contents.includes('Avaa'), false)
    assert.equal(contents.includes('Hinne'), false)
  }

  console.log(JSON.stringify({
    passed: true,
    redaction: 'verified',
    debugGate: 'verified',
    standardRetentionFiles: files.length,
    exportedEntryLimit: logger.getRetentionPolicy().maximumExportedEntries
  }, null, 2))
} finally {
  await rm(root, { recursive: true, force: true })
}
