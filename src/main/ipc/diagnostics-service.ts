import type {
  AppStatus,
  DebugLoggingStatus,
  DiagnosticExportResult,
  PreferenceLoadReport,
  RecoveryStatus,
  RendererErrorReport
} from '../../shared/contracts.ts'

interface RetentionPolicy {
  maxFiles: number
  maxFileBytes: number
  maxAgeDays: number
}

interface RecoveryOperationSummary {
  id: string
  operation: string
  state: string
  startedAtUtc: string
  hasBackup: boolean
}

export interface DiagnosticExporter {
  export(): Promise<DiagnosticExportResult>
}

export interface DiagnosticsServiceDependencies {
  visualDiagnosticsActive(): boolean
  appVersion(): string
  helperHealth(): Promise<unknown>
  safeModeStatus(): AppStatus['safeMode']
  debugEnabled(): boolean
  retentionPolicy(): RetentionPolicy
  persistDebugLogging(enabled: boolean): void
  applyDebugLogging(enabled: boolean): void
  info(scope: string, event: string, data?: Record<string, unknown>): void
  warn(scope: string, event: string, data?: Record<string, unknown>): void
  error(scope: string, event: string, error: Error, data?: Record<string, unknown>): void
  selectPreferenceExport(serialized: string): Promise<string | null>
  reconcileRecovery(): Promise<unknown>
  runExclusive<T>(operation: () => Promise<T>): Promise<T>
  recoveryOperations(): RecoveryOperationSummary[]
  exporter: DiagnosticExporter
}

export class DiagnosticsService {
  private readonly dependencies: DiagnosticsServiceDependencies

  constructor(dependencies: DiagnosticsServiceDependencies) {
    this.dependencies = dependencies
  }

  async getAppStatus(): Promise<AppStatus> {
    let helper: AppStatus['helper'] = 'available'
    try { await this.dependencies.helperHealth() } catch { helper = 'unavailable' }
    return {
      appVersion: this.dependencies.appVersion(),
      helper,
      mode: 'read-only',
      safeMode: this.dependencies.safeModeStatus()
    }
  }

  getDebugLogging(): DebugLoggingStatus {
    const policy = this.dependencies.retentionPolicy()
    return { enabled: this.dependencies.debugEnabled(), ...policy }
  }

  setDebugLogging(input: { enabled: boolean }): DebugLoggingStatus {
    this.dependencies.persistDebugLogging(input.enabled)
    this.dependencies.applyDebugLogging(input.enabled)
    return this.getDebugLogging()
  }

  recordNavigation(input: { view: string }): void {
    this.dependencies.info('navigation', 'workspace.opened', { view: input.view })
  }

  reportRendererError(input: RendererErrorReport): void {
    this.dependencies.error('renderer', 'workspace.failed', new Error(input.message), {
      correlationId: input.correlationId,
      workspace: input.workspace,
      stack: input.stack
    })
  }

  reportPreferenceLoad(input: PreferenceLoadReport): void {
    const event = input.invalidFields.length ? 'preferences.recovered' : 'preferences.loaded'
    const data = {
      source: input.source,
      migrated: input.migrated,
      schemaVersion: input.schemaVersion,
      invalidFields: input.invalidFields
    }
    if (input.invalidFields.length) this.dependencies.warn('settings', event, data)
    else this.dependencies.info('settings', event, data)
  }

  async exportPreferences(input: { serialized: string }): Promise<DiagnosticExportResult> {
    const path = await this.dependencies.selectPreferenceExport(input.serialized)
    if (!path) return { canceled: true, path: null }
    this.dependencies.info('settings', 'preferences.exported', { schemaVersion: 1 })
    return { canceled: false, path }
  }

  getRecoveryStatus(): Promise<RecoveryStatus> {
    return this.dependencies.runExclusive(async () => {
      if (!this.dependencies.visualDiagnosticsActive()) await this.dependencies.reconcileRecovery()
      const operations = this.dependencies.recoveryOperations()
      return {
        requiresAttention: operations.length > 0,
        operations: operations.map(({ id, operation, state, startedAtUtc, hasBackup }) => ({
          id, operation, state, startedAtUtc, hasBackup
        }))
      }
    })
  }

  exportDiagnostics(): Promise<DiagnosticExportResult> {
    return this.dependencies.exporter.export()
  }
}
