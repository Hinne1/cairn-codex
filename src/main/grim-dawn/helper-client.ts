import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { constants as osConstants, setPriority } from 'node:os'
import { HelperRequestError, helperMethodPolicy, parseHelperResponse, validateHelperHealth } from './helper-protocol.ts'

interface PendingRequest {
  mutates: boolean
  bytes: number
  settled: boolean
  resolve(value: unknown): void
  reject(error: HelperRequestError): void
  timeout: NodeJS.Timeout
}

interface Generation {
  child: ChildProcessWithoutNullStreams
  ready: Promise<void>
  health?: unknown
  failed: HelperRequestError | null
  pending: Map<string, PendingRequest>
  chunks: Buffer[]
  outputBytes: number
  requestBytes: number
  waitingBytes: number
  waiters: number
  idleTimer: NodeJS.Timeout | null
}

export interface GrimDawnHelperOptions {
  command: string
  args: string[]
  requestTimeoutMs?: number
  workerIdleTimeoutMs?: number
  maxResponseBytes?: number
  maxRequestBytes?: number
  maxPendingRequests?: number
  maxPendingBytes?: number
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
    for (const value of [options.requestTimeoutMs, options.workerIdleTimeoutMs,
      options.maxResponseBytes, options.maxRequestBytes, options.maxPendingRequests, options.maxPendingBytes]) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
        throw new RangeError('Helper limits must be positive safe integers.')
      }
    }
    for (const value of [options.requestTimeoutMs, options.workerIdleTimeoutMs]) {
      if (value !== undefined && value > 2_147_483_647) throw new RangeError('Helper timeouts exceed the timer limit.')
    }
    this.live = new HelperProcessClient(options, 'live')
    this.worker = new HelperProcessClient(options, 'worker', options.workerIdleTimeoutMs ?? 30_000)
  }
  async request<T>(method: string, params: object = {}): Promise<T> {
    return (helperMethodPolicy(method).lane === 'live' ? this.live : this.worker).request<T>(method, params)
  }
  dispose(): void { this.live.dispose(); this.worker.dispose() }
}

export function usesLiveLane(method: string): boolean { return helperMethodPolicy(method).lane === 'live' }

class HelperProcessClient {
  private readonly options: GrimDawnHelperOptions
  private readonly lane: 'live' | 'worker'
  private readonly idleTimeoutMs?: number
  private current: Generation | null = null
  private nextId = 1
  private disposed = false

  constructor(options: GrimDawnHelperOptions, lane: 'live' | 'worker', idleTimeoutMs?: number) {
    this.options = options
    this.lane = lane
    this.idleTimeoutMs = idleTimeoutMs
  }

  async request<T>(method: string, params: object): Promise<T> {
    if (this.disposed) throw new HelperRequestError('HELPER_STOPPED', 'The helper client is disposed.')
    let serialized: string
    try { serialized = JSON.stringify(params) } catch {
      throw new HelperRequestError('HELPER_REQUEST_INVALID', 'The helper request cannot be serialized.')
    }
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > (this.options.maxRequestBytes ?? 32 * 1024 ** 2)) {
      throw new HelperRequestError('HELPER_REQUEST_LIMIT', 'The helper request exceeds its size limit.')
    }
    const bytes = Buffer.byteLength(serialized)
    const generation = this.ensureStarted()
    if (generation.waiters >= (this.options.maxPendingRequests ?? 64) ||
        generation.waitingBytes + generation.requestBytes + bytes > (this.options.maxPendingBytes ?? 64 * 1024 ** 2)) {
      throw new HelperRequestError('HELPER_REQUEST_LIMIT', 'The helper has too many pending requests.')
    }
    this.clearIdleTimer(generation)
    generation.waiters++
    generation.waitingBytes += bytes
    let waiting = true
    try {
      await generation.ready
      if (generation.failed) throw generation.failed
      generation.waitingBytes -= bytes
      waiting = false
      if (method === 'health') return generation.health as T
      return await this.send(generation, method, serialized) as T
    } finally {
      if (waiting) generation.waitingBytes -= bytes
      generation.waiters--
      this.scheduleIdleStop(generation)
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.current) this.retire(this.current, new HelperRequestError('HELPER_STOPPED', 'Grim Dawn helper stopped.'))
  }

  private ensureStarted(): Generation {
    if (this.current) return this.current
    const child = spawn(this.options.command, this.options.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    if (child.pid !== undefined && this.lane === 'worker') {
      try { setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL) } catch { /* Best effort. */ }
    }
    const generation: Generation = {
      child, ready: Promise.resolve(), failed: null, pending: new Map(), chunks: [],
      outputBytes: 0, requestBytes: 0, waitingBytes: 0, waiters: 0, idleTimer: null
    }
    this.current = generation
    child.stdout.on('data', (chunk: Buffer) => this.handleOutput(generation, chunk))
    child.stdout.on('error', () => this.retire(generation,
      new HelperRequestError('HELPER_OUTPUT_FAILED', 'The helper output stream failed.')))
    // Drain stderr without publishing raw paths, payloads or unbounded diagnostics.
    child.stderr.on('data', () => {})
    child.stderr.on('error', () => {})
    child.stdin.on('error', () => this.retire(generation,
      new HelperRequestError('HELPER_WRITE_FAILED', 'The helper input stream failed.')))
    child.once('error', () => this.handleExit(generation))
    child.once('exit', () => this.handleExit(generation))
    generation.ready = this.send(generation, 'health', '{}').then(value => {
      validateHelperHealth(value)
      generation.health = value
    }).catch(error => {
      this.retire(generation, error)
      throw error
    })
    // Admission can reject the first caller, but the handshake still owns its failure.
    void generation.ready.catch(() => {})
    return generation
  }

  private send(generation: Generation, method: string, params: string): Promise<unknown> {
    const mutates = helperMethodPolicy(method).mutates
    if (generation.failed) return Promise.reject(generation.failed)
    if (mutates && [...generation.pending.values()].some(request => request.mutates && request.settled)) {
      return Promise.reject(new HelperRequestError('HELPER_OUTCOME_PENDING', 'An earlier helper write still requires recovery.', true))
    }
    const id = String(this.nextId++)
    const line = `{"id":"${id}","method":"${method}","params":${params}}\n`
    const bytes = Buffer.byteLength(line)
    if (bytes > (this.options.maxRequestBytes ?? 32 * 1024 ** 2) ||
        generation.requestBytes + generation.waitingBytes + bytes > (this.options.maxPendingBytes ?? 64 * 1024 ** 2) ||
        generation.pending.size >= (this.options.maxPendingRequests ?? 64)) {
      return Promise.reject(new HelperRequestError('HELPER_REQUEST_LIMIT', 'The helper request queue exceeds its safe bounds.'))
    }
    const started = Date.now()
    return new Promise((resolve, reject) => {
      const request: PendingRequest = {
        mutates, bytes, settled: false,
        resolve: value => {
          if (request.settled) return
          request.settled = true
          this.diagnostic(method, started)
          resolve(value)
        },
        reject: error => {
          if (request.settled) return
          request.settled = true
          this.diagnostic(method, started, error)
          reject(error)
        },
        timeout: setTimeout(() => {
          request.reject(new HelperRequestError('HELPER_TIMEOUT', `Grim Dawn helper timed out while handling ${method}.`, mutates))
          // Retain timed-out writes until late reply or exit; reads alone can restart.
          if (![...generation.pending.values()].some(pending => pending.mutates)) {
            this.retire(generation, new HelperRequestError('HELPER_TIMEOUT', 'The helper read timed out.'))
          }
        }, this.options.requestTimeoutMs ?? 60_000)
      }
      generation.pending.set(id, request)
      generation.requestBytes += bytes
      const writeFailed = (): void => this.retire(generation,
        new HelperRequestError('HELPER_WRITE_FAILED', 'The helper input stream failed.'))
      try { generation.child.stdin.write(line, error => { if (error) writeFailed() }) }
      catch { writeFailed() }
    })
  }

  private handleOutput(generation: Generation, chunk: Buffer): void {
    if (generation.failed) return
    let offset = 0
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset)
      const end = newline === -1 ? chunk.length : newline
      const part = chunk.subarray(offset, end)
      generation.outputBytes += part.length
      if (generation.outputBytes > (this.options.maxResponseBytes ?? 256 * 1024 ** 2) || generation.chunks.length >= 16384) {
        this.retire(generation, new HelperRequestError('HELPER_RESPONSE_LIMIT', 'The helper response exceeds its size limit.'))
        return
      }
      generation.chunks.push(part)
      if (newline === -1) return
      try {
        const line = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(generation.chunks, generation.outputBytes))
        generation.chunks = []
        generation.outputBytes = 0
        const response = parseHelperResponse(line)
        const request = generation.pending.get(response.id)
        if (request) {
          clearTimeout(request.timeout)
          generation.pending.delete(response.id)
          generation.requestBytes -= request.bytes
          if (response.error) request.reject(new HelperRequestError(response.error.code,
            `${response.error.code}: ${response.error.message}`, request.mutates))
          else request.resolve(response.result)
          this.scheduleIdleStop(generation)
        }
        // Valid duplicate/unknown IDs cannot settle or change another request.
      } catch {
        this.retire(generation, new HelperRequestError('HELPER_PROTOCOL_INVALID', 'The helper returned an invalid protocol response.'))
        return
      }
      offset = newline + 1
    }
  }

  private retire(generation: Generation, error: HelperRequestError): void {
    if (generation.failed) return
    generation.failed = error
    this.clearIdleTimer(generation)
    const hasWrite = [...generation.pending.values()].some(request => request.mutates)
    for (const request of generation.pending.values()) {
      clearTimeout(request.timeout)
      request.reject(new HelperRequestError(error.code, error.message, request.mutates))
    }
    generation.pending.clear()
    generation.chunks = []
    generation.outputBytes = 0
    // Close input gracefully; no replacement/forced kill may overlap an active write.
    if (!hasWrite && this.current === generation) this.current = null
    generation.child.stdin.end()
    if (!hasWrite && generation.child.exitCode === null && generation.child.signalCode === null) {
      const fallback = setTimeout(() => generation.child.kill(), 2_000)
      fallback.unref()
      generation.child.once('exit', () => clearTimeout(fallback))
    }
  }

  private handleExit(generation: Generation): void {
    this.retire(generation, new HelperRequestError('HELPER_EXITED', 'The Grim Dawn helper process exited.'))
    if (this.current === generation) this.current = null
  }

  private diagnostic(method: string, started: number, error?: Error): void {
    try {
      this.options.onDiagnostic?.({ lane: this.lane, method, durationMs: Date.now() - started,
        outcome: error ? 'failed' : 'completed', ...(error ? { error } : {}) })
    } catch { /* An observer must not leave protocol promises unsettled. */ }
  }

  private clearIdleTimer(generation: Generation): void {
    if (generation.idleTimer) clearTimeout(generation.idleTimer)
    generation.idleTimer = null
  }

  private scheduleIdleStop(generation: Generation): void {
    if (this.idleTimeoutMs === undefined || generation.failed || generation.waiters > 0 || generation.pending.size > 0) return
    this.clearIdleTimer(generation)
    generation.idleTimer = setTimeout(() => {
      if (generation.waiters === 0 && generation.pending.size === 0) {
        this.retire(generation, new HelperRequestError('HELPER_IDLE', 'The helper worker became idle.'))
      }
    }, this.idleTimeoutMs)
    generation.idleTimer.unref()
  }
}
