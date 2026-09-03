<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import BoundedResultSurface from './components/BoundedResultSurface.vue'
import ExplorerToolbar from './components/ExplorerToolbar.vue'
import FailureProbe from './components/FailureProbe.vue'
import OnboardingDialog from './components/OnboardingDialog.vue'
import PlannerJourney from './components/PlannerJourney.vue'
import PlannerSetupDialog from './components/PlannerSetupDialog.vue'
import ResearchItemTable from './components/ResearchItemTable.vue'
import SemanticBadge from './components/SemanticBadge.vue'
import WorkspaceSidebar from './components/WorkspaceSidebar.vue'
import WorkspaceErrorBoundary from './components/WorkspaceErrorBoundary.vue'
import cairnCodexLogo from '../../../build/icon.svg?url'
import CollectionFarmingWorkspace from './workspaces/CollectionFarmingWorkspace.vue'
import type { CollectionFarmingControls } from './workspaces/collection-farming'
import DismantlingWorkspace from './workspaces/DismantlingWorkspace.vue'
import { createDismantlingSession, type DismantlingControls } from './workspaces/dismantling'
import StashOracleWorkspace from './workspaces/StashOracleWorkspace.vue'
import type { StashOracleControls } from './workspaces/stash-oracle'
import SkillExplorerWorkspace from './workspaces/SkillExplorerWorkspace.vue'
import {
  buildSkillNames,
  skillMatchForItem,
  type SkillExplorerControls,
  type SkillMatch
} from './workspaces/skill-explorer'
import {
  researchAcquisitionFacts,
  researchItemTypeLabel,
  researchRarityLabel,
  researchRollFact,
  researchSkillName,
  type ResearchItemTableRow
} from './workspaces/research-item-table'
import MiWorkshopWorkspace from './workspaces/MiWorkshopWorkspace.vue'
import {
  buildMiMetricOptions,
  compareCopiesByMiMetric,
  createMiWorkshopSession,
  humanStatName,
  miFamilyKey,
  miMetricLabel,
  miMetricResult,
  type MiWorkshopControls,
  updateMiWorkshopControls
} from './workspaces/mi-workshop'
import CollectionMaterialsWorkspace from './workspaces/CollectionMaterialsWorkspace.vue'
import {
  collectionCategories,
  matchesCollectionCategory,
  updateCollectionMaterialsControls,
  type CollectionMaterialsControls,
  type CollectionControls,
  type MaterialsControls
} from './workspaces/collection-materials'
import SettingsWorkspace from './workspaces/SettingsWorkspace.vue'
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
  buildReusableSupplySummary,
  createSupplyAccessSummary,
  createSupplySession,
  type SupplyControls,
  type SupplyOption
} from './workspaces/supplies'
import { createNotificationService, type AppNotification } from './notification-service'
import { preferredScrollBehavior } from './motion-preference'
import {
  resetUiPreferences,
  type RendererFailureReport
} from './renderer-recovery'
import {
  createPreferenceRepository,
  type StoredPlannerProfile as PlannerProfile,
  type StoredTodoItem as TodoItem,
  type TooltipBoundaryScrollPreference
} from './preference-repository'
import { searchGuidance } from './search-guidance'
import {
  appRouteHref,
  createAppHistoryEntry,
  parseAppHistoryEntry,
  parseAppRouteHash,
  type ActiveView,
  type AppHistoryEntry,
  type AppRoute,
  type MaterialCategory,
  type OwnershipFilter,
  type PlannerDisplay,
  type PlannerMapScope,
  type PlannerMapSortMode,
  type PlannerSortMode,
  type RarityFilter,
  type SetFeatureFilter,
  type SetProgressFilter,
  type SetSortMode,
  type SortDirection,
  type TransferMode
} from './app-route'
import {
  createCharacterPlannerProfile,
  createManualPlannerProfile,
  createPlannerClassOptions,
  type PlannerSetupSubmission
} from './planner-setup'
import {
  masteryMatchesForItem,
  type PlannerMasteryMatch
} from './planner-item-matches'
import { searchQueryOptions, searchSchemas } from '@shared/search-schema'
import {
  compareSetCompletion,
  setCompletionCount,
  setItemBadges,
  setItemDiscovered,
  setItemUnqualified,
  setRarity,
  setReadiness,
  setRollRating,
  type SetRollRating
} from './set-semantics'
import {
  ONBOARDING_STEP_COUNT,
  applyContinueWithoutImport,
  type OnboardingStatus
} from './onboarding'
import ToolHeader from './components/ToolHeader.vue'
import type { OracleCandidate } from './stash-oracle'
import {
  isAvailableViaAwakening,
  isCollectionOwned,
  withAwakeningAvailability
} from '@shared/collection-availability'
import {
  compileSearchQuery,
  type CompiledSearchQuery,
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
  ItemPresentationLine,
  ItemRollAnalysis,
  LiveGameStatus,
  MapRegionLocation,
  ObservedStashItem,
  OperationHistoryPage,
  RecoveryStatus,
  RolledStat,
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

interface PresentedRollStat {
  key: string
  label: string
  value: number
  maximumValue: number | null
  unit: string
  valueLabel: string
  percentile: number | null
  rangeLabel: string
}

interface ComparisonStatRow extends PresentedRollStat {
  deltaLabel: string
  deltaTone: 'positive' | 'negative' | 'same' | 'unique' | 'missing' | 'reference'
  percentileDeltaLabel: string | null
  missingFromCopy: boolean
}

interface CollectionSet {
  record: string
  name: string
  items: CollectionItem[]
  collected: number
  availableCopies: number
  minimumLevel: number
  maximumLevel: number
  rollRating: SetRollRating
}

interface RollTrackerSummary {
  median: number | null
  scored: number
}

interface CollectionTriviaFact {
  id: string
  eyebrow: string
  value: string
  title: string
  detail: string
  tone: 'gold' | 'purple' | 'blue' | 'green' | 'ember'
  itemRecord?: string
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
const scanning = ref(false)
const appInitializing = ref(true)
const archiveRollHydrating = ref(false)
const archiveRollHydrationCompleted = ref(0)
const archiveRollHydrationTotal = ref(0)
const scanActivity = ref<'collection' | 'game-data'>('collection')
const backgroundJobs = ref<AnyBackgroundJobSnapshot[]>([])
const activeBackgroundJob = computed(() => backgroundJobs.value
  .filter((job) => job.status === 'queued' || job.status === 'running')
  .sort((left, right) => right.updatedAtUtc.localeCompare(left.updatedAtUtc))[0] ?? null)
let stopBackgroundJobUpdates: (() => void) | null = null
const startupPhaseStatus = ref<StartupStatus | null>(null)
const notifications = createNotificationService()
const currentNotification = notifications.current
const notificationAnnouncement = notifications.announcement
const cacheIssue = ref<string | null>(null)
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
const query = ref('')
const searchQuery = ref('')
const rarityFilter = ref<RarityFilter>('all')
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
const setProgressFilter = ref<SetProgressFilter>('all')
const setFeatureFilter = ref<SetFeatureFilter>('all')
const setSortMode = ref<SetSortMode>('completion')
const setSortDirection = ref<SortDirection>('desc')
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
const plannerProfiles = ref<PlannerProfile[]>(structuredClone(initialPreferences.planner.profiles))
const selectedPlannerProfileId = ref(initialPreferences.planner.selectedProfileId)
const initialPlannerProfile = plannerProfiles.value.find((profile) => profile.id === selectedPlannerProfileId.value)
  ?? plannerProfiles.value[0]
const plannerSkills = ref<string[]>([...(initialPlannerProfile?.skills ?? ['Wendigo Totem'])])
const plannerSkillDraft = ref('')
const plannerSetupOpen = ref(false)
const plannerMinimumLevel = ref(initialPlannerProfile?.minimumLevel ?? 1)
const plannerLevelCap = ref(initialPlannerProfile?.levelCap ?? 70)
const plannerMinimumLevelDraft = ref(plannerMinimumLevel.value)
const plannerLevelCapDraft = ref(plannerLevelCap.value)
let applyingPlannerProfile = false
const plannerDisplay = ref<PlannerDisplay>(initialPreferences.appearance.plannerDisplay)
const plannerPage = ref(1)
const plannerMapScope = ref<PlannerMapScope>('selected')
const plannerMapSortMode = ref<PlannerMapSortMode>('items')
const plannerMapSortDirection = ref<SortDirection>('desc')
const plannerQuery = ref('')
const plannerOwnership = ref<OwnershipFilter>('all')
const plannerSortMode = ref<PlannerSortMode>('level')
const plannerSortDirection = ref<SortDirection>('asc')
const plannerIgnoredRecords = ref<string[]>([...initialPreferences.planner.ignoredRecords])
const plannerFavoriteRecords = ref<string[]>([...initialPreferences.planner.favoriteRecords])
const plannerShowIgnored = ref(false)
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
const discoveredCharacters = ref<CharacterSaveProfile[]>([])
const characterImportLoading = ref(false)
const characterImportError = ref<string | null>(null)
const atlasRegionQuery = ref('')
const selectedAtlasRegion = ref<string | null>(null)
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
const currentPage = ref(1)
const selectedRecord = ref<string | null>(null)
const activeCopyAffixTarget = ref<{ copyKey: string; record: string } | null>(null)
const pinning = ref(false)
const vaultItems = ref<VaultListItem[]>([])
const vaultItemsLoaded = ref(false)
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
const setSearchQuery = computed(() => compileSearchQuery(searchQuery.value, searchQueryOptions(searchSchemas.sets)))
const plannerStructuredQuery = computed(() => compileSearchQuery(plannerQuery.value, searchQueryOptions(searchSchemas.planner)))
const atlasStructuredQuery = computed(() => compileSearchQuery(atlasRegionQuery.value, searchQueryOptions(searchSchemas.atlas)))

const categories = collectionCategories

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
const reusableSupplySummary = computed<CollectionRaritySummary>(() => buildReusableSupplySummary(
  snapshot.value?.supplies ?? [],
  vaultItems.value
))
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
const activeCharacter = computed(() => {
  if (!liveStatus.value?.grimDawnProcessIds.length) return null
  const matching = headerCharacters.value
    .filter((character) => !character.error)
    .filter((character) => liveStatus.value?.isHardcore == null || character.isHardcore === liveStatus.value.isHardcore)
    .filter((character) => !liveStatus.value?.activeCharacterName ||
      character.name.localeCompare(liveStatus.value.activeCharacterName, undefined, { sensitivity: 'base' }) === 0)
    .sort((left, right) => Date.parse(right.lastWriteUtc) - Date.parse(left.lastWriteUtc))
  return matching[0] ?? null
})
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
const collectionBasisLabel = computed(() =>
  collectionBasis.value === 'archive' ? 'Codex Archive' : 'Stash Scanner'
)
const allItemSummary = computed(() => {
  const summaries = ['epic', 'legendary', 'mi']
    .map((name) => rarity(name as 'epic' | 'legendary' | 'mi'))
    .filter((value): value is CollectionRaritySummary => Boolean(value))
  return {
    total: summaries.reduce((sum, value) => sum + value.total, 0),
    collected: summaries.reduce((sum, value) => sum + value.collected, 0),
    availableCopies: summaries.reduce((sum, value) => sum + value.availableCopies, 0)
  }
})
function medianSummary(values: Array<number | null | undefined>): RollTrackerSummary {
  const scored = values
    .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value))
    .sort((left, right) => left - right)
  if (scored.length === 0) return { median: null, scored: 0 }
  const middle = Math.floor(scored.length / 2)
  return {
    median: scored.length % 2 === 0
      ? (scored[middle - 1]! + scored[middle]!) / 2
      : scored[middle]!,
    scored: scored.length
  }
}
function itemRollSummary(rarity?: 'epic' | 'legendary' | 'mi'): RollTrackerSummary {
  const items = (snapshot.value?.items ?? []).filter((item) =>
    ['epic', 'legendary', 'mi'].includes(item.rarity) && (!rarity || item.rarity === rarity)
  )
  if (miCountingMode.value === 'base' && (rarity === 'mi' || rarity === undefined)) {
    const ordinary = items
      .filter((item) => item.rarity !== 'mi')
      .map((item) => item.bestRollPercentile)
    const bestMiByBase = new Map<string, number>()
    for (const item of items.filter((candidate) => candidate.rarity === 'mi')) {
      if (item.bestRollPercentile === null) continue
      const key = miFamilyKey(item)
      bestMiByBase.set(key, Math.max(bestMiByBase.get(key) ?? -1, item.bestRollPercentile))
    }
    return medianSummary([...ordinary, ...bestMiByBase.values()])
  }
  return medianSummary(items.map((item) => item.bestRollPercentile))
}
const allItemRollSummary = computed(() => itemRollSummary())
const legendaryRollSummary = computed(() => itemRollSummary('legendary'))
const epicRollSummary = computed(() => itemRollSummary('epic'))
const miRollSummary = computed(() => itemRollSummary('mi'))
const awakeningAvailableLegendaryCount = computed(() =>
  (snapshot.value?.items ?? []).filter((item) =>
    item.rarity === 'legendary' && itemAvailableByAwakeningOnly(item)
  ).length
)
const setRollSummary = computed(() => medianSummary(
  collectionSets.value.flatMap((set) => set.items.map((item) => item.bestRollPercentile))
))
const affixRollSummary = computed(() => {
  const recordKeys = new Map<string, string>()
  for (const affix of snapshot.value?.affixes ?? []) {
    for (const record of affix.records) recordKeys.set(record.toLocaleLowerCase(), affix.key)
  }
  const best = new Map<string, number>()
  for (const copy of snapshot.value?.observedItems ?? []) {
    for (const [record, score] of [
      [copy.prefixRecord, copy.rollAnalysis?.prefixEstimatedPercentile],
      [copy.suffixRecord, copy.rollAnalysis?.suffixEstimatedPercentile]
    ] as const) {
      if (!record || score === null || score === undefined) continue
      const key = recordKeys.get(record.toLocaleLowerCase())
      if (!key) continue
      best.set(key, Math.max(best.get(key) ?? -1, score))
    }
  }
  return medianSummary([...best.values()])
})
const setSummary = computed(() => ({
  total: collectionSets.value.length,
  collected: collectionSets.value.filter((set) => set.collected === set.items.length).length,
  readyFromStorage: collectionSets.value.filter(setReadyFromStorage).length,
  readyAfterCrafting: collectionSets.value.filter(setReadyAfterCrafting).length,
  readyWithQualifiedAvailability: collectionSets.value.filter(setReadyWithQualifiedAvailability).length
}))
const componentSummary = computed<CollectionRaritySummary>(() => {
  const items = (snapshot.value?.materials ?? []).filter((item) => item.rarity === 'component')
  return {
    rarity: 'component',
    total: items.length,
    collected: items.filter((item) => item.discovered).length,
    availableCopies: items.reduce((count, item) => count + item.availableCount, 0)
  }
})
const consumableSummary = computed<CollectionRaritySummary>(() => {
  const items = (snapshot.value?.materials ?? []).filter((item) => item.rarity === 'consumable')
  return {
    rarity: 'consumable',
    total: items.length,
    collected: items.filter((item) => item.discovered).length,
    availableCopies: items.reduce((count, item) => count + item.availableCount, 0)
  }
})
const categoryProgressByName = computed(() => {
  const progress = new Map<string, string>()
  if (!snapshot.value) {
    for (const category of categories) progress.set(category, '0 / 0')
    return progress
  }
  const entriesByCategory = new Map(categories.map((category) => [category, new Map<string, boolean>()]))
  for (const item of snapshot.value.items) {
    const key = item.rarity === 'mi' && miCountingMode.value === 'base'
      ? `mi:${miFamilyKey(item)}`
      : `item:${item.record.toLocaleLowerCase()}`
    const owned = isCollectionOwned(item)
    for (const category of categories) {
      if (!matchesCollectionCategory(item, category)) continue
      const entries = entriesByCategory.get(category)!
      entries.set(key, Boolean(entries.get(key) || owned))
    }
  }
  for (const category of categories) {
    const entries = entriesByCategory.get(category)!
    let collected = 0
    for (const owned of entries.values()) if (owned) collected += 1
    progress.set(category, `${collected} / ${entries.size}`)
  }
  return progress
})

const collectionSets = computed<CollectionSet[]>(() => {
  if (!snapshot.value) return []
  const grouped = new Map<string, CollectionSet>()
  for (const item of snapshot.value.items) {
    if (!item.setRecord || !item.setName) continue
    const existing = grouped.get(item.setRecord)
    if (existing) {
      existing.items.push(item)
      existing.collected += setItemDiscovered(item) ? 1 : 0
      existing.availableCopies += item.availableCount
      if (item.levelRequirement > 0) {
        existing.minimumLevel = existing.minimumLevel > 0
          ? Math.min(existing.minimumLevel, item.levelRequirement)
          : item.levelRequirement
        existing.maximumLevel = Math.max(existing.maximumLevel, item.levelRequirement)
      }
    } else {
      grouped.set(item.setRecord, {
        record: item.setRecord,
        name: item.setName,
        items: [item],
        collected: setItemDiscovered(item) ? 1 : 0,
        availableCopies: item.availableCount,
        minimumLevel: item.levelRequirement > 0 ? item.levelRequirement : 0,
        maximumLevel: item.levelRequirement > 0 ? item.levelRequirement : 0,
        rollRating: setRollRating([item])
      })
    }
  }
  for (const set of grouped.values()) {
    set.items.sort((left, right) => left.slot.localeCompare(right.slot) || left.name.localeCompare(right.name))
    set.collected = setCompletionCount(set.items)
    set.rollRating = setRollRating(set.items)
  }
  return [...grouped.values()]
})

const visibleSets = computed(() => {
  const structuredQuery = setSearchQuery.value
  const sets = collectionSets.value
    .filter(
      (set) =>
        rarityFilter.value === 'all' || set.items.some((item) => item.rarity === rarityFilter.value)
    )
    .filter((set) => {
      if (setProgressFilter.value === 'complete') return set.collected === set.items.length
      if (setProgressFilter.value === 'progress') {
        return set.collected > 0 && set.collected < set.items.length
      }
      if (setProgressFilter.value === 'unstarted') return set.collected === 0
      return true
    })
    .filter((set) => setFeatureFilter.value === 'all' || setHasVisualChanges(set))
    .filter((set) => {
      if (!structuredQuery.expression || structuredQuery.error) return structuredQuery.matches({ text: '' })
      return set.items.some((item) => structuredQuery.matches(setStructuredSearchDocument(item, set)))
    })
  return sets.sort(compareSets)
})

const collectionTrivia = computed<CollectionTriviaFact[]>(() => {
  if (!snapshot.value) return []
  const facts: CollectionTriviaFact[] = []
  const items = snapshot.value.items
  const physicallyOwned = items.filter((item) => item.availableCount > 0)
  const scored = physicallyOwned
    .filter((item) => item.bestRollPercentile !== null)
    .sort((left, right) => right.bestRollPercentile! - left.bestRollPercentile!)
  const byCopies = (left: CollectionItem, right: CollectionItem) =>
    right.availableCount - left.availableCount || left.name.localeCompare(right.name)

  const legendaryHoard = physicallyOwned
    .filter((item) => item.rarity === 'legendary')
    .sort(byCopies)[0]
  if (legendaryHoard) {
    facts.push({
      id: 'legendary-hoard', eyebrow: 'Purple pile', value: `${legendaryHoard.availableCount}×`,
      title: legendaryHoard.name, detail: 'Your most-copied Legendary item.', tone: 'purple',
      itemRecord: legendaryHoard.record
    })
  }

  const copyChampion = [...physicallyOwned].sort(byCopies)[0]
  if (copyChampion) {
    facts.push({
      id: 'copy-champion', eyebrow: 'Duplicate dynasty', value: `${copyChampion.availableCount}×`,
      title: copyChampion.name,
      detail: `${Math.max(0, copyChampion.availableCount - 1)} copies beyond the first. CC respects the commitment.`,
      tone: copyChampion.rarity === 'epic' ? 'blue' : copyChampion.rarity === 'mi' ? 'green' : 'gold',
      itemRecord: copyChampion.record
    })
  }

  const bestRoll = scored[0]
  if (bestRoll) {
    facts.push({
      id: 'best-roll', eyebrow: 'Roll royalty', value: `${bestRoll.bestRollPercentile!.toFixed(1)}%`,
      title: bestRoll.name,
      detail: `Best estimated aggregate roll among ${scored.length.toLocaleString()} scored item bases.`,
      tone: 'gold', itemRecord: bestRoll.record
    })
  }

  if (scored.length) {
    const nearPerfect = scored.filter((item) => item.bestRollPercentile! >= 95).length
    const excellent = scored.filter((item) => item.bestRollPercentile! >= 90).length
    facts.push({
      id: 'near-perfect', eyebrow: 'Top shelf', value: excellent.toLocaleString(),
      title: '90th-percentile rolls',
      detail: `${nearPerfect.toLocaleString()} item bases clear the 95th percentile.`, tone: 'gold'
    })
  }

  const completeSets = collectionSets.value
    .filter((set) => set.collected === set.items.length)
    .sort((left, right) => right.items.length - left.items.length || left.name.localeCompare(right.name))
  if (completeSets[0]) {
    facts.push({
      id: 'largest-complete-set', eyebrow: 'Set archivist',
      value: `${completeSets[0].items.length}/${completeSets[0].items.length}`, title: completeSets[0].name,
      detail: `Your largest completed collection set. ${completeSets.length} sets are complete in total.`, tone: 'ember',
      itemRecord: completeSets[0].items[0]?.record
    })
  }

  const closestSet = collectionSets.value
    .filter((set) => set.collected > 0 && set.collected < set.items.length)
    .sort((left, right) =>
      right.collected / right.items.length - left.collected / left.items.length ||
      right.collected - left.collected || left.name.localeCompare(right.name)
    )[0]
  if (closestSet) {
    const missing = closestSet.items.filter((item) => !setItemDiscovered(item)).map((item) => item.name)
    facts.push({
      id: 'closest-set', eyebrow: 'Almost assembled', value: `${closestSet.collected}/${closestSet.items.length}`,
      title: closestSet.name,
      detail: `Still missing ${missing.slice(0, 2).join(' and ')}${missing.length > 2 ? `, plus ${missing.length - 2} more` : ''}.`,
      tone: 'ember', itemRecord: closestSet.items[0]?.record
    })
  }

  const dated = items
    .filter((item) => item.firstDiscoveredAt && Number.isFinite(Date.parse(item.firstDiscoveredAt)))
    .sort((left, right) => Date.parse(left.firstDiscoveredAt!) - Date.parse(right.firstDiscoveredAt!))
  if (dated[0]) {
    facts.push({
      id: 'oldest-discovery', eyebrow: 'First page', value: formatTriviaDate(dated[0].firstDiscoveredAt!),
      title: dated[0].name, detail: 'The oldest discovery timestamp still recorded in this archive scope.',
      tone: 'blue', itemRecord: dated[0].record
    })
  }
  const newest = dated.at(-1)
  if (newest && newest.record !== dated[0]?.record) {
    facts.push({
      id: 'newest-discovery', eyebrow: 'Fresh ink', value: formatTriviaDate(newest.firstDiscoveredAt!),
      title: newest.name, detail: 'Your most recently discovered item base.', tone: 'green',
      itemRecord: newest.record
    })
  }

  const slotCounts = new Map<string, number>()
  for (const item of items.filter(isCollectionOwned)) {
    slotCounts.set(item.slot, (slotCounts.get(item.slot) ?? 0) + 1)
  }
  const favoriteSlot = [...slotCounts.entries()].sort((left, right) => right[1] - left[1])[0]
  if (favoriteSlot) {
    facts.push({
      id: 'favorite-slot', eyebrow: 'Armory bias', value: favoriteSlot[1].toLocaleString(),
      title: triviaSlotLabel(favoriteSlot[0]),
      detail: 'The equipment slot with the most discovered catalog entries.', tone: 'blue'
    })
  }

  const miItems = items.filter((item) => item.rarity === 'mi')
  const miFamilies = new Set(miItems.map(miFamilyKey))
  const ownedMiFamilies = new Set(miItems.filter(isCollectionOwned).map(miFamilyKey))
  facts.push({
    id: 'mi-menagerie', eyebrow: 'Green menagerie', value: `${ownedMiFamilies.size}/${miFamilies.size}`,
    title: 'Named MI bases',
    detail: `${miItems.filter(isCollectionOwned).length.toLocaleString()} of ${miItems.length.toLocaleString()} individual level tiers have been discovered.`,
    tone: 'green'
  })

  const topAffix = [...snapshot.value.affixes]
    .filter((affix) => affix.availableCount > 0)
    .sort((left, right) => right.availableCount - left.availableCount || left.name.localeCompare(right.name))[0]
  if (topAffix) {
    facts.push({
      id: 'affix-magnet', eyebrow: 'Affix magnet', value: `${topAffix.availableCount}×`,
      title: topAffix.name, detail: `Your most frequently retained ${topAffix.kind}.`,
      tone: topAffix.rarity === 'rare' ? 'green' : 'blue'
    })
  }

  const duplicateCopies = physicallyOwned.reduce(
    (total, item) => total + Math.max(0, item.availableCount - 1), 0
  )
  facts.push({
    id: 'duplicate-reserve', eyebrow: 'Emergency reserves', value: duplicateCopies.toLocaleString(),
    title: 'Copies beyond completion',
    detail: 'Everything after the first physical copy of each stored item tier.', tone: 'purple'
  })

  return facts
})

const plannerCatalogItems = computed(() => [
  ...(snapshot.value?.items ?? []),
  ...(snapshot.value?.plannerItems ?? [])
])
const selectedPlannerProfile = computed(() =>
  plannerProfiles.value.find((profile) => profile.id === selectedPlannerProfileId.value) ?? null
)
const plannerClassOptions = computed(() => createPlannerClassOptions(snapshot.value?.skillClassNames))
const plannerIgnoredRecordSet = computed(() => new Set(
  plannerIgnoredRecords.value.map((record) => record.toLocaleLowerCase())
))
const plannerFavoriteRecordSet = computed(() => new Set(
  plannerFavoriteRecords.value.map((record) => record.toLocaleLowerCase())
))

const archivedRecordSet = computed(() => {
  if (collectionBasis.value === 'archive') {
    return new Set(
      plannerCatalogItems.value
        .filter((item) => item.availableCount > 0)
        .map((item) => item.record.toLocaleLowerCase())
    )
  }
  return new Set(
    vaultItems.value
      .filter((item) =>
        item.catalogued &&
        item.state === 'ingested' &&
        (snapshot.value?.isHardcore === undefined || item.isHardcore === snapshot.value.isHardcore)
      )
      .map((item) => item.baseRecord.toLocaleLowerCase())
  )
})

const selectedItem = computed(() =>
  plannerCatalogItems.value.find((item) => item.record === selectedRecord.value) ?? null
)

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

const allOwnedCopies = computed(() => {
  const copies = [...(snapshot.value?.observedItems ?? [])]
  const observedVaultIds = new Set(
    copies
      .filter((copy) => copy.sourcePath.startsWith('vault://'))
      .map((copy) => copy.sourcePath.slice('vault://'.length))
  )
  if (!vaultItemsLoaded.value) return copies
  for (const item of vaultItems.value) {
    if (
      observedVaultIds.has(item.id) ||
      !item.catalogued ||
      item.state !== 'ingested' ||
      (snapshot.value?.isHardcore !== undefined && item.isHardcore !== snapshot.value.isHardcore)
    ) continue
    copies.push(vaultItemAsObserved(item, copies.length))
  }
  return copies
})

const selectedCopies = computed(() => {
  if (!snapshot.value || !selectedRecord.value) return []
  const pinned = selectedItem.value?.pinnedInstanceKey
  const copies = allOwnedCopies.value
    .filter((item) => item.baseRecord === selectedRecord.value && item.instanceKey)
  return copies
    .sort((left, right) => {
      if ((left.instanceKey === pinned) !== (right.instanceKey === pinned)) {
        return left.instanceKey === pinned ? -1 : 1
      }
      const metric = selectedItem.value?.rarity === 'mi' ? miWorkshopControls.value.metric : 'overall'
      return compareCopiesByMiMetric(left, right, metric, miWorkshopControls.value.metricDirection)
    })
})

const comparisonReferenceCopy = computed(() => {
  const copies = selectedCopies.value
  if (!copies.length) return null
  const pinned = selectedItem.value?.pinnedInstanceKey
  return copies.find((copy) => copy.instanceKey === pinned) ?? copies.find(isAutoBest) ?? copies[0]!
})

const selectedStoredCopies = computed(() => {
  if (!selectedRecord.value) return []
  return (snapshot.value?.observedItems ?? [])
    .filter((observed) =>
      observed.sourcePath.startsWith('vault://') &&
      observed.baseRecord.toLocaleLowerCase() === selectedRecord.value?.toLocaleLowerCase()
    )
    .flatMap((observed) => {
      const item = vaultItemForObserved(observed)
      if (!item) return []
      return {
        item,
        score: observed?.rollAnalysis?.overallEstimatedPercentile ??
          item.rollAnalysis?.overallEstimatedPercentile ?? null
      }
    })
    .sort((left, right) => (right.score ?? -1) - (left.score ?? -1))
})

const skillNames = computed(() => buildSkillNames(
  plannerCatalogItems.value,
  snapshot.value?.skillMasteries
))

const plannerSkillOptions = computed(() => {
  const needle = plannerSkillDraft.value.trim().toLocaleLowerCase()
  return skillNames.value
    .filter((skill) => !plannerSkills.value.includes(skill))
    .filter((skill) => !needle || skill.toLocaleLowerCase().includes(needle))
    .slice(0, 30)
})

const plannerCandidateRows = computed(() => plannerCatalogItems.value
  .filter((item) => item.levelRequirement >= plannerMinimumLevel.value)
  .filter((item) => item.levelRequirement <= plannerLevelCap.value)
  .filter((item) => {
    const archived = isArchivedItem(item)
    if (plannerOwnership.value === 'owned') return archived
    if (plannerOwnership.value === 'missing') return !archived
    return true
  })
  .filter((item) => plannerStructuredQuery.value.matches(plannerSearchDocument(item)))
  .flatMap((item) => {
    const matches = plannerSkills.value
      .map((skill) => skillMatchForItem(item, skill))
      .filter((match): match is SkillMatch => match !== null)
    const masteryMatches = masteryMatchesForItem(item, selectedPlannerProfile.value?.masteries ?? [])
    const petBonuses = (item.presentation?.sections ?? [])
      .filter((section) => section.kind === 'pet')
      .flatMap((section) => section.lines)
      .map(formatPresentationLine)
    return matches.length > 0 || masteryMatches.length > 0
      ? [{ item, matches, masteryMatches, petBonuses }]
      : []
  })
  .sort((left, right) => {
    const direction = plannerSortDirection.value === 'asc' ? 1 : -1
    const rarityRank: Record<string, number> = { legendary: 5, epic: 4, mi: 3, faction: 2, rare: 1 }
    let comparison = 0
    if (plannerSortMode.value === 'name') comparison = left.item.name.localeCompare(right.item.name)
    else if (plannerSortMode.value === 'rarity') {
      comparison = (rarityRank[left.item.rarity] ?? 0) - (rarityRank[right.item.rarity] ?? 0)
    } else comparison = left.item.levelRequirement - right.item.levelRequirement
    if (comparison === 0) comparison = left.item.name.localeCompare(right.item.name)
    return comparison * direction
  }))

const plannerRows = computed(() => plannerCandidateRows.value.filter(({ item }) => {
  const ignored = plannerIgnoredRecordSet.value.has(plannerRecordKey(item))
  return plannerShowIgnored.value ? ignored : !ignored
}))

const plannerResearchRows = computed<ResearchItemTableRow[]>(() => plannerRows.value.map((row) => {
  const ownership = plannerOwnershipLabel(row.item)
  const roll = researchRollFact(row.item)
  const recipe = recipeStatus(row.item)
  return {
    item: row.item,
    itemType: researchItemTypeLabel(row.item),
    favorite: isPlannerFavorite(row.item),
    ignored: plannerShowIgnored.value,
    supports: [
      ...row.masteryMatches.map((match) => ({
        label: `All ${researchSkillName(match.mastery)} skills`,
        text: match.amount > 0 ? `+${match.amount}` : 'Supported',
        tone: 'accent' as const
      })),
      ...row.matches.map((match) => ({
        label: researchSkillName(match.skill),
        text: match.amount > 0 ? `+${match.amount}` : 'Modifier',
        tone: 'accent' as const
      }))
    ],
    modifiers: [
      ...(row.petBonuses.length ? [{ kind: 'pet' as const, label: 'All pets', text: row.petBonuses.join('; '), tone: 'accent' as const }] : []),
      ...row.masteryMatches.map((match) => ({ kind: 'rank' as const, label: 'Mastery-wide', text: masteryMatchEffect(match), skill: researchSkillName(match.mastery) })),
      ...row.matches.flatMap((match) => [
        ...(match.conversionTarget ? [{ kind: 'conversion' as const, label: 'Converts to', text: match.conversionTarget, tone: 'accent' as const, skill: researchSkillName(match.skill), targetDamageType: match.conversionTarget }] : []),
        ...(match.conversionDetails ? [{ kind: 'conversion' as const, label: researchSkillName(match.skill), text: match.conversionDetails, skill: researchSkillName(match.skill) }] : []),
        ...(match.special ? [{ kind: 'special' as const, label: researchSkillName(match.skill), text: match.special, skill: researchSkillName(match.skill) }] : []),
        ...(!match.conversionDetails && !match.special
          ? [{ kind: 'rank' as const, label: researchSkillName(match.skill), text: match.amount ? `+${match.amount} ranks` : 'Skill support', skill: researchSkillName(match.skill) }]
          : []),
        ...(match.visualTransformation ? [{ kind: 'visual' as const, label: 'Visual', text: match.visualTransformation, tone: 'positive' as const, skill: researchSkillName(match.skill) }] : [])
      ])
    ],
    acquisition: [
      ...(recipe ? [{
        label: 'Blueprint',
        text: recipe.label,
        tone: recipe.known ? 'positive' as const : recipe.known === false ? 'warning' as const : 'muted' as const
      }] : []),
      ...researchAcquisitionFacts(row.item)
    ],
    archive: [
      ...(ownership ? [{ text: ownership, tone: 'positive' as const }] : [{ text: 'Not archived', tone: 'muted' as const }]),
      ...(roll ? [roll] : [])
    ]
  }
}))

const plannerMiItems = computed(() => {
  const source = plannerMapScope.value === 'selected'
    ? plannerRows.value.map((row) => row.item)
    : (snapshot.value?.items ?? []).filter((item) => item.rarity === 'mi')
  return source.filter((item, index) =>
    item.rarity === 'mi' && source.findIndex((candidate) => candidate.record === item.record) === index
  )
})

const atlasRegions = computed(() => {
  const regions = new Map<string, {
    key: string
    name: string
    contentPack: string
    minimumItemLevel: number
    location: MapRegionLocation
    items: CollectionItem[]
  }>()
  for (const item of plannerMiItems.value) {
    for (const location of item.acquisition?.locations ?? []) {
      const key = `${location.contentPack}:${location.name}:${location.routeName ?? ''}`.toLocaleLowerCase()
      const existing = regions.get(key)
      if (existing) {
        if (!existing.items.some((candidate) => candidate.record === item.record)) existing.items.push(item)
        existing.minimumItemLevel = Math.min(existing.minimumItemLevel, item.levelRequirement)
      } else {
        regions.set(key, {
          key,
          name: location.name,
          contentPack: location.contentPack,
          minimumItemLevel: item.levelRequirement,
          location,
          items: [item]
        })
      }
    }
  }
  return [...regions.values()].sort((left, right) =>
    contentPackRank(left.contentPack) - contentPackRank(right.contentPack) ||
    left.minimumItemLevel - right.minimumItemLevel ||
    left.name.localeCompare(right.name)
  )
})

const unlocatedPlannerMiItems = computed(() =>
  plannerMiItems.value.filter((item) => !(item.acquisition?.locations?.length))
)

const visibleAtlasRegions = computed(() => {
  const structuredQuery = atlasStructuredQuery.value
  const direction = plannerMapSortDirection.value === 'asc' ? 1 : -1
  return atlasRegions.value
    .filter((region) => structuredQuery.matches({
      text: [region.name, region.contentPack, ...region.items.map((item) => item.name), ...region.items.flatMap((item) => item.acquisition?.sources ?? [])].join(' '),
      fields: {
        name: region.name,
        area: [region.name, region.location.routeName ?? ''],
        item: region.items.map((item) => item.name),
        monster: region.items.flatMap((item) => item.acquisition?.sources ?? []),
        source: region.items.flatMap((item) => item.acquisition?.sources ?? []),
        pack: region.contentPack,
        level: region.minimumItemLevel
      }
    }))
    .sort((left, right) => {
      let comparison = 0
      if (plannerMapSortMode.value === 'name') comparison = left.name.localeCompare(right.name)
      else if (plannerMapSortMode.value === 'level') comparison = left.minimumItemLevel - right.minimumItemLevel
      else comparison = left.items.length - right.items.length
      if (comparison === 0) comparison = left.name.localeCompare(right.name)
      return comparison * direction
    })
})

const atlasMapPins = computed(() => {
  const regions = visibleAtlasRegions.value.filter((region) =>
    Boolean(region.location.zoneRecord) &&
    Number.isFinite(region.location.originX) &&
    Number.isFinite(region.location.originY)
  )
  if (regions.length === 0) return []
  const xs = regions.map((region) => region.location.originX)
  const ys = regions.map((region) => region.location.originY)
  const minimumX = Math.min(...xs)
  const maximumX = Math.max(...xs)
  const minimumY = Math.min(...ys)
  const maximumY = Math.max(...ys)
  const width = Math.max(1, maximumX - minimumX)
  const height = Math.max(1, maximumY - minimumY)
  return regions.map((region) => ({
    ...region,
    left: 4 + ((region.location.originX - minimumX) / width) * 92,
    top: 4 + ((maximumY - region.location.originY) / height) * 92
  }))
})

const selectedAtlasItems = computed(() =>
  atlasRegions.value.find((region) => region.key === selectedAtlasRegion.value)?.items ?? []
)

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

const activeCopyAffix = computed(() =>
  activeCopyAffixTarget.value
    ? affixByRecord.value.get(activeCopyAffixTarget.value.record.toLocaleLowerCase()) ?? null
    : null
)

const miMetricOptions = computed(() => buildMiMetricOptions(allOwnedCopies.value))
const selectedMiMetricLabel = computed(() =>
  miMetricLabel(miMetricOptions.value, miWorkshopControls.value.metric)
)
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

function masteryMatchEffect(match: PlannerMasteryMatch): string {
  return match.amount > 0
    ? `+${match.amount} rank${match.amount === 1 ? '' : 's'} to every ${match.mastery} skill`
    : `Supports every ${match.mastery} skill`
}

function addPlannerSkill(skill = plannerSkillDraft.value): void {
  const exact = skillNames.value.find(
    (candidate) => candidate.toLocaleLowerCase() === skill.trim().toLocaleLowerCase()
  ) ?? plannerSkillOptions.value[0]
  if (!exact || plannerSkills.value.includes(exact)) return
  plannerSkills.value = [...plannerSkills.value, exact]
  plannerSkillDraft.value = ''
}

function removePlannerSkill(skill: string): void {
  const profile = selectedPlannerProfile.value
  if (profile?.source === 'character' && !profile.excludedSkills.includes(skill)) {
    plannerProfiles.value = plannerProfiles.value.map((candidate) =>
      candidate.id === profile.id
        ? { ...candidate, excludedSkills: [...candidate.excludedSkills, skill] }
        : candidate
    )
  }
  plannerSkills.value = plannerSkills.value.filter((candidate) => candidate !== skill)
}

function restorePlannerSkill(skill: string): void {
  const profile = selectedPlannerProfile.value
  if (!profile || plannerSkills.value.includes(skill)) return
  plannerProfiles.value = plannerProfiles.value.map((candidate) =>
    candidate.id === profile.id
      ? { ...candidate, excludedSkills: candidate.excludedSkills.filter((value) => value !== skill) }
      : candidate
  )
  plannerSkills.value = [...plannerSkills.value, skill]
}

function selectPlannerProfile(profileId: string): void {
  const profile = plannerProfiles.value.find((candidate) => candidate.id === profileId)
  if (!profile) return
  applyingPlannerProfile = true
  selectedPlannerProfileId.value = profile.id
  plannerSkills.value = [...profile.skills]
  plannerMinimumLevel.value = profile.minimumLevel
  plannerLevelCap.value = profile.levelCap
  void nextTick(() => { applyingPlannerProfile = false })
}

function commitPlannerMinimumLevel(): void {
  const next = Math.min(plannerLevelCap.value, Math.max(1, Number(plannerMinimumLevelDraft.value) || 1))
  plannerMinimumLevelDraft.value = next
  plannerMinimumLevel.value = next
}

function commitPlannerLevelCap(): void {
  const next = Math.max(plannerMinimumLevel.value, Math.min(100, Number(plannerLevelCapDraft.value) || 100))
  plannerLevelCapDraft.value = next
  plannerLevelCap.value = next
}

function openPlannerSetup(): void {
  plannerSetupOpen.value = true
}

async function loadCharacterProfiles(): Promise<void> {
  if (characterImportLoading.value) return
  characterImportLoading.value = true
  characterImportError.value = null
  try {
    discoveredCharacters.value = await window.cairnCodex.listCharacters()
  } catch (error) {
    characterImportError.value = readableError(error)
  } finally {
    characterImportLoading.value = false
  }
}

function importCharacterProfile(character: CharacterSaveProfile, setup?: PlannerSetupSubmission): void {
  if (character.error) return
  const existing = plannerProfiles.value.find((profile) =>
    profile.source === 'character' && profile.characterPath?.toLocaleLowerCase() === character.path.toLocaleLowerCase()
  )
  const profile = createCharacterPlannerProfile({
    character,
    skillNames: skillNames.value,
    classOptions: plannerClassOptions.value,
    ...(existing ? { existing } : {}),
    ...(setup ? { setup } : {}),
    id: crypto.randomUUID(),
    modifiedAt: new Date().toISOString()
  })
  plannerProfiles.value = existing
    ? plannerProfiles.value.map((candidate) => candidate.id === existing.id ? profile : candidate)
    : [...plannerProfiles.value, profile]
  selectPlannerProfile(profile.id)
}

function completePlannerSetup(submission: PlannerSetupSubmission): void {
  if (submission.source === 'character') {
    const character = discoveredCharacters.value.find((candidate) => candidate.path === submission.characterPath)
    if (!character) {
      characterImportError.value = 'That character save is no longer available. Reopen New plan and refresh the save list.'
      return
    }
    importCharacterProfile(character, submission)
  } else {
    const profile = createManualPlannerProfile(submission, crypto.randomUUID(), new Date().toISOString())
    plannerProfiles.value = [...plannerProfiles.value, profile]
    selectPlannerProfile(profile.id)
  }
  plannerSetupOpen.value = false
}

async function refreshSelectedCharacterProfile(): Promise<void> {
  const profile = selectedPlannerProfile.value
  if (profile?.source !== 'character' || !profile.characterPath) return
  await loadCharacterProfiles()
  const character = discoveredCharacters.value.find((candidate) =>
    candidate.path.localeCompare(profile.characterPath!, undefined, { sensitivity: 'base' }) === 0
  )
  if (!character) {
    reportTransferProblem('The source character save could not be found. The existing plan was not changed.')
    return
  }
  importCharacterProfile(character)
  reportSuccess(`Refreshed ${profile.name} from its character save.`)
}

function deletePlannerProfile(): void {
  if (plannerProfiles.value.length <= 1) return
  const index = plannerProfiles.value.findIndex((profile) => profile.id === selectedPlannerProfileId.value)
  plannerProfiles.value = plannerProfiles.value.filter((profile) => profile.id !== selectedPlannerProfileId.value)
  const fallback = plannerProfiles.value[Math.max(0, index - 1)] ?? plannerProfiles.value[0]
  if (fallback) selectPlannerProfile(fallback.id)
}

function plannerRecordKey(item: CollectionItem): string {
  return `${item.rarity}:${item.slot}:${normalizeLoose(item.name)}`
}

function recipeStatus(item: CollectionItem): { label: string; known: boolean | null } | null {
  const crafting = item.acquisition?.crafting
  if (!crafting) return null
  const profileMode = selectedPlannerProfile.value?.isHardcore
  if (profileMode !== undefined) {
    const known = profileMode ? crafting.knownHardcore : crafting.knownSoftcore
    return {
      known,
      label: known === null
        ? 'Recipe status unavailable'
        : `${known ? 'Recipe learned' : 'Recipe not learned'} (${profileMode ? 'HC' : 'SC'})`
    }
  }
  if (crafting.knownSoftcore || crafting.knownHardcore) {
    const modes = [crafting.knownSoftcore ? 'SC' : '', crafting.knownHardcore ? 'HC' : ''].filter(Boolean).join(' + ')
    return { known: true, label: `Recipe learned (${modes})` }
  }
  const known = crafting.knownSoftcore === false && crafting.knownHardcore === false ? false : null
  return { known, label: known === false ? 'Recipe not learned' : 'Recipe status unavailable' }
}

function isPlannerFavorite(item: CollectionItem): boolean {
  return plannerFavoriteRecordSet.value.has(plannerRecordKey(item))
}

function togglePlannerFavorite(item: CollectionItem): void {
  const key = plannerRecordKey(item)
  plannerFavoriteRecords.value = plannerFavoriteRecordSet.value.has(key)
    ? plannerFavoriteRecords.value.filter((record) => record.toLocaleLowerCase() !== key)
    : [...plannerFavoriteRecords.value, key]
}

function togglePlannerIgnored(item: CollectionItem): void {
  const key = plannerRecordKey(item)
  plannerIgnoredRecords.value = plannerIgnoredRecordSet.value.has(key)
    ? plannerIgnoredRecords.value.filter((record) => record.toLocaleLowerCase() !== key)
    : [...plannerIgnoredRecords.value, key]
}

function switchPlannerDisplay(display: PlannerDisplay): void {
  const focused = document.activeElement instanceof HTMLElement
    ? document.activeElement.dataset.resultKey
    : undefined
  plannerDisplay.value = display
  if (!focused) return
  void nextTick(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const target = [...document.querySelectorAll<HTMLElement>('[data-result-key]')]
      .find((element) => element.dataset.resultKey === focused)
    target?.scrollIntoView({ block: 'center' })
    target?.focus({ preventScroll: true })
  })
}

function currentAppRoute(): AppRoute {
  const itemRecord = selectedRecord.value
  switch (activeView.value) {
    case 'collection': return { version: 1, workspace: 'collection', itemRecord, controls: {
      ...collectionControls.value
    } }
    case 'sets': return { version: 1, workspace: 'sets', itemRecord, controls: {
      query: query.value, progress: setProgressFilter.value, feature: setFeatureFilter.value,
      sort: setSortMode.value, direction: setSortDirection.value, page: currentPage.value
    } }
    case 'materials': return { version: 1, workspace: 'materials', itemRecord, controls: {
      ...materialsControls.value
    } }
    case 'skills': return { version: 1, workspace: 'skills', itemRecord, controls: {
      ...skillExplorerControls.value
    } }
    case 'planner': return { version: 1, workspace: 'planner', itemRecord, controls: {
      profileId: selectedPlannerProfileId.value, skills: [...plannerSkills.value], minimumLevel: plannerMinimumLevel.value,
      maximumLevel: plannerLevelCap.value, query: plannerQuery.value, ownership: plannerOwnership.value,
      showIgnored: plannerShowIgnored.value, sort: plannerSortMode.value, direction: plannerSortDirection.value,
      display: plannerDisplay.value, page: plannerPage.value, atlasQuery: atlasRegionQuery.value,
      atlasRegion: selectedAtlasRegion.value, mapScope: plannerMapScope.value, mapSort: plannerMapSortMode.value,
      mapDirection: plannerMapSortDirection.value
    } }
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
  }
}

function currentAppHistoryState(index = appHistoryIndex): AppHistoryEntry {
  return createAppHistoryEntry(index, currentAppRoute())
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

function restoreAppRoute(route: AppRoute): void {
  restoringAppHistory = true
  activeView.value = route.workspace
  selectedRecord.value = route.itemRecord
  switch (route.workspace) {
    case 'collection':
      collectionControls.value = { ...route.controls }
      break
    case 'sets':
      if (searchQueryTimer) {
        clearTimeout(searchQueryTimer)
        searchQueryTimer = null
      }
      query.value = route.controls.query
      searchQuery.value = route.controls.query
      setProgressFilter.value = route.controls.progress
      setFeatureFilter.value = route.controls.feature
      setSortMode.value = route.controls.sort
      setSortDirection.value = route.controls.direction
      currentPage.value = route.controls.page
      break
    case 'materials':
      materialsControls.value = { ...route.controls }
      break
    case 'skills':
      skillExplorerControls.value = { ...route.controls }
      break
    case 'planner':
      applyingPlannerProfile = true
      if (route.controls.profileId) selectPlannerProfile(route.controls.profileId)
      if (route.controls.skills.length > 0) plannerSkills.value = [...route.controls.skills]
      plannerMinimumLevel.value = route.controls.minimumLevel
      plannerLevelCap.value = Math.max(route.controls.minimumLevel, route.controls.maximumLevel)
      plannerQuery.value = route.controls.query
      plannerOwnership.value = route.controls.ownership
      plannerShowIgnored.value = route.controls.showIgnored
      plannerSortMode.value = route.controls.sort
      plannerSortDirection.value = route.controls.direction
      plannerDisplay.value = route.controls.display
      plannerPage.value = route.controls.page
      atlasRegionQuery.value = route.controls.atlasQuery
      selectedAtlasRegion.value = route.controls.atlasRegion
      plannerMapScope.value = route.controls.mapScope
      plannerMapSortMode.value = route.controls.mapSort
      plannerMapSortDirection.value = route.controls.mapDirection
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
  }
  void nextTick(() => {
    if (route.workspace === 'mi-workshop') miWorkshopWorkspace.value?.syncNativeControls()
    if (route.workspace === 'vault') {
      scheduleOperationHistoryRefresh()
      scheduleVaultPageRefresh()
    }
    applyingPlannerProfile = false
    restoringAppHistory = false
  })
}

function handlePageShow(): void {
  const entry = parseAppHistoryEntry(window.history.state)
  const route = entry?.route ?? parseAppRouteHash(window.location.hash)
  if (route) restoreAppRoute(route)
}

function handleAppHistory(event: PopStateEvent): void {
  const entry = parseAppHistoryEntry(event.state)
  const route = entry?.route ?? parseAppRouteHash(window.location.hash)
  if (!route) return
  appHistoryIndex = entry?.index ?? 0
  appHistoryMaximum = Math.max(appHistoryMaximum, appHistoryIndex)
  restoreAppRoute(route)
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
  [query, rarityFilter, setProgressFilter, setFeatureFilter, setSortMode, setSortDirection],
  () => {
    if (restoringAppHistory) return
    currentPage.value = 1
  }
)

let searchQueryTimer: ReturnType<typeof setTimeout> | null = null
watch(query, (value) => {
  if (searchQueryTimer) clearTimeout(searchQueryTimer)
  searchQueryTimer = setTimeout(() => {
    searchQuery.value = value
    searchQueryTimer = null
  }, 120)
})

watch(setSortMode, (mode) => {
  if (restoringAppHistory) return
  setSortDirection.value = mode === 'completion' ? 'desc' : 'asc'
})

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
watch(selectedRecord, () => {
  activeCopyAffixTarget.value = null
})
watch([activeView, selectedRecord, transferSection, selectedPlannerProfileId], () => {
  if (!appHistoryReady || restoringAppHistory) return
  appHistoryIndex += 1
  appHistoryMaximum = appHistoryIndex
  writeAppHistory('push')
  updateHistoryButtons()
}, { flush: 'post' })
watch(
  [
    collectionControls, materialsControls,
    query, rarityFilter, currentPage,
    setProgressFilter, setFeatureFilter, setSortMode, setSortDirection,
    skillExplorerControls,
    oracleControls,
    miWorkshopControls,
    plannerSkills, plannerMinimumLevel, plannerLevelCap, plannerQuery, plannerOwnership, plannerShowIgnored,
    plannerSortMode, plannerSortDirection, plannerDisplay, plannerPage, atlasRegionQuery, selectedAtlasRegion,
    plannerMapScope, plannerMapSortMode, plannerMapSortDirection,
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
watch(plannerMinimumLevel, (level) => {
  plannerMinimumLevelDraft.value = level
  if (level > plannerLevelCap.value) plannerLevelCap.value = level
})
watch(plannerLevelCap, (level) => {
  plannerLevelCapDraft.value = level
  if (level < plannerMinimumLevel.value) plannerMinimumLevel.value = level
})
watch(plannerDisplay, (plannerDisplay) => preferenceRepository.update('appearance', { plannerDisplay }))
watch(navigationCollapsed, (navigationCollapsed) => preferenceRepository.update('appearance', { navigationCollapsed }))
watch(tooltipBoundaryScroll, (tooltipBoundaryScroll) => preferenceRepository.update('appearance', { tooltipBoundaryScroll }))
watch([plannerQuery, plannerOwnership, plannerShowIgnored, plannerSortMode, plannerSortDirection, plannerSkills, plannerMinimumLevel, plannerLevelCap], () => {
  if (restoringAppHistory) return
  plannerPage.value = 1
})
watch([plannerSkills, plannerMinimumLevel, plannerLevelCap], () => {
  if (applyingPlannerProfile) return
  plannerProfiles.value = plannerProfiles.value.map((profile) =>
    profile.id === selectedPlannerProfileId.value
      ? {
          ...profile,
          skills: [...plannerSkills.value],
          minimumLevel: plannerMinimumLevel.value,
          levelCap: plannerLevelCap.value,
          modifiedAt: new Date().toISOString()
        }
      : profile
  )
}, { deep: true })
watch(plannerProfiles, (profiles) => {
  preferenceRepository.update('planner', {
    profiles: profiles.map((profile) => ({
      ...profile,
      skills: [...profile.skills],
      excludedSkills: [...profile.excludedSkills]
    }))
  })
}, { deep: true, immediate: true })
watch(selectedPlannerProfileId, (profileId) => {
  preferenceRepository.update('planner', { selectedProfileId: profileId })
})
watch(plannerIgnoredRecords, (records) => {
  preferenceRepository.update('planner', { ignoredRecords: [...records] })
}, { deep: true })
watch(plannerFavoriteRecords, (records) => {
  preferenceRepository.update('planner', { favoriteRecords: [...records] })
}, { deep: true })
watch([plannerMapScope, plannerMinimumLevel, plannerLevelCap, plannerSkills], () => {
  if (restoringAppHistory) return
  selectedAtlasRegion.value = null
})
watch(visibleAtlasRegions, (regions) => {
  if (restoringAppHistory) return
  if (!regions.some((region) => region.key === selectedAtlasRegion.value)) {
    selectedAtlasRegion.value = regions[0]?.key ?? null
  }
}, { immediate: true })
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
  if (initialRoute) restoreAppRoute(initialRoute)
  writeAppHistory('replace', appHistoryIndex)
  appHistoryReady = true
  updateHistoryButtons()
  window.addEventListener('popstate', handleAppHistory)
  window.addEventListener('pageshow', handlePageShow)
  window.addEventListener('keydown', handleEscape)
  window.addEventListener('keyup', handleTooltipKeyUp)
  window.addEventListener('wheel', handleZoomWheel, { passive: false })
  stopBackgroundJobUpdates = window.cairnCodex.onBackgroundJobChanged(retainBackgroundJob)
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
    let cached: CollectionSnapshot | null = null
    try {
      cached = await window.cairnCodex.getCachedCollection(
        [...enabledStashPaths.value],
        collectionBasis.value
      )
    } catch (error) {
      cacheIssue.value = readableError(error)
      console.warn('Cached collection was unavailable; falling back to a full scan.', error)
    }
    if (cached) {
      await reportStartupPhase('cache-hit')
      applySnapshot(cached)
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
  stopBackgroundJobUpdates?.()
  stopBackgroundJobUpdates = null
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
  if (searchQueryTimer) clearTimeout(searchQueryTimer)
  if (vaultPageTimer) clearTimeout(vaultPageTimer)
  if (operationHistoryTimer) clearTimeout(operationHistoryTimer)
  cancelSearchDocumentWarmup()
})

async function scanCollection(startupRun = false, hydrateAfter = true): Promise<void> {
  const requestedSources = [...enabledStashPaths.value]
  const requestedBasis = collectionBasis.value
  const requestedKey = JSON.stringify({
    basis: requestedBasis,
    paths: requestedSources.map((path) => path.toLocaleLowerCase()).sort()
  })
  scanActivity.value = 'collection'
  scanning.value = true
  clearScanProblem()
  let shouldHydrate = false
  if (startupRun) await reportStartupPhase('scan-started')
  try {
    const result = await window.cairnCodex.scanCollection(requestedSources, requestedBasis)
    const currentKey = JSON.stringify({
      basis: collectionBasis.value,
      paths: enabledStashPaths.value.map((path) => path.toLocaleLowerCase()).sort()
    })
    if (requestedKey === currentKey) {
      applySnapshot(result)
      shouldHydrate = liveStatus.value?.state !== 'ready'
    } else {
      const current = await window.cairnCodex.getCachedCollection(
        [...enabledStashPaths.value],
        collectionBasis.value
      )
      if (current) applySnapshot(current)
    }
  } catch (error) {
    reportScanProblem(error instanceof Error ? error.message : 'Collection scan failed.')
  } finally {
    scanning.value = false
    if (startupRun) await reportStartupPhase('scan-settled')
  }
  if (hydrateAfter && shouldHydrate) void hydrateArchiveRolls(startupRun)
  else if (hydrateAfter && startupRun) await reportStartupPhase('roll-analysis-skipped')
}

async function rebuildGameDataIndex(): Promise<void> {
  scanActivity.value = 'game-data'
  scanning.value = true
  try {
    const result = await window.cairnCodex.rebuildGameDataIndex(
      [...enabledStashPaths.value],
      collectionBasis.value
    )
    applySnapshot(result)
    reportSuccess('Game-data and map location indexes rebuilt from the installed Grim Dawn files.')
  } catch (error) {
    reportTransferProblem(readableError(error))
  } finally {
    scanning.value = false
  }
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

function vaultItemAsObserved(item: VaultListItem, itemIndex: number): ObservedStashItem {
  return {
    sourcePath: `vault://${item.id}`,
    tabIndex: -1,
    itemIndex,
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

function formatTriviaDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  })
}

function triviaSlotLabel(slot: string): string {
  const labels: Record<string, string> = {
    head: 'Headgear', chest: 'Chest armor', shoulders: 'Shoulders', hands: 'Gloves',
    legs: 'Leg armor', feet: 'Boots', waist: 'Belts', weapon: 'Weapons', offhand: 'Offhands',
    shield: 'Shields', ring: 'Rings', amulet: 'Amulets', medal: 'Medals', relic: 'Relics'
  }
  return labels[slot] ?? slot.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
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
  const cached = await window.cairnCodex.getCachedCollection(
    [...enabledStashPaths.value],
    collectionBasis.value
  )
  if (cached) {
    applySnapshot(cached)
    void hydrateArchiveRolls()
  }
  else await scanCollection()
  await refreshVault()
}

async function hydrateArchiveRolls(startupRun = false): Promise<void> {
  if (
    archiveRollHydrating.value ||
    collectionBasis.value !== 'archive' ||
    !snapshot.value ||
    liveGameIsReady()
  ) {
    if (startupRun) await reportStartupPhase('roll-analysis-skipped')
    return
  }
  archiveRollHydrating.value = true
  archiveRollHydrationCompleted.value = 0
  archiveRollHydrationTotal.value = 0
  const requestedSources = [...enabledStashPaths.value]
  const requestedSourceKey = JSON.stringify([...requestedSources].sort())
  if (startupRun) await reportStartupPhase('roll-analysis-started')
  try {
    let pending = 1
    while (pending > 0 && collectionBasis.value === 'archive' && !liveGameIsReady()) {
      const result = await window.cairnCodex.hydrateArchiveRolls(requestedSources)
      if (
        !result ||
        collectionBasis.value !== 'archive' ||
        JSON.stringify([...enabledStashPaths.value].sort()) !== requestedSourceKey
      ) break
      archiveRollHydrationCompleted.value += result.processed
      pending = result.pending
      archiveRollHydrationTotal.value = Math.max(
        archiveRollHydrationTotal.value,
        archiveRollHydrationCompleted.value + pending
      )
      if (result.snapshot) applySnapshot(result.snapshot)
      if (result.processed === 0 && pending > 0) {
        console.warn('Archived roll hydration made no progress; stopping this background run.')
        break
      }
      if (pending > 0) await new Promise((resolve) => setTimeout(resolve, 40))
    }
  } catch (error) {
    console.warn('Archived item rolls could not be hydrated in the background.', error)
  } finally {
    archiveRollHydrating.value = false
    if (startupRun) await reportStartupPhase('roll-analysis-settled')
  }
}

function liveGameIsReady(): boolean {
  return liveStatus.value?.state === 'ready'
}

function rarity(name: 'epic' | 'legendary' | 'mi'): CollectionRaritySummary | undefined {
  if (!snapshot.value) return undefined
  if (name !== 'mi' || miCountingMode.value === 'tier') {
    return snapshot.value.rarities.find((summary) => summary.rarity === name)
  }
  const families = new Map<string, CollectionItem[]>()
  for (const item of snapshot.value.items.filter((candidate) => candidate.rarity === 'mi')) {
    const key = miFamilyKey(item)
    const family = families.get(key)
    if (family) family.push(item)
    else families.set(key, [item])
  }
  return {
    rarity: 'mi',
    total: families.size,
    collected: [...families.values()].filter((family) => family.some(isCollectionOwned)).length,
    availableCopies: [...families.values()].reduce(
      (count, family) => count + family.reduce((sum, item) => sum + item.availableCount, 0),
      0
    )
  }
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
  plannerSkills.value = [...new Set([candidate.skill, ...candidate.relatedSkills])]
  plannerMinimumLevelDraft.value = Math.min(plannerMinimumLevel.value, oracleControls.value.minimumLevel)
  plannerLevelCapDraft.value = Math.max(plannerLevelCap.value, oracleControls.value.maximumLevel)
  plannerMinimumLevel.value = plannerMinimumLevelDraft.value
  plannerLevelCap.value = plannerLevelCapDraft.value
  plannerQuery.value = ''
  plannerOwnership.value = 'all'
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

function percentage(summary: Pick<CollectionRaritySummary, 'total' | 'collected'> | undefined): string {
  if (!summary || summary.total === 0) return '0%'
  return ((summary.collected / summary.total) * 100).toFixed(1) + '%'
}

function cachedCollectionTime(): string {
  if (!snapshot.value) return ''
  const asOfUtc = snapshot.value.cachedDataAsOfUtc ?? snapshot.value.scannedAtUtc
  const scanned = new Date(asOfUtc)
  return Number.isNaN(scanned.getTime()) ? asOfUtc : scanned.toLocaleString()
}

function affixPercentage(): string {
  const summary = snapshot.value?.affixSummary
  if (!summary || summary.total === 0) return '0%'
  return ((summary.collected / summary.total) * 100).toFixed(1) + '%'
}

function recipePercentage(): string {
  const summary = snapshot.value?.recipeSummary
  if (!summary || summary.total === 0) return '0%'
  return ((summary.collected / summary.total) * 100).toFixed(1) + '%'
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
  try {
    const [summary, safety, live] = await Promise.allSettled([
      window.cairnCodex.getVaultSummary(),
      window.cairnCodex.inspectWriteSafety(),
      window.cairnCodex.inspectLiveGame()
    ])
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
    if (activeView.value === 'supplies' || activeView.value === 'dismantling') {
      await refreshFullVaultItems()
    }
  } catch (error) {
    reportTransferProblem(readableError(error))
  }
}

async function refreshFullVaultItems(): Promise<void> {
  const items = await window.cairnCodex.listVaultItems()
  vaultItems.value = items
  vaultItemsLoaded.value = true
  supplySession.selectedIds.value = supplySession.selectedIds.value.filter((id) =>
    id.startsWith('augment:') ||
    items.some((item) => item.id === id && item.state === 'ingested' && item.rarity === 'supply')
  )
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
    const currentCharacterResolved = Boolean(
      current.activeCharacterName && headerCharacters.value.some((character) =>
        !character.error &&
        character.name.localeCompare(current.activeCharacterName!, undefined, { sensitivity: 'base' }) === 0 &&
        (current.isHardcore == null || character.isHardcore === current.isHardcore)
      )
    )
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

async function retrieveSelectedLive(): Promise<void> {
  if (selectedVaultIds.value.length === 0 || vaultBusy.value) return
  const count = selectedVaultIds.value.length
  const selected = selectedVaultIds.value.map(vaultItemForId)
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

async function retrieveSupplies(selected: SupplyOption[], mode: TransferMode): Promise<void> {
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
    if (mode === 'live') await retrieveSelectedLive()
    else await retrieveSelected()
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
  snapshot.value = withUpdatedSummaries({ ...snapshot.value, observedItems, items, supplies })
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
  snapshot.value = withUpdatedSummaries({ ...snapshot.value, observedItems, items, supplies })
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

async function retrieveSelected(): Promise<void> {
  if (selectedVaultIds.value.length === 0 || vaultBusy.value) return
  const selected = selectedVaultIds.value.map(vaultItemForId)
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

function setCompletionPercent(set: CollectionSet): string {
  return ((set.collected / set.items.length) * 100).toFixed(1) + '%'
}

function setReadyFromStorage(set: CollectionSet): boolean {
  return set.items.every((item) => item.availableCount > 0)
}

function setReadyAfterCrafting(set: CollectionSet): boolean {
  return set.items.every((item) => item.availableCount > 0 || item.recipeUnlocked)
}

function setReadyWithQualifiedAvailability(set: CollectionSet): boolean {
  return set.items.every((item) =>
    item.availableCount > 0 || item.recipeUnlocked || isAvailableViaAwakening(item)
  )
}

function itemAvailableByAwakeningOnly(item: CollectionItem): boolean {
  return item.availableCount === 0 && isAvailableViaAwakening(item)
}

function awakeningAvailabilityLabel(item: CollectionItem): string {
  const source = item.awakeningSourceName ?? 'owned Epic base'
  const count = item.awakeningSourceAvailableCount ?? 0
  return `Available by awakening ${source}${count > 1 ? ` (${count} bases)` : ''}`
}

function setLevelLabel(set: CollectionSet): string {
  if (set.maximumLevel <= 0) return 'No level requirement'
  if (set.minimumLevel === set.maximumLevel) return `Level ${set.minimumLevel}`
  return `Levels ${set.minimumLevel}–${set.maximumLevel}`
}

function compareSets(left: CollectionSet, right: CollectionSet): number {
  let comparison = 0
  if (setSortMode.value === 'level') {
    comparison = left.minimumLevel - right.minimumLevel || left.maximumLevel - right.maximumLevel
  } else if (setSortMode.value === 'completion') {
    comparison = compareSetCompletion(left.items, right.items)
  } else {
    comparison = left.name.localeCompare(right.name)
  }
  if (comparison === 0) comparison = left.name.localeCompare(right.name)
  return setSortDirection.value === 'asc' ? comparison : -comparison
}

function bestStoredCopy(record: string): VaultListItem | null {
  const matches = (snapshot.value?.observedItems ?? [])
    .filter((copy) =>
      copy.sourcePath.startsWith('vault://') &&
      copy.baseRecord.toLocaleLowerCase() === record.toLocaleLowerCase()
    )
    .flatMap((copy) => {
      const item = vaultItemForObserved(copy)
      return item ? [item] : []
    })
  if (matches.length === 0) return null
  return matches.sort((left, right) => {
    const leftCopy = snapshot.value?.observedItems.find((copy) => copy.sourcePath === `vault://${left.id}`)
    const rightCopy = snapshot.value?.observedItems.find((copy) => copy.sourcePath === `vault://${right.id}`)
    return (
      (rightCopy?.rollAnalysis?.overallEstimatedPercentile ?? -1) -
      (leftCopy?.rollAnalysis?.overallEstimatedPercentile ?? -1)
    )
  })[0]!
}

function openItem(item: CollectionItem): void {
  hideTooltip()
  selectedRecord.value = item.record
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
  if (collectionBasis.value === 'archive' && item.discovered) return 'Archived'
  return null
}

function normalizeLoose(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '')
}

function plannerSearchDocument(item: CollectionItem): SearchDocument {
  const itemDocument = itemStructuredSearchDocument(item)
  const sources = item.acquisition?.sources ?? []
  const areas = (item.acquisition?.locations ?? []).flatMap((location) => [location.name, location.routeName ?? ''])
  return {
    text: [itemDocument.text, ...sources, ...areas].join(' '),
    fields: {
      name: item.name,
      type: item.itemClass,
      slot: item.slot,
      rarity: item.rarity,
      skill: itemDocument.fields?.skill,
      damage: itemDocument.fields?.damage,
      source: sources,
      area: areas,
      level: item.levelRequirement,
      owned: isArchivedItem(item)
    }
  }
}

function searchErrorMessage(query: CompiledSearchQuery): string | null {
  if (!query.error) return null
  return query.error.fragment
    ? `${query.error.message} Check “${query.error.fragment}”.`
    : query.error.message
}

function contentPackRank(contentPack: string): number {
  return ({ base: 0, gdx1: 1, gdx2: 2, gdx3: 3 } as Record<string, number>)[contentPack] ?? 9
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

function setStructuredSearchDocument(item: CollectionItem, set: CollectionSet): SearchDocument {
  const document = itemStructuredSearchDocument(item)
  const fx = (item.presentation?.sections ?? []).some((section) => section.kind === 'visual-modifier') ||
    (item.setPresentation?.tiers ?? []).some((tier) =>
      (tier.skillModifiers ?? []).some((section) => section.kind === 'visual-modifier')
    )
  return {
    text: document.text,
    fields: {
      ...document.fields,
      owned: setItemDiscovered(item),
      complete: set.collected === set.items.length,
      craftable: item.recipeUnlocked === true,
      awakening: isAvailableViaAwakening(item),
      fx
    }
  }
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

function setMemberVisualChanges(set: CollectionSet) {
  return set.items.flatMap((item) =>
    (item.presentation?.sections ?? [])
      .filter((section) => section.kind === 'visual-modifier')
      .map((section) => ({ item, section }))
  )
}

function setHasVisualChanges(set: CollectionSet): boolean {
  return setMemberVisualChanges(set).length > 0 ||
    (set.items[0]?.setPresentation?.tiers ?? []).some((tier) =>
      (tier.skillModifiers ?? []).some((section) => section.kind === 'visual-modifier')
    )
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
    if (tooltipBoundaryScroll.value === 'contain') {
      event.preventDefault()
      event.stopPropagation()
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

function formatPresentationLine(line: ItemPresentationLine): string {
  const minimum = line.minimum === null ? '' : formatRollValue(line.minimum)
  const maximum = line.maximum === null ? '' : formatRollValue(line.maximum)
  const range = maximum ? `${minimum}${line.unit} - ${maximum}${line.unit}` : `${minimum}${line.unit}`
  return `${line.prefix}${range}${range ? ' ' : ''}${line.label}${line.suffix}`
}

async function pinCopy(copy: ObservedStashItem): Promise<void> {
  if (!selectedItem.value || !copy.instanceKey || pinning.value) return
  pinning.value = true
  try {
    const next = selectedItem.value.pinnedInstanceKey === copy.instanceKey ? null : copy.instanceKey
    const source = stashChoices.value.find((stash) => stash.path === copy.sourcePath)
    await window.cairnCodex.setPinnedBest(
      selectedItem.value.record,
      next,
      source?.isHardcore ?? snapshot.value?.isHardcore ?? false
    )
    selectedItem.value.pinnedInstanceKey = next
  } finally {
    pinning.value = false
  }
}

function isAutoBest(copy: ObservedStashItem): boolean {
  const score = copy.rollAnalysis?.overallEstimatedPercentile
  const best = selectedItem.value?.bestRollPercentile
  return score !== null && score !== undefined && best !== null && best !== undefined && Math.abs(score - best) < 0.0000001
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
    isHardcore: snapshot.value?.isHardcore ?? false,
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

function copyAffixName(record: string, emptyLabel: string): string {
  if (!record) return emptyLabel
  return affixByRecord.value.get(record.toLocaleLowerCase())?.name ??
    record.replaceAll('\\', '/').split('/').at(-1)?.replace(/\.dbr$/i, '') ?? record
}

function copyAffixRarity(record: string): 'magical' | 'rare' | null {
  if (!record) return null
  return affixByRecord.value.get(record.toLocaleLowerCase())?.rarity ?? null
}

function copyAffixRarityLabel(record: string): string {
  const rarity = copyAffixRarity(record)
  return rarity === 'magical' ? 'Magic' : rarity === 'rare' ? 'Rare' : 'Unknown rarity'
}

function copyAffixKey(copy: ObservedStashItem, record: string): string {
  return `${copy.instanceKey ?? `${copy.sourcePath}:${copy.tabIndex}:${copy.itemIndex}`}|${record}`
}

function copyAffixIsOpen(copy: ObservedStashItem, record: string): boolean {
  return Boolean(record) && activeCopyAffixTarget.value?.copyKey === copyAffixKey(copy, record)
}

function toggleCopyAffix(copy: ObservedStashItem, record: string): void {
  if (!record) return
  const copyKey = copyAffixKey(copy, record)
  activeCopyAffixTarget.value = activeCopyAffixTarget.value?.copyKey === copyKey
    ? null
    : { copyKey, record }
}

function copySourceLabel(copy: ObservedStashItem): string {
  if (vaultCopyForObserved(copy)) return 'Stored in Codex Archive'
  const name = copy.sourcePath.replaceAll('\\', '/').split('/').at(-1)
  return name ? `Currently in ${name}` : 'Currently scanned copy'
}

function presentRolledStats(source: RolledStat[] | undefined, includeFixed = false): PresentedRollStat[] {
  const stats = (source ?? [])
    .filter((stat) => includeFixed || stat.estimatedPercentile !== null)
  const byField = new Map(stats.map((stat) => [stat.field, stat]))
  const consumed = new Set<string>()
  return stats
    .flatMap<PresentedRollStat>((stat): PresentedRollStat[] => {
      if (consumed.has(stat.field)) return []
      if (stat.field.endsWith('Max') && byField.has(stat.field.slice(0, -3))) return []
      const root = stat.field.endsWith('Min') ? stat.field.slice(0, -3) : stat.field
      const maximum = byField.get(root + 'Max')
      if (maximum && maximum.field !== stat.field) {
        if (maximum && (includeFixed || maximum.estimatedPercentile !== null)) {
          consumed.add(maximum.field)
          const unit = rollStatUnit(root)
          const valueLabel =
            stat.value === maximum.value
              ? `${formatRollValue(stat.value)}${unit}`
              : `${formatRollValue(stat.value)}–${formatRollValue(maximum.value)}${unit}`
          return [
            {
              key: root,
              label: rollStatName(root),
              value: stat.value,
              maximumValue: maximum.value,
              unit,
              valueLabel,
              percentile: stat.estimatedPercentile === null || maximum.estimatedPercentile === null
                ? null
                : (stat.estimatedPercentile + maximum.estimatedPercentile) / 2,
              rangeLabel: `${formatRollValue(stat.observedMinimum ?? stat.value)}–${formatRollValue(maximum.observedMaximum ?? maximum.value)}${unit}`
            }
          ]
        }
      }
      return [
        {
          key: stat.field,
          label: rollStatName(stat.field),
          value: stat.value,
          maximumValue: null,
          unit: rollStatUnit(stat.field),
          valueLabel: `${formatRollValue(stat.value)}${rollStatUnit(stat.field)}`,
          percentile: stat.estimatedPercentile,
          rangeLabel: `${formatRollValue(stat.observedMinimum ?? stat.value)}–${formatRollValue(stat.observedMaximum ?? stat.value)}${rollStatUnit(stat.field)}`
        }
      ]
    })
    .sort((left, right) => left.label.localeCompare(right.label))
}

function rollStatName(field: string): string {
  if (field.startsWith('conversionPercentage')) {
    const conversionIndex = field.endsWith('2') ? 1 : 0
    const conversions = (selectedItem.value?.presentation?.sections ?? [])
      .flatMap((section) => section.lines)
      .filter((line) => line.label.includes('Damage converted to'))
    return conversions[conversionIndex]?.label ?? 'Damage conversion'
  }
  return humanStatName(field)
}

function rollStatUnit(field: string): string {
  if (
    field.startsWith('conversionPercentage') ||
    field.endsWith('Modifier') ||
    (field.startsWith('defensive') &&
      !['defensiveProtection', 'defensiveBlock', 'defensiveBonusProtection'].includes(field)) ||
    field === 'offensiveLifeLeechMin' ||
    field.includes('Chance') ||
    field.includes('Reduction')
  ) return '%'
  return ''
}

function rollableStats(copy: ObservedStashItem) {
  return presentRolledStats(copy.rollAnalysis?.stats)
}

function petRollableStats(copy: ObservedStashItem) {
  return presentRolledStats(copy.rollAnalysis?.petStats, true)
}

function formatSignedRollDelta(value: number, unit: string): string {
  if (Math.abs(value) < 0.0000001) return `0${unit}`
  return `${value > 0 ? '+' : '−'}${formatRollValue(Math.abs(value))}${unit}`
}

function statValuesMatch(left: PresentedRollStat, right: PresentedRollStat): boolean {
  return left.value === right.value && left.maximumValue === right.maximumValue
}

function comparisonStats(copy: ObservedStashItem, pet: boolean): ComparisonStatRow[] {
  const reference = comparisonReferenceCopy.value
  const sourceFor = (candidate: ObservedStashItem) => presentRolledStats(
    pet ? candidate.rollAnalysis?.petStats : candidate.rollAnalysis?.stats,
    true
  )
  const current = new Map(sourceFor(copy).map((stat) => [stat.key, stat]))
  const referenceStats = new Map((reference ? sourceFor(reference) : []).map((stat) => [stat.key, stat]))
  const universe = new Map<string, PresentedRollStat[]>()
  for (const candidate of selectedCopies.value) {
    for (const stat of sourceFor(candidate)) {
      const existing = universe.get(stat.key)
      if (existing) existing.push(stat)
      else universe.set(stat.key, [stat])
    }
  }
  return [...universe.entries()]
    .filter(([, variants]) =>
      variants.some((stat) => stat.percentile !== null) ||
      variants.length !== selectedCopies.value.length ||
      variants.some((stat) => !statValuesMatch(stat, variants[0]!))
    )
    .map(([key, variants]) => {
      const own = current.get(key)
      const baseline = referenceStats.get(key)
      const template = own ?? baseline ?? variants[0]!
      const isReference = copy.instanceKey === reference?.instanceKey
      if (isReference) {
        return {
          ...template,
          valueLabel: own?.valueLabel ?? '—',
          percentile: own?.percentile ?? null,
          deltaLabel: 'Reference',
          deltaTone: 'reference' as const,
          percentileDeltaLabel: null,
          missingFromCopy: !own
        }
      }
      if (!own && baseline) {
        return {
          ...baseline,
          valueLabel: '—',
          percentile: null,
          deltaLabel: `Missing ${baseline.valueLabel}`,
          deltaTone: 'missing' as const,
          percentileDeltaLabel: null,
          missingFromCopy: true
        }
      }
      if (own && !baseline) {
        return {
          ...own,
          deltaLabel: `Adds ${own.valueLabel}`,
          deltaTone: 'unique' as const,
          percentileDeltaLabel: null,
          missingFromCopy: false
        }
      }
      if (!own || !baseline) {
        return {
          ...template,
          valueLabel: own?.valueLabel ?? '—',
          percentile: own?.percentile ?? null,
          deltaLabel: '—',
          deltaTone: 'same' as const,
          percentileDeltaLabel: null,
          missingFromCopy: !own
        }
      }
      const lowerDelta = own.value - baseline.value
      const upperDelta = own.maximumValue !== null || baseline.maximumValue !== null
        ? (own.maximumValue ?? own.value) - (baseline.maximumValue ?? baseline.value)
        : null
      const deltaLabel = upperDelta !== null && upperDelta !== lowerDelta
        ? `${formatSignedRollDelta(lowerDelta, own.unit)} / ${formatSignedRollDelta(upperDelta, own.unit)}`
        : formatSignedRollDelta(lowerDelta, own.unit)
      const percentileDelta = own.percentile !== null && baseline.percentile !== null
        ? own.percentile - baseline.percentile
        : null
      return {
        ...own,
        deltaLabel: statValuesMatch(own, baseline) ? 'Same value' : deltaLabel,
        deltaTone: lowerDelta > 0 || (lowerDelta === 0 && (upperDelta ?? 0) > 0)
          ? 'positive' as const
          : lowerDelta < 0 || (lowerDelta === 0 && (upperDelta ?? 0) < 0)
            ? 'negative' as const
            : 'same' as const,
        percentileDeltaLabel: percentileDelta === null || Math.abs(percentileDelta) < 0.05
          ? null
          : `${percentileDelta > 0 ? '+' : '−'}${Math.abs(percentileDelta).toFixed(0)} percentile points`,
        missingFromCopy: false
      }
    })
    .sort((left, right) => left.label.localeCompare(right.label))
}

function comparisonItemStats(copy: ObservedStashItem): ComparisonStatRow[] {
  return comparisonStats(copy, false)
}

function comparisonPetStats(copy: ObservedStashItem): ComparisonStatRow[] {
  return comparisonStats(copy, true)
}

function copyOverallDelta(copy: ObservedStashItem): string {
  const score = copy.rollAnalysis?.overallEstimatedPercentile
  const reference = comparisonReferenceCopy.value?.rollAnalysis?.overallEstimatedPercentile
  if (copy.instanceKey === comparisonReferenceCopy.value?.instanceKey) return 'Reference score'
  if (score == null || reference == null) return 'No comparable score'
  const delta = score - reference
  if (Math.abs(delta) < 0.05) return 'Same overall score'
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} percentile points vs reference`
}

function copyAffixDelta(copy: ObservedStashItem, kind: 'prefix' | 'suffix'): string {
  const reference = comparisonReferenceCopy.value
  if (!reference || copy.instanceKey === reference.instanceKey) return 'Reference affix'
  const record = kind === 'prefix' ? copy.prefixRecord : copy.suffixRecord
  const baseline = kind === 'prefix' ? reference.prefixRecord : reference.suffixRecord
  if (record === baseline) return 'Same as reference'
  if (!record) return 'Missing vs reference'
  if (!baseline) return 'Added vs reference'
  return 'Different from reference'
}

function formatRollValue(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1)
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
              <div v-if="activeCharacter"><dt>Detected by</dt><dd>Newest matching save file</dd></div>
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

    <div v-if="triviaOpen" class="trivia-backdrop" @click.self="triviaOpen = false">
      <section class="trivia-dialog" role="dialog" aria-modal="true" aria-labelledby="trivia-title">
        <header>
          <div>
            <p class="section-label">Collection trivia</p>
            <h2 id="trivia-title">Codex Curiosities</h2>
            <p>Odd records and minor triumphs from the currently selected archive scope.</p>
          </div>
          <button type="button" class="todo-close" aria-label="Close collection trivia" @click="triviaOpen = false">×</button>
        </header>
        <div class="trivia-scroll">
          <div v-if="collectionTrivia.length" class="trivia-grid">
            <component
              :is="fact.itemRecord ? 'button' : 'article'"
              v-for="fact in collectionTrivia"
              :key="fact.id"
              :type="fact.itemRecord ? 'button' : undefined"
              class="trivia-fact"
              :class="[`tone-${fact.tone}`, { actionable: fact.itemRecord }]"
              @click="openTriviaItem(fact.itemRecord)"
            >
              <span class="trivia-eyebrow">{{ fact.eyebrow }}</span>
              <strong class="trivia-value">{{ fact.value }}</strong>
              <h3>{{ fact.title }}</h3>
              <p>{{ fact.detail }}</p>
              <small v-if="fact.itemRecord">Inspect item →</small>
            </component>
          </div>
          <p v-else class="todo-empty">The Codex needs a few discoveries before it can become nosy.</p>
        </div>
        <footer>
          <span>{{ collectionTrivia.length }} curiosities · recalculated from live collection data</span>
          <button type="button" @click="triviaOpen = false">Close</button>
        </footer>
      </section>
    </div>

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
      <section v-if="activeView === 'collection'" class="hero">
        <div>
          <p class="section-label">{{ collectionBasisLabel }}</p>
          <h2>{{ snapshot ? 'Your collection has entered the Codex.' : 'Reading the archives of Cairn…' }}</h2>
          <p class="hero-copy">
            <template v-if="discovery?.installations[0]">
              {{ sourceModeLabel }} ·
              {{ snapshot?.contentPacks.length ?? 0 }} content packs ·
              {{ snapshot?.scannedStashes.length ?? 0 }} transfer stashes ·
              {{ snapshot?.items.length.toLocaleString() ?? 0 }} catalog entries ·
              {{ archivedCopyCount.toLocaleString() }} archived copies
            </template>
            <template v-else>
              Locating Grim Dawn, its item database, and transfer stashes.
            </template>
          </p>
        </div>
        <button class="primary-action" type="button" :disabled="scanning" @click="scanCollection()">
          {{ scanning ? 'Reading the archives…' : 'Refresh collection' }}
        </button>
      </section>

      <section v-if="snapshot && activeView === 'collection'" class="completion-tracker" aria-label="Collection completion">
        <header>
          <div><p class="section-label">Collection progress</p><strong>{{ allItemSummary.collected }} / {{ allItemSummary.total }} tracked entries</strong></div>
          <button type="button" :aria-expanded="!trackerCollapsed" @click="toggleTracker">{{ trackerCollapsed ? 'Show trackers' : 'Hide trackers' }}</button>
        </header>
        <div v-if="!trackerCollapsed" class="metrics">
        <button
          type="button"
          :aria-pressed="collectionControls.rarity === 'all'"
          @click="filterToAllRarities"
        >
          <div class="metric-heading">
            <span>All items</span>
            <strong>{{ allItemSummary.collected }} / {{ allItemSummary.total || '—' }}</strong>
          </div>
          <div class="meter all"><span :style="{ width: percentage(allItemSummary) }" /></div>
          <small>
            {{ percentage(allItemSummary) }} discovered · Epic, Legendary, and {{ miCountingMode === 'base' ? 'MI bases' : 'MI level tiers' }}
            <template v-if="allItemRollSummary.median !== null"> · median best {{ allItemRollSummary.median.toFixed(1) }}% ({{ allItemRollSummary.scored }} scored)</template>
          </small>
        </button>
        <button
          type="button"
          :aria-pressed="collectionControls.rarity === 'legendary'"
          @click="filterToRarity('legendary')"
        >
          <div class="metric-heading">
            <span>Legendaries</span>
            <strong>{{ rarity('legendary')?.collected ?? 0 }} / {{ rarity('legendary')?.total ?? '—' }}</strong>
          </div>
          <div class="meter legendary"><span :style="{ width: percentage(rarity('legendary')) }" /></div>
          <small>
            {{ percentage(rarity('legendary')) }} discovered · {{ rarity('legendary')?.availableCopies ?? 0 }} copies available
            <template v-if="awakeningAvailableLegendaryCount"> · {{ awakeningAvailableLegendaryCount }} available by awakening</template>
            <template v-if="legendaryRollSummary.median !== null"> · median best {{ legendaryRollSummary.median.toFixed(1) }}% ({{ legendaryRollSummary.scored }} scored)</template>
          </small>
        </button>
        <button
          type="button"
          :aria-pressed="collectionControls.rarity === 'epic'"
          @click="filterToRarity('epic')"
        >
          <div class="metric-heading">
            <span>Epics</span>
            <strong>{{ rarity('epic')?.collected ?? 0 }} / {{ rarity('epic')?.total ?? '—' }}</strong>
          </div>
          <div class="meter epic"><span :style="{ width: percentage(rarity('epic')) }" /></div>
          <small>
            {{ percentage(rarity('epic')) }} discovered · {{ rarity('epic')?.availableCopies ?? 0 }} copies available
            <template v-if="epicRollSummary.median !== null"> · median best {{ epicRollSummary.median.toFixed(1) }}% ({{ epicRollSummary.scored }} scored)</template>
          </small>
        </button>
        <button
          type="button"
          :aria-pressed="collectionControls.rarity === 'mi'"
          @click="filterToRarity('mi')"
        >
          <div class="metric-heading">
            <span>{{ miCountingMode === 'base' ? 'MI Bases' : 'MI Level Tiers' }}</span>
            <strong>{{ rarity('mi')?.collected ?? 0 }} / {{ rarity('mi')?.total ?? '—' }}</strong>
          </div>
          <div class="meter mi"><span :style="{ width: percentage(rarity('mi')) }" /></div>
          <small>
            {{ percentage(rarity('mi')) }} discovered · {{ miCountingMode === 'base' ? 'any owned tier completes its base' : 'every obtainable level tier counted separately' }}
            <template v-if="miRollSummary.median !== null"> · median best {{ miRollSummary.median.toFixed(1) }}% ({{ miRollSummary.scored }} scored)</template>
          </small>
        </button>
        <button
          type="button"
          aria-pressed="false"
          @click="openAffixWorkshop"
        >
          <div class="metric-heading">
            <span>Affixes</span>
            <strong>{{ snapshot?.affixSummary.collected ?? 0 }} / {{ snapshot?.affixSummary.total ?? '—' }}</strong>
          </div>
          <div class="meter affix"><span :style="{ width: affixPercentage() }" /></div>
          <small>
            {{ affixPercentage() }} discovered · prefixes and suffixes
            <template v-if="affixRollSummary.median !== null"> · median best {{ affixRollSummary.median.toFixed(1) }}% ({{ affixRollSummary.scored }} scored)</template>
          </small>
        </button>
        <button
          type="button"
          aria-pressed="false"
          @click="openSets"
        >
          <div class="metric-heading">
            <span>Sets</span>
            <strong>{{ setSummary.collected }} / {{ setSummary.total || '—' }}</strong>
          </div>
          <div class="meter set"><span :style="{ width: percentage(setSummary) }" /></div>
          <small>
            {{ percentage(setSummary) }} complete · {{ setSummary.readyFromStorage }} ready from storage
            <template v-if="setSummary.readyAfterCrafting > setSummary.readyFromStorage">
              · {{ setSummary.readyAfterCrafting - setSummary.readyFromStorage }} more after crafting
            </template>
            <template v-if="setSummary.readyWithQualifiedAvailability > setSummary.readyAfterCrafting">
              · {{ setSummary.readyWithQualifiedAvailability - setSummary.readyAfterCrafting }} more with awakening
            </template>
            <template v-if="setRollSummary.median !== null"> · median best piece {{ setRollSummary.median.toFixed(1) }}% ({{ setRollSummary.scored }} scored)</template>
          </small>
        </button>
        <button
          type="button"
          aria-pressed="false"
          @click="openMaterials('component')"
        >
          <div class="metric-heading">
            <span>Components</span>
            <strong>{{ componentSummary.collected }} / {{ componentSummary.total || '—' }}</strong>
          </div>
          <div class="meter component"><span :style="{ width: percentage(componentSummary) }" /></div>
          <small>{{ percentage(componentSummary) }} held or recipe-unlocked · {{ componentSummary.availableCopies.toLocaleString() }} in storage</small>
        </button>
        <button
          type="button"
          aria-pressed="false"
          @click="openMaterials('all')"
        >
          <div class="metric-heading">
            <span>Consumables</span>
            <strong>{{ consumableSummary.collected }} / {{ consumableSummary.total || '—' }}</strong>
          </div>
          <div class="meter consumable"><span :style="{ width: percentage(consumableSummary) }" /></div>
          <small>{{ percentage(consumableSummary) }} tracked · materials, Dynamite, and potion formulas</small>
        </button>
        <button
          type="button"
          aria-pressed="false"
          @click="openSupplies"
        >
          <div class="metric-heading">
            <span>Supplies</span>
            <strong>{{ reusableSupplySummary.collected }} / {{ reusableSupplySummary.total || '—' }}</strong>
          </div>
          <div class="meter supply"><span :style="{ width: percentage(reusableSupplySummary) }" /></div>
          <small>{{ percentage(reusableSupplySummary) }} reusable unlocks · {{ supplyAccessSummary }}</small>
        </button>
        <button
          type="button"
          :aria-pressed="collectionControls.rarity === 'recipe'"
          @click="filterToRecipes"
        >
          <div class="metric-heading">
            <span>Recipes</span>
            <strong>{{ snapshot?.recipeSummary.collected ?? 0 }} / {{ snapshot?.recipeSummary.total ?? '—' }}</strong>
          </div>
          <div class="meter recipe"><span :style="{ width: recipePercentage() }" /></div>
          <small>{{ recipePercentage() }} learned · crafted items count as unlocked</small>
        </button>
        </div>
      </section>

      <section v-if="showLegacyScanner && activeView === 'collection'" class="collection-basis" aria-label="Collection persistence">
        <button
          type="button"
          :class="{ active: collectionBasis === 'archive' }"
          :aria-pressed="collectionBasis === 'archive'"
          @click="setCollectionBasis('archive')"
        >
          <strong>Codex Archive</strong>
          <small>Your durable CC collection. Counts copies stored by CC, even after they leave Grim Dawn.</small>
        </button>
        <button
          type="button"
          :class="{ active: collectionBasis === 'stashes' }"
          :aria-pressed="collectionBasis === 'stashes'"
          @click="setCollectionBasis('stashes')"
        >
          <strong>Stash Scanner</strong>
          <small>A live inventory of physical copies currently present in the selected Grim Dawn stash files.</small>
        </button>
      </section>
      <ExplorerToolbar
        v-if="snapshot && activeView === 'sets'"
        class="collection-explorer-toolbar"
        v-model="query"
        v-bind="searchGuidance.sets"
        search-label="Search sets"
        placeholder="Name, stat, skill… (try skill:wendigo)"
        :result-count="visibleSets.length"
        result-label="sets"
        :search-error="searchErrorMessage(setSearchQuery)"
      >
        <template #filters>
          <label>
            <span>Set progress</span>
            <select v-model="setProgressFilter" autocomplete="off">
              <option value="all">All sets</option>
              <option value="complete">Complete</option>
              <option value="progress">In progress</option>
              <option value="unstarted">Unstarted</option>
            </select>
          </label>
          <label>
            <span>Rarity</span>
            <select v-model="rarityFilter" autocomplete="off">
              <option value="all">All set rarities</option>
              <option value="legendary">Legendary sets</option>
              <option value="epic">Epic sets</option>
            </select>
          </label>
          <label>
            <span>Special feature</span>
            <select v-model="setFeatureFilter" autocomplete="off">
              <option value="all">All set effects</option>
              <option value="visual">Visual transformations</option>
            </select>
          </label>
        </template>
        <template #sort>
          <label>
            <span>Sort by</span>
            <select v-model="setSortMode" autocomplete="off">
              <option value="completion">Completion</option>
              <option value="level">Required level</option>
              <option value="name">Name</option>
            </select>
          </label>
          <label>
            <span>Order</span>
            <select v-model="setSortDirection" autocomplete="off">
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
        </template>
      </ExplorerToolbar>

      <CollectionMaterialsWorkspace
        v-if="snapshot && (activeView === 'collection' || activeView === 'materials')"
        v-model:controls="activeCollectionMaterialsControls"
        :mode="activeView === 'materials' ? 'materials' : 'collection'"
        :items="activeView === 'materials' ? (snapshot.materials ?? []) : snapshot.items"
        :double-rare-mi-base-records="doubleRareMiBaseRecords"
        :search-document-for-item="itemStructuredSearchDocument"
        :category-progress="categoryProgress"
        :icon-url-for-item="itemIconUrl"
        :best-stored-copy-for-item="bestStoredCopy"
        :live-ready="liveStatus?.state === 'ready'"
        :retrieval-busy="vaultBusy"
        @show-tooltip="showTooltip"
        @queue-tooltip="queueTooltip"
        @move-tooltip="moveTooltip"
        @hide-tooltip="scheduleTooltipHide"
        @open-item="openItem"
        @retrieve-live="retrieveArchivedCopyLive"
      />

      <SkillExplorerWorkspace
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

      <section v-else-if="activeView === 'planner'" class="leveling-planner" aria-label="Character leveling shopping list">
        <ToolHeader
          eyebrow="Character shopping list"
          title="Leveling Planner"
          description="Pick the skills your character actually uses. CC merges their supporting MIs, Epics, Legendaries, and faction gear into one leveling route."
          tone="blue"
        >
          <template #aside>
            <div class="segmented-control planner-display" aria-label="Planner display">
              <button type="button" :class="{ active: plannerDisplay === 'table' }" @click="switchPlannerDisplay('table')">Table</button>
              <button type="button" :class="{ active: plannerDisplay === 'journey' }" @click="switchPlannerDisplay('journey')">Journey</button>
              <button type="button" :class="{ active: plannerDisplay === 'map' }" @click="switchPlannerDisplay('map')">MI sources</button>
            </div>
          </template>
        </ToolHeader>

        <div class="planner-controls">
          <div class="planner-profile-control">
            <label for="planner-profile-select">Active plan</label>
            <div class="planner-control-row">
              <select
                id="planner-profile-select"
                :value="selectedPlannerProfileId"
                @change="selectPlannerProfile(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="profile in plannerProfiles" :key="profile.id" :value="profile.id">
                  {{ profile.name }}{{ profile.className ? ` · ${profile.className}` : '' }}{{ profile.source === 'character' ? ' · character' : '' }}
                </option>
              </select>
              <button type="button" class="planner-new-plan" @click="openPlannerSetup">New plan</button>
              <button
                v-if="selectedPlannerProfile?.source === 'character'"
                type="button"
                :disabled="characterImportLoading"
                @click="refreshSelectedCharacterProfile"
              >{{ characterImportLoading ? 'Refreshing…' : 'Refresh save' }}</button>
              <button type="button" :disabled="plannerProfiles.length <= 1" title="Delete this plan" @click="deletePlannerProfile">Delete</button>
            </div>
            <small>
              {{ selectedPlannerProfile?.className || 'Class not set' }}
              <template v-if="selectedPlannerProfile?.masteries?.length"> · {{ selectedPlannerProfile.masteries.join(' + ') }}</template>
            </small>
          </div>
          <div class="planner-skill-control">
            <label for="planner-skill-input">Add a skill</label>
            <span>
              <input
                id="planner-skill-input"
                v-model="plannerSkillDraft"
                type="search"
                list="planner-skill-options"
                autocomplete="off"
                placeholder="Type a skill name…"
                @keydown.enter.prevent="addPlannerSkill()"
              />
              <datalist id="planner-skill-options">
                <option v-for="skill in plannerSkillOptions" :key="skill" :value="skill" />
              </datalist>
              <button type="button" :disabled="plannerSkillOptions.length === 0" @click="addPlannerSkill()">Add</button>
            </span>
          </div>
          <div class="planner-level-range" aria-label="Item level range">
            <label class="planner-level-control">
              <span>Minimum item level</span>
              <input v-model.number="plannerMinimumLevelDraft" type="number" min="1" :max="plannerLevelCapDraft" @change="commitPlannerMinimumLevel" @keydown.enter.prevent="commitPlannerMinimumLevel" />
            </label>
            <label class="planner-level-control">
              <span>Level cap</span>
              <input v-model.number="plannerLevelCapDraft" type="number" :min="plannerMinimumLevelDraft" max="100" @change="commitPlannerLevelCap" @keydown.enter.prevent="commitPlannerLevelCap" />
            </label>
          </div>
          <div class="planner-skill-chips" aria-label="Selected skills">
            <button
              v-for="skill in plannerSkills"
              :key="skill"
              type="button"
              :aria-label="`Remove ${skill}`"
              @click="removePlannerSkill(skill)"
            >
              {{ skill }} <span>×</span>
            </button>
            <small v-if="plannerSkills.length === 0">Add two or three build-defining skills to begin.</small>
          </div>
          <div v-if="selectedPlannerProfile?.excludedSkills.length" class="planner-excluded-skills">
            <small>Ignored character skills</small>
            <button v-for="skill in selectedPlannerProfile.excludedSkills" :key="skill" type="button" @click="restorePlannerSkill(skill)">
              + {{ skill }}
            </button>
          </div>
        </div>

        <PlannerSetupDialog
          v-if="plannerSetupOpen"
          :profiles="plannerProfiles"
          :characters="discoveredCharacters"
          :characters-loading="characterImportLoading"
          :characters-error="characterImportError"
          :class-options="plannerClassOptions"
          :skill-names="skillNames"
          :skill-masteries="snapshot?.skillMasteries"
          @cancel="plannerSetupOpen = false"
          @request-characters="loadCharacterProfiles"
          @submit="completePlannerSetup"
        />
        <template v-if="plannerDisplay !== 'map'">
          <ExplorerToolbar
            v-model="plannerQuery"
            v-bind="searchGuidance.planner"
            class="planner-explorer-toolbar"
            search-label="Search shopping list"
            placeholder="Item, monster, area… (try zarias)"
            :result-count="plannerRows.length"
            result-label="relevant item tiers"
            :search-error="searchErrorMessage(plannerStructuredQuery)"
          >
            <template #filters>
              <label>
                <span>Archive status</span>
                <select v-model="plannerOwnership" autocomplete="off">
                  <option value="all">All items</option>
                  <option value="owned">In Archive</option>
                  <option value="missing">Not archived</option>
                </select>
              </label>
              <label>
                <span>List</span>
                <select v-model="plannerShowIgnored" autocomplete="off">
                  <option :value="false">Shopping list</option>
                  <option :value="true">Ignored bases ({{ plannerIgnoredRecords.length }})</option>
                </select>
              </label>
            </template>
            <template #sort>
              <label>
                <span>Sort by</span>
                <select v-model="plannerSortMode" autocomplete="off">
                  <option value="level">Required level</option>
                  <option value="name">Item name</option>
                  <option value="rarity">Rarity</option>
                </select>
              </label>
              <label>
                <span>Order</span>
                <select v-model="plannerSortDirection" autocomplete="off">
                  <option value="asc">Lowest first</option>
                  <option value="desc">Highest first</option>
                </select>
              </label>
            </template>
          </ExplorerToolbar>
          <div class="planner-summary">
            <span><strong>{{ plannerRows.length }}</strong> relevant item tiers</span>
            <span><strong>{{ plannerRows.filter((row) => row.item.rarity === 'mi').length }}</strong> MIs</span>
            <span><strong>{{ plannerRows.filter((row) => row.item.rarity === 'faction' || row.item.acquisition?.factions?.length).length }}</strong> faction purchases</span>
            <span><strong>{{ plannerRows.filter((row) => row.item.acquisition?.crafting).length }}</strong> craftable</span>
          </div>
          <ResearchItemTable
            v-if="plannerDisplay === 'table'"
            v-model:page="plannerPage"
            :rows="plannerResearchRows"
            :icon-url-for-item="itemIconUrl"
            :sort="plannerSortMode"
            :direction="plannerSortDirection"
            :sort-columns="{ item: 'name', level: 'level' }"
            :empty-title="plannerShowIgnored ? 'No ignored bases' : 'No shopping-list items'"
            :empty-detail="plannerShowIgnored ? 'Ignore an item base to keep it out of the active shopping list.' : 'Select a mastery or skill, widen the item level range, or restore an ignored base.'"
            label="Leveling Planner item results"
            pagination="continuous"
            actions
            :ignored-view="plannerShowIgnored"
            @sort="plannerSortMode = $event as PlannerSortMode"
            @activate="openItem"
            @queue-tooltip="queueTooltip"
            @show-tooltip="showTooltip"
            @move-tooltip="moveTooltip"
            @scroll-tooltip="scrollTooltip"
            @hide-tooltip="scheduleTooltipHide"
            @favorite="togglePlannerFavorite"
            @ignore="togglePlannerIgnored"
          />
          <PlannerJourney
            v-else
            v-model:page="plannerPage"
            :rows="plannerResearchRows"
            :icon-url-for-item="itemIconUrl"
            :ignored-view="plannerShowIgnored"
            @activate="openItem"
            @queue-tooltip="queueTooltip"
            @show-tooltip="showTooltip"
            @move-tooltip="moveTooltip"
            @scroll-tooltip="scrollTooltip"
            @hide-tooltip="scheduleTooltipHide"
            @favorite="togglePlannerFavorite"
            @ignore="togglePlannerIgnored"
          />
        </template>

        <template v-else>
          <ExplorerToolbar
            v-model="atlasRegionQuery"
            v-bind="searchGuidance.atlas"
            class="planner-map-explorer-toolbar"
            search-label="Search MI sources"
            placeholder="Area, MI, monster…"
            :result-count="visibleAtlasRegions.length"
            result-label="source areas"
            :search-error="searchErrorMessage(atlasStructuredQuery)"
          >
            <template #filters>
              <label>
                <span>Catalog scope</span>
                <select v-model="plannerMapScope" autocomplete="off">
                  <option value="selected">Selected build</option>
                  <option value="all">All MI tiers</option>
                </select>
              </label>
            </template>
            <template #sort>
              <label>
                <span>Sort by</span>
                <select v-model="plannerMapSortMode" autocomplete="off">
                  <option value="items">Matching MI tiers</option>
                  <option value="level">Earliest item level</option>
                  <option value="name">Area name</option>
                </select>
              </label>
              <label>
                <span>Order</span>
                <select v-model="plannerMapSortDirection" autocomplete="off">
                  <option value="desc">Highest first</option>
                  <option value="asc">Lowest first</option>
                </select>
              </label>
            </template>
          </ExplorerToolbar>
          <p class="explorer-context-note">{{ plannerMiItems.length }} MI tiers indexed<span v-if="unlocatedPlannerMiItems.length"> · {{ unlocatedPlannerMiItems.length }} unlocated</span></p>
          <section class="planner-world-map" aria-label="Cairn item source map">
            <header>
              <span><strong>Campaign source map</strong><small>Positions come directly from Grim Dawn's world-region coordinates.</small></span>
              <span class="planner-map-legend">
                <i class="base" />GD <i class="gdx1" />AoM <i class="gdx2" />FG <i class="gdx3" />FoA
              </span>
            </header>
            <div v-if="atlasMapPins.length" class="planner-map-canvas">
              <button
                v-for="pin in atlasMapPins"
                :key="pin.key"
                type="button"
                class="planner-map-pin"
                :class="[pin.contentPack, { active: selectedAtlasRegion === pin.key }]"
                :style="{ left: `${pin.left}%`, top: `${pin.top}%` }"
                :aria-label="`${pin.name}, ${pin.items.length} matching item tiers`"
                :title="`${pin.name} (${contentPackShortLabel(pin.contentPack)}) · ${pin.items.length} tiers`"
                @click="selectedAtlasRegion = pin.key"
              >
                <b>{{ pin.items.length }}</b>
                <span>{{ pin.name }}</span>
              </button>
            </div>
            <p v-else class="skill-empty">No campaign coordinates are available for the current filter.</p>
          </section>
          <div class="mi-source-layout">
            <aside class="mi-atlas-regions">
              <button
                v-for="region in visibleAtlasRegions"
                :key="region.key"
                type="button"
                :data-region-key="region.key"
                :class="{ active: selectedAtlasRegion === region.key }"
                @click="selectedAtlasRegion = region.key"
              >
                <span>
                  <strong>{{ region.name }} ({{ contentPackShortLabel(region.contentPack) }})</strong>
                  <small>{{ [...new Set(region.items.flatMap((item) => item.acquisition?.sources ?? []))].slice(0, 2).join(' · ') }}</small>
                </span>
                <b>{{ region.items.length }} tiers · earliest item Lv{{ region.minimumItemLevel }}</b>
              </button>
            </aside>
            <section class="mi-source-detail">
              <header v-if="selectedAtlasRegion">
                <p class="section-label">Area drops</p>
                <h3>{{ atlasRegions.find((region) => region.key === selectedAtlasRegion)?.name }} ({{ contentPackShortLabel(atlasRegions.find((region) => region.key === selectedAtlasRegion)?.contentPack ?? '') }})</h3>
                <p>Item tiers whose indexed monster source can appear in this area.</p>
              </header>
              <div v-if="selectedAtlasItems.length" class="atlas-item-list">
                <button
                  v-for="item in selectedAtlasItems"
                  :key="item.record"
                  type="button"
                  @mouseenter="queueTooltip(item, $event)"
                  @mousemove="moveTooltip"
                  @mouseleave="scheduleTooltipHide"
                  @click="openItem(item)"
                >
                  <img v-if="itemIconUrl(item)" :src="itemIconUrl(item)!" alt="" @error="handleItemIconError(item)" />
                  <span>
                    <strong>{{ item.name }}</strong>
                    <small>Lv{{ item.levelRequirement }} · {{ researchItemTypeLabel(item) }}</small>
                    <small>{{ item.acquisition?.sources[0] }}</small>
                  </span>
                </button>
              </div>
              <p v-else class="skill-empty">No indexed MIs match this area filter.</p>
            </section>
          </div>
        </template>
      </section>

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
        :catalog-items="snapshot?.supplies ?? []"
        :vault-items="vaultItems"
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
        :items="vaultItems"
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
        @retrieve-selected-live="retrieveSelectedLive"
        @retrieve-selected="retrieveSelected"
      />

      <section v-else-if="!snapshot && (appInitializing || scanning)" class="empty-state">
        <div class="sigil loading" aria-hidden="true">C</div>
        <h3>Opening the Codex</h3>
        <p>Parsing the game database and your transfer stashes.</p>
      </section>

      <BoundedResultSurface
        v-else-if="activeView === 'sets'"
        v-model:page="currentPage"
        class="set-results"
        :items="visibleSets"
        :get-key="set => set.record"
        :page-size="50"
        empty-title="No sets match these filters"
        empty-detail="Try changing the current search or set filters."
        label="Item sets"
        layout="grid"
      >
        <template #item="{ item: set }">
          <article
            class="set-card"
            :class="`rarity-${setRarity(set.items)}`"
            :data-set-record="set.record"
          >
          <header>
            <div>
              <div class="set-heading-badges">
                <SemanticBadge :tone="setRarity(set.items)">{{ setRarity(set.items) }}</SemanticBadge>
                <SemanticBadge tone="level">{{ setLevelLabel(set) }}</SemanticBadge>
              </div>
              <h3>{{ set.name }}</h3>
            </div>
            <div class="set-status">
              <SemanticBadge :tone="set.collected === set.items.length ? 'complete' : 'progress'">
                {{ set.collected }} / {{ set.items.length }} discovered
              </SemanticBadge>
              <span class="set-percentage">{{ setCompletionPercent(set) }}</span>
              <span
                class="set-roll-rating"
                :class="{ unavailable: set.rollRating.average === null }"
                :title="set.rollRating.average === null
                  ? 'No physically available set pieces have a trusted roll rating yet.'
                  : `${set.rollRating.ratedPieces} of ${set.rollRating.availablePieces} available set pieces rated.`"
              >
                <template v-if="set.rollRating.average !== null">
                  ★ {{ set.rollRating.average.toFixed(1) }}% avg roll
                  <small>{{ set.rollRating.ratedPieces }}/{{ set.rollRating.availablePieces }} rated</small>
                </template>
                <template v-else>☆ No rated rolls</template>
              </span>
            </div>
          </header>
          <div class="set-meter">
            <span :style="{ width: `${(set.collected / set.items.length) * 100}%` }" />
          </div>
          <div class="set-readiness">
            <span>Readiness</span>
            <SemanticBadge :tone="setReadiness(set.items).tone">
              {{ setReadiness(set.items).label }}
            </SemanticBadge>
          </div>
          <ul>
            <li
              v-for="item in set.items"
              :key="item.record"
              :class="{
                missing: setItemUnqualified(item),
                craftable: item.recipeUnlocked && item.availableCount === 0 && !isAvailableViaAwakening(item),
                awakening: itemAvailableByAwakeningOnly(item)
              }"
            >
              <button
                type="button"
                aria-describedby="item-tooltip"
                @mouseenter="queueTooltip(item, $event)"
                @mousemove="moveTooltip"
                @mouseleave="scheduleTooltipHide"
                @focus="queueTooltip(item, $event)"
                @blur="scheduleTooltipHide"
                @click="openItem(item)"
              >
                <span aria-hidden="true">{{ item.availableCount > 0 ? '✓' : setItemDiscovered(item) ? '◇' : itemAvailableByAwakeningOnly(item) ? '✦' : item.recipeUnlocked ? '⊕' : '○' }}</span>
                <div><strong>{{ item.name }}</strong><small>{{ item.slot }}</small></div>
                <span class="set-item-badges">
                  <SemanticBadge
                    v-for="badge in setItemBadges(item)"
                    :key="badge.key"
                    :tone="badge.tone"
                    compact
                  >
                    {{ badge.label }}
                  </SemanticBadge>
                </span>
              </button>
            </li>
          </ul>
          <section v-if="setMemberVisualChanges(set).length" class="set-member-fx">
            <header><h4>Member item FX</h4><SemanticBadge tone="fx" compact>FX change</SemanticBadge></header>
            <button
              v-for="change in setMemberVisualChanges(set)"
              :key="`${change.item.record}:${change.section.heading}`"
              type="button"
              aria-describedby="item-tooltip"
              @mouseenter="queueTooltip(change.item, $event)"
              @mousemove="moveTooltip"
              @mouseleave="scheduleTooltipHide"
              @focus="queueTooltip(change.item, $event)"
              @blur="scheduleTooltipHide"
              @click="openItem(change.item)"
            >
              <strong>{{ change.item.name }}</strong>
              <span>{{ change.section.heading?.replace(' · Visual transformation', '') }}</span>
              <small>{{ change.section.lines.map((line) => formatPresentationLine(line)).join(' · ') }}</small>
            </button>
          </section>
          <div v-if="set.items[0]?.setPresentation?.tiers.length" class="set-bonus-tiers">
            <section
              v-for="tier in set.items[0]?.setPresentation?.tiers"
              :key="tier.requiredPieces"
              :class="{ unlocked: set.collected >= tier.requiredPieces }"
            >
              <div class="set-tier-base">
                <h4>({{ tier.requiredPieces }}) Set</h4>
                <p v-for="(line, index) in tier.lines" :key="`${line.label}:${index}`">
                  {{ formatPresentationLine(line) }}
                </p>
                <div v-if="tier.petLines?.length" class="set-tier-group pet-bonus">
                  <h5>Bonus to All Pets</h5>
                  <p v-for="(line, index) in tier.petLines" :key="`pet:${line.label}:${index}`">
                    {{ formatPresentationLine(line) }}
                  </p>
                </div>
              </div>
              <div
                v-for="modifier in tier.skillModifiers ?? []"
                :key="`modifier:${modifier.heading}`"
                class="set-tier-group skill-bonus"
                :class="{ 'visual-bonus': modifier.kind === 'visual-modifier' }"
              >
                <h5>
                  {{ modifier.heading }}
                  <SemanticBadge v-if="modifier.kind === 'visual-modifier'" tone="fx" compact>FX change</SemanticBadge>
                </h5>
                <p v-for="(line, index) in modifier.lines" :key="`${line.label}:${index}`">
                  {{ formatPresentationLine(line) }}
                </p>
              </div>
              <div v-if="tier.grantedSkill" class="set-tier-group skill-bonus">
                <h5>{{ tier.grantedSkill.name }}</h5>
                <p v-if="tier.grantedSkill.trigger">{{ tier.grantedSkill.trigger }}</p>
                <p v-if="tier.grantedSkill.description">{{ tier.grantedSkill.description }}</p>
                <p v-for="(line, index) in tier.grantedSkill.lines" :key="`${line.label}:${index}`">
                  {{ formatPresentationLine(line) }}
                </p>
                <div
                  v-for="linked in tier.grantedSkill.linkedSkills ?? []"
                  :key="linked.name"
                  class="linked-granted-skill"
                >
                  <h6>{{ linked.name }}</h6>
                  <p v-if="linked.description">{{ linked.description }}</p>
                  <p v-for="(line, index) in linked.lines" :key="`${linked.name}:${line.label}:${index}`">
                    {{ formatPresentationLine(line) }}
                  </p>
                </div>
              </div>
            </section>
          </div>
          </article>
        </template>
      </BoundedResultSurface>
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

    <div v-if="selectedItem" class="drawer-backdrop comparison-backdrop" @click.self="selectedRecord = null">
      <aside class="item-drawer comparison-workspace" :aria-label="selectedItem.name + ' copy comparison'">
        <button class="drawer-close" type="button" aria-label="Close comparison" @click="selectedRecord = null">×</button>
        <header class="comparison-heading">
          <img v-if="itemIconUrl(selectedItem)" :src="itemIconUrl(selectedItem)!" alt="" @error="handleItemIconError(selectedItem)" />
          <span v-else class="item-icon-placeholder comparison-icon-placeholder" aria-hidden="true">{{ selectedItem.slot.slice(0, 2).toLocaleUpperCase() }}</span>
          <div>
            <p class="section-label">Copy comparison</p>
            <h2>{{ selectedItem.name }}</h2>
            <p class="drawer-intro">
              One copy is the reference. Every other copy shows its exact value and percentile deltas against it.
              Saving a reference also remembers that copy as your preferred roll.
            </p>
          </div>
          <div class="comparison-count">
            <strong>{{ selectedCopies.length }}</strong>
            <span>{{ selectedCopies.length === 1 ? 'copy' : 'copies' }}</span>
          </div>
        </header>
        <section v-if="selectedItem.rarity === 'mi'" class="drawer-mi-tools">
          <button type="button" @click="openSelectedMiInWorkshop">Open in MI Workshop</button>
          <label>
            <span>Compare these copies by</span>
            <select v-model="selectedMiMetric">
              <optgroup label="Roll quality">
                <option v-for="option in miMetricOptions.quality" :key="option.key" :value="option.key">{{ option.label }}</option>
              </optgroup>
              <optgroup label="Item stats">
                <option v-for="option in miMetricOptions.item" :key="option.key" :value="option.key">{{ option.label }}</option>
              </optgroup>
              <optgroup label="Bonus to All Pets">
                <option v-for="option in miMetricOptions.pet" :key="option.key" :value="option.key">{{ option.label }}</option>
              </optgroup>
            </select>
          </label>
          <label>
            <span>Order</span>
            <select v-model="selectedMiMetricDirection">
              <option value="desc">Highest first</option>
              <option value="asc">Lowest first</option>
            </select>
          </label>
        </section>
        <section v-if="selectedStoredCopies.length" class="drawer-stored-copies">
          <header>
            <div>
              <p class="section-label">Codex Archive</p>
              <strong>{{ selectedStoredCopies.length }} stored {{ selectedStoredCopies.length === 1 ? 'copy' : 'copies' }}</strong>
            </div>
            <small>Returns land in the {{ liveStatus?.depositTabDescription ?? 'configured retrieval tab' }}.</small>
          </header>
          <p>Select the exact copy below. Roll, affixes, seed, pin state, and retrieval now stay together.</p>
        </section>
        <section v-else-if="itemAvailableByAwakeningOnly(selectedItem)" class="drawer-awakening-source">
          <span class="awakening-sigil"><i /></span>
          <div>
            <p class="section-label">Qualified availability</p>
            <strong>{{ awakeningAvailabilityLabel(selectedItem) }}</strong>
            <small>This Legendary is not stored yet. Awakening consumes one qualifying Epic base.</small>
          </div>
          <button
            v-if="catalogItemByRecord(selectedItem.awakeningSourceRecord)"
            type="button"
            @click="openItem(catalogItemByRecord(selectedItem.awakeningSourceRecord)!)"
          >View Epic base</button>
        </section>
        <p
          v-if="selectedItem.pinnedInstanceKey && !selectedCopies.some((copy) => copy.instanceKey === selectedItem?.pinnedInstanceKey)"
          class="pinned-away"
        >
          Your pinned copy is remembered, but it is not in a currently scanned stash.
        </p>

        <div class="copy-list">
          <p v-if="selectedCopies.length === 0 && !itemAvailableByAwakeningOnly(selectedItem)" class="drawer-empty">
            No currently scanned copy is available. The catalog tooltip will show this item's possible ranges.
          </p>
          <article
            v-for="(copy, index) in selectedCopies"
            :key="copy.instanceKey"
            class="copy-card"
            :class="{
              pinned: copy.instanceKey === selectedItem.pinnedInstanceKey,
              reference: copy.instanceKey === comparisonReferenceCopy?.instanceKey
            }"
          >
            <header>
              <div class="copy-identity">
                <div class="copy-item-heading" :class="selectedItem.rarity">
                  <img v-if="itemIconUrl(selectedItem)" :src="itemIconUrl(selectedItem)!" alt="" @error="handleItemIconError(selectedItem)" />
                  <span v-else class="item-icon-placeholder copy-icon-placeholder" aria-hidden="true">{{ selectedItem.slot.slice(0, 2).toLocaleUpperCase() }}</span>
                  <div>
                    <p>
                      {{ copy.instanceKey === comparisonReferenceCopy?.instanceKey ? 'Reference copy' : `Copy ${index + 1}` }}
                      <span v-if="vaultCopyForObserved(copy)" class="stored-badge">Stored</span>
                      <img
                        v-if="selectedItem.rarity === 'mi' && isDoubleRareMiCopy(copy) && snapshot?.uiIcons?.doubleRareMi"
                        class="double-rare-icon"
                        :src="`cairn-icon://asset/${snapshot.uiIcons.doubleRareMi}.png`"
                        alt="Double rare"
                        title="Double rare Monster Infrequent"
                      />
                      <span
                        v-else-if="selectedItem.rarity === 'mi' && isDoubleRareMiCopy(copy)"
                        class="double-rare-badge"
                      >Double rare</span>
                    </p>
                    <h3 class="copy-colored-name">
                      <span
                        v-if="copy.prefixRecord"
                        class="copy-name-affix"
                        :class="copyAffixRarity(copy.prefixRecord)"
                      >{{ copyAffixName(copy.prefixRecord, '') }}</span>
                      <span class="copy-name-base">{{ selectedItem.name }}</span>
                      <span
                        v-if="copy.suffixRecord"
                        class="copy-name-affix"
                        :class="copyAffixRarity(copy.suffixRecord)"
                      >{{ copyAffixName(copy.suffixRecord, '') }}</span>
                    </h3>
                    <small>{{ researchRarityLabel(selectedItem) }} · {{ researchItemTypeLabel(selectedItem) }} · Lv{{ selectedItem.levelRequirement }}</small>
                  </div>
                </div>
                <div class="copy-score">
                  <strong v-if="copy.rollAnalysis?.overallEstimatedPercentile != null">
                    {{ copy.rollAnalysis.overallEstimatedPercentile.toFixed(1) }}%
                  </strong>
                  <strong v-else class="unscored">Unscored</strong>
                  <small>overall roll quality</small>
                </div>
                <p
                  class="copy-overall-delta"
                  :class="{
                    positive: copyOverallDelta(copy).startsWith('+'),
                    negative: copyOverallDelta(copy).startsWith('−'),
                    reference: copy.instanceKey === comparisonReferenceCopy?.instanceKey
                  }"
                >{{ copyOverallDelta(copy) }}</p>
                <p v-if="selectedItem.rarity === 'mi'" class="copy-selected-metric">
                  <span>{{ selectedMiMetricLabel }}</span>
                  <strong>{{ miMetricResult(copy, miWorkshopControls.metric).display }}</strong>
                </p>
                <div class="copy-affixes">
                  <button
                    type="button"
                    :disabled="!copy.prefixRecord"
                    :class="[copyAffixRarity(copy.prefixRecord), { active: copyAffixIsOpen(copy, copy.prefixRecord) }]"
                    :title="copy.prefixRecord ? 'Show this prefix’s bonuses' : 'This copy has no prefix'"
                    @click="toggleCopyAffix(copy, copy.prefixRecord)"
                  ><small>Prefix · {{ copyAffixRarityLabel(copy.prefixRecord) }}</small><strong>{{ copyAffixName(copy.prefixRecord, 'No prefix') }}</strong><em>{{ copyAffixDelta(copy, 'prefix') }}</em></button>
                  <button
                    type="button"
                    :disabled="!copy.suffixRecord"
                    :class="[copyAffixRarity(copy.suffixRecord), { active: copyAffixIsOpen(copy, copy.suffixRecord) }]"
                    :title="copy.suffixRecord ? 'Show this suffix’s bonuses' : 'This copy has no suffix'"
                    @click="toggleCopyAffix(copy, copy.suffixRecord)"
                  ><small>Suffix · {{ copyAffixRarityLabel(copy.suffixRecord) }}</small><strong>{{ copyAffixName(copy.suffixRecord, 'No suffix') }}</strong><em>{{ copyAffixDelta(copy, 'suffix') }}</em></button>
                </div>
                <section
                  v-if="activeCopyAffix && activeCopyAffixTarget && [copy.prefixRecord, copy.suffixRecord].includes(activeCopyAffixTarget.record) && copyAffixIsOpen(copy, activeCopyAffixTarget.record)"
                  class="copy-affix-detail"
                  :class="activeCopyAffix.rarity"
                >
                  <header>
                    <span><small>{{ activeCopyAffix.kind }}</small><strong>{{ activeCopyAffix.name }}</strong></span>
                    <button type="button" aria-label="Close affix details" @click="activeCopyAffixTarget = null">×</button>
                  </header>
                  <template v-if="activeCopyAffix.presentation?.sections.some((section) => section.lines.length)">
                    <div v-for="section in activeCopyAffix.presentation?.sections ?? []" :key="`${activeCopyAffixTarget.record}:${section.kind}:${section.heading}`" class="copy-affix-section">
                      <h4 v-if="section.heading">{{ section.heading }}</h4>
                      <p v-for="line in section.lines" :key="`${line.label}:${line.minimum}:${line.maximum}`" :class="`tone-${line.tone}`">
                        {{ formatPresentationLine(line) }}
                      </p>
                    </div>
                  </template>
                  <p v-else class="copy-affix-empty">This affix changes non-rollable item rules rather than visible stats.</p>
                </section>
                <p class="copy-provenance">{{ copySourceLabel(copy) }} · Seed {{ copy.seed }}</p>
              </div>
              <div class="copy-actions">
                <span v-if="copy.instanceKey === comparisonReferenceCopy?.instanceKey" class="reference-badge">Reference</span>
                <span v-if="isAutoBest(copy)" class="auto-badge">Auto-best</span>
                <button
                  v-if="vaultCopyForObserved(copy)"
                  class="retrieve-copy"
                  type="button"
                  :disabled="vaultBusy || liveStatus?.state !== 'ready'"
                  @click="retrieveArchivedCopyLive(vaultCopyForObserved(copy)!.id)"
                >
                  Retrieve this copy
                </button>
                <button type="button" :disabled="pinning" @click="pinCopy(copy)">
                  {{ copy.instanceKey === selectedItem.pinnedInstanceKey
                    ? 'Clear saved reference'
                    : copy.instanceKey === comparisonReferenceCopy?.instanceKey
                      ? 'Save this reference'
                      : 'Use as reference' }}
                </button>
              </div>
            </header>

            <p v-if="copy.rollAnalysis && !copy.rollAnalysis.trusted" class="withheld-note">
              {{ copy.rollAnalysis.reason }}
            </p>
            <div v-else-if="copy.rollAnalysis && (comparisonItemStats(copy).length || comparisonPetStats(copy).length)" class="copy-roll-sections">
              <section v-if="comparisonItemStats(copy).length">
                <h3>Item differences</h3>
                <p class="copy-roll-guide">Actual value · delta from reference · percentile within this exact item and affix range</p>
                <div class="stat-list">
                  <div v-for="stat in comparisonItemStats(copy)" :key="stat.key" class="stat-row" :class="{ missing: stat.missingFromCopy }">
                    <div class="stat-heading">
                      <span>{{ stat.label }}</span>
                      <strong>{{ stat.valueLabel }}<template v-if="stat.percentile !== null"> · {{ stat.percentile.toFixed(0) }}%</template><template v-else> · fixed</template></strong>
                    </div>
                    <div class="stat-delta" :class="`delta-${stat.deltaTone}`">
                      <b>{{ stat.deltaLabel }}</b>
                      <small v-if="stat.percentileDeltaLabel">{{ stat.percentileDeltaLabel }}</small>
                    </div>
                    <div v-if="stat.percentile !== null" class="stat-meter"><span :style="{ width: `${stat.percentile}%` }" /></div>
                    <small>{{ stat.percentile === null ? 'Fixed value' : `${stat.rangeLabel} sampled range` }}</small>
                  </div>
                </div>
              </section>
              <section v-if="comparisonPetStats(copy).length" class="pet-roll-section">
                <h3>Bonus to All Pets differences</h3>
                <p class="copy-roll-guide">Includes inherent and affix-granted pet bonuses, compared to the reference copy</p>
                <div class="stat-list">
                  <div v-for="stat in comparisonPetStats(copy)" :key="`pet:${stat.key}`" class="stat-row pet-stat-row" :class="{ missing: stat.missingFromCopy }">
                    <div class="stat-heading">
                      <span>{{ stat.label }}</span>
                      <strong>{{ stat.valueLabel }}<template v-if="stat.percentile !== null"> · {{ stat.percentile.toFixed(0) }}%</template><template v-else> · fixed</template></strong>
                    </div>
                    <div class="stat-delta" :class="`delta-${stat.deltaTone}`">
                      <b>{{ stat.deltaLabel }}</b>
                      <small v-if="stat.percentileDeltaLabel">{{ stat.percentileDeltaLabel }}</small>
                    </div>
                    <div v-if="stat.percentile !== null" class="stat-meter"><span :style="{ width: `${stat.percentile}%` }" /></div>
                    <small>{{ stat.percentile === null ? 'Fixed value' : `${stat.rangeLabel} sampled range` }}</small>
                  </div>
                </div>
              </section>
            </div>
            <p v-else class="withheld-note">
              Roll analysis is pending. This copy remains safe and retrievable; its score will appear without reopening the drawer.
            </p>
          </article>
        </div>
      </aside>
    </div>
  </div>
</template>
