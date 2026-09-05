import { BackgroundJobCoordinator } from './background-jobs.ts'
import type { ResolvedArchiveCatalogItem } from './collection-database.ts'

export const QUARANTINE_BATCH_LIMIT = 256
export interface QuarantineReconciliationResult {
  releasedRecords: number
  recoveryRecords: number
  missingRecords: number
}
interface QuarantineDependencies {
  jobs: BackgroundJobCoordinator
  listRecords(): string[]
  resolve(installationPath: string, records: string[]): Promise<ResolvedArchiveCatalogItem[]>
  commit(items: ResolvedArchiveCatalogItem[]): QuarantineReconciliationResult
  runExclusive<T>(operation: () => Promise<T>): Promise<T>
  queueBackup(reason: string): void
}

function validateBatch(records: string[], items: ResolvedArchiveCatalogItem[]): void {
  const expected = new Set(records.map(record => record.toLowerCase()))
  if (!Array.isArray(items) || items.length !== records.length) throw new Error('Quarantine resolution returned an incomplete batch.')
  for (const item of items) {
    if (!item || typeof item.record !== 'string' || !expected.delete(item.record.toLowerCase()) ||
      typeof item.found !== 'boolean' || (item.found && (
        typeof item.catalogEligible !== 'boolean' || typeof item.name !== 'string' || !item.name.trim() ||
        typeof item.contentPack !== 'string' || !item.contentPack.trim() ||
        typeof item.itemClass !== 'string' || typeof item.slot !== 'string' ||
        !Number.isSafeInteger(item.levelRequirement) || !Number.isSafeInteger(item.itemLevel) ||
        (item.bitmap !== null && typeof item.bitmap !== 'string')
      ))) throw new Error('Quarantine resolution returned an invalid record.')
  }
}

/** Explicit metadata command. Reads never instantiate or invoke this capability. */
export class QuarantineReconciliationService {
  private readonly dependencies: QuarantineDependencies
  private readonly active = new Set<Promise<QuarantineReconciliationResult>>()
  private stopped = false

  constructor(dependencies: QuarantineDependencies) { this.dependencies = dependencies }

  reconcile(installationPath: string | undefined): Promise<QuarantineReconciliationResult> {
    if (this.stopped) return Promise.reject(new Error('Quarantine reconciliation is shutting down.'))
    if (!installationPath || this.dependencies.listRecords().length === 0) {
      return Promise.resolve({ releasedRecords: 0, recoveryRecords: 0, missingRecords: 0 })
    }
    const run = this.dependencies.jobs.run({
      kind: 'quarantine-reconciliation',
      dedupeKey: `quarantine-reconciliation:${installationPath.replaceAll('\\', '/').toLowerCase()}`,
      stage: 'queued',
      progress: { completed: 0, total: null, percent: null, unit: 'items',
        label: 'Review quarantined item metadata', detail: 'Preparing installed-data classification.' },
      canCancel: true, supportsCancellation: true, boundary: 'before the next metadata batch',
      completedStage: 'complete', failedStage: 'failed', canceledStage: 'canceled'
    }, async job => {
      const totals: QuarantineReconciliationResult = { releasedRecords: 0, recoveryRecords: 0, missingRecords: 0 }
      const attempted = new Set<string>()
      while (true) {
        if (this.stopped) { job.finishAsCanceled('canceled'); break }
        job.safeBoundary('before the next metadata batch')
        const records = this.dependencies.listRecords().filter(record => !attempted.has(record))
        if (records.length === 0) break
        const batch = records.slice(0, QUARANTINE_BATCH_LIMIT)
        job.update({ stage: 'resolving', canCancel: false, boundary: null,
          progress: { completed: attempted.size, total: attempted.size + records.length,
            label: 'Resolve installed item records', detail: `Classifying ${batch.length} records.` } })
        // The helper deduplicates case-insensitively; SQLite retains exact keys.
        // Bound both the original commit rows and the unique helper request.
        const canonical = [...new Set(batch.map(record => record.toLowerCase()))]
        const resolved = await this.dependencies.resolve(installationPath, canonical)
        validateBatch(canonical, resolved)
        const byRecord = new Map(resolved.map(item => [item.record.toLowerCase(), item]))
        const exactRows = batch.map(record => ({ ...byRecord.get(record.toLowerCase())!, record }))
        job.update({ stage: 'persisting', progress: { label: 'Store quarantine metadata', detail: 'Committing a bounded metadata batch.' } })
        const committed = await this.dependencies.runExclusive(async () => {
          const result = this.dependencies.commit(exactRows)
          if (result.releasedRecords + result.recoveryRecords > 0) {
            this.dependencies.queueBackup('quarantine metadata reconciled')
          }
          return result
        })
        for (const key of ['releasedRecords', 'recoveryRecords', 'missingRecords'] as const) totals[key] += committed[key]
        for (const record of batch) attempted.add(record)
        job.update({ progress: { completed: attempted.size } })
      }
      return totals
    }, result => ({ summary: 'Quarantine metadata review complete.', metrics: { ...result } }))
    this.active.add(run.result)
    void run.result.then(() => this.active.delete(run.result), () => this.active.delete(run.result))
    return run.result
  }

  async shutdown(): Promise<void> {
    this.stopped = true
    // Wait for helper resolution and its serialized commit before database close.
    await Promise.allSettled([...this.active])
  }
}
