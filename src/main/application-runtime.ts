import type { BrowserWindow } from 'electron'
import type { CollectionBasis, CollectionSnapshot, VaultSummary } from '../shared/contracts.ts'
import type { GrimDawnHelperClient } from './grim-dawn/helper-client.ts'
import type { CollectionDatabase } from './collection-database.ts'
import type { DiagnosticLogger } from './diagnostics.ts'

/** Supplied only by the dedicated verification entry; production imports no implementation. */
export interface ApplicationVerification {
  cachedCollection(): CollectionSnapshot | null
  presentCollection(snapshot: CollectionSnapshot, basis: CollectionBasis): CollectionSnapshot | null
  presentVaultSummary(summary: VaultSummary): VaultSummary
  captureWindow(window: BrowserWindow, path: string): Promise<void>
  smokeRequested: boolean
  runSmokeTest(helper: GrimDawnHelperClient, database: CollectionDatabase, diagnostics: DiagnosticLogger): Promise<void>
}
