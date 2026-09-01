import { randomUUID } from 'node:crypto'
import type {
  AnyBackgroundJobSnapshot,
  BackgroundJobKind,
  BackgroundJobProgress,
  BackgroundJobResult,
  BackgroundJobSnapshot,
  BackgroundJobStage
} from '@shared/background-jobs'

const TERMINAL_RETENTION = 50
const MAX_LABEL_LENGTH = 120
const MAX_DETAIL_LENGTH = 500
const MAX_RESULT_BYTES = 8 * 1024
const BACKGROUND_JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isBackgroundJobId(value: unknown): value is string {
  return typeof value === 'string' && BACKGROUND_JOB_ID_PATTERN.test(value)
}

export class BackgroundJobCanceledError extends Error {
  constructor() {
    super('The background job was canceled at a safe boundary.')
    this.name = 'BackgroundJobCanceledError'
  }
}

export interface BackgroundJobContext<K extends BackgroundJobKind> {
  readonly id: string
  readonly correlationId: string
  update: (input: {
    stage?: BackgroundJobStage<K>
    progress?: Partial<BackgroundJobProgress>
    canCancel?: boolean
    boundary?: string | null
  }) => void
  safeBoundary: (boundary: string) => void
  throwIfCancellationRequested: () => void
  finishAsCanceled: (stage: Extract<BackgroundJobStage<K>, 'canceled'>) => void
}

export interface BackgroundJobDefinition<K extends BackgroundJobKind> {
  kind: K
  dedupeKey: string
  stage: BackgroundJobStage<K>
  progress: BackgroundJobProgress
  canCancel?: boolean
  supportsCancellation?: boolean
  boundary?: string | null
  completedStage: Extract<BackgroundJobStage<K>, 'complete'>
  failedStage: Extract<BackgroundJobStage<K>, 'failed'>
  canceledStage: Extract<BackgroundJobStage<K>, 'canceled'>
}

export interface BackgroundJobRun<T> {
  id: string
  correlationId: string
  coalesced: boolean
  result: Promise<T>
}

interface ActiveJob<T = unknown> {
  snapshot: AnyBackgroundJobSnapshot
  result: Promise<T>
}

function boundedText(value: string, maximum: number): string {
  return value.trim().slice(0, maximum)
}

function normalizeProgress(
  current: BackgroundJobProgress,
  patch: Partial<BackgroundJobProgress>
): BackgroundJobProgress {
  const completed = Math.max(0, Math.trunc(patch.completed ?? current.completed))
  const totalInput = patch.total === undefined ? current.total : patch.total
  const total = totalInput === null ? null : Math.max(0, Math.trunc(totalInput))
  const calculatedPercent = total && total > 0
    ? Math.min(100, Math.max(0, Math.round((completed / total) * 100)))
    : null
  const percentInput = patch.percent === undefined ? calculatedPercent : patch.percent
  return {
    completed,
    total,
    percent: percentInput === null ? null : Math.min(100, Math.max(0, Math.round(percentInput))),
    unit: patch.unit ?? current.unit,
    label: boundedText(patch.label ?? current.label, MAX_LABEL_LENGTH),
    detail: boundedText(patch.detail ?? current.detail, MAX_DETAIL_LENGTH)
  }
}

function boundedResult(result: BackgroundJobResult): BackgroundJobResult {
  const normalized = {
    summary: boundedText(result.summary, MAX_DETAIL_LENGTH),
    metrics: result.metrics
  }
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_RESULT_BYTES) {
    throw new Error('Background job result metadata exceeds its safe bound.')
  }
  return normalized
}

function presentError(error: unknown): { code: string; message: string; retriable: boolean } {
  const candidate = error instanceof Error ? error : new Error(String(error))
  const code = typeof (candidate as NodeJS.ErrnoException).code === 'string'
    ? (candidate as NodeJS.ErrnoException).code!
    : 'BACKGROUND_JOB_FAILED'
  return {
    code: boundedText(code, 80),
    message: boundedText(candidate.message || 'Background job failed.', MAX_DETAIL_LENGTH),
    retriable: code !== 'EINVAL' && code !== 'UNSUPPORTED'
  }
}

export class BackgroundJobCoordinator {
  private readonly jobs = new Map<string, ActiveJob>()
  private readonly activeByKey = new Map<string, string>()
  private readonly listeners = new Set<(job: AnyBackgroundJobSnapshot) => void>()

  subscribe(listener: (job: AnyBackgroundJobSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  list(): AnyBackgroundJobSnapshot[] {
    return [...this.jobs.values()]
      .map(({ snapshot }) => structuredClone(snapshot))
      .sort((left, right) => right.updatedAtUtc.localeCompare(left.updatedAtUtc))
  }

  requestCancellation(id: string): AnyBackgroundJobSnapshot | null {
    const active = this.jobs.get(id)
    if (!active) return null
    const snapshot = active.snapshot
    if (!['queued', 'running'].includes(snapshot.status) || !snapshot.cancellation.supported) {
      return structuredClone(snapshot)
    }
    snapshot.cancellation.requested = true
    snapshot.updatedAtUtc = new Date().toISOString()
    this.publish(snapshot)
    return structuredClone(snapshot)
  }

  run<K extends BackgroundJobKind, T>(
    definition: BackgroundJobDefinition<K>,
    operation: (context: BackgroundJobContext<K>) => Promise<T>,
    result: (value: T) => BackgroundJobResult
  ): BackgroundJobRun<T> {
    const existingId = this.activeByKey.get(definition.dedupeKey)
    const existing = existingId ? this.jobs.get(existingId) : undefined
    if (existing && ['queued', 'running'].includes(existing.snapshot.status)) {
      return {
        id: existing.snapshot.id,
        correlationId: existing.snapshot.correlationId,
        coalesced: true,
        result: existing.result as Promise<T>
      }
    }

    const id = randomUUID()
    const now = new Date().toISOString()
    const snapshot: BackgroundJobSnapshot<K> = {
      id,
      correlationId: randomUUID(),
      kind: definition.kind,
      dedupeKey: definition.dedupeKey,
      stage: definition.stage,
      status: 'queued',
      progress: normalizeProgress(definition.progress, {}),
      cancellation: {
        supported: definition.supportsCancellation ?? definition.canCancel ?? false,
        requested: false,
        canCancel: definition.canCancel ?? false,
        boundary: definition.boundary ?? null
      },
      result: null,
      error: null,
      startedAtUtc: now,
      updatedAtUtc: now,
      completedAtUtc: null,
      persistence: {
        navigation: 'main-process-session',
        restart: 'discard-in-flight'
      }
    }
    const active: ActiveJob<T> = { snapshot: snapshot as AnyBackgroundJobSnapshot, result: Promise.resolve(undefined as T) }
    this.jobs.set(id, active)
    this.activeByKey.set(definition.dedupeKey, id)
    this.publish(active.snapshot)

    const context: BackgroundJobContext<K> = {
      id,
      correlationId: snapshot.correlationId,
      update: (input) => {
        if (!['queued', 'running'].includes(snapshot.status)) return
        snapshot.status = 'running'
        if (input.stage !== undefined) snapshot.stage = input.stage
        if (input.progress) snapshot.progress = normalizeProgress(snapshot.progress, input.progress)
        if (input.canCancel !== undefined) snapshot.cancellation.canCancel = input.canCancel
        if (input.boundary !== undefined) snapshot.cancellation.boundary = input.boundary
        snapshot.updatedAtUtc = new Date().toISOString()
        this.publish(snapshot as AnyBackgroundJobSnapshot)
      },
      safeBoundary: (boundary) => {
        snapshot.cancellation.canCancel = true
        snapshot.cancellation.boundary = boundedText(boundary, MAX_LABEL_LENGTH)
        snapshot.updatedAtUtc = new Date().toISOString()
        this.publish(snapshot as AnyBackgroundJobSnapshot)
        context.throwIfCancellationRequested()
      },
      throwIfCancellationRequested: () => {
        if (snapshot.cancellation.requested && snapshot.cancellation.canCancel) {
          throw new BackgroundJobCanceledError()
        }
      },
      finishAsCanceled: (stage) => {
        snapshot.stage = stage
        snapshot.status = 'canceled'
        snapshot.cancellation.canCancel = false
        snapshot.cancellation.boundary = null
      }
    }

    active.result = Promise.resolve()
      .then(() => {
        snapshot.status = 'running'
        snapshot.updatedAtUtc = new Date().toISOString()
        this.publish(snapshot as AnyBackgroundJobSnapshot)
        context.throwIfCancellationRequested()
        return operation(context)
      })
      .then((value) => {
        const canceled = snapshot.status === 'canceled'
        if (!canceled) {
          snapshot.stage = definition.completedStage
          snapshot.status = 'succeeded'
        }
        snapshot.progress = normalizeProgress(snapshot.progress, canceled ? {} : {
          completed: snapshot.progress.total ?? snapshot.progress.completed,
          percent: 100
        })
        snapshot.cancellation.canCancel = false
        snapshot.cancellation.boundary = null
        snapshot.result = canceled ? null : boundedResult(result(value))
        snapshot.completedAtUtc = new Date().toISOString()
        snapshot.updatedAtUtc = snapshot.completedAtUtc
        this.settle(definition.dedupeKey, snapshot as AnyBackgroundJobSnapshot)
        return value
      })
      .catch((error: unknown) => {
        const canceled = error instanceof BackgroundJobCanceledError
        snapshot.stage = canceled ? definition.canceledStage : definition.failedStage
        snapshot.status = canceled ? 'canceled' : 'failed'
        snapshot.cancellation.canCancel = false
        snapshot.cancellation.boundary = null
        snapshot.error = canceled ? null : presentError(error)
        snapshot.completedAtUtc = new Date().toISOString()
        snapshot.updatedAtUtc = snapshot.completedAtUtc
        this.settle(definition.dedupeKey, snapshot as AnyBackgroundJobSnapshot)
        throw error
      })
    return { id, correlationId: snapshot.correlationId, coalesced: false, result: active.result }
  }

  private settle(dedupeKey: string, snapshot: AnyBackgroundJobSnapshot): void {
    if (this.activeByKey.get(dedupeKey) === snapshot.id) this.activeByKey.delete(dedupeKey)
    this.publish(snapshot)
    const terminal = [...this.jobs.values()]
      .filter(({ snapshot: candidate }) => !['queued', 'running'].includes(candidate.status))
      .sort((left, right) => right.snapshot.updatedAtUtc.localeCompare(left.snapshot.updatedAtUtc))
    for (const expired of terminal.slice(TERMINAL_RETENTION)) this.jobs.delete(expired.snapshot.id)
  }

  private publish(snapshot: AnyBackgroundJobSnapshot): void {
    const copy = structuredClone(snapshot)
    for (const listener of this.listeners) {
      try {
        listener(copy)
      } catch {
        // Progress delivery is best-effort. A renderer/listener failure must not
        // strand the job or its dedupe key in the coordinator.
      }
    }
  }
}

export async function runGlobalRollHydration<
  T extends { processed: number; pending: number },
  R
>(
  jobs: BackgroundJobCoordinator,
  operation: (context: BackgroundJobContext<'roll-hydration'>) => Promise<T>,
  projectForCaller: (result: T) => Promise<R> | R
): Promise<R> {
  const shared = jobs.run({
    kind: 'roll-hydration',
    dedupeKey: 'roll-hydration:all-modes',
    stage: 'queued',
    progress: {
      completed: 0,
      total: null,
      percent: null,
      unit: 'items',
      label: 'Rate archived item rolls',
      detail: 'Preparing bounded analysis batches.'
    },
    canCancel: true,
    supportsCancellation: true,
    boundary: 'before the next analysis batch',
    completedStage: 'complete',
    failedStage: 'failed',
    canceledStage: 'canceled'
  }, operation, (result) => ({
    summary: 'Archived roll hydration settled.',
    metrics: { processed: result.processed, pending: result.pending }
  }))
  return projectForCaller(await shared.result)
}

export class TrailingJobQueue<T> {
  private active: Promise<void> | null = null
  private trailing: T | null = null
  private readonly operation: (value: T) => Promise<void>
  private readonly merge: (current: T, incoming: T) => T

  constructor(
    operation: (value: T) => Promise<void>,
    merge: (current: T, incoming: T) => T = (_current, incoming) => incoming
  ) {
    this.operation = operation
    this.merge = merge
  }

  enqueue(value: T): void {
    if (this.active) {
      this.trailing = this.trailing === null ? value : this.merge(this.trailing, value)
      return
    }
    this.active = this.drain(value)
  }

  async flush(): Promise<void> {
    while (this.active) await this.active
  }

  private async drain(initial: T): Promise<void> {
    let current: T | null = initial
    try {
      while (current !== null) {
        await this.operation(current)
        current = this.trailing
        this.trailing = null
      }
    } finally {
      this.active = null
      if (this.trailing !== null) {
        const trailing = this.trailing
        this.trailing = null
        this.enqueue(trailing)
      }
    }
  }
}
