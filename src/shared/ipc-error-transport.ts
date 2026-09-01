export const IPC_ERROR_SCHEMA_VERSION = 1 as const

export type IpcErrorDomain =
  | 'background-jobs'
  | 'archive'
  | 'imports'
  | 'collection'
  | 'live-transfers'
  | 'diagnostics'
  | 'backups'
  | 'window-lifecycle'

export type IpcErrorKind = 'validation' | 'known' | 'unknown'

/** Redacted plain data that is safe to structured-clone or JSON serialize. */
export interface IpcErrorPayload {
  schemaVersion: typeof IPC_ERROR_SCHEMA_VERSION
  domain: IpcErrorDomain
  kind: IpcErrorKind
  code: string
  message: string
  retryable: boolean
  uncertain: boolean
}

const IPC_ERROR_MESSAGE_MARKER = '__CAIRN_CODEX_IPC_ERROR__:'
const domains: readonly IpcErrorDomain[] = [
  'background-jobs',
  'archive',
  'imports',
  'collection',
  'live-transfers',
  'diagnostics',
  'backups',
  'window-lifecycle'
]
const kinds: readonly IpcErrorKind[] = ['validation', 'known', 'unknown']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIpcErrorPayload(value: unknown): value is IpcErrorPayload {
  if (!isRecord(value)) return false
  return value.schemaVersion === IPC_ERROR_SCHEMA_VERSION &&
    typeof value.domain === 'string' && domains.includes(value.domain as IpcErrorDomain) &&
    typeof value.kind === 'string' && kinds.includes(value.kind as IpcErrorKind) &&
    typeof value.code === 'string' && value.code.length > 0 &&
    typeof value.message === 'string' && value.message.length > 0 &&
    typeof value.retryable === 'boolean' &&
    typeof value.uncertain === 'boolean'
}

/** Encode a redacted payload in the only Error field Electron reliably transports. */
export function encodeIpcErrorMessage(payload: IpcErrorPayload): string {
  return `${IPC_ERROR_MESSAGE_MARKER}${JSON.stringify(payload)}`
}

/** Decode both a direct main-process message and Electron's renderer-side prefix. */
export function decodeIpcErrorMessage(message: string): IpcErrorPayload | null {
  const markerIndex = message.lastIndexOf(IPC_ERROR_MESSAGE_MARKER)
  if (markerIndex < 0) return null

  try {
    const parsed: unknown = JSON.parse(message.slice(markerIndex + IPC_ERROR_MESSAGE_MARKER.length))
    if (!isIpcErrorPayload(parsed)) return null
    return {
      schemaVersion: IPC_ERROR_SCHEMA_VERSION,
      domain: parsed.domain,
      kind: parsed.kind,
      code: parsed.code,
      message: parsed.message,
      retryable: parsed.retryable,
      uncertain: parsed.uncertain
    }
  } catch {
    return null
  }
}

/** Typed renderer/preload representation of a redacted main-process failure. */
export class IpcClientError extends Error {
  readonly schemaVersion: typeof IPC_ERROR_SCHEMA_VERSION
  readonly domain: IpcErrorDomain
  readonly kind: IpcErrorKind
  readonly code: string
  readonly retryable: boolean
  readonly uncertain: boolean

  constructor(payload: IpcErrorPayload) {
    super(payload.message)
    this.name = 'IpcClientError'
    this.schemaVersion = payload.schemaVersion
    this.domain = payload.domain
    this.kind = payload.kind
    this.code = payload.code
    this.retryable = payload.retryable
    this.uncertain = payload.uncertain
  }
}

/** Convert an Electron invoke rejection when it contains a valid IPC envelope. */
export function decodeIpcError(error: unknown): IpcClientError | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : null
  if (message === null) return null
  const payload = decodeIpcErrorMessage(message)
  return payload ? new IpcClientError(payload) : null
}
