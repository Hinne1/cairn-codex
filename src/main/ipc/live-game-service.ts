import type {
  LiveGameStatus,
  LiveGameSyncResult,
  LiveRetrievalResult,
  LiveSupplyDispenseResult,
  SpecialItemRecoveryResult,
  SpecialRecoveryDestination,
  WriteSafetyStatus
} from '../../shared/contracts.ts'

export interface LiveGameDiagnosticRunner {
  run<T>(
    event: string,
    operation: () => Promise<T>,
    startData?: Record<string, unknown>,
    completedData?: (result: T) => Record<string, unknown>
  ): Promise<T>
}

export interface LiveGameDomainDependencies {
  visualDiagnosticsActive(): boolean
  inspect(): Promise<LiveGameStatus>
  inspectWriteSafety(): Promise<WriteSafetyStatus>
  approveBuild(): Promise<LiveGameStatus>
  start(): Promise<LiveGameStatus>
  stop(): Promise<LiveGameStatus>
  syncIncoming(): Promise<LiveGameSyncResult>
  retrieveVaultItems(vaultItemIds: readonly string[]): Promise<LiveRetrievalResult>
  dispenseAugments(input: {
    records: string[]
    expectedCharacterName?: string
  }): Promise<LiveSupplyDispenseResult>
  recoverSpecialItem(input: {
    destination: SpecialRecoveryDestination
    expectedCharacterName?: string
  }): Promise<SpecialItemRecoveryResult>
  runTransferExclusive<T>(operation: () => Promise<T>): Promise<T>
  diagnostics: LiveGameDiagnosticRunner
  queueArchiveBackup(reason: string): void
}

const visualDiagnosticsMessage = 'Live transfers are disabled during visual diagnostics.'

function visualDiagnosticsStatus(): LiveGameStatus {
  return {
    state: 'unavailable', detail: visualDiagnosticsMessage,
    grimDawnProcessIds: [], itemAssistantProcessIds: [], hookAvailable: false,
    adapterDirectory: null, hookVersion: null, connectedProcessId: null,
    isHardcore: null, activeCharacterName: null, ingestTabSetting: 0, depositTabSetting: 0,
    ingestTabDescription: visualDiagnosticsMessage, depositTabDescription: visualDiagnosticsMessage,
    hostWindowReady: false, injectorOutput: null, messages: [], gameVersion: null,
    gameBuildId: null, gameDllSha256: null, gameDllLastWriteUtc: null, hookSha256: null,
    recommendation: null
  }
}

/** Owns the live-game IPC policy while native helper/database work stays injected. */
export class LiveGameDomainService {
  private readonly dependencies: LiveGameDomainDependencies

  constructor(dependencies: LiveGameDomainDependencies) {
    this.dependencies = dependencies
  }

  inspect(): Promise<LiveGameStatus> {
    if (this.dependencies.visualDiagnosticsActive()) return Promise.resolve(visualDiagnosticsStatus())
    return this.dependencies.inspect()
  }

  inspectWriteSafety(): Promise<WriteSafetyStatus> {
    if (this.dependencies.visualDiagnosticsActive()) {
      return Promise.resolve({ permitted: false, reasons: [visualDiagnosticsMessage] })
    }
    return this.dependencies.inspectWriteSafety()
  }

  approveBuild(): Promise<LiveGameStatus> {
    if (this.dependencies.visualDiagnosticsActive()) return Promise.reject(new Error(visualDiagnosticsMessage))
    return this.dependencies.approveBuild()
  }

  start(): Promise<LiveGameStatus> {
    if (this.dependencies.visualDiagnosticsActive()) {
      return Promise.reject(new Error(visualDiagnosticsMessage))
    }
    return this.dependencies.start()
  }

  stop(): Promise<LiveGameStatus> {
    if (this.dependencies.visualDiagnosticsActive()) return Promise.reject(new Error(visualDiagnosticsMessage))
    return this.dependencies.stop()
  }

  sync(): Promise<LiveGameSyncResult> {
    if (this.dependencies.visualDiagnosticsActive()) {
      return Promise.resolve({ status: visualDiagnosticsStatus(), ingested: [], issues: [] })
    }
    return this.dependencies.diagnostics.run('live-sync', async () => {
      const result = await this.dependencies.runTransferExclusive(
        () => this.dependencies.syncIncoming()
      )
      if (result.ingested.length > 0) this.dependencies.queueArchiveBackup('live ingest')
      return result
    }, undefined, (result) => ({ ingestedItems: result.ingested.length }))
  }

  retrieve(vaultItemIds: readonly string[]): Promise<LiveRetrievalResult> {
    if (this.dependencies.visualDiagnosticsActive()) return Promise.reject(new Error(visualDiagnosticsMessage))
    return this.dependencies.diagnostics.run('live-retrieval', async () => {
      const result = await this.dependencies.runTransferExclusive(
        () => this.dependencies.retrieveVaultItems(vaultItemIds)
      )
      if (result.retrieved.length > 0) this.dependencies.queueArchiveBackup('live retrieval')
      return result
    }, { requestedItems: vaultItemIds.length }, (result) => ({
      retrievedItems: result.retrieved.length
    }))
  }

  dispense(input: {
    records: string[]
    expectedCharacterName?: string
  }): Promise<LiveSupplyDispenseResult> {
    if (this.dependencies.visualDiagnosticsActive()) return Promise.reject(new Error(visualDiagnosticsMessage))
    return this.dependencies.diagnostics.run('supply-dispense', async () => {
      const result = await this.dependencies.runTransferExclusive(
        () => this.dependencies.dispenseAugments(input)
      )
      this.dependencies.queueArchiveBackup('supply delivery')
      return result
    }, { requestedItems: input.records.length }, (result) => ({
      deliveredItems: result.dispensed.length
    }))
  }

  recover(input: {
    destination: SpecialRecoveryDestination
    expectedCharacterName?: string
  }): Promise<SpecialItemRecoveryResult> {
    if (this.dependencies.visualDiagnosticsActive()) return Promise.reject(new Error(visualDiagnosticsMessage))
    return this.dependencies.diagnostics.run('special-item-recovery', async () => {
      const result = await this.dependencies.runTransferExclusive(
        () => this.dependencies.recoverSpecialItem(input)
      )
      this.dependencies.queueArchiveBackup('special item recovery')
      return result
    }, { destination: input.destination }, () => ({ deliveredItems: 1 }))
  }
}
