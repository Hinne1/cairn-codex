import { appendFile, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error'

export interface DiagnosticLogEntry {
  timestampUtc: string
  level: DiagnosticLevel
  scope: string
  event: string
  correlationId?: string
  durationMs?: number
  data?: Record<string, unknown>
}

export interface DiagnosticRetentionPolicy {
  debug: boolean
  maxFiles: number
  maxFileBytes: number
  maxAgeDays: number
  maximumExportedEntries: number
}

const normalPolicy: DiagnosticRetentionPolicy = {
  debug: false,
  maxFiles: 3,
  maxFileBytes: 256 * 1024,
  maxAgeDays: 7,
  maximumExportedEntries: 1_500
}

const debugPolicy: DiagnosticRetentionPolicy = {
  debug: true,
  maxFiles: 6,
  maxFileBytes: 1024 * 1024,
  maxAgeDays: 14,
  maximumExportedEntries: 5_000
}

const sensitiveKey = /(?:^|_)(?:path|directory|payload|serialized|save|stash|queue|receipt|credential|password|secret|token|email|character_name|expected_character_name)(?:$|_)/i

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function redactDiagnosticString(value: string, secrets: string[] = []): string {
  let redacted = value
  for (const secret of secrets.filter((candidate) => candidate.length >= 2)) {
    redacted = redacted.replace(new RegExp(escapeRegExp(secret), 'gi'), '<redacted>')
  }
  return redacted
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n]*/g, '<path>')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<email>')
    .replace(/\b(?:bearer\s+|token|password|secret|api[_ -]?key)\s*[:=]\s*[^\s,;]+/gi, '<credential>')
    .replace(/(active character(?: name)?(?: is|:)?\s+)[^.,;\r\n]+/gi, '$1<character>')
}

export function redactDiagnosticValue(
  value: unknown,
  secrets: string[] = [],
  depth = 0,
  seen = new WeakSet<object>()
): unknown {
  if (depth > 8) return '<depth-limited>'
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return redactDiagnosticString(value, secrets)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined') return null
  if (typeof value === 'function' || typeof value === 'symbol') return '<unsupported>'
  if (value instanceof Error) {
    return {
      name: redactDiagnosticString(value.name, secrets),
      message: redactDiagnosticString(value.message, secrets)
    }
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '<binary omitted>'
  if (Array.isArray(value)) {
    return value.slice(0, 250).map((entry) => redactDiagnosticValue(entry, secrets, depth + 1, seen))
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '<circular>'
    seen.add(value)
    const output: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 250)) {
      const normalizedKey = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLocaleLowerCase()
      output[key] = sensitiveKey.test(normalizedKey)
        ? `<redacted:${key.toLocaleLowerCase().includes('path') || key.toLocaleLowerCase().includes('directory') ? 'path' : 'private'}>`
        : redactDiagnosticValue(entry, secrets, depth + 1, seen)
    }
    return output
  }
  return '<unsupported>'
}

export function diagnosticError(error: unknown, secrets: string[] = []): Record<string, unknown> {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code
    return {
      name: redactDiagnosticString(error.name, secrets),
      message: redactDiagnosticString(error.message, secrets),
      ...(typeof code === 'string' || typeof code === 'number' ? { code } : {})
    }
  }
  return { name: 'UnknownError', message: redactDiagnosticString(String(error), secrets) }
}

export function diagnosticPrivacyViolations(serialized: string, secrets: string[] = []): string[] {
  const violations: string[] = []
  if (/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n"]+/i.test(serialized)) violations.push('absolute-path')
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(serialized)) violations.push('email')
  if (/\b(?:bearer\s+|password|secret|api[_ -]?key)\s*[:=]\s*[^\s,;<]+/i.test(serialized)) {
    violations.push('credential')
  }
  if (secrets.some((secret) => secret.length >= 2 && serialized.toLocaleLowerCase().includes(secret.toLocaleLowerCase()))) {
    violations.push('registered-secret')
  }
  return violations
}

export class DiagnosticLogger {
  private queue: Promise<void> = Promise.resolve()
  private debug = false
  private secrets = new Set<string>()
  private readonly directory: string

  constructor(directory: string, debug = false) {
    this.directory = directory
    this.debug = debug
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    await this.prune()
  }

  setDebugMode(enabled: boolean): void {
    if (this.debug === enabled) return
    this.debug = enabled
    this.info('settings', 'debug-logging.changed', { enabled })
    this.queue = this.queue.then(() => this.prune()).catch(() => undefined)
  }

  getDebugMode(): boolean {
    return this.debug
  }

  getRetentionPolicy(): DiagnosticRetentionPolicy {
    return { ...(this.debug ? debugPolicy : normalPolicy) }
  }

  registerSecret(value: string | null | undefined): void {
    if (value && value.length >= 2) this.secrets.add(value)
  }

  debugEvent(scope: string, event: string, data?: Record<string, unknown>): void {
    if (this.debug) this.write('debug', scope, event, data)
  }

  info(scope: string, event: string, data?: Record<string, unknown>): void {
    this.write('info', scope, event, data)
  }

  warn(scope: string, event: string, data?: Record<string, unknown>): void {
    this.write('warn', scope, event, data)
  }

  error(scope: string, event: string, error: unknown, data?: Record<string, unknown>): void {
    this.write('error', scope, event, { ...data, error: diagnosticError(error, [...this.secrets]) })
  }

  operationStarted(scope: string, event: string, correlationId: string, data?: Record<string, unknown>): number {
    this.write('info', scope, `${event}.started`, data, correlationId)
    return Date.now()
  }

  operationCompleted(
    scope: string,
    event: string,
    correlationId: string,
    startedAt: number,
    data?: Record<string, unknown>
  ): void {
    this.write('info', scope, `${event}.completed`, data, correlationId, Date.now() - startedAt)
  }

  operationFailed(scope: string, event: string, correlationId: string, startedAt: number, error: unknown): void {
    this.write(
      'error',
      scope,
      `${event}.failed`,
      { error: diagnosticError(error, [...this.secrets]) },
      correlationId,
      Date.now() - startedAt
    )
  }

  async flush(): Promise<void> {
    await this.queue
  }

  async readEntries(): Promise<DiagnosticLogEntry[]> {
    await this.flush()
    const policy = this.getRetentionPolicy()
    const names = (await readdir(this.directory).catch(() => []))
      .filter((name) => /^cairn-codex(?:\.\d+)?\.jsonl$/i.test(name))
      .sort((left, right) => logOrder(right) - logOrder(left))
    const entries: DiagnosticLogEntry[] = []
    for (const name of names) {
      const text = await readFile(join(this.directory, name), 'utf8').catch(() => '')
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue
        try {
          const entry = JSON.parse(line) as DiagnosticLogEntry
          entries.push(redactDiagnosticValue(entry, [...this.secrets]) as DiagnosticLogEntry)
        } catch {
          entries.push({
            timestampUtc: new Date(0).toISOString(),
            level: 'warn',
            scope: 'diagnostics',
            event: 'malformed-log-line.omitted'
          })
        }
      }
    }
    return entries
      .sort((left, right) => Date.parse(left.timestampUtc) - Date.parse(right.timestampUtc))
      .slice(-policy.maximumExportedEntries)
  }

  private write(
    level: DiagnosticLevel,
    scope: string,
    event: string,
    data?: Record<string, unknown>,
    correlationId?: string,
    durationMs?: number
  ): void {
    const entry = redactDiagnosticValue({
      timestampUtc: new Date().toISOString(),
      level,
      scope: scope.replace(/[^a-z0-9.-]/gi, '-').slice(0, 60),
      event: event.replace(/[^a-z0-9.-]/gi, '-').slice(0, 100),
      ...(correlationId ? { correlationId } : {}),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(data ? { data } : {})
    }, [...this.secrets]) as DiagnosticLogEntry
    this.queue = this.queue
      .then(() => this.append(entry))
      .catch(() => undefined)
  }

  private async append(entry: DiagnosticLogEntry): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    const current = join(this.directory, 'cairn-codex.jsonl')
    const line = `${JSON.stringify(entry)}\n`
    const size = await stat(current).then((value) => value.size).catch(() => 0)
    if (size + Buffer.byteLength(line) > this.getRetentionPolicy().maxFileBytes) {
      await this.rotate()
    }
    await appendFile(current, line, 'utf8')
  }

  private async rotate(): Promise<void> {
    const policy = this.getRetentionPolicy()
    await rm(join(this.directory, `cairn-codex.${policy.maxFiles - 1}.jsonl`), { force: true })
    for (let index = policy.maxFiles - 2; index >= 1; index -= 1) {
      await rename(
        join(this.directory, `cairn-codex.${index}.jsonl`),
        join(this.directory, `cairn-codex.${index + 1}.jsonl`)
      ).catch(() => undefined)
    }
    await rename(
      join(this.directory, 'cairn-codex.jsonl'),
      join(this.directory, 'cairn-codex.1.jsonl')
    ).catch(() => undefined)
    await this.prune()
  }

  private async prune(): Promise<void> {
    const policy = this.getRetentionPolicy()
    const cutoff = Date.now() - policy.maxAgeDays * 24 * 60 * 60 * 1000
    const names = await readdir(this.directory).catch(() => [])
    await Promise.all(names
      .filter((name) => /^cairn-codex(?:\.\d+)?\.jsonl$/i.test(name))
      .map(async (name) => {
        const path = join(this.directory, name)
        const info = await stat(path).catch(() => null)
        const index = logOrder(name)
        if ((info && info.mtimeMs < cutoff) || index >= policy.maxFiles) {
          await rm(path, { force: true })
        }
      }))
  }
}

function logOrder(name: string): number {
  if (name === 'cairn-codex.jsonl') return 0
  return Number(name.match(/\.(\d+)\.jsonl$/)?.[1] ?? Number.MAX_SAFE_INTEGER)
}
