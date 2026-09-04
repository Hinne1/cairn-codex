import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const API = 'https://api.osv.dev/v1/'
export const AUDIT_TIMEOUT_MS = 120000
export const REQUEST_TIMEOUT_MS = 15000
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const severityOrder = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL']
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const requireThat = (condition, message) => { if (!condition) throw new Error(message) }

// Inspect the lock, not node_modules: include dev/optional/peer and other-OS packages.
// Unsupported sources fail closed rather than silently disappearing from coverage.
export function lockedPackages(lock) {
  requireThat([2, 3].includes(lock?.lockfileVersion) && object(lock.packages), 'Expected npm lockfile v2/v3 packages')
  const unique = new Map()
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === '') continue
    const match = path.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/)
    requireThat(match && object(entry) && !entry.link, `Unsupported locked package: ${path}`)
    const name = entry.name ?? match[1]
    requireThat(typeof name === 'string' && /^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i.test(name), `Invalid package name: ${path}`)
    requireThat(typeof entry.version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(entry.version), `Expected exact package version: ${path}`)
    requireThat(typeof entry.resolved === 'string' && entry.resolved.startsWith('https://registry.npmjs.org/'), `Unsupported non-registry source: ${path}`)
    unique.set(`${name}@${entry.version}`, { package: { name, ecosystem: 'npm' }, version: entry.version })
  }
  requireThat(unique.size > 0, 'No locked dependencies to audit')
  return [...unique.values()]
}

export async function requestJson(path, body, { fetchImpl = fetch, signal } = {}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    signal?.throwIfAborted()
    const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
    try {
      const response = await fetchImpl(`${API}${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: requestSignal,
        headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`OSV HTTP ${response.status}`)
      }
      const reader = response.body.getReader()
      const chunks = []
      let length = 0
      try {
        while (true) {
          requestSignal.throwIfAborted()
          const { done, value } = await reader.read()
          if (done) break
          length += value.length
          requireThat(length <= MAX_RESPONSE_BYTES, 'OSV response exceeds size limit')
          chunks.push(value)
        }
      } finally { await reader.cancel() }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      requireThat(object(data) && !data.error, 'Invalid OSV JSON response')
      return data
    } catch (error) {
      if (attempt === 2 || signal?.aborted) throw error
    }
  }
}

// Querybatch performs version matching; full matching advisories supply severity.
// npm records carry GitHub's qualitative severity. Unknown severity blocks:
// never guess a CVSS score or silently treat unknown findings as below threshold.
export function advisorySeverity(advisory, id, packages) {
  requireThat(object(advisory) && advisory.id === id && Array.isArray(advisory.affected), `Invalid OSV advisory ${id}`)
  for (const query of packages) {
    requireThat(advisory.affected.some(a => a?.package?.ecosystem === 'npm' && a.package.name === query.package.name), `Advisory ${id} does not match queried package`)
  }
  if (advisory.withdrawn !== undefined) {
    requireThat(typeof advisory.withdrawn === 'string' && Number.isFinite(Date.parse(advisory.withdrawn)), `Invalid withdrawal date: ${id}`)
    return 'WITHDRAWN'
  }
  const severity = advisory.database_specific?.severity
  requireThat(severityOrder.includes(severity), `Unknown severity for ${id}; manual review required`)
  return severity
}

export async function auditLock(lock, { fetchImpl = fetch, signal = AbortSignal.timeout(AUDIT_TIMEOUT_MS) } = {}) {
  const packages = lockedPackages(lock)
  const matches = new Map()
  const query = (path, body) => requestJson(path, body, { fetchImpl, signal })
  for (let offset = 0; offset < packages.length; offset += 100) {
    let pending = packages.slice(offset, offset + 100).map(value => ({ query: value, seen: new Set() }))
    for (let page = 0; pending.length; page++) {
      requireThat(page < 20, 'OSV pagination limit exceeded; incomplete audit')
      const response = await query('querybatch', { queries: pending.map(item => item.query) })
      requireThat(Array.isArray(response.results) && response.results.length === pending.length, 'Incomplete OSV batch response')
      const next = []
      response.results.forEach((result, index) => {
        requireThat(object(result) && Object.keys(result).every(key => ['vulns', 'next_page_token'].includes(key)), 'Invalid OSV package result')
        requireThat(result.vulns === undefined || Array.isArray(result.vulns), 'Invalid OSV vulnerability list')
        const item = pending[index]
        for (const vuln of result.vulns ?? []) {
          requireThat(object(vuln) && typeof vuln.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(vuln.id), 'Invalid OSV advisory identifier')
          const affected = matches.get(vuln.id) ?? new Map()
          affected.set(`${item.query.package.name}@${item.query.version}`, item.query)
          matches.set(vuln.id, affected)
          requireThat(matches.size <= 2000, 'OSV advisory limit exceeded; incomplete audit')
        }
        requireThat(result.next_page_token === undefined || typeof result.next_page_token === 'string', 'Invalid OSV page token')
        if (result.next_page_token) {
          requireThat(!item.seen.has(result.next_page_token), 'Repeated OSV page token; incomplete audit')
          item.seen.add(result.next_page_token)
          next.push({ ...item, query: { ...item.query, page_token: result.next_page_token } })
        }
      })
      pending = next
    }
  }
  const findings = []
  for (const [id, affected] of matches) {
    const advisory = await query(`vulns/${encodeURIComponent(id)}`)
    const severity = advisorySeverity(advisory, id, [...affected.values()])
    findings.push({ id, severity, packages: [...affected.keys()], url: `https://osv.dev/vulnerability/${encodeURIComponent(id)}` })
  }
  signal.throwIfAborted()
  return { packages: packages.length, findings }
}

export async function runAudit(lock, { emit = console.log, ...options } = {}) {
  try {
    const report = await auditLock(lock, options)
    const blocking = report.findings.filter(f => ['HIGH', 'CRITICAL'].includes(f.severity))
    emit(`DEPENDENCY AUDIT ${blocking.length ? 'FAILED' : 'PASSED'} (OSV): ${report.packages} locked package versions checked; ${blocking.length} high/critical advisories; ${report.findings.length} total advisories.`)
    for (const finding of report.findings) emit(`${finding.severity} ${finding.id}: ${finding.packages.join(', ')} — ${finding.url}`)
    return blocking.length ? 1 : 0
  } catch (error) {
    emit(`DEPENDENCY AUDIT UNAVAILABLE (OSV): ${error.message}. No clean security verdict.`)
    return 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = await runAudit(JSON.parse(await readFile(resolve('package-lock.json'), 'utf8'))) }
  catch (error) { console.error(`DEPENDENCY AUDIT UNAVAILABLE (OSV): ${error.message}. No clean security verdict.`); process.exitCode = 2 }
}
