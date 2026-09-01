import assert from 'node:assert/strict'
import { BackgroundJobService } from '../src/main/ipc/background-job-service.ts'
import { BackupService } from '../src/main/ipc/backup-service.ts'
import { DiagnosticsService } from '../src/main/ipc/diagnostics-service.ts'
import { DiagnosticExportService } from '../src/main/ipc/diagnostic-export-service.ts'
import { LiveGameDomainService } from '../src/main/ipc/live-game-service.ts'
import { WindowService } from '../src/main/ipc/window-service.ts'

const listed = [{ id: 'fixture' }]
let canceledId = null
const jobs = new BackgroundJobService({
  list: () => listed,
  requestCancellation: (id) => { canceledId = id; return listed[0] }
})
assert.equal(jobs.list(), listed)
assert.equal(jobs.cancel({ id: 'fixture' }), listed[0])
assert.equal(canceledId, 'fixture')

const backup = {
  id: 'backup-1', fileName: 'backup.sqlite3', path: 'fixture/backup.sqlite3',
  createdAtUtc: new Date(0).toISOString(), reason: 'fixture', sizeBytes: 1,
  sha256: 'a'.repeat(64), schemaVersion: 1, vaultItemCount: 0, verified: true
}
let unresolved = 1
let storeCalls = 0
let restartCalls = 0
const backupService = new BackupService({
  store: {
    getStatus: async () => ({ backupDirectory: 'fixture/backups', backups: [backup], latest: backup, pendingRestore: false }),
    createBackup: async () => { storeCalls += 1; return backup },
    exportBackup: async () => { storeCalls += 1; return backup },
    stageRestore: async () => { storeCalls += 1; return backup }
  },
  unresolvedTransferCount: () => unresolved,
  selectExportPath: async () => 'fixture/export.sqlite3',
  selectRestorePath: async () => 'fixture/restore.sqlite3',
  confirmRestore: async () => true,
  runBackup: async (_key, _reason, operation) => operation(),
  runExclusive: async (operation) => operation(),
  scheduleRestart: () => { restartCalls += 1 },
  openPath: async (path) => path
})
await assert.rejects(backupService.restore(), /require recovery attention/)
assert.equal(storeCalls, 0, 'unresolved transfer recovery must block restore before mutation')
unresolved = 0
const restored = await backupService.restore()
assert.equal(restored.restarting, true)
assert.equal(storeCalls, 1)
assert.equal(restartCalls, 1)
assert.equal(await backupService.openDirectory(), 'fixture/backups')

let debugEnabled = false
let recoveryChecks = 0
const diagnosticEvents = []
const diagnostics = new DiagnosticsService({
  appVersion: () => 'fixture',
  helperHealth: async () => { throw new Error('helper unavailable') },
  safeModeStatus: () => ({ active: false, suggested: false, failedStarts: 0, threshold: 3 }),
  debugEnabled: () => debugEnabled,
  retentionPolicy: () => ({ maxFiles: 4, maxFileBytes: 1024, maxAgeDays: 7 }),
  persistDebugLogging: (enabled) => { debugEnabled = enabled },
  applyDebugLogging: () => undefined,
  info: (...event) => { diagnosticEvents.push(event) },
  warn: (...event) => { diagnosticEvents.push(event) },
  error: (...event) => { diagnosticEvents.push(event) },
  selectPreferenceExport: async () => 'fixture/preferences.json',
  reconcileRecovery: async () => { recoveryChecks += 1 },
  runExclusive: async (operation) => operation(),
  recoveryOperations: () => [{
    id: 'recovery-1', operation: 'retrieve', state: 'needs_recovery',
    startedAtUtc: new Date(0).toISOString(), hasBackup: true
  }],
  exporter: { export: async () => ({ canceled: false, path: 'fixture/support.zip' }) }
})
assert.equal((await diagnostics.getAppStatus()).helper, 'unavailable')
assert.equal(diagnostics.setDebugLogging({ enabled: true }).enabled, true)
assert.deepEqual(await diagnostics.exportPreferences({ serialized: '{}' }), {
  canceled: false, path: 'fixture/preferences.json'
})
const recovery = await diagnostics.getRecoveryStatus()
assert.equal(recoveryChecks, 1)
assert.equal(recovery.requiresAttention, true)
assert.equal(recovery.operations.length, 1)
assert.deepEqual(await diagnostics.exportDiagnostics(), {
  canceled: false, path: 'fixture/support.zip'
})
assert.equal(diagnosticEvents.length, 1)

const liveEvents = []
const liveStatus = {
  state: 'ready', detail: 'Ready.', grimDawnProcessIds: [1], itemAssistantProcessIds: [],
  hookAvailable: true, adapterDirectory: 'fixture', hookVersion: 'fixture',
  connectedProcessId: 1, isHardcore: false, activeCharacterName: 'Secret Hero',
  ingestTabSetting: 4, depositTabSetting: 5, ingestTabDescription: 'ingest',
  depositTabDescription: 'deposit', hostWindowReady: true, injectorOutput: null,
  messages: [], gameVersion: 'fixture', gameBuildId: 'fixture',
  gameDllSha256: 'a'.repeat(64), gameDllLastWriteUtc: new Date(0).toISOString(),
  hookSha256: 'b'.repeat(64), recommendation: null
}
let exportedSupport = null
const exportEvents = []
const diagnosticExportDependencies = {
  nowUtc: () => '2026-09-01T12:00:00.000Z',
  selectOutput: async () => 'fixture/support.json',
  countFiles: async () => 0,
  inspectLive: async () => liveStatus,
  helperHealth: async () => ({ service: 'fixture' }),
  applicationSummary: async () => ({
    version: 'fixture', packaged: false, electron: 'fixture', node: 'fixture',
    chrome: 'fixture', sha256: null
  }),
  systemSummary: () => ({ platform: 'fixture' }),
  helperSha256: async () => null,
  databaseSummary: () => ({ vaultItems: 0 }),
  archiveBackupStatus: async () => ({
    backupDirectory: 'C:/private/backups', backups: [backup], latest: backup,
    pendingRestore: false
  }),
  collectionSnapshot: () => null,
  inspectWriteSafety: async () => ({ allowed: true, messages: [] }),
  startupStatus: () => ({ phase: 'interactive' }),
  loggingPolicy: () => ({ maxFiles: 4 }),
  readLogs: async () => [],
  registerSecret: () => undefined,
  write: async (path, contents) => { exportedSupport = { path, contents } },
  info: (event) => exportEvents.push(event),
  error: (event) => exportEvents.push(event)
}
const exporter = new DiagnosticExportService(diagnosticExportDependencies)
assert.deepEqual(await exporter.export(), { canceled: false, path: 'fixture/support.json' })
assert.equal(exportedSupport.contents.includes('C:/private'), false)
assert.equal(exportedSupport.contents.includes('Fixture'), false)
assert.deepEqual(exportEvents, ['support-bundle.exported'])

let privacyWriteCalls = 0
const privacyExporter = new DiagnosticExportService({
  ...diagnosticExportDependencies,
  databaseSummary: () => ({ note: 'Secret Hero' }),
  write: async () => { privacyWriteCalls += 1 }
})
await assert.rejects(privacyExporter.export(), /failed its privacy check/)
assert.equal(privacyWriteCalls, 0, 'privacy failure must stop before publication')

const live = new LiveGameDomainService({
  visualDiagnosticsActive: () => false,
  inspectWriteSafety: async () => ({ allowed: true, messages: [] }),
  inspect: async () => liveStatus,
  approveBuild: async () => liveStatus,
  start: async () => liveStatus,
  stop: async () => liveStatus,
  syncIncoming: async () => ({ operationId: 'sync', status: 'committed', ingested: [], issues: [] }),
  retrieveVaultItems: async () => ({
    operationId: 'retrieve', status: 'committed',
    retrieved: [{ vaultItemId: 'a', baseRecord: 'records/a.dbr', seed: 1 }],
    receiptPaths: ['receipt/a.csv'], issues: []
  }),
  dispenseAugments: async () => ({
    operationId: 'supply', status: 'committed', activeCharacter: 'Fixture',
    dispensed: [{ record: 'records/a.dbr', name: 'A' }], receiptPaths: ['receipt/s.csv'], issues: []
  }),
  recoverSpecialItem: async ({ destination }) => ({
    operationId: 'special', status: 'committed', activeCharacter: 'Fixture',
    destination, record: 'records/special.dbr', receiptPaths: ['receipt/m.csv'], issues: []
  }),
  runTransferExclusive: async (operation) => {
    liveEvents.push('exclusive')
    return operation()
  },
  diagnostics: {
    run: async (event, operation) => {
      liveEvents.push(`diagnostic:${event}`)
      return operation()
    }
  },
  queueArchiveBackup: (reason) => liveEvents.push(`backup:${reason}`)
})
assert.equal((await live.inspect()).state, 'ready')
assert.equal((await live.retrieve(['a'])).retrieved.length, 1)
assert.deepEqual(liveEvents, [
  'diagnostic:live-retrieval', 'exclusive', 'backup:live retrieval'
])

const startup = {
  startedAtUtc: new Date(0).toISOString(), cacheOutcome: 'pending', cachedPaintMs: null,
  interactiveMs: null, scanState: 'pending', scanSettledMs: null,
  rollAnalysisState: 'pending', rollAnalysisSettledMs: null, backgroundPhase: 'opening-cache'
}
let safeRestart = null
let zoom = null
let healthyCalls = 0
const windows = new WindowService({
  restart: (safe) => { safeRestart = safe },
  startupStatus: () => startup,
  recordStartupPhase: () => startup,
  markHealthy: async () => { healthyCalls += 1 },
  recordHealthFailure: () => undefined,
  openDataDirectory: async () => 'fixture/data'
})
windows.restartInSafeMode()
assert.equal(safeRestart, true)
assert.equal(windows.setZoomFactor({ sender: { setZoomFactor: (factor) => { zoom = factor } } }, { factor: 4 }), 1.8)
assert.equal(zoom, 1.8)
windows.reportStartupPhase({ phase: 'interactive' })
await Promise.resolve()
assert.equal(healthyCalls, 1)

console.log('System domain service checks passed.')
