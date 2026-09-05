import { join } from 'node:path';
import type { CollectionDatabase } from '../collection-database.ts';
import type { TransferPorts, TransferClock } from './runtime.ts';
import type { LiveQueueReceipt, LiveRetrievalQueue, LiveRetrievalStatus } from './contracts.ts';
import type { CharacterSaveProfile, CollectionSnapshot, LiveGameStatus, LiveSupplyDispenseResult, SpecialRecoveryDestination, SpecialItemRecoveryResult } from '../../shared/contracts.ts';
import type { LiveVaultPayload } from '../collection-presentation.ts';
import { createHash } from 'node:crypto';
import type { TerminalRecoveryEntry } from './retained-receipts.ts'

export type LiveDeliveryDependencies = TransferPorts & {
  database: Pick<CollectionDatabase, 'completeDeliveryOperation' | 'failDeliveryOperation' | 'markDeliveryNeedsRecovery' | 'prepareDeliveryOperation' | 'updatePendingOperationDetail'>
}

const SAHDINAS_MEMENTO = {
  record: 'records/items/gearaccessories/necklaces/b100_necklace_sahdina.dbr',
  name: "Sahdina's Memento"
} as const

const reputationThresholds: Record<string, number> = {
  tolerated: 0,
  friendly: 1_500,
  respected: 5_000,
  honored: 10_000,
  revered: 25_000
}

export function normalizedFactionName(value: string): string {
  return value
    .toLocaleLowerCase()
    .replaceAll('’', "'")
    .replace(/[^a-z0-9]/g, '')
}

export function createSupplyPayload(baseRecord: string, clock: TransferClock): LiveVaultPayload {
  return {
    stashVersion: 11,
    sourceTabIndex: -1,
    sourceItemIndex: -1,
    baseRecord,
    prefixRecord: '',
    suffixRecord: '',
    modifierRecord: '',
    transmuteRecord: '',
    seed: clock.seed(),
    materiaRecord: '',
    relicCompletionBonusRecord: '',
    relicSeed: 0,
    enchantmentRecord: '',
    ascendantRecord: '',
    ascendantRecord2H: '',
    unknown: 0,
    enchantmentSeed: 0,
    materiaCombines: 0,
    stackCount: 1,
    rerolls: 0,
    affixRerolls: 0,
    xOffset: 0,
    yOffset: 0
  }
}

async function deliverGeneratedItems(
  { helper, database, paths, clock }: LiveDeliveryDependencies,
  operationId: string,
  isHardcore: boolean,
  destination: SpecialRecoveryDestination,
  items: LiveVaultPayload[]
): Promise<TerminalRecoveryEntry[]> {
  const queues: LiveRetrievalQueue[] = []
  for (const [index, item] of items.entries()) {
    const dispatch = { operationId: `${operationId}-${index}`, isHardcore, destination, item }
    database.updatePendingOperationDetail(operationId, { pendingDispatch: dispatch })
    const queue = await helper.request<LiveRetrievalQueue>('enqueue-live-retrieval', dispatch)
    if (
      queue.operationId !== dispatch.operationId || queue.isHardcore !== isHardcore ||
      !queue.outgoingPath || !/^[0-9a-f]{64}$/i.test(queue.semanticSha256) ||
      !Array.isArray(queue.baselineDeleted) || !queue.baselineDeleted.every(path => typeof path === 'string') ||
      !Array.isArray(queue.baselineIncoming) || !queue.baselineIncoming.every(path => typeof path === 'string')
    ) throw new Error('The native adapter returned an invalid live delivery queue receipt.')
    queues.push(queue)
    database.updatePendingOperationDetail(operationId, {
      phase: 'queued', pendingDispatch: null, queues: [...queues]
    })
  }
  database.updatePendingOperationDetail(operationId, { dispatchComplete: true })
  const terminal = new Map<string, TerminalRecoveryEntry>()
  const deadline = clock.now() + 30_000
  while (clock.now() < deadline && terminal.size !== queues.length) {
    for (const queue of queues) {
      if (terminal.has(queue.operationId)) continue
      const status = await helper.request<LiveRetrievalStatus>('inspect-live-retrieval', { queue })
      if (status.state !== 'deposited' && status.state !== 'rejected') continue
      if (!status.receiptPath?.trim()) throw new Error('The live delivery has no durable terminal receipt.')
      terminal.set(queue.operationId, { operationId: queue.operationId, state: status.state,
        receiptPath: status.receiptPath, semanticSha256: queue.semanticSha256, copiedReceiptPath: null })
    }
    if (terminal.size !== queues.length) await clock.wait(150)
  }
  if (terminal.size !== queues.length) {
    throw new Error('Timed out waiting for Grim Dawn to acknowledge the live delivery. Do not retry until CC resolves the pending queue.')
  }
  const entries = queues.map(queue => terminal.get(queue.operationId)!)
  const receiptDirectory = join(paths.receipts, 'rejected-generated-deliveries')
  for (const entry of entries) {
    if (entry.state !== 'rejected') continue
    const copied = await helper.request<LiveQueueReceipt>('copy-live-incoming', {
      path: entry.receiptPath, expectedSha256: entry.semanticSha256, receiptDirectory
    })
    entry.copiedReceiptPath = copied.receiptPath
  }
  database.updatePendingOperationDetail(operationId, {
    phase: 'terminal-receipts-copied', recoveryResolution: { recordedAtUtc: clock.nowUtc(), entries }
  })
  for (const entry of entries) {
    if (entry.state !== 'rejected') continue
    await helper.request<LiveQueueReceipt>('ack-live-incoming', {
      path: entry.receiptPath, expectedSha256: entry.semanticSha256, receiptDirectory
    })
  }
  return entries
}

export async function executeSahdinasMementoRecovery(
  dependencies: LiveDeliveryDependencies,
  collection: CollectionSnapshot,
  destination: SpecialRecoveryDestination,
  expectedCharacterName?: string
): Promise<SpecialItemRecoveryResult> {
  const { helper, database, clock } = dependencies
  if (destination !== 'shared-stash' && destination !== 'character-inventory') {
    throw new Error('Sahdina recovery only supports the shared stash or active character inventory.')
  }

  const status = await helper.request<LiveGameStatus>('inspect-live-game')
  if (status.state !== 'ready') throw new Error(status.detail)
  const confirmedCharacterName = expectedCharacterName?.trim() || null
  if (
    status.activeCharacterName &&
    confirmedCharacterName &&
    status.activeCharacterName.localeCompare(confirmedCharacterName, undefined, { sensitivity: 'base' }) !== 0
  ) {
    throw new Error(
      `The active character changed from “${confirmedCharacterName}” to “${status.activeCharacterName}”. Review the character and try again.`
    )
  }
  const activeCharacterName = status.activeCharacterName ?? confirmedCharacterName
  let activeIsHardcore = status.isHardcore
  if (activeIsHardcore === null) {
    if (!activeCharacterName) {
      throw new Error('CC could not identify the active character well enough to resolve Hardcore or Softcore mode.')
    }
    const installationPath = collection.discovery.installations[0]?.path
    if (!installationPath) throw new Error('No Grim Dawn installation is available.')
    const profiles = await helper.request<CharacterSaveProfile[]>('list-characters', { installationPath })
    const matchingProfiles = profiles
      .filter((profile) => !profile.error)
      .filter((profile) => profile.name.localeCompare(activeCharacterName, undefined, { sensitivity: 'base' }) === 0)
    const matchingModes = [...new Set(matchingProfiles.map((profile) => profile.isHardcore))]
    if (matchingModes.length > 1) {
      throw new Error(
        `CC found both Hardcore and Softcore saves named “${activeCharacterName}”. Rename one before using live recovery.`
      )
    }
    activeIsHardcore = matchingModes[0] ?? null
    if (activeIsHardcore === null) {
      throw new Error(`The active character “${activeCharacterName}” was not found in the parsed saves.`)
    }
  }

  const operationId = `sahdina-${clock.operationId()}`
  const item = createSupplyPayload(SAHDINAS_MEMENTO.record, clock)
  const payloadSha256 = createHash('sha256').update(JSON.stringify(item)).digest('hex')
  database.prepareDeliveryOperation({
    operationId,
    destination: `live://special-recovery/${destination}`,
    payloadSha256,
    startedAtUtc: clock.nowUtc(),
    detail: { phase: 'prepared', adapter: 'cairn-live-v1', record: SAHDINAS_MEMENTO.record, destination,
      isHardcore: activeIsHardcore, payloads: [item], expectedQueueCount: 1, dispatchComplete: false }
  })
  try {
    const result = (await deliverGeneratedItems(dependencies, operationId, activeIsHardcore, destination, [item]))[0]!
    if (result.state === 'rejected') {
      const target = destination === 'character-inventory' ? 'personal inventory' : status.depositTabDescription
      const rejection = new Error(`The game rejected the recovery because the ${target} is full. No replacement was delivered.`)
      database.failDeliveryOperation(operationId, rejection)
      throw rejection
    }
    database.completeDeliveryOperation({
      operationId,
      receiptPath: result.receiptPath,
      completedAtUtc: clock.nowUtc(),
      detail: { phase: 'committed', adapter: 'cairn-live-v1', record: SAHDINAS_MEMENTO.record, destination, isHardcore: activeIsHardcore }
    })
    return {
      operationId,
      status: 'committed',
      activeCharacter: activeCharacterName ?? 'Active character',
      destination,
      record: SAHDINAS_MEMENTO.record,
      name: SAHDINAS_MEMENTO.name,
      receiptPath: result.receiptPath
    }
  } catch (error) {
    database.markDeliveryNeedsRecovery(operationId, error)
    throw error
  }
}

export async function executeLiveAugmentDispense(
  dependencies: LiveDeliveryDependencies,
  collection: CollectionSnapshot,
  records: string[],
  expectedCharacterName?: string
): Promise<LiveSupplyDispenseResult> {
  const { helper, database, clock } = dependencies
  const uniqueRecords = [...new Set(records.map((record) => record.toLocaleLowerCase()))]
  if (uniqueRecords.length === 0) throw new Error('Select at least one augment to dispense.')

  let status = await helper.request<LiveGameStatus>('inspect-live-game')
  if (status.state !== 'ready') throw new Error(status.detail)
  for (let attempt = 0; attempt < 25 && !status.activeCharacterName; attempt += 1) {
    await clock.wait(200)
    status = await helper.request<LiveGameStatus>('inspect-live-game')
    if (status.state !== 'ready') throw new Error(status.detail)
  }
  const confirmedCharacterName = expectedCharacterName?.trim() || null
  if (
    status.activeCharacterName &&
    confirmedCharacterName &&
    status.activeCharacterName.localeCompare(confirmedCharacterName, undefined, { sensitivity: 'base' }) !== 0
  ) {
    throw new Error(
      `The active character changed from “${confirmedCharacterName}” to “${status.activeCharacterName}”. Review the character and try again.`
    )
  }
  const activeCharacterName = status.activeCharacterName ?? confirmedCharacterName
  if (!activeCharacterName) {
    throw new Error('CC could not identify the active character. Reopen the Supplies view and try again.')
  }

  const installationPath = collection.discovery.installations[0]?.path
  if (!installationPath) throw new Error('No Grim Dawn installation is available.')
  let activeCharacter: CharacterSaveProfile | undefined
  let activeIsHardcore = status.isHardcore
  for (let attempt = 0; attempt < 2 && !activeCharacter; attempt += 1) {
    const profiles = await helper.request<CharacterSaveProfile[]>('list-characters', { installationPath })
    const matchingProfiles = profiles
      .filter((profile) => !profile.error)
      .filter((profile) => profile.name.localeCompare(activeCharacterName, undefined, { sensitivity: 'base' }) === 0)

    if (activeIsHardcore === null) {
      const matchingModes = [...new Set(matchingProfiles.map((profile) => profile.isHardcore))]
      if (matchingModes.length > 1) {
        throw new Error(
          `CC found both Hardcore and Softcore saves named “${activeCharacterName}”. Wait for the game-mode handshake or rename one before dispensing.`
        )
      }
      activeIsHardcore = matchingModes[0] ?? null
    }

    if (activeIsHardcore !== null) {
      const expectedMode = activeIsHardcore
      activeCharacter = matchingProfiles
        .filter((profile) => profile.isHardcore === expectedMode)
        .sort((left, right) => Date.parse(right.lastWriteUtc) - Date.parse(left.lastWriteUtc))[0]
    }
    if (!activeCharacter) await clock.wait(500)
  }
  if (!activeCharacter) {
    throw new Error(`The active character “${activeCharacterName}” was not found in the parsed saves.`)
  }
  if (activeIsHardcore === null) {
    throw new Error(`CC could not resolve whether “${activeCharacterName}” is Hardcore or Softcore.`)
  }

  const catalog = new Map(
    (collection.supplies ?? [])
      .filter((item) => item.slot === 'augment')
      .map((item) => [item.record.toLocaleLowerCase(), item])
  )
  const selected = uniqueRecords.map((record) => {
    const item = catalog.get(record)
    if (!item) throw new Error(`The selected record is not a catalogued faction augment: ${record}`)
    const requirements = (item.acquisition?.factions ?? [])
      .filter((requirement) => requirement.kind !== 'blueprint')
    if (requirements.length === 0) {
      throw new Error(`${item.name} has no verified faction-vendor requirement and cannot be injected.`)
    }
    const authorized = requirements.some((requirement) => {
      const threshold = reputationThresholds[requirement.reputation.toLocaleLowerCase()]
      if (threshold === undefined) return false
      const faction = activeCharacter.factions.find(
        (candidate) => normalizedFactionName(candidate.name) === normalizedFactionName(requirement.faction)
      )
      return Boolean(faction?.isUnlocked && faction.value >= threshold)
    })
    if (!authorized) {
      const needed = requirements.map((requirement) => `${requirement.faction} ${requirement.reputation}`).join(' or ')
      throw new Error(`${activeCharacter.name} cannot buy ${item.name}; requires ${needed}.`)
    }
    return item
  })

  const operationId = clock.operationId()
  const receiptPaths: string[] = []
  const dispensed: typeof selected = []
  const issues: string[] = []
  const payloads = selected.map((item) => createSupplyPayload(item.record, clock))
  const payloadSha256 = createHash('sha256').update(JSON.stringify(payloads)).digest('hex')
  database.prepareDeliveryOperation({
    operationId,
    destination: 'live://personal-inventory/augments',
    payloadSha256,
    startedAtUtc: clock.nowUtc(),
    detail: { phase: 'prepared', adapter: 'cairn-live-v1', records: selected.map((item) => item.record),
      isHardcore: activeCharacter.isHardcore, payloads, expectedQueueCount: payloads.length, dispatchComplete: false }
  })
  try {
    const entries = await deliverGeneratedItems(dependencies, operationId, activeIsHardcore, 'character-inventory', payloads)
    for (const [index, result] of entries.entries()) {
      if (result.state === 'rejected') {
        issues.push(`${activeCharacter.name}'s personal inventory is full. No rejected augment was lost.`)
      } else {
        receiptPaths.push(result.receiptPath)
        dispensed.push(selected[index]!)
      }
    }
    if (dispensed.length === 0) {
      const rejection = new Error(issues[0] ?? 'No augments were delivered.')
      database.failDeliveryOperation(operationId, rejection)
      throw rejection
    }
    database.completeDeliveryOperation({
      operationId,
      receiptPath: receiptPaths[0]!,
      completedAtUtc: clock.nowUtc(),
      detail: {
        phase: 'committed',
        adapter: 'cairn-live-v1',
        records: dispensed.map((item) => item.record),
        isHardcore: activeCharacter.isHardcore,
        receiptPaths,
        rejectedCount: issues.length
      }
    })

    return {
      operationId,
      status: 'committed',
      activeCharacter: activeCharacter.name,
      dispensed: dispensed.map((item) => ({ record: item.record, name: item.name })),
      receiptPaths,
      issues
    }
  } catch (error) {
    database.markDeliveryNeedsRecovery(operationId, error)
    throw error
  }
}
