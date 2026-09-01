import {
  IPC_ERROR_SCHEMA_VERSION,
  type IpcErrorDomain,
  type IpcErrorKind,
  type IpcErrorPayload
} from '../../shared/ipc-error-transport.ts'

export type { IpcErrorDomain, IpcErrorKind, IpcErrorPayload } from '../../shared/ipc-error-transport.ts'

export interface IpcFailureTransport {
  ok: false
  error: IpcErrorPayload
}

interface ErrorRule {
  code: string
  message: string
  matches: RegExp
  retryable?: boolean
  uncertain?: boolean
  sourceCodes?: readonly string[]
}

interface DomainErrorPolicy {
  fallbackMessage: string
  validation: readonly ErrorRule[]
  known: readonly ErrorRule[]
}

const validation = (code: string, message: string, matches: RegExp): ErrorRule => ({
  code,
  message,
  matches
})

const known = (
  code: string,
  message: string,
  matches: RegExp,
  options: Pick<ErrorRule, 'retryable' | 'uncertain' | 'sourceCodes'> = {}
): ErrorRule => ({ code, message, matches, ...options })

const policies: Record<IpcErrorDomain, DomainErrorPolicy> = {
  'background-jobs': {
    fallbackMessage: 'The background-job operation failed safely.',
    validation: [
      validation('background-jobs.invalid-id', 'Choose a valid background job.', /valid background job ID is required/i)
    ],
    known: [
      known('background-jobs.not-found', 'That background job is no longer available.', /background job.*(?:not found|no longer available)/i)
    ]
  },
  archive: {
    fallbackMessage: 'The archive operation failed safely.',
    validation: [
      validation('archive.invalid-stash-path', 'Choose a valid transfer stash.', /valid stash path is required/i),
      validation('archive.invalid-mode', 'Choose a valid archive mode.', /archive mode is outside its safe bounds/i),
      validation('archive.invalid-page', 'The archive page request is invalid.', /valid vault (?:state|sort|sort direction)|vault (?:filters|paging parameters).*safe bounds|requested vault rarity is not supported/i),
      validation('archive.invalid-history-page', 'The archive history request is invalid.', /valid operation-history (?:kind|outcome)|operation-history (?:query|paging parameters).*safe bounds/i),
      validation('archive.invalid-selection', 'Choose a valid set of archive items.', /vault item selection is outside its safe bounds|duplicate dismantling candidate IDs/i)
    ],
    known: [
      known('archive.recovery-required', 'Resolve pending transfer recovery before changing the archive.', /transfer operations? require recovery attention|require recovery attention/i),
      known('archive.item-unavailable', 'One or more requested archive items are no longer available.', /vault item (?:does not exist|is not available|is not pending retrieval)|vault items are not available|archive copy is not eligible/i),
      known('archive.staging-not-ready', 'The transfer stash is not ready for this archive operation.', /final stash tab (?:is empty|must be empty)|selected transfer stash has no tabs|nothing staged for ingest/i),
      known('archive.mode-mismatch', 'Hardcore and Softcore archive items cannot be combined in one operation.', /cannot mix Hardcore and Softcore|running character is (?:Hardcore|Softcore).*selection is/i),
      known('archive.integrity-check-failed', 'The archive operation stopped because an integrity check failed.', /(?:ingest|retrieval|archive).*(?:hash|invariant|verification|persisted plan)|prepared (?:ingest|retrieval|operation) journal entry/i)
    ]
  },
  imports: {
    fallbackMessage: 'The Item Assistant import failed safely; the source was not changed.',
    validation: [],
    known: [
      known('imports.collection-not-ready', 'Let CC finish its initial game-data scan before importing Item Assistant.', /finish its initial game-data scan/i, { retryable: true }),
      known('imports.source-changed', 'Item Assistant changed after analysis. Close it and analyze the source again.', /(?:Item Assistant|GDIA).*(?:database|pending queue).*changed|SQLite state/i, { retryable: true }),
      known('imports.insufficient-space', 'There is not enough free space to complete the verified import.', /not enough free space|available space dropped below.*reserve/i, { retryable: true }),
      known('imports.backup-verification-failed', 'The Item Assistant source backup could not be verified, so import was stopped.', /(?:backup|queue receipt batch).*(?:failed verification|publication verification)|current GDIA recovery backup was not verified/i),
      known('imports.unsupported-source', 'The selected Item Assistant data contains an unsupported queue receipt.', /unsupported GDIA queue receipt format/i),
      known('imports.reserve-invalid', 'The import size could not be represented safely.', /import reserve exceeds safe byte accounting/i),
      known('imports.mode-mismatch', 'The selected Item Assistant source contains items from an unexpected game mode.', /expected a Hardcore-only GDIA migration/i)
    ]
  },
  collection: {
    fallbackMessage: 'The collection operation failed safely.',
    validation: [
      validation('collection.invalid-scan', 'The collection scan request is invalid.', /collection (?:scan input|source paths).*safe bounds/i),
      validation('collection.invalid-pinned-copy', 'The pinned-copy request is invalid.', /pinned-copy input is outside its safe bounds/i),
      validation('collection.invalid-setting', 'The collection setting is invalid.', /infinite supplies.*(?:boolean|enabled|disabled|explicit)/i)
    ],
    known: [
      known('collection.installation-unavailable', 'No Grim Dawn installation is available.', /no Grim Dawn installation is available|Grim Dawn installation was not discovered/i, { retryable: true }),
      known('collection.archive-unavailable', 'The collection archive is unavailable or failed its integrity check.', /SQLite quick_check failed|selected file is not .* archive|archive database is busy|archive storage footprint is too large/i),
      known('collection.source-unavailable', 'A configured collection source could not be read.', /observed item references an unknown stash|non-empty stash has no observed item/i),
      known('collection.index-not-ready', 'Build the game-data index before using this collection feature.', /build the game-data index before/i, { retryable: true }),
      known('collection.scan-failed', 'The collection scan could not be completed.', /collection scan did not|read-only character loading did not validate/i, { retryable: true })
    ]
  },
  'live-transfers': {
    fallbackMessage: 'The live transfer failed safely. Check recovery status before retrying.',
    validation: [
      validation('live-transfers.invalid-request', 'The live transfer request is invalid.', /transfer input is outside its safe bounds|special-item recovery input is outside its safe bounds|supply delivery input is outside its safe bounds|vault item selection is outside its safe bounds/i)
    ],
    known: [
      known('live-transfers.disabled', 'Live transfers are currently disabled.', /live transfers are disabled/i),
      known('live-transfers.prerequisite-missing', 'Install the bundled Microsoft Visual C++ x64 prerequisite before using live transfers.', /Microsoft Visual C\+\+.*Redistributable.*required.*live adapter/i, { retryable: true }),
      known('live-transfers.adapter-missing', 'The native live adapter is missing. Repair or reinstall Cairn Codex, then review Windows Security Protection history.', /live adapter is incomplete: missing .*Protection history/i),
      known('live-transfers.safety-gate', 'The live transfer safety check refused permission.', /write safety gate refused permission|unsupported.*(?:game|hook|injector|helper).*(?:hash|build|version)/i),
      known('live-transfers.recovery-required', 'A previous transfer needs recovery attention before another transfer can start.', /require recovery attention|pending live queue/i),
      known('live-transfers.game-not-ready', 'Grim Dawn is not ready for a live transfer.', /live game.*not ready|game is not ready|hook.*not (?:ready|available|connected)/i, { retryable: true }),
      known('live-transfers.character-mismatch', 'The active character or game mode changed. Review it before retrying.', /active character changed|could not identify the active character|could not resolve whether|both Hardcore and Softcore saves|running character is (?:Hardcore|Softcore).*selection is|active character .*not found in the parsed saves/i, { retryable: true }),
      known('live-transfers.item-unavailable', 'One or more selected items are not available for transfer.', /vault item (?:does not exist|is not available)|vault items are not available|selected record is not a catalogued|has no verified faction-vendor requirement|cannot buy/i),
      known('live-transfers.destination-full', 'The in-game destination is full. No rejected item was lost.', /(?:inventory|stash|deposit tab).*full|game rejected.*because.*full|No augments were delivered/i, { retryable: true }),
      known('live-transfers.receipt-missing', 'Grim Dawn did not return a durable transfer receipt. Recovery is required.', /rejected.*without returning a durable queue receipt/i, { uncertain: true }),
      known('live-transfers.outcome-uncertain', 'Transfer acknowledgement timed out. Do not retry until recovery resolves the pending operation.', /timed out waiting for (?:Grim Dawn|the live hook)/i, {
        uncertain: true,
        sourceCodes: ['live-transfer.outcome-uncertain']
      })
    ]
  },
  diagnostics: {
    fallbackMessage: 'The diagnostics operation failed safely.',
    validation: [
      validation('diagnostics.invalid-debug-setting', 'Choose a valid debug-logging setting.', /debug logging.*(?:boolean|enabled or disabled explicitly)/i),
      validation('diagnostics.invalid-navigation', 'The workspace navigation event is invalid.', /unknown workspace navigation event/i),
      validation('diagnostics.invalid-renderer-report', 'The renderer error report is invalid.', /renderer error report is outside its safe bounds/i),
      validation('diagnostics.invalid-preference-report', 'The preference report is invalid.', /preference-load diagnostics are outside their safe bounds/i),
      validation('diagnostics.invalid-preference-export', 'The preference export is invalid.', /preference export (?:is outside its safe bounds|is not valid JSON|has an unsupported schema version)/i)
    ],
    known: [
      known('diagnostics.privacy-check-failed', 'The support bundle failed its privacy check and was not written.', /support bundle failed its privacy check/i),
      known('diagnostics.recovery-check-failed', 'Transfer recovery status could not be determined safely.', /reconcil.*(?:recovery|transfer)|recovery operation.*(?:missing|invalid)/i),
      known('diagnostics.export-unavailable', 'The support bundle could not be written to the selected location.', /(?:EACCES|EPERM|permission denied|access is denied|read-only file system)/i, { retryable: true })
    ]
  },
  backups: {
    fallbackMessage: 'The archive backup operation failed safely.',
    validation: [],
    known: [
      known('backups.recovery-required', 'Resolve pending transfer recovery before restoring an archive backup.', /transfer operations? require recovery attention|require recovery attention/i),
      known('backups.source-changed', 'The selected backup changed, so restore was canceled.', /staged archive restore changed after it was selected/i, { retryable: true }),
      known('backups.verification-failed', 'Archive backup verification failed, so no unverified replacement was used.', /staged archive failed verification|exported archive did not match its verified source|restore did not recover|backup rotation or verification metadata failed/i),
      known('backups.checkpoint-failed', 'The archive could not be checkpointed safely for backup.', /archive could not be checkpointed|archive database is busy.*checkpointed/i, { retryable: true }),
      known('backups.invalid-source', 'The selected file is not a verified CC archive backup.', /selected file is not .* archive database|SQLite quick_check failed/i),
      known('backups.storage-unavailable', 'The backup location is unavailable or does not have enough safe capacity.', /archive storage footprint is too large|EACCES|EPERM|permission denied|access is denied|read-only file system|ENOSPC/i, { retryable: true })
    ]
  },
  'window-lifecycle': {
    fallbackMessage: 'The application lifecycle operation failed safely.',
    validation: [
      validation('window-lifecycle.invalid-startup-phase', 'The startup phase event is invalid.', /unknown startup phase event/i),
      validation('window-lifecycle.invalid-zoom', 'The requested zoom factor is invalid.', /zoom factor is outside its safe bounds/i)
    ],
    known: [
      known('window-lifecycle.data-directory-unavailable', 'The CC data directory could not be opened.', /(?:open|show).*(?:data|user-data) directory|EACCES|EPERM|permission denied|access is denied/i, { retryable: true }),
      known('window-lifecycle.restart-failed', 'CC could not restart safely.', /(?:restart|relaunch).*(?:failed|could not)|failed to (?:restart|relaunch)/i, { retryable: true }),
      known('window-lifecycle.shutdown-failed', 'CC could not finish managed shutdown.', /(?:shutdown|flush).*(?:failed|failure)|simulated flush failure/i, { retryable: true }),
      known('window-lifecycle.window-unavailable', 'The main window could not be restored.', /(?:create|restore|focus|show).*(?:window).*(?:failed|unavailable)/i, { retryable: true })
    ]
  }
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return ''
  try {
    return typeof error.message === 'string' ? error.message : ''
  } catch {
    return ''
  }
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return ''
  try {
    if (!('code' in error)) return ''
    const code: unknown = error.code
    return typeof code === 'string' ? code : ''
  } catch {
    return ''
  }
}

function matchRule(rules: readonly ErrorRule[], message: string): ErrorRule | undefined {
  return rules.find((rule) => rule.matches.test(message))
}

function payload(domain: IpcErrorDomain, kind: IpcErrorKind, rule: ErrorRule): IpcErrorPayload {
  return {
    schemaVersion: IPC_ERROR_SCHEMA_VERSION,
    domain,
    kind,
    code: rule.code,
    message: rule.message,
    retryable: rule.retryable ?? false,
    uncertain: rule.uncertain ?? false
  }
}

/** Classify an ordinary production error without exposing its message or stack. */
export function classifyIpcDomainError(domain: IpcErrorDomain, error: unknown): IpcErrorPayload {
  const policy = policies[domain]
  const message = errorMessage(error)
  const code = errorCode(error)
  const codedKnownRule = policy.known.find((rule) => rule.sourceCodes?.includes(code))
  if (codedKnownRule) return payload(domain, 'known', codedKnownRule)

  const validationRule = matchRule(policy.validation, message)
  if (validationRule) return payload(domain, 'validation', validationRule)

  const knownRule = matchRule(policy.known, message)
  if (knownRule) return payload(domain, 'known', knownRule)

  return {
    schemaVersion: IPC_ERROR_SCHEMA_VERSION,
    domain,
    kind: 'unknown',
    code: `${domain}.failed`,
    message: policy.fallbackMessage,
    retryable: false,
    uncertain: false
  }
}

/** Build the serializable failure envelope returned by an IPC handler. */
export function toIpcFailureTransport(domain: IpcErrorDomain, error: unknown): IpcFailureTransport {
  return {
    ok: false,
    error: classifyIpcDomainError(domain, error)
  }
}
