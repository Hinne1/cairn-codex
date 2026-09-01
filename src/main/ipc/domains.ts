import { IPC_CHANNELS } from '../../shared/contracts.ts'
import type { IpcOperation, IpcRegistrar } from './service-registry.ts'
import { IpcDomainService } from './service-registry.ts'

export const MAIN_IPC_CHANNELS = {
  backgroundJobs: [IPC_CHANNELS.getBackgroundJobs, IPC_CHANNELS.cancelBackgroundJob],
  diagnostics: [
    IPC_CHANNELS.getAppStatus, IPC_CHANNELS.getDebugLogging, IPC_CHANNELS.setDebugLogging,
    IPC_CHANNELS.recordNavigation, IPC_CHANNELS.reportRendererError,
    IPC_CHANNELS.reportPreferenceLoad, IPC_CHANNELS.exportPreferences,
    IPC_CHANNELS.getRecoveryStatus, IPC_CHANNELS.exportDiagnostics
  ],
  backups: [
    IPC_CHANNELS.getArchiveBackupStatus, IPC_CHANNELS.createArchiveBackup,
    IPC_CHANNELS.exportArchiveBackup, IPC_CHANNELS.restoreArchiveBackup,
    IPC_CHANNELS.openArchiveBackupDirectory
  ],
  imports: [
    IPC_CHANNELS.getLastGdiaImportResult, IPC_CHANNELS.getGdiaImportProgress,
    IPC_CHANNELS.importGdiaDatabase
  ],
  collection: [
    IPC_CHANNELS.discoverGrimDawn, IPC_CHANNELS.listCharacters,
    IPC_CHANNELS.getCachedCollection, IPC_CHANNELS.hydrateArchiveRolls,
    IPC_CHANNELS.scanCollection, IPC_CHANNELS.rebuildGameDataIndex,
    IPC_CHANNELS.setPinnedBest, IPC_CHANNELS.getInfiniteSupplies,
    IPC_CHANNELS.setInfiniteSupplies
  ],
  transfers: [
    IPC_CHANNELS.inspectWriteSafety, IPC_CHANNELS.inspectStagingTab,
    IPC_CHANNELS.listVaultItems, IPC_CHANNELS.queryVaultItems,
    IPC_CHANNELS.queryOperationHistory, IPC_CHANNELS.getVaultSummary,
    IPC_CHANNELS.previewDismantling, IPC_CHANNELS.ingestStagingTab,
    IPC_CHANNELS.retrieveVaultItems, IPC_CHANNELS.inspectLiveGame,
    IPC_CHANNELS.approveLiveGameBuild, IPC_CHANNELS.startLiveGame,
    IPC_CHANNELS.stopLiveGame, IPC_CHANNELS.syncLiveGame,
    IPC_CHANNELS.retrieveLiveVaultItems, IPC_CHANNELS.dispenseLiveAugments,
    IPC_CHANNELS.recoverSahdinasMemento
  ],
  windowLifecycle: [
    IPC_CHANNELS.restartInSafeMode, IPC_CHANNELS.restartNormally,
    IPC_CHANNELS.getStartupStatus, IPC_CHANNELS.reportStartupPhase,
    IPC_CHANNELS.openDataDirectory, IPC_CHANNELS.setZoomFactor
  ]
} as const

export type MainIpcDomainName = keyof typeof MAIN_IPC_CHANNELS

export interface MainIpcDomains {
  backgroundJobs: IpcDomainService
  diagnostics: IpcDomainService
  backups: IpcDomainService
  imports: IpcDomainService
  collection: IpcDomainService
  transfers: IpcDomainService
  windowLifecycle: IpcDomainService
}

function scopedRegistrar(registrar: IpcRegistrar, domain: MainIpcDomainName): IpcRegistrar {
  const ownedChannels = new Set<string>(MAIN_IPC_CHANNELS[domain])
  return {
    handle(channel: string, listener: IpcOperation): void {
      if (!ownedChannels.has(channel)) {
        throw new Error(`IPC channel ${channel} is not owned by the ${domain} service.`)
      }
      registrar.handle(channel, listener)
    }
  }
}

export function createMainIpcDomains(registrar: IpcRegistrar): MainIpcDomains {
  const channels = Object.values(MAIN_IPC_CHANNELS).flat()
  if (new Set(channels).size !== channels.length) {
    throw new Error('A main-process IPC channel is assigned to more than one domain service.')
  }
  return {
    backgroundJobs: new IpcDomainService('background-jobs', scopedRegistrar(registrar, 'backgroundJobs')),
    diagnostics: new IpcDomainService('diagnostics', scopedRegistrar(registrar, 'diagnostics')),
    backups: new IpcDomainService('backups', scopedRegistrar(registrar, 'backups')),
    imports: new IpcDomainService('imports', scopedRegistrar(registrar, 'imports')),
    collection: new IpcDomainService('collection', scopedRegistrar(registrar, 'collection')),
    transfers: new IpcDomainService('transfers', scopedRegistrar(registrar, 'transfers')),
    windowLifecycle: new IpcDomainService('window-lifecycle', scopedRegistrar(registrar, 'windowLifecycle'))
  }
}
