import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { IPC_CHANNELS } from '../src/shared/contracts.ts'
import { decodeIpcError, IpcClientError } from '../src/shared/ipc-error-transport.ts'
import { createMainIpcDomains, MAIN_IPC_CHANNELS } from '../src/main/ipc/domains.ts'
import {
  IpcDomainService,
  SerializedServiceQueue
} from '../src/main/ipc/service-registry.ts'
import {
  booleanField,
  validateCollectionRequest,
  validateSpecialRecovery,
  validateVaultPage
} from '../src/main/ipc/validation.ts'
import {
  registerManagedShutdown,
  registerPrimaryWindowLifecycle,
  registerWindowStatePersistence
} from '../src/main/window-lifecycle.ts'
import { MainOperationCoordinator } from '../src/main/operation-coordinator.ts'

function fakeEvent() {
  return {
    sender: {
      isDestroyed: () => false,
      send: () => undefined,
      setZoomFactor: () => undefined
    }
  }
}

function asElectronClientError(error) {
  const transported = structuredClone(error)
  return decodeIpcError(new Error(`Error invoking remote method 'fixture': Error: ${transported.message}`))
}

const registered = new Map()
const registrar = {
  handle(channel, listener) {
    assert.equal(registered.has(channel), false, `duplicate handler: ${channel}`)
    registered.set(channel, listener)
  }
}
const domains = createMainIpcDomains(registrar)
const ownedChannels = Object.values(MAIN_IPC_CHANNELS).flat()
assert.equal(new Set(ownedChannels).size, ownedChannels.length, 'domain channel ownership must be unique')
const eventOnlyChannels = new Set([IPC_CHANNELS.backgroundJobChanged, IPC_CHANNELS.gdiaImportProgress])
const requestChannels = Object.values(IPC_CHANNELS).filter((channel) => !eventOnlyChannels.has(channel))
assert.deepEqual([...ownedChannels].sort(), [...requestChannels].sort(), 'every request contract needs one domain owner')

let serviceCalls = 0
domains.diagnostics.handle(
  IPC_CHANNELS.setDebugLogging,
  (_event, input) => {
    serviceCalls += 1
    return input.enabled
  },
  booleanField('enabled', 'Debug logging requires a boolean.')
)
const debugHandler = registered.get(IPC_CHANNELS.setDebugLogging)
assert.equal(await debugHandler(fakeEvent(), { enabled: true }), true)
assert.equal(serviceCalls, 1, 'a valid handler must delegate exactly once')
await assert.rejects(
  debugHandler(fakeEvent(), { enabled: 'yes' }),
  (error) => {
    const clientError = asElectronClientError(error)
    return clientError instanceof IpcClientError &&
      clientError.code === 'diagnostics.invalid-debug-setting' &&
      clientError.message === 'Choose a valid debug-logging setting.'
  }
)
assert.equal(serviceCalls, 1, 'invalid input must not reach the service')

assert.throws(
  () => domains.backups.handle(IPC_CHANNELS.scanCollection, () => undefined),
  /is not owned by the backups service/
)
assert.deepEqual(
  validateCollectionRequest({ sourcePaths: ['fixture/player.gst'], basis: 'stashes' }),
  { sourcePaths: ['fixture/player.gst'], basis: 'stashes' }
)
assert.deepEqual(
  validateSpecialRecovery({ destination: 'character-inventory', expectedCharacterName: 'Fixture' }),
  { destination: 'character-inventory', expectedCharacterName: 'Fixture' }
)

const failureHandlers = new Map()
const failures = new IpcDomainService('archive', {
  handle: (channel, listener) => failureHandlers.set(channel, listener)
})
failures.handle('known', () => { throw new Error('Vault item does not exist: private-id') })
failures.handle('unknown', () => { throw new Error('Native boundary failed at C:\\Users\\private') })
await assert.rejects(
  failureHandlers.get('known')(fakeEvent()),
  (error) => {
    const clientError = asElectronClientError(error)
    return clientError instanceof IpcClientError &&
      clientError.code === 'archive.item-unavailable' &&
      clientError.message === 'One or more requested archive items are no longer available.'
  }
)
await assert.rejects(
  failureHandlers.get('unknown')(fakeEvent()),
  (error) => {
    const clientError = asElectronClientError(error)
    return clientError instanceof IpcClientError &&
      clientError.code === 'archive.failed' &&
      clientError.message === 'The archive operation failed safely.' &&
      !error.message.includes('private') &&
      !clientError.message.includes('private')
  }
)

assert.throws(
  () => validateVaultPage({ state: 'ingested', sort: 'recent', direction: 'desc', offset: 0, limit: 251 }),
  /outside their safe bounds/
)
assert.throws(
  () => validateVaultPage({ state: 'ingested', sort: 'recent', direction: 'desc', offset: 0, limit: 50, query: 42 }),
  /filters are outside their safe bounds/
)

const queue = new SerializedServiceQueue()
const order = []
let releaseFirst
const firstGate = new Promise((resolve) => { releaseFirst = resolve })
const first = queue.run(async () => {
  order.push('first:start')
  await firstGate
  order.push('first:fail')
  throw new Error('simulated persistence failure')
})
const second = queue.run(async () => {
  order.push('second:start')
  return 42
})
await Promise.resolve()
assert.deepEqual(order, ['first:start'])
releaseFirst()
await assert.rejects(first, /simulated persistence failure/)
assert.equal(await second, 42)
await queue.flush()
assert.deepEqual(order, ['first:start', 'first:fail', 'second:start'])

const diagnosticEvents = []
let unresolvedTransfers = 1
let reconciliations = 0
const operationCoordinator = new MainOperationCoordinator({
  diagnostics: {
    operationStarted: (scope, event, correlationId, data) => {
      diagnosticEvents.push(['started', scope, event, correlationId, data])
      return 123
    },
    operationCompleted: (scope, event, correlationId, startedAt, data) => {
      diagnosticEvents.push(['completed', scope, event, correlationId, startedAt, data])
    },
    operationFailed: (scope, event, correlationId, startedAt, error) => {
      diagnosticEvents.push(['failed', scope, event, correlationId, startedAt, error.message])
    }
  },
  reconcileTransfers: async () => { reconciliations += 1 },
  unresolvedTransferCount: () => unresolvedTransfers
})
let transferCalls = 0
await assert.rejects(
  operationCoordinator.runTransferExclusive(async () => { transferCalls += 1 }),
  /require recovery attention/
)
assert.equal(transferCalls, 0, 'unresolved recovery must fail closed before a native write')
unresolvedTransfers = 0
assert.equal(await operationCoordinator.runTransferExclusive(async () => {
  transferCalls += 1
  return 'committed'
}), 'committed')
assert.equal(reconciliations, 2)
assert.equal(transferCalls, 1)

assert.equal(await operationCoordinator.runDiagnostic(
  'transfer', 'happy', async () => 7, { requested: 1 }, (result) => ({ result }), 'correlation-ok'
), 7)
await assert.rejects(
  operationCoordinator.runDiagnostic(
    'transfer', 'failure', async () => { throw new Error('known boundary failure') },
    undefined, undefined, 'correlation-failed'
  ),
  /known boundary failure/
)
assert.deepEqual(diagnosticEvents.map((entry) => entry[0]), ['started', 'completed', 'started', 'failed'])
await operationCoordinator.flush()

const listeners = new Map()
let quitCalls = 0
let createCalls = 0
const lifecycleApp = {
  on(event, listener) { listeners.set(event, listener) },
  quit() { quitCalls += 1 }
}
const focused = []
const primaryWindow = {
  isMinimized: () => true,
  restore: () => focused.push('restore'),
  show: () => focused.push('show'),
  focus: () => focused.push('focus')
}
let windows = [primaryWindow]
registerPrimaryWindowLifecycle({
  app: lifecycleApp,
  getWindows: () => windows,
  createWindow: async () => { createCalls += 1 },
  platform: 'win32'
}, true)
listeners.get('second-instance')()
assert.deepEqual(focused, ['restore', 'show', 'focus'])
windows = []
listeners.get('activate')()
await Promise.resolve()
assert.equal(createCalls, 1)
listeners.get('window-all-closed')()
assert.equal(quitCalls, 1)

const placementListeners = new Map()
const placementWindow = {
  on(event, listener) { placementListeners.set(event, listener) }
}
let placementWrites = 0
let releasePlacementWrite
const placementWriteGate = new Promise((resolve) => { releasePlacementWrite = resolve })
let placementReadable = true
let placementState = 'moved-state'
const persistedPlacements = []
const placementPersistence = registerWindowStatePersistence(
  placementWindow,
  () => {
    assert.equal(placementReadable, true, 'placement must be captured before the window is destroyed')
    return placementState
  },
  async (state) => {
    placementWrites += 1
    persistedPlacements.push(state)
    if (placementWrites === 1) await placementWriteGate
  },
  (error) => { throw error }
)
assert.equal(placementListeners.has('move'), false, 'continuous move events must not trigger persistence')
assert.equal(placementListeners.has('resize'), false, 'continuous resize events must not trigger persistence')
assert.deepEqual(
  [...placementListeners.keys()],
  ['moved', 'resized', 'maximize', 'unmaximize', 'close']
)
placementListeners.get('moved')()
await Promise.resolve()
assert.equal(placementWrites, 1)
placementState = 'resized-state'
placementListeners.get('resized')()
placementState = 'maximized-state'
placementListeners.get('maximize')()
assert.equal(placementWrites, 1, 'events during a write must be coalesced')
placementState = 'closing-state'
placementListeners.get('close')()
placementReadable = false
releasePlacementWrite()
await placementPersistence.finalize()
assert.equal(placementWrites, 2, 'the newest state must be persisted after a concurrent event')
assert.deepEqual(
  persistedPlacements,
  ['moved-state', 'closing-state'],
  'close must synchronously capture and persist the final readable state'
)

const shutdownPlacementListeners = new Map()
let shutdownPlacementReadable = true
let shutdownPlacementWrites = 0
const shutdownPlacement = registerWindowStatePersistence(
  { on(event, listener) { shutdownPlacementListeners.set(event, listener) } },
  () => {
    assert.equal(shutdownPlacementReadable, true)
    return 'before-quit-state'
  },
  async (state) => {
    assert.equal(state, 'before-quit-state')
    shutdownPlacementWrites += 1
  },
  (error) => { throw error }
)

let shutdownCalls = 0
let shutdownFailure = null
let releaseShutdown
const shutdownGate = new Promise((resolve) => { releaseShutdown = resolve })
registerManagedShutdown(lifecycleApp, async () => {
  shutdownCalls += 1
  await shutdownPlacement.finalize()
  await shutdownGate
  throw new Error('simulated flush failure')
}, (error) => { shutdownFailure = error })
let prevented = 0
const beforeQuit = listeners.get('before-quit')
beforeQuit({ preventDefault: () => { prevented += 1 } })
beforeQuit({ preventDefault: () => { prevented += 1 } })
assert.equal(shutdownCalls, 1, 'repeated quit must share one shutdown workflow')
assert.equal(prevented, 2)
await Promise.resolve()
assert.equal(shutdownPlacementWrites, 1, 'before-quit must capture placement before window close')
releaseShutdown()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.match(shutdownFailure.message, /simulated flush failure/)
assert.equal(quitCalls, 2)
shutdownPlacementListeners.get('close')()
shutdownPlacementReadable = false
await shutdownPlacement.flush()
assert.equal(shutdownPlacementWrites, 1, 'terminal close must not enqueue work after finalization')

const mainSource = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
assert.equal(mainSource.includes('ipcMain.handle('), false, 'index.ts must not register raw IPC handlers')
for (const [domain, channels] of Object.entries(MAIN_IPC_CHANNELS)) {
  for (const channel of channels) {
    const contractName = Object.entries(IPC_CHANNELS).find(([, value]) => value === channel)?.[0]
    assert.ok(contractName, `missing shared contract for ${channel}`)
    const route = new RegExp(`ipcDomains\\.${domain}\\.handle\\(\\s*IPC_CHANNELS\\.${contractName}`)
    assert.equal(route.test(mainSource), true, `missing ${domain} route for ${contractName}`)
  }
}

console.log(`IPC service checks passed (${ownedChannels.length} channels across ${Object.keys(MAIN_IPC_CHANNELS).length} domains).`)
