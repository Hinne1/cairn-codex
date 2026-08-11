import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
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
}

export class GrimDawnHelperClient {
  private process: ChildProcessWithoutNullStreams | null = null
  private lines: ReadLineInterface | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private nextId = 1

  constructor(private readonly options: GrimDawnHelperOptions) {}

  async request<T>(method: string, params: object = {}): Promise<T> {
    const process = this.ensureStarted()
    const id = String(this.nextId++)

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Grim Dawn helper timed out while handling ${method}.`))
      }, this.options.requestTimeoutMs ?? 60_000)

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout
      })

      process.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (!error) return

        clearTimeout(timeout)
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  dispose(): void {
    const child = this.process
    this.lines?.close()
    this.lines = null
    this.rejectAll(new Error('Grim Dawn helper stopped.'))
    this.process = null
    if (!child) return
    // Closing stdin lets the helper leave its request loop and run adapter disposal,
    // including the live-hook deactivation handshake. Keep a bounded kill fallback.
    child.stdin.end()
    const fallback = setTimeout(() => {
      if (!child.killed) child.kill()
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
    this.process = child
    this.lines = createInterface({ input: child.stdout })
    this.lines.on('line', (line) => this.handleLine(line))
    child.stderr.on('data', (chunk: Buffer) => console.error(`[grim-dawn-helper] ${chunk.toString()}`))
    child.once('error', (error) => this.handleExit(error))
    child.once('exit', (code, signal) => {
      this.handleExit(new Error(`Grim Dawn helper exited (code ${code}, signal ${signal}).`))
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
  }

  private handleExit(error: Error): void {
    this.lines?.close()
    this.lines = null
    this.process = null
    this.rejectAll(error)
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
