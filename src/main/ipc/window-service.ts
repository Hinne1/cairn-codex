import type { StartupPhaseEvent, StartupStatus } from '../../shared/contracts.ts'
import type { IpcEventLike } from './service-registry.ts'

export interface WindowServiceDependencies {
  restart(safeMode: boolean): void
  startupStatus(): StartupStatus
  recordStartupPhase(phase: StartupPhaseEvent): StartupStatus
  markHealthy(): Promise<void>
  recordHealthFailure(error: unknown): void
  openDataDirectory(): Promise<string>
}

export class WindowService {
  private readonly dependencies: WindowServiceDependencies

  constructor(dependencies: WindowServiceDependencies) {
    this.dependencies = dependencies
  }

  restartInSafeMode(): void {
    this.dependencies.restart(true)
  }

  restartNormally(): void {
    this.dependencies.restart(false)
  }

  getStartupStatus(): StartupStatus {
    return this.dependencies.startupStatus()
  }

  reportStartupPhase(input: { phase: StartupPhaseEvent }): StartupStatus {
    const status = this.dependencies.recordStartupPhase(input.phase)
    if (input.phase === 'interactive') {
      void this.dependencies.markHealthy().catch((error) => this.dependencies.recordHealthFailure(error))
    }
    return status
  }

  openDataDirectory(): Promise<string> {
    return this.dependencies.openDataDirectory()
  }

  setZoomFactor(event: IpcEventLike, input: { factor: number }): number {
    const factor = Math.min(1.8, Math.max(0.7, Math.round(input.factor * 10) / 10))
    event.sender.setZoomFactor(factor)
    return factor
  }
}
