export const BACKGROUND_JOB_KINDS = [
  'collection-scan',
  'game-data-rebuild',
  'roll-hydration',
  'item-assistant-import',
  'archive-backup',
  'icon-extraction',
  'map-indexing'
] as const

export type BackgroundJobKind = typeof BACKGROUND_JOB_KINDS[number]

export interface BackgroundJobStageByKind {
  'collection-scan': 'queued' | 'scanning' | 'persisting' | 'complete' | 'failed' | 'canceled'
  'game-data-rebuild': 'queued' | 'scanning' | 'persisting' | 'complete' | 'failed' | 'canceled'
  'roll-hydration': 'queued' | 'analyzing' | 'persisting' | 'complete' | 'failed' | 'canceled'
  'item-assistant-import':
    | 'queued'
    | 'selecting'
    | 'analyzing'
    | 'awaiting-confirmation'
    | 'verifying'
    | 'backing-up'
    | 'reading'
    | 'importing'
    | 'finalizing'
    | 'complete'
    | 'failed'
    | 'canceled'
  'archive-backup': 'queued' | 'checkpointing' | 'copying' | 'verifying' | 'complete' | 'failed' | 'canceled'
  'icon-extraction': 'queued' | 'extracting' | 'complete' | 'failed' | 'canceled'
  'map-indexing': 'queued' | 'indexing' | 'persisting' | 'complete' | 'failed' | 'canceled'
}

export type BackgroundJobStage<K extends BackgroundJobKind = BackgroundJobKind> =
  K extends BackgroundJobKind ? BackgroundJobStageByKind[K] : never

export type BackgroundJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
export type BackgroundJobProgressUnit = 'items' | 'files' | 'steps' | 'bytes'

export interface BackgroundJobProgress {
  completed: number
  total: number | null
  percent: number | null
  unit: BackgroundJobProgressUnit
  label: string
  detail: string
}

export interface BackgroundJobResult {
  summary: string
  metrics: Record<string, string | number | boolean | null>
}

export interface BackgroundJobError {
  code: string
  message: string
  retriable: boolean
}

export interface BackgroundJobCancellation {
  supported: boolean
  requested: boolean
  canCancel: boolean
  boundary: string | null
}

export interface BackgroundJobSnapshot<K extends BackgroundJobKind = BackgroundJobKind> {
  id: string
  correlationId: string
  kind: K
  dedupeKey: string
  stage: BackgroundJobStage<K>
  status: BackgroundJobStatus
  progress: BackgroundJobProgress
  cancellation: BackgroundJobCancellation
  result: BackgroundJobResult | null
  error: BackgroundJobError | null
  startedAtUtc: string
  updatedAtUtc: string
  completedAtUtc: string | null
  persistence: {
    navigation: 'main-process-session'
    restart: 'discard-in-flight'
  }
}

export type AnyBackgroundJobSnapshot = {
  [K in BackgroundJobKind]: BackgroundJobSnapshot<K>
}[BackgroundJobKind]

export function backgroundJobPercent(completed: number, total: number | null): number | null {
  if (total === null || total <= 0) return null
  return Math.min(100, Math.max(0, Math.round((completed / total) * 100)))
}
