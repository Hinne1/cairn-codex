import { randomUUID } from 'node:crypto'
import type { LiveGameStatus, LiveRetrievalResult, VaultItemState } from '../../shared/contracts.ts'
import { SerializedServiceQueue } from './service-registry.ts'

export interface LiveTransferVaultItem {
  id: string
  baseRecord: string
  seed: number
  isHardcore: boolean
  state: VaultItemState
  payload: unknown
}

export interface LiveTransferQueue {
  operationId: string
  outgoingPath: string
  semanticSha256: string
  isHardcore: boolean
  baselineDeleted: string[]
  baselineIncoming: string[]
}

export interface LiveTransferQueueStatus {
  state: 'pending' | 'deposited' | 'rejected' | 'unknown'
  receiptPath: string | null
}

export interface LiveTransferJournal {
  readVaultItems(vaultItemIds: readonly string[], isHardcore: boolean): LiveTransferVaultItem[]
  prepareRetrieval(input: {
    operationId: string
    stashPath: string
    sourceIdentity: string
    startedAtUtc: string
    vaultItemIds: string[]
    detail: Record<string, unknown>
  }): void
  updatePendingDetail(operationId: string, detail: Record<string, unknown>): void
  completeRetrieval(input: {
    operationId: string
    vaultItemIds: string[]
    receiptPaths: string[]
    completedAtUtc: string
    detail: Record<string, unknown>
  }): void
  completePartialRetrieval(input: {
    operationId: string
    depositedVaultItemIds: string[]
    rejectedVaultItemIds: string[]
    receiptPaths: string[]
    completedAtUtc: string
    detail: Record<string, unknown>
  }): void
  failRetrieval(operationId: string, vaultItemIds: readonly string[], error: unknown): void
  markRetrievalNeedsRecovery(operationId: string, error: unknown): void
}

export interface LiveTransferAdapter {
  inspectGame(): Promise<LiveGameStatus>
  enqueueRetrieval(input: {
    operationId: string
    isHardcore: boolean
    item: unknown
  }): Promise<LiveTransferQueue>
  inspectRetrieval(queue: LiveTransferQueue): Promise<LiveTransferQueueStatus>
  copyRejectedReceipt(input: {
    path: string
    expectedSha256: string
  }): Promise<{ receiptPath: string }>
  acknowledgeRejectedReceipt(input: {
    path: string
    expectedSha256: string
  }): Promise<void>
}

export interface LiveTransferRecovery {
  reconcile(): Promise<void>
  unresolvedCount(): number
}

export interface LiveTransferClock {
  now(): number
  wait(milliseconds: number): Promise<void>
  operationId(): string
}

export interface LiveTransferServiceDependencies {
  journal: LiveTransferJournal
  adapter: LiveTransferAdapter
  recovery: LiveTransferRecovery
  clock?: LiveTransferClock
  timeoutMs?: number
  pollIntervalMs?: number
}

export class LiveTransferServiceError extends Error {
  readonly code: string

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LiveTransferServiceError'
    this.code = code
  }
}

const systemClock: LiveTransferClock = {
  now: () => Date.now(),
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  operationId: () => randomUUID()
}

function transferError(error: unknown, code: string, fallback: string): LiveTransferServiceError {
  if (error instanceof LiveTransferServiceError) return error
  return new LiveTransferServiceError(
    error instanceof Error ? error.message : fallback,
    code,
    { cause: error }
  )
}

/**
 * Live retrieval policy independent of Electron and native implementations.
 * Once enqueue is attempted, every failure remains a recovery operation until
 * durable terminal receipts prove the outcome.
 */
export class LiveTransferDomainService {
  private readonly dependencies: LiveTransferServiceDependencies
  private readonly clock: LiveTransferClock
  private readonly timeoutMs: number
  private readonly pollIntervalMs: number
  private readonly writes = new SerializedServiceQueue()
  private readonly inFlight = new Map<string, Promise<LiveRetrievalResult>>()

  constructor(dependencies: LiveTransferServiceDependencies) {
    this.dependencies = dependencies
    this.clock = dependencies.clock ?? systemClock
    this.timeoutMs = dependencies.timeoutMs ?? 45_000
    this.pollIntervalMs = dependencies.pollIntervalMs ?? 250
    if (this.timeoutMs <= 0 || this.pollIntervalMs <= 0) {
      throw new Error('Live transfer timing bounds must be positive.')
    }
  }

  retrieveVaultItems(vaultItemIds: readonly string[]): Promise<LiveRetrievalResult> {
    const requestedIds = [...vaultItemIds]
    if (requestedIds.length === 0) {
      return Promise.reject(new LiveTransferServiceError(
        'Select at least one vault item to retrieve.',
        'live-transfer.selection-empty'
      ))
    }
    if (new Set(requestedIds).size !== requestedIds.length) {
      return Promise.reject(new LiveTransferServiceError(
        'The live retrieval selection contains a duplicate archive item.',
        'live-transfer.selection-duplicate'
      ))
    }
    const submissionKey = [...requestedIds].sort().join('\0')
    const existing = this.inFlight.get(submissionKey)
    if (existing) return existing

    const result = this.writes.run(() => this.executeRetrieval(requestedIds))
    this.inFlight.set(submissionKey, result)
    void result.then(
      () => this.inFlight.delete(submissionKey),
      () => this.inFlight.delete(submissionKey)
    )
    return result
  }

  flush(): Promise<void> {
    return this.writes.flush()
  }

  private async executeRetrieval(vaultItemIds: string[]): Promise<LiveRetrievalResult> {
    await this.dependencies.recovery.reconcile()
    const unresolved = this.dependencies.recovery.unresolvedCount()
    if (unresolved > 0) {
      throw new LiveTransferServiceError(
        `${unresolved} earlier transfer operation${unresolved === 1 ? '' : 's'} require recovery attention. ` +
          'Pause writes and audit the retained journal and receipts first.',
        'live-transfer.recovery-required'
      )
    }

    const softcore = this.dependencies.journal.readVaultItems(vaultItemIds, false)
    const hardcore = this.dependencies.journal.readVaultItems(vaultItemIds, true)
    if (softcore.length + hardcore.length !== vaultItemIds.length) {
      throw new LiveTransferServiceError(
        'A selected vault item does not exist.',
        'live-transfer.item-missing'
      )
    }
    if (softcore.length > 0 && hardcore.length > 0) {
      throw new LiveTransferServiceError(
        'A live retrieval cannot mix Hardcore and Softcore items.',
        'live-transfer.mode-mismatch'
      )
    }
    const selected = softcore.length > 0 ? softcore : hardcore
    const isHardcore = selected[0]!.isHardcore
    if (selected.some((item) => item.isHardcore !== isHardcore)) {
      throw new LiveTransferServiceError(
        'A live retrieval cannot mix Hardcore and Softcore items.',
        'live-transfer.mode-mismatch'
      )
    }
    const unavailable = selected.filter((item) => item.state !== 'ingested')
    if (unavailable.length > 0) {
      throw new LiveTransferServiceError(
        'Vault items are not available: ' + unavailable.map((item) => item.id).join(', '),
        'live-transfer.item-unavailable'
      )
    }

    const status = await this.dependencies.adapter.inspectGame()
    if (status.state !== 'ready') {
      throw new LiveTransferServiceError(status.detail, 'live-transfer.game-not-ready')
    }
    if (status.isHardcore !== null && status.isHardcore !== isHardcore) {
      throw new LiveTransferServiceError(
        `The running character is ${status.isHardcore ? 'Hardcore' : 'Softcore'}, but the selection is ` +
          `${isHardcore ? 'Hardcore' : 'Softcore'}.`,
        'live-transfer.mode-mismatch'
      )
    }

    const operationId = this.clock.operationId()
    let prepared = false
    let enqueueAttempted = false
    try {
      this.dependencies.journal.prepareRetrieval({
        operationId,
        stashPath: `live://gdia/${isHardcore ? 'hc' : 'sc'}`,
        sourceIdentity: selected.map((item) => `${item.id}:${item.seed}`).join('|'),
        startedAtUtc: new Date(this.clock.now()).toISOString(),
        vaultItemIds,
        detail: { phase: 'prepared', adapter: 'gdia-live-v1', vaultItemIds, dispatchComplete: false }
      })
      prepared = true

      const queues: LiveTransferQueue[] = []
      for (const [index, item] of selected.entries()) {
        const requestedOperationId = `${operationId}-${index}`
        const dispatch = {
          operationId: requestedOperationId,
          isHardcore,
          item: item.payload
        }
        this.dependencies.journal.updatePendingDetail(operationId, { pendingDispatch: dispatch })
        enqueueAttempted = true
        const queue = await this.dependencies.adapter.enqueueRetrieval(dispatch)
        this.assertQueue(queue, requestedOperationId, isHardcore)
        queues.push(queue)
        this.dependencies.journal.updatePendingDetail(operationId, {
          phase: 'queued',
          pendingDispatch: null,
          queues: queues.map((entry) => ({ ...entry }))
        })
      }
      this.dependencies.journal.updatePendingDetail(operationId, { dispatchComplete: true })

      const terminal = await this.awaitTerminalReceipts(queues)
      this.dependencies.journal.updatePendingDetail(operationId, {
        phase: 'terminal-receipts-verified',
        recoveryResolution: {
          recordedAtUtc: new Date(this.clock.now()).toISOString(),
          entries: terminal.map((entry, index) => ({
            operationId: queues[index]!.operationId,
            state: entry.state,
            receiptPath: entry.receiptPath,
            semanticSha256: queues[index]!.semanticSha256,
            copiedReceiptPath: null
          }))
        }
      })

      const outcomes = terminal.map((entry, index) => ({
        ...entry,
        item: selected[index]!,
        queue: queues[index]!
      }))
      const deposited = outcomes.filter((entry) => entry.state === 'deposited')
      const rejected = outcomes.filter((entry) => entry.state === 'rejected')
      const copiedRejectedReceipts = new Map<string, string>()
      for (const entry of rejected) {
        const copied = await this.dependencies.adapter.copyRejectedReceipt({
          path: entry.receiptPath,
          expectedSha256: entry.queue.semanticSha256
        })
        copiedRejectedReceipts.set(entry.queue.operationId, copied.receiptPath)
      }
      if (rejected.length > 0) {
        this.dependencies.journal.updatePendingDetail(operationId, {
          phase: 'terminal-receipts-copied',
          recoveryResolution: {
            recordedAtUtc: new Date(this.clock.now()).toISOString(),
            entries: outcomes.map((entry) => ({
              operationId: entry.queue.operationId,
              state: entry.state,
              receiptPath: entry.receiptPath,
              semanticSha256: entry.queue.semanticSha256,
              copiedReceiptPath: copiedRejectedReceipts.get(entry.queue.operationId) ?? null
            }))
          }
        })
      }
      if (deposited.length > 0 && rejected.length > 0) {
        for (const entry of rejected) {
          await this.dependencies.adapter.acknowledgeRejectedReceipt({
            path: entry.receiptPath,
            expectedSha256: entry.queue.semanticSha256
          })
        }
        const receiptPaths = deposited.map((entry) => entry.receiptPath)
        const rejectedVaultItemIds = rejected.map((entry) => entry.item.id)
        const completedAtUtc = new Date(this.clock.now()).toISOString()
        const issue = `${deposited.length} of ${selected.length} selected items were deposited. ` +
          `${rejected.length} ${rejected.length === 1 ? 'item remains' : 'items remain'} safely stored in ` +
          `the Codex Archive because the ${status.depositTabDescription} could not accept them.`
        this.dependencies.journal.completePartialRetrieval({
          operationId,
          depositedVaultItemIds: deposited.map((entry) => entry.item.id),
          rejectedVaultItemIds,
          receiptPaths,
          completedAtUtc,
          detail: {
            phase: 'committed_partial',
            adapter: 'gdia-live-v1',
            receiptPaths,
            rejectedReceiptPaths: rejected.map((entry) =>
              copiedRejectedReceipts.get(entry.queue.operationId)!
            ),
            vaultItemIds,
            depositedVaultItemIds: deposited.map((entry) => entry.item.id),
            rejectedVaultItemIds
          }
        })
        prepared = false
        return {
          operationId,
          status: 'committed',
          retrieved: deposited.map((entry) => ({
            vaultItemId: entry.item.id,
            baseRecord: entry.item.baseRecord,
            seed: entry.item.seed
          })),
          receiptPaths,
          issues: [issue]
        }
      }
      if (rejected.length === terminal.length) {
        for (const entry of rejected) {
          await this.dependencies.adapter.acknowledgeRejectedReceipt({
            path: entry.receiptPath,
            expectedSha256: entry.queue.semanticSha256
          })
        }
        const rejection = new LiveTransferServiceError(
          `The ${status.depositTabDescription} is full. The items remain safely stored in the Codex Archive.`,
          'live-transfer.rejected'
        )
        this.dependencies.journal.failRetrieval(operationId, vaultItemIds, rejection)
        prepared = false
        throw rejection
      }

      const receiptPaths = terminal.map((entry) => entry.receiptPath)
      this.dependencies.journal.completeRetrieval({
        operationId,
        vaultItemIds,
        receiptPaths,
        completedAtUtc: new Date(this.clock.now()).toISOString(),
        detail: { phase: 'committed', adapter: 'gdia-live-v1', receiptPaths, vaultItemIds }
      })
      prepared = false
      return {
        operationId,
        status: 'committed',
        retrieved: selected.map((item) => ({
          vaultItemId: item.id,
          baseRecord: item.baseRecord,
          seed: item.seed
        })),
        receiptPaths,
        issues: []
      }
    } catch (error) {
      if (prepared) {
        if (enqueueAttempted) {
          this.dependencies.journal.markRetrievalNeedsRecovery(operationId, error)
          throw transferError(
            error,
            'live-transfer.outcome-uncertain',
            'The live transfer outcome is uncertain and was retained for recovery.'
          )
        }
        this.dependencies.journal.failRetrieval(operationId, vaultItemIds, error)
      }
      throw transferError(error, 'live-transfer.failed', 'The live transfer failed.')
    }
  }

  private async awaitTerminalReceipts(queues: readonly LiveTransferQueue[]): Promise<Array<{
    state: 'deposited' | 'rejected'
    receiptPath: string
  }>> {
    const deadline = this.clock.now() + this.timeoutMs
    while (this.clock.now() < deadline) {
      const statuses = await Promise.all(
        queues.map((queue) => this.dependencies.adapter.inspectRetrieval(queue))
      )
      const invalidTerminal = statuses.find((entry) =>
        (entry.state === 'deposited' || entry.state === 'rejected') && !entry.receiptPath?.trim()
      )
      if (invalidTerminal) {
        throw new LiveTransferServiceError(
          'The game reported a terminal live-transfer outcome without a durable receipt.',
          'live-transfer.outcome-uncertain'
        )
      }
      if (statuses.every((entry) =>
        (entry.state === 'deposited' || entry.state === 'rejected') && Boolean(entry.receiptPath)
      )) {
        return statuses.map((entry) => ({
          state: entry.state as 'deposited' | 'rejected',
          receiptPath: entry.receiptPath!
        }))
      }
      await this.clock.wait(this.pollIntervalMs)
    }
    throw new LiveTransferServiceError(
      'Timed out waiting for the live hook to acknowledge the in-game deposit. ' +
        'Do not submit the transfer again until recovery resolves it.',
      'live-transfer.outcome-uncertain'
    )
  }

  private assertQueue(queue: LiveTransferQueue, operationId: string, isHardcore: boolean): void {
    if (
      queue.operationId !== operationId ||
      queue.isHardcore !== isHardcore ||
      !queue.outgoingPath ||
      !/^[0-9a-f]{64}$/i.test(queue.semanticSha256) ||
      !Array.isArray(queue.baselineDeleted) ||
      !queue.baselineDeleted.every((entry) => typeof entry === 'string') ||
      !Array.isArray(queue.baselineIncoming) ||
      !queue.baselineIncoming.every((entry) => typeof entry === 'string')
    ) {
      throw new LiveTransferServiceError(
        'The native adapter returned an invalid live-transfer queue receipt.',
        'live-transfer.outcome-uncertain'
      )
    }
  }
}
