import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { classifyAudit, runAudit, AUDIT_NPM_VERSION, AUDIT_TIMEOUT_MS } from './audit-dependencies.mjs'

function report(severity = null) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: severity ? 1 : 0 }
  if (severity) counts[severity] = 1
  return { auditReportVersion: 2, metadata: { vulnerabilities: counts }, vulnerabilities: severity ? { fixture: { severity } } : {} }
}
const result = (body = report(), status = 0) => ({ status, stdout: JSON.stringify(body), stderr: '' })
assert.equal(classifyAudit(result()).kind, 'passed')
assert.equal(classifyAudit(result(report('moderate'))).kind, 'passed')
for (const severity of ['high', 'critical']) {
  for (const status of [0, 1]) assert.equal(classifyAudit(result(report(severity), status)).kind, 'vulnerable')
}
for (const bad of [
  { status: 1, stdout: 'service unavailable' },
  result({ error: { code: 'E503' } }, 1), result({}), result(null), result([]),
  result(report(), 1), { ...result(), signal: 'SIGTERM' }, { ...result(), error: new Error('timeout') },
  result({ ...report(), vulnerabilities: { omitted: { severity: 'high' } } }),
  result({ ...report('high'), vulnerabilities: { fixture: { severity: 'low' } } }),
  result({ ...report(), metadata: { vulnerabilities: { ...report().metadata.vulnerabilities, high: -1 } } })
]) assert.equal(classifyAudit(bad).kind, 'unavailable')

let calls = 0
const messages = []
let auditArgs
const run = (command, args, options) => {
  auditArgs = args
  calls++
  assert.equal(command, process.execPath)
  assert.ok(args.includes('--audit-level=high'))
  assert.ok(args.includes('--offline=false'))
  for (const type of ['dev', 'optional', 'peer']) assert.ok(args.includes(`--include=${type}`))
  assert.ok(args.includes('--fetch-retries=0'))
  assert.ok(args.includes('--fetch-timeout=180000'))
  assert.equal(options.timeout, AUDIT_TIMEOUT_MS)
  assert.equal(options.windowsHide, true)
  return calls === 1 ? result({ error: 'registry unavailable' }, 1) : result()
}
assert.equal(runAudit('npm-cli.js', { run, emit: message => messages.push(message) }), 0)
assert.equal(calls, 2)
assert.match(messages[0], /UNAVAILABLE.*No clean security verdict/)
// Exercise real npm configuration precedence, not just a fabricated audit report.
// This reads configuration only: no registry request or package/profile mutation.
assert.ok(process.env.npm_execpath, 'Run this regression through npm run test:dependency-audit')
const config = spawnSync(process.execPath, [process.env.npm_execpath, 'config', 'get', 'offline', ...auditArgs.slice(2)], {
  encoding: 'utf8', timeout: AUDIT_TIMEOUT_MS, windowsHide: true,
  env: { ...process.env, npm_config_offline: 'true', npm_config_logs_max: '0' }
})
assert.ifError(config.error)
assert.equal(config.status, 0, config.stderr)
assert.equal(config.stdout.trim(), 'false', 'Audit CLI arguments must override inherited npm offline mode')
calls = 0
assert.equal(runAudit('npm-cli.js', { run: () => { calls++; return result(report('critical'), 1) }, emit: () => {} }), 1)
assert.equal(calls, 1, 'vulnerability findings must not be retried away')
calls = 0
assert.equal(runAudit('npm-cli.js', { run: () => { calls++; return { error: new Error('timeout') } }, emit: () => {} }), 2)
assert.equal(calls, 2, 'unavailable audit must stop after a bounded retry')

const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
assert.ok(workflow.includes(`npm@${AUDIT_NPM_VERSION}`))
assert.match(workflow, /npm ci --no-audit/)
assert.match(workflow, /npm run audit:dependencies/)
assert.doesNotMatch(workflow, /continue-on-error|\|\| true/)
assert.ok(workflow.indexOf('npm run audit:dependencies') < workflow.indexOf('npm run verify'))
console.log('Dependency audit passed: pinned bulk-only npm, validated reports, high/critical gate, unavailable versus vulnerable outcomes, bounded timeout/retry, and fail-closed CI.')
