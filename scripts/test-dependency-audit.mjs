import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { auditLock, lockedPackages, requestJson, runAudit } from './audit-dependencies.mjs'

const entry = (version = '1.2.5', extra = {}) => ({ version, resolved: 'https://registry.npmjs.org/minimist/-/minimist.tgz', ...extra })
const lock = (packages = { 'node_modules/minimist': entry() }) => ({ lockfileVersion: 3, packages: { '': { name: 'test-root' }, ...packages } })
const response = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
const advisory = (severity = 'CRITICAL', extra = {}) => ({ id: 'GHSA-test', affected: [{ package: { name: 'minimist', ecosystem: 'npm' } }], database_specific: { severity }, ...extra })
const quiet = () => {}
const mock = (severity = null, extra = {}) => async (url, options) => {
  assert.ok(url.startsWith('https://api.osv.dev/v1/'))
  assert.equal(options.redirect, 'error')
  assert.ok(options.signal instanceof AbortSignal)
  return response(url.endsWith('querybatch')
    ? { results: JSON.parse(options.body).queries.map(() => severity ? { vulns: [{ id: 'GHSA-test' }] } : {}) }
    : advisory(severity, extra))
}

const inventory = lockedPackages(lock({
  'node_modules/minimist': entry(),
  'node_modules/dev/node_modules/minimist': entry(),
  'node_modules/@scope/optional': entry('2.0.0', { optional: true, os: ['darwin'] }),
  'node_modules/peer': entry('3.0.0', { peer: true }),
  'node_modules/alias': entry('4.0.0', { name: '@real/name', dev: true })
}))
assert.deepEqual(inventory.map(p => p.package.name), ['minimist', '@scope/optional', 'peer', '@real/name'])
assert.equal(lockedPackages({ ...lock(), lockfileVersion: 2 }).length, 1)
for (const bad of [null, {}, lock({}), { ...lock(), lockfileVersion: 1 }, lock({ 'workspace/pkg': entry() }),
  lock({ 'node_modules/a': entry('1.0.0', { link: true }) }), lock({ 'node_modules/a': entry('latest') }),
  lock({ 'node_modules/a': entry('1.0.0', { resolved: 'git+https://example.org/a' }) }),
  lock({ 'node_modules/a': entry('1.0.0', { resolved: 'https://registry.npmjs.org.evil/a' }) })
]) assert.throws(() => lockedPackages(bad))

for (const [severity, expected] of [[null, 0], ['LOW', 0], ['MODERATE', 0], ['HIGH', 1], ['CRITICAL', 1], ['UNKNOWN', 2]]) {
  assert.equal(await runAudit(lock(), { fetchImpl: mock(severity), emit: quiet }), expected)
}
assert.equal(await runAudit(lock(), { fetchImpl: mock('HIGH', { withdrawn: '2026-01-01T00:00:00Z' }), emit: quiet }), 0)
for (const extra of [{ id: 'wrong-id' }, { affected: [] }, { withdrawn: null }, { database_specific: {} }]) {
  assert.equal(await runAudit(lock(), { fetchImpl: mock('HIGH', extra), emit: quiet }), 2)
}

// Missing/malformed batch data must never be accepted as zero findings.
for (const data of [{}, { results: [] }, { results: [null] }, { results: [{ error: 'unavailable' }] },
  { results: [{ vulns: null }] }, { results: [{ vulns: [{}] }] }, { results: [{ next_page_token: 1 }] }
]) assert.equal(await runAudit(lock(), { fetchImpl: async () => response(data), emit: quiet }), 2)

let calls = 0
await requestJson('querybatch', {}, { fetchImpl: async () => ++calls === 1 ? new Response('unavailable', { status: 503 }) : response({ results: [] }) })
assert.equal(calls, 2)
for (const failing of [() => new Response('unavailable', { status: 503 }), () => new Response('not JSON'),
  () => response(null), () => { throw new Error('network timeout') }, () => new Response('x'.repeat(4 * 1024 * 1024 + 1))]) {
  calls = 0
  await assert.rejects(requestJson('querybatch', {}, { fetchImpl: async () => { calls++; return failing() } }))
  assert.equal(calls, 2, 'At most one request retry')
}
const controller = new AbortController()
controller.abort(new Error('whole audit deadline'))
calls = 0
assert.equal(await runAudit(lock(), { signal: controller.signal, fetchImpl: async () => { calls++; return response({}) }, emit: quiet }), 2)
assert.equal(calls, 0, 'Expired audit must not start more requests')
const duringRequest = new AbortController()
calls = 0
assert.equal(await runAudit(lock(), { signal: duringRequest.signal, emit: quiet, fetchImpl: async (_, options) => {
  calls++
  duringRequest.abort(new Error('deadline during request'))
  options.signal.throwIfAborted()
} }), 2)
assert.equal(calls, 1, 'Whole-audit timeout must stop retries')

// Follow only paginated queries; keep each response attached to its own package.
calls = 0
const paged = await auditLock(lock({ 'node_modules/minimist': entry(), 'node_modules/clean': entry() }), {
  fetchImpl: async (url, options) => {
    calls++
    if (calls === 1) return response({ results: [{ vulns: [{ id: 'GHSA-test' }], next_page_token: 'page2' }, {}] })
    if (calls === 2) {
      const queries = JSON.parse(options.body).queries
      assert.equal(queries.length, 1)
      assert.equal(queries[0].package.name, 'minimist')
      assert.equal(queries[0].page_token, 'page2')
      return response({ results: [{ vulns: [{ id: 'GHSA-test' }] }] })
    }
    return response(advisory())
  }
})
assert.equal(calls, 3)
assert.equal(paged.findings.length, 1)
assert.equal(await runAudit(lock(), { fetchImpl: async () => response({ results: [{ next_page_token: 'cycle' }] }), emit: quiet }), 2)
let page = 0
assert.equal(await runAudit(lock(), { fetchImpl: async () => response({ results: [{ next_page_token: String(++page) }] }), emit: quiet }), 2)
assert.equal(page, 20)
let batchSizes = []
const large = lock(Object.fromEntries(Array.from({ length: 205 }, (_, i) => [`node_modules/pkg-${i}`, entry()])))
assert.equal(await runAudit(large, { emit: quiet, fetchImpl: async (_, options) => {
  const size = JSON.parse(options.body).queries.length
  batchSizes.push(size)
  return response({ results: Array.from({ length: size }, () => ({})) })
} }), 0)
assert.deepEqual(batchSizes, [100, 100, 5])

// npm settings cannot disable a direct OSV request or filter its lock inventory.
const previous = process.env.npm_config_offline
try {
  process.env.npm_config_offline = 'true'
  assert.equal(await runAudit(lock(), { fetchImpl: mock('HIGH'), emit: quiet }), 1)
} finally {
  if (previous === undefined) delete process.env.npm_config_offline
  else process.env.npm_config_offline = previous
}
const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
assert.match(workflow, /npm ci --no-audit/)
assert.doesNotMatch(workflow, /continue-on-error|\|\| true|npm@11\.17\.0/)
assert.ok(workflow.indexOf('npm run audit:dependencies') < workflow.indexOf('npm run verify'))
assert.match(workflow, /npm run test:dependency-audit:live/)
console.log('OSV audit contracts passed: complete lock inventory, severity gate, errors, retries, abort, pagination, malformed/incomplete responses, and offline-setting immunity.')

if (process.argv.includes('--live')) {
  assert.equal(await runAudit(lock(), { emit: console.log }), 1, 'Known critical minimist control must fail the gate')
  assert.equal(await runAudit(lock({ 'node_modules/minimist': entry('1.2.8') }), { emit: console.log }), 0, 'Patched minimist control should pass')
  console.log('Live OSV controls passed: known critical finding detected, patched version clear.')
}
