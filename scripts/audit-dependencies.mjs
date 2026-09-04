import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const AUDIT_NPM_VERSION = '11.17.0'
export const AUDIT_TIMEOUT_MS = 30000
const severities = ['info', 'low', 'moderate', 'high', 'critical']

// Never turn an endpoint error, invalid response, or killed process into a clean audit.
export function classifyAudit(result) {
  if (result.error || result.signal) return { kind: 'unavailable', reason: 'npm audit timed out or could not complete' }
  let report
  try { report = JSON.parse(result.stdout) } catch { return { kind: 'unavailable', reason: 'npm returned no valid JSON audit report' } }
  const counts = report?.metadata?.vulnerabilities
  const findings = report?.vulnerabilities
  if (report?.error || report?.auditReportVersion !== 2 || !counts || !findings ||
      typeof findings !== 'object' || Array.isArray(findings) ||
      [...severities, 'total'].some(key => !Number.isSafeInteger(counts[key]) || counts[key] < 0) ||
      severities.reduce((sum, key) => sum + counts[key], 0) !== counts.total ||
      Object.keys(findings).length !== counts.total ||
      Object.values(findings).some(finding => !severities.includes(finding?.severity))) {
    return { kind: 'unavailable', reason: 'npm returned an error or an incomplete audit report' }
  }
  for (const severity of severities) {
    if (Object.values(findings).filter(finding => finding.severity === severity).length !== counts[severity]) {
      return { kind: 'unavailable', reason: 'npm audit severity totals are inconsistent' }
    }
  }
  if (counts.high + counts.critical > 0) return { kind: 'vulnerable', counts, report }
  if (result.status !== 0) return { kind: 'unavailable', reason: 'npm exited unsuccessfully despite a below-threshold report' }
  return { kind: 'passed', counts, report }
}

export function runAudit(npmCli, { run = spawnSync, emit = console.log } = {}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = run(process.execPath, [npmCli, 'audit', '--json', '--audit-level=high',
      // npm offline mode fabricates an empty report without requesting advisories.
      // CLI precedence must override both inherited environment and .npmrc settings.
      '--offline=false',
      '--include=dev', '--include=optional', '--include=peer',
      '--registry=https://registry.npmjs.org/', '--fetch-retries=0', '--fetch-timeout=15000'], {
      cwd: process.cwd(), encoding: 'utf8', timeout: AUDIT_TIMEOUT_MS,
      maxBuffer: 5 * 1024 * 1024, windowsHide: true
    })
    const outcome = classifyAudit(result)
    if (outcome.kind === 'passed') {
      emit(`DEPENDENCY AUDIT PASSED: ${outcome.counts.high} high, ${outcome.counts.critical} critical; ${outcome.counts.total} total findings.`)
      return 0
    }
    if (outcome.kind === 'vulnerable') {
      emit(`DEPENDENCY AUDIT FAILED: ${outcome.counts.high} high and ${outcome.counts.critical} critical findings.`)
      emit(JSON.stringify(outcome.report, null, 2))
      return 1
    }
    emit(`DEPENDENCY AUDIT UNAVAILABLE (attempt ${attempt}/2): ${outcome.reason}. No clean security verdict.`)
    if (result.stdout) emit(result.stdout)
    if (result.stderr) emit(result.stderr)
  }
  return 2
}

export async function main() {
  const npmCli = process.env.npm_execpath
  if (!npmCli) throw new Error('Run through npm run audit:dependencies with the pinned audit npm CLI.')
  const pkg = JSON.parse(await readFile(resolve(dirname(npmCli), '..', 'package.json'), 'utf8'))
  if (pkg.name !== 'npm' || pkg.version !== AUDIT_NPM_VERSION) {
    throw new Error(`Audit requires npm ${AUDIT_NPM_VERSION} (bulk-only audit); found ${pkg.name}@${pkg.version}. CI installs the pinned CLI before running this gate.`)
  }
  process.exitCode = runAudit(npmCli)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`DEPENDENCY AUDIT UNAVAILABLE: ${error.message}. No clean security verdict.`); process.exitCode = 2 })
}
