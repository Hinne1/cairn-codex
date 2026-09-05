export const HELPER_PROTOCOL_VERSION = 1
export const HELPER_CAPABILITIES = ['json-line-v1', 'live-lane-v1', 'worker-lane-v1'] as const

export interface HelperMethodPolicy { lane: 'live' | 'worker'; mutates: boolean }
const workerRead = { lane: 'worker', mutates: false } as const
const workerWrite = { lane: 'worker', mutates: true } as const
const liveRead = { lane: 'live', mutates: false } as const
const liveWrite = { lane: 'live', mutates: true } as const

/** Every method is reviewed explicitly, including writes to disposable files. */
export const HELPER_METHODS = {
  health: liveRead,
  'measure-memory': workerRead,
  'discover-grim-dawn': workerRead,
  'discover-grim-dawn-at': workerRead,
  'inspect-content-packs': workerRead,
  'list-characters': workerRead,
  'build-item-catalog': workerRead,
  'simulate-dismantling': workerRead,
  'resolve-archive-items': workerRead,
  'inspect-game-record': workerRead,
  'inspect-game-records': workerRead,
  'inspect-set-presentations': workerRead,
  'inspect-archive-text': workerRead,
  'build-map-location-index': workerRead,
  'extract-item-icons': workerWrite,
  'scan-collection': workerRead,
  'scan-transfer-stash': workerRead,
  'inspect-write-safety': workerRead,
  'inspect-live-game': liveRead,
  'approve-live-game-build': liveWrite,
  'start-live-game': liveWrite,
  'stop-live-game': liveWrite,
  'poll-live-incoming': liveRead,
  'copy-live-incoming': liveWrite,
  'ack-live-incoming': liveWrite,
  'enqueue-live-retrieval': liveWrite,
  'inspect-live-retrieval': liveRead,
  'self-test-write-transaction': workerWrite,
  'self-test-live-queue': liveWrite,
  'self-test-dismantling': workerRead,
  'self-test-acquisition': workerRead,
  'self-test-item-presentation': workerRead,
  'self-test-roll-ratings': workerRead,
  'validate-transfer-stash-roundtrip': workerRead,
  'validate-ingest-plan': workerRead,
  'plan-ingest-items': workerRead,
  'commit-ingest-items': workerWrite,
  'plan-retrieve-items': workerRead,
  'commit-retrieve-items': workerWrite,
  'validate-ingest-retrieval-roundtrip': workerRead,
  'analyze-item-rolls': workerRead
} satisfies Record<string, HelperMethodPolicy>

export class HelperRequestError extends Error {
  readonly code: string
  readonly uncertain: boolean
  constructor(code: string, message: string, uncertain = false) {
    super(message)
    this.name = 'HelperRequestError'
    this.code = code
    this.uncertain = uncertain
  }
}

export function helperMethodPolicy(method: string): HelperMethodPolicy {
  if (!Object.hasOwn(HELPER_METHODS, method)) {
    throw new HelperRequestError('HELPER_METHOD_UNSUPPORTED', 'The helper method is not supported.')
  }
  return HELPER_METHODS[method as keyof typeof HELPER_METHODS]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export type HelperResponse =
  | { id: string; result: unknown; error?: undefined }
  | { id: string; error: { code: string; message: string } }

export function parseHelperResponse(line: string): HelperResponse {
  let value: unknown
  try { value = JSON.parse(line) } catch { /* Never report the raw line. */ }
  const invalid = (): never => {
    throw new HelperRequestError('HELPER_PROTOCOL_INVALID', 'The helper returned an invalid protocol response.')
  }
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[1-9]\d{0,15}$/.test(value.id)) return invalid()
  // C# includes the inactive branch as null; omitted inactive fields are also valid.
  if (value.error !== undefined && value.error !== null) {
    if (!isRecord(value.error) || typeof value.error.code !== 'string' ||
        value.error.code.length === 0 || value.error.code.length > 128 ||
        typeof value.error.message !== 'string' || value.error.message.length > 4096 ||
        (value.result !== undefined && value.result !== null)) return invalid()
    return { id: value.id, error: { code: value.error.code, message: value.error.message } }
  }
  if (!Object.hasOwn(value, 'result')) return invalid()
  return { id: value.id, result: value.result }
}

export function validateHelperHealth(value: unknown): void {
  const capabilities = isRecord(value) ? value.capabilities : undefined
  if (!isRecord(value) || value.service !== 'CairnCodex.GrimDawn' ||
      value.protocolVersion !== HELPER_PROTOCOL_VERSION || !Array.isArray(capabilities) ||
      !HELPER_CAPABILITIES.every(capability => capabilities.includes(capability))) {
    throw new HelperRequestError('HELPER_PROTOCOL_UNSUPPORTED', 'The helper protocol or capabilities are incompatible with this application.')
  }
}
