import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { GrimDawnHelperClient } from '../src/main/grim-dawn/helper-client.ts'
import { HELPER_METHODS, HelperRequestError, parseHelperResponse } from '../src/main/grim-dawn/helper-protocol.ts'
import { classifyIpcDomainError } from '../src/main/ipc/domain-error-transport.ts'

const fixture = resolve('scripts/fixtures/fake-grim-dawn-helper.mjs')
const createClient = (options = {}, mode) => new GrimDawnHelperClient({
  command: process.execPath, args: [fixture, ...(mode ? [mode] : [])], requestTimeoutMs: 1500,
  workerIdleTimeoutMs: 80, ...options
})
const rejects = (operation, code, uncertain = false) => assert.rejects(operation,
  error => error instanceof HelperRequestError && error.code === code && error.uncertain === uncertain)

const program = await readFile('src/helper/CairnCodex.GrimDawn/Program.cs', 'utf8')
const implemented = [...program.matchAll(/"([a-z-]+)" =>/g)].map(match => match[1]).sort()
assert.deepEqual(Object.keys(HELPER_METHODS).sort(), implemented, 'every C# method needs reviewed lane/mutation metadata')
for (const line of ['null', '[]', 'true', '{}', '{"id":"1"}', '{"id":"1","error":null}',
  '{"id":"1","result":{},"error":{"code":"bad","message":"bad"}}']) {
  assert.throws(() => parseHelperResponse(line), { code: 'HELPER_PROTOCOL_INVALID' })
}
assert.deepEqual(parseHelperResponse('{"id":"1","result":null,"error":null}'), { id: '1', result: null })

for (const [mode, code] of [['bad-version', 'HELPER_PROTOCOL_UNSUPPORTED'], ['bad-capabilities', 'HELPER_PROTOCOL_UNSUPPORTED'], ['exit-health', 'HELPER_EXITED']]) {
  const client = createClient({}, mode)
  try { await rejects(client.request('commit-ingest-items'), code) } finally { client.dispose() }
}

for (const behavior of ['null', 'array', 'missing', 'both', 'malformed', 'invalid-utf8']) {
  const client = createClient()
  try {
    await rejects(client.request('scan-collection', { behavior }), 'HELPER_PROTOCOL_INVALID')
    const restarted = await client.request('scan-collection')
    assert.equal(restarted.healthCalls, 1, 'a replacement generation must negotiate again')
  } finally { client.dispose() }
}

{
  const client = createClient({ onDiagnostic: () => { throw new Error('observer failed') } })
  try {
    const results = await Promise.all(['unknown', 'duplicate', 'fragmented'].map(behavior => client.request('scan-collection', { behavior })))
    assert.equal(new Set(results.map(result => result.processId)).size, 1)
    assert.ok(results.every(result => result.healthCalls === 1 && result.text === 'Grün'))
    await rejects(client.request('invented-live-write'), 'HELPER_METHOD_UNSUPPORTED')
    await rejects(client.request('scan-collection', { behavior: 'error' }), 'source_changed')
    await rejects(client.request('scan-collection', { behavior: 'exit' }), 'HELPER_EXITED')
    assert.equal((await client.request('scan-collection')).healthCalls, 1)
  } finally { client.dispose() }
  await rejects(client.request('health'), 'HELPER_STOPPED')
}

{
  const client = createClient({ maxResponseBytes: 1024, maxRequestBytes: 512, maxPendingRequests: 2 })
  try {
    await rejects(client.request('scan-collection', { text: 'x'.repeat(600) }), 'HELPER_REQUEST_LIMIT')
    const circular = {}; circular.self = circular
    await rejects(client.request('scan-collection', circular), 'HELPER_REQUEST_INVALID')
    await rejects(client.request('scan-collection', { behavior: 'oversized' }), 'HELPER_RESPONSE_LIMIT')
    const a = client.request('scan-collection', { delayMs: 80 })
    const b = client.request('scan-collection')
    await rejects(client.request('scan-collection'), 'HELPER_REQUEST_LIMIT')
    await Promise.all([a, b])
  } finally { client.dispose() }
}

const directory = await mkdtemp(join(tmpdir(), 'cairn-helper-protocol-'))
try {
  const live = createClient({ requestTimeoutMs: 700 })
  try {
    const owner = await live.request('start-live-game')
    await rejects(live.request('inspect-live-game', { delayMs: 1300 }), 'HELPER_TIMEOUT')
    assert.doesNotThrow(() => process.kill(owner.processId, 0), 'the retiring live owner is still running')
    await rejects(live.request('start-live-game'), 'HELPER_TIMEOUT')
    await delay(850)
    const replacement = await live.request('start-live-game')
    assert.notEqual(replacement.processId, owner.processId)
    assert.throws(() => process.kill(owner.processId, 0), 'replacement waits for the old live owner to exit')
  } finally { live.dispose() }

  const overlap = createClient({ requestTimeoutMs: 700, workerIdleTimeoutMs: 100 })
  try {
    const before = await overlap.request('scan-collection')
    await Promise.all([
      rejects(overlap.request('commit-ingest-items', { delayMs: 1100 }), 'HELPER_TIMEOUT', true),
      rejects(overlap.request('scan-collection', { behavior: 'no-response' }), 'HELPER_TIMEOUT')
    ])
    await delay(700)
    assert.notEqual((await overlap.request('scan-collection')).processId, before.processId,
      'a timed-out read retained behind a completed write must release the worker and queue budget')
  } finally { overlap.dispose() }

  // A worker commit outlives both its caller deadline and the old 2s kill fallback.
  const receipt = join(directory, 'commit.txt')
  const client = createClient({ requestTimeoutMs: 700 })
  await client.request('scan-collection')
  await rejects(client.request('commit-ingest-items', { delayMs: 3200, recordPath: receipt }), 'HELPER_TIMEOUT', true)
  await rejects(client.request('commit-ingest-items'), 'HELPER_OUTCOME_PENDING', true)
  client.dispose()
  await delay(2800)
  assert.equal(await readFile(receipt, 'utf8'), 'committed\n', 'dispose must allow the timed-out commit to finish exactly once')

  const lateReceipt = join(directory, 'late.txt')
  const late = createClient({ requestTimeoutMs: 700 })
  try {
    const before = await late.request('scan-collection')
    await rejects(late.request('commit-ingest-items', { delayMs: 1000, recordPath: lateReceipt }), 'HELPER_TIMEOUT', true)
    const after = await late.request('measure-memory')
    assert.equal(after.processId, before.processId, 'read-only recovery waits behind the original write')
    assert.equal(after.writeCount, 1)
    assert.equal((await late.request('scan-collection')).writeCount, 1, 'late completion is not replayed')
    await rejects(late.request('scan-collection', { behavior: 'no-response' }), 'HELPER_TIMEOUT')
    assert.notEqual((await late.request('scan-collection')).processId, before.processId)
  } finally { late.dispose() }
} finally {
  await rm(directory, { recursive: true, force: true })
}

const uncertain = new HelperRequestError('HELPER_TIMEOUT', 'private diagnostic', true)
const wrapped = new Error('outer', { cause: uncertain })
const transported = classifyIpcDomainError('archive', wrapped)
assert.equal(transported.uncertain, true)
assert.equal(transported.retryable, false)
assert.doesNotMatch(transported.message, /private diagnostic/)
console.log('Helper protocol gates passed: envelopes, handshake, bounds, generation isolation and uncertain-write recovery.')
