import assert from 'node:assert/strict'
import {
  classifyIpcDomainError,
  toIpcFailureTransport
} from '../src/main/ipc/domain-error-transport.ts'

const cases = [
  ['background-jobs', new Error('Background job import-1 was not found'), 'background-jobs.not-found'],
  ['archive', new Error('Vault item does not exist: private-copy-id'), 'archive.item-unavailable'],
  ['imports', new Error('The Item Assistant database changed after preflight; analyze it again before importing.'), 'imports.source-changed'],
  ['collection', new Error('No Grim Dawn installation is available.'), 'collection.installation-unavailable'],
  ['live-transfers', new Error('The game rejected the item without returning a durable queue receipt.'), 'live-transfers.receipt-missing'],
  ['diagnostics', new Error('The support bundle failed its privacy check and was not written.'), 'diagnostics.privacy-check-failed'],
  ['backups', new Error('The staged archive failed verification after copying. Restore was canceled.'), 'backups.verification-failed'],
  ['window-lifecycle', new Error('Managed shutdown flush failed at C:\\Users\\private'), 'window-lifecycle.shutdown-failed']
]

for (const [domain, source, expectedCode] of cases) {
  const classified = classifyIpcDomainError(domain, source)
  assert.equal(classified.kind, 'known', `${domain} ordinary Error must use its explicit mapping`)
  assert.equal(classified.code, expectedCode)
  assert.equal(classified.message.includes('private'), false, `${domain} public message must be fixed`)
  assert.equal('stack' in classified, false)
  assert.equal('cause' in classified, false)
}

const validationCases = [
  ['archive', 'Vault paging parameters are outside their safe bounds.', 'archive.invalid-page'],
  ['collection', 'Collection scan input is outside its safe bounds.', 'collection.invalid-scan'],
  ['live-transfers', 'Special-item recovery input is outside its safe bounds.', 'live-transfers.invalid-request'],
  ['diagnostics', 'Renderer error report is outside its safe bounds.', 'diagnostics.invalid-renderer-report'],
  ['window-lifecycle', 'Zoom factor is outside its safe bounds.', 'window-lifecycle.invalid-zoom']
]

for (const [domain, message, expectedCode] of validationCases) {
  const classified = classifyIpcDomainError(domain, new Error(message))
  assert.equal(classified.kind, 'validation')
  assert.equal(classified.code, expectedCode)
}

const secret = 'sqlite failed at C:\\Users\\Hinne\\secret.sqlite with token=abc123'
for (const domain of ['background-jobs', 'archive', 'imports', 'collection', 'live-transfers', 'diagnostics', 'backups', 'window-lifecycle']) {
  const failure = toIpcFailureTransport(domain, new Error(secret))
  assert.deepEqual(Object.keys(failure).sort(), ['error', 'ok'])
  assert.equal(Object.getPrototypeOf(failure), Object.prototype)
  assert.equal(Object.getPrototypeOf(failure.error), Object.prototype)
  assert.equal(failure.ok, false)
  assert.equal(failure.error.kind, 'unknown')
  assert.equal(failure.error.code, `${domain}.failed`)
  assert.equal(failure.error.message.includes('secret'), false)
  assert.equal(failure.error.message.includes('token'), false)

  const cloned = structuredClone(failure)
  assert.deepEqual(cloned, failure, `${domain} transport must survive structured cloning`)
  assert.deepEqual(JSON.parse(JSON.stringify(failure)), failure, `${domain} transport must be JSON serializable`)
}

const timeout = classifyIpcDomainError(
  'live-transfers',
  new Error('Timed out waiting for Grim Dawn to acknowledge 2 personal-inventory deliveries. Do not retry until CC resolves the pending queue.')
)
assert.equal(timeout.code, 'live-transfers.outcome-uncertain')
assert.equal(timeout.uncertain, true)
assert.equal(timeout.retryable, false)

const isolatedTimeout = classifyIpcDomainError(
  'live-transfers',
  new Error('Timed out waiting for the live hook to acknowledge the in-game deposit.')
)
assert.equal(isolatedTimeout.code, 'live-transfers.outcome-uncertain')
assert.equal(isolatedTimeout.uncertain, true)
assert.equal(isolatedTimeout.retryable, false)

const nonError = toIpcFailureTransport('diagnostics', { internal: secret })
assert.equal(nonError.error.kind, 'unknown')
assert.equal(JSON.stringify(nonError).includes(secret), false)

console.log('IPC domain error transport checks passed (8 domain mappings, validation, redaction, serialization).')
