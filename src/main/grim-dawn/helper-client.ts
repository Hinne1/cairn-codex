import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { constants as osConstants, setPriority } from 'node:os'
import { createInterface, type Interface as ReadLineInterface } from 'node:readline'

interface HelperResponse<T> {
  id?: string
  result?: T
  error?: {
    code: string
    message: string
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timeout: NodeJS.Timeout
}

export interface GrimDawnHelperOptions {
  command: string
  args: string[]
  requestTimeoutMs?: number
  workerIdleTimeoutMs?: number
  onDiagnostic?: (event: {
    lane: 'live' | 'worker'
    method: string
    outcome: 'completed' | 'failed'
    durationMs: number
    error?: Error
  }) => void
}

export class GrimDawnHelperClient {
  private readonly live: HelperProcessClient
  private readonly worker: HelperProcessClient

  constructor(options: GrimDawnHelperOptions) {
    this.live = new HelperProcessClient(options, 'live')
    this.worker = new HelperProcessClient(
      options,
      'worker',
      options.workerIdleTimeoutMs ?? 30_000,
      osConstants.priority.PRIORITY_BELOW_NORMAL
    )
  }

  request<T>(method: string, params: object = {}): Promise<T> {
    return (usesLiveLane(method) ? this.live : this.worker).request<T>(method, params)
  }

  dispose(): void {
    this.live.dispose()
    this.worker.dispose()
  }
}

export function usesLiveLane(method: string): boolean {
  return method === 'health' || method.includes('-live-')
}

class HelperProcessClient {
  private readonly options: GrimDawnHelperOptions
  private readonly lane: 'live' | 'worker'
  private readonly idleTimeoutMs?: number
  private readonly priority?: number
  private process: ChildProcessWithoutNullStreams | null = null
  private lines: ReadLineInterface | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private nextId = 1
  private idleTimer: NodeJS.Timeout | null = null

  constructor(
    options: GrimDawnHelperOptions,
    lane: 'live' | 'worker',
    idleTimeoutMs?: number,
    priority?: number
  ) {
    this.options = options
    this.lane = lane
    this.idleTimeoutMs = idleTimeoutMs
    this.priority = priority
  }

  async request<T>(method: string, params: object = {}): Promise<T> {
    this.clearIdleTimer()
    const process = this.ensureStarted()
    const id = String(this.nextId++)
    const startedAt = Date.now()

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(id)
        this.pending.delete(id)
        pending?.reject(new Error(`Grim Dawn helper timed out while handling ${method}.`))
        this.scheduleIdleStop()
      }, this.options.requestTimeoutMs ?? 60_000)

      this.pending.set(id, {
        resolve: (value) => {
          this.options.onDiagnostic?.({
            lane: this.lane,
            method,
            outcome: 'completed',
            durationMs: Date.now() - startedAt
          })
          resolve(value as T)
        },
        reject: (error) => {
          this.options.onDiagnostic?.({
            lane: this.lane,
            method,
            outcome: 'failed',
            durationMs: Date.now() - startedAt,
            error
          })
          reject(error)
        },
        timeout
      })

      process.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (!error) return

        const pending = this.pending.get(id)
        this.pending.delete(id)
        if (pending) {
          clearTimeout(pending.timeout)
          pending.reject(error)
        }
        this.scheduleIdleStop()
      })
    })
  }

  dispose(): void {
    this.clearIdleTimer()
    this.stop(new Error('Grim Dawn helper stopped.'))
  }

  private stop(reason: Error): void {
    const child = this.process
    this.lines?.close()
    this.lines = null
    this.rejectAll(reason)
    this.process = null
    if (!child) return
    // Closing stdin lets the helper leave its request loop and run adapter disposal,
    // including the live-hook deactivation handshake. Keep a bounded kill fallback.
    child.stdin.end()
    const fallback = setTimeout(() => {
      if (child.exitCode === null) child.kill()
    }, 2_000)
    fallback.unref()
    child.once('exit', () => clearTimeout(fallback))
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.process) return this.process

    const child = spawn(this.options.command, this.options.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    if (child.pid !== undefined && this.priority !== undefined) {
      try {
        setPriority(child.pid, this.priority)
      } catch (error) {
        console.warn('[grim-dawn-helper] Worker priority could not be lowered.', error)
      }
    }
    this.process = child
    this.lines = createInterface({ input: child.stdout })
    this.lines.on('line', (line) => this.handleLine(line))
    child.stderr.on('data', (chunk: Buffer) => console.error(`[grim-dawn-helper] ${chunk.toString()}`))
    child.once('error', (error) => this.handleExit(child, error))
    child.once('exit', (code, signal) => {
      this.handleExit(child, new Error(`Grim Dawn helper exited (code ${code}, signal ${signal}).`))
    })
    return child
  }

  private handleLine(line: string): void {
    let response: HelperResponse<unknown>
    try {
      response = JSON.parse(line) as HelperResponse<unknown>
    } catch {
      console.error(`[grim-dawn-helper] Invalid JSON response: ${line}`)
      return
    }

    if (!response.id) return
    const pending = this.pending.get(response.id)
    if (!pending) return

    clearTimeout(pending.timeout)
    this.pending.delete(response.id)
    if (response.error) {
      pending.reject(new Error(`${response.error.code}: ${response.error.message}`))
    } else {
      pending.resolve(response.result)
    }
    this.scheduleIdleStop()
  }

  private handleExit(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.process !== child) return
    this.lines?.close()
    this.lines = null
    this.process = null
    this.rejectAll(error)
  }

  private scheduleIdleStop(): void {
    if (this.idleTimeoutMs === undefined || this.pending.size > 0 || !this.process) return
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.pending.size === 0) this.stop(new Error('Grim Dawn helper worker became idle.'))
    }, this.idleTimeoutMs)
    this.idleTimer.unref()
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return
    clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
