import { join } from 'node:path';
import type { CollectionDatabase } from '../collection-database.ts';
import type { TransferPorts, TransferClock } from './runtime.ts';
import type { LiveQueueReceipt, LiveRetrievalQueue, LiveRetrievalStatus } from './contracts.ts';
import type { CharacterSaveProfile, CollectionSnapshot, LiveGameStatus, LiveSupplyDispenseResult, SpecialRecoveryDestination, SpecialItemRecoveryResult } from '../../shared/contracts.ts';
import type { LiveVaultPayload } from '../collection-presentation.ts';
import { createHash } from 'node:crypto';

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

export async function executeSahdinasMementoRecovery(
  dependencies: LiveDeliveryDependencies,
  collection: CollectionSnapshot,
  destination: SpecialRecoveryDestination,
  expectedCharacterName?: string
): Promise<SpecialItemRecoveryResult> {
  const { helper, database, paths, clock } = dependencies
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
  let queued = false
  database.prepareDeliveryOperation({
    operationId,
    destination: `live://special-recovery/${destination}`,
    payloadSha256,
    startedAtUtc: clock.nowUtc(),
    detail: { phase: 'prepared', adapter: 'cairn-live-v1', record: SAHDINAS_MEMENTO.record, destination, isHardcore: activeIsHardcore }
  })
  try {
    const queue = await helper.request<LiveRetrievalQueue>('enqueue-live-retrieval', {
      operationId,
      isHardcore: activeIsHardcore,
      destination,
      item
    })
    queued = true
    database.updatePendingOperationDetail(operationId, {
      phase: 'queued',
      queues: [queue]
    })
    const deadline = clock.now() + 30_000
    while (clock.now() < deadline) {
      const result = await helper.request<LiveRetrievalStatus>('inspect-live-retrieval', { queue })
      if (result.state === 'rejected') {
        if (!result.receiptPath) {
          throw new Error('The game rejected the recovery without returning a durable queue receipt.')
        }
        await helper.request<LiveQueueReceipt>('ack-live-incoming', {
          path: result.receiptPath,
          expectedSha256: queue.semanticSha256,
          receiptDirectory: join(paths.receipts, 'rejected-special-recoveries')
        })
        const target = destination === 'character-inventory' ? 'personal inventory' : status.depositTabDescription
        const rejection = new Error(`The game rejected the recovery because the ${target} is full. No replacement was delivered.`)
        database.failDeliveryOperation(operationId, rejection)
        queued = false
        throw rejection
      }
      if (result.state === 'deposited' && result.receiptPath) {
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
      }
      await clock.wait(150)
    }
    throw new Error(
      'Timed out waiting for Grim Dawn to acknowledge Sahdina\'s Memento. Do not click recovery again until the pending live queue has resolved.'
    )
  } catch (error) {
    if (queued) database.markDeliveryNeedsRecovery(operationId, error)
    else database.failDeliveryOperation(operationId, error)
    throw error
  }
}

export async function executeLiveAugmentDispense(
  dependencies: LiveDeliveryDependencies,
  collection: CollectionSnapshot,
  records: string[],
  expectedCharacterName?: string
): Promise<LiveSupplyDispenseResult> {
  const { helper, database, paths, clock } = dependencies
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
  const queued: Array<{ item: (typeof selected)[number]; queue: LiveRetrievalQueue }> = []
  const payloads = selected.map((item) => createSupplyPayload(item.record, clock))
  const payloadSha256 = createHash('sha256').update(JSON.stringify(payloads)).digest('hex')
  database.prepareDeliveryOperation({
    operationId,
    destination: 'live://personal-inventory/augments',
    payloadSha256,
    startedAtUtc: clock.nowUtc(),
    detail: { phase: 'prepared', adapter: 'cairn-live-v1', records: selected.map((item) => item.record), isHardcore: activeCharacter.isHardcore }
  })
  try {
    for (const [index, item] of selected.entries()) {
      const queue = await helper.request<LiveRetrievalQueue>('enqueue-live-retrieval', {
        operationId: `${operationId}-${index}`,
        isHardcore: activeIsHardcore,
        destination: 'character-inventory',
        item: payloads[index]
      })
      queued.push({ item, queue })
      database.updatePendingOperationDetail(operationId, {
        phase: 'queued',
        queues: queued.map((entry) => entry.queue)
      })
    }

    const pending = new Map(queued.map((entry) => [entry.queue.operationId, entry]))
    const deadline = clock.now() + 30_000
    while (clock.now() < deadline && pending.size > 0) {
      for (const [pendingId, entry] of [...pending.entries()]) {
        const result = await helper.request<LiveRetrievalStatus>('inspect-live-retrieval', { queue: entry.queue })
        if (result.state === 'rejected') {
          if (!result.receiptPath) throw new Error('The game rejected an augment without returning a durable queue receipt.')
          await helper.request<LiveQueueReceipt>('ack-live-incoming', {
            path: result.receiptPath,
            expectedSha256: entry.queue.semanticSha256,
            receiptDirectory: join(paths.receipts, 'rejected-personal-deliveries')
          })
          issues.push(`${activeCharacter.name}'s personal inventory is full. No rejected augment was lost.`)
          pending.delete(pendingId)
        } else if (result.state === 'deposited' && result.receiptPath) {
          receiptPaths.push(result.receiptPath)
          dispensed.push(entry.item)
          pending.delete(pendingId)
        }
      }
      if (pending.size > 0) await clock.wait(150)
    }
    if (pending.size > 0) {
      throw new Error(`Timed out waiting for Grim Dawn to acknowledge ${pending.size} personal-inventory ${pending.size === 1 ? 'delivery' : 'deliveries'}. Do not retry until CC resolves the pending queue.`)
    }
    if (dispensed.length === 0) {
      const rejection = new Error(issues[0] ?? 'No augments were delivered.')
      database.failDeliveryOperation(operationId, rejection)
      queued.length = 0
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
    if (queued.length > 0) database.markDeliveryNeedsRecovery(operationId, error)
    else database.failDeliveryOperation(operationId, error)
    throw error
  }
}
