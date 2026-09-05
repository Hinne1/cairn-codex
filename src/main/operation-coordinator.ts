import { randomUUID } from 'node:crypto'
import { SerializedServiceQueue } from './ipc/service-registry.ts'

export interface OperationDiagnostics {
  operationStarted(scope: string, event: string, correlationId: string, data?: Record<string, unknown>): number
  operationCompleted(
    scope: string,
    event: string,
    correlationId: string,
    startedAt: number,
    data?: Record<string, unknown>
  ): void
  operationFailed(
    scope: string,
    event: string,
    correlationId: string,
    startedAt: number,
    error: unknown
  ): void
}

export interface MainOperationDependencies {
  diagnostics: OperationDiagnostics
  transfersPermitted?(): boolean
  reconcileTransfers(): Promise<unknown>
  unresolvedTransferCount(): number
}

export class MainOperationCoordinator {
  private readonly writes = new SerializedServiceQueue()
  private readonly dependencies: MainOperationDependencies

  constructor(dependencies: MainOperationDependencies) {
    this.dependencies = dependencies
  }

  runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    return this.writes.run(operation)
  }

  runTransferExclusive<T>(operation: () => Promise<T>): Promise<T> {
    return this.runExclusive(async () => {
      // Check before reconciliation: retained receipts are also external writes.
      if (this.dependencies.transfersPermitted?.() === false) {
        throw new Error('Transfers are disabled during visual diagnostics.')
      }
      await this.dependencies.reconcileTransfers()
      const unresolved = this.dependencies.unresolvedTransferCount()
      if (unresolved > 0) {
        throw new Error(
          `${unresolved} earlier transfer operation${unresolved === 1 ? '' : 's'} require recovery attention. ` +
          'Pause writes, export diagnostics in Settings, and audit the retained journal and receipts first.'
        )
      }
      return operation()
    })
  }

  async runDiagnostic<T>(
    scope: string,
    event: string,
    operation: () => Promise<T>,
    startData?: Record<string, unknown>,
    completedData?: (result: T) => Record<string, unknown>,
    correlationId: string = randomUUID()
  ): Promise<T> {
    const startedAt = this.dependencies.diagnostics.operationStarted(scope, event, correlationId, startData)
    try {
      const result = await operation()
      this.dependencies.diagnostics.operationCompleted(
        scope, event, correlationId, startedAt, completedData?.(result)
      )
      return result
    } catch (error) {
      this.dependencies.diagnostics.operationFailed(scope, event, correlationId, startedAt, error)
      throw error
    }
  }

  flush(): Promise<void> {
    return this.writes.flush()
  }
}
