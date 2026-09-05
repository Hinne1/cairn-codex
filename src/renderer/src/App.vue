<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { createSetsSession } from './workspaces/sets'
import SetsWorkspace from './workspaces/SetsWorkspace.vue'
import { createCollectionDashboard } from './workspaces/collection-dashboard'
import CollectionDashboard from './workspaces/CollectionDashboard.vue'
import CollectionTriviaDialog from './workspaces/CollectionTriviaDialog.vue'
import FailureProbe from './components/FailureProbe.vue'
import OnboardingDialog from './components/OnboardingDialog.vue'
import WorkspaceSidebar from './components/WorkspaceSidebar.vue'
import WorkspaceErrorBoundary from './components/WorkspaceErrorBoundary.vue'
import { formatPresentationLine } from './item-presentation'
import { createItemInspectionSession } from './inspection/item-inspection'
import ItemInspectionDrawer from './inspection/ItemInspectionDrawer.vue'
import { applyCopyFavorite, createCopyFavorites } from './inspection/copy-favorites'
import cairnCodexLogo from '../../../build/icon.svg?url'
import CollectionFarmingWorkspace from './workspaces/CollectionFarmingWorkspace.vue'
import type { CollectionFarmingControls } from './workspaces/collection-farming'
import DismantlingWorkspace from './workspaces/DismantlingWorkspace.vue'
import { createDismantlingSession, type DismantlingControls } from './workspaces/dismantling'
import StashOracleWorkspace from './workspaces/StashOracleWorkspace.vue'
import type { StashOracleControls } from './workspaces/stash-oracle'
import LevelingPlannerWorkspace from './workspaces/LevelingPlannerWorkspace.vue'
import { createLevelingPlannerSession } from './workspaces/leveling-planner'
import SkillExplorerWorkspace from './workspaces/SkillExplorerWorkspace.vue'
import {
  buildSkillNames,
  type SkillExplorerControls
} from './workspaces/skill-explorer'
import {
  researchItemTypeLabel,
  researchRarityLabel
} from './workspaces/research-item-table'
import MiWorkshopWorkspace from './workspaces/MiWorkshopWorkspace.vue'
import {
  buildMiMetricOptions,
  createMiWorkshopSession,
  type MiWorkshopControls,
  updateMiWorkshopControls
} from './workspaces/mi-workshop'
import CollectionMaterialsWorkspace from './workspaces/CollectionMaterialsWorkspace.vue'
import {
  buildCollectionRollSummaries,
  collectionRollFocusForSort,
  updateCollectionMaterialsControls,
  type CollectionMaterialsControls,
  type CollectionControls,
  type MaterialsControls
} from './workspaces/collection-materials'
import SettingsWorkspace from './workspaces/SettingsWorkspace.vue'
import GlossaryWorkspace from './workspaces/GlossaryWorkspace.vue'
import { glossaryEntry } from './workspaces/glossary'
import {
  defaultWorkspaceToolIds,
  essentialWorkspaceToolIds,
  workspaceToolDefinitions,
  type MiCountingMode,
  type WorkspaceToolId
} from './workspaces/settings'
import TransfersWorkspace from './workspaces/TransfersWorkspace.vue'
import { createTransfersSession } from './workspaces/transfers'
import SuppliesWorkspace from './workspaces/SuppliesWorkspace.vue'
import {
  createSupplyAccessSummary,
  createSupplySession,
  type SupplyControls
} from './workspaces/supplies'
import type { SupplySelectionItem } from '@shared/workspace-query-contracts'
import { useCollectionCopies } from './collection-copies'
import { createNotificationService, type AppNotification } from './notification-service'
import { resolveActiveCharacter } from './live-presence'
import { preferredScrollBehavior } from './motion-preference'
import { CollectionSession, type CollectionPendingReads } from './collection-session'
import { collectionRequestKey } from '@shared/collection-request'
import {
  resetUiPreferences,
  type RendererFailureReport
} from './renderer-recovery'
import {
  createPreferenceRepository,
  type StoredTodoItem as TodoItem,
  type TooltipBoundaryScrollPreference
} from './preference-repository'
import {
  appRouteHref,
  createAppHistoryEntry,
  parseAppHistoryEntry,
  parseAppRouteHash,
  type ActiveView,
  type AppHistoryEntry,
  type AppRoute,
  type MaterialCategory,
  type TransferMode
} from './app-route'
import {
  setItemDiscovered,
} from './set-semantics'
import {
  ONBOARDING_STEP_COUNT,
  applyContinueWithoutImport,
  type OnboardingStatus
} from './onboarding'
import type { OracleCandidate } from './stash-oracle'
import {
  isAvailableViaAwakening,
  isCollectionOwned,
  withAwakeningAvailability
} from '@shared/collection-availability'
import {
  type SearchDocument,
  type SearchFieldValue
} from '@shared/search-query'
import type {
  ArchiveBackupStatus,
  AppStatus,
  CharacterSaveProfile,
  CollectionBasis,
  CollectionItem,
  CollectionRaritySummary,
  CollectionSnapshot,
  DebugLoggingStatus,
  GdiaImportResult,
  GrimDawnDiscovery,
  ItemGrantedSkillPresentation,
  ItemPresentation,
  ItemRollAnalysis,
  LiveGameStatus,
  MapRegionLocation,
  ObservedStashItem,
  OperationHistoryPage,
  RecoveryStatus,
  StagingTabInspection,
  StartupPhaseEvent,
  StartupStatus,
  VaultItemPage,
  VaultListItem,
  VaultSummary,
  WriteSafetyStatus
} from '@shared/contracts'
import type { AnyBackgroundJobSnapshot } from '@shared/background-jobs'

interface TooltipAffix {
  record: string
  name: string
  kind: 'prefix' | 'suffix'
  rarity: 'magical' | 'rare'
  presentation?: ItemPresentation
}

const startupRecoveryParameters = new URLSearchParams(window.location.search)
const safeModeActive = ref(startupRecoveryParameters.get('safeMode') === '1')
const safeModeSuggested = ref(startupRecoveryParameters.get('safeModeSuggested') === '1')
const failedStartupCount = ref(Math.max(0, Number(startupRecoveryParameters.get('failedStarts') ?? 0) || 0))
const safeModeOfferOpen = ref(safeModeSuggested.value && !safeModeActive.value)
const safeModeBusy = ref(false)
const safeModeDialog = ref<HTMLElement | null>(null)
const simulateWorkspaceFailure = startupRecoveryParameters.get('simulateWorkspaceError') === '1'
const preferenceRepository = createPreferenceRepository({
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => {
    localStorage.setItem(key, value)
    if (key === 'cairn-codex-preferences') {
      void window.cairnCodex.savePreferences(value).catch((error) => {
        console.error('Could not persist the durable preference document.', error)
      })
    }
  }
})
const initialPreferences = preferenceRepository.value
const initialOnboardingPreference = {
  ...initialPreferences.onboarding,
  shouldOpen: initialPreferences.onboarding.status === 'in-progress'
}

const discovery = ref<GrimDawnDiscovery | null>(null)
// Collection snapshots are immutable and replaced wholesale. Keeping thousands of
// catalog records shallow avoids proxying every tooltip line, set tier, and drop
// location while preserving reactive updates when a new snapshot arrives.
const snapshot = shallowRef<CollectionSnapshot | null>(null)
const indexStashPaths = ref<string[]>([...initialPreferences.sources.indexPaths])
const archiveStashPaths = ref<string[]>([...initialPreferences.sources.archivePaths])
const collectionBasis = ref<CollectionBasis>(initialPreferences.sources.collectionBasis)
const enabledStashPaths = computed<string[]>({
  get: () =>
    collectionBasis.value === 'archive' ? archiveStashPaths.value : indexStashPaths.value,
  set: (paths) => {
    if (collectionBasis.value === 'archive') archiveStashPaths.value = paths
    else indexStashPaths.value = paths
  }
})
const collectionPending = ref<CollectionPendingReads>({ cache: 0, scan: 0, rebuild: 0, hydration: 0 })
const scanning = computed(() => collectionPending.value.cache + collectionPending.value.scan + collectionPending.value.rebuild > 0)
const appInitializing = ref(true)
const archiveRollHydrating = computed(() => collectionPending.value.hydration > 0)
const archiveRollHydrationCompleted = ref(0)
const archiveRollHydrationTotal = ref(0)
const scanActivity = ref<'collection' | 'game-data'>('collection')
const backgroundJobs = ref<AnyBackgroundJobSnapshot[]>([])
const activeBackgroundJob = computed(() => backgroundJobs.value
  .filter((job) => job.status === 'queued' || job.status === 'running')
  .sort((left, right) => right.updatedAtUtc.localeCompare(left.updatedAtUtc))[0] ?? null)
let stopBackgroundJobUpdates: (() => void) | null = null
let stopArchiveRecoveryUpdates: (() => void) | null = null
const startupPhaseStatus = ref<StartupStatus | null>(null)
const notifications = createNotificationService()
const currentNotification = notifications.current
const notificationAnnouncement = notifications.announcement
const cacheIssue = ref<string | null>(null)
const collectionContext = () => ({ basis: collectionBasis.value, sourcePaths: [...enabledStashPaths.value] })
const collectionSession = new CollectionSession({
  context: collectionContext,
  install: applySnapshot,
  reload: () => { void reloadCollection() },
  pendingChanged: pending => { collectionPending.value = pending },
  reportError: (error, kind) => {
    if (kind === 'cache') cacheIssue.value = readableError(error)
    else if (kind === 'scan') reportScanProblem(readableError(error))
    else if (kind === 'rebuild') reportTransferProblem(readableError(error))
    else console.warn('Archived item rolls could not be hydrated in the background.', error)
  }
})
watch(() => collectionRequestKey(collectionContext()), () => collectionSession.contextChanged(), { flush: 'sync' })
const startupBackgroundPhase = computed<StartupStatus['backgroundPhase']>(() =>
  appInitializing.value && !snapshot.value
    ? 'opening-cache'
    : scanning.value
      ? 'collection-scan'
      : archiveRollHydrating.value
        ? 'roll-analysis'
        : 'idle'
)
const zoomFactor = ref(initialPreferences.appearance.zoomFactor)
const tooltipBoundaryScroll = ref<TooltipBoundaryScrollPreference>(initialPreferences.appearance.tooltipBoundaryScroll)
const failedItemIconUrls = ref(new Set<string>())
const activeView = ref<ActiveView>('collection')
const glossaryEntryId = ref(glossaryEntry(null).id)
const setsSession = createSetsSession({
  items: () => snapshot.value?.items ?? [],
  itemSearchDocument: itemStructuredSearchDocument,
  restoringHistory: () => restoringAppHistory
})
const { query, rarityFilter, setProgressFilter, setFeatureFilter, setSortMode, setSortDirection,
  currentPage, collectionSets } = setsSession
const collectionControls = ref<CollectionControls>({
  category: 'All', query: '', ownership: 'all', rarity: 'all', sort: 'recent', direction: 'desc', page: 1
})
const materialsControls = ref<MaterialsControls>({
  category: 'all', query: '', ownership: 'all', rarity: 'all', sort: 'recent', direction: 'desc', page: 1
})
const activeCollectionMaterialsControls = computed<CollectionMaterialsControls>({
  get: () => activeView.value === 'materials' ? materialsControls.value : collectionControls.value,
  set: (controls) => {
    if (activeView.value === 'materials') materialsControls.value = controls as MaterialsControls
    else collectionControls.value = controls as CollectionControls
  }
})
const trackerCollapsed = ref(initialPreferences.appearance.trackerCollapsed)
const navigationCollapsed = ref(initialPreferences.appearance.navigationCollapsed)
const miCountingMode = ref<MiCountingMode>(initialPreferences.workspace.miCountingMode)
const showLegacyScanner = ref(initialPreferences.workspace.showLegacyScanner)
const skillExplorerControls = ref<SkillExplorerControls>({
  skill: initialPreferences.search.selectedSkill,
  query: '',
  scope: initialPreferences.search.skillScope,
  rarity: 'all',
  slot: 'all',
  sort: 'level',
  direction: 'asc',
  page: 1
})
const oracleControls = ref<StashOracleControls>({
  query: '',
  characterClass: initialPreferences.search.oracleClass,
  style: initialPreferences.search.oracleStyle,
  readiness: 'all',
  minimumLevel: initialPreferences.search.oracleMinimumLevel,
  maximumLevel: initialPreferences.search.oracleMaximumLevel,
  sort: 'score',
  direction: 'desc',
  page: 1
})
const transfersSession = createTransfersSession()
const {
  mode: transferMode,
  section: transferSection,
  historyQuery: transferHistoryQuery,
  historyOutcome: transferHistoryOutcome,
  historyPage: transferHistoryPage,
  vaultQuery,
  vaultRarity: vaultRarityFilter,
  vaultSort: vaultSortMode,
  vaultDirection: vaultSortDirection,
  vaultPage,
  quarantinePage: vaultQuarantinePage,
  selectedVaultIds,
  historyStructuredQuery,
  vaultStructuredQuery
} = transfersSession
const inspectionSession = createItemInspectionSession({
  contextKey: () => JSON.stringify([collectionRequestKey(collectionContext()), snapshot.value?.isHardcore]),
  available: () => Boolean(snapshot.value),
  items: () => plannerCatalogItems.value,
  copies: () => allOwnedCopies.value,
  observedCopies: () => snapshot.value?.observedItems ?? [],
  affixes: () => affixByRecord.value,
  metric: () => miWorkshopControls.value.metric,
  metricDirection: () => miWorkshopControls.value.metricDirection,
  storedCopyFor: vaultItemForObserved,
  modeFor: copy => stashChoices.value.find(stash => stash.path === copy.sourcePath)?.isHardcore ?? snapshot.value?.isHardcore ?? false,
  setPinnedBest: (record, instanceKey, isHardcore) => window.cairnCodex.setPinnedBest(record, instanceKey, isHardcore)
})
const {
  selectedRecord, selectedReferenceInstanceKey, selectedItem
} = inspectionSession
const archiveQueryRevision = ref(0)
const { archiveItems: vaultItems, copies: allOwnedCopies, archivedRecords: archivedRecordSet } = useCollectionCopies({
  observedCopies: () => snapshot.value?.observedItems ?? [],
  catalogItems: () => plannerCatalogItems.value,
  basis: () => collectionBasis.value,
  enabled: () => Boolean(snapshot.value) && collectionBasis.value === 'stashes' &&
    ['collection', 'sets', 'planner', 'skills', 'oracle', 'mi-workshop', 'farming'].includes(activeView.value),
  context: () => ({ isHardcore: snapshot.value?.isHardcore, revision: archiveQueryRevision.value,
    source: JSON.stringify([collectionBasis.value, snapshot.value?.scannedStashes.map(stash => stash.path)]) }),
  query: request => window.cairnCodex.queryVaultItems(request),
  reportError: error => console.warn('Archive comparison copies could not be refreshed.', error)
})
const favoriteRecords = computed(() => new Set(allOwnedCopies.value
  .filter(copy => copy.isFavorite).map(copy => copy.baseRecord.toLocaleLowerCase())))
const copyFavorites = createCopyFavorites({
  contextKey: () => JSON.stringify([collectionRequestKey(collectionContext()), snapshot.value?.isHardcore, snapshot.value?.scannedAtUtc]),
  modeFor: copy => copy.isHardcore,
  write: (instanceKey, isHardcore, favorite) => window.cairnCodex.setFavoriteItem(instanceKey, isHardcore, favorite),
  reconcile: () => { void reloadCollection() },
  apply: (instanceKey, isHardcore, favorite) => {
    vaultItems.value = applyCopyFavorite(vaultItems.value, instanceKey, isHardcore, favorite)
    storedVaultPage.value = { ...storedVaultPage.value, items: applyCopyFavorite(storedVaultPage.value.items, instanceKey, isHardcore, favorite) }
    if (snapshot.value) collectionSession.commit({ ...snapshot.value,
      observedItems: applyCopyFavorite(snapshot.value.observedItems, instanceKey, isHardcore, favorite) })
  },
  reportError: error => notifications.notify({ key: 'favorite-copy', title: 'Could not save favorite',
    message: readableError(error), severity: 'error', timeoutMs: null })
})
const querySupplyItems = window.cairnCodex.querySupplies
const selectSupplyBoosts = window.cairnCodex.selectSupplyBoosts
const queryDismantlingItems = window.cairnCodex.queryDismantling
const selectDismantlingDuplicates = window.cairnCodex.selectDismantlingDuplicates
watch(snapshot, () => {
  archiveQueryRevision.value++
  void refreshSupplySummary().catch(error => console.warn('Supply summary could not be refreshed.', error))
})
const vaultSummary = ref<VaultSummary>({
  total: 0,
  ingested: 0,
  retrievalPending: 0,
  retrieved: 0,
  quarantined: 0,
  supplies: 0
})
const vaultSummaryStatus = ref<'loading' | 'ready' | 'unavailable'>('loading')
const storedVaultPage = ref<VaultItemPage>({ items: [], total: 0, offset: 0, limit: 100 })
const quarantineVaultPage = ref<VaultItemPage>({ items: [], total: 0, offset: 0, limit: 100 })
const vaultPageLoading = ref(false)
const staging = ref<StagingTabInspection | null>(null)
const writeSafety = ref<WriteSafetyStatus | null>(null)
const selectedStashPath = ref(initialPreferences.sources.retrievalStash)
const vaultPageSize = 100
const operationHistory = ref<OperationHistoryPage>({ items: [], total: 0, offset: 0, limit: 50 })
const operationHistoryLoading = ref(false)
const operationHistoryPageSize = 50
const supplyControls = ref<SupplyControls>({
  category: 'writs',
  slot: 'all',
  query: '',
  mode: transferMode.value,
  page: 1
})
const supplySession = createSupplySession()
const experimentalToolsEnabled = ref(safeModeActive.value ? false : initialPreferences.workspace.experimentalToolsEnabled)
const visibleWorkspaceToolIds = ref<WorkspaceToolId[]>([...initialPreferences.workspace.visibleTools])
const toolSettingsOpen = ref(false)
const farmingControls = ref<CollectionFarmingControls>({ query: '', rarity: 'all', page: 1 })
const dismantlingControls = ref<DismantlingControls>({ query: '', mode: 'all', rarity: 'all' })
const dismantlingSession = createDismantlingSession()
const miWorkshopControls = ref<MiWorkshopControls>({
  query: '',
  affix: 'all',
  metric: 'overall',
  metricDirection: 'desc',
  sort: 'metric',
  page: 1
})
const miWorkshopSession = createMiWorkshopSession()
const miWorkshopWorkspace = ref<{ syncNativeControls: () => void } | null>(null)
const infiniteSupplies = ref(true)
const infiniteSuppliesBusy = ref(false)
const diagnosticsBusy = ref(false)
const preferenceExportBusy = ref(false)
const debugLoggingBusy = ref(false)
const debugLoggingStatus = ref<DebugLoggingStatus>({
  enabled: false,
  maxFiles: 3,
  maxFileBytes: 256 * 1024,
  maxAgeDays: 7
})
const archiveBackupBusy = ref<'backup' | 'export' | 'restore' | null>(null)
const archiveBackupStatus = ref<ArchiveBackupStatus | null>(null)
const onboardingOpen = ref(
  !safeModeActive.value && !safeModeOfferOpen.value && initialOnboardingPreference.shouldOpen
)
const onboardingStep = ref(initialOnboardingPreference.step)
const onboardingStatus = ref<OnboardingStatus>(initialOnboardingPreference.status)
const recoveryStatus = ref<RecoveryStatus | null>(null)
const vaultBusy = ref(false)
const sahdinaRecoveryBusy = ref<'shared-stash' | 'character-inventory' | null>(null)
const liveStatus = ref<LiveGameStatus | null>(null)
const headerCharacters = ref<CharacterSaveProfile[]>([])
const liveIssues = ref<string[]>([])
const liveSyncing = ref(false)
const liveLifecyclePolling = ref(false)
const showConnectionDiagnostics = ref(false)
const todoOpen = ref(false)
const triviaOpen = ref(false)
const todoDraft = ref('')
const todoInput = ref<HTMLInputElement | null>(null)
const todos = ref<TodoItem[]>(structuredClone(initialPreferences.notes.todos))
const manualDisconnectProcessId = ref<number | null>(null)
const liveDisconnectPending = ref(false)
const canNavigateBack = ref(false)
const canNavigateForward = ref(false)
const autoLiveConnect = ref(safeModeActive.value ? false : initialPreferences.sources.autoLiveConnect)
const tooltipRecord = ref<string | null>(null)
const tooltipCopyAffixes = ref<{ prefixRecord: string; suffixRecord: string } | null>(null)
const tooltipPosition = ref({ left: 0, top: 0 })
const tooltipMaxHeight = computed(() => Math.max(180, window.innerHeight - tooltipPosition.value.top - 14))
const onboardingInstallCount = computed(() => discovery.value?.installations.length ?? 0)
const onboardingSaveCount = computed(() => discovery.value?.saveLocations.length ?? 0)
const tooltipElement = ref<HTMLElement | null>(null)
const tooltipDetailsHeld = ref(false)
let tooltipTimer: ReturnType<typeof setTimeout> | null = null
let tooltipHideTimer: ReturnType<typeof setTimeout> | null = null
let liveSyncTimer: ReturnType<typeof setInterval> | null = null
let liveLifecycleTimer: ReturnType<typeof setInterval> | null = null
let liveSyncInFlight = false
let vaultPageTimer: ReturnType<typeof setTimeout> | null = null
let operationHistoryTimer: ReturnType<typeof setTimeout> | null = null
let vaultPageRequestId = 0
let operationHistoryRequestId = 0
let appHistoryReady = false
let restoringAppHistory = false
let appHistoryIndex = 0
let appHistoryMaximum = 0

const targetStash = computed(() =>
  stashChoices.value.find((stash) => stash.path === selectedStashPath.value) ?? null
)
const activeTransferHardcore = computed(() =>
  transferMode.value === 'live' && liveStatus.value?.isHardcore !== null && liveStatus.value?.isHardcore !== undefined
    ? liveStatus.value.isHardcore
    : targetStash.value?.isHardcore
)
const transferableVaultItems = computed(() => storedVaultPage.value.items)
const availableVaultItems = computed(() => storedVaultPage.value.items)
const vaultPageCount = computed(() => Math.max(1, Math.ceil(storedVaultPage.value.total / vaultPageSize)))
const visibleAvailableVaultItems = computed(() => availableVaultItems.value)
const reusableSupplySummary = ref<CollectionRaritySummary>({ rarity: 'supply', total: 0, collected: 0, availableCopies: 0 })
let supplySummaryGeneration = 0
const supplyAccessSummary = computed(() => createSupplyAccessSummary(
  snapshot.value?.supplies ?? [],
  activeCharacter.value
))
const workspaceToolIdSet = computed(() => new Set(visibleWorkspaceToolIds.value))
const visibleWorkspaceTools = computed(() =>
  workspaceToolDefinitions
    .filter((tool) => workspaceToolVisible(tool.id))
    .map(({ id, label }) => ({ id, label }))
)
const activeHistoryKind = computed(() =>
  transferSection.value === 'ingest-history' ? 'ingest' as const : 'retrieve' as const
)
const archivedCopyCount = computed(() => vaultSummary.value.ingested)
const stashChoices = computed(() => snapshot.value?.availableStashes ?? snapshot.value?.scannedStashes ?? [])
const activeSourceCount = computed(() => snapshot.value?.scannedStashes.length ?? 0)
const sourceModeLabel = computed(() => {
  const modes = new Set(snapshot.value?.scannedStashes.map((stash) => stash.isHardcore) ?? [])
  if (modes.size > 1) return 'Mixed modes'
  if (modes.has(true)) return 'Hardcore'
  if (modes.has(false)) return 'Softcore'
  return 'No sources'
})
const gameConnectionLabel = computed(() => {
  if (liveStatus.value?.state === 'ready') return 'Grim Dawn connected'
  if (liveStatus.value?.state === 'connecting') return 'Connecting to Grim Dawn'
  if (liveStatus.value?.state === 'available') return 'Grim Dawn detected'
  if (liveStatus.value?.state === 'blocked') return 'Live adapter blocked'
  if (liveStatus.value?.grimDawnProcessIds.length && liveStatus.value.gameDllSha256) return 'Build verification needed'
  return 'Grim Dawn offline'
})
const connectionColorState = computed(() =>
  liveStatus.value?.state === 'ready'
    ? 'connected'
    : liveStatus.value?.state === 'connecting'
      ? 'connecting'
      : 'offline'
)
const activeCharacter = computed(() => resolveActiveCharacter(liveStatus.value, headerCharacters.value))
const activeCharacterClass = computed(() => {
  const character = activeCharacter.value
  if (!character) return ''
  const allocated = character.skills
    .map((skill) => skill.name)
    .filter((name) => name && !name.toLocaleLowerCase().includes('mastery'))
  const storedClass = character.classRecord?.trim() ?? ''
  return character.className?.trim() ||
    (!storedClass.toLocaleLowerCase().startsWith('tag') ? storedClass : '') ||
    allocated.slice(0, 2).join(' · ') ||
    'Unknown class'
})
const headerConnectionAction = computed(() => {
  if (liveStatus.value?.state === 'ready' || liveStatus.value?.state === 'connecting' || liveStatus.value?.hostWindowReady) {
    return 'Disconnect'
  }
  if (liveStatus.value?.state === 'available') return 'Connect'
  return 'Details'
})
const connectionRecommendation = computed(() => {
  if (liveStatus.value?.state === 'ready') {
    return `Live ingest is watching the ${liveStatus.value.ingestTabDescription}; retrieval uses the ${liveStatus.value.depositTabDescription}.`
  }
  if (liveStatus.value?.state === 'connecting') return 'Enter the character world, then retry Connect if the handshake does not complete.'
  if (manualDisconnectProcessId.value !== null) return 'Disconnected for this game session. Select Connect whenever you want to resume.'
  if (liveStatus.value?.recommendation) return liveStatus.value.recommendation
  if (liveStatus.value?.state === 'available') return 'Select Connect, or enable Auto-connect in Settings.'
  return 'Start Grim Dawn and enter a character world. CC will detect it within ten seconds.'
})
const connectionFingerprint = computed(() => liveStatus.value?.gameDllSha256?.slice(0, 12) ?? null)
const canApproveCurrentGameBuild = computed(() =>
  liveStatus.value?.state === 'unavailable' &&
  liveStatus.value.grimDawnProcessIds.length === 1 &&
  Boolean(liveStatus.value.gameDllSha256) &&
  liveStatus.value.detail.includes('new to CC')
)
const dashboard = createCollectionDashboard({
  snapshot: () => snapshot.value,
  miCountingMode: () => miCountingMode.value,
  sets: () => collectionSets.value
})
const { rarity, categoryProgressByName } = dashboard

const plannerCatalogItems = computed(() => [
  ...(snapshot.value?.items ?? []),
  ...(snapshot.value?.plannerItems ?? [])
])
const remainingTodoCount = computed(() => todos.value.filter((todo) => !todo.done).length)
const orderedTodos = computed(() => [...todos.value].sort((left, right) =>
  Number(left.done) - Number(right.done) ||
  Date.parse(right.createdAt) - Date.parse(left.createdAt)
))

const tooltipItem = computed(() =>
  [
    ...(snapshot.value?.supplies ?? []),
    ...(snapshot.value?.materials ?? []),
    ...plannerCatalogItems.value
  ].find((item) => item.record === tooltipRecord.value) ?? null
)

const collectionRollSummaries = computed(() => buildCollectionRollSummaries(
  allOwnedCopies.value,
  collectionRollFocusForSort(collectionControls.value.sort)
))

const skillNames = computed(() => buildSkillNames(
  plannerCatalogItems.value,
  snapshot.value?.skillMasteries
))

const plannerSession = createLevelingPlannerSession({
  initialPreferences,
  items: () => plannerCatalogItems.value,
  snapshot: () => snapshot.value,
  skillNames: () => skillNames.value,
  archivedRecords: () => archivedRecordSet.value,
  isArchivedItem,
  ownershipLabel: plannerOwnershipLabel,
  itemSearchDocument: itemStructuredSearchDocument,
  formatPresentationLine,
  persistPlanner: (patch) => preferenceRepository.update('planner', patch),
  persistDisplay: (plannerDisplay) => preferenceRepository.update('appearance', { plannerDisplay }),
  listCharacters: () => window.cairnCodex.listCharacters(),
  readableError,
  reportProblem: reportTransferProblem,
  reportSuccess
})
const recipeStatus = plannerSession.recipeStatus

const affixByRecord = computed(() => {
  const byRecord = new Map<string, {
    name: string
    kind: 'prefix' | 'suffix'
    rarity: 'magical' | 'rare'
    presentation?: ItemPresentation
  }>()
  for (const affix of snapshot.value?.affixes ?? []) {
    for (const record of affix.records) {
      byRecord.set(record.toLocaleLowerCase(), {
        name: affix.name,
        kind: affix.kind,
        rarity: affix.rarity,
        presentation: affix.presentations?.[record]
      })
    }
  }
  return byRecord
})

const tooltipAffixes = computed<TooltipAffix[]>(() => {
  const copy = tooltipCopyAffixes.value
  if (!copy) return []
  const result: TooltipAffix[] = []
  for (const record of [copy.prefixRecord, copy.suffixRecord]) {
    if (!record) continue
    const affix = affixByRecord.value.get(record.toLocaleLowerCase())
    if (affix) result.push({ record, ...affix })
  }
  return result
})

const tooltipDisplayName = computed(() => {
  if (!tooltipItem.value) return ''
  const prefix = tooltipAffixes.value.find((affix) => affix.kind === 'prefix')?.name
  const suffix = tooltipAffixes.value.find((affix) => affix.kind === 'suffix')?.name
  return [prefix, tooltipItem.value.name, suffix].filter(Boolean).join(' ')
})

function isDoubleRareMiCopy(copy: ObservedStashItem): boolean {
  return affixByRecord.value.get(copy.prefixRecord.toLocaleLowerCase())?.rarity === 'rare' &&
    affixByRecord.value.get(copy.suffixRecord.toLocaleLowerCase())?.rarity === 'rare'
}

const doubleRareMiBaseRecords = computed(() => new Set(
  allOwnedCopies.value
    .filter(isDoubleRareMiCopy)
    .map((copy) => copy.baseRecord.toLocaleLowerCase())
))

const miMetricOptions = computed(() => buildMiMetricOptions(allOwnedCopies.value))

const selectedMiMetric = computed({
  get: () => miWorkshopControls.value.metric,
  set: (metric: MiWorkshopControls['metric']) => {
    miWorkshopControls.value = updateMiWorkshopControls(miWorkshopControls.value, { metric }, true)
  }
})
const selectedMiMetricDirection = computed({
  get: () => miWorkshopControls.value.metricDirection,
  set: (metricDirection: MiWorkshopControls['metricDirection']) => {
    miWorkshopControls.value = updateMiWorkshopControls(miWorkshopControls.value, { metricDirection }, true)
  }
})

function currentAppRoute(): AppRoute {
  const itemRecord = selectedRecord.value
  switch (activeView.value) {
    case 'collection': return { version: 1, workspace: 'collection', itemRecord, controls: {
      ...collectionControls.value
    } }
    case 'sets': return { version: 1, workspace: 'sets', itemRecord, controls: setsSession.routeControls.value }
    case 'materials': return { version: 1, workspace: 'materials', itemRecord, controls: {
      ...materialsControls.value
    } }
    case 'skills': return { version: 1, workspace: 'skills', itemRecord, controls: {
      ...skillExplorerControls.value
    } }
    case 'planner': return { version: 1, workspace: 'planner', itemRecord, controls: plannerSession.routeControls.value }
    case 'oracle': return { version: 1, workspace: 'oracle', itemRecord, controls: {
      ...oracleControls.value
    } }
    case 'mi-workshop': return { version: 1, workspace: 'mi-workshop', itemRecord, controls: {
      ...miWorkshopControls.value
    } }
    case 'supplies': return { version: 1, workspace: 'supplies', itemRecord, controls: {
      ...supplyControls.value
    } }
    case 'farming': return { version: 1, workspace: 'farming', itemRecord, controls: {
      ...farmingControls.value
    } }
    case 'dismantling': return { version: 1, workspace: 'dismantling', itemRecord, controls: {
      ...dismantlingControls.value
    } }
    case 'vault': return { version: 1, workspace: 'vault', itemRecord, controls: {
      mode: transferMode.value, section: transferSection.value, historyQuery: transferHistoryQuery.value,
      historyOutcome: transferHistoryOutcome.value, historyPage: transferHistoryPage.value,
      vaultQuery: vaultQuery.value, vaultRarity: vaultRarityFilter.value, vaultSort: vaultSortMode.value,
      vaultDirection: vaultSortDirection.value, vaultPage: vaultPage.value, quarantinePage: vaultQuarantinePage.value
    } }
    case 'settings': return { version: 1, workspace: 'settings', itemRecord, controls: {} }
    case 'glossary': return { version: 1, workspace: 'glossary', itemRecord: null, controls: { entry: glossaryEntryId.value } }
  }
}

function currentAppHistoryState(index = appHistoryIndex): AppHistoryEntry {
  return createAppHistoryEntry(index, currentAppRoute(), selectedReferenceInstanceKey.value)
}

function writeAppHistory(mode: 'push' | 'replace', index = appHistoryIndex): void {
  const state = currentAppHistoryState(index)
  const href = appRouteHref(state.route, window.location.href)
  if (mode === 'push') window.history.pushState(state, '', href)
  else window.history.replaceState(state, '', href)
}

function updateHistoryButtons(): void {
  canNavigateBack.value = appHistoryIndex > 0
  canNavigateForward.value = appHistoryIndex < appHistoryMaximum
}

function restoreAppRoute(route: AppRoute, referenceInstanceKey: string | null = null): void {
  restoringAppHistory = true
  activeView.value = route.workspace
  inspectionSession.restore(route.itemRecord, referenceInstanceKey)
  switch (route.workspace) {
    case 'collection':
      collectionControls.value = { ...route.controls }
      break
    case 'sets':
      setsSession.restoreRoute(route.controls)
      break
    case 'materials':
      materialsControls.value = { ...route.controls }
      break
    case 'skills':
      skillExplorerControls.value = { ...route.controls }
      break
    case 'planner':
      plannerSession.restoreRoute(route.controls)
      break
    case 'oracle':
      oracleControls.value = {
        ...route.controls,
        maximumLevel: Math.max(route.controls.minimumLevel, route.controls.maximumLevel)
      }
      break
    case 'mi-workshop':
      miWorkshopControls.value = { ...route.controls }
      break
    case 'supplies':
      supplyControls.value = { ...route.controls }
      transferMode.value = route.controls.mode
      break
    case 'farming':
      farmingControls.value = { ...route.controls }
      break
    case 'dismantling':
      dismantlingControls.value = { ...route.controls }
      break
    case 'vault':
      transferMode.value = route.controls.mode
      transferSection.value = route.controls.section
      transferHistoryQuery.value = route.controls.historyQuery
      transferHistoryOutcome.value = route.controls.historyOutcome
      transferHistoryPage.value = route.controls.historyPage
      vaultQuery.value = route.controls.vaultQuery
      vaultRarityFilter.value = route.controls.vaultRarity
      vaultSortMode.value = route.controls.vaultSort
      vaultSortDirection.value = route.controls.vaultDirection
      vaultPage.value = route.controls.vaultPage
      vaultQuarantinePage.value = route.controls.quarantinePage
      break
    case 'settings': break
    case 'glossary': glossaryEntryId.value = route.controls.entry; break
  }
  void nextTick(() => {
    if (route.workspace === 'mi-workshop') miWorkshopWorkspace.value?.syncNativeControls()
    if (route.workspace === 'vault') {
      scheduleOperationHistoryRefresh()
      scheduleVaultPageRefresh()
    }
    restoringAppHistory = false
  })
}

function handlePageShow(): void {
  const entry = parseAppHistoryEntry(window.history.state)
  const route = entry?.route ?? parseAppRouteHash(window.location.hash)
  if (route) restoreAppRoute(route, entry?.referenceInstanceKey)
}

function handleAppHistory(event: PopStateEvent): void {
  const entry = parseAppHistoryEntry(event.state)
  const route = entry?.route ?? parseAppRouteHash(window.location.hash)
  if (!route) return
  appHistoryIndex = entry?.index ?? 0
  appHistoryMaximum = Math.max(appHistoryMaximum, appHistoryIndex)
  restoreAppRoute(route, entry?.referenceInstanceKey)
  updateHistoryButtons()
}

function navigateAppHistory(direction: 'back' | 'forward'): void {
  if (direction === 'back' && canNavigateBack.value) window.history.back()
  if (direction === 'forward' && canNavigateForward.value) window.history.forward()
}

function returnToCollection(): void {
  selectedRecord.value = null
  activeView.value = 'collection'
}

watch(
  [
    () => skillExplorerControls.value.skill,
    () => skillExplorerControls.value.scope
  ],
  ([selectedSkill, skillScope]) => preferenceRepository.update('search', { selectedSkill, skillScope })
)
watch(miCountingMode, (miCountingMode) => preferenceRepository.update('workspace', { miCountingMode }))
watch(
  () => [
    oracleControls.value.characterClass,
    oracleControls.value.style,
    oracleControls.value.minimumLevel,
    oracleControls.value.maximumLevel
  ] as const,
  ([oracleClass, oracleStyle, oracleMinimumLevel, oracleMaximumLevel]) => preferenceRepository.update('search', {
    oracleClass,
    oracleStyle,
    oracleMinimumLevel,
    oracleMaximumLevel
  })
)
watch([activeView, selectedRecord, transferSection, plannerSession.selectedPlannerProfileId, glossaryEntryId], () => {
  if (!appHistoryReady || restoringAppHistory) return
  appHistoryIndex += 1
  appHistoryMaximum = appHistoryIndex
  writeAppHistory('push')
  updateHistoryButtons()
}, { flush: 'post' })
watch(
  [
    collectionControls, materialsControls,
    selectedReferenceInstanceKey,
    query, rarityFilter, currentPage,
    setProgressFilter, setFeatureFilter, setSortMode, setSortDirection,
    skillExplorerControls,
    oracleControls,
    miWorkshopControls,
    plannerSession.routeControls,
    supplyControls,
    farmingControls,
    dismantlingControls,
    transferMode, transferHistoryQuery, transferHistoryOutcome, transferHistoryPage,
    vaultQuery, vaultRarityFilter, vaultSortMode, vaultSortDirection, vaultPage, vaultQuarantinePage
  ],
  () => {
    if (!appHistoryReady || restoringAppHistory) return
    writeAppHistory('replace')
  },
  { flush: 'post', deep: true }
)
watch(navigationCollapsed, (navigationCollapsed) => preferenceRepository.update('appearance', { navigationCollapsed }))
watch(tooltipBoundaryScroll, (tooltipBoundaryScroll) => preferenceRepository.update('appearance', { tooltipBoundaryScroll }))
watch(transferMode, () => {
  if (supplyControls.value.mode !== transferMode.value) {
    supplyControls.value = { ...supplyControls.value, mode: transferMode.value }
  }
  if (restoringAppHistory) return
  selectedVaultIds.value = []
  vaultPage.value = 1
  vaultQuarantinePage.value = 1
  supplySession.selectedIds.value = []
})
watch(transferSection, (section) => {
  selectedVaultIds.value = []
  if (!restoringAppHistory) transferHistoryPage.value = 1
  if (section === 'ingest-history' || section === 'dispense-history') scheduleOperationHistoryRefresh()
})
watch([transferHistoryQuery, transferHistoryOutcome], () => {
  if (restoringAppHistory) return
  transferHistoryPage.value = 1
  scheduleOperationHistoryRefresh()
})
watch(transferHistoryPage, scheduleOperationHistoryRefresh)
watch([vaultQuery, vaultRarityFilter, vaultSortMode, vaultSortDirection, activeTransferHardcore], () => {
  if (restoringAppHistory) return
  vaultPage.value = 1
  selectedVaultIds.value = []
  scheduleVaultPageRefresh()
})
watch(vaultPage, () => {
  selectedVaultIds.value = []
  scheduleVaultPageRefresh()
})
watch(vaultQuarantinePage, () => {
  selectedVaultIds.value = []
  scheduleVaultPageRefresh()
})
watch(vaultPageCount, (count) => {
  if (vaultPage.value > count) vaultPage.value = count
})
watch(() => supplyControls.value.mode, (mode) => {
  if (transferMode.value !== mode) transferMode.value = mode
})
watch(visibleWorkspaceToolIds, (toolIds) => {
  preferenceRepository.update('workspace', { visibleTools: [...toolIds] })
}, { deep: true })

watch(selectedStashPath, async (path) => {
  if (path) {
    preferenceRepository.update('sources', { retrievalStash: path })
    await refreshStaging()
  }
})

watch(activeView, async (view) => {
  void window.cairnCodex.recordNavigation(view).catch(() => undefined)
  await nextTick()
  window.scrollTo({ top: 0, behavior: 'auto' })
  if (view === 'vault' || view === 'supplies' || view === 'dismantling') {
    await refreshVault()
    if (view !== 'dismantling') await pollLiveLifecycle()
  }
})

watch([onboardingOpen, appInitializing], ([open, initializing]) => {
  document.body.classList.toggle('onboarding-active', open && !initializing)
})

watch(safeModeOfferOpen, async (open) => {
  document.body.classList.toggle('safe-mode-offer-active', open)
  if (!open) return
  await nextTick()
  safeModeDialog.value?.focus()
})

async function reportStartupPhase(phase: StartupPhaseEvent): Promise<void> {
  try {
    startupPhaseStatus.value = await window.cairnCodex.reportStartupPhase(phase)
  } catch (error) {
    console.warn(`Startup phase ${phase} could not be recorded.`, error)
  }
}

async function waitForPaint(): Promise<void> {
  await nextTick()
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
}

function retainBackgroundJob(job: AnyBackgroundJobSnapshot): void {
  const remaining = backgroundJobs.value.filter((candidate) => candidate.id !== job.id)
  backgroundJobs.value = [job, ...remaining].slice(0, 50)
}

async function cancelActiveBackgroundJob(): Promise<void> {
  const job = activeBackgroundJob.value
  if (!job?.cancellation.canCancel) return
  try {
    const updated = await window.cairnCodex.cancelBackgroundJob(job.id)
    if (updated) retainBackgroundJob(updated)
  } catch (error) {
    reportTransferProblem(readableError(error))
  }
}

onMounted(async () => {
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
  window.scrollTo(0, 0)
  const existingHistoryEntry = parseAppHistoryEntry(window.history.state)
  const initialRoute = existingHistoryEntry?.route ?? parseAppRouteHash(window.location.hash)
  appHistoryIndex = existingHistoryEntry?.index ?? 0
  appHistoryMaximum = appHistoryIndex
  if (initialRoute) restoreAppRoute(initialRoute, existingHistoryEntry?.referenceInstanceKey)
  writeAppHistory('replace', appHistoryIndex)
  appHistoryReady = true
  updateHistoryButtons()
  window.addEventListener('popstate', handleAppHistory)
  window.addEventListener('pageshow', handlePageShow)
  window.addEventListener('keydown', handleEscape)
  window.addEventListener('keyup', handleTooltipKeyUp)
  window.addEventListener('wheel', handleZoomWheel, { passive: false })
  stopBackgroundJobUpdates = window.cairnCodex.onBackgroundJobChanged(retainBackgroundJob)
  stopArchiveRecoveryUpdates = window.cairnCodex.onArchiveRecoveryChanged(() => {
    collectionSession.invalidate()
    void refreshVault()
  })
  try {
    backgroundJobs.value = await window.cairnCodex.getBackgroundJobs()
  } catch (error) {
    console.warn('Background job state could not be restored after navigation.', error)
  }
  void window.cairnCodex.reportPreferenceLoad(preferenceRepository.diagnostics).catch((error) => {
    console.warn('Preference migration diagnostics could not be recorded.', error)
  })
  try {
    try {
      const appStatus: AppStatus = await window.cairnCodex.getAppStatus()
      safeModeActive.value = appStatus.safeMode.active
      safeModeSuggested.value = appStatus.safeMode.suggested || startupRecoveryParameters.get('safeModeSuggested') === '1'
      failedStartupCount.value = Math.max(appStatus.safeMode.failedStarts, failedStartupCount.value)
      safeModeOfferOpen.value = safeModeSuggested.value && !appStatus.safeMode.active
      if (appStatus.safeMode.active) {
        experimentalToolsEnabled.value = false
        autoLiveConnect.value = false
        onboardingOpen.value = false
        if (activeView.value === 'oracle' || activeView.value === 'dismantling') {
          activeView.value = 'collection'
        }
      }
    } catch (error) {
      console.warn('Startup recovery status could not be loaded.', error)
    }
    zoomFactor.value = await window.cairnCodex.setZoomFactor(zoomFactor.value)
    try {
      infiniteSupplies.value = await window.cairnCodex.getInfiniteSupplies()
    } catch (error) {
      console.warn('Stored-supply setting could not be loaded; preserving the safe default.', error)
    }
    try {
      debugLoggingStatus.value = await window.cairnCodex.getDebugLogging()
    } catch (error) {
      console.warn('Diagnostic logging setting could not be loaded; preserving bounded standard logging.', error)
    }
    await refreshRecoveryStatus()
    if (recoveryStatus.value?.requiresAttention && onboardingOpen.value) {
      persistOnboarding('in-progress')
      onboardingOpen.value = false
      activeView.value = 'settings'
    }
    await refreshArchiveBackupStatus()
    // Establish live ownership before catalog projection/scanning queues any heavyweight
    // helper work. This keeps reconnect independent from collection startup time.
    await pollLiveLifecycle()
    liveSyncTimer = setInterval(() => void syncLiveMode(), 1000)
    liveLifecycleTimer = setInterval(() => void pollLiveLifecycle(), 10_000)
    const startupCache: { snapshot: CollectionSnapshot | null } = { snapshot: null }
    const cacheCurrent = await collectionSession.run('cache', async (read) => {
      const value = await window.cairnCodex.getCachedCollection(read.context.sourcePaths, read.context.basis)
      if (read.install(value)) startupCache.snapshot = value
    })
    const cached = startupCache.snapshot
    if (!cacheCurrent) return
    if (cached) {
      await reportStartupPhase('cache-hit')
      await waitForPaint()
      await reportStartupPhase('cached-paint')
      await reportStartupPhase('interactive')
      // While live mode owns the hook, keep the helper responsive to durable queue work.
      // The cached catalog is complete enough to browse; heavy scan/roll refreshes remain
      // manual and run automatically once the game session ends.
      if (cached.cacheNeedsRefresh && liveStatus.value?.state !== 'ready') {
        void scanCollection(true)
      } else {
        await reportStartupPhase('scan-skipped')
        void hydrateArchiveRolls(true)
      }
    } else {
      await reportStartupPhase('cache-miss')
      await scanCollection(true, false)
      await waitForPaint()
      await reportStartupPhase('interactive')
      void hydrateArchiveRolls(true)
    }
    void refreshVault()
    await nextTick()
    window.scrollTo({ top: 0, behavior: 'auto' })
  } finally {
    appInitializing.value = false
  }
})

onBeforeUnmount(() => {
  collectionSession.dispose()
  stopBackgroundJobUpdates?.()
  stopBackgroundJobUpdates = null
  stopArchiveRecoveryUpdates?.()
  stopArchiveRecoveryUpdates = null
  document.body.classList.remove('onboarding-active')
  window.removeEventListener('popstate', handleAppHistory)
  window.removeEventListener('pageshow', handlePageShow)
  window.removeEventListener('keydown', handleEscape)
  window.removeEventListener('keyup', handleTooltipKeyUp)
  window.removeEventListener('wheel', handleZoomWheel)
  cancelTooltip()
  cancelTooltipHide()
  if (liveSyncTimer) clearInterval(liveSyncTimer)
  if (liveLifecycleTimer) clearInterval(liveLifecycleTimer)
  notifications.clear()
  if (vaultPageTimer) clearTimeout(vaultPageTimer)
  if (operationHistoryTimer) clearTimeout(operationHistoryTimer)
  cancelSearchDocumentWarmup()
})

async function scanCollection(startupRun = false, hydrateAfter = true): Promise<void> {
  scanActivity.value = 'collection'
  clearScanProblem()
  let shouldHydrate = false
  if (startupRun) await reportStartupPhase('scan-started')
  await collectionSession.run('scan', async (read) => {
    const result = await window.cairnCodex.scanCollection(read.context.sourcePaths, read.context.basis)
    if (read.install(result)) {
      shouldHydrate = liveStatus.value?.state !== 'ready'
    }
  })
  if (startupRun) await reportStartupPhase('scan-settled')
  if (hydrateAfter && shouldHydrate) void hydrateArchiveRolls(startupRun)
  else if (hydrateAfter && startupRun) await reportStartupPhase('roll-analysis-skipped')
}

async function rebuildGameDataIndex(): Promise<void> {
  scanActivity.value = 'game-data'
  await collectionSession.run('rebuild', async (read) => {
    const result = await window.cairnCodex.rebuildGameDataIndex(
      read.context.sourcePaths, read.context.basis
    )
    if (read.install(result)) reportSuccess('Game-data and map location indexes rebuilt from the installed Grim Dawn files.')
  })
}

async function exportDiagnostics(): Promise<void> {
  diagnosticsBusy.value = true
  try {
    const result = await window.cairnCodex.exportDiagnostics()
    if (!result.canceled) reportSuccess(`Redacted support bundle saved to ${result.path}.`)
  } catch (error) {
    reportTransferProblem(readableError(error))
  } finally {
    diagnosticsBusy.value = false
  }
}

async function reportRendererFailure(failure: RendererFailureReport): Promise<void> {
  await window.cairnCodex.reportRendererError(failure)
}

function returnToCollectionAfterFailure(): void {
  selectedRecord.value = null
  activeView.value = 'collection'
}

async function restartInSafeMode(): Promise<void> {
  if (safeModeBusy.value) return
  safeModeBusy.value = true
  try {
    await window.cairnCodex.restartInSafeMode()
  } catch (error) {
    reportTransferProblem(`CC could not restart in safe mode: ${readableError(error)}`)
    safeModeBusy.value = false
  }
}

async function restartNormally(): Promise<void> {
  if (safeModeBusy.value) return
  safeModeBusy.value = true
  try {
    await window.cairnCodex.restartNormally()
  } catch (error) {
    reportTransferProblem(`CC could not restart normally: ${readableError(error)}`)
    safeModeBusy.value = false
  }
}

function dismissSafeModeOffer(): void {
  safeModeOfferOpen.value = false
}

function resetInterfacePreferences(): void {
  const confirmed = window.confirm(
    'Reset display and workspace preferences? Your Codex Archive, planner profiles, to-do list, saves, stashes, and backups will not be changed.'
  )
  if (!confirmed) return
  resetUiPreferences(localStorage)
  reportSuccess('Reset interface preferences. Planner profiles, to-dos, sources, and archive data were preserved. Reloading CC…')
  window.setTimeout(() => window.location.reload(), 250)
}

function trapSafeModeFocus(event: KeyboardEvent): void {
  const dialog = safeModeDialog.value
  if (!dialog) return
  const candidates = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled])')]
  if (!candidates.length) return
  const first = candidates[0]!
  const last = candidates[candidates.length - 1]!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

async function setDebugLogging(enabled: boolean): Promise<void> {
  if (debugLoggingBusy.value) return
  debugLoggingBusy.value = true
  try {
    debugLoggingStatus.value = await window.cairnCodex.setDebugLogging(enabled)
    reportSuccess(enabled
      ? `Debug logging enabled for up to ${debugLoggingStatus.value.maxAgeDays} days.`
      : 'Debug logging disabled; standard bounded diagnostics remain active.')
  } catch (error) {
    reportTransferProblem(readableError(error))
  } finally {
    debugLoggingBusy.value = false
  }
}

async function openDataDirectory(): Promise<void> {
  const error = await window.cairnCodex.openDataDirectory()
  if (error) reportTransferProblem(`Windows could not open CC's data folder: ${error}`)
}

async function refreshArchiveBackupStatus(): Promise<void> {
  try {
    archiveBackupStatus.value = await window.cairnCodex.getArchiveBackupStatus()
  } catch (error) {
    console.warn('Archive backup status could not be loaded.', error)
  }
}

async function createArchiveBackup(): Promise<void> {
  if (archiveBackupBusy.value) return
  archiveBackupBusy.value = 'backup'
  try {
    const result = await window.cairnCodex.createArchiveBackup()
    if (result.backup) {
      reportSuccess(`Verified archive backup created with ${result.backup.vaultItemCount.toLocaleString()} stored copies.`)
    }
    await refreshArchiveBackupStatus()
  } catch (error) {
    reportTransferProblem(readableError(error))
  } finally {
    archiveBackupBusy.value = null
  }
}

async function exportArchiveBackup(): Promise<void> {
  if (archiveBackupBusy.value) return
  archiveBackupBusy.value = 'export'
  try {
    const result = await window.cairnCodex.exportArchiveBackup()
    if (!result.canceled && result.path) {
      reportSuccess(`Verified archive backup exported to ${result.path}.`)
    }
    await refreshArchiveBackupStatus()
  } catch (error) {
    reportTransferProblem(readableError(error))
  } finally {
    archiveBackupBusy.value = null
  }
}

async function restoreArchiveBackup(): Promise<void> {
  if (archiveBackupBusy.value) return
  archiveBackupBusy.value = 'restore'
  try {
    const result = await window.cairnCodex.restoreArchiveBackup()
    if (!result.canceled && result.restarting) {
      reportSuccess('Backup verified. CC is restarting to restore the archive.')
    }
  } catch (error) {
    reportTransferProblem(readableError(error))
  } finally {
    archiveBackupBusy.value = null
  }
}

async function openArchiveBackupDirectory(): Promise<void> {
  const error = await window.cairnCodex.openArchiveBackupDirectory()
  if (error) reportTransferProblem(`Windows could not open CC's archive backup folder: ${error}`)
}

function handleArchiveBackupAction(action: 'backup' | 'export' | 'restore' | 'open-folder'): void {
  if (action === 'backup') void createArchiveBackup()
  else if (action === 'export') void exportArchiveBackup()
  else if (action === 'restore') void restoreArchiveBackup()
  else void openArchiveBackupDirectory()
}

function handleSafeModeRestart(enabled: boolean): void {
  if (enabled) void restartInSafeMode()
  else void restartNormally()
}

async function handleGdiaImportCompleted(result: GdiaImportResult): Promise<void> {
  try {
    if (collectionBasis.value !== 'archive') {
      collectionBasis.value = 'archive'
      preferenceRepository.update('sources', { collectionBasis: 'archive' })
    }
    await loadSelectedSources()
    reportSuccess(result.importedItems > 0
      ? `Imported ${result.importedItems} Item Assistant ${result.importedItems === 1 ? 'copy' : 'copies'} into the Codex Archive.`
      : `Item Assistant import found no new copies; ${result.duplicateItems} were already archived.`)
  } catch (error) {
    reportTransferProblem(readableError(error))
  }
}

function persistOnboarding(status: OnboardingStatus, step = onboardingStep.value): void {
  const boundedStep = Math.max(0, Math.min(ONBOARDING_STEP_COUNT - 1, Math.trunc(step)))
  preferenceRepository.update('onboarding', { status, step: boundedStep })
  onboardingStatus.value = status
  onboardingStep.value = boundedStep
}

function setOnboardingStep(step: number): void {
  persistOnboarding('in-progress', step)
}

function skipOnboarding(): void {
  persistOnboarding('skipped')
  onboardingOpen.value = false
}

function finishOnboarding(): void {
  persistOnboarding('completed', ONBOARDING_STEP_COUNT - 1)
  onboardingOpen.value = false
}

function resumeOnboarding(restart = false): void {
  const step = restart ? 0 : onboardingStep.value
  persistOnboarding('in-progress', step)
  onboardingOpen.value = true
}

function openOnboardingSettings(): void {
  persistOnboarding('in-progress')
  onboardingOpen.value = false
  activeView.value = 'settings'
  window.scrollTo({ top: 0, behavior: 'auto' })
}

async function handleOnboardingImportCompleted(result: GdiaImportResult): Promise<void> {
  await handleGdiaImportCompleted(result)
  setOnboardingStep(2)
}

function continueWithoutImport(): void {
  applyContinueWithoutImport({
    updateCollectionBasis: (basis) => {
      collectionBasis.value = basis
      preferenceRepository.update('sources', { collectionBasis: basis })
    },
    updateOnboarding: (preference) => {
      persistOnboarding(preference.status, preference.step)
    }
  })
}

function reportTransferProblem(message: string): void {
  notifications.notify({
    key: 'transfer-problem',
    title: 'Transfer problem',
    message,
    severity: 'error',
    timeoutMs: null
  })
}

function reportSuccess(message: string): void {
  notifications.notify({
    key: 'operation-success',
    title: 'Done',
    message,
    severity: 'success'
  })
}

function clearScanProblem(): void {
  notifications.dismissByKey('collection-scan')
}

function reportScanProblem(message: string): void {
  notifications.notify({
    key: 'collection-scan',
    title: 'Collection scan',
    message,
    severity: 'warning',
    timeoutMs: 12_000
  })
}

function syncRecoveryNotification(): void {
  if (!recoveryStatus.value?.requiresAttention) {
    notifications.dismissByKey('recovery-attention')
    return
  }
  const count = recoveryStatus.value.operations.length
  notifications.notify({
    key: 'recovery-attention',
    title: 'Recovery attention required',
    message: `${count} transfer operation${count === 1 ? '' : 's'} need audit before more writes.`,
    severity: 'warning',
    timeoutMs: null,
    dismissible: false,
    action: { id: 'open-recovery', label: 'Review', dismisses: false }
  })
}

function handleNotificationAction(notification: AppNotification): void {
  if (notification.action?.id === 'open-recovery') {
    activeView.value = 'settings'
    window.scrollTo({ top: 0, behavior: 'auto' })
  }
  if (notification.action?.dismisses !== false) notifications.dismiss(notification.id)
}

async function refreshRecoveryStatus(): Promise<void> {
  try {
    recoveryStatus.value = await window.cairnCodex.getRecoveryStatus()
    syncRecoveryNotification()
  } catch {
    // Collection browsing remains available even if diagnostics cannot load.
  }
}

function applySnapshot(value: CollectionSnapshot): void {
  snapshot.value = value
  warmSearchDocuments([...(value.items ?? []), ...(value.materials ?? [])])
  discovery.value = value.discovery
  if (enabledStashPaths.value.length === 0 && value.scannedStashes.length > 0) {
    enabledStashPaths.value = value.scannedStashes.map((stash) => stash.path)
    storeSourcePaths()
  }
  if (
    !selectedStashPath.value ||
    !(value.availableStashes ?? value.scannedStashes).some(
      (stash) => stash.path === selectedStashPath.value
    )
  ) {
    selectedStashPath.value = preferredStashPath(value)
  }
}

function storeTodos(): void {
  preferenceRepository.update('notes', { todos: todos.value.map((todo) => ({ ...todo })) })
}

async function openTodos(): Promise<void> {
  todoOpen.value = true
  triviaOpen.value = false
  showConnectionDiagnostics.value = false
  await nextTick()
  todoInput.value?.focus()
}

function openTrivia(): void {
  triviaOpen.value = true
  todoOpen.value = false
  showConnectionDiagnostics.value = false
  hideTooltip()
}

function openTriviaItem(record?: string): void {
  if (!record) return
  const item = catalogItemByRecord(record)
  if (!item) return
  triviaOpen.value = false
  openItem(item)
}

function addTodo(): void {
  const text = todoDraft.value.trim()
  if (!text) return
  todos.value.push({
    id: crypto.randomUUID(),
    text,
    done: false,
    createdAt: new Date().toISOString()
  })
  todoDraft.value = ''
  storeTodos()
}

function setTodoDone(todo: TodoItem, done: boolean): void {
  todo.done = done
  storeTodos()
}

function removeTodo(id: string): void {
  todos.value = todos.value.filter((todo) => todo.id !== id)
  storeTodos()
}

function clearCompletedTodos(): void {
  todos.value = todos.value.filter((todo) => !todo.done)
  storeTodos()
}

function storeSourcePaths(): void {
  preferenceRepository.update('sources', collectionBasis.value === 'archive'
    ? { archivePaths: [...enabledStashPaths.value] }
    : { indexPaths: [...enabledStashPaths.value] })
}

async function toggleSourceForBasis(basis: CollectionBasis, path: string): Promise<void> {
  const target = basis === 'archive' ? archiveStashPaths : indexStashPaths
  target.value = target.value.includes(path)
    ? target.value.filter((candidate) => candidate !== path)
    : [...target.value, path]
  preferenceRepository.update('sources', basis === 'archive'
    ? { archivePaths: [...target.value] }
    : { indexPaths: [...target.value] })
  if (collectionBasis.value === basis) await loadSelectedSources()
}

async function selectSourceModeForBasis(basis: CollectionBasis, isHardcore: boolean): Promise<void> {
  const paths = stashChoices.value
    .filter((stash) => stash.isHardcore === isHardcore)
    .map((stash) => stash.path)
  const target = basis === 'archive' ? archiveStashPaths : indexStashPaths
  target.value = paths
  preferenceRepository.update('sources', basis === 'archive'
    ? { archivePaths: [...paths] }
    : { indexPaths: [...paths] })
  if (collectionBasis.value === basis) await loadSelectedSources()
}

async function setArchiveModeEnabled(isHardcore: boolean, enabled: boolean): Promise<void> {
  const modePaths = stashChoices.value
    .filter((stash) => stash.isHardcore === isHardcore)
    .map((stash) => stash.path)
  const modePathSet = new Set(modePaths)
  archiveStashPaths.value = archiveStashPaths.value.filter((path) => !modePathSet.has(path))
  if (enabled) archiveStashPaths.value.push(...modePaths)
  preferenceRepository.update('sources', { archivePaths: [...archiveStashPaths.value] })
  if (collectionBasis.value === 'archive') await loadSelectedSources()
}

async function setCollectionBasis(basis: CollectionBasis): Promise<void> {
  if (collectionBasis.value === basis) return
  collectionBasis.value = basis
  preferenceRepository.update('sources', { collectionBasis: basis })
  await loadSelectedSources()
}

function workspaceToolVisible(id: WorkspaceToolId): boolean {
  const definition = workspaceToolDefinitions.find((tool) => tool.id === id)
  return workspaceToolIdSet.value.has(id) &&
    (!definition?.experimental || (experimentalToolsEnabled.value && !safeModeActive.value))
}

function workspaceToolSelected(id: WorkspaceToolId): boolean {
  return workspaceToolIdSet.value.has(id)
}

function setExperimentalToolsEnabled(enabled: boolean): void {
  if (safeModeActive.value && enabled) return
  experimentalToolsEnabled.value = enabled
  preferenceRepository.update('workspace', { experimentalToolsEnabled: enabled })
  if (!enabled && (activeView.value === 'oracle' || activeView.value === 'dismantling')) {
    activeView.value = 'collection'
  }
}

function setWorkspaceToolVisible(id: WorkspaceToolId, visible: boolean): void {
  visibleWorkspaceToolIds.value = visible
    ? [...new Set([...visibleWorkspaceToolIds.value, id])]
    : visibleWorkspaceToolIds.value.filter((candidate) => candidate !== id)
  if (!visible && activeView.value === id) returnToCollection()
}

function openGlossary(entryId = 'item-rolls'): void {
  hideTooltip()
  // Queue the route push before clearing the session-only reference, whose
  // replace watcher must update the new entry rather than overwrite the source.
  activeView.value = 'glossary'
  selectedRecord.value = null
  selectedReferenceInstanceKey.value = null
  glossaryEntryId.value = glossaryEntry(entryId).id
}

function openWorkspaceTool(id: string): void {
  if (!workspaceToolDefinitions.some((tool) => tool.id === id && workspaceToolVisible(tool.id))) return
  if (id === 'materials') openMaterials()
  else if (id === 'oracle') openStashOracle()
  else if (id === 'supplies') void openSupplies()
  else if (id === 'trivia') openTrivia()
  else if (id === 'todo') openTodos()
  else if (id === 'sets' || id === 'skills' || id === 'planner' || id === 'mi-workshop' || id === 'farming' || id === 'dismantling') {
    activeView.value = id
  }
}

function showEssentialWorkspaceTools(): void {
  visibleWorkspaceToolIds.value = [...essentialWorkspaceToolIds]
}

function showAllWorkspaceTools(): void {
  visibleWorkspaceToolIds.value = [...defaultWorkspaceToolIds]
}

function setAutoLiveConnect(enabled: boolean): void {
  if (safeModeActive.value && enabled) return
  autoLiveConnect.value = enabled
  preferenceRepository.update('sources', { autoLiveConnect: enabled })
  if (enabled) {
    manualDisconnectProcessId.value = null
    void pollLiveLifecycle()
  }
}

function setLegacyScannerVisible(enabled: boolean): void {
  showLegacyScanner.value = enabled
  preferenceRepository.update('workspace', { showLegacyScanner: enabled })
  if (!enabled && collectionBasis.value !== 'archive') void setCollectionBasis('archive')
}

function toggleTracker(): void {
  trackerCollapsed.value = !trackerCollapsed.value
  preferenceRepository.update('appearance', { trackerCollapsed: trackerCollapsed.value })
}

async function refreshHeaderCharacters(): Promise<void> {
  if (!liveStatus.value?.grimDawnProcessIds.length) {
    headerCharacters.value = []
    return
  }
  try {
    headerCharacters.value = await window.cairnCodex.listCharacters()
  } catch (error) {
    console.warn('Active character save metadata could not be refreshed.', error)
  }
}

async function setInfiniteSupplies(enabled: boolean): Promise<void> {
  if (infiniteSuppliesBusy.value) return
  infiniteSuppliesBusy.value = true
  try {
    infiniteSupplies.value = await window.cairnCodex.setInfiniteSupplies(enabled)
    supplySession.selectedIds.value = []
    await refreshVault()
  } catch (error) {
    reportTransferProblem(readableError(error))
  } finally {
    infiniteSuppliesBusy.value = false
  }
}

async function recoverSahdinasMemento(destination: 'shared-stash' | 'character-inventory'): Promise<void> {
  if (vaultBusy.value || liveStatus.value?.state !== 'ready') return
  const target = destination === 'character-inventory'
    ? `${liveStatus.value.activeCharacterName ?? 'the active character'}'s inventory`
    : liveStatus.value.depositTabDescription
  const confirmed = window.confirm(
    `Create one replacement Sahdina's Memento in ${target}?\n\n` +
    'Use this only if the original secret quest item was accidentally sold or otherwise lost.'
  )
  if (!confirmed) return

  vaultBusy.value = true
  sahdinaRecoveryBusy.value = destination
  try {
    const result = await window.cairnCodex.recoverSahdinasMemento(
      destination,
      activeCharacter.value?.name ?? liveStatus.value?.activeCharacterName ?? undefined
    )
    const deliveredTo = result.destination === 'character-inventory'
      ? `${result.activeCharacter}'s inventory`
      : liveStatus.value?.depositTabDescription ?? 'the shared stash'
    reportSuccess(`${result.name} recovered to ${deliveredTo}.`)
  } catch (error) {
    reportTransferProblem(readableError(error))
  } finally {
    sahdinaRecoveryBusy.value = null
    vaultBusy.value = false
  }
}

async function handleHeaderLiveAction(): Promise<void> {
  const status = liveStatus.value
  if (status?.state === 'ready' || status?.state === 'connecting' || status?.hostWindowReady) {
    await stopLiveMode()
    showConnectionDiagnostics.value = false
    return
  }
  if (status?.state === 'available') {
    await startLiveMode()
    showConnectionDiagnostics.value = liveStatus.value?.state !== 'ready'
    return
  }
  showConnectionDiagnostics.value = !showConnectionDiagnostics.value
}

async function approveCurrentGameBuild(): Promise<void> {
  if (!canApproveCurrentGameBuild.value || !connectionFingerprint.value || vaultBusy.value) return
  const confirmed = window.confirm(
    'Trust this exact Grim Dawn Game.dll (' + connectionFingerprint.value + ') for live injection?\n\n' +
    'This is an advanced override. CC will still require its verified hook, but cannot prove that a new game patch kept the same internal ABI. Run one disposable ingest-and-return round trip before using valuable items.'
  )
  if (!confirmed) return
  vaultBusy.value = true
  try {
    liveStatus.value = await window.cairnCodex.approveLiveGameBuild()
    reportSuccess('Approved exact Game.dll ' + connectionFingerprint.value + '. Connect and perform a disposable round-trip test.')
  } catch (error) {
    reportTransferProblem(readableError(error))
  } finally {
    vaultBusy.value = false
  }
}

async function setZoom(factor: number): Promise<void> {
  zoomFactor.value = await window.cairnCodex.setZoomFactor(factor)
  preferenceRepository.update('appearance', { zoomFactor: zoomFactor.value })
}

async function exportPreferences(): Promise<void> {
  if (preferenceExportBusy.value) return
  preferenceExportBusy.value = true
  try {
    const result = await window.cairnCodex.exportPreferences(preferenceRepository.exportJson())
    if (!result.canceled && result.path) reportSuccess(`Preferences exported to ${result.path}.`)
  } catch (error) {
    reportTransferProblem(readableError(error))
  } finally {
    preferenceExportBusy.value = false
  }
}

function handleZoomWheel(event: WheelEvent): void {
  if (!event.ctrlKey) return
  event.preventDefault()
  void setZoom(zoomFactor.value + (event.deltaY < 0 ? 0.1 : -0.1))
}

async function toggleCollectionSource(path: string): Promise<void> {
  enabledStashPaths.value = enabledStashPaths.value.includes(path)
    ? enabledStashPaths.value.filter((candidate) => candidate !== path)
    : [...enabledStashPaths.value, path]
  storeSourcePaths()
  await loadSelectedSources()
}

async function selectSourceMode(isHardcore: boolean): Promise<void> {
  enabledStashPaths.value = stashChoices.value
    .filter((stash) => stash.isHardcore === isHardcore)
    .map((stash) => stash.path)
  storeSourcePaths()
  await loadSelectedSources()
}

async function loadSelectedSources(): Promise<void> {
  hideTooltip()
  selectedRecord.value = null
  if (!await reloadCollection()) return
  void hydrateArchiveRolls()
  await refreshVault()
}

async function reloadCollection(): Promise<boolean> {
  let needsScan = false
  const current = await collectionSession.run('cache', async (read) => {
    const cached = await window.cairnCodex.getCachedCollection(read.context.sourcePaths, read.context.basis)
    if (read.install(cached)) needsScan = cached === null
  })
  if (!current) return false
  if (needsScan) await scanCollection()
  return true
}

async function hydrateArchiveRolls(startupRun = false): Promise<void> {
  if (
    scanning.value ||
    collectionBasis.value !== 'archive' ||
    !snapshot.value ||
    liveGameIsReady()
  ) {
    if (startupRun) await reportStartupPhase('roll-analysis-skipped')
    return
  }
  archiveRollHydrationCompleted.value = 0
  archiveRollHydrationTotal.value = 0
  if (startupRun) await reportStartupPhase('roll-analysis-started')
  await collectionSession.run('hydration', async (read) => {
    let pending = 1
    while (pending > 0 && read.isCurrent() && !liveGameIsReady()) {
      const result = await window.cairnCodex.hydrateArchiveRolls(read.context.sourcePaths)
      if (!result || liveGameIsReady() || !read.install(result.snapshot)) break
      archiveRollHydrationCompleted.value += result.processed
      pending = result.pending
      archiveRollHydrationTotal.value = Math.max(
        archiveRollHydrationTotal.value,
        archiveRollHydrationCompleted.value + pending
      )
      if (result.processed === 0 && pending > 0) {
        console.warn('Archived roll hydration made no progress; stopping this background run.')
        break
      }
      if (pending > 0) await new Promise((resolve) => setTimeout(resolve, 40))
    }
  })
  if (startupRun) await reportStartupPhase('roll-analysis-settled')
}

function liveGameIsReady(): boolean {
  return liveStatus.value?.state === 'ready'
}

function filterToRarity(value: 'epic' | 'legendary' | 'mi'): void {
  activeView.value = 'collection'
  collectionControls.value = updateCollectionMaterialsControls(
    collectionControls.value,
    { category: 'All', rarity: value },
    true
  )
  window.scrollTo({ top: 500, behavior: preferredScrollBehavior() })
}

function filterToAllRarities(): void {
  activeView.value = 'collection'
  collectionControls.value = updateCollectionMaterialsControls(
    collectionControls.value,
    { category: 'All', ownership: 'all', rarity: 'all' },
    true
  )
  window.scrollTo({ top: 420, behavior: preferredScrollBehavior() })
}

function filterToRecipes(): void {
  activeView.value = 'collection'
  collectionControls.value = updateCollectionMaterialsControls(
    collectionControls.value,
    { category: 'All', ownership: 'all', rarity: 'recipe' },
    true
  )
  window.scrollTo({ top: 500, behavior: preferredScrollBehavior() })
}

function openAffixWorkshop(): void {
  activeView.value = 'mi-workshop'
}

function openSets(): void {
  activeView.value = 'sets'
  query.value = ''
  rarityFilter.value = 'all'
  setProgressFilter.value = 'all'
  setFeatureFilter.value = 'all'
}

function openOracleSet(name: string): void {
  openSets()
  query.value = name
}

function openMaterials(category?: MaterialCategory): void {
  activeView.value = 'materials'
  if (category !== undefined) {
    materialsControls.value = updateCollectionMaterialsControls(
      materialsControls.value,
      { category, query: '', ownership: 'all' },
      true
    )
  }
}

function openStashOracle(): void {
  activeView.value = 'oracle'
  oracleControls.value = { ...oracleControls.value, page: 1 }
}

function sendOracleCandidateToPlanner(candidate: OracleCandidate): void {
  plannerSession.buildFromOracle(candidate, oracleControls.value.minimumLevel, oracleControls.value.maximumLevel)
  activeView.value = 'planner'
}

function inspectOracleSkill(skill: string): void {
  skillExplorerControls.value = { ...skillExplorerControls.value, skill, page: 1 }
  activeView.value = 'skills'
}

async function openSupplies(): Promise<void> {
  activeView.value = 'supplies'
  supplyControls.value = { ...supplyControls.value, query: '', slot: 'all', page: 1 }
  await refreshVault()
  await pollLiveLifecycle()
  if (liveStatus.value?.state === 'ready') await refreshHeaderCharacters()
}

function cachedCollectionTime(): string {
  if (!snapshot.value) return ''
  const asOfUtc = snapshot.value.cachedDataAsOfUtc ?? snapshot.value.scannedAtUtc
  const scanned = new Date(asOfUtc)
  return Number.isNaN(scanned.getTime()) ? asOfUtc : scanned.toLocaleString()
}

function categoryProgress(category: string): string {
  return categoryProgressByName.value.get(category) ?? '0 / 0'
}

function preferredStashPath(value: CollectionSnapshot): string {
  const normalizedName = (path: string) => path.replaceAll('/', '\\').toLocaleLowerCase()
  const documentsHardcore = value.scannedStashes.find((stash) => {
    const path = normalizedName(stash.path)
    return path.includes('\\documents\\') && path.endsWith('\\transfer.gsh')
  })
  return (
    documentsHardcore?.path ??
    value.scannedStashes.find((stash) => {
      const path = normalizedName(stash.path)
      return path.includes('\\documents\\') && path.endsWith('\\transfer.gst')
    })?.path ??
    value.scannedStashes.find((stash) => normalizedName(stash.path).endsWith('\\transfer.gsh'))?.path ??
    value.scannedStashes.find((stash) => normalizedName(stash.path).endsWith('\\transfer.gst'))?.path ??
    value.scannedStashes.find((stash) => stash.isHardcore)?.path ??
    value.scannedStashes[0]?.path ??
    ''
  )
}

async function refreshVault(): Promise<void> {
  archiveQueryRevision.value++
  try {
    const [summary, safety, live, supplies] = await Promise.allSettled([
      window.cairnCodex.getVaultSummary(),
      window.cairnCodex.inspectWriteSafety(),
      window.cairnCodex.inspectLiveGame(),
      refreshSupplySummary()
    ])
    if (supplies.status === 'rejected') console.warn('Supply summary could not be refreshed.', supplies.reason)
    if (summary.status === 'fulfilled') {
      vaultSummary.value = summary.value
      vaultSummaryStatus.value = 'ready'
    } else {
      vaultSummaryStatus.value = 'unavailable'
      console.warn('Archive summary could not be refreshed.', summary.reason)
    }
    if (safety.status === 'fulfilled') writeSafety.value = safety.value
    else console.warn('Offline write safety could not be refreshed.', safety.reason)
    if (live.status === 'fulfilled') liveStatus.value = live.value
    else console.warn('Live-game status could not be refreshed.', live.reason)
    if (selectedStashPath.value) await refreshStaging()
    else staging.value = null
    await refreshRecoveryStatus()
    if (activeView.value === 'vault') await refreshVaultPages()
    if (
      activeView.value === 'vault' &&
      (transferSection.value === 'ingest-history' || transferSection.value === 'dispense-history')
    ) await refreshOperationHistory()
  } catch (error) {
    reportTransferProblem(readableError(error))
  }
}

async function refreshSupplySummary(): Promise<void> {
  const generation = ++supplySummaryGeneration
  const result = await window.cairnCodex.querySupplies({ source: 'archive', category: 'writs', slot: 'all', query: '',
    activeCharacter: null, liveReady: false, offset: 0, limit: 1 })
  if (generation === supplySummaryGeneration) reusableSupplySummary.value = result.summary
}

function scheduleVaultPageRefresh(): void {
  if (activeView.value !== 'vault') return
  if (vaultPageTimer) clearTimeout(vaultPageTimer)
  if (vaultStructuredQuery.value.error) {
    vaultPageLoading.value = false
    return
  }
  vaultPageTimer = setTimeout(() => {
    vaultPageTimer = null
    void refreshVaultPages()
  }, 120)
}

function scheduleOperationHistoryRefresh(): void {
  if (
    activeView.value !== 'vault' ||
    (transferSection.value !== 'ingest-history' && transferSection.value !== 'dispense-history')
  ) return
  if (operationHistoryTimer) clearTimeout(operationHistoryTimer)
  if (historyStructuredQuery.value.error) {
    operationHistoryLoading.value = false
    return
  }
  operationHistoryLoading.value = true
  operationHistoryTimer = setTimeout(() => {
    operationHistoryTimer = null
    void refreshOperationHistory()
  }, 120)
}

async function refreshOperationHistory(): Promise<void> {
  if (transferSection.value !== 'ingest-history' && transferSection.value !== 'dispense-history') return
  if (historyStructuredQuery.value.error) return
  const requestId = ++operationHistoryRequestId
  operationHistoryLoading.value = true
  try {
    const result = await window.cairnCodex.queryOperationHistory({
      operation: activeHistoryKind.value,
      outcome: transferHistoryOutcome.value,
      query: transferHistoryQuery.value,
      offset: (transferHistoryPage.value - 1) * operationHistoryPageSize,
      limit: operationHistoryPageSize
    })
    if (requestId !== operationHistoryRequestId) return
    operationHistory.value = result
    const pageCount = Math.max(1, Math.ceil(operationHistory.value.total / operationHistoryPageSize))
    if (transferHistoryPage.value > pageCount) transferHistoryPage.value = pageCount
  } catch (error) {
    if (requestId !== operationHistoryRequestId) return
    reportTransferProblem(readableError(error))
  } finally {
    if (requestId === operationHistoryRequestId) operationHistoryLoading.value = false
  }
}

async function refreshVaultPages(): Promise<void> {
  if (vaultStructuredQuery.value.error) return
  const requestId = ++vaultPageRequestId
  const isHardcore = activeTransferHardcore.value
  if (isHardcore === undefined) {
    storedVaultPage.value = { items: [], total: 0, offset: 0, limit: vaultPageSize }
    quarantineVaultPage.value = { items: [], total: 0, offset: 0, limit: vaultPageSize }
    return
  }
  vaultPageLoading.value = true
  try {
    const [stored, quarantine] = await Promise.all([
      window.cairnCodex.queryVaultItems({
        state: 'ingested',
        isHardcore,
        catalogued: true,
        excludeSupplies: true,
        ...(vaultRarityFilter.value === 'all' ? {} : { rarity: vaultRarityFilter.value }),
        query: vaultQuery.value,
        sort: vaultSortMode.value,
        direction: vaultSortDirection.value,
        offset: (vaultPage.value - 1) * vaultPageSize,
        limit: vaultPageSize
      }),
      window.cairnCodex.queryVaultItems({
        state: 'ingested',
        isHardcore,
        catalogued: false,
        query: vaultQuery.value,
        sort: 'recent',
        direction: 'desc',
        offset: (vaultQuarantinePage.value - 1) * vaultPageSize,
        limit: vaultPageSize
      })
    ])
    if (requestId !== vaultPageRequestId) return
    storedVaultPage.value = stored
    quarantineVaultPage.value = quarantine
    const currentIds = new Set([...stored.items, ...quarantine.items].map((item) => item.id))
    selectedVaultIds.value = selectedVaultIds.value.filter((id) => currentIds.has(id))
  } catch (error) {
    if (requestId === vaultPageRequestId) reportTransferProblem(readableError(error))
  } finally {
    if (requestId === vaultPageRequestId) vaultPageLoading.value = false
  }
}

function previewDismantling(itemIds: string[]) {
  return window.cairnCodex.previewDismantling(itemIds)
}

async function startLiveMode(): Promise<void> {
  if (vaultBusy.value) return
  const confirmed = window.confirm(
    'Enable the Cairn Codex live adapter for this Grim Dawn session? Item Assistant must remain closed while CC owns the game hook.'
  )
  if (!confirmed) return
  manualDisconnectProcessId.value = null
  vaultBusy.value = true
  try {
    liveStatus.value = await window.cairnCodex.startLiveGame()
    if (liveStatus.value.state === 'ready') {
      reportSuccess('Live mode connected. Put an Epic, Legendary, or Monster Infrequent into the final shared stash tab to archive it instantly.')
    } else {
      reportTransferProblem(liveStatus.value.detail)
    }
  } catch (error) {
    reportTransferProblem(readableError(error))
    liveStatus.value = await window.cairnCodex.inspectLiveGame()
  } finally {
    vaultBusy.value = false
  }
}

async function stopLiveMode(): Promise<void> {
  if (vaultBusy.value) return
  manualDisconnectProcessId.value = liveStatus.value?.connectedProcessId ?? liveStatus.value?.grimDawnProcessIds[0] ?? null
  if (liveLifecyclePolling.value) {
    liveDisconnectPending.value = true
    return
  }
  liveDisconnectPending.value = false
  liveLifecyclePolling.value = true
  try {
    liveStatus.value = await window.cairnCodex.stopLiveGame()
    liveIssues.value = []
    reportSuccess('Live mode disconnected.')
  } catch (error) {
    liveIssues.value = [readableError(error)]
  } finally {
    liveLifecyclePolling.value = false
  }
}

async function pollLiveLifecycle(): Promise<void> {
  if (liveLifecyclePolling.value || vaultBusy.value) return
  liveLifecyclePolling.value = true
  try {
    const previousState = liveStatus.value?.state
    let current = await window.cairnCodex.inspectLiveGame()
    if (
      manualDisconnectProcessId.value !== null &&
      !current.grimDawnProcessIds.includes(manualDisconnectProcessId.value)
    ) {
      manualDisconnectProcessId.value = null
    }
    if (current.state === 'blocked' && current.connectedProcessId === null) {
      current = await window.cairnCodex.stopLiveGame()
      liveIssues.value = []
    }
    const deferredUntilWorldReady = current.state === 'connecting' &&
      current.detail.toLocaleLowerCase().includes('world is not ready')
    if (
      autoLiveConnect.value &&
      manualDisconnectProcessId.value === null &&
      (current.state === 'available' || deferredUntilWorldReady)
    ) {
      current = await window.cairnCodex.startLiveGame()
      if (current.state === 'ready' && previousState !== 'ready') {
        reportSuccess('Auto-connected to Grim Dawn. Live ingest is watching the configured stash tab.')
      }
    }
    liveStatus.value = current
    const currentCharacterResolved = Boolean(resolveActiveCharacter(current, headerCharacters.value))
    if (current.state === 'ready' && (previousState !== 'ready' || !currentCharacterResolved)) {
      await refreshHeaderCharacters()
    }
    if (!current.grimDawnProcessIds.length) headerCharacters.value = []
    if (previousState === 'ready' && current.state === 'unavailable' && !scanning.value) {
      void scanCollection()
    }
  } catch (error) {
    liveIssues.value = [readableError(error)]
    try {
      liveStatus.value = await window.cairnCodex.inspectLiveGame()
    } catch {
      // Preserve the last known status when the helper is temporarily unavailable.
    }
  } finally {
    liveLifecyclePolling.value = false
    if (liveDisconnectPending.value) void stopLiveMode()
  }
}

async function syncLiveMode(): Promise<void> {
  if (liveSyncInFlight || vaultBusy.value) return
  liveSyncInFlight = true
  const showActivity = activeView.value === 'vault' || activeView.value === 'supplies'
  if (showActivity) liveSyncing.value = true
  try {
    const result = await window.cairnCodex.syncLiveGame()
    if (JSON.stringify(liveStatus.value) !== JSON.stringify(result.status)) liveStatus.value = result.status
    if (JSON.stringify(liveIssues.value) !== JSON.stringify(result.issues)) liveIssues.value = result.issues
    if (result.ingested.length > 0) {
      applyLiveIngests(result.ingested)
      // The optimistic ingest receipt lacks preference/mode metadata. Reproject
      // the committed batch before enabling favorite edits on those new copies.
      await reloadCollection()
      reportSuccess(`Live-ingested ${result.ingested.map((item) => item.name).join(', ')}.`)
      await refreshVault()
      void hydrateArchiveRolls()
    }
  } catch (error) {
    const message = readableError(error)
    if (!message.includes('Another vault write is already in progress')) liveIssues.value = [message]
  } finally {
    liveSyncInFlight = false
    if (showActivity) liveSyncing.value = false
  }
}

type ArchiveConfirmationMetadata = ReadonlyMap<string, Pick<VaultListItem, 'reusable' | 'rarity'>>

async function retrieveSelectedLive(metadata?: ArchiveConfirmationMetadata): Promise<void> {
  if (selectedVaultIds.value.length === 0 || vaultBusy.value) return
  const count = selectedVaultIds.value.length
  const selected = selectedVaultIds.value.map(id => metadata?.get(id) ?? vaultItemForId(id))
  const reusable = selected.every((item) => item?.reusable)
  const supplies = selected.every((item) => item?.rarity === 'supply')
  const confirmed = window.confirm(
    reusable
      ? `Dispense ${count} reusable ${count === 1 ? 'supply' : 'supplies'} into Grim Dawn's ${liveStatus.value?.depositTabDescription ?? 'configured retrieval tab'}? The Codex unlocks remain available afterward.`
      : supplies
        ? `Return ${count} stored ${count === 1 ? 'supply' : 'supplies'} to Grim Dawn's ${liveStatus.value?.depositTabDescription ?? 'configured retrieval tab'}? Infinite supplies are disabled, so this consumes the archived ${count === 1 ? 'stack' : 'stacks'}.`
      : `Return ${count} ${count === 1 ? 'copy' : 'copies'} to Grim Dawn's ${liveStatus.value?.depositTabDescription ?? 'configured retrieval tab'}? Each item is committed only after the game acknowledges it; if the tab fills, the remaining copies stay safely archived.`
  )
  if (!confirmed) return
  vaultBusy.value = true
  try {
    const result = await window.cairnCodex.retrieveLiveVaultItems([...selectedVaultIds.value])
    applyLiveRetrievals(result.retrieved)
    reportSuccess(result.issues.length
      ? `${reusable ? 'Dispensed' : 'Live-retrieved'} ${result.retrieved.length} item${result.retrieved.length === 1 ? '' : 's'}; stopped safely: ${result.issues[0]}`
      : `${reusable ? 'Dispensed' : 'Live-retrieved'} ${result.retrieved.length} item${result.retrieved.length === 1 ? '' : 's'} into Grim Dawn${reusable ? '; the unlocks remain in CC.' : '.'}`)
    const retrievedIds = new Set(result.retrieved.map((item) => item.vaultItemId))
    selectedVaultIds.value = selectedVaultIds.value.filter((id) => !retrievedIds.has(id))
    await refreshVault()
  } catch (error) {
    reportTransferProblem(readableError(error))
    await refreshVault()
  } finally {
    vaultBusy.value = false
  }
}

async function retrieveSupplies(selected: SupplySelectionItem[], mode: TransferMode): Promise<void> {
  if (selected.length === 0 || vaultBusy.value) return
  const factionAugments = selected.filter((item) => item.source === 'faction')
  const archived = selected.filter((item) => item.source === 'archive')
  if (factionAugments.length > 0 && mode !== 'live') {
    reportTransferProblem('Soulbound augments require a live Grim Dawn connection and are delivered to the active character.')
    return
  }
  if (factionAugments.length > 0) {
    const names = factionAugments.map((item) => item.name)
    const manifest = names.map((name) => `• ${name}`).join('\n')
    const confirmed = window.confirm(
      `Dispense exactly ${names.length} faction augment${names.length === 1 ? '' : 's'} directly to ${activeCharacter.value?.name ?? 'the active character'}?\n\n${manifest}\n\nCC will re-check that character's current reputation first.`
    )
    if (!confirmed) return
    vaultBusy.value = true
    try {
      const result = await window.cairnCodex.dispenseLiveAugments(
        factionAugments.map((item) => item.record),
        activeCharacter.value?.name
      )
      const delivered = new Set(result.dispensed.map((item) => `augment:${item.record}`))
      supplySession.selectedIds.value = supplySession.selectedIds.value.filter((id) => !delivered.has(id))
      const deliveredNames = result.dispensed.map((item) => item.name).join(', ')
      reportSuccess(result.issues.length
        ? `Delivered ${result.dispensed.length} augment${result.dispensed.length === 1 ? '' : 's'} to ${result.activeCharacter} (${deliveredNames}); stopped safely: ${result.issues[0]}`
        : `Delivered exactly ${result.dispensed.length} augment${result.dispensed.length === 1 ? '' : 's'} directly to ${result.activeCharacter}: ${deliveredNames}.`)
    } catch (error) {
      reportTransferProblem(readableError(error))
      return
    } finally {
      vaultBusy.value = false
    }
  }
  if (archived.length > 0) {
    selectedVaultIds.value = archived.map((item) => item.id)
    const metadata: ArchiveConfirmationMetadata = new Map(archived.map(item => [item.id, { reusable: item.reusable, rarity: 'supply' }]))
    if (mode === 'live') await retrieveSelectedLive(metadata)
    else await retrieveSelected(metadata)
  }
  supplySession.selectedIds.value = []
}

async function retrieveArchivedCopyLive(vaultItemId: string): Promise<void> {
  selectedVaultIds.value = [vaultItemId]
  await retrieveSelectedLive()
}

function applyLiveIngests(
  ingested: Array<{
    vaultItemId: string
    baseRecord: string
    prefixRecord: string
    suffixRecord: string
    name: string
    seed: number
    instanceKey: string
    rollAnalysis: ItemRollAnalysis | null
  }>
): void {
  if (!snapshot.value) return
  const supplyRecords = new Set(
    (snapshot.value.supplies ?? []).map((item) => item.record.toLocaleLowerCase())
  )
  const equipmentIngested = ingested.filter(
    (item) => !supplyRecords.has(item.baseRecord.toLocaleLowerCase())
  )
  const counts = new Map<string, number>()
  for (const item of ingested) {
    const key = item.baseRecord.toLocaleLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const discoveredAt = new Date().toISOString()
  const items = snapshot.value.items.map((item) => {
    const added = counts.get(item.record.toLocaleLowerCase()) ?? 0
    if (added === 0) return item
    const scored = equipmentIngested
      .filter((copy) => copy.baseRecord.toLocaleLowerCase() === item.record.toLocaleLowerCase())
      .map((copy) => copy.rollAnalysis)
      .filter((analysis): analysis is ItemRollAnalysis =>
        analysis?.trusted === true && analysis.overallEstimatedPercentile !== null
      )
    const incomingBest = scored.length
      ? Math.max(...scored.map((analysis) => analysis.overallEstimatedPercentile!))
      : null
    return {
      ...item,
      discovered: true,
      firstDiscoveredAt: item.firstDiscoveredAt ?? discoveredAt,
      availableCount:
        collectionBasis.value === 'archive' ? item.availableCount + added : item.availableCount,
      bestRollPercentile: incomingBest === null
        ? item.bestRollPercentile
        : Math.max(item.bestRollPercentile ?? -1, incomingBest),
      analyzedCopyCount: item.analyzedCopyCount + scored.length
    }
  })
  const supplies = (snapshot.value.supplies ?? []).map((item) => {
    const added = counts.get(item.record.toLocaleLowerCase()) ?? 0
    if (added === 0) return item
    return {
      ...item,
      discovered: true,
      firstDiscoveredAt: item.firstDiscoveredAt ?? discoveredAt,
      availableCount:
        collectionBasis.value === 'archive' ? item.availableCount + added : item.availableCount
    }
  })
  const observedItems = collectionBasis.value === 'archive'
    ? [
        ...snapshot.value.observedItems,
        ...equipmentIngested.map((item, index): ObservedStashItem => ({
          sourcePath: `vault://${item.vaultItemId}`,
          tabIndex: -1,
          itemIndex: snapshot.value!.observedItems.length + index,
          baseRecord: item.baseRecord,
          prefixRecord: item.prefixRecord,
          suffixRecord: item.suffixRecord,
          modifierRecord: '',
          transmuteRecord: '',
          seed: item.seed,
          materiaRecord: '',
          relicCompletionBonusRecord: '',
          relicSeed: 0,
          enchantmentRecord: '',
          ascendantRecord: '',
          ascendantRecord2H: '',
          enchantmentSeed: 0,
          materiaCombines: 0,
          stackCount: 1,
          rerolls: 0,
          affixRerolls: 0,
          rollAnalysis: item.rollAnalysis,
          instanceKey: item.instanceKey
        }))
      ]
    : snapshot.value.observedItems
  collectionSession.commit(withUpdatedSummaries({ ...snapshot.value, observedItems, items, supplies }))
}

function applyLiveRetrievals(
  retrieved: Array<{ vaultItemId: string; baseRecord: string; seed: number }>
): void {
  if (!snapshot.value || collectionBasis.value !== 'archive') return
  const consumed = retrieved.filter(
    (item) => !vaultItemForId(item.vaultItemId)?.reusable
  )
  const removedIds = new Set(consumed.map((item) => `vault://${item.vaultItemId}`))
  const observedItems = snapshot.value.observedItems.filter(
    (copy) => !removedIds.has(copy.sourcePath)
  )
  const counts = new Map<string, number>()
  for (const item of consumed) {
    const key = item.baseRecord.toLocaleLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const items = snapshot.value.items.map((item) => {
    const removed = counts.get(item.record.toLocaleLowerCase()) ?? 0
    if (removed === 0) return item
    const remaining = observedItems.filter(
      (copy) => copy.baseRecord.toLocaleLowerCase() === item.record.toLocaleLowerCase()
    )
    const analyzed = remaining.filter(
      (copy) =>
        copy.rollAnalysis?.trusted === true &&
        copy.rollAnalysis.overallEstimatedPercentile !== null
    )
    return {
      ...item,
      availableCount: Math.max(0, item.availableCount - removed),
      analyzedCopyCount: analyzed.length,
      bestRollPercentile:
        analyzed.length > 0
          ? Math.max(...analyzed.map((copy) => copy.rollAnalysis!.overallEstimatedPercentile!))
          : null
    }
  })
  const supplies = (snapshot.value.supplies ?? []).map((item) => {
    const removed = counts.get(item.record.toLocaleLowerCase()) ?? 0
    return removed === 0
      ? item
      : { ...item, availableCount: Math.max(0, item.availableCount - removed) }
  })
  collectionSession.commit(withUpdatedSummaries({ ...snapshot.value, observedItems, items, supplies }))
}

function withUpdatedSummaries(value: CollectionSnapshot): CollectionSnapshot {
  const awakeningSources = [...value.items, ...(value.plannerItems ?? [])]
  const items = withAwakeningAvailability(value.items, awakeningSources)
  const plannerItems = withAwakeningAvailability(value.plannerItems ?? [], awakeningSources)
  const rarities = (['epic', 'legendary', 'mi'] as const).map((rarity) => {
    const matching = items.filter((item) => item.rarity === rarity)
    return {
      rarity,
      total: matching.length,
      collected: matching.filter(isCollectionOwned).length,
      availableCopies: matching.reduce((sum, item) => sum + item.availableCount, 0)
    }
  })
  const affixCounts = new Map<string, number>()
  for (const item of value.observedItems) {
    for (const record of [item.prefixRecord, item.suffixRecord]) {
      if (!record) continue
      const key = record.toLocaleLowerCase()
      affixCounts.set(key, (affixCounts.get(key) ?? 0) + 1)
    }
  }
  const affixes = value.affixes.map((affix) => ({
    ...affix,
    availableCount: affix.records.reduce(
      (count, record) => count + (affixCounts.get(record.toLocaleLowerCase()) ?? 0),
      0
    )
  }))
  return {
    ...value,
    items,
    plannerItems,
    rarities,
    affixes,
    supplySummary: {
      rarity: 'supply',
      total: value.supplies?.length ?? 0,
      collected: value.supplies?.filter((item) => item.discovered).length ?? 0,
      availableCopies: value.supplies?.reduce((count, item) => count + item.availableCount, 0) ?? 0
    },
    affixSummary: {
      total: affixes.length,
      collected: affixes.filter((affix) => affix.availableCount > 0).length,
      availableCopies: affixes.reduce((count, affix) => count + affix.availableCount, 0)
    }
  }
}

async function refreshStaging(): Promise<void> {
  if (!selectedStashPath.value) return
  try {
    staging.value = await window.cairnCodex.inspectStagingTab(selectedStashPath.value)
  } catch (error) {
    staging.value = null
    reportTransferProblem(readableError(error))
  }
}

async function retrieveSelected(metadata?: ArchiveConfirmationMetadata): Promise<void> {
  if (selectedVaultIds.value.length === 0 || vaultBusy.value) return
  const selected = selectedVaultIds.value.map(id => metadata?.get(id) ?? vaultItemForId(id))
  const reusable = selected.every((item) => item?.reusable)
  const supplies = selected.every((item) => item?.rarity === 'supply')
  const confirmed = window.confirm(reusable
    ? `Dispense ${selectedVaultIds.value.length} reusable ${selectedVaultIds.value.length === 1 ? 'supply' : 'supplies'} into the empty final shared stash tab? The Codex unlocks remain available and a verified backup will be created first.`
    : supplies
      ? `Return ${selectedVaultIds.value.length} stored ${selectedVaultIds.value.length === 1 ? 'supply' : 'supplies'} into the empty final shared stash tab? Infinite supplies are disabled, so this consumes the archived ${selectedVaultIds.value.length === 1 ? 'stack' : 'stacks'}.`
    : `Retrieve ${selectedVaultIds.value.length} item${selectedVaultIds.value.length === 1 ? '' : 's'} into the empty final shared stash tab? A verified backup will be created first.`)
  if (!confirmed) return
  vaultBusy.value = true
  try {
    const result = await window.cairnCodex.retrieveVaultItems(
      selectedStashPath.value,
      selectedVaultIds.value
    )
    selectedVaultIds.value = []
    reportSuccess(reusable
      ? `Dispensed ${result.retrieved.length} reusable ${result.retrieved.length === 1 ? 'supply' : 'supplies'}; the unlocks remain in CC. Backup: ${result.backupPath}`
      : `Safely retrieved ${result.retrieved.length} item${result.retrieved.length === 1 ? '' : 's'}. Backup: ${result.backupPath}`)
    await scanCollection()
    await refreshVault()
  } catch (error) {
    reportTransferProblem(readableError(error))
    await refreshVault()
  } finally {
    vaultBusy.value = false
  }
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

function itemAvailableByAwakeningOnly(item: CollectionItem): boolean {
  return item.availableCount === 0 && isAvailableViaAwakening(item)
}

function awakeningAvailabilityLabel(item: CollectionItem): string {
  const source = item.awakeningSourceName ?? 'owned Epic base'
  const count = item.awakeningSourceAvailableCount ?? 0
  return `Available by awakening ${source}${count > 1 ? ` (${count} bases)` : ''}`
}

function bestStoredCopy(record: string): VaultListItem | null {
  const matches = (snapshot.value?.observedItems ?? [])
    .filter((copy) =>
      copy.sourcePath.startsWith('vault://') &&
      copy.baseRecord.toLocaleLowerCase() === record.toLocaleLowerCase()
    )
    .flatMap((copy) => {
      const item = vaultItemForObserved(copy)
      return item ? [{ copy, item }] : []
    })
  if (matches.length === 0) return null
  const pinned = catalogItemByRecord(record)?.pinnedInstanceKey
  const pinnedMatch = matches.find(({ copy }) => copy.instanceKey === pinned)
  if (pinnedMatch) return pinnedMatch.item
  const focus = collectionRollFocusForSort(collectionControls.value.sort)
  if (focus) {
    const leader = buildCollectionRollSummaries(matches.map(({ copy }) => copy), focus)
      .get(record.toLocaleLowerCase())
    const focusedMatch = matches.find(({ copy }) => copy.instanceKey === leader?.copy.instanceKey)
    if (focusedMatch) return focusedMatch.item
  }
  return matches.length === 1 ? matches[0]!.item : null
}

function openItem(item: CollectionItem, referenceInstanceKey: string | null = null): void {
  hideTooltip()
  inspectionSession.open(item, referenceInstanceKey)
}

function catalogItemByRecord(record: string | null | undefined): CollectionItem | null {
  if (!record) return null
  return [
    ...(snapshot.value?.supplies ?? []),
    ...(snapshot.value?.materials ?? []),
    ...plannerCatalogItems.value
  ].find((item) => item.record.toLocaleLowerCase() === record.toLocaleLowerCase()) ?? null
}

function itemVersionCounterpart(item: CollectionItem): CollectionItem | null {
  return catalogItemByRecord(item.upgradeRecord ?? item.baseVersionRecord)
}

function showItemVersion(item: CollectionItem): void {
  const counterpart = itemVersionCounterpart(item)
  if (!counterpart) return
  cancelTooltipHide()
  tooltipDetailsHeld.value = false
  tooltipCopyAffixes.value = null
  tooltipRecord.value = counterpart.record
  resetTooltipScroll()
}

function openSelectedMiInWorkshop(): void {
  if (!selectedItem.value || selectedItem.value.rarity !== 'mi') return
  activeView.value = 'mi-workshop'
  miWorkshopControls.value = {
    ...miWorkshopControls.value,
    query: selectedItem.value.name,
    page: 1
  }
  selectedRecord.value = null
}

function itemIconUrl(item: CollectionItem): string | null {
  if (!item.iconKey) return null
  const url = `cairn-icon://asset/${item.iconKey}.png`
  return failedItemIconUrls.value.has(url) ? null : url
}

function handleItemIconError(item: CollectionItem): void {
  if (!item.iconKey) return
  failedItemIconUrls.value = new Set([...failedItemIconUrls.value, `cairn-icon://asset/${item.iconKey}.png`])
}

function isArchivedItem(item: CollectionItem): boolean {
  return archivedRecordSet.value.has(item.record.toLocaleLowerCase()) ||
    Boolean(item.awakeningSourceRecord &&
      archivedRecordSet.value.has(item.awakeningSourceRecord.toLocaleLowerCase())) ||
    (collectionBasis.value === 'archive' && isCollectionOwned(item))
}

function plannerOwnershipLabel(item: CollectionItem): string | null {
  if (archivedRecordSet.value.has(item.record.toLocaleLowerCase())) return 'Archived'
  if (item.awakeningSourceRecord &&
      archivedRecordSet.value.has(item.awakeningSourceRecord.toLocaleLowerCase())) {
    return `Available by awakening ${item.awakeningSourceName ?? 'owned Epic base'}`
  }
  if (itemAvailableByAwakeningOnly(item)) return awakeningAvailabilityLabel(item)
  if (item.recipeUnlocked) return 'Recipe learned'
  if (collectionBasis.value === 'archive' && item.discovered) return 'Previously archived'
  return null
}

function normalizeLoose(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '')
}

function contentPackShortLabel(contentPack: string): string {
  return ({ base: 'Base', gdx1: 'AoM', gdx2: 'FG', gdx3: 'FoA' } as Record<string, string>)[contentPack]
    ?? contentPack.toLocaleUpperCase()
}

function locationDisplayName(location: Pick<MapRegionLocation, 'name' | 'routeName' | 'contentPack'>): string {
  const route = location.routeName && location.routeName.toLocaleLowerCase() !== location.name.toLocaleLowerCase()
    ? ` · via ${location.routeName}`
    : ''
  return `${location.name} (${contentPackShortLabel(location.contentPack)})${route}`
}

function tooltipSources(item: CollectionItem): string[] {
  const sources = item.acquisition?.sources ?? []
  return tooltipDetailsHeld.value ? sources : sources.slice(0, 5)
}

function tooltipLocations(item: CollectionItem): MapRegionLocation[] {
  const locations = item.acquisition?.locations ?? []
  return tooltipDetailsHeld.value ? locations : locations.slice(0, 6)
}

function tooltipHasMore(item: CollectionItem): boolean {
  return (item.acquisition?.sources.length ?? 0) > 5 ||
    (item.acquisition?.locations?.length ?? 0) > 6 ||
    (item.acquisition?.additionalLocationCount ?? 0) > 0
}

interface ItemSearchDocument {
  everything?: string
  fields: Record<string, SearchFieldValue>
}

const itemSearchDocumentCache = new WeakMap<CollectionItem, ItemSearchDocument>()
const setSearchTextCache = new WeakMap<NonNullable<CollectionItem['setPresentation']>, string>()
let searchWarmGeneration = 0
let searchWarmTimer: ReturnType<typeof setTimeout> | null = null

function cancelSearchDocumentWarmup(): void {
  searchWarmGeneration += 1
  if (searchWarmTimer) clearTimeout(searchWarmTimer)
  searchWarmTimer = null
}

function warmSearchDocuments(items: CollectionItem[]): void {
  cancelSearchDocumentWarmup()
  const generation = searchWarmGeneration
  let index = 0
  let includeEverything = false
  const warmChunk = (): void => {
    if (generation !== searchWarmGeneration) return
    const started = performance.now()
    while (index < items.length && performance.now() - started < 10) {
      const item = items[index]!
      const document = itemSearchDocument(item)
      if (includeEverything) itemSearchEverything(item, document)
      index += 1
    }
    if (index >= items.length && !includeEverything) {
      includeEverything = true
      index = 0
    }
    if (index < items.length) searchWarmTimer = setTimeout(warmChunk, 4)
    else searchWarmTimer = null
  }
  searchWarmTimer = setTimeout(warmChunk, 0)
}

function itemSearchDocument(item: CollectionItem): ItemSearchDocument {
  const cached = itemSearchDocumentCache.get(item)
  if (cached) return cached
  const presentationText = `${item.presentation?.searchText ?? ''} ${setSearchText(item)}`
  const fields: Record<string, SearchFieldValue> = {
    name: item.name.toLocaleLowerCase(),
    set: (item.setName ?? '').toLocaleLowerCase(),
    // The helper already materializes the item's searchable presentation text.
    // Reuse it here instead of walking every deeply nested skill line for every
    // keystroke; set bonuses are shared and cached once per set presentation.
    skill: presentationText,
    damage: presentationText,
    slot: item.slot.toLocaleLowerCase(),
    type: item.itemClass.toLocaleLowerCase(),
    rarity: item.rarity.toLocaleLowerCase(),
    pack: item.contentPack.toLocaleLowerCase(),
    level: item.levelRequirement,
    owned: isCollectionOwned(item)
  }
  const document = { fields }
  itemSearchDocumentCache.set(item, document)
  return document
}

function setSearchText(item: CollectionItem): string {
  const presentation = item.setPresentation
  if (!presentation) return ''
  const cached = setSearchTextCache.get(presentation)
  if (cached !== undefined) return cached
  const text = presentation.tiers.flatMap((tier) => [
    ...tier.lines.map((line) => line.label),
    ...tier.petLines.map((line) => line.label),
    ...tier.skillModifiers.flatMap((section) => [
      section.heading,
      ...section.lines.map((line) => line.label)
    ]),
    ...grantedSkillSearchParts(tier.grantedSkill)
  ]).filter(Boolean).join(' ')
  setSearchTextCache.set(presentation, text)
  return text
}

function itemSearchEverything(item: CollectionItem, document: ItemSearchDocument): string {
  if (document.everything !== undefined) return document.everything
  document.everything = [
    item.name,
    item.setName,
    item.slot,
    item.itemClass,
    item.rarity,
    item.contentPack,
    item.presentation?.searchText,
    item.setPresentation?.description,
    ...(item.acquisition?.sources ?? []),
    ...(item.setPresentation?.tiers.flatMap((tier) =>
      [
        ...tier.lines.map((line) => formatPresentationLine(line)),
        ...(tier.petLines ?? []).map((line) => formatPresentationLine(line)),
        ...(tier.skillModifiers ?? []).flatMap((section) => [
          section.heading,
          ...section.lines.map((line) => formatPresentationLine(line))
        ]),
        ...grantedSkillSearchParts(tier.grantedSkill)
      ]
    ) ?? [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()
  return document.everything
}

function itemStructuredSearchDocument(item: CollectionItem): SearchDocument {
  const document = itemSearchDocument(item)
  return { text: itemSearchEverything(item, document), fields: document.fields }
}

function skillSearchText(item: CollectionItem): string {
  if (!item.presentation) return ''
  const skillLines = item.presentation.sections
    .flatMap((section) => section.lines)
    .filter((line) => line.tone === 'skill' || line.tone === 'mastery')
    .map((line) => line.label)
  const modifierSkills = item.presentation.sections
    .filter((section) => section.kind === 'skill-modifier')
    .map((section) => section.heading)
  const granted = item.presentation.grantedSkill
  return [
    ...skillLines,
    ...modifierSkills,
    ...grantedSkillSearchParts(granted)
  ]
    .filter(Boolean)
    .join(' ')
}

function grantedSkillSearchParts(skill: ItemGrantedSkillPresentation | null | undefined): string[] {
  if (!skill) return []
  return [
    skill.name,
    skill.description,
    skill.trigger,
    ...skill.lines.map((line) => formatPresentationLine(line)),
    ...(skill.linkedSkills ?? []).flatMap((linked) => grantedSkillSearchParts(linked))
  ].filter((value): value is string => Boolean(value))
}

function queueTooltip(
  item: CollectionItem,
  anchor: MouseEvent | FocusEvent | HTMLElement,
  copy?: Pick<ObservedStashItem, 'prefixRecord' | 'suffixRecord'>
): void {
  cancelTooltipHide()
  cancelTooltip()
  positionTooltip(anchor)
  tooltipTimer = setTimeout(() => {
    showTooltip(item, anchor, copy)
  }, 180)
}

function showTooltip(
  item: CollectionItem,
  anchor: MouseEvent | FocusEvent | HTMLElement,
  copy?: Pick<ObservedStashItem, 'prefixRecord' | 'suffixRecord'>
): void {
  cancelTooltipHide()
  cancelTooltip()
  positionTooltip(anchor)
  tooltipDetailsHeld.value = false
  tooltipCopyAffixes.value = copy
    ? { prefixRecord: copy.prefixRecord, suffixRecord: copy.suffixRecord }
    : null
  tooltipRecord.value = item.record
  resetTooltipScroll()
}

function moveTooltip(event: MouseEvent): void {
  if (!tooltipRecord.value) positionTooltip(event)
}

function positionTooltip(anchor: MouseEvent | FocusEvent | HTMLElement): void {
  const width = 455
  const margin = 14
  const target = anchor instanceof HTMLElement
    ? anchor
    : anchor.currentTarget instanceof HTMLElement
      ? anchor.currentTarget
      : null
  const rect = target?.getBoundingClientRect()
  const anchorX = anchor instanceof MouseEvent ? anchor.clientX : rect?.right ?? margin
  const x = rect && rect.right + width + 18 > window.innerWidth
    ? rect.left - width - 14
    : anchorX + 18
  const y = anchor instanceof MouseEvent ? anchor.clientY + 14 : rect?.top ?? margin
  const expectedHeight = Math.min(760, window.innerHeight - margin * 2)
  tooltipPosition.value = {
    left: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
    top: Math.max(margin, Math.min(y, window.innerHeight - expectedHeight - margin))
  }
}

function cancelTooltip(): void {
  if (tooltipTimer) clearTimeout(tooltipTimer)
  tooltipTimer = null
}

function cancelTooltipHide(): void {
  if (tooltipHideTimer) clearTimeout(tooltipHideTimer)
  tooltipHideTimer = null
}

function scheduleTooltipHide(): void {
  cancelTooltip()
  cancelTooltipHide()
  tooltipHideTimer = setTimeout(hideTooltip, 90)
}

function resetTooltipScroll(): void {
  tooltipWheelTarget = null
  cancelTooltipScrollAnimation()
  void nextTick(() => {
    if (tooltipElement.value) tooltipElement.value.scrollTop = 0
  })
}

let tooltipWheelTarget: number | null = null
let tooltipScrollFrame: number | null = null

function cancelTooltipScrollAnimation(): void {
  if (tooltipScrollFrame !== null) cancelAnimationFrame(tooltipScrollFrame)
  tooltipScrollFrame = null
}

function animateTooltipScroll(tooltip: HTMLElement, target: number): void {
  cancelTooltipScrollAnimation()
  if (preferredScrollBehavior() === 'auto') {
    tooltip.scrollTop = target
    return
  }
  const initial = tooltip.scrollTop
  const distance = target - initial
  const started = performance.now()
  const tick = (now: number): void => {
    const progress = Math.min(1, (now - started) / 120)
    tooltip.scrollTop = initial + distance * (1 - Math.pow(1 - progress, 3))
    if (progress < 1) tooltipScrollFrame = requestAnimationFrame(tick)
    else tooltipScrollFrame = null
  }
  tooltipScrollFrame = requestAnimationFrame(tick)
}

function scrollTooltip(event: WheelEvent): void {
  if (event.shiftKey || event.ctrlKey || event.metaKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
  const tooltip = tooltipElement.value
  if (!tooltip || tooltip.scrollHeight <= tooltip.clientHeight) return
  const maximumScrollTop = tooltip.scrollHeight - tooltip.clientHeight
  const boundaryTolerance = 1
  const directWheel = event.currentTarget === tooltip
  if (directWheel) {
    tooltipWheelTarget = null
    cancelTooltipScrollAnimation()
  }
  const actualScrollTop = tooltip.scrollTop
  const queuedBoundaryPending = !directWheel && tooltipWheelTarget !== null && (
    (event.deltaY < 0 && tooltipWheelTarget <= boundaryTolerance && actualScrollTop > boundaryTolerance) ||
    (event.deltaY > 0 && tooltipWheelTarget >= maximumScrollTop - boundaryTolerance && actualScrollTop < maximumScrollTop - boundaryTolerance)
  )
  if (queuedBoundaryPending) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  const currentScrollTop = directWheel ? tooltip.scrollTop : (tooltipWheelTarget ?? tooltip.scrollTop)
  const atBoundary =
    (event.deltaY < 0 && actualScrollTop <= boundaryTolerance) ||
    (event.deltaY > 0 && actualScrollTop >= maximumScrollTop - boundaryTolerance)
  if (atBoundary) {
    if (tooltipBoundaryScroll.value === 'contain' || directWheel) {
      event.preventDefault()
      event.stopPropagation()
    }
    // Chromium does not consistently chain wheel input from this fixed overlay.
    // Own direct-tooltip handoff to avoid both a stuck page and double scrolling.
    if (directWheel && tooltipBoundaryScroll.value === 'page') {
      const pageDelta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? event.deltaY * window.innerHeight : event.deltaY
      window.scrollBy({ top: pageDelta, behavior: preferredScrollBehavior() })
    }
    return
  }
  const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? event.deltaY * 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? event.deltaY * tooltip.clientHeight
      : event.deltaY
  const nextScrollTop = Math.max(
    0,
    Math.min(currentScrollTop + delta, maximumScrollTop)
  )
  if (nextScrollTop === currentScrollTop) return
  event.preventDefault()
  event.stopPropagation()
  tooltipWheelTarget = nextScrollTop
  animateTooltipScroll(tooltip, nextScrollTop)
}

function scrollTooltipFromKeyboard(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false
  if (event.key !== 'PageDown' && event.key !== 'PageUp') return false
  const target = event.target
  const tooltip = tooltipElement.value
  if (!(target instanceof HTMLElement) || !tooltip || tooltip.scrollHeight <= tooltip.clientHeight) return false
  const describedBy = (target.getAttribute('aria-describedby') ?? '').split(/\s+/)
  if (!describedBy.includes('item-tooltip')) return false
  const direction = event.key === 'PageDown' ? 1 : -1
  const nextScrollTop = Math.max(
    0,
    Math.min(tooltip.scrollTop + direction * Math.max(40, tooltip.clientHeight * 0.8), tooltip.scrollHeight - tooltip.clientHeight)
  )
  if (nextScrollTop === tooltip.scrollTop) return false
  event.preventDefault()
  event.stopPropagation()
  tooltip.scrollTop = nextScrollTop
  return true
}

function hideTooltip(): void {
  cancelTooltip()
  cancelTooltipHide()
  tooltipRecord.value = null
  tooltipCopyAffixes.value = null
  tooltipDetailsHeld.value = false
  tooltipWheelTarget = null
  cancelTooltipScrollAnimation()
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
}

function handleEscape(event: KeyboardEvent): void {
  if (scrollTooltipFromKeyboard(event)) return
  if (event.altKey && event.key === 'ArrowLeft') {
    event.preventDefault()
    navigateAppHistory('back')
    return
  }
  if (event.altKey && event.key === 'ArrowRight') {
    event.preventDefault()
    navigateAppHistory('forward')
    return
  }
  if (event.ctrlKey && event.key === '0') {
    event.preventDefault()
    void setZoom(1)
    return
  }
  if (event.key === 'Control' && tooltipRecord.value) {
    tooltipDetailsHeld.value = true
    return
  }
  if (
    event.key.toLocaleLowerCase() === 'v' &&
    !event.repeat &&
    !isTypingTarget(event.target) &&
    tooltipItem.value &&
    itemVersionCounterpart(tooltipItem.value)
  ) {
    event.preventDefault()
    showItemVersion(tooltipItem.value)
    return
  }
  if (event.key !== 'Escape') return
  if (safeModeOfferOpen.value) {
    dismissSafeModeOffer()
    return
  }
  if (onboardingOpen.value) {
    persistOnboarding('in-progress')
    onboardingOpen.value = false
    return
  }
  if (toolSettingsOpen.value) {
    toolSettingsOpen.value = false
    return
  }
  if (triviaOpen.value) {
    triviaOpen.value = false
    return
  }
  if (todoOpen.value) {
    todoOpen.value = false
    return
  }
  hideTooltip()
  showConnectionDiagnostics.value = false
  selectedRecord.value = null
}

function handleTooltipKeyUp(event: KeyboardEvent): void {
  if (event.key === 'Control') tooltipDetailsHeld.value = false
}

function setMemberItems(item: CollectionItem): CollectionItem[] {
  if (!snapshot.value || !item.setRecord) return []
  return snapshot.value.items
    .filter((candidate) => candidate.setRecord === item.setRecord)
    .sort((left, right) => left.slot.localeCompare(right.slot) || left.name.localeCompare(right.name))
}

function vaultItemForId(id: string): VaultListItem | null {
  const visible = [
    ...storedVaultPage.value.items,
    ...quarantineVaultPage.value.items,
    ...vaultItems.value
  ].find((item) => item.id === id)
  if (visible) return visible
  const observed = snapshot.value?.observedItems.find(
    (copy) => copy.sourcePath === `vault://${id}`
  )
  return observed ? vaultItemForObserved(observed) : null
}

function vaultItemForObserved(copy: ObservedStashItem): VaultListItem | null {
  if (!copy.sourcePath.startsWith('vault://')) return null
  const id = copy.sourcePath.slice('vault://'.length)
  const loaded = [
    ...storedVaultPage.value.items,
    ...quarantineVaultPage.value.items,
    ...vaultItems.value
  ].find((item) => item.id === id && item.state === 'ingested')
  if (loaded) return loaded
  const catalogItem = plannerCatalogItems.value.find(
    (item) => item.record.toLocaleLowerCase() === copy.baseRecord.toLocaleLowerCase()
  )
  if (!catalogItem) return null
  return {
    id,
    baseRecord: copy.baseRecord,
    name: catalogItem.name,
    rarity: catalogItem.rarity,
    slot: catalogItem.slot,
    levelRequirement: catalogItem.levelRequirement,
    itemLevel: catalogItem.itemLevel,
    catalogued: true,
    reusable: false,
    isHardcore: copy.isHardcore ?? snapshot.value?.isHardcore ?? false,
    isFavorite: Boolean(copy.isFavorite),
    state: 'ingested',
    seed: copy.seed,
    stackCount: copy.stackCount,
    prefixRecord: copy.prefixRecord,
    suffixRecord: copy.suffixRecord,
    componentRecord: copy.materiaRecord,
    augmentRecord: copy.enchantmentRecord,
    ascendant: Boolean(copy.ascendantRecord || copy.ascendantRecord2H),
    instanceKey: copy.instanceKey ?? '',
    rollAnalysis: copy.rollAnalysis,
    ingestedAtUtc: catalogItem.firstDiscoveredAt ?? snapshot.value?.scannedAtUtc ?? '',
    retrievedAtUtc: null
  }
}

function vaultCopyForObserved(copy: ObservedStashItem): VaultListItem | null {
  return vaultItemForObserved(copy)
}

</script>

<template>
  <div
    class="app-shell"
    :data-cache-issue="cacheIssue"
    :data-startup-phase="startupBackgroundPhase"
    :data-startup-interactive-ms="startupPhaseStatus?.interactiveMs ?? ''"
  >
    <header class="topbar">
      <div class="topbar-left">
        <a
          class="brand-lockup"
          href="#collection"
          aria-label="Collection home"
          @click.prevent="returnToCollection"
        >
          <img :src="cairnCodexLogo" alt="" />
          <span>
            <p class="eyebrow">Grim Dawn collection atlas</p>
            <h1>Cairn Codex</h1>
          </span>
        </a>
        <nav class="history-nav" aria-label="View history">
          <button type="button" aria-label="Go back" title="Back (Alt+Left)" :disabled="!canNavigateBack" @click="navigateAppHistory('back')">←</button>
          <button type="button" aria-label="Go forward" title="Forward (Alt+Right)" :disabled="!canNavigateForward" @click="navigateAppHistory('forward')">→</button>
        </nav>
      </div>
      <div class="topbar-actions">
        <div class="active-character" :class="{ muted: !activeCharacter }">
          <span v-if="activeCharacter">
            <strong>{{ activeCharacter.name }}</strong>
            <small>Lv{{ activeCharacter.level }} · {{ activeCharacterClass }}</small>
          </span>
          <span v-else><strong>No active character</strong><small>{{ liveStatus?.grimDawnProcessIds.length ? 'Waiting for save metadata' : 'Grim Dawn is closed' }}</small></span>
        </div>
        <div class="connection-control compact-connection">
          <button
            type="button"
            class="connection-status-icon"
            :class="'state-' + connectionColorState"
            :aria-label="gameConnectionLabel + '. Open connection details.'"
            :aria-expanded="showConnectionDiagnostics"
            :title="gameConnectionLabel"
            @click="showConnectionDiagnostics = !showConnectionDiagnostics"
          ><span aria-hidden="true" /></button>
        </div>
        <div class="connection-control">
          <button
            v-if="false"
            type="button"
            class="game-status-pill"
            :class="`state-${liveStatus?.state ?? 'unavailable'}`"
            :disabled="vaultBusy || liveLifecyclePolling"
            @click="handleHeaderLiveAction"
          >
            <span class="status-dot" :class="{ dim: liveStatus?.state !== 'ready' }" />
            <span><strong>{{ gameConnectionLabel }}</strong><small>{{ sourceModeLabel }} · {{ activeSourceCount }} sources</small></span>
            <em>{{ headerConnectionAction }}</em>
          </button>
          <button
            v-if="false"
            type="button"
            class="connection-info-button"
            aria-label="Show live connection diagnostics"
            :aria-expanded="showConnectionDiagnostics"
            @click="showConnectionDiagnostics = !showConnectionDiagnostics"
          >i</button>
          <aside v-if="showConnectionDiagnostics" class="connection-diagnostics" aria-live="polite">
            <header>
              <div><p class="section-label">Live connection</p><h3>{{ gameConnectionLabel }}</h3></div>
              <button type="button" aria-label="Close diagnostics" @click="showConnectionDiagnostics = false">×</button>
            </header>
            <p>{{ liveStatus?.detail ?? 'Checking the bundled live adapter…' }}</p>
            <dl>
              <div><dt>State</dt><dd>{{ liveStatus?.state ?? 'checking' }}</dd></div>
              <div v-if="activeCharacter"><dt>Character</dt><dd>{{ activeCharacter.name }} · Lv{{ activeCharacter.level }} · {{ activeCharacterClass }}</dd></div>
              <div v-if="activeCharacter"><dt>Detected by</dt><dd>Live hook; details from matching save</dd></div>
              <div><dt>Game</dt><dd>{{ liveStatus?.gameVersion ?? 'Not detected' }}</dd></div>
              <div v-if="liveStatus?.gameBuildId"><dt>Steam build</dt><dd>{{ liveStatus.gameBuildId }}</dd></div>
              <div v-if="connectionFingerprint"><dt>Game.dll</dt><dd><code>{{ connectionFingerprint }}</code></dd></div>
              <div v-if="liveStatus?.hookVersion"><dt>Hook</dt><dd>{{ liveStatus.hookVersion }}</dd></div>
              <div v-if="liveStatus?.connectedProcessId"><dt>Process</dt><dd>{{ liveStatus.connectedProcessId }}</dd></div>
            </dl>
            <div class="connection-recommendation">
              <strong>Recommended</strong>
              <span>{{ connectionRecommendation }}</span>
            </div>
            <footer>
              <button type="button" :disabled="vaultBusy" @click="handleHeaderLiveAction">{{ liveDisconnectPending ? 'Disconnecting…' : headerConnectionAction }}</button>
              <button v-if="canApproveCurrentGameBuild" type="button" :disabled="vaultBusy" @click="approveCurrentGameBuild">Trust exact build…</button>
              <button type="button" @click="activeView = 'vault'; transferMode = 'live'; showConnectionDiagnostics = false">Transfers</button>
              <button type="button" @click="activeView = 'settings'; showConnectionDiagnostics = false">Settings</button>
            </footer>
          </aside>
        </div>
      </div>
    </header>

    <p
      v-if="notificationAnnouncement"
      :key="notificationAnnouncement.id"
      class="visually-hidden"
      :role="notificationAnnouncement.assertive ? 'alert' : 'status'"
    >{{ notificationAnnouncement.text }}</p>
    <aside v-if="currentNotification" class="growl-stack" aria-label="Notification">
      <article class="growl" :class="currentNotification.severity">
        <span><strong>{{ currentNotification.title }}</strong>{{ currentNotification.message }}</span>
        <div class="growl-actions">
          <button
            v-if="currentNotification.action"
            type="button"
            @click="handleNotificationAction(currentNotification)"
          >{{ currentNotification.action.label }}</button>
          <button
            v-if="currentNotification.dismissible"
            type="button"
            aria-label="Dismiss notification"
            @click="notifications.dismiss(currentNotification.id)"
          >×</button>
        </div>
      </article>
    </aside>

    <section v-if="safeModeActive" class="safe-mode-banner" role="status">
      <div>
        <p class="section-label">Safe mode</p>
        <strong>Recovery startup is active.</strong>
        <span>Experimental tools are hidden and automatic game connection is paused. Your Codex Archive has not been reset.</span>
      </div>
      <div class="safe-mode-actions">
        <button type="button" @click="resetInterfacePreferences">Reset interface preferences</button>
        <button type="button" :disabled="safeModeBusy" @click="restartNormally">
          {{ safeModeBusy ? 'Restarting…' : 'Restart normally' }}
        </button>
      </div>
    </section>

    <div v-if="safeModeOfferOpen" class="safe-mode-offer-backdrop" @click.self="dismissSafeModeOffer">
      <section
        ref="safeModeDialog"
        class="safe-mode-offer"
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-labelledby="safe-mode-offer-title"
        aria-describedby="safe-mode-offer-description"
        @keydown.tab="trapSafeModeFocus"
      >
        <p class="section-label">Startup recovery</p>
        <h2 id="safe-mode-offer-title">CC has had trouble starting.</h2>
        <p id="safe-mode-offer-description">
          CC did not reach a healthy startup {{ failedStartupCount }} times in a row. Safe mode
          keeps the archive intact while hiding experimental tools and pausing automatic game connection.
        </p>
        <div class="safe-mode-offer-note">
          <strong>No collection data is deleted.</strong>
          <span>You can also reset display preferences later without touching planner profiles, to-dos, saves, stashes, or backups.</span>
        </div>
        <div class="safe-mode-actions">
          <button type="button" :disabled="safeModeBusy" @click="restartInSafeMode">
            {{ safeModeBusy ? 'Restarting…' : 'Restart in safe mode' }}
          </button>
          <button type="button" class="secondary" :disabled="safeModeBusy" @click="dismissSafeModeOffer">Continue normally</button>
        </div>
      </section>
    </div>

    <OnboardingDialog
      v-if="onboardingOpen && !appInitializing"
      :step="onboardingStep"
      :install-count="onboardingInstallCount"
      :save-count="onboardingSaveCount"
      :archived-copy-count="archivedCopyCount"
      :archive-summary-status="vaultSummaryStatus"
      :snapshot-available="Boolean(snapshot)"
      @skip="skipOnboarding"
      @settings="openOnboardingSettings"
      @set-step="setOnboardingStep"
      @continue-without-import="continueWithoutImport"
      @finish="finishOnboarding"
      @import-completed="handleOnboardingImportCompleted"
    />

    <div v-if="toolSettingsOpen" class="tool-settings-backdrop" @click.self="toolSettingsOpen = false">
      <section class="tool-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="tool-settings-title">
        <header>
          <div>
            <p class="section-label">Workspace</p>
            <h2 id="tool-settings-title">Choose your tools</h2>
            <p>Collection always remains available. Hide specialist tools you do not need right now.</p>
          </div>
          <button type="button" class="todo-close" aria-label="Close tool settings" @click="toolSettingsOpen = false">×</button>
        </header>
        <div class="tool-settings-options">
          <label v-for="tool in workspaceToolDefinitions" :key="tool.id" class="settings-toggle compact">
            <input
              type="checkbox"
              :checked="tool.experimental && !experimentalToolsEnabled ? false : workspaceToolSelected(tool.id)"
              :disabled="tool.experimental && !experimentalToolsEnabled"
              @change="setWorkspaceToolVisible(tool.id, ($event.target as HTMLInputElement).checked)"
            />
            <span><strong>{{ tool.label }}{{ tool.experimental ? ' · Experimental' : '' }}</strong><small>{{ tool.detail }}</small></span>
          </label>
        </div>
        <footer>
          <div class="workspace-tool-presets">
            <button type="button" @click="showEssentialWorkspaceTools">Essentials</button>
            <button type="button" @click="showAllWorkspaceTools">Show all</button>
          </div>
          <button type="button" class="tool-settings-done" @click="toolSettingsOpen = false">Done</button>
        </footer>
      </section>
    </div>

    <CollectionTriviaDialog
      :open="triviaOpen"
      :collection-trivia="dashboard.collectionTrivia.value"
      @close="triviaOpen = false"
      @open-item="openTriviaItem"
    />

    <div v-if="todoOpen" class="todo-backdrop" @click.self="todoOpen = false">
      <section class="todo-dialog" role="dialog" aria-modal="true" aria-labelledby="todo-title">
        <header>
          <div>
            <p class="section-label">CC scratchpad</p>
            <h2 id="todo-title">To-do list</h2>
          </div>
          <button type="button" class="todo-close" aria-label="Close to-do list" @click="todoOpen = false">×</button>
        </header>
        <form class="todo-entry" @submit.prevent="addTodo">
          <input
            ref="todoInput"
            v-model="todoDraft"
            type="text"
            maxlength="240"
            autocomplete="off"
            placeholder="Add something to remember…"
            aria-label="New to-do"
          />
          <button type="submit" :disabled="!todoDraft.trim()">Add</button>
        </form>
        <div v-if="orderedTodos.length" class="todo-list">
          <article v-for="todo in orderedTodos" :key="todo.id" :class="{ done: todo.done }">
            <label>
              <input
                type="checkbox"
                :checked="todo.done"
                @change="setTodoDone(todo, ($event.target as HTMLInputElement).checked)"
              />
              <span>{{ todo.text }}</span>
            </label>
            <button type="button" aria-label="Delete to-do" title="Delete" @click="removeTodo(todo.id)">×</button>
          </article>
        </div>
        <p v-else class="todo-empty">Nothing queued. Suspiciously organized.</p>
        <footer>
          <span>{{ remainingTodoCount }} remaining · {{ todos.length }} total</span>
          <button
            type="button"
            :disabled="!todos.some((todo) => todo.done)"
            @click="clearCompletedTodos"
          >Clear completed</button>
        </footer>
      </section>
    </div>

    <div
      class="workspace-layout has-sidebar"
      :class="{ 'navigation-collapsed': navigationCollapsed }"
    >
      <WorkspaceSidebar
        :active-id="activeView"
        :tools="visibleWorkspaceTools"
        :collapsed="navigationCollapsed"
        :tools-enabled="Boolean(snapshot)"
        @home="returnToCollection"
        @transfers="activeView = 'vault'"
        @settings="activeView = 'settings'"
        @glossary="openGlossary()"
        @select="openWorkspaceTool"
        @customize="toolSettingsOpen = true"
        @toggle="navigationCollapsed = !navigationCollapsed"
      />
    <WorkspaceErrorBoundary
      :key="activeView"
      :workspace="activeView"
      :report="reportRendererFailure"
      @return-home="returnToCollectionAfterFailure"
      @restart-safe="restartInSafeMode"
      @export-diagnostics="exportDiagnostics"
    >
    <FailureProbe v-if="simulateWorkspaceFailure" />
    <main>
      <section v-if="appInitializing || activeBackgroundJob" class="background-scan" aria-live="polite">
        <span class="scan-spinner" aria-hidden="true" />
        <div>
          <strong>{{ appInitializing && !snapshot ? 'Opening Cairn Codex' : activeBackgroundJob?.progress.label }}</strong>
          <small v-if="appInitializing && !snapshot">Loading the cached archive, game index, and live connection state.</small>
          <small v-else-if="activeBackgroundJob">
            {{ activeBackgroundJob.progress.detail }}
            <template v-if="activeBackgroundJob.progress.total !== null">
              {{ activeBackgroundJob.progress.completed.toLocaleString() }} / {{ activeBackgroundJob.progress.total.toLocaleString() }} {{ activeBackgroundJob.progress.unit }}.
            </template>
          </small>
        </div>
        <button
          v-if="activeBackgroundJob?.cancellation.canCancel"
          type="button"
          class="secondary compact"
          @click="cancelActiveBackgroundJob"
        >Cancel safely</button>
      </section>
      <section
        v-if="snapshot?.cacheNeedsRefresh"
        class="cached-knowledge-banner"
        aria-label="Cached Grim Dawn data"
      >
        <strong>Showing last-known Grim Dawn data</strong>
        <span>
          Cached as of {{ cachedCollectionTime() }}. Recipes, supplies, and components remain available while their save sources are offline; refresh when they are available again.
        </span>
      </section>
      <CollectionDashboard
        v-if="activeView === 'collection'"
        :model="dashboard"
        :available="Boolean(snapshot)"
        :installation-found="Boolean(discovery?.installations[0])"
        :source-mode-label="sourceModeLabel"
        :content-pack-count="snapshot?.contentPacks.length ?? 0"
        :scanned-stash-count="snapshot?.scannedStashes.length ?? 0"
        :catalog-entry-count="snapshot?.items.length ?? 0"
        :archived-copy-count="archivedCopyCount"
        :scanning="scanning"
        :tracker-collapsed="trackerCollapsed"
        :collection-basis="collectionBasis"
        :show-legacy-scanner="showLegacyScanner"
        :mi-counting-mode="miCountingMode"
        :selected-rarity="collectionControls.rarity"
        :affix-summary="snapshot?.affixSummary"
        :recipe-summary="snapshot?.recipeSummary"
        :reusable-supply-summary="reusableSupplySummary"
        :supply-access-summary="supplyAccessSummary"
        @refresh="scanCollection()"
        @toggle-tracker="toggleTracker"
        @filter-all="filterToAllRarities"
        @filter-recipes="filterToRecipes"
        @filter-rarity="filterToRarity"
        @open-affixes="openAffixWorkshop"
        @open-sets="openSets"
        @open-materials="openMaterials"
        @open-supplies="openSupplies"
        @set-basis="setCollectionBasis"
      />

      <CollectionMaterialsWorkspace
        v-if="snapshot && (activeView === 'collection' || activeView === 'materials')"
        v-model:controls="activeCollectionMaterialsControls"
        :mode="activeView === 'materials' ? 'materials' : 'collection'"
        :items="activeView === 'materials' ? (snapshot.materials ?? []) : snapshot.items"
        :double-rare-mi-base-records="doubleRareMiBaseRecords"
        :favorite-records="favoriteRecords"
        :search-document-for-item="itemStructuredSearchDocument"
        :category-progress="categoryProgress"
        :icon-url-for-item="itemIconUrl"
        :best-stored-copy-for-item="bestStoredCopy"
        :roll-summaries="collectionRollSummaries"
        :live-ready="liveStatus?.state === 'ready'"
        :retrieval-busy="vaultBusy"
        @show-tooltip="showTooltip"
        @queue-tooltip="queueTooltip"
        @move-tooltip="moveTooltip"
        @hide-tooltip="scheduleTooltipHide"
        @open-item="openItem"
        @retrieve-live="retrieveArchivedCopyLive"
        @open-roll-help="openGlossary()"
      />

      <SkillExplorerWorkspace
        :archived-records="archivedRecordSet"
        v-else-if="activeView === 'skills'"
        v-model:controls="skillExplorerControls"
        :items="plannerCatalogItems"
        :skill-names="skillNames"
        :is-archived-item="isArchivedItem"
        :icon-url-for-item="itemIconUrl"
        :ownership-label-for-item="plannerOwnershipLabel"
        @show-tooltip="showTooltip"
        @queue-tooltip="queueTooltip"
        @move-tooltip="moveTooltip"
        @scroll-tooltip="scrollTooltip"
        @hide-tooltip="scheduleTooltipHide"
        @open-item="openItem"
      />

      <StashOracleWorkspace
        v-else-if="activeView === 'oracle'"
        v-model:controls="oracleControls"
        :items="plannerCatalogItems"
        :skill-masteries="snapshot?.skillMasteries"
        :skill-class-names="snapshot?.skillClassNames"
        :is-archived-item="isArchivedItem"
        :icon-url-for-item="itemIconUrl"
        :ownership-label-for-item="plannerOwnershipLabel"
        @open-set="openOracleSet"
        @queue-tooltip="queueTooltip"
        @move-tooltip="moveTooltip"
        @hide-tooltip="scheduleTooltipHide"
        @open-item="openItem"
        @build-plan="sendOracleCandidateToPlanner"
        @inspect-skill="inspectOracleSkill"
      />

      <LevelingPlannerWorkspace
        v-else-if="activeView === 'planner'"
        :session="plannerSession"
        :icon-url-for-item="itemIconUrl"
        :content-pack-label="contentPackShortLabel"
        @queue-tooltip="queueTooltip"
        @show-tooltip="showTooltip"
        @move-tooltip="moveTooltip"
        @scroll-tooltip="scrollTooltip"
        @hide-tooltip="scheduleTooltipHide"
        @open-item="openItem"
        @icon-error="handleItemIconError"
      />

      <MiWorkshopWorkspace
        v-else-if="activeView === 'mi-workshop'"
        ref="miWorkshopWorkspace"
        v-model:controls="miWorkshopControls"
        :items="snapshot?.items ?? []"
        :affixes="snapshot?.affixes ?? []"
        :copies="allOwnedCopies"
        :collected="rarity('mi')?.collected ?? 0"
        :counting-mode="miCountingMode"
        :affixes-discovered="snapshot?.affixSummary.collected ?? 0"
        @open-roll-help="openGlossary()"
        :session="miWorkshopSession"
        :icon-url-for-item="itemIconUrl"
        @queue-tooltip="queueTooltip"
        @show-tooltip="showTooltip"
        @move-tooltip="moveTooltip"
        @hide-tooltip="scheduleTooltipHide"
        @open-item="openItem"
      />

      <SuppliesWorkspace
        v-else-if="activeView === 'supplies'"
        v-model:controls="supplyControls"
        :query-items="querySupplyItems"
        :select-boosts="selectSupplyBoosts"
        :archive-revision="archiveQueryRevision"
        :format-error="readableError"
        :active-character="activeCharacter"
        :active-transfer-hardcore="activeTransferHardcore"
        :live-ready="liveStatus?.state === 'ready'"
        :live-status-label="gameConnectionLabel"
        :connection-color-state="connectionColorState"
        :offline-ready="Boolean(writeSafety?.permitted)"
        :offline-staging-empty="staging?.itemCount === 0"
        :busy="vaultBusy"
        :infinite-supplies="infiniteSupplies"
        :summary="reusableSupplySummary"
        :session="supplySession"
        :icon-url-for-item="itemIconUrl"
        @queue-tooltip="queueTooltip"
        @move-tooltip="moveTooltip"
        @hide-tooltip="scheduleTooltipHide"
        @dispense="retrieveSupplies"
      />

      <DismantlingWorkspace
        v-else-if="activeView === 'dismantling'"
        v-model:controls="dismantlingControls"
        :query-items="queryDismantlingItems"
        :select-duplicates="selectDismantlingDuplicates"
        :archive-revision="archiveQueryRevision"
        :session="dismantlingSession"
        :preview-dismantling="previewDismantling"
        :format-error="readableError"
      />

      <CollectionFarmingWorkspace
        v-else-if="activeView === 'farming'"
        v-model:controls="farmingControls"
        :items="snapshot?.items ?? []"
        :search-document-for-item="itemStructuredSearchDocument"
        :icon-url-for-item="itemIconUrl"
        :content-pack-label="contentPackShortLabel"
        @queue-tooltip="queueTooltip"
        @hide-tooltip="scheduleTooltipHide"
        @open-item="openItem"
      />

      <GlossaryWorkspace
        v-else-if="activeView === 'glossary'"
        :entry-id="glossaryEntryId"
        @select-entry="openGlossary"
      />

      <SettingsWorkspace
        v-else-if="activeView === 'settings'"
        v-model:mi-counting-mode="miCountingMode"
        v-model:selected-stash-path="selectedStashPath"
        :onboarding-status="onboardingStatus"
        :onboarding-step="onboardingStep"
        :auto-live-connect="autoLiveConnect"
        :safe-mode-active="safeModeActive"
        :live-status="liveStatus"
        :game-connection-label="gameConnectionLabel"
        :connection-recommendation="connectionRecommendation"
        :zoom-factor="zoomFactor"
        :tooltip-boundary-scroll="tooltipBoundaryScroll"
        :experimental-tools-enabled="experimentalToolsEnabled"
        :workspace-tool-definitions="workspaceToolDefinitions"
        :visible-workspace-tool-ids="visibleWorkspaceToolIds"
        :snapshot-ready="Boolean(snapshot)"
        :archive-backup-status="archiveBackupStatus"
        :archive-backup-busy="archiveBackupBusy"
        :show-legacy-scanner="showLegacyScanner"
        :stash-choices="stashChoices"
        :index-stash-paths="indexStashPaths"
        :archive-stash-paths="archiveStashPaths"
        :vault-busy="vaultBusy"
        :infinite-supplies="infiniteSupplies"
        :infinite-supplies-busy="infiniteSuppliesBusy"
        :scanning="scanning"
        :scan-activity="scanActivity"
        :sahdina-recovery-busy="sahdinaRecoveryBusy"
        :recovery-status="recoveryStatus"
        :debug-logging-status="debugLoggingStatus"
        :debug-logging-busy="debugLoggingBusy"
        :diagnostics-busy="diagnosticsBusy"
        :preference-export-busy="preferenceExportBusy"
        :safe-mode-busy="safeModeBusy"
        @resume-onboarding="resumeOnboarding"
        @set-auto-live-connect="setAutoLiveConnect"
        @show-connection-diagnostics="showConnectionDiagnostics = true"
        @set-zoom="setZoom"
        @set-tooltip-boundary-scroll="tooltipBoundaryScroll = $event"
        @show-essential-tools="showEssentialWorkspaceTools"
        @show-all-tools="showAllWorkspaceTools"
        @set-experimental-tools="setExperimentalToolsEnabled"
        @set-tool-visible="setWorkspaceToolVisible"
        @gdia-import-completed="handleGdiaImportCompleted"
        @archive-backup="handleArchiveBackupAction"
        @set-legacy-scanner-visible="setLegacyScannerVisible"
        @select-source-mode="selectSourceModeForBasis"
        @toggle-source="toggleSourceForBasis"
        @set-archive-mode="setArchiveModeEnabled"
        @set-infinite-supplies="setInfiniteSupplies"
        @rebuild-game-data-index="rebuildGameDataIndex"
        @recover-sahdina="recoverSahdinasMemento"
        @set-debug-logging="setDebugLogging"
        @export-diagnostics="exportDiagnostics"
        @export-preferences="exportPreferences"
        @open-data-directory="openDataDirectory"
        @reset-interface-preferences="resetInterfacePreferences"
        @restart-safe-mode="handleSafeModeRestart"
      />

      <TransfersWorkspace
        v-else-if="activeView === 'vault'"
        v-model:selected-stash-path="selectedStashPath"
        :session="transfersSession"
        :vault-busy="vaultBusy"
        :operation-history="operationHistory"
        :operation-history-loading="operationHistoryLoading"
        :quarantine-vault-page="quarantineVaultPage"
        :vault-page-loading="vaultPageLoading"
        :live-status="liveStatus"
        :game-connection-label="gameConnectionLabel"
        :live-lifecycle-polling="liveLifecyclePolling"
        :write-safety="writeSafety"
        :stash-choices="stashChoices"
        :staging="staging"
        @refresh-vault="refreshVault"
        @start-live-mode="startLiveMode"
        @stop-live-mode="stopLiveMode"
        @retrieve-selected-live="retrieveSelectedLive()"
        @retrieve-selected="retrieveSelected()"
      />

      <section v-else-if="!snapshot && (appInitializing || scanning)" class="empty-state">
        <div class="sigil loading" aria-hidden="true">C</div>
        <h3>Opening the Codex</h3>
        <p>Parsing the game database and your transfer stashes.</p>
      </section>

      <SetsWorkspace
        v-else-if="activeView === 'sets'"
        :session="setsSession"
        :available="Boolean(snapshot)"
        @queue-tooltip="queueTooltip"
        @move-tooltip="moveTooltip"
        @hide-tooltip="scheduleTooltipHide"
        @open-item="openItem"
      />
    </main>
    </WorkspaceErrorBoundary>
    </div>

    <Teleport to="body">
      <aside
        v-if="tooltipItem"
        ref="tooltipElement"
        id="item-tooltip"
        class="game-tooltip"
        :class="[tooltipItem.rarity, `tooltip-boundary-${tooltipBoundaryScroll}`]"
        :style="{ left: `${tooltipPosition.left}px`, top: `${tooltipPosition.top}px`, maxHeight: `${tooltipMaxHeight}px` }"
        role="tooltip"
        @mouseenter="cancelTooltipHide"
        @mouseleave="scheduleTooltipHide"
        @wheel="scrollTooltip"
      >
        <header class="tooltip-header">
          <img v-if="itemIconUrl(tooltipItem)" :src="itemIconUrl(tooltipItem)!" alt="" @error="handleItemIconError(tooltipItem)" />
          <span v-else class="item-icon-placeholder tooltip-icon-placeholder" aria-hidden="true">{{ tooltipItem.slot.slice(0, 2).toLocaleUpperCase() }}</span>
          <div>
            <h3>
              <span v-if="tooltipItem.upgradeRecord || tooltipItem.baseVersionRecord" class="awakening-sigil tooltip-awakening-sigil"><i /></span>
              {{ tooltipDisplayName }}
            </h3>
            <p v-if="tooltipItem.upgradeRecord" class="awakening-copy">Can be upgraded by Ashes of Awakening.</p>
            <p v-else-if="tooltipItem.baseVersionRecord" class="awakening-copy">Awakened with Ashes of Awakening.</p>
            <p v-if="itemAvailableByAwakeningOnly(tooltipItem)" class="awakening-availability">{{ awakeningAvailabilityLabel(tooltipItem) }}</p>
            <p v-if="tooltipItem.presentation?.flavorText">“{{ tooltipItem.presentation.flavorText }}”</p>
            <strong>{{ researchRarityLabel(tooltipItem) }} · {{ researchItemTypeLabel(tooltipItem) }}</strong>
          </div>
        </header>

        <div
          v-if="itemVersionCounterpart(tooltipItem)"
          class="tooltip-version-summary"
        >
          <span class="awakening-sigil"><i /></span>
          <span>
            <small>{{ tooltipItem.upgradeRecord ? 'Awakened version' : 'Original version' }}</small>
            <strong>{{ itemVersionCounterpart(tooltipItem)?.name }} · {{ tooltipItem.upgradeRecord ? 'Legendary' : 'Epic' }}</strong>
          </span>
          <b>[V]</b>
        </div>

        <template v-if="tooltipItem.presentation">
          <section
            v-for="section in tooltipItem.presentation.sections"
            :key="`${section.kind}:${section.heading ?? 'base'}`"
            class="tooltip-section"
            :class="`section-${section.kind}`"
          >
            <h4 v-if="section.heading">{{ section.heading }}</h4>
            <p
              v-for="(line, index) in section.lines"
              :key="`${line.label}:${index}`"
              :class="`tone-${line.tone}`"
            >
              {{ formatPresentationLine(line) }}
            </p>
          </section>

          <section v-if="tooltipItem.setPresentation" class="tooltip-section tooltip-set">
            <h4>{{ tooltipItem.setPresentation.name }}</h4>
            <p v-if="tooltipItem.setPresentation.description" class="set-description">
              “{{ tooltipItem.setPresentation.description }}”
            </p>
            <p
              v-for="member in setMemberItems(tooltipItem)"
              :key="member.record"
              class="set-member"
              :class="[member.rarity, {
                  current: member.record === tooltipItem.record,
                  missing: !setItemDiscovered(member)
                }]"
            >
              {{ member.name }}
            </p>
            <div
              v-for="tier in tooltipItem.setPresentation.tiers"
              :key="tier.requiredPieces"
              class="tooltip-set-tier"
            >
              <h5>({{ tier.requiredPieces }}) Set</h5>
              <p v-for="(line, index) in tier.lines" :key="`${line.label}:${index}`">
                {{ formatPresentationLine(line) }}
              </p>
              <div v-if="tier.petLines?.length" class="tooltip-set-subsection">
                <h6>Bonus to All Pets</h6>
                <p
                  v-for="(line, index) in tier.petLines"
                  :key="`pet:${line.label}:${index}`"
                  :class="`tone-${line.tone}`"
                >
                  {{ formatPresentationLine(line) }}
                </p>
              </div>
              <div
                v-for="modifier in tier.skillModifiers ?? []"
                :key="`modifier:${modifier.heading}`"
                class="tooltip-set-subsection skill-bonus"
              >
                <h6>{{ modifier.heading }}</h6>
                <p v-for="(line, index) in modifier.lines" :key="`${line.label}:${index}`">
                  {{ formatPresentationLine(line) }}
                </p>
              </div>
              <div v-if="tier.grantedSkill" class="tooltip-set-subsection granted-skill">
                <h6>
                  {{ tier.grantedSkill.name }}
                  <span v-if="tier.grantedSkill.trigger">({{ tier.grantedSkill.trigger }})</span>
                </h6>
                <p v-if="tier.grantedSkill.description" class="skill-description">
                  {{ tier.grantedSkill.description }}
                </p>
                <p v-for="(line, index) in tier.grantedSkill.lines" :key="`${line.label}:${index}`">
                  {{ formatPresentationLine(line) }}
                </p>
                <div
                  v-for="linked in tier.grantedSkill.linkedSkills ?? []"
                  :key="linked.name"
                  class="linked-granted-skill"
                >
                  <h6>{{ linked.name }}</h6>
                  <p v-if="linked.description" class="skill-description">{{ linked.description }}</p>
                  <p v-for="(line, index) in linked.lines" :key="`${linked.name}:${line.label}:${index}`">
                    {{ formatPresentationLine(line) }}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section v-if="tooltipItem.presentation.grantedSkill" class="tooltip-section granted-skill">
            <h4>Granted Skills</h4>
            <h5>
              {{ tooltipItem.presentation.grantedSkill.name }}
              <span v-if="tooltipItem.presentation.grantedSkill.trigger">
                ({{ tooltipItem.presentation.grantedSkill.trigger }})
              </span>
            </h5>
            <p v-if="tooltipItem.presentation.grantedSkill.description" class="skill-description">
              {{ tooltipItem.presentation.grantedSkill.description }}
            </p>
            <p
              v-for="(line, index) in tooltipItem.presentation.grantedSkill.lines"
              :key="`${line.label}:${index}`"
              :class="`tone-${line.tone}`"
            >
              {{ formatPresentationLine(line) }}
            </p>
            <div
              v-for="linked in tooltipItem.presentation.grantedSkill.linkedSkills ?? []"
              :key="linked.name"
              class="linked-granted-skill"
            >
              <h5>{{ linked.name }}</h5>
              <p v-if="linked.description" class="skill-description">{{ linked.description }}</p>
              <p v-for="(line, index) in linked.lines" :key="`${linked.name}:${line.label}:${index}`">
                {{ formatPresentationLine(line) }}
              </p>
            </div>
          </section>
        </template>

        <section
          v-for="affix in tooltipAffixes"
          :key="`tooltip-affix:${affix.record}`"
          class="tooltip-section tooltip-affix"
          :class="affix.rarity"
        >
          <h4>{{ affix.kind === 'prefix' ? 'Prefix' : 'Suffix' }} · {{ affix.name }}</h4>
          <template v-if="affix.presentation?.sections.some((section) => section.lines.length)">
            <div
              v-for="section in affix.presentation?.sections ?? []"
              :key="`${affix.record}:${section.kind}:${section.heading ?? 'base'}`"
              class="tooltip-affix-section"
              :class="`section-${section.kind}`"
            >
              <h5 v-if="section.heading">{{ section.heading }}</h5>
              <p
                v-for="(line, index) in section.lines"
                :key="`${line.label}:${index}`"
                :class="`tone-${line.tone}`"
              >
                {{ formatPresentationLine(line) }}
              </p>
            </div>
          </template>
          <p v-else class="tooltip-affix-empty">This affix changes non-rollable item rules rather than visible stats.</p>
          <div v-if="affix.presentation?.grantedSkill" class="tooltip-affix-section granted-skill">
            <h5>
              {{ affix.presentation.grantedSkill.name }}
              <span v-if="affix.presentation.grantedSkill.trigger">({{ affix.presentation.grantedSkill.trigger }})</span>
            </h5>
            <p v-if="affix.presentation.grantedSkill.description" class="skill-description">
              {{ affix.presentation.grantedSkill.description }}
            </p>
            <p
              v-for="(line, index) in affix.presentation.grantedSkill.lines"
              :key="`${line.label}:${index}`"
              :class="`tone-${line.tone}`"
            >
              {{ formatPresentationLine(line) }}
            </p>
            <div
              v-for="linked in affix.presentation.grantedSkill.linkedSkills ?? []"
              :key="linked.name"
              class="linked-granted-skill"
            >
              <h6>{{ linked.name }}</h6>
              <p v-if="linked.description" class="skill-description">{{ linked.description }}</p>
              <p v-for="(line, index) in linked.lines" :key="`${linked.name}:${line.label}:${index}`">
                {{ formatPresentationLine(line) }}
              </p>
            </div>
          </div>
        </section>

        <section v-if="tooltipItem.acquisition?.sources.length" class="tooltip-section tooltip-acquisition">
          <h4>Acquisition</h4>
          <p v-if="recipeStatus(tooltipItem)" class="recipe-status" :class="{ known: recipeStatus(tooltipItem)?.known, missing: recipeStatus(tooltipItem)?.known === false }">
            {{ recipeStatus(tooltipItem)?.label }}
          </p>
          <p v-for="source in tooltipSources(tooltipItem)" :key="source">{{ source }}</p>
          <p v-if="tooltipItem.acquisition.sources.length > tooltipSources(tooltipItem).length" class="tooltip-location-overflow">
            +{{ tooltipItem.acquisition.sources.length - tooltipSources(tooltipItem).length }} more monster variants
          </p>
          <template v-if="tooltipItem.acquisition.locations?.length">
            <h4>Drop location</h4>
            <p v-for="location in tooltipLocations(tooltipItem)" :key="`${location.name}:${location.levelFile}`">
              {{ locationDisplayName(location) }}
            </p>
            <p v-if="(tooltipItem.acquisition.locations.length - tooltipLocations(tooltipItem).length) + (tooltipItem.acquisition.additionalLocationCount ?? 0)" class="tooltip-location-overflow">
              +{{ (tooltipItem.acquisition.locations.length - tooltipLocations(tooltipItem).length) + (tooltipItem.acquisition.additionalLocationCount ?? 0) }} more indexed regions
            </p>
          </template>
        </section>

        <footer>
          <span v-if="tooltipItem.levelRequirement">Required Player Level: {{ tooltipItem.levelRequirement }}</span>
          <span>Item Level: {{ tooltipItem.itemLevel }}</span>
          <em v-if="tooltipItem.contentPack !== 'base'">{{ tooltipItem.contentPack.toUpperCase() }}</em>
          <small class="tooltip-controls">
            <span v-if="tooltipElement && tooltipElement.scrollHeight > tooltipElement.clientHeight">[Hover and scroll, or use Page Up/Down while the item is focused]</span>
            <span v-if="itemVersionCounterpart(tooltipItem)">[V to View {{ tooltipItem.upgradeRecord ? 'Awakened' : 'Original' }} Version]</span>
            <span v-if="tooltipHasMore(tooltipItem)">[Hold Ctrl to Show Full Drop Details]</span>
          </small>
        </footer>
      </aside>
    </Teleport>

    <ItemInspectionDrawer
      :session="inspectionSession"
      :favorites="copyFavorites"
      v-model:metric="selectedMiMetric"
      v-model:metric-direction="selectedMiMetricDirection"
      :item-icon-url="itemIconUrl"
      :catalog-item-by-record="catalogItemByRecord"
      :vault-copy-for-observed="vaultCopyForObserved"
      :is-double-rare-mi-copy="isDoubleRareMiCopy"
      :mi-metric-options="miMetricOptions"
      :double-rare-icon="snapshot?.uiIcons?.doubleRareMi"
      :deposit-tab-description="liveStatus?.depositTabDescription ?? 'configured retrieval tab'"
      :busy="vaultBusy"
      :live-ready="liveStatus?.state === 'ready'"
      @icon-error="handleItemIconError"
      @open-roll-help="openGlossary()"
      @open-mi-workshop="openSelectedMiInWorkshop"
      @open-item="openItem"
      @retrieve-copy="retrieveArchivedCopyLive"
    />
  </div>
</template>
