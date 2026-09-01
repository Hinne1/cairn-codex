import type {
  CollectionBasis,
  OperationHistoryRequest,
  PreferenceLoadReport,
  RendererErrorReport,
  SpecialRecoveryDestination,
  StartupPhaseEvent,
  VaultPageRequest
} from '../../shared/contracts.ts'

function objectInput(input: unknown, message: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(message)
  return input as Record<string, unknown>
}

export function noInput(_input: unknown): undefined {
  return undefined
}

export function booleanField<TField extends string>(field: TField, message: string) {
  return (input: unknown): Record<TField, boolean> => {
    const value = objectInput(input, message)
    if (typeof value[field] !== 'boolean') throw new Error(message)
    return { [field]: value[field] } as Record<TField, boolean>
  }
}

export function validateBackgroundJobId(input: unknown): { id: string } {
  const value = objectInput(input, 'A valid background job ID is required.')
  if (typeof value.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)) {
    throw new Error('A valid background job ID is required.')
  }
  return { id: value.id }
}

const workspaces = new Set([
  'collection', 'sets', 'materials', 'skills', 'planner', 'oracle', 'mi-workshop',
  'supplies', 'farming', 'dismantling', 'vault', 'settings'
])

export function validateNavigation(input: unknown): { view: string } {
  const value = objectInput(input, 'Unknown workspace navigation event.')
  if (typeof value.view !== 'string' || !workspaces.has(value.view)) {
    throw new Error('Unknown workspace navigation event.')
  }
  return { view: value.view }
}

export function validateRendererError(input: unknown): RendererErrorReport {
  const value = objectInput(input, 'Renderer error report is outside its safe bounds.')
  if (
    typeof value.correlationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.correlationId) ||
    typeof value.workspace !== 'string' || value.workspace.length > 64 ||
    typeof value.message !== 'string' || value.message.length < 1 || value.message.length > 500 ||
    (value.stack !== null && (typeof value.stack !== 'string' || value.stack.length > 4000))
  ) throw new Error('Renderer error report is outside its safe bounds.')
  return value as unknown as RendererErrorReport
}

export function validatePreferenceLoad(input: unknown): PreferenceLoadReport {
  const value = objectInput(input, 'Preference-load diagnostics are outside their safe bounds.')
  const sources = new Set(['fresh', 'legacy', 'stored'])
  if (
    typeof value.source !== 'string' || !sources.has(value.source) ||
    typeof value.migrated !== 'boolean' || value.schemaVersion !== 1 ||
    !Array.isArray(value.invalidFields) || value.invalidFields.length > 64 ||
    !value.invalidFields.every((field) => typeof field === 'string' && /^[a-z][a-zA-Z0-9.[\]-]{0,99}$/.test(field))
  ) throw new Error('Preference-load diagnostics are outside their safe bounds.')
  return value as unknown as PreferenceLoadReport
}

export function validateSerializedPreferences(input: unknown): { serialized: string } {
  const value = objectInput(input, 'Preference export is outside its safe bounds.')
  if (typeof value.serialized !== 'string' || value.serialized.length > 2 * 1024 * 1024) {
    throw new Error('Preference export is outside its safe bounds.')
  }
  let parsed: unknown
  try { parsed = JSON.parse(value.serialized) as unknown } catch { throw new Error('Preference export is not valid JSON.') }
  if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1) {
    throw new Error('Preference export has an unsupported schema version.')
  }
  return { serialized: value.serialized }
}

const startupPhases = new Set<StartupPhaseEvent>([
  'cache-hit', 'cache-miss', 'cached-paint', 'interactive',
  'scan-started', 'scan-settled', 'scan-skipped',
  'roll-analysis-started', 'roll-analysis-settled', 'roll-analysis-skipped'
])

export function validateStartupPhase(input: unknown): { phase: StartupPhaseEvent } {
  const value = objectInput(input, 'Unknown startup phase event.')
  if (typeof value.phase !== 'string' || !startupPhases.has(value.phase as StartupPhaseEvent)) {
    throw new Error('Unknown startup phase event.')
  }
  return { phase: value.phase as StartupPhaseEvent }
}

export function validateCollectionRequest(input: unknown): { sourcePaths: string[]; basis: CollectionBasis } {
  const value = objectInput(input, 'Collection scan input is outside its safe bounds.')
  if (
    !Array.isArray(value.sourcePaths) || value.sourcePaths.length > 256 ||
    !value.sourcePaths.every((path) => typeof path === 'string' && path.length > 0 && path.length <= 1024) ||
    !['stashes', 'archive'].includes(value.basis as string)
  ) throw new Error('Collection scan input is outside its safe bounds.')
  return { sourcePaths: value.sourcePaths as string[], basis: value.basis as CollectionBasis }
}

export function validateSourcePaths(input: unknown): { sourcePaths: string[] } {
  const value = objectInput(input, 'Collection source paths are outside their safe bounds.')
  if (!Array.isArray(value.sourcePaths) || value.sourcePaths.length > 256 ||
      !value.sourcePaths.every((path) => typeof path === 'string' && path.length > 0 && path.length <= 1024)) {
    throw new Error('Collection source paths are outside their safe bounds.')
  }
  return { sourcePaths: value.sourcePaths as string[] }
}

export function validateZoomFactor(input: unknown): { factor: number } {
  const value = objectInput(input, 'Zoom factor is outside its safe bounds.')
  if (typeof value.factor !== 'number' || !Number.isFinite(value.factor)) throw new Error('Zoom factor is outside its safe bounds.')
  return { factor: value.factor }
}

export function validatePinnedBest(input: unknown): { record: string; instanceKey: string | null; isHardcore: boolean } {
  const value = objectInput(input, 'Pinned-copy input is outside its safe bounds.')
  if (typeof value.record !== 'string' || value.record.length < 1 || value.record.length > 512 ||
      (value.instanceKey !== null && (typeof value.instanceKey !== 'string' || value.instanceKey.length > 512)) ||
      typeof value.isHardcore !== 'boolean') throw new Error('Pinned-copy input is outside its safe bounds.')
  return value as { record: string; instanceKey: string | null; isHardcore: boolean }
}

export function validateOptionalMode(input: unknown): { isHardcore?: boolean } {
  if (input === undefined) return {}
  const value = objectInput(input, 'Archive mode is outside its safe bounds.')
  if (value.isHardcore !== undefined && typeof value.isHardcore !== 'boolean') throw new Error('Archive mode is outside its safe bounds.')
  return value as { isHardcore?: boolean }
}

export function validateVaultPage(input: unknown): VaultPageRequest {
  const value = objectInput(input, 'Vault paging parameters are outside their safe bounds.')
  if (!['ingested', 'retrieval_pending', 'retrieved'].includes(value.state as string)) throw new Error('A valid vault state is required.')
  if (!['recent', 'name', 'level', 'roll'].includes(value.sort as string)) throw new Error('A valid vault sort is required.')
  if (!['asc', 'desc'].includes(value.direction as string)) throw new Error('A valid vault sort direction is required.')
  if (value.rarity !== undefined && !['epic', 'legendary', 'mi', 'rare', 'faction', 'supply'].includes(value.rarity as string)) {
    throw new Error('The requested vault rarity is not supported.')
  }
  if (!Number.isInteger(value.offset) || (value.offset as number) < 0 || (value.offset as number) > 10_000_000 ||
      !Number.isInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 250 ||
      (typeof value.query === 'string' ? value.query.length : 0) > 200) {
    throw new Error('Vault paging parameters are outside their safe bounds.')
  }
  return value as unknown as VaultPageRequest
}

export function validateOperationHistory(input: unknown): OperationHistoryRequest {
  const value = objectInput(input, 'Operation-history paging parameters are outside their safe bounds.')
  if (!['ingest', 'retrieve'].includes(value.operation as string)) throw new Error('A valid operation-history kind is required.')
  if (!['all', 'committed', 'failed', 'pending'].includes(value.outcome as string)) throw new Error('A valid operation-history outcome is required.')
  if (!Number.isInteger(value.offset) || (value.offset as number) < 0 || (value.offset as number) > 10_000_000 ||
      !Number.isInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 250 ||
      (typeof value.query === 'string' ? value.query.length : 0) > 200) {
    throw new Error('Operation-history paging parameters are outside their safe bounds.')
  }
  return value as unknown as OperationHistoryRequest
}

export function validatePath(input: unknown): { path: string } {
  const value = objectInput(input, 'A valid stash path is required.')
  if (typeof value.path !== 'string' || value.path.length < 1 || value.path.length > 1024) throw new Error('A valid stash path is required.')
  return { path: value.path }
}

export function validateVaultIds(input: unknown): { vaultItemIds: string[] } {
  const value = objectInput(input, 'Vault item selection is outside its safe bounds.')
  if (!Array.isArray(value.vaultItemIds) || value.vaultItemIds.length > 10_000 ||
      !value.vaultItemIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 128)) {
    throw new Error('Vault item selection is outside its safe bounds.')
  }
  return { vaultItemIds: value.vaultItemIds as string[] }
}

export function validatePathAndVaultIds(input: unknown): { path: string; vaultItemIds: string[] } {
  const value = objectInput(input, 'Transfer input is outside its safe bounds.')
  return {
    ...validatePath(value),
    ...validateVaultIds(value)
  }
}

export function validateSpecialRecovery(input: unknown): { destination: SpecialRecoveryDestination; expectedCharacterName?: string } {
  const value = objectInput(input, 'Special-item recovery input is outside its safe bounds.')
  if (!['shared-stash', 'character-inventory'].includes(value.destination as string) ||
      (value.expectedCharacterName !== undefined && (typeof value.expectedCharacterName !== 'string' || value.expectedCharacterName.length > 128))) {
    throw new Error('Special-item recovery input is outside its safe bounds.')
  }
  return value as { destination: SpecialRecoveryDestination; expectedCharacterName?: string }
}

export function validateSupplyDispense(input: unknown): { records: string[]; expectedCharacterName?: string } {
  const value = objectInput(input, 'Supply delivery input is outside its safe bounds.')
  if (!Array.isArray(value.records) || value.records.length < 1 || value.records.length > 10_000 ||
      !value.records.every((record) => typeof record === 'string' && record.length > 0 && record.length <= 512) ||
      (value.expectedCharacterName !== undefined && (typeof value.expectedCharacterName !== 'string' || value.expectedCharacterName.length > 128))) {
    throw new Error('Supply delivery input is outside its safe bounds.')
  }
  return value as { records: string[]; expectedCharacterName?: string }
}
