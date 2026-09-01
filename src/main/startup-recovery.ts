import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const STARTUP_FAILURE_THRESHOLD = 3
export const STARTUP_FAILURE_WINDOW_MS = 10 * 60 * 1000

export interface StartupRecoveryStatus {
  active: boolean
  suggested: boolean
  failedStarts: number
  threshold: number
}

interface StartupRecoveryState {
  version: 1
  healthy: boolean
  failedStarts: number
  lastStartedAtUtc: string
  lastHealthyAtUtc: string | null
}

function validState(value: unknown): value is StartupRecoveryState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Partial<StartupRecoveryState>
  return state.version === 1 &&
    typeof state.healthy === 'boolean' &&
    Number.isInteger(state.failedStarts) &&
    Number(state.failedStarts) >= 0 &&
    typeof state.lastStartedAtUtc === 'string' &&
    (state.lastHealthyAtUtc === null || typeof state.lastHealthyAtUtc === 'string')
}

async function readState(path: string): Promise<StartupRecoveryState | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    return validState(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function writeState(path: string, state: StartupRecoveryState): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(state), 'utf8')
  await rename(temporary, path)
}

export class StartupRecoveryService {
  private readonly path: string
  private readonly safeModeActive: boolean
  private readonly threshold: number
  private readonly windowMs: number
  private current: StartupRecoveryState | null = null
  private status: StartupRecoveryStatus
  private pendingWrite: Promise<void> = Promise.resolve()

  constructor(
    path: string,
    safeModeActive: boolean,
    threshold = STARTUP_FAILURE_THRESHOLD,
    windowMs = STARTUP_FAILURE_WINDOW_MS
  ) {
    this.path = path
    this.safeModeActive = safeModeActive
    this.threshold = threshold
    this.windowMs = windowMs
    this.status = { active: safeModeActive, suggested: false, failedStarts: 0, threshold }
  }

  async markStarted(now = new Date()): Promise<StartupRecoveryStatus> {
    return this.serialize(async () => {
      const previous = await readState(this.path)
      const previousStart = previous ? Date.parse(previous.lastStartedAtUtc) : Number.NaN
      const recentUnhealthy = Boolean(
        previous && !previous.healthy && Number.isFinite(previousStart) &&
        now.getTime() - previousStart >= 0 && now.getTime() - previousStart <= this.windowMs
      )
      // The current launch is not a failed start yet. Only count a preceding launch
      // that never reached the interactive/healthy checkpoint.
      const failedStarts = recentUnhealthy ? Math.min(previous!.failedStarts + 1, 99) : 0
      this.current = {
        version: 1,
        healthy: false,
        failedStarts,
        lastStartedAtUtc: now.toISOString(),
        lastHealthyAtUtc: previous?.lastHealthyAtUtc ?? null
      }
      await writeState(this.path, this.current)
      this.status = {
        active: this.safeModeActive,
        suggested: !this.safeModeActive && failedStarts >= this.threshold,
        failedStarts,
        threshold: this.threshold
      }
      return this.getStatus()
    })
  }

  async markHealthy(now = new Date()): Promise<void> {
    await this.serialize(async () => {
      if (!this.current || this.current.healthy) return
      this.current = {
        ...this.current,
        healthy: true,
        failedStarts: 0,
        lastHealthyAtUtc: now.toISOString()
      }
      await writeState(this.path, this.current)
    })
  }

  async markRendererFailure(now = new Date()): Promise<void> {
    await this.serialize(async () => {
      const state = this.current ?? await readState(this.path)
      this.current = {
        version: 1,
        healthy: false,
        failedStarts: state?.failedStarts ?? 0,
        lastStartedAtUtc: state?.lastStartedAtUtc ?? now.toISOString(),
        lastHealthyAtUtc: state?.lastHealthyAtUtc ?? null
      }
      await writeState(this.path, this.current)
    })
  }

  getStatus(): StartupRecoveryStatus {
    return { ...this.status }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pendingWrite.then(operation, operation)
    this.pendingWrite = result.then(() => undefined, () => undefined)
    return result
  }
}
