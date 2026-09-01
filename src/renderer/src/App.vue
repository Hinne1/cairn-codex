<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import ExplorerToolbar from './components/ExplorerToolbar.vue'
import FailureProbe from './components/FailureProbe.vue'
import ItemAssistantImport from './components/ItemAssistantImport.vue'
import SemanticBadge from './components/SemanticBadge.vue'
import WorkspaceErrorBoundary from './components/WorkspaceErrorBoundary.vue'
import { createNotificationService, type AppNotification } from './notification-service'
import {
  resetUiPreferences,
  type RendererFailureReport
} from './renderer-recovery'
import {
  createPreferenceRepository,
  type StoredPlannerProfile as PlannerProfile,
  type StoredTodoItem as TodoItem
} from './preference-repository'
import { searchGuidance } from './search-guidance'
import { searchQueryOptions, searchSchemas } from '@shared/search-schema'
import {
  setCompletionCount,
  setItemBadges,
  setItemDiscovered,
  setItemUnqualified,
  setRarity,
  setReadiness
} from './set-semantics'
import {
  ONBOARDING_STEP_COUNT,
  type OnboardingStatus
} from './onboarding'
import ToolHeader from './components/ToolHeader.vue'
import {
  buildStashOracle,
  type OracleReadiness,
  type OracleStyle
} from './stash-oracle'
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
  DismantlingPreview,
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
  OperationHistoryOutcome,
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

type OwnershipFilter = 'all' | 'owned' | 'missing'
type RarityFilter = 'all' | 'epic' | 'legendary' | 'mi' | 'double-rare' | 'rare' | 'recipe'
type SortMode = 'name' | 'level' | 'completion' | 'recent' | 'roll'
type SortDirection = 'asc' | 'desc'
type MiCountingMode = 'base' | 'tier'
type MiAffixFilter = 'all' | 'double-rare'
type ActiveView = 'collection' | 'sets' | 'materials' | 'skills' | 'planner' | 'oracle' | 'mi-workshop' | 'supplies' | 'farming' | 'dismantling' | 'vault' | 'settings'
type SetProgressFilter = 'all' | 'complete' | 'progress' | 'unstarted'
type SetFeatureFilter = 'all' | 'visual'
type SetSortMode = 'completion' | 'level' | 'name'
type SkillScope = 'archive' | 'all'
type SkillSort = 'item' | 'slot' | 'amount' | 'conversion' | 'special' | 'level'
type SkillRarityFilter = 'all' | 'epic' | 'legendary' | 'mi' | 'rare'
type MiSortMode = 'metric' | 'level' | 'name' | 'copies'
type OracleSortMode = 'score' | 'name' | 'class' | 'readiness'
type PlannerSortMode = 'level' | 'name' | 'rarity'
type PlannerMapSortMode = 'items' | 'name' | 'level'
type VaultRarityFilter = 'all' | 'epic' | 'legendary' | 'mi' | 'rare'
type VaultSortMode = 'recent' | 'name' | 'level' | 'roll'
type TransferMode = 'live' | 'offline'
type TransferSection = 'ingest-history' | 'dispense-history' | 'quarantine'
type PlannerDisplay = 'list' | 'grid' | 'map'
type PlannerMapScope = 'selected' | 'all'
type SupplyCategory = 'writs' | 'augments'
type SupplySlotFilter = 'all' | 'weapon' | 'armor' | 'jewelry'
type MaterialCategory = 'all' | 'component' | 'material' | 'potion-formula'
type MiMetricKey = 'overall' | 'base' | 'prefix' | 'suffix' | `item:${string}` | `pet:${string}`
type WorkspaceToolId = 'sets' | 'materials' | 'skills' | 'oracle' | 'planner' | 'mi-workshop' | 'supplies' | 'farming' | 'dismantling' | 'trivia' | 'todo'
type DismantlingModeFilter = 'all' | 'softcore' | 'hardcore'
type DismantlingRarityFilter = 'all' | 'epic' | 'legendary' | 'mi' | 'rare'

interface AppHistoryState {
  cairnCodex: true
  index: number
  view: ActiveView
  selectedRecord: string | null
  activeCategory: string
  query: string
  ownership: OwnershipFilter
  rarityFilter: RarityFilter
  miWorkshopQuery: string
  miAffixFilter: MiAffixFilter
  miComparisonMetric: MiMetricKey
  miComparisonDirection: SortDirection
  miSortMode: MiSortMode
  skillItemQuery: string
  skillScope: SkillScope
  skillRarityFilter: SkillRarityFilter
  skillSlotFilter: string
  skillSort: SkillSort
  skillSortDirection: SortDirection
  oracleQuery: string
  oracleClass: string
  oracleStyle: OracleStyle
  oracleReadiness: 'all' | OracleReadiness
  oracleMinimumLevel: number
  oracleMaximumLevel: number
  oracleSortMode: OracleSortMode
  oracleSortDirection: SortDirection
  plannerQuery: string
  plannerOwnership: OwnershipFilter
  plannerShowIgnored: boolean
  plannerSortMode: PlannerSortMode
  plannerSortDirection: SortDirection
  plannerDisplay: PlannerDisplay
  atlasRegionQuery: string
  plannerMapScope: PlannerMapScope
  plannerMapSortMode: PlannerMapSortMode
  plannerMapSortDirection: SortDirection
  vaultQuery: string
  vaultRarityFilter: VaultRarityFilter
  vaultSortMode: VaultSortMode
  vaultSortDirection: SortDirection
  transferMode: TransferMode
  transferSection: TransferSection
  transferHistoryQuery: string
  transferHistoryOutcome: OperationHistoryOutcome
  transferHistoryPage: number
}

interface TooltipAffix {
  record: string
  name: string
  kind: 'prefix' | 'suffix'
  rarity: 'magical' | 'rare'
  presentation?: ItemPresentation
}

interface SkillMatch {
  skill: string
  amount: number
  conversionTarget: string
  conversionDetails: string
  special: string
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

interface FarmTarget {
  key: string
  name: string
  contentPack: string
  items: CollectionItem[]
  minimumLevel: number
}

interface SupplyOption {
  id: string
  record: string
  name: string
  slot: string
  slotFamilies: Array<Exclude<SupplySlotFilter, 'all'>>
  isHardcore: boolean
  reusable: boolean
  stackCount: number
  eligible: boolean
  detail: string
  source: 'archive' | 'faction'
  catalogItem: CollectionItem | null
  effects: string[]
  effectCount: number
}

interface SupplyPresentationIndexEntry {
  item: CollectionItem
  effects: string[]
  searchText: string
}

interface WorkspaceToolDefinition {
  id: WorkspaceToolId
  label: string
  detail: string
  experimental?: boolean
}

const workspaceToolDefinitions: WorkspaceToolDefinition[] = [
  { id: 'sets', label: 'Sets', detail: 'Set completion, bonuses, recipes, and visual modifiers.' },
  { id: 'materials', label: 'Components & Consumables', detail: 'Components, crafting materials, and consumable formulas.' },
  { id: 'skills', label: 'Skill Explorer', detail: 'Every item that ranks, converts, or otherwise modifies a skill.' },
  { id: 'oracle', label: 'Stash Oracle', detail: 'Build archetypes suggested by the items already in your archive.', experimental: true },
  { id: 'planner', label: 'Leveling Planner', detail: 'Character shopping lists and leveling routes.' },
  { id: 'mi-workshop', label: 'MI Workshop', detail: 'Stored Monster Infrequents, affixes, and stat comparisons.' },
  { id: 'supplies', label: 'Supplies', detail: 'Reusable boosts, merits, warrants, augments, and runes.' },
  { id: 'farming', label: 'Collection Farming', detail: 'Areas ranked by potential collection progress.' },
  { id: 'dismantling', label: 'Dismantling Lab', detail: 'Read-only Inventor cost and material-yield simulation.', experimental: true },
  { id: 'trivia', label: 'Collection Trivia', detail: 'Roll, duplicate, and collection curiosities.' },
  { id: 'todo', label: 'To-do', detail: 'Your small in-app task list.' }
]
const defaultWorkspaceToolIds = workspaceToolDefinitions.map((tool) => tool.id)
const essentialWorkspaceToolIds: WorkspaceToolId[] = ['sets', 'skills', 'planner', 'mi-workshop', 'supplies']
const startupRecoveryParameters = new URLSearchParams(window.location.search)
const safeModeActive = ref(startupRecoveryParameters.get('safeMode') === '1')
const safeModeSuggested = ref(startupRecoveryParameters.get('safeModeSuggested') === '1')
const failedStartupCount = ref(Math.max(0, Number(startupRecoveryParameters.get('failedStarts') ?? 0) || 0))
const safeModeOfferOpen = ref(safeModeSuggested.value && !safeModeActive.value)
const safeModeBusy = ref(false)
const safeModeDialog = ref<HTMLElement | null>(null)
const simulateWorkspaceFailure = startupRecoveryParameters.get('simulateWorkspaceError') === '1'
const preferenceRepository = createPreferenceRepository(localStorage)
const initialPreferences = preferenceRepository.value
document.documentElement.dataset.theme = initialPreferences.appearance.theme
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
const activeCategory = ref('All')
const activeView = ref<ActiveView>('collection')
const query = ref('')
const searchQuery = ref('')
const ownership = ref<OwnershipFilter>('all')
const rarityFilter = ref<RarityFilter>('all')
const sortMode = ref<SortMode>('recent')
const sortDirection = ref<SortDirection>('desc')
const trackerCollapsed = ref(initialPreferences.appearance.trackerCollapsed)
const miCountingMode = ref<MiCountingMode>(initialPreferences.workspace.miCountingMode)
const showLegacyScanner = ref(initialPreferences.workspace.showLegacyScanner)
const setProgressFilter = ref<SetProgressFilter>('all')
const setFeatureFilter = ref<SetFeatureFilter>('all')
const setSortMode = ref<SetSortMode>('completion')
const setSortDirection = ref<SortDirection>('desc')
const selectedSkill = ref(initialPreferences.search.selectedSkill)
const skillScope = ref<SkillScope>(initialPreferences.search.skillScope)
const skillSort = ref<SkillSort>('amount')
const skillSortDirection = ref<SortDirection>('desc')
const skillItemQuery = ref('')
const skillRarityFilter = ref<SkillRarityFilter>('all')
const skillSlotFilter = ref('all')
const skillPickerOpen = ref(false)
const skillPickerIndex = ref(0)
const plannerProfiles = ref<PlannerProfile[]>(structuredClone(initialPreferences.planner.profiles))
const selectedPlannerProfileId = ref(initialPreferences.planner.selectedProfileId)
const initialPlannerProfile = plannerProfiles.value.find((profile) => profile.id === selectedPlannerProfileId.value)
  ?? plannerProfiles.value[0]
const plannerSkills = ref<string[]>([...(initialPlannerProfile?.skills ?? ['Wendigo Totem'])])
const plannerSkillDraft = ref('')
const plannerProfileDraft = ref('')
const plannerMinimumLevel = ref(initialPlannerProfile?.minimumLevel ?? 1)
const plannerLevelCap = ref(initialPlannerProfile?.levelCap ?? 70)
const plannerMinimumLevelDraft = ref(plannerMinimumLevel.value)
const plannerLevelCapDraft = ref(plannerLevelCap.value)
const plannerDisplay = ref<PlannerDisplay>(initialPreferences.appearance.plannerDisplay)
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
const oracleClass = ref(initialPreferences.search.oracleClass)
const oracleStyle = ref<OracleStyle>(initialPreferences.search.oracleStyle)
const oracleReadiness = ref<'all' | OracleReadiness>('all')
const oracleMinimumLevel = ref(initialPreferences.search.oracleMinimumLevel)
const oracleMaximumLevel = ref(initialPreferences.search.oracleMaximumLevel)
const oracleQuery = ref('')
const oracleSortMode = ref<OracleSortMode>('score')
const oracleSortDirection = ref<SortDirection>('desc')
const oracleVisibleCount = ref(12)
const discoveredCharacters = ref<CharacterSaveProfile[]>([])
const characterImportOpen = ref(false)
const characterImportLoading = ref(false)
const characterImportError = ref<string | null>(null)
const atlasRegionQuery = ref('')
const selectedAtlasRegion = ref<string | null>(null)
const transferMode = ref<TransferMode>('live')
const transferSection = ref<TransferSection>('ingest-history')
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
const storedVaultPage = ref<VaultItemPage>({ items: [], total: 0, offset: 0, limit: 100 })
const quarantineVaultPage = ref<VaultItemPage>({ items: [], total: 0, offset: 0, limit: 100 })
const vaultPageLoading = ref(false)
const staging = ref<StagingTabInspection | null>(null)
const writeSafety = ref<WriteSafetyStatus | null>(null)
const selectedStashPath = ref(initialPreferences.sources.retrievalStash)
const selectedVaultIds = ref<string[]>([])
const vaultQuery = ref('')
const vaultRarityFilter = ref<VaultRarityFilter>('all')
const vaultSortMode = ref<VaultSortMode>('recent')
const vaultSortDirection = ref<SortDirection>('desc')
const vaultPage = ref(1)
const vaultQuarantinePage = ref(1)
const vaultPageSize = 100
const operationHistory = ref<OperationHistoryPage>({ items: [], total: 0, offset: 0, limit: 50 })
const operationHistoryLoading = ref(false)
const transferHistoryQuery = ref('')
const transferHistoryOutcome = ref<OperationHistoryOutcome>('all')
const transferHistoryPage = ref(1)
const operationHistoryPageSize = 50
const selectedSupplyIds = ref<string[]>([])
const reusableSupplyQuery = ref('')
const supplyCategory = ref<SupplyCategory>('writs')
const supplySlotFilter = ref<SupplySlotFilter>('all')
const supplyVisibleCount = ref(60)
const experimentalToolsEnabled = ref(safeModeActive.value ? false : initialPreferences.workspace.experimentalToolsEnabled)
const visibleWorkspaceToolIds = ref<WorkspaceToolId[]>([...initialPreferences.workspace.visibleTools])
const toolSettingsOpen = ref(false)
const materialCategory = ref<MaterialCategory>('all')
const farmingQuery = ref('')
const farmingRarity = ref<RarityFilter>('all')
const dismantlingQuery = ref('')
const dismantlingMode = ref<DismantlingModeFilter>('all')
const dismantlingRarity = ref<DismantlingRarityFilter>('all')
const dismantlingVisibleCount = ref(120)
const selectedDismantlingIds = ref<string[]>([])
const dismantlingPreview = ref<DismantlingPreview | null>(null)
const dismantlingBusy = ref(false)
const dismantlingError = ref<string | null>(null)
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
const onboardingDialog = ref<HTMLElement | null>(null)
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
const showMiReserves = ref(false)
const miWorkshopQuery = ref('')
const miAffixFilter = ref<MiAffixFilter>('all')
const miComparisonMetric = ref<MiMetricKey>('overall')
const miComparisonDirection = ref<SortDirection>('desc')
const miSortMode = ref<MiSortMode>('metric')
const miAffixFilterSelect = ref<HTMLSelectElement | null>(null)
const miComparisonMetricSelect = ref<HTMLSelectElement | null>(null)
const miComparisonDirectionSelect = ref<HTMLSelectElement | null>(null)
const miSortModeSelect = ref<HTMLSelectElement | null>(null)
const canNavigateBack = ref(false)
const canNavigateForward = ref(false)
const autoLiveConnect = ref(safeModeActive.value ? false : initialPreferences.sources.autoLiveConnect)
const tooltipRecord = ref<string | null>(null)
const tooltipCopyAffixes = ref<{ prefixRecord: string; suffixRecord: string } | null>(null)
const tooltipPosition = ref({ left: 0, top: 0 })
const tooltipMaxHeight = computed(() => Math.max(180, window.innerHeight - tooltipPosition.value.top - 14))
const onboardingInstallCount = computed(() => discovery.value?.installations.length ?? 0)
const onboardingSaveCount = computed(() => discovery.value?.saveLocations.length ?? 0)
const onboardingStepLabel = computed(() => `${onboardingStep.value + 1} / ${ONBOARDING_STEP_COUNT}`)
const onboardingStatusLabel = computed(() => onboardingStatus.value === 'completed'
  ? 'Completed'
  : onboardingStatus.value === 'skipped'
    ? 'Skipped · resume any time'
    : `In progress · step ${onboardingStep.value + 1}`)
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
const pageSize = 48

const collectionSearchQuery = computed(() => compileSearchQuery(
  searchQuery.value,
  searchQueryOptions(activeView.value === 'materials' ? searchSchemas.materials : searchSchemas.collection)
))
const setSearchQuery = computed(() => compileSearchQuery(searchQuery.value, searchQueryOptions(searchSchemas.sets)))
const skillItemsSearchQuery = computed(() => compileSearchQuery(skillItemQuery.value, searchQueryOptions(searchSchemas.skillItems)))
const oracleStructuredQuery = computed(() => compileSearchQuery(oracleQuery.value, searchQueryOptions(searchSchemas.oracle)))
const plannerStructuredQuery = computed(() => compileSearchQuery(plannerQuery.value, searchQueryOptions(searchSchemas.planner)))
const atlasStructuredQuery = computed(() => compileSearchQuery(atlasRegionQuery.value, searchQueryOptions(searchSchemas.atlas)))
const miStructuredQuery = computed(() => compileSearchQuery(miWorkshopQuery.value, searchQueryOptions(searchSchemas.miWorkshop)))
const supplyStructuredQuery = computed(() => compileSearchQuery(reusableSupplyQuery.value, searchQueryOptions(searchSchemas.supplies)))
const dismantlingStructuredQuery = computed(() => compileSearchQuery(dismantlingQuery.value, searchQueryOptions(searchSchemas.dismantling)))
const farmingStructuredQuery = computed(() => compileSearchQuery(farmingQuery.value, searchQueryOptions(searchSchemas.farming)))
const vaultStructuredQuery = computed(() => compileSearchQuery(vaultQuery.value, searchQueryOptions(searchSchemas.vault)))
const historyStructuredQuery = computed(() => compileSearchQuery(transferHistoryQuery.value, searchQueryOptions(searchSchemas.history)))

const archiveModeCount = computed(() =>
  [false, true].filter((isHardcore) => archiveModeEnabled(isHardcore)).length
)

const categories = [
  'All',
  'Head',
  'Chest',
  'Shoulders',
  'Hands',
  'Legs',
  'Feet',
  'Waist',
  'Weapons',
  'Offhands',
  'Jewelry',
  'Relics'
]

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
const dismantlingCandidates = computed(() =>
  vaultItems.value.filter((item) =>
    item.catalogued &&
    !item.reusable &&
    item.state === 'ingested' &&
    ['epic', 'legendary', 'mi', 'rare'].includes(item.rarity)
  )
)
const filteredDismantlingCandidates = computed(() => {
  const structuredQuery = dismantlingStructuredQuery.value
  return dismantlingCandidates.value.filter((item) =>
    (dismantlingMode.value === 'all' ||
      (dismantlingMode.value === 'hardcore') === item.isHardcore) &&
    (dismantlingRarity.value === 'all' || item.rarity === dismantlingRarity.value) &&
    structuredQuery.matches({
      text: [item.name, item.baseRecord, item.prefixRecord, item.suffixRecord, item.rarity, item.isHardcore ? 'hardcore' : 'softcore'].join(' '),
      fields: {
        name: item.name,
        base: item.baseRecord,
        prefix: item.prefixRecord,
        suffix: item.suffixRecord,
        affix: [item.prefixRecord, item.suffixRecord],
        rarity: item.rarity,
        mode: item.isHardcore ? 'hardcore' : 'softcore',
        level: item.levelRequirement
      }
    })
  )
})
const visibleDismantlingCandidates = computed(() =>
  filteredDismantlingCandidates.value.slice(0, dismantlingVisibleCount.value)
)
const selectedDismantlingCandidates = computed(() => {
  const selected = new Set(selectedDismantlingIds.value)
  return dismantlingCandidates.value.filter((item) => selected.has(item.id))
})
const selectedDismantlingAttachments = computed(() =>
  selectedDismantlingCandidates.value.filter((item) => item.componentRecord || item.augmentRecord).length
)
const reusableSupplyUnlocks = computed(() => {
  const unique = new Map<string, VaultListItem>()
  for (const item of vaultItems.value) {
    if (
      item.rarity !== 'supply' ||
      item.state !== 'ingested' ||
      !['writ', 'mandate', 'warrant', 'merit', 'rune'].includes(item.slot)
    ) continue
    const key = item.baseRecord.toLocaleLowerCase()
    if (!unique.has(key)) unique.set(key, item)
  }
  return [...unique.values()]
})
const reusableSupplySummary = computed<CollectionRaritySummary>(() => {
  const catalogRecords = new Set(
    (snapshot.value?.supplies ?? [])
      .filter((item) => ['writ', 'mandate', 'warrant', 'merit', 'rune'].includes(item.slot))
      .map((item) => item.record.toLocaleLowerCase())
  )
  return {
    rarity: 'supply',
    total: catalogRecords.size,
    collected: reusableSupplyUnlocks.value.filter(
      (item) => catalogRecords.has(item.baseRecord.toLocaleLowerCase())
    ).length,
    availableCopies: reusableSupplyUnlocks.value.length
  }
})
const activeCharacterReputation = computed(() => new Map(
  (activeCharacter.value?.factions ?? []).map((faction) => [normalizeFactionName(faction.name), faction])
))
const supplyPresentationByRecord = computed(() => {
  const index = new Map<string, SupplyPresentationIndexEntry>()
  for (const item of snapshot.value?.supplies ?? []) {
    const effects = supplyEffectLines(item)
    const requirements = (item.acquisition?.factions ?? [])
      .flatMap((requirement) => [requirement.faction, requirement.reputation])
    const searchText = [
      item.name,
      item.record,
      item.slot,
      ...(item.supplySlotFamilies ?? []),
      ...requirements,
      ...effects
    ].join(' ').toLocaleLowerCase()
    index.set(item.record.toLocaleLowerCase(), { item, effects, searchText })
  }
  return index
})
const eligibleFactionAugmentRecords = computed(() => new Set(
  [...supplyPresentationByRecord.value.values()]
    .filter(({ item }) => item.slot === 'augment')
    .filter(({ item }) => (item.acquisition?.factions ?? []).some(
      (requirement) => characterMeetsReputation(requirement.faction, requirement.reputation)
    ))
    .map(({ item }) => item.record.toLocaleLowerCase())
))
const eligibleFactionAugmentCount = computed(() => eligibleFactionAugmentRecords.value.size)
const factionAugmentCount = computed(() =>
  [...supplyPresentationByRecord.value.values()].filter(({ item }) => item.slot === 'augment').length
)
const supplyAccessSummary = computed(() => activeCharacter.value
  ? `${eligibleFactionAugmentCount.value} augments available to ${activeCharacter.value.name}`
  : `${factionAugmentCount.value} augments indexed · connect a character to check access`
)
const supplyVaultItems = computed<SupplyOption[]>(() => {
  const structuredQuery = supplyStructuredQuery.value
  if (supplyCategory.value === 'augments') {
    const factionAugments = [...supplyPresentationByRecord.value.values()]
      .filter(({ item }) => item.slot === 'augment')
      .map(({ item, effects, searchText }): SupplyOption & { searchText: string } => {
        const requirements = item.acquisition?.factions ?? []
        const eligible = eligibleFactionAugmentRecords.value.has(item.record.toLocaleLowerCase())
        return {
          id: `augment:${item.record}`,
          record: item.record,
          name: item.name,
          slot: item.slot,
          slotFamilies: item.supplySlotFamilies ?? [],
          isHardcore: activeCharacter.value?.isHardcore ?? Boolean(activeTransferHardcore.value),
          reusable: true,
          stackCount: 1,
          eligible,
          detail: eligible
            ? `Available to ${activeCharacter.value?.name ?? 'active character'} · ${requirements.map((entry) => `${entry.faction} ${entry.reputation}`).join(' / ')}`
            : !activeCharacter.value && liveStatus.value?.state === 'ready'
              ? 'Waiting for active character save metadata · rechecking automatically'
            : requirements.length
              ? `Requires ${requirements.map((entry) => `${entry.faction} ${entry.reputation}`).join(' or ')}`
              : 'Faction requirement is not indexed',
          source: 'faction',
          catalogItem: item,
          effects: effects.slice(0, 5),
          effectCount: effects.length,
          searchText
        }
      })
    const archivedRunes = vaultItems.value
      .filter((item) => item.rarity === 'supply' && item.slot === 'rune' && item.state === 'ingested')
      .map((item): SupplyOption => {
        const eligible = activeTransferHardcore.value !== undefined &&
          item.isHardcore === activeTransferHardcore.value
        const presentation = supplyPresentationByRecord.value.get(item.baseRecord.toLocaleLowerCase())
        const catalogItem = presentation?.item ?? null
        const effects = presentation?.effects ?? []
        return {
          id: item.id,
          record: item.baseRecord,
          name: item.name,
          slot: item.slot,
          slotFamilies: catalogItem?.supplySlotFamilies ?? [],
          isHardcore: item.isHardcore,
          reusable: item.reusable,
          stackCount: item.stackCount,
          eligible,
          detail: `${item.isHardcore ? 'HC' : 'SC'} · archived movement rune${eligible ? '' : ' · select a matching character or stash'}`,
          source: 'archive',
          catalogItem,
          effects: effects.slice(0, 5),
          effectCount: effects.length
        }
      })
    return [...factionAugments, ...archivedRunes]
      .filter((item) => supplySlotFilter.value === 'all' || item.slotFamilies.includes(supplySlotFilter.value))
      .filter((item) => structuredQuery.matches(supplySearchDocument(item)))
      .sort((left, right) => Number(right.eligible) - Number(left.eligible) || left.name.localeCompare(right.name))
  }
  const unique = new Map<string, VaultListItem>()
  for (const item of vaultItems.value) {
    if (item.rarity !== 'supply' || item.state !== 'ingested') continue
    const key = item.slot === 'potion'
      ? `${item.isHardcore ? 'hc' : 'sc'}:potion:${item.id}`
      : `${item.isHardcore ? 'hc' : 'sc'}:${item.baseRecord.toLocaleLowerCase()}`
    if (!unique.has(key)) unique.set(key, item)
  }
  return [...unique.values()]
    .filter((item) => ['writ', 'mandate', 'warrant', 'merit', 'potion'].includes(item.slot))
    .filter((item) => {
      const presentation = supplyPresentationByRecord.value.get(item.baseRecord.toLocaleLowerCase())
      return structuredQuery.matches({
        text: [item.name, item.slot, presentation?.searchText, item.isHardcore ? 'hardcore' : 'softcore'].filter(Boolean).join(' '),
        fields: {
          name: item.name,
          category: item.slot,
          effect: presentation?.effects ?? [],
          faction: presentation?.item.acquisition?.factions?.flatMap((entry) => [entry.faction, entry.reputation]) ?? [],
          slot: presentation?.item.supplySlotFamilies ?? [],
          source: 'archive',
          mode: item.isHardcore ? 'hardcore' : 'softcore',
          eligible: activeTransferHardcore.value !== undefined && item.isHardcore === activeTransferHardcore.value
        }
      })
    })
    .sort((left, right) => left.slot.localeCompare(right.slot) || left.name.localeCompare(right.name))
    .map((item): SupplyOption => {
      const eligible = activeTransferHardcore.value !== undefined &&
        item.isHardcore === activeTransferHardcore.value
      const presentation = supplyPresentationByRecord.value.get(item.baseRecord.toLocaleLowerCase())
      const catalogItem = presentation?.item ?? null
      const effects = presentation?.effects ?? []
      return {
        id: item.id,
        record: item.baseRecord,
        name: item.name,
        slot: item.slot,
        slotFamilies: catalogItem?.supplySlotFamilies ?? [],
        isHardcore: item.isHardcore,
        reusable: item.reusable,
        stackCount: item.stackCount,
        eligible,
        detail: `${item.isHardcore ? 'HC' : 'SC'} · ${item.stackCount} stored · archived ${item.slot}${eligible ? '' : ' · select a matching character or stash'}`,
        source: 'archive',
        catalogItem,
        effects: effects.slice(0, 5),
        effectCount: effects.length
      }
    })
})
const visibleSupplyVaultItems = computed(() => supplyVaultItems.value.slice(0, supplyVisibleCount.value))
const workspaceToolIdSet = computed(() => new Set(visibleWorkspaceToolIds.value))
const quarantinedVaultItems = computed(() => quarantineVaultPage.value.items)
const visibleQuarantinedVaultItems = computed(() => quarantinedVaultItems.value)
const vaultQuarantinePageCount = computed(() =>
  Math.max(1, Math.ceil(quarantineVaultPage.value.total / vaultPageSize))
)
const operationHistoryPageCount = computed(() =>
  Math.max(1, Math.ceil(operationHistory.value.total / operationHistoryPageSize))
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
  return 'Start Grim Dawn and enter a character world. Cairn will detect it within ten seconds.'
})
const connectionFingerprint = computed(() => liveStatus.value?.gameDllSha256?.slice(0, 12) ?? null)
const canApproveCurrentGameBuild = computed(() =>
  liveStatus.value?.state === 'unavailable' &&
  liveStatus.value.grimDawnProcessIds.length === 1 &&
  Boolean(liveStatus.value.gameDllSha256) &&
  liveStatus.value.detail.includes('new to Cairn')
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
      if (!matchesCategory(item, category)) continue
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

const filteredItems = computed(() => {
  if (!snapshot.value) return []
  const structuredQuery = collectionSearchQuery.value
  const sourceItems = activeView.value === 'materials'
    ? (snapshot.value.materials ?? [])
    : snapshot.value.items
  return sourceItems
    .filter((item) => activeView.value === 'materials' || matchesCategory(item, activeCategory.value))
    .filter((item) => activeView.value !== 'materials' || materialCategory.value === 'all' ||
      (materialCategory.value === 'component'
        ? item.rarity === 'component'
        : item.slot === materialCategory.value))
    .filter((item) =>
      activeView.value === 'materials' ||
      rarityFilter.value === 'all' ||
      (rarityFilter.value === 'recipe'
        ? Boolean(item.acquisition?.crafting)
        : rarityFilter.value === 'double-rare'
          ? item.rarity === 'mi' && doubleRareMiBaseRecords.value.has(item.record.toLocaleLowerCase())
          : item.rarity === rarityFilter.value)
    )
    .filter((item) => {
      if (ownership.value === 'owned') return isCollectionOwned(item)
      if (ownership.value === 'missing') return !isCollectionOwned(item)
      return true
    })
    .filter((item) => {
      return structuredQuery.matches(itemStructuredSearchDocument(item))
    })
    .sort(compareItems)
})

const pageCount = computed(() => Math.max(1, Math.ceil(filteredItems.value.length / pageSize)))
const visibleItems = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return filteredItems.value.slice(start, start + pageSize)
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
        maximumLevel: item.levelRequirement > 0 ? item.levelRequirement : 0
      })
    }
  }
  for (const set of grouped.values()) {
    set.items.sort((left, right) => left.slot.localeCompare(right.slot) || left.name.localeCompare(right.name))
    set.collected = setCompletionCount(set.items)
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
      detail: `${Math.max(0, copyChampion.availableCount - 1)} copies beyond the first. Cairn respects the commitment.`,
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

const displayedResultCount = computed(() =>
  activeView.value === 'settings'
    ? 0
    : activeView.value === 'vault'
    ? transferSection.value === 'quarantine'
      ? quarantineVaultPage.value.total
      : operationHistory.value.total
    : activeView.value === 'sets'
      ? visibleSets.value.length
      : filteredItems.value.length
)

const plannerCatalogItems = computed(() => [
  ...(snapshot.value?.items ?? []),
  ...(snapshot.value?.plannerItems ?? [])
])
const selectedPlannerProfile = computed(() =>
  plannerProfiles.value.find((profile) => profile.id === selectedPlannerProfileId.value) ?? null
)
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
      const metric = selectedItem.value?.rarity === 'mi' ? miComparisonMetric.value : 'overall'
      return compareCopiesByMiMetric(left, right, metric, miComparisonDirection.value)
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

const skillNames = computed(() => {
  const names = new Set<string>()
  for (const item of plannerCatalogItems.value) {
    for (const section of item.presentation?.sections ?? []) {
      if (section.kind === 'skill-modifier' && section.heading) names.add(section.heading)
      for (const line of section.lines) {
        if (line.tone === 'skill' && line.label.startsWith('to ')) names.add(line.label.slice(3))
      }
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right))
})

const allOracleCandidates = computed(() => buildStashOracle(
  plannerCatalogItems.value,
  isArchivedItem,
  {
    minimumLevel: Math.min(oracleMinimumLevel.value, oracleMaximumLevel.value),
    maximumLevel: Math.max(oracleMinimumLevel.value, oracleMaximumLevel.value),
    mastery: 'all',
    style: oracleStyle.value,
    skillMasteries: snapshot.value?.skillMasteries,
    skillClassNames: snapshot.value?.skillClassNames
  }
))
const oracleClassOptions = computed(() => [...new Set(allOracleCandidates.value.map((candidate) => candidate.className))]
  .sort((left, right) => left.localeCompare(right)))
const oracleCandidates = computed(() => oracleClass.value === 'all'
  ? allOracleCandidates.value
  : allOracleCandidates.value.filter((candidate) => normalizeLoose(candidate.className) === normalizeLoose(oracleClass.value)))
const filteredOracleCandidates = computed(() => {
  const structuredQuery = oracleStructuredQuery.value
  const direction = oracleSortDirection.value === 'asc' ? 1 : -1
  const readinessRank: Record<OracleReadiness, number> = { ready: 3, near: 2, wildcard: 1 }
  return oracleCandidates.value
    .filter((candidate) => {
      if (oracleReadiness.value !== 'all' && candidate.readiness !== oracleReadiness.value) return false
      const text = [
        candidate.title,
        candidate.skill,
        candidate.damageType,
        candidate.style,
        candidate.className,
        ...candidate.masteries,
        ...candidate.relatedSkills,
        ...candidate.sets.map((set) => set.name),
        ...candidate.evidence.flatMap((evidence) => [evidence.item.name, ...evidence.reasons])
      ].join(' ')
      return structuredQuery.matches({
        text,
        fields: {
          name: candidate.title,
          class: candidate.className,
          mastery: candidate.masteries,
          skill: [candidate.skill, ...candidate.relatedSkills],
          damage: candidate.damageType,
          style: candidate.style,
          set: candidate.sets.map((set) => set.name),
          item: candidate.evidence.map((evidence) => evidence.item.name),
          readiness: candidate.readiness,
          score: candidate.score
        }
      })
    })
    .sort((left, right) => {
      let comparison = 0
      if (oracleSortMode.value === 'name') comparison = left.title.localeCompare(right.title)
      else if (oracleSortMode.value === 'class') comparison = left.className.localeCompare(right.className)
      else if (oracleSortMode.value === 'readiness') comparison = readinessRank[left.readiness] - readinessRank[right.readiness]
      else comparison = left.score - right.score
      if (comparison === 0) comparison = left.title.localeCompare(right.title)
      return comparison * direction
    })
})
const visibleOracleCandidates = computed(() => filteredOracleCandidates.value.slice(0, oracleVisibleCount.value))
const oracleReadinessCounts = computed(() => ({
  ready: oracleCandidates.value.filter((candidate) => candidate.readiness === 'ready').length,
  near: oracleCandidates.value.filter((candidate) => candidate.readiness === 'near').length,
  wildcard: oracleCandidates.value.filter((candidate) => candidate.readiness === 'wildcard').length
}))

const skillSuggestions = computed(() => {
  const query = selectedSkill.value.trim().toLocaleLowerCase()
  const matches = skillNames.value.filter((skill) =>
    query.length === 0 || skill.toLocaleLowerCase().includes(query)
  )
  return matches
    .sort((left, right) => {
      const leftStarts = left.toLocaleLowerCase().startsWith(query)
      const rightStarts = right.toLocaleLowerCase().startsWith(query)
      if (leftStarts !== rightStarts) return leftStarts ? -1 : 1
      return left.localeCompare(right)
    })
    .slice(0, 40)
})

const skillItemRows = computed(() => {
  const skill = selectedSkill.value.trim().toLocaleLowerCase()
  if (!skill) return []
  const candidates = plannerCatalogItems.value.flatMap((item) => {
    if (skillScope.value === 'archive' && !isArchivedItem(item)) return []
    const match = skillMatchForItem(item, skill)
    return match ? [{ item, ...match }] : []
  })
  const miByBase = new Map<string, (typeof candidates)[number]>()
  const rows = candidates.filter((row) => {
    if (row.item.rarity !== 'mi') return true
    const key = `${row.item.name.toLocaleLowerCase()}|${row.item.slot}`
    const current = miByBase.get(key)
    if (!current || row.item.levelRequirement < current.item.levelRequirement) miByBase.set(key, row)
    return false
  })
  rows.push(...miByBase.values())
  const structuredQuery = skillItemsSearchQuery.value
  return rows
    .filter((row) => skillRarityFilter.value === 'all' || row.item.rarity === skillRarityFilter.value)
    .filter((row) => skillSlotFilter.value === 'all' || row.item.slot === skillSlotFilter.value)
    .filter((row) => {
      const presentation = presentationSearchText(row.item.presentation)
      return structuredQuery.matches({
        text: [row.item.name, row.item.rarity, row.item.slot, row.item.levelRequirement, row.amount, row.conversionTarget, row.conversionDetails, row.special, presentation].join(' '),
        fields: {
          name: row.item.name,
          skill: [row.skill, presentation],
          damage: [row.conversionTarget, row.conversionDetails, presentation],
          stat: [row.special, presentation],
          slot: row.item.slot,
          rarity: row.item.rarity,
          level: row.item.levelRequirement,
          conversion: [row.conversionTarget, row.conversionDetails],
          owned: isArchivedItem(row.item)
        }
      })
    })
    .sort((left, right) => {
    let comparison = 0
    if (skillSort.value === 'amount') {
      const leftHasModifier = left.conversionDetails.length > 0 || left.special.length > 0 ? 1 : 0
      const rightHasModifier = right.conversionDetails.length > 0 || right.special.length > 0 ? 1 : 0
      comparison = leftHasModifier - rightHasModifier || left.amount - right.amount
    }
    else if (skillSort.value === 'slot') comparison = left.item.slot.localeCompare(right.item.slot)
    else if (skillSort.value === 'conversion') comparison = left.conversionTarget.localeCompare(right.conversionTarget)
    else if (skillSort.value === 'special') comparison = left.special.localeCompare(right.special)
    else if (skillSort.value === 'level') comparison = left.item.levelRequirement - right.item.levelRequirement
    else comparison = left.item.name.localeCompare(right.item.name)
    if (comparison === 0) comparison = left.item.name.localeCompare(right.item.name)
    return skillSortDirection.value === 'asc' ? comparison : -comparison
  })
})

const skillSlotOptions = computed(() => [...new Set(
  plannerCatalogItems.value.map((item) => item.slot).filter(Boolean)
)].sort((left, right) => left.localeCompare(right)))

const farmTargets = computed<FarmTarget[]>(() => {
  if (!snapshot.value) return []
  const structuredQuery = farmingStructuredQuery.value
  const grouped = new Map<string, FarmTarget>()
  for (const item of snapshot.value.items) {
    if (isCollectionOwned(item)) continue
    if (farmingRarity.value !== 'all' && item.rarity !== farmingRarity.value) continue
    const locations = item.acquisition?.locations ?? []
    for (const location of locations) {
      const itemDocument = itemStructuredSearchDocument(item)
      if (!structuredQuery.matches({
        text: [itemDocument.text, location.name, location.routeName, location.contentPack, ...(item.acquisition?.sources ?? [])].filter(Boolean).join(' '),
        fields: {
          name: item.name,
          skill: itemDocument.fields?.skill,
          damage: itemDocument.fields?.damage,
          monster: item.acquisition?.sources ?? [],
          source: item.acquisition?.sources ?? [],
          area: [location.name, location.routeName ?? ''],
          rarity: item.rarity,
          level: item.levelRequirement
        }
      })) continue
      const key = `${location.contentPack}:${location.name}:${location.routeName ?? ''}`.toLocaleLowerCase()
      const existing = grouped.get(key)
      if (existing) {
        if (!existing.items.some((candidate) => candidate.record === item.record)) existing.items.push(item)
        existing.minimumLevel = Math.min(existing.minimumLevel, item.levelRequirement)
      } else {
        grouped.set(key, {
          key,
          name: location.name,
          contentPack: location.contentPack,
          items: [item],
          minimumLevel: item.levelRequirement
        })
      }
    }
  }
  return [...grouped.values()]
    .filter((target) => target.items.length > 0)
    .sort((left, right) => right.items.length - left.items.length || left.minimumLevel - right.minimumLevel || left.name.localeCompare(right.name))
})

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
    const petBonuses = (item.presentation?.sections ?? [])
      .filter((section) => section.kind === 'pet')
      .flatMap((section) => section.lines)
      .map(formatPresentationLine)
    return matches.length > 0 ? [{ item, matches, petBonuses }] : []
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

const miMetricOptions = computed(() => {
  const itemFields = new Set<string>()
  const petFields = new Set<string>()
  for (const copy of allOwnedCopies.value) {
    for (const stat of copy.rollAnalysis?.stats ?? []) itemFields.add(stat.field)
    for (const stat of copy.rollAnalysis?.petStats ?? []) petFields.add(stat.field)
  }
  const byLabel = (left: string, right: string) =>
    humanStatName(left).localeCompare(humanStatName(right)) || left.localeCompare(right)
  return {
    quality: [
      { key: 'overall' as MiMetricKey, label: 'Overall roll quality' },
      { key: 'base' as MiMetricKey, label: 'Base roll quality' },
      { key: 'prefix' as MiMetricKey, label: 'Prefix roll quality' },
      { key: 'suffix' as MiMetricKey, label: 'Suffix roll quality' }
    ],
    item: [...itemFields].sort(byLabel).map((field) => ({
      key: `item:${field}` as MiMetricKey,
      label: humanStatName(field)
    })),
    pet: [...petFields].sort(byLabel).map((field) => ({
      key: `pet:${field}` as MiMetricKey,
      label: humanStatName(field)
    }))
  }
})

const selectedMiMetricLabel = computed(() => {
  const options = [
    ...miMetricOptions.value.quality,
    ...miMetricOptions.value.item,
    ...miMetricOptions.value.pet
  ]
  const option = options.find((candidate) => candidate.key === miComparisonMetric.value)
  if (!option) return 'Overall roll quality'
  return miComparisonMetric.value.startsWith('pet:') ? `Pet · ${option.label}` : option.label
})

const miWorkshopRows = computed(() => {
  if (!snapshot.value) return []
  const bases = new Map(
    snapshot.value.items
      .filter((item) => item.rarity === 'mi')
      .map((item) => [item.record.toLocaleLowerCase(), item])
  )
  const grouped = new Map<string, {
    key: string
    base: CollectionItem
    prefix: string
    prefixRarity: 'magical' | 'rare' | null
    suffix: string
    suffixRarity: 'magical' | 'rare' | null
    copies: ObservedStashItem[]
  }>()
  for (const copy of allOwnedCopies.value) {
    const base = bases.get(copy.baseRecord.toLocaleLowerCase())
    if (!base) continue
    const prefix = affixByRecord.value.get(copy.prefixRecord.toLocaleLowerCase())
    const suffix = affixByRecord.value.get(copy.suffixRecord.toLocaleLowerCase())
    const key = [copy.baseRecord, copy.prefixRecord, copy.suffixRecord]
      .map((value) => value.toLocaleLowerCase())
      .join('|')
    const existing = grouped.get(key)
    if (existing) existing.copies.push(copy)
    else {
      grouped.set(key, {
        key,
        base,
        prefix: prefix?.name ?? (copy.prefixRecord ? copy.prefixRecord.split('/').at(-1) ?? copy.prefixRecord : 'No prefix'),
        prefixRarity: prefix?.rarity ?? null,
        suffix: suffix?.name ?? (copy.suffixRecord ? copy.suffixRecord.split('/').at(-1) ?? copy.suffixRecord : 'No suffix'),
        suffixRarity: suffix?.rarity ?? null,
        copies: [copy]
      })
    }
  }
  const structuredQuery = miStructuredQuery.value
  const direction = miComparisonDirection.value === 'asc' ? 1 : -1
  return [...grouped.values()]
    .map((group) => {
      const copies = group.copies.sort((left, right) =>
        compareCopiesByMiMetric(left, right, miComparisonMetric.value, 'desc')
      )
      return {
        ...group,
        copies,
        leader: copies[0]!,
        selectedMetric: miMetricResult(copies[0]!, miComparisonMetric.value)
      }
    })
    .filter((group) => miAffixFilter.value === 'all' ||
      (group.prefixRarity === 'rare' && group.suffixRarity === 'rare'))
    .filter((group) => {
      const presentation = [
        presentationSearchText(group.base.presentation),
        ...group.copies.flatMap((copy) => [
        presentationSearchText(affixByRecord.value.get(copy.prefixRecord.toLocaleLowerCase())?.presentation),
        presentationSearchText(affixByRecord.value.get(copy.suffixRecord.toLocaleLowerCase())?.presentation)
        ])
      ].join(' ')
      return structuredQuery.matches({
        text: [group.base.name, group.base.record, group.base.slot, group.base.levelRequirement, group.prefix, group.suffix, presentation].join(' '),
        fields: {
          name: group.base.name,
          slot: group.base.slot,
          level: group.base.levelRequirement,
          prefix: group.prefix,
          suffix: group.suffix,
          affix: [group.prefix, group.suffix],
          skill: presentation,
          damage: presentation,
          stat: presentation,
          copies: group.copies.length
        }
      })
    })
    .sort(
      (left, right) => {
        if (miSortMode.value === 'metric') {
          const leftValue = left.selectedMetric.value
          const rightValue = right.selectedMetric.value
          if (leftValue !== null || rightValue !== null) {
            if (leftValue === null) return 1
            if (rightValue === null) return -1
            if (leftValue !== rightValue) return (leftValue - rightValue) * direction
          }
        }
        if (miSortMode.value === 'level' && left.base.levelRequirement !== right.base.levelRequirement) {
          return (left.base.levelRequirement - right.base.levelRequirement) * direction
        }
        if (miSortMode.value === 'name') {
          const byName = left.base.name.localeCompare(right.base.name)
          if (byName !== 0) return byName * direction
        }
        if (miSortMode.value === 'copies' && left.copies.length !== right.copies.length) {
          return (left.copies.length - right.copies.length) * direction
        }
        return left.base.name.localeCompare(right.base.name) ||
        (left.base.levelRequirement - right.base.levelRequirement) ||
        left.prefix.localeCompare(right.prefix) ||
        left.suffix.localeCompare(right.suffix)
      }
    )
})

function skillMatchForItem(item: CollectionItem, requestedSkill: string): SkillMatch | null {
  const normalizedSkill = requestedSkill.trim().toLocaleLowerCase()
  if (!normalizedSkill) return null
  const sections = item.presentation?.sections ?? []
  const amount = Math.max(
    0,
    ...sections
      .flatMap((section) => section.lines)
      .filter(
        (line) =>
          line.tone === 'skill' &&
          line.label.startsWith('to ') &&
          line.label.slice(3).toLocaleLowerCase() === normalizedSkill
      )
      .map((line) => line.minimum ?? 0)
  )
  const modifiers = sections
    .filter(
      (section) =>
        section.kind === 'skill-modifier' &&
        section.heading?.toLocaleLowerCase() === normalizedSkill
    )
    .flatMap((section) => section.lines)
  if (amount === 0 && modifiers.length === 0) return null
  const conversionLines = modifiers.filter((line) => isDamageTypeConversion(line.label))
  const globalConversionLines = sections
    .filter((section) => section.kind === 'base')
    .flatMap((section) => section.lines)
    .filter((line) => isDamageTypeConversion(line.label))
  const specialLines = modifiers.filter((line) => !isDamageTypeConversion(line.label))
  const allConversionLines = [
    ...conversionLines.map((line) => ({ scope: 'Skill', line })),
    ...globalConversionLines.map((line) => ({ scope: 'Global', line }))
  ]
  const conversionTargets = [...new Set(
    allConversionLines
      .map(({ line }) => conversionTarget(line.label))
      .filter((target): target is string => target !== null)
  )]
  return {
    skill: requestedSkill,
    amount,
    conversionTarget: conversionTargets.join(', '),
    conversionDetails: allConversionLines
      .map(({ scope, line }) => `${scope}: ${formatPresentationLine(line)}`)
      .join('; '),
    special: specialLines.map(formatPresentationLine).join('; ')
  }
}

function conversionTarget(label: string): string | null {
  const match = label.match(/converted to\s+(.+)$/i)
  const target = match?.[1]?.replace(/\s+Damage$/i, '').trim()
  return target || null
}

function isDamageTypeConversion(label: string): boolean {
  return /\bDamage converted to .+ Damage\b/i.test(label)
}

function setSkillSort(next: SkillSort): void {
  if (skillSort.value === next) {
    skillSortDirection.value = skillSortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    skillSort.value = next
    skillSortDirection.value = ['item', 'slot', 'conversion', 'special'].includes(next) ? 'asc' : 'desc'
  }
}

function openSkillPicker(): void {
  skillPickerOpen.value = true
  const exact = skillSuggestions.value.findIndex(
    (skill) => skill.toLocaleLowerCase() === selectedSkill.value.trim().toLocaleLowerCase()
  )
  skillPickerIndex.value = exact >= 0 ? exact : 0
}

function selectSkill(skill: string): void {
  selectedSkill.value = skill
  skillPickerOpen.value = false
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
  selectedPlannerProfileId.value = profile.id
  plannerSkills.value = [...profile.skills]
  plannerMinimumLevel.value = profile.minimumLevel
  plannerLevelCap.value = profile.levelCap
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

function createPlannerProfile(): void {
  const name = plannerProfileDraft.value.trim()
  if (!name) return
  const profile: PlannerProfile = {
    id: crypto.randomUUID(),
    name,
    skills: [...plannerSkills.value],
    excludedSkills: [],
    minimumLevel: plannerMinimumLevel.value,
    levelCap: plannerLevelCap.value,
    source: 'manual',
    modifiedAt: new Date().toISOString()
  }
  plannerProfiles.value = [...plannerProfiles.value, profile]
  plannerProfileDraft.value = ''
  selectPlannerProfile(profile.id)
}

async function loadCharacterProfiles(): Promise<void> {
  characterImportOpen.value = true
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

function importCharacterProfile(character: CharacterSaveProfile): void {
  if (character.error) return
  const validNames = new Map(skillNames.value.map((name) => [name.toLocaleLowerCase(), name]))
  const parsedSkills = [...new Set(character.skills
    .map((skill) => validNames.get(skill.name.toLocaleLowerCase()))
    .filter((skill): skill is string => Boolean(skill)))]
  const existing = plannerProfiles.value.find((profile) =>
    profile.source === 'character' && profile.characterPath?.toLocaleLowerCase() === character.path.toLocaleLowerCase()
  )
  const excluded = existing?.excludedSkills.filter((skill) => parsedSkills.includes(skill)) ?? []
  const profile: PlannerProfile = {
    id: existing?.id ?? crypto.randomUUID(),
    name: character.name,
    skills: parsedSkills.filter((skill) => !excluded.includes(skill)),
    excludedSkills: excluded,
    minimumLevel: existing?.characterLevel === undefined ? character.level : existing.minimumLevel,
    levelCap: existing?.levelCap ?? Math.max(70, character.level),
    source: 'character',
    characterPath: character.path,
    characterLevel: character.level,
    isHardcore: character.isHardcore,
    modifiedAt: new Date().toISOString()
  }
  plannerProfiles.value = existing
    ? plannerProfiles.value.map((candidate) => candidate.id === existing.id ? profile : candidate)
    : [...plannerProfiles.value, profile]
  selectPlannerProfile(profile.id)
  characterImportOpen.value = false
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

function handleSkillPickerKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    skillPickerOpen.value = false
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!skillPickerOpen.value) openSkillPicker()
    const direction = event.key === 'ArrowDown' ? 1 : -1
    const count = skillSuggestions.value.length
    if (count > 0) skillPickerIndex.value = (skillPickerIndex.value + direction + count) % count
    return
  }
  if (event.key === 'Enter' && skillPickerOpen.value) {
    const suggestion = skillSuggestions.value[skillPickerIndex.value]
    if (suggestion) {
      event.preventDefault()
      selectSkill(suggestion)
    }
  }
}

function handleSkillPickerFocusOut(event: FocusEvent): void {
  const container = event.currentTarget as HTMLElement
  if (event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) return
  skillPickerOpen.value = false
}

function currentAppHistoryState(index = appHistoryIndex): AppHistoryState {
  return {
    cairnCodex: true,
    index,
    view: activeView.value,
    selectedRecord: selectedRecord.value,
    activeCategory: activeCategory.value,
    query: query.value,
    ownership: ownership.value,
    rarityFilter: rarityFilter.value,
    miWorkshopQuery: miWorkshopQuery.value,
    miAffixFilter: miAffixFilter.value,
    miComparisonMetric: miComparisonMetric.value,
    miComparisonDirection: miComparisonDirection.value,
    miSortMode: miSortMode.value,
    skillItemQuery: skillItemQuery.value,
    skillScope: skillScope.value,
    skillRarityFilter: skillRarityFilter.value,
    skillSlotFilter: skillSlotFilter.value,
    skillSort: skillSort.value,
    skillSortDirection: skillSortDirection.value,
    oracleQuery: oracleQuery.value,
    oracleClass: oracleClass.value,
    oracleStyle: oracleStyle.value,
    oracleReadiness: oracleReadiness.value,
    oracleMinimumLevel: oracleMinimumLevel.value,
    oracleMaximumLevel: oracleMaximumLevel.value,
    oracleSortMode: oracleSortMode.value,
    oracleSortDirection: oracleSortDirection.value,
    plannerQuery: plannerQuery.value,
    plannerOwnership: plannerOwnership.value,
    plannerShowIgnored: plannerShowIgnored.value,
    plannerSortMode: plannerSortMode.value,
    plannerSortDirection: plannerSortDirection.value,
    plannerDisplay: plannerDisplay.value,
    atlasRegionQuery: atlasRegionQuery.value,
    plannerMapScope: plannerMapScope.value,
    plannerMapSortMode: plannerMapSortMode.value,
    plannerMapSortDirection: plannerMapSortDirection.value,
    vaultQuery: vaultQuery.value,
    vaultRarityFilter: vaultRarityFilter.value,
    vaultSortMode: vaultSortMode.value,
    vaultSortDirection: vaultSortDirection.value,
    transferMode: transferMode.value,
    transferSection: transferSection.value,
    transferHistoryQuery: transferHistoryQuery.value,
    transferHistoryOutcome: transferHistoryOutcome.value,
    transferHistoryPage: transferHistoryPage.value
  }
}

function updateHistoryButtons(): void {
  canNavigateBack.value = appHistoryIndex > 0
  canNavigateForward.value = appHistoryIndex < appHistoryMaximum
}

function syncMiWorkshopControlElements(): void {
  if (activeView.value !== 'mi-workshop') return
  if (miAffixFilterSelect.value) miAffixFilterSelect.value.value = miAffixFilter.value
  if (miComparisonMetricSelect.value) miComparisonMetricSelect.value.value = miComparisonMetric.value
  if (miComparisonDirectionSelect.value) miComparisonDirectionSelect.value.value = miComparisonDirection.value
  if (miSortModeSelect.value) miSortModeSelect.value.value = miSortMode.value
}

function handlePageShow(): void {
  void nextTick(syncMiWorkshopControlElements)
}

function handleAppHistory(event: PopStateEvent): void {
  const state = event.state as AppHistoryState | null
  if (!state?.cairnCodex) return
  restoringAppHistory = true
  appHistoryIndex = state.index
  activeView.value = state.view
  selectedRecord.value = state.selectedRecord
  activeCategory.value = state.activeCategory
  query.value = state.query
  ownership.value = state.ownership
  rarityFilter.value = state.rarityFilter
  miWorkshopQuery.value = state.miWorkshopQuery ?? ''
  miAffixFilter.value = state.miAffixFilter ?? 'all'
  miComparisonMetric.value = state.miComparisonMetric ?? 'overall'
  miComparisonDirection.value = state.miComparisonDirection ?? 'desc'
  miSortMode.value = state.miSortMode ?? 'metric'
  skillItemQuery.value = state.skillItemQuery ?? ''
  skillScope.value = state.skillScope ?? 'all'
  skillRarityFilter.value = state.skillRarityFilter ?? 'all'
  skillSlotFilter.value = state.skillSlotFilter ?? 'all'
  skillSort.value = state.skillSort ?? 'amount'
  skillSortDirection.value = state.skillSortDirection ?? 'desc'
  oracleQuery.value = state.oracleQuery ?? ''
  oracleClass.value = state.oracleClass ?? 'all'
  oracleStyle.value = state.oracleStyle ?? 'all'
  oracleReadiness.value = state.oracleReadiness ?? 'all'
  oracleMinimumLevel.value = state.oracleMinimumLevel ?? 65
  oracleMaximumLevel.value = state.oracleMaximumLevel ?? 100
  oracleSortMode.value = state.oracleSortMode ?? 'score'
  oracleSortDirection.value = state.oracleSortDirection ?? 'desc'
  plannerQuery.value = state.plannerQuery ?? ''
  plannerOwnership.value = state.plannerOwnership ?? 'all'
  plannerShowIgnored.value = state.plannerShowIgnored ?? false
  plannerSortMode.value = state.plannerSortMode ?? 'level'
  plannerSortDirection.value = state.plannerSortDirection ?? 'asc'
  plannerDisplay.value = state.plannerDisplay ?? 'list'
  atlasRegionQuery.value = state.atlasRegionQuery ?? ''
  plannerMapScope.value = state.plannerMapScope ?? 'selected'
  plannerMapSortMode.value = state.plannerMapSortMode ?? 'items'
  plannerMapSortDirection.value = state.plannerMapSortDirection ?? 'desc'
  vaultQuery.value = state.vaultQuery ?? ''
  vaultRarityFilter.value = state.vaultRarityFilter ?? 'all'
  vaultSortMode.value = state.vaultSortMode ?? 'recent'
  vaultSortDirection.value = state.vaultSortDirection ?? 'desc'
  transferMode.value = state.transferMode ?? 'live'
  const restoredTransferSection = String(state.transferSection ?? '')
  transferSection.value = restoredTransferSection === 'dispense-history' || restoredTransferSection === 'retrieval-history'
    ? 'dispense-history'
    : restoredTransferSection === 'quarantine'
      ? 'quarantine'
      : 'ingest-history'
  transferHistoryQuery.value = state.transferHistoryQuery ?? ''
  transferHistoryOutcome.value = state.transferHistoryOutcome ?? 'all'
  transferHistoryPage.value = state.transferHistoryPage ?? 1
  updateHistoryButtons()
  void nextTick(() => {
    syncMiWorkshopControlElements()
    restoringAppHistory = false
  })
}

function navigateAppHistory(direction: 'back' | 'forward'): void {
  if (direction === 'back' && canNavigateBack.value) window.history.back()
  if (direction === 'forward' && canNavigateForward.value) window.history.forward()
}

watch(
  [activeView, activeCategory, query, ownership, rarityFilter, sortMode, sortDirection, setProgressFilter, setFeatureFilter, setSortMode, setSortDirection, materialCategory],
  () => {
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

watch(sortMode, (mode) => {
  sortDirection.value = mode === 'name' ? 'asc' : 'desc'
})

watch(setSortMode, (mode) => {
  setSortDirection.value = mode === 'completion' ? 'desc' : 'asc'
})

watch(selectedSkill, (selectedSkill) => preferenceRepository.update('search', { selectedSkill }))
watch(skillScope, (skillScope) => preferenceRepository.update('search', { skillScope }))
watch(miCountingMode, (miCountingMode) => preferenceRepository.update('workspace', { miCountingMode }))
watch(oracleClass, (oracleClass) => preferenceRepository.update('search', { oracleClass }))
watch(oracleStyle, (oracleStyle) => preferenceRepository.update('search', { oracleStyle }))
watch(oracleMinimumLevel, (oracleMinimumLevel) => preferenceRepository.update('search', { oracleMinimumLevel }))
watch(oracleMaximumLevel, (oracleMaximumLevel) => preferenceRepository.update('search', { oracleMaximumLevel }))
watch([oracleClass, oracleStyle, oracleReadiness, oracleMinimumLevel, oracleMaximumLevel, oracleQuery], () => {
  oracleVisibleCount.value = 12
})
watch(selectedRecord, () => {
  activeCopyAffixTarget.value = null
})
watch([activeView, selectedRecord, transferSection], () => {
  if (!appHistoryReady || restoringAppHistory) return
  appHistoryIndex += 1
  appHistoryMaximum = appHistoryIndex
  window.history.pushState(currentAppHistoryState(), '')
  updateHistoryButtons()
}, { flush: 'post' })
watch(
  [activeCategory, query, ownership, rarityFilter, miWorkshopQuery, miAffixFilter, miComparisonMetric, miComparisonDirection, miSortMode, skillItemQuery, skillScope, skillRarityFilter, skillSlotFilter, skillSort, skillSortDirection, oracleQuery, oracleClass, oracleStyle, oracleReadiness, oracleMinimumLevel, oracleMaximumLevel, oracleSortMode, oracleSortDirection, plannerQuery, plannerOwnership, plannerShowIgnored, plannerSortMode, plannerSortDirection, plannerDisplay, atlasRegionQuery, plannerMapScope, plannerMapSortMode, plannerMapSortDirection, vaultQuery, vaultRarityFilter, vaultSortMode, vaultSortDirection, transferMode, transferHistoryQuery, transferHistoryOutcome, transferHistoryPage],
  () => {
    if (!appHistoryReady || restoringAppHistory) return
    window.history.replaceState(currentAppHistoryState(), '')
  },
  { flush: 'post' }
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
watch([plannerSkills, plannerMinimumLevel, plannerLevelCap], () => {
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
  selectedAtlasRegion.value = null
})
watch(visibleAtlasRegions, (regions) => {
  if (!regions.some((region) => region.key === selectedAtlasRegion.value)) {
    selectedAtlasRegion.value = regions[0]?.key ?? null
  }
}, { immediate: true })
watch(transferMode, () => {
  selectedVaultIds.value = []
  vaultPage.value = 1
  vaultQuarantinePage.value = 1
  selectedSupplyIds.value = []
})
watch(transferSection, (section) => {
  selectedVaultIds.value = []
  if (!restoringAppHistory) transferHistoryPage.value = 1
  if (section === 'ingest-history' || section === 'dispense-history') scheduleOperationHistoryRefresh()
})
watch([transferHistoryQuery, transferHistoryOutcome], () => {
  transferHistoryPage.value = 1
  scheduleOperationHistoryRefresh()
})
watch(transferHistoryPage, scheduleOperationHistoryRefresh)
watch([vaultQuery, vaultRarityFilter, vaultSortMode, vaultSortDirection, activeTransferHardcore], () => {
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
watch(vaultQuarantinePageCount, (count) => {
  if (vaultQuarantinePage.value > count) vaultQuarantinePage.value = count
})
watch(supplyCategory, () => {
  supplySlotFilter.value = 'all'
  selectedSupplyIds.value = []
})
watch(supplySlotFilter, () => {
  selectedSupplyIds.value = []
})
watch([supplyCategory, supplySlotFilter, reusableSupplyQuery], () => {
  supplyVisibleCount.value = 60
})
watch([dismantlingQuery, dismantlingMode, dismantlingRarity], () => {
  dismantlingVisibleCount.value = 120
})
watch(selectedDismantlingIds, () => {
  dismantlingPreview.value = null
  dismantlingError.value = null
}, { deep: true })
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
  syncMiWorkshopControlElements()
  window.scrollTo({ top: 0, behavior: 'auto' })
  if (view === 'vault' || view === 'supplies' || view === 'dismantling') {
    await refreshVault()
    if (view !== 'dismantling') await pollLiveLifecycle()
  }
})

watch([onboardingOpen, appInitializing], async ([open, initializing]) => {
  document.body.classList.toggle('onboarding-active', open && !initializing)
  if (!open || initializing) return
  await nextTick()
  onboardingDialog.value?.focus()
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

onMounted(async () => {
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
  window.scrollTo(0, 0)
  appHistoryIndex = 0
  appHistoryMaximum = 0
  window.history.replaceState(currentAppHistoryState(0), '')
  appHistoryReady = true
  updateHistoryButtons()
  window.addEventListener('popstate', handleAppHistory)
  window.addEventListener('pageshow', handlePageShow)
  window.addEventListener('keydown', handleEscape)
  window.addEventListener('keyup', handleTooltipKeyUp)
  window.addEventListener('wheel', handleZoomWheel, { passive: false })
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
    reportTransferProblem(`Cairn could not restart in safe mode: ${readableError(error)}`)
    safeModeBusy.value = false
  }
}

async function restartNormally(): Promise<void> {
  if (safeModeBusy.value) return
  safeModeBusy.value = true
  try {
    await window.cairnCodex.restartNormally()
  } catch (error) {
    reportTransferProblem(`Cairn could not restart normally: ${readableError(error)}`)
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
  reportSuccess('Reset interface preferences. Planner profiles, to-dos, sources, and archive data were preserved. Reloading Cairn…')
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
  if (error) reportTransferProblem(`Windows could not open Cairn's data folder: ${error}`)
}

async function refreshArchiveBackupStatus(): Promise<void> {
  try {
    archiveBackupStatus.value = await window.cairnCodex.getArchiveBackupStatus()
  } catch (error) {
    console.warn('Archive backup status could not be loaded.', error)
  }
}

function formatBackupDate(value: string): string {
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

function formatBackupSize(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
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
      reportSuccess('Backup verified. Cairn is restarting to restore the archive.')
    }
  } catch (error) {
    reportTransferProblem(readableError(error))
  } finally {
    archiveBackupBusy.value = null
  }
}

async function openArchiveBackupDirectory(): Promise<void> {
  const error = await window.cairnCodex.openArchiveBackupDirectory()
  if (error) reportTransferProblem(`Windows could not open Cairn's archive backup folder: ${error}`)
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

function formatOperationSource(source: 'item-assistant' | 'live' | 'offline'): string {
  if (source === 'item-assistant') return 'Item Assistant import'
  if (source === 'live') return 'Live game'
  return 'Offline shared stash'
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

function chooseEmptyArchive(): void {
  if (collectionBasis.value !== 'archive') {
    collectionBasis.value = 'archive'
    preferenceRepository.update('sources', { collectionBasis: 'archive' })
  }
  setOnboardingStep(2)
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

function archiveModeEnabled(isHardcore: boolean): boolean {
  const modePaths = new Set(
    stashChoices.value.filter((stash) => stash.isHardcore === isHardcore).map((stash) => stash.path)
  )
  return archiveStashPaths.value.some((path) => modePaths.has(path))
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
    selectedSupplyIds.value = []
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
    'This is an advanced override. Cairn will still require its verified hook, but cannot prove that a new game patch kept the same internal ABI. Run one disposable ingest-and-return round trip before using valuable items.'
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
  const tooltip = tooltipElement.value
  if (tooltipRecord.value && tooltip && tooltip.scrollHeight > tooltip.clientHeight) {
    event.preventDefault()
    tooltip.scrollTop = Math.max(
      0,
      Math.min(tooltip.scrollTop + event.deltaY, tooltip.scrollHeight - tooltip.clientHeight)
    )
    return
  }
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
  activeCategory.value = 'All'
  rarityFilter.value = value
  window.scrollTo({ top: 500, behavior: 'smooth' })
}

function filterToAllRarities(): void {
  activeView.value = 'collection'
  activeCategory.value = 'All'
  ownership.value = 'all'
  rarityFilter.value = 'all'
  window.scrollTo({ top: 420, behavior: 'smooth' })
}

function filterToRecipes(): void {
  activeView.value = 'collection'
  activeCategory.value = 'All'
  ownership.value = 'all'
  rarityFilter.value = 'recipe'
  window.scrollTo({ top: 500, behavior: 'smooth' })
}

function openAffixWorkshop(): void {
  activeView.value = 'mi-workshop'
  activeCategory.value = 'All'
  rarityFilter.value = 'all'
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

function openMaterials(category: MaterialCategory = 'all'): void {
  activeView.value = 'materials'
  materialCategory.value = category
  query.value = ''
  ownership.value = 'all'
}

function openStashOracle(): void {
  activeView.value = 'oracle'
  oracleVisibleCount.value = 12
}

function surpriseMeWithOracle(): void {
  oracleClass.value = 'all'
  oracleStyle.value = 'all'
  oracleReadiness.value = 'all'
  oracleQuery.value = ''
  oracleVisibleCount.value = 12
}

function sendOracleCandidateToPlanner(candidate: (typeof oracleCandidates.value)[number]): void {
  plannerSkills.value = [...new Set([candidate.skill, ...candidate.relatedSkills])]
  plannerMinimumLevelDraft.value = Math.min(plannerMinimumLevel.value, oracleMinimumLevel.value)
  plannerLevelCapDraft.value = Math.max(plannerLevelCap.value, oracleMaximumLevel.value)
  plannerMinimumLevel.value = plannerMinimumLevelDraft.value
  plannerLevelCap.value = plannerLevelCapDraft.value
  plannerQuery.value = ''
  plannerOwnership.value = 'all'
  activeView.value = 'planner'
}

function oracleReadinessLabel(readiness: OracleReadiness): string {
  if (readiness === 'ready') return 'Ready now'
  if (readiness === 'near') return 'Nearly there'
  return 'Wild card'
}

function oracleStyleLabel(style: Exclude<OracleStyle, 'all'>): string {
  if (style === 'pets') return 'Pet build'
  if (style === 'retaliation') return 'Retaliation'
  if (style === 'weapon') return 'Weapon build'
  return 'Caster build'
}

async function openSupplies(): Promise<void> {
  activeView.value = 'supplies'
  reusableSupplyQuery.value = ''
  supplySlotFilter.value = 'all'
  await refreshVault()
  await pollLiveLifecycle()
  if (liveStatus.value?.state === 'ready') await refreshHeaderCharacters()
}

function selectAllVisibleSupplies(): void {
  selectedSupplyIds.value = visibleSupplyVaultItems.value.filter((item) => item.eligible).map((item) => item.id)
}

async function dispenseAllWrits(): Promise<void> {
  supplyCategory.value = 'writs'
  await nextTick()
  selectedSupplyIds.value = supplyVaultItems.value
    .filter((item) => ['writ', 'mandate', 'warrant'].includes(item.slot))
    .map((item) => item.id)
  await retrieveSupplies()
}

function percentage(summary: Pick<CollectionRaritySummary, 'total' | 'collected'> | undefined): string {
  if (!summary || summary.total === 0) return '0%'
  return ((summary.collected / summary.total) * 100).toFixed(1) + '%'
}

function characterMeetsReputation(factionName: string, requiredRank: string): boolean {
  const thresholds: Record<string, number> = {
    tolerated: 0,
    friendly: 1_500,
    respected: 5_000,
    honored: 10_000,
    revered: 25_000
  }
  const threshold = thresholds[requiredRank.toLocaleLowerCase()]
  if (threshold === undefined || !activeCharacter.value) return false
  const faction = activeCharacterReputation.value.get(normalizeFactionName(factionName))
  return Boolean(faction?.isUnlocked && faction.value >= threshold)
}

function normalizeFactionName(value: string): string {
  return value.toLocaleLowerCase().replaceAll('’', "'").replace(/[^a-z0-9]/g, '')
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
    if (summary.status === 'fulfilled') vaultSummary.value = summary.value
    else console.warn('Archive summary could not be refreshed.', summary.reason)
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
  selectedSupplyIds.value = selectedSupplyIds.value.filter((id) =>
    id.startsWith('augment:') ||
    items.some((item) => item.id === id && item.state === 'ingested' && item.rarity === 'supply')
  )
  selectedDismantlingIds.value = selectedDismantlingIds.value.filter((id) =>
    items.some((item) => item.id === id && item.state === 'ingested')
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

function toggleDismantlingCandidate(id: string): void {
  selectedDismantlingIds.value = selectedDismantlingIds.value.includes(id)
    ? selectedDismantlingIds.value.filter((candidate) => candidate !== id)
    : [...selectedDismantlingIds.value, id]
}

function selectVisibleDismantlingCandidates(): void {
  selectedDismantlingIds.value = [...new Set([
    ...selectedDismantlingIds.value,
    ...visibleDismantlingCandidates.value.map((item) => item.id)
  ])]
}

function selectRedundantDismantlingCandidates(): void {
  const groups = new Map<string, VaultListItem[]>()
  for (const item of filteredDismantlingCandidates.value) {
    const key = `${item.isHardcore ? 'hc' : 'sc'}:${item.baseRecord.toLocaleLowerCase()}`
    const group = groups.get(key) ?? []
    group.push(item)
    groups.set(key, group)
  }
  const redundant: string[] = []
  for (const copies of groups.values()) {
    copies.sort((left, right) =>
      (right.rollAnalysis?.overallEstimatedPercentile ?? -1) -
        (left.rollAnalysis?.overallEstimatedPercentile ?? -1) ||
      Date.parse(right.ingestedAtUtc) - Date.parse(left.ingestedAtUtc)
    )
    redundant.push(...copies.slice(1)
      .filter((item) => !item.componentRecord && !item.augmentRecord)
      .map((item) => item.id))
  }
  selectedDismantlingIds.value = redundant
}

async function buildDismantlingPreview(): Promise<void> {
  if (dismantlingBusy.value || selectedDismantlingIds.value.length === 0) return
  dismantlingBusy.value = true
  dismantlingError.value = null
  try {
    dismantlingPreview.value = await window.cairnCodex.previewDismantling([...selectedDismantlingIds.value])
  } catch (error) {
    dismantlingError.value = readableError(error)
  } finally {
    dismantlingBusy.value = false
  }
}

async function startLiveMode(): Promise<void> {
  if (vaultBusy.value) return
  const confirmed = window.confirm(
    'Enable the Cairn Codex live adapter for this Grim Dawn session? Item Assistant must remain closed while Cairn owns the game hook.'
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
      : `${reusable ? 'Dispensed' : 'Live-retrieved'} ${result.retrieved.length} item${result.retrieved.length === 1 ? '' : 's'} into Grim Dawn${reusable ? '; the unlocks remain in Cairn.' : '.'}`)
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

async function retrieveSupplies(): Promise<void> {
  if (selectedSupplyIds.value.length === 0 || vaultBusy.value) return
  const selected = supplyVaultItems.value.filter((item) => selectedSupplyIds.value.includes(item.id))
  const factionAugments = selected.filter((item) => item.source === 'faction')
  const archived = selected.filter((item) => item.source === 'archive')
  if (factionAugments.length > 0 && transferMode.value !== 'live') {
    reportTransferProblem('Soulbound augments require a live Grim Dawn connection and are delivered to the active character.')
    return
  }
  if (factionAugments.length > 0) {
    const names = factionAugments.map((item) => item.name)
    const manifest = names.map((name) => `• ${name}`).join('\n')
    const confirmed = window.confirm(
      `Dispense exactly ${names.length} faction augment${names.length === 1 ? '' : 's'} directly to ${activeCharacter.value?.name ?? 'the active character'}?\n\n${manifest}\n\nCairn will re-check that character's current reputation first.`
    )
    if (!confirmed) return
    vaultBusy.value = true
    try {
      const result = await window.cairnCodex.dispenseLiveAugments(
        factionAugments.map((item) => item.record),
        activeCharacter.value?.name
      )
      const delivered = new Set(result.dispensed.map((item) => `augment:${item.record}`))
      selectedSupplyIds.value = selectedSupplyIds.value.filter((id) => !delivered.has(id))
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
    if (transferMode.value === 'live') await retrieveSelectedLive()
    else await retrieveSelected()
  }
  selectedSupplyIds.value = []
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
      ? `Dispensed ${result.retrieved.length} reusable ${result.retrieved.length === 1 ? 'supply' : 'supplies'}; the unlocks remain in Cairn. Backup: ${result.backupPath}`
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

function toggleVaultItem(id: string): void {
  selectedVaultIds.value = selectedVaultIds.value.includes(id)
    ? selectedVaultIds.value.filter((candidate) => candidate !== id)
    : [...selectedVaultIds.value, id]
}

function toggleSupply(id: string): void {
  selectedSupplyIds.value = selectedSupplyIds.value.includes(id)
    ? selectedSupplyIds.value.filter((candidate) => candidate !== id)
    : [...selectedSupplyIds.value, id]
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

function compareItems(left: CollectionItem, right: CollectionItem): number {
  let comparison = 0
  if (sortMode.value === 'level') {
    comparison = left.levelRequirement - right.levelRequirement
  } else if (sortMode.value === 'completion') {
    comparison = Number(isCollectionOwned(left)) - Number(isCollectionOwned(right))
    if (comparison === 0) comparison = left.availableCount - right.availableCount
  } else if (sortMode.value === 'recent') {
    comparison =
      (left.firstDiscoveredAt ? Date.parse(left.firstDiscoveredAt) : 0) -
      (right.firstDiscoveredAt ? Date.parse(right.firstDiscoveredAt) : 0)
  } else if (sortMode.value === 'roll') {
    comparison = (left.bestRollPercentile ?? -1) - (right.bestRollPercentile ?? -1)
  } else {
    comparison = left.name.localeCompare(right.name)
  }
  if (comparison === 0) comparison = left.name.localeCompare(right.name)
  return sortDirection.value === 'asc' ? comparison : -comparison
}

function setCompletionPercent(set: CollectionSet): string {
  return ((set.collected / set.items.length) * 100).toFixed(1) + '%'
}

function miFamilyKey(item: CollectionItem): string {
  return `${item.slot}\0${item.name.normalize('NFKC').trim().toLocaleLowerCase()}`
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
    comparison = left.collected / left.items.length - right.collected / right.items.length
    if (comparison === 0) comparison = left.collected - right.collected
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

function matchesCategory(item: CollectionItem, category: string): boolean {
  const slots: Record<string, string[]> = {
    Head: ['head'],
    Chest: ['chest'],
    Shoulders: ['shoulders'],
    Hands: ['hands'],
    Legs: ['legs'],
    Feet: ['feet'],
    Waist: ['waist'],
    Weapons: ['weapon'],
    Offhands: ['offhand', 'shield'],
    Jewelry: ['ring', 'amulet', 'medal'],
    Relics: ['relic']
  }
  if (category === 'All') return true
  return slots[category]?.includes(item.slot) ?? false
}

function goToPage(page: number): void {
  currentPage.value = Math.min(Math.max(page, 1), pageCount.value)
  window.scrollTo({ top: 410, behavior: 'smooth' })
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
  miWorkshopQuery.value = selectedItem.value.name
  activeView.value = 'mi-workshop'
  selectedRecord.value = null
}

function itemIconUrl(item: CollectionItem): string | null {
  return item.iconKey ? `cairn-icon://asset/${item.iconKey}.png` : null
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

function supplySearchDocument(item: SupplyOption): SearchDocument {
  const factions = item.catalogItem?.acquisition?.factions?.flatMap((entry) => [entry.faction, entry.reputation]) ?? []
  return {
    text: [item.name, item.detail, item.slot, item.source, ...item.slotFamilies, ...item.effects, ...factions].join(' '),
    fields: {
      name: item.name,
      category: item.slot,
      effect: item.effects,
      faction: factions,
      slot: item.slotFamilies,
      source: item.source,
      mode: item.isHardcore ? 'hardcore' : 'softcore',
      eligible: item.eligible
    }
  }
}

function searchErrorMessage(query: CompiledSearchQuery): string | null {
  if (!query.error) return null
  return query.error.fragment
    ? `${query.error.message} Check “${query.error.fragment}”.`
    : query.error.message
}

function itemTypeLabel(item: CollectionItem): string {
  const itemClass = item.itemClass.toLocaleLowerCase()
  if (itemClass.includes('ranged2h')) return 'Two-handed ranged weapon'
  if (itemClass.includes('ranged1h')) return 'One-handed ranged weapon'
  if (itemClass.includes('spear2h')) return 'Two-handed spear'
  if (itemClass.includes('sword2h')) return 'Two-handed sword'
  if (itemClass.includes('axe2h')) return 'Two-handed axe'
  if (itemClass.includes('mace2h') || itemClass.includes('blunt2h')) return 'Two-handed mace'
  if (itemClass.includes('scepter')) return 'One-handed scepter (caster weapon)'
  if (itemClass.includes('dagger')) return 'One-handed dagger (caster weapon)'
  if (itemClass.includes('sword')) return 'One-handed sword'
  if (itemClass.includes('axe')) return 'One-handed axe'
  if (itemClass.includes('mace') || itemClass.includes('blunt')) return 'One-handed mace'
  if (itemClass.includes('melee') && itemClass.includes('2h')) return 'Two-handed melee weapon'
  if (itemClass.includes('shield')) return 'Shield'
  if (itemClass.includes('offhand') || itemClass.includes('focus')) return 'Caster off-hand'
  const labels: Record<string, string> = {
    head: 'Head armor', chest: 'Chest armor', shoulders: 'Shoulders', hands: 'Hands',
    legs: 'Leg armor', feet: 'Feet', waist: 'Waist', ring: 'Ring', amulet: 'Amulet',
    medal: 'Medal', relic: 'Relic', offhand: 'Offhand', weapon: 'Weapon',
    component: 'Component', material: 'Crafting material', 'potion-formula': 'Potion formula',
    augment: 'Augment', rune: 'Movement rune', writ: 'Faction writ', mandate: 'Faction mandate',
    warrant: 'Nemesis warrant', merit: 'Difficulty merit'
  }
  return labels[item.slot] ?? item.slot
}

function rarityLabel(item: CollectionItem): string {
  if (item.rarity === 'mi') return 'Monster Infrequent'
  if (item.rarity === 'rare') return 'Rare'
  if (item.rarity === 'faction') return 'Faction Rare'
  if (item.rarity === 'component') return 'Component'
  if (item.rarity === 'consumable') return item.slot === 'potion-formula' ? 'Learned formula' : 'Consumable'
  return item.rarity.charAt(0).toLocaleUpperCase() + item.rarity.slice(1)
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
  event: MouseEvent | FocusEvent,
  copy?: Pick<ObservedStashItem, 'prefixRecord' | 'suffixRecord'>
): void {
  cancelTooltipHide()
  cancelTooltip()
  positionTooltip(event)
  tooltipTimer = setTimeout(() => {
    tooltipDetailsHeld.value = false
    tooltipCopyAffixes.value = copy
      ? { prefixRecord: copy.prefixRecord, suffixRecord: copy.suffixRecord }
      : null
    tooltipRecord.value = item.record
    resetTooltipScroll()
  }, 180)
}

function moveTooltip(event: MouseEvent): void {
  if (!tooltipRecord.value) positionTooltip(event)
}

function positionTooltip(event: MouseEvent | FocusEvent): void {
  const width = 455
  const margin = 14
  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  const rect = target?.getBoundingClientRect()
  const anchorX = event instanceof MouseEvent ? event.clientX : rect?.right ?? margin
  const x = rect && rect.right + width + 18 > window.innerWidth
    ? rect.left - width - 14
    : anchorX + 18
  const y = event instanceof MouseEvent ? event.clientY + 14 : rect?.top ?? margin
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
  void nextTick(() => {
    if (tooltipElement.value) tooltipElement.value.scrollTop = 0
  })
}

function hideTooltip(): void {
  cancelTooltip()
  cancelTooltipHide()
  tooltipRecord.value = null
  tooltipCopyAffixes.value = null
  tooltipDetailsHeld.value = false
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
}

function handleEscape(event: KeyboardEvent): void {
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

function supplyEffectLines(item: CollectionItem): string[] {
  const flavor = item.presentation?.flavorText ? [item.presentation.flavorText] : []
  const direct = (item.presentation?.sections ?? [])
    .flatMap((section) => section.lines.map((line) => {
      const formatted = formatPresentationLine(line)
      return section.kind === 'pet' ? `Pets · ${formatted}` : formatted
    }))
  const granted = item.presentation?.grantedSkill
  if (!granted) return [...flavor, ...direct]
  return [
    ...flavor,
    ...direct,
    `Grants ${granted.name}${granted.trigger ? ` (${granted.trigger})` : ''}`,
    ...granted.lines.map(formatPresentationLine)
  ]
}

function queueSupplyTooltip(item: SupplyOption, event: MouseEvent | FocusEvent): void {
  if (item.catalogItem) queueTooltip(item.catalogItem, event)
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

function humanStatName(field: string): string {
  const names: Record<string, string> = {
    characterStrength: 'Physique',
    characterDexterity: 'Cunning',
    characterAttackSpeedModifier: 'Attack speed',
    characterSpellCastSpeedModifier: 'Cast speed',
    characterRunSpeedModifier: 'Movement speed',
    characterTotalSpeedModifier: 'Total speed',
    characterIntelligence: 'Spirit',
    characterLife: 'Health',
    characterLifeModifier: 'Health',
    characterMana: 'Energy',
    characterManaModifier: 'Energy',
    characterDefensiveAbility: 'Defensive ability',
    characterOffensiveAbility: 'Offensive ability',
    characterOffensiveAbilityModifier: 'Offensive ability',
    conversionPercentage: 'Damage conversion',
    offensiveTotalDamageModifier: 'All damage',
    offensivePhysical: 'Physical damage',
    offensivePhysicalModifier: 'Physical damage',
    offensivePierce: 'Pierce damage',
    offensivePierceModifier: 'Pierce damage',
    offensiveFire: 'Fire damage',
    offensiveFireModifier: 'Fire damage',
    offensiveCold: 'Cold damage',
    offensiveColdModifier: 'Cold damage',
    offensiveLightning: 'Lightning damage',
    offensiveLightningModifier: 'Lightning damage',
    offensivePoison: 'Acid damage',
    offensivePoisonModifier: 'Acid damage',
    offensiveLife: 'Vitality damage',
    offensiveLifeModifier: 'Vitality damage',
    offensiveAether: 'Aether damage',
    offensiveAetherModifier: 'Aether damage',
    offensiveChaos: 'Chaos damage',
    offensiveChaosModifier: 'Chaos damage',
    offensiveElemental: 'Elemental damage',
    offensiveElementalModifier: 'Elemental damage',
    offensiveCritDamageModifier: 'Critical damage',
    offensiveLifeLeechMin: 'Attack damage converted to health',
    offensiveSlowPhysical: 'Internal trauma damage',
    offensiveSlowPhysicalModifier: 'Internal trauma damage',
    offensiveSlowBleeding: 'Bleeding damage',
    offensiveSlowBleedingModifier: 'Bleeding damage',
    offensiveSlowFire: 'Burn damage',
    offensiveSlowFireModifier: 'Burn damage',
    offensiveSlowCold: 'Frostburn damage',
    offensiveSlowColdModifier: 'Frostburn damage',
    offensiveSlowLightning: 'Electrocute damage',
    offensiveSlowLightningModifier: 'Electrocute damage',
    offensiveSlowPoison: 'Poison damage',
    offensiveSlowPoisonModifier: 'Poison damage',
    offensiveSlowLife: 'Vitality decay',
    offensiveSlowLifeModifier: 'Vitality decay',
    defensivePhysical: 'Physical resistance',
    defensivePierce: 'Pierce resistance',
    defensiveFire: 'Fire resistance',
    defensiveCold: 'Cold resistance',
    defensiveLightning: 'Lightning resistance',
    defensivePoison: 'Acid resistance',
    defensiveLife: 'Vitality resistance',
    defensiveAether: 'Aether resistance',
    defensiveChaos: 'Chaos resistance',
    defensiveBleeding: 'Bleeding resistance',
    defensiveElementalResistance: 'Elemental resistance'
  }
  return names[field] ?? field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (value) => value.toUpperCase())
}

function formatRollValue(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1)
}

function miMetricResult(copy: ObservedStashItem, metric: MiMetricKey): {
  value: number | null
  percentile: number | null
  display: string
} {
  const analysis = copy.rollAnalysis
  if (!analysis) return { value: null, percentile: null, display: '—' }
  const qualityValues: Record<'overall' | 'base' | 'prefix' | 'suffix', number | null> = {
    overall: analysis.overallEstimatedPercentile,
    base: analysis.baseEstimatedPercentile,
    prefix: analysis.prefixEstimatedPercentile,
    suffix: analysis.suffixEstimatedPercentile
  }
  if (metric === 'overall' || metric === 'base' || metric === 'prefix' || metric === 'suffix') {
    const value = qualityValues[metric]
    return { value, percentile: value, display: formatPercentile(value) }
  }
  const pet = metric.startsWith('pet:')
  const field = metric.slice(metric.indexOf(':') + 1)
  const stat = (pet ? analysis.petStats : analysis.stats)?.find((candidate) => candidate.field === field)
  if (!stat) return { value: null, percentile: null, display: '—' }
  return {
    value: stat.value,
    percentile: stat.estimatedPercentile,
    display: `${formatRollValue(stat.value)}${stat.estimatedPercentile === null ? '' : ` · ${stat.estimatedPercentile.toFixed(0)}%`}`
  }
}

function compareCopiesByMiMetric(
  left: ObservedStashItem,
  right: ObservedStashItem,
  metric: MiMetricKey,
  direction: SortDirection
): number {
  const leftMetric = miMetricResult(left, metric)
  const rightMetric = miMetricResult(right, metric)
  if (leftMetric.value === null && rightMetric.value !== null) return 1
  if (leftMetric.value !== null && rightMetric.value === null) return -1
  if (leftMetric.value !== null && rightMetric.value !== null && leftMetric.value !== rightMetric.value) {
    return direction === 'asc'
      ? leftMetric.value - rightMetric.value
      : rightMetric.value - leftMetric.value
  }
  return (
    (right.rollAnalysis?.overallEstimatedPercentile ?? -1) -
    (left.rollAnalysis?.overallEstimatedPercentile ?? -1)
  )
}

function presentationSearchText(presentation: ItemPresentation | undefined): string {
  return (presentation?.sections ?? [])
    .flatMap((section) => [
      section.heading ?? '',
      ...section.lines.map((line) => `${line.prefix} ${line.label} ${line.suffix}`)
    ])
    .join(' ')
}

function formatPercentile(value: number | null | undefined): string {
  return value == null ? '—' : `${value.toFixed(1)}%`
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
      <div class="brand-lockup">
        <nav class="history-nav" aria-label="View history">
          <button type="button" aria-label="Go back" title="Back (Alt+Left)" :disabled="!canNavigateBack" @click="navigateAppHistory('back')">←</button>
          <button type="button" aria-label="Go forward" title="Forward (Alt+Right)" :disabled="!canNavigateForward" @click="navigateAppHistory('forward')">→</button>
        </nav>
        <p class="eyebrow">Grim Dawn collection atlas</p>
        <h1>Cairn Codex</h1>
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
        <nav class="system-nav" aria-label="Cairn Codex system views">
          <button v-if="false" type="button" :aria-expanded="todoOpen" @click="openTodos">
            To-do <span v-if="remainingTodoCount" class="todo-nav-count">{{ remainingTodoCount }}</span>
          </button>
          <button type="button" :class="{ active: activeView === 'vault' }" @click="activeView = 'vault'">
            Transfers
          </button>
          <button type="button" :class="{ active: activeView === 'settings' }" @click="activeView = 'settings'">
            Settings
          </button>
        </nav>
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
        <h2 id="safe-mode-offer-title">Cairn has had trouble starting.</h2>
        <p id="safe-mode-offer-description">
          Cairn did not reach a healthy startup {{ failedStartupCount }} times in a row. Safe mode
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

    <div v-if="onboardingOpen && !appInitializing" class="onboarding-backdrop">
      <section
        ref="onboardingDialog"
        class="onboarding-dialog"
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-description"
      >
        <header class="onboarding-header">
          <div>
            <p class="section-label">First-run guide · {{ onboardingStepLabel }}</p>
            <h2 id="onboarding-title">Welcome to Cairn Codex</h2>
            <p id="onboarding-description">A four-part tour of discovery, your archive, safe transfers, and the tools worth knowing first.</p>
          </div>
          <button type="button" class="onboarding-skip" @click="skipOnboarding">Skip for now</button>
        </header>

        <ol class="onboarding-progress" aria-label="Onboarding progress">
          <li v-for="step in ONBOARDING_STEP_COUNT" :key="step" :class="{ active: onboardingStep === step - 1, done: onboardingStep > step - 1 }">
            <span>{{ step }}</span>
          </li>
        </ol>

        <div v-if="onboardingStep === 0" class="onboarding-page">
          <p class="section-label">Game discovery</p>
          <h3>First, make sure Cairn can see Grim Dawn.</h3>
          <p>Cairn automatically checks Steam, extra Steam libraries, GOG, local saves, and cloud saves. You never need to paste a game path into the app.</p>
          <div class="onboarding-discovery-grid">
            <article :class="{ ready: onboardingInstallCount > 0 }">
              <strong>{{ onboardingInstallCount }}</strong>
              <span>installation{{ onboardingInstallCount === 1 ? '' : 's' }} found</span>
            </article>
            <article :class="{ ready: onboardingSaveCount > 0 }">
              <strong>{{ onboardingSaveCount }}</strong>
              <span>save location{{ onboardingSaveCount === 1 ? '' : 's' }} found</span>
            </article>
          </div>
          <p v-if="onboardingInstallCount === 0" class="onboarding-callout warning">No installation is indexed yet. You can still use recovery and diagnostics; install or launch Grim Dawn, then use Settings → Rebuild game-data index.</p>
          <p v-else class="onboarding-callout">Discovery is ready. The first game-data index can take a few minutes; later cached starts are much faster.</p>
          <small>Physical-stash overrides are optional. Enable the Legacy Stash Scanner in Settings only when you deliberately want to choose individual SC/HC stash files.</small>
        </div>

        <div v-else-if="onboardingStep === 1" class="onboarding-page">
          <p class="section-label">Choose your starting point</p>
          <h3>Bring an archive—or start fresh.</h3>
          <div class="onboarding-choice-grid">
            <article>
              <span class="choice-number">01</span>
              <h4>Import Item Assistant</h4>
              <p>Select Item Assistant's <code>userdata.db</code>. Cairn analyzes it, verifies a backup, preserves SC/HC identity, and skips copies already imported.</p>
              <ItemAssistantImport compact :disabled="!snapshot" @completed="handleOnboardingImportCompleted" />
              <small>Close Item Assistant before starting. Its source database is never modified.</small>
            </article>
            <article>
              <span class="choice-number">02</span>
              <h4>Start empty</h4>
              <p>Begin with a clean Codex Archive. Items enter it only when you ingest them from Grim Dawn or use a verified offline transfer.</p>
              <button type="button" @click="chooseEmptyArchive">Start with an empty archive</button>
              <small>You can import Item Assistant later from Settings without creating duplicates.</small>
            </article>
          </div>
        </div>

        <div v-else-if="onboardingStep === 2" class="onboarding-page">
          <p class="section-label">The important mental model</p>
          <h3>Your collection is an archive, not a mirror.</h3>
          <div class="onboarding-concept-grid">
            <article><strong>Codex Archive</strong><p>Durably remembers ingested copies, rolls, affixes, and history even after an item returns to the game.</p></article>
            <article><strong>Live transfer</strong><p>Uses the watched stash tabs while Grim Dawn runs. Every operation is journaled and must receive a matching receipt.</p></article>
            <article><strong>Softcore / Hardcore</strong><p>Every copy keeps its mode. Cairn never mixes SC and HC in one retrieval, and archive scope can show either or both.</p></article>
            <article><strong>Offline staging</strong><p>When the game is closed, Cairn can perform the same verified workflow against a selected shared stash.</p></article>
          </div>
          <p class="onboarding-callout">If a transfer is interrupted, Cairn pauses later writes until the durable queue outcome is reconciled. Browsing, Settings, recovery, and diagnostics remain available.</p>
        </div>

        <div v-else class="onboarding-page">
          <p class="section-label">Safety and workspace</p>
          <h3>You are ready. Two details are worth remembering.</h3>
          <div class="onboarding-concept-grid final">
            <article><strong>Verified backups</strong><p>Cairn rotates archive snapshots automatically. Settings can create, export, restore, and open their folder.</p></article>
            <article><strong>Experimental tools</strong><p>Stash Oracle and Dismantling Lab are disabled for new profiles. Enable them in Settings when you want provisional recommendations or simulations.</p></article>
            <article><strong>Customize the workspace</strong><p>Collection always remains available; specialist tools can be hidden or restored without losing their data.</p></article>
            <article><strong>Get useful diagnostics</strong><p>Debug logging is opt-in and bounded. Exported support bundles redact paths, names, item payloads, saves, and credentials.</p></article>
          </div>
        </div>

        <footer class="onboarding-footer">
          <button type="button" class="secondary" @click="openOnboardingSettings">Recovery & diagnostics</button>
          <span />
          <button v-if="onboardingStep > 0" type="button" class="secondary" @click="setOnboardingStep(onboardingStep - 1)">Back</button>
          <button v-if="onboardingStep === 0 || onboardingStep === 2" type="button" @click="setOnboardingStep(onboardingStep + 1)">Continue</button>
          <button v-else-if="onboardingStep === ONBOARDING_STEP_COUNT - 1" type="button" @click="finishOnboarding">Finish tour</button>
        </footer>
      </section>
    </div>

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
            <p class="section-label">Cairn scratchpad</p>
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
      <section v-if="appInitializing || scanning || archiveRollHydrating" class="background-scan" aria-live="polite">
        <span class="scan-spinner" aria-hidden="true" />
        <div>
          <strong>{{ appInitializing && !snapshot ? 'Opening Cairn Codex' : archiveRollHydrating ? 'Rating archived item rolls' : scanActivity === 'game-data' ? 'Rebuilding the game-data index' : 'Refreshing collection in the background' }}</strong>
          <small v-if="appInitializing && !snapshot">Loading the cached archive, game index, and live connection state.</small>
          <small v-else-if="archiveRollHydrating">
            The Codex remains usable while missing copy scores are calculated and saved.
            <template v-if="archiveRollHydrationTotal > 0">
              {{ archiveRollHydrationCompleted.toLocaleString() }} / {{ archiveRollHydrationTotal.toLocaleString() }} complete.
            </template>
          </small>
          <small v-else-if="scanActivity === 'game-data'">Your cached Codex remains usable while map regions, drop sources, and game records are reindexed.</small>
          <small v-else>Your cached Codex is ready; stash counts and rolls are being rechecked.</small>
        </div>
      </section>
      <section v-if="activeView !== 'vault' && activeView !== 'settings'" class="hero">
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

      <section v-if="snapshot && activeView !== 'vault' && activeView !== 'settings'" class="completion-tracker" aria-label="Collection completion">
        <header>
          <div><p class="section-label">Collection progress</p><strong>{{ allItemSummary.collected }} / {{ allItemSummary.total }} tracked entries</strong></div>
          <button type="button" :aria-expanded="!trackerCollapsed" @click="toggleTracker">{{ trackerCollapsed ? 'Show trackers' : 'Hide trackers' }}</button>
        </header>
        <div v-if="!trackerCollapsed" class="metrics">
        <button
          type="button"
          :aria-pressed="activeView === 'collection' && rarityFilter === 'all'"
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
          :aria-pressed="activeView === 'collection' && rarityFilter === 'legendary'"
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
          :aria-pressed="activeView === 'collection' && rarityFilter === 'epic'"
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
          :aria-pressed="activeView === 'collection' && rarityFilter === 'mi'"
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
          :aria-pressed="activeView === 'mi-workshop'"
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
          :aria-pressed="activeView === 'sets'"
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
          :aria-pressed="activeView === 'materials' && materialCategory === 'component'"
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
          :aria-pressed="activeView === 'materials' && materialCategory !== 'component'"
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
          :aria-pressed="activeView === 'collection' && rarityFilter === 'recipe'"
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

      <section v-if="showLegacyScanner && activeView !== 'vault' && activeView !== 'settings'" class="collection-basis" aria-label="Collection persistence">
        <button
          type="button"
          :class="{ active: collectionBasis === 'archive' }"
          :aria-pressed="collectionBasis === 'archive'"
          @click="setCollectionBasis('archive')"
        >
          <strong>Codex Archive</strong>
          <small>Your durable Cairn collection. Counts copies stored by Cairn, even after they leave Grim Dawn.</small>
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
      <header v-if="snapshot && activeView !== 'vault' && activeView !== 'settings'" class="workspace-launcher-heading">
        <div><p class="section-label">Tools</p><small>Keep this workspace as focused—or as gloriously cluttered—as you like.</small></div>
        <button type="button" @click="toolSettingsOpen = true">Customize tools</button>
      </header>
      <nav v-if="snapshot && activeView !== 'vault' && activeView !== 'settings'" class="workspace-tabs" aria-label="Cairn Codex workspace">
        <button type="button" :class="{ active: activeView === 'collection' }" @click="activeView = 'collection'">
          <span>Collection</span><small>Items and copies</small>
        </button>
        <button v-if="workspaceToolVisible('sets')" type="button" :class="{ active: activeView === 'sets' }" @click="activeView = 'sets'">
          <span>Sets</span><small>{{ setSummary.collected }} / {{ setSummary.total }} complete</small>
        </button>
        <button v-if="workspaceToolVisible('materials')" type="button" :class="{ active: activeView === 'materials' }" @click="openMaterials()">
          <span>Components & Consumables</span><small>{{ componentSummary.collected + consumableSummary.collected }} discovered</small>
        </button>
        <button v-if="workspaceToolVisible('skills')" type="button" :class="{ active: activeView === 'skills' }" @click="activeView = 'skills'">
          <span>Skill Explorer</span><small>Browse item skill modifiers</small>
        </button>
        <button v-if="workspaceToolVisible('oracle')" type="button" :class="{ active: activeView === 'oracle' }" @click="openStashOracle">
          <span>Stash Oracle</span><small>Build ideas from your archive</small>
        </button>
        <button v-if="workspaceToolVisible('planner')" type="button" :class="{ active: activeView === 'planner' }" @click="activeView = 'planner'">
          <span>Leveling Planner</span><small>{{ plannerSkills.length }} skills · Lv{{ plannerMinimumLevel }}–{{ plannerLevelCap }}</small>
        </button>
        <button v-if="workspaceToolVisible('mi-workshop')" type="button" :class="{ active: activeView === 'mi-workshop' }" @click="activeView = 'mi-workshop'">
          <span>MI Workshop</span><small>Compare bases, affixes, and rolls</small>
        </button>
        <button v-if="workspaceToolVisible('supplies')" type="button" :class="{ active: activeView === 'supplies' }" @click="openSupplies">
          <span>Supplies</span><small>{{ reusableSupplySummary.collected }} / {{ reusableSupplySummary.total || '—' }} reusable unlocks</small>
        </button>
        <button v-if="workspaceToolVisible('farming')" type="button" :class="{ active: activeView === 'farming' }" @click="activeView = 'farming'">
          <span>Collection Farming</span><small>Ranked drop-source routes</small>
        </button>
        <button v-if="workspaceToolVisible('dismantling')" type="button" :class="{ active: activeView === 'dismantling' }" @click="activeView = 'dismantling'">
          <span>Dismantling Lab</span><small>Read-only Inventor simulator</small>
        </button>
        <button v-if="workspaceToolVisible('trivia')" type="button" :aria-expanded="triviaOpen" @click="openTrivia">
          <span>Collection Trivia</span><small>Archive records and curiosities</small>
        </button>
        <button v-if="workspaceToolVisible('todo')" type="button" :aria-expanded="todoOpen" @click="openTodos">
          <span>To-do</span><small>{{ remainingTodoCount }} remaining</small>
        </button>
      </nav>

      <nav v-if="snapshot && activeView === 'collection'" class="category-tabs" aria-label="Item categories">
        <button
          v-for="category in categories"
          :key="category"
          type="button"
          :class="{ active: category === activeCategory }"
          @click="activeCategory = category"
        >
          <span>{{ category }}</span>
          <small>{{ categoryProgress(category) }}</small>
        </button>
      </nav>

      <ExplorerToolbar
        v-if="snapshot && (activeView === 'collection' || activeView === 'sets' || activeView === 'materials')"
        class="collection-explorer-toolbar"
        v-model="query"
        v-bind="activeView === 'sets' ? searchGuidance.sets : activeView === 'materials' ? searchGuidance.materials : searchGuidance.collection"
        :search-label="activeView === 'sets' ? 'Search sets' : activeView === 'materials' ? 'Search components & consumables' : 'Search collection'"
        placeholder="Name, stat, skill… (try skill:wendigo)"
        :result-count="displayedResultCount"
        :result-label="activeView === 'sets' ? 'sets' : 'results'"
        :search-error="searchErrorMessage(activeView === 'sets' ? setSearchQuery : collectionSearchQuery)"
      >
        <template #filters>
          <label v-if="activeView === 'collection' || activeView === 'materials'">
            <span>Collection status</span>
            <select v-model="ownership" autocomplete="off">
              <option value="all">All items</option>
              <option value="owned">Collected</option>
              <option value="missing">Missing</option>
            </select>
          </label>
          <label v-if="activeView === 'sets'">
            <span>Set progress</span>
            <select v-model="setProgressFilter" autocomplete="off">
              <option value="all">All sets</option>
              <option value="complete">Complete</option>
              <option value="progress">In progress</option>
              <option value="unstarted">Unstarted</option>
            </select>
          </label>
          <label v-if="activeView === 'materials'">
            <span>Category</span>
            <select v-model="materialCategory" autocomplete="off">
              <option value="all">All materials</option>
              <option value="component">Components</option>
              <option value="material">Materials</option>
              <option value="potion-formula">Potion formulas</option>
            </select>
          </label>
          <label v-if="activeView === 'sets'">
            <span>Rarity</span>
            <select v-model="rarityFilter" autocomplete="off">
              <option value="all">All set rarities</option>
              <option value="legendary">Legendary sets</option>
              <option value="epic">Epic sets</option>
            </select>
          </label>
          <label v-else-if="activeView !== 'materials'">
            <span>Rarity</span>
            <select v-model="rarityFilter" autocomplete="off">
              <option value="all">All rarities</option>
              <option value="legendary">Legendary</option>
              <option value="epic">Epic</option>
              <option value="mi">Monster Infrequent</option>
              <option value="double-rare">Double rare MIs</option>
              <option value="rare">Rare items</option>
              <option value="recipe">Craftable from recipe</option>
            </select>
          </label>
          <label v-if="activeView === 'sets'">
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
            <select v-if="activeView === 'sets'" v-model="setSortMode" autocomplete="off">
              <option value="completion">Completion</option>
              <option value="level">Required level</option>
              <option value="name">Name</option>
            </select>
            <select v-else v-model="sortMode" autocomplete="off">
              <option value="recent">Recently collected</option>
              <option value="completion">Collected status</option>
              <option value="name">Name</option>
              <option value="level">Level</option>
              <option value="roll">Best roll</option>
            </select>
          </label>
          <label>
            <span>Order</span>
            <select v-if="activeView === 'sets'" v-model="setSortDirection" autocomplete="off">
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
            <select v-else v-model="sortDirection" autocomplete="off">
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
        </template>
      </ExplorerToolbar>

      <section v-if="activeView === 'skills'" class="skill-explorer" aria-label="Skill item explorer">
        <ToolHeader
          eyebrow="Build research prototype"
          title="Items for a skill"
          description="Choose a skill to compare direct rank bonuses, damage conversions, special modifiers, and level requirements."
        />
        <div class="skill-picker">
          <div class="skill-combobox" @focusout="handleSkillPickerFocusOut">
            <label for="skill-picker-input">Skill</label>
            <span class="skill-input-wrap">
              <input
                id="skill-picker-input"
                v-model="selectedSkill"
                type="text"
                role="combobox"
                autocomplete="off"
                aria-autocomplete="list"
                :aria-expanded="skillPickerOpen"
                aria-controls="skill-name-options"
                placeholder="Choose or type a skill…"
                @focus="openSkillPicker"
                @input="skillPickerOpen = true; skillPickerIndex = 0"
                @keydown="handleSkillPickerKey"
              />
              <button
                v-if="selectedSkill"
                type="button"
                aria-label="Clear selected skill"
                @click="selectedSkill = ''; openSkillPicker()"
              >
                ×
              </button>
            </span>
            <span
              v-if="skillPickerOpen"
              id="skill-name-options"
              class="skill-suggestions"
              role="listbox"
            >
              <button
                v-for="(skill, index) in skillSuggestions"
                :key="skill"
                type="button"
                role="option"
                :aria-selected="index === skillPickerIndex"
                :class="{ active: index === skillPickerIndex }"
                @mouseenter="skillPickerIndex = index"
                @click="selectSkill(skill)"
              >
                {{ skill }}
              </button>
              <small v-if="skillSuggestions.length === 0">No indexed skill matches that text.</small>
            </span>
          </div>
        </div>
        <ExplorerToolbar
          class="skill-explorer-toolbar"
          v-model="skillItemQuery"
          v-bind="searchGuidance.skillItems"
          search-label="Search matching items"
          placeholder="Item, slot, modifier, damage type…"
          :result-count="skillItemRows.length"
          result-label="matching items"
          :search-error="searchErrorMessage(skillItemsSearchQuery)"
        >
          <template #filters>
            <label>
              <span>Availability</span>
              <select v-model="skillScope" autocomplete="off">
                <option value="all">All catalog items</option>
                <option value="archive">My Archive</option>
              </select>
            </label>
            <label>
              <span>Rarity</span>
              <select v-model="skillRarityFilter" autocomplete="off">
                <option value="all">All rarities</option>
                <option value="legendary">Legendary</option>
                <option value="epic">Epic</option>
                <option value="mi">Monster Infrequent</option>
                <option value="rare">Rare</option>
              </select>
            </label>
            <label>
              <span>Slot</span>
              <select v-model="skillSlotFilter" autocomplete="off">
                <option value="all">All slots</option>
                <option v-for="slot in skillSlotOptions" :key="slot" :value="slot">{{ slot }}</option>
              </select>
            </label>
          </template>
          <template #sort>
            <label>
              <span>Sort by</span>
              <select v-model="skillSort" autocomplete="off">
                <option value="amount">Ranks & modifiers</option>
                <option value="item">Item name</option>
                <option value="slot">Slot</option>
                <option value="conversion">Conversion target</option>
                <option value="special">Special modifier</option>
                <option value="level">Required level</option>
              </select>
            </label>
            <label>
              <span>Order</span>
              <select v-model="skillSortDirection" autocomplete="off">
                <option value="desc">Highest first</option>
                <option value="asc">Lowest first</option>
              </select>
            </label>
          </template>
        </ExplorerToolbar>
        <div class="skill-table-wrap">
          <table class="skill-table">
            <thead>
              <tr>
                <th><button type="button" @click="setSkillSort('item')">Item {{ skillSort === 'item' ? (skillSortDirection === 'asc' ? '↑' : '↓') : '' }}</button></th>
                <th><button type="button" @click="setSkillSort('slot')">Slot <span v-if="skillSort === 'slot'">{{ skillSortDirection === 'asc' ? '↑' : '↓' }}</span></button></th>
                <th><button type="button" @click="setSkillSort('amount')">Ranks {{ skillSort === 'amount' ? (skillSortDirection === 'asc' ? '↑' : '↓') : '' }}</button></th>
                <th><button type="button" @click="setSkillSort('conversion')">Target {{ skillSort === 'conversion' ? (skillSortDirection === 'asc' ? '↑' : '↓') : '' }}</button></th>
                <th>Conversion details</th>
                <th><button type="button" @click="setSkillSort('special')">Special modifier <span v-if="skillSort === 'special'">{{ skillSortDirection === 'asc' ? '↑' : '↓' }}</span></button></th>
                <th><button type="button" @click="setSkillSort('level')">Level {{ skillSort === 'level' ? (skillSortDirection === 'asc' ? '↑' : '↓') : '' }}</button></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in skillItemRows"
                :key="row.item.record"
                role="button"
                tabindex="0"
                aria-describedby="item-tooltip"
                @mouseenter="queueTooltip(row.item, $event)"
                @mousemove="moveTooltip"
                @mouseleave="scheduleTooltipHide"
                @focus="queueTooltip(row.item, $event)"
                @blur="scheduleTooltipHide"
                @click="openItem(row.item)"
                @keydown.enter="openItem(row.item)"
              >
                <td>
                  <div class="skill-item-name">
                    <img v-if="itemIconUrl(row.item)" :src="itemIconUrl(row.item)!" alt="" />
                    <span>
                      <strong>{{ row.item.name }}</strong>
                      <small>{{ row.item.rarity }}<template v-if="plannerOwnershipLabel(row.item)"> · {{ plannerOwnershipLabel(row.item) }}</template></small>
                    </span>
                  </div>
                </td>
                <td>{{ row.item.slot }}</td>
                <td class="skill-amount">{{ row.amount > 0 ? `+${row.amount}` : '—' }}</td>
                <td class="skill-conversion-target">{{ row.conversionTarget || '—' }}</td>
                <td>{{ row.conversionDetails || '—' }}</td>
                <td>{{ row.special || '—' }}</td>
                <td>{{ row.item.levelRequirement }}</td>
              </tr>
              <tr v-if="skillItemRows.length === 0">
                <td colspan="7" class="skill-empty">
                  {{ skillItemQuery || skillRarityFilter !== 'all' || skillSlotFilter !== 'all'
                    ? 'No items match the current search and filters.'
                    : 'No matching items in this availability scope.' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-else-if="activeView === 'oracle'" class="stash-oracle" aria-label="Stash Oracle build recommendations">
        <ToolHeader
          eyebrow="Archetype assembler"
          title="What build is your stash trying to make you play?"
          description="Cairn follows the mechanical evidence: archived skill modifiers, conversions, set progress, high-level MIs, and the slots those items need. Every recommendation shows its work."
          tone="ember"
        />

        <ExplorerToolbar
          v-model="oracleQuery"
          v-bind="searchGuidance.oracle"
          class="oracle-explorer-toolbar"
          search-label="Search archetypes"
          placeholder="Skill, damage type, set, item…"
          :result-count="filteredOracleCandidates.length"
          result-label="build archetypes"
          :search-error="searchErrorMessage(oracleStructuredQuery)"
        >
          <template #filters>
            <label>
              <span>Class</span>
              <select v-model="oracleClass" autocomplete="off">
                <option value="all">Any class</option>
                <option v-for="className in oracleClassOptions" :key="className" :value="className">{{ className }}</option>
              </select>
            </label>
            <label>
              <span>Build style</span>
              <select v-model="oracleStyle" autocomplete="off">
                <option value="all">Any style</option>
                <option value="pets">Pets</option>
                <option value="caster">Caster</option>
                <option value="weapon">Weapon</option>
                <option value="retaliation">Retaliation</option>
              </select>
            </label>
            <label>
              <span>Readiness</span>
              <select v-model="oracleReadiness" autocomplete="off">
                <option value="all">All ({{ oracleCandidates.length }})</option>
                <option value="ready">Ready now ({{ oracleReadinessCounts.ready }})</option>
                <option value="near">Nearly there ({{ oracleReadinessCounts.near }})</option>
                <option value="wildcard">Wild cards ({{ oracleReadinessCounts.wildcard }})</option>
              </select>
            </label>
            <label class="explorer-range-control">
              <span>Item level</span>
              <span>
                <input v-model.number="oracleMinimumLevel" type="number" min="1" :max="oracleMaximumLevel" aria-label="Minimum item level" />
                <b>to</b>
                <input v-model.number="oracleMaximumLevel" type="number" :min="oracleMinimumLevel" max="100" aria-label="Maximum item level" />
              </span>
            </label>
          </template>
          <template #sort>
            <label>
              <span>Sort by</span>
              <select v-model="oracleSortMode" autocomplete="off">
                <option value="score">Stash fit</option>
                <option value="readiness">Readiness</option>
                <option value="name">Build name</option>
                <option value="class">Class</option>
              </select>
            </label>
            <label>
              <span>Order</span>
              <select v-model="oracleSortDirection" autocomplete="off">
                <option value="desc">Highest first</option>
                <option value="asc">Lowest first</option>
              </select>
            </label>
          </template>
          <template #actions>
            <button type="button" @click="surpriseMeWithOracle">Surprise me</button>
          </template>
        </ExplorerToolbar>
        <p class="explorer-context-note">Scores measure archived mechanical support and equipability—not whether a build is fashionable.</p>

        <div v-if="visibleOracleCandidates.length" class="oracle-grid">
          <article
            v-for="candidate in visibleOracleCandidates"
            :key="candidate.key"
            class="oracle-card"
            :class="`readiness-${candidate.readiness}`"
          >
            <header>
              <div>
                <span class="oracle-readiness">{{ oracleReadinessLabel(candidate.readiness) }}</span>
                <h3>{{ candidate.title }}</h3>
                <p>
                  <span>{{ oracleStyleLabel(candidate.style) }}</span>
                  <span :title="candidate.masteries.join(' + ')">{{ candidate.className }}</span>
                </p>
              </div>
              <div class="oracle-score" :title="candidate.summary"><strong>{{ candidate.score }}</strong><small>stash fit</small></div>
            </header>
            <p class="oracle-summary">{{ candidate.summary }}</p>

            <div v-if="candidate.sets.length" class="oracle-set-progress">
              <button
                v-for="set in candidate.sets"
                :key="set.name"
                type="button"
                :class="{ complete: set.owned === set.total }"
                :title="`Open ${set.name} and inspect every set bonus`"
                @click="openOracleSet(set.name)"
              >
                <strong>{{ set.name }}</strong>
                <small>{{ set.owned }}/{{ set.total }}<template v-if="!set.capstoneUnlocked"> · capstone {{ set.capstonePieces }}</template></small>
              </button>
            </div>

            <div class="oracle-evidence">
              <p><span>Strongest evidence</span><small>{{ candidate.ownedCore }}/{{ candidate.coreSize }} core signals archived</small></p>
              <div>
                <button
                  v-for="evidence in candidate.evidence.slice(0, 7)"
                  :key="evidence.item.record"
                  type="button"
                  :class="{ owned: evidence.owned, missing: !evidence.owned }"
                  :title="evidence.reasons.join(' · ')"
                  @mouseenter="queueTooltip(evidence.item, $event)"
                  @mousemove="moveTooltip"
                  @mouseleave="scheduleTooltipHide"
                  @focus="queueTooltip(evidence.item, $event)"
                  @blur="scheduleTooltipHide"
                  @click="openItem(evidence.item)"
                >
                  <img v-if="itemIconUrl(evidence.item)" :src="itemIconUrl(evidence.item)!" alt="" />
                    <span><strong>{{ evidence.item.name }}</strong><small>{{ evidence.owned ? (plannerOwnershipLabel(evidence.item) ?? 'Archived') : 'Missing' }} · {{ evidence.reasons.slice(0, 2).join(' · ') }}</small></span>
                </button>
              </div>
            </div>

            <div v-if="candidate.conflicts.length" class="oracle-conflicts">
              <strong>Choices required</strong>
              <span v-for="conflict in candidate.conflicts" :key="conflict">{{ conflict }}</span>
            </div>
            <div v-if="candidate.relatedSkills.length" class="oracle-related">
              <small>Also supported</small><span v-for="skill in candidate.relatedSkills" :key="skill">{{ skill }}</span>
            </div>
            <footer>
              <button type="button" @click="sendOracleCandidateToPlanner(candidate)">Build a shopping list</button>
              <button type="button" @click="selectedSkill = candidate.skill; activeView = 'skills'">Inspect {{ candidate.skill }}</button>
            </footer>
          </article>
        </div>
        <div v-else class="oracle-empty">
          <strong>The Oracle found no coherent signal with these filters.</strong>
          <p>Try a lower item-level floor, another mastery, or “Surprise me.” One archived supporting item is enough to seed a wild card.</p>
          <button type="button" @click="surpriseMeWithOracle">Clear filters</button>
        </div>
        <button
          v-if="filteredOracleCandidates.length > visibleOracleCandidates.length"
          type="button"
          class="oracle-more"
          @click="oracleVisibleCount += 12"
        >Show 12 more</button>
      </section>

      <section v-else-if="activeView === 'planner'" class="leveling-planner" aria-label="Character leveling shopping list">
        <ToolHeader
          eyebrow="Character shopping list"
          title="Leveling Planner"
          description="Pick the skills your character actually uses. Cairn merges their supporting MIs, Epics, Legendaries, and faction gear into one leveling route."
          tone="blue"
        >
          <template #aside>
            <div class="segmented-control planner-display" aria-label="Planner display">
              <button type="button" :class="{ active: plannerDisplay === 'list' }" @click="plannerDisplay = 'list'">Table</button>
              <button type="button" :class="{ active: plannerDisplay === 'grid' }" @click="plannerDisplay = 'grid'">Cards</button>
              <button type="button" :class="{ active: plannerDisplay === 'map' }" @click="plannerDisplay = 'map'">MI sources</button>
            </div>
          </template>
        </ToolHeader>

        <div class="planner-controls">
          <div class="planner-profile-control">
            <label for="planner-profile-select">Saved character / build</label>
            <span>
              <select
                id="planner-profile-select"
                :value="selectedPlannerProfileId"
                @change="selectPlannerProfile(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="profile in plannerProfiles" :key="profile.id" :value="profile.id">
                  {{ profile.name }}{{ profile.source === 'character' ? ' · imported' : '' }}
                </option>
              </select>
              <button type="button" :disabled="plannerProfiles.length <= 1" title="Delete this build" @click="deletePlannerProfile">Delete</button>
            </span>
            <span class="planner-profile-create">
              <input v-model="plannerProfileDraft" type="text" maxlength="60" placeholder="Save current skills as…" @keydown.enter.prevent="createPlannerProfile" />
              <button type="button" :disabled="!plannerProfileDraft.trim()" @click="createPlannerProfile">Save as</button>
            </span>
            <button type="button" class="planner-character-import-button" @click="loadCharacterProfiles">
              Import / refresh character saves
            </button>
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
              <input v-model.number="plannerMinimumLevelDraft" type="range" min="1" :max="plannerLevelCapDraft" step="1" @change="commitPlannerMinimumLevel" />
              <input v-model.number="plannerMinimumLevelDraft" type="number" min="1" :max="plannerLevelCapDraft" @change="commitPlannerMinimumLevel" @keydown.enter.prevent="commitPlannerMinimumLevel" />
            </label>
            <label class="planner-level-control">
              <span>Level cap</span>
              <input v-model.number="plannerLevelCapDraft" type="range" :min="plannerMinimumLevelDraft" max="100" step="1" @change="commitPlannerLevelCap" />
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
          <section v-if="characterImportOpen" class="planner-character-import">
            <header>
              <span><strong>Character saves</strong><small>Read-only import. Existing profiles refresh without losing excluded skills.</small></span>
              <button type="button" aria-label="Close character importer" @click="characterImportOpen = false">×</button>
            </header>
            <p v-if="characterImportLoading">Reading and validating local and Steam Cloud saves…</p>
            <p v-else-if="characterImportError" class="planner-character-error">{{ characterImportError }}</p>
            <div v-else class="planner-character-list">
              <button
                v-for="character in discoveredCharacters"
                :key="character.path"
                type="button"
                :disabled="Boolean(character.error)"
                :title="character.error ?? character.path"
                @click="importCharacterProfile(character)"
              >
                <span><strong>{{ character.name }}</strong><small>{{ character.isHardcore ? 'HC' : 'SC' }} · Lv{{ character.level }} · {{ character.skills.length }} allocated skill records</small></span>
                <b v-if="character.error">Unreadable</b><b v-else>Import</b>
              </button>
              <p v-if="discoveredCharacters.length === 0">No character saves were found.</p>
            </div>
          </section>
        </div>

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
          <div v-if="plannerDisplay === 'list'" class="planner-table-wrap">
            <table class="planner-table">
              <thead>
                <tr><th>Level</th><th>Item</th><th>Supports</th><th>What it does</th><th>How to get it</th></tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in plannerRows"
                  :key="row.item.record"
                  :class="{ favorite: isPlannerFavorite(row.item), ignored: plannerShowIgnored }"
                  tabindex="0"
                  @mouseenter="queueTooltip(row.item, $event)"
                  @mousemove="moveTooltip"
                  @mouseleave="scheduleTooltipHide"
                  @focus="queueTooltip(row.item, $event)"
                  @blur="scheduleTooltipHide"
                  @click="openItem(row.item)"
                  @keydown.enter="openItem(row.item)"
                >
                  <td class="planner-level">{{ row.item.levelRequirement }}</td>
                  <td>
                    <span class="planner-item-cell">
                      <img v-if="itemIconUrl(row.item)" :src="itemIconUrl(row.item)!" alt="" />
                      <span>
                        <strong :class="`rarity-${row.item.rarity}`">{{ row.item.name }}</strong>
                        <small class="planner-item-type">{{ rarityLabel(row.item) }} · {{ itemTypeLabel(row.item) }}<span v-if="plannerOwnershipLabel(row.item)" class="archive-mark"> · {{ plannerOwnershipLabel(row.item) }}</span></small>
                        <span class="planner-item-actions">
                          <button type="button" :class="{ active: isPlannerFavorite(row.item) }" :aria-label="`${isPlannerFavorite(row.item) ? 'Unfavorite' : 'Favorite'} ${row.item.name}`" @click.stop="togglePlannerFavorite(row.item)">★</button>
                          <button type="button" @click.stop="togglePlannerIgnored(row.item)">{{ plannerShowIgnored ? 'Restore' : 'Ignore base' }}</button>
                        </span>
                        <small>{{ row.item.rarity === 'faction' ? 'Faction rare' : row.item.rarity }} · {{ row.item.slot }}</small>
                      </span>
                    </span>
                  </td>
                  <td>
                    <span class="planner-match-skills">
                      <em v-for="match in row.matches" :key="match.skill">{{ match.skill }}<b v-if="match.amount"> +{{ match.amount }}</b></em>
                    </span>
                  </td>
                  <td class="planner-effects">
                    <span v-if="row.petBonuses.length" class="planner-pet-bonuses">
                      <b>All pets</b> {{ row.petBonuses.join('; ') }}
                    </span>
                    <span v-for="match in row.matches" :key="`${match.skill}:effect`">
                      <b v-if="match.conversionTarget">→ {{ match.conversionTarget }}</b>
                      {{ [match.conversionDetails, match.special].filter(Boolean).join('; ') || (match.amount ? `+${match.amount} ranks` : 'Skill support') }}
                    </span>
                  </td>
                  <td class="planner-acquisition">
                    <span
                      v-if="recipeStatus(row.item)"
                      class="recipe-status"
                      :class="{ known: recipeStatus(row.item)?.known, missing: recipeStatus(row.item)?.known === false }"
                    >
                      <b>Blueprint</b> · {{ recipeStatus(row.item)?.label }}
                    </span>
                    <span v-for="faction in row.item.acquisition?.factions ?? []" :key="faction.vendorRecord">
                      <b>{{ faction.faction }}</b> · {{ faction.reputation }}
                    </span>
                    <span v-if="!(row.item.acquisition?.factions?.length)">{{ row.item.acquisition?.sources[0] ?? 'Random drop' }}</span>
                    <small v-if="row.item.acquisition?.locations?.length">{{ row.item.acquisition.locations.map(locationDisplayName).slice(0, 2).join(', ') }}</small>
                  </td>
                </tr>
                <tr v-if="plannerRows.length === 0"><td colspan="5" class="skill-empty">Select at least one skill, or widen the item level range, to build a shopping list.</td></tr>
              </tbody>
            </table>
          </div>
          <div v-else class="planner-card-grid">
            <article
              v-for="row in plannerRows"
              :key="row.item.record"
              class="planner-card"
              :class="[{ favorite: isPlannerFavorite(row.item), ignored: plannerShowIgnored }, `rarity-${row.item.rarity}`]"
              tabindex="0"
              @mouseenter="queueTooltip(row.item, $event)"
              @mousemove="moveTooltip"
              @mouseleave="scheduleTooltipHide"
              @focus="queueTooltip(row.item, $event)"
              @blur="scheduleTooltipHide"
              @click="openItem(row.item)"
              @keydown.enter="openItem(row.item)"
            >
              <header>
                <span class="planner-card-level">Lv{{ row.item.levelRequirement }}</span>
                <span class="planner-card-actions">
                  <button type="button" :class="{ active: isPlannerFavorite(row.item) }" :aria-label="`${isPlannerFavorite(row.item) ? 'Unfavorite' : 'Favorite'} ${row.item.name}`" @click.stop="togglePlannerFavorite(row.item)">★</button>
                  <button type="button" @click.stop="togglePlannerIgnored(row.item)">{{ plannerShowIgnored ? 'Restore' : 'Ignore' }}</button>
                </span>
              </header>
              <img v-if="itemIconUrl(row.item)" :src="itemIconUrl(row.item)!" alt="" />
              <div class="planner-card-title">
                <strong>{{ row.item.name }}</strong>
                <small>{{ rarityLabel(row.item) }} · {{ itemTypeLabel(row.item) }}<span v-if="plannerOwnershipLabel(row.item)" class="archive-mark"> · {{ plannerOwnershipLabel(row.item) }}</span></small>
              </div>
              <div class="planner-match-skills">
                <em v-for="match in row.matches" :key="match.skill">{{ match.skill }}<b v-if="match.amount"> +{{ match.amount }}</b></em>
              </div>
              <p v-if="row.petBonuses.length" class="planner-card-pets"><b>All pets</b> {{ row.petBonuses.join('; ') }}</p>
              <p class="planner-card-effect">
                {{ row.matches.map((match) => [match.conversionDetails, match.special].filter(Boolean).join('; ') || (match.amount ? `+${match.amount} ranks` : 'Skill support')).join(' · ') }}
              </p>
              <footer>
                <b v-if="recipeStatus(row.item)" class="recipe-status" :class="{ known: recipeStatus(row.item)?.known, missing: recipeStatus(row.item)?.known === false }">
                  {{ recipeStatus(row.item)?.label }}
                </b>
                <span>{{ row.item.acquisition?.factions?.[0]?.faction ?? row.item.acquisition?.sources[0] ?? 'Random drop' }}</span>
              </footer>
            </article>
            <p v-if="plannerRows.length === 0" class="skill-empty planner-card-empty">Select at least one skill, or restore an ignored base, to build a shopping list.</p>
          </div>
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
                  <img v-if="itemIconUrl(item)" :src="itemIconUrl(item)!" alt="" />
                  <span>
                    <strong>{{ item.name }}</strong>
                    <small>Lv{{ item.levelRequirement }} · {{ itemTypeLabel(item) }}</small>
                    <small>{{ item.acquisition?.sources[0] }}</small>
                  </span>
                </button>
              </div>
              <p v-else class="skill-empty">No indexed MIs match this area filter.</p>
            </section>
          </div>
        </template>
      </section>

      <section v-else-if="activeView === 'mi-workshop'" class="mi-workshop" aria-label="Monster Infrequent workshop">
        <ToolHeader
          eyebrow="Monster Infrequent research"
          title="MI Workshop"
          description="Physical copies retain their exact level tier here regardless of the completion-counting preference. Affix combinations are grouped below, with the strongest rolled copy leading each group."
          tone="green"
        >
          <template #aside>
            <label class="reserve-toggle">
              <input v-model="showMiReserves" type="checkbox" />
              Show archived copies
            </label>
          </template>
        </ToolHeader>
        <div class="mi-workshop-summary">
          <span><strong>{{ rarity('mi')?.collected ?? 0 }}</strong> {{ miCountingMode === 'base' ? 'MI bases collected' : 'MI tiers collected' }}</span>
          <span><strong>{{ snapshot?.affixSummary.collected ?? 0 }}</strong> affixes discovered</span>
          <span><strong>{{ miWorkshopRows.length }}</strong> combinations retained</span>
        </div>
        <ExplorerToolbar
          class="mi-explorer-toolbar"
          v-model="miWorkshopQuery"
          v-bind="searchGuidance.miWorkshop"
          search-label="Search workshop"
          placeholder="Base, affix, stat, skill…"
          :result-count="miWorkshopRows.length"
          result-label="affix combinations"
          tone="green"
          :search-error="searchErrorMessage(miStructuredQuery)"
        >
          <template #filters>
            <label>
              <span>Affix quality</span>
              <select ref="miAffixFilterSelect" v-model="miAffixFilter" autocomplete="off">
                <option value="all">All combinations</option>
                <option value="double-rare">Double rares only</option>
              </select>
            </label>
            <label>
              <span>Compare copies by</span>
              <select ref="miComparisonMetricSelect" v-model="miComparisonMetric" autocomplete="off">
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
          </template>
          <template #sort>
            <label>
              <span>Sort by</span>
              <select ref="miSortModeSelect" v-model="miSortMode" autocomplete="off">
                <option value="metric">Selected comparison</option>
                <option value="level">Required level</option>
                <option value="name">MI name</option>
                <option value="copies">Stored copies</option>
              </select>
            </label>
            <label>
              <span>Order</span>
              <select ref="miComparisonDirectionSelect" v-model="miComparisonDirection" autocomplete="off">
                <option value="desc">Highest first</option>
                <option value="asc">Lowest first</option>
              </select>
            </label>
          </template>
        </ExplorerToolbar>
        <div class="mi-table-wrap">
          <table class="mi-table">
            <thead>
              <tr>
                <th>MI base</th>
                <th>Level</th>
                <th>Prefix</th>
                <th>Suffix</th>
                <th>{{ selectedMiMetricLabel }}</th>
                <th>Stored</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in miWorkshopRows"
                :key="row.key"
                role="button"
                tabindex="0"
                aria-describedby="item-tooltip"
                @mouseenter="queueTooltip(row.base, $event, row.leader)"
                @mousemove="moveTooltip"
                @mouseleave="scheduleTooltipHide"
                @focus="queueTooltip(row.base, $event, row.leader)"
                @blur="scheduleTooltipHide"
                @click="openItem(row.base)"
                @keydown.enter="openItem(row.base)"
              >
                <td>
                  <span class="mi-base-cell">
                    <img v-if="itemIconUrl(row.base)" :src="itemIconUrl(row.base)!" alt="" />
                    <strong>{{ row.base.name }}</strong>
                  </span>
                </td>
                <td>{{ row.base.levelRequirement }}</td>
                <td :class="['affix-name', row.prefixRarity]">{{ row.prefix }}</td>
                <td :class="['affix-name', row.suffixRarity]">{{ row.suffix }}</td>
                <td class="mi-score-breakdown">
                  <span class="mi-selected-score"><small>Selected</small><strong>{{ row.selectedMetric.display }}</strong></span>
                  <span><small>Overall</small><strong>{{ formatPercentile(row.leader.rollAnalysis?.overallEstimatedPercentile) }}</strong></span>
                  <span><small>Base</small><strong>{{ formatPercentile(row.leader.rollAnalysis?.baseEstimatedPercentile) }}</strong></span>
                  <span><small>Prefix</small><strong>{{ formatPercentile(row.leader.rollAnalysis?.prefixEstimatedPercentile) }}</strong></span>
                  <span><small>Suffix</small><strong>{{ formatPercentile(row.leader.rollAnalysis?.suffixEstimatedPercentile) }}</strong></span>
                </td>
                <td>
                  <strong>{{ row.copies.length }}</strong>
                  <small v-if="row.copies.length > 1">1 leader · {{ row.copies.length - 1 }} archived</small>
                  <span v-if="showMiReserves && row.copies.length > 1" class="reserve-scores">
                    {{ row.copies.slice(1).map((copy) => miMetricResult(copy, miComparisonMetric).display).join(' · ') }}
                  </span>
                </td>
              </tr>
              <tr v-if="miWorkshopRows.length === 0">
                <td colspan="6" class="skill-empty">{{ miWorkshopQuery ? `No stored MI matches “${miWorkshopQuery}”.` : miAffixFilter === 'double-rare' ? 'No stored MI has both a rare prefix and a rare suffix.' : 'Archive a Monster Infrequent to start building the Workshop.' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-else-if="activeView === 'supplies'" class="supplies-workspace" aria-label="Reusable supplies">
        <ToolHeader
          eyebrow="Reusable collection"
          title="Supplies"
          description="Archived faction boosts, difficulty merits, Nemesis warrants, and runes are reusable. Soulbound augments unlock per character from that character's faction reputation."
        >
          <template #aside>
            <div class="tool-heading-summary">
              <strong>{{ reusableSupplySummary.collected }} / {{ reusableSupplySummary.total || '—' }} reusable unlocks</strong>
              <small>{{ supplyAccessSummary }}</small>
            </div>
          </template>
        </ToolHeader>
        <ExplorerToolbar
          v-model="reusableSupplyQuery"
          v-bind="searchGuidance.supplies"
          search-label="Search supplies"
          placeholder="Name, effect, faction…"
          :result-count="supplyVaultItems.length"
          result-label="available supplies"
          :search-error="searchErrorMessage(supplyStructuredQuery)"
        >
          <template #filters>
            <label>
              <span>Category</span>
              <select v-model="supplyCategory" autocomplete="off">
                <option value="writs">Boosts, merits & consumables</option>
                <option value="augments">Augments & runes</option>
              </select>
            </label>
            <label v-if="supplyCategory === 'augments'">
              <span>Compatible slot</span>
              <select v-model="supplySlotFilter" autocomplete="off">
                <option value="all">All slots</option>
                <option value="weapon">Weapons</option>
                <option value="armor">Armor</option>
                <option value="jewelry">Jewelry</option>
              </select>
            </label>
          </template>
          <template #actions>
            <button type="button" :disabled="!visibleSupplyVaultItems.length" @click="selectAllVisibleSupplies">Select visible</button>
            <button v-if="supplyCategory === 'writs'" type="button" :disabled="vaultBusy || !supplyVaultItems.length" @click="dispenseAllWrits">Dispense all unlocked boosts</button>
          </template>
        </ExplorerToolbar>
        <div class="supply-status">
          <span :class="'state-' + connectionColorState">{{ transferMode === 'live' ? gameConnectionLabel : writeSafety?.permitted ? 'Offline staging ready' : 'Offline staging locked' }}</span>
          <div class="segmented-control" aria-label="Supply transfer method">
            <button type="button" :class="{ active: transferMode === 'live' }" @click="transferMode = 'live'">Live</button>
            <button type="button" :class="{ active: transferMode === 'offline' }" @click="transferMode = 'offline'">Offline</button>
          </div>
        </div>
        <div v-if="supplyVaultItems.length" class="supply-grid">
          <label
            v-for="item in visibleSupplyVaultItems"
            :key="item.id"
            class="supply-card"
            :class="{ locked: !item.eligible }"
            :title="item.catalogItem ? 'Hover for the full in-game tooltip' : undefined"
            @mouseenter="queueSupplyTooltip(item, $event)"
            @mousemove="moveTooltip"
            @mouseleave="scheduleTooltipHide"
            @focusin="queueSupplyTooltip(item, $event)"
            @focusout="scheduleTooltipHide"
          >
            <input type="checkbox" :checked="selectedSupplyIds.includes(item.id)" :disabled="vaultBusy || !item.eligible" @change="toggleSupply(item.id)" />
            <span class="supply-icon">
              <img v-if="item.catalogItem && itemIconUrl(item.catalogItem)" :src="itemIconUrl(item.catalogItem)!" alt="" />
            </span>
            <span class="supply-card-copy">
              <strong>{{ item.name }}</strong>
              <small>{{ item.detail }}</small>
              <ul v-if="item.effects.length" class="supply-effects">
                <li v-for="(effect, index) in item.effects" :key="`${item.record}:${index}`">{{ effect }}</li>
                <li v-if="item.effectCount > item.effects.length" class="more">+{{ item.effectCount - item.effects.length }} more in tooltip</li>
              </ul>
              <small v-else class="supply-no-effects">No visible stat effect is indexed.</small>
            </span>
            <b>{{ item.reusable ? '∞' : item.stackCount }}</b>
          </label>
        </div>
        <button
          v-if="visibleSupplyVaultItems.length < supplyVaultItems.length"
          class="supply-show-more"
          type="button"
          @click="supplyVisibleCount += 60"
        >Show 60 more · {{ supplyVaultItems.length - visibleSupplyVaultItems.length }} remaining</button>
        <p v-if="supplyVaultItems.length === 0" class="vault-empty">{{ reusableSupplyQuery ? 'No unlocked supplies match this filter.' : 'No supplies unlocked in this category yet.' }}</p>
        <button
          class="supply-dispense"
          type="button"
          :disabled="vaultBusy || selectedSupplyIds.length === 0 || (supplyCategory === 'augments' && selectedSupplyIds.some((id) => id.startsWith('augment:')) ? liveStatus?.state !== 'ready' : transferMode === 'live' ? liveStatus?.state !== 'ready' : !writeSafety?.permitted || staging?.itemCount !== 0)"
          @click="retrieveSupplies"
        >{{ vaultBusy ? 'Verifying…' : (infiniteSupplies ? 'Dispense ' : 'Return ') + selectedSupplyIds.length + ' selected' }}</button>
      </section>

      <section v-else-if="activeView === 'dismantling'" class="dismantling-workspace" aria-label="Read-only dismantling simulator">
        <ToolHeader
          eyebrow="Inventor research · read only"
          title="Dismantling Lab"
          description="Select exact archived copies and preview what Grim Dawn's installed dismantling tables can produce. Nothing here changes the archive, game, Iron, Dynamite, components, or materials."
        >
          <template #aside><span class="read-only-seal">No write path</span></template>
        </ToolHeader>

        <div class="dismantling-resource-gaps">
          <article>
            <small>Iron Bits</small><strong>Balance not indexed</strong>
            <p>Cairn can calculate the exact fee, but does not yet read or debit character money.</p>
          </article>
          <article>
            <small>Dynamite</small><strong>Balance not indexed</strong>
            <p>Account materials live outside the transfer tabs Cairn currently owns.</p>
          </article>
          <article>
            <small>Material store</small><strong>Untouched</strong>
            <p>Expected rewards are simulated only; the component/material stash remains read-only.</p>
          </article>
        </div>

        <ExplorerToolbar
          v-model="dismantlingQuery"
          v-bind="searchGuidance.dismantling"
          search-label="Search candidates"
          placeholder="Item, base, prefix, suffix…"
          :result-count="filteredDismantlingCandidates.length"
          result-label="candidate copies"
          :search-error="searchErrorMessage(dismantlingStructuredQuery)"
        >
          <template #filters>
            <label>
              <span>Game mode</span>
              <select v-model="dismantlingMode" autocomplete="off">
                <option value="all">Hardcore + Softcore</option>
                <option value="hardcore">Hardcore</option>
                <option value="softcore">Softcore</option>
              </select>
            </label>
            <label>
              <span>Rarity</span>
              <select v-model="dismantlingRarity" autocomplete="off">
                <option value="all">All eligible rarities</option>
                <option value="legendary">Legendary</option>
                <option value="epic">Epic</option>
                <option value="mi">Monster Infrequent</option>
                <option value="rare">Rare</option>
              </select>
            </label>
          </template>
          <template #actions>
            <button type="button" @click="selectVisibleDismantlingCandidates">Select visible</button>
            <button type="button" title="Keeps the highest-scored or newest copy of each base; skips socketed and augmented extras." @click="selectRedundantDismantlingCandidates">Select safe duplicates</button>
            <button type="button" :disabled="selectedDismantlingIds.length === 0" @click="selectedDismantlingIds = []">Clear</button>
          </template>
        </ExplorerToolbar>

        <div class="dismantling-layout">
          <section class="dismantling-candidates">
            <header>
              <div><p class="section-label">Codex Archive</p><h3>Candidate copies</h3></div>
              <strong>{{ selectedDismantlingIds.length.toLocaleString() }} selected</strong>
            </header>
            <p class="dismantling-help">
              “Safe duplicates” preserves one best-scored copy per base and game mode, then excludes extras carrying a component or augment.
            </p>
            <div class="dismantling-list">
              <label v-for="item in visibleDismantlingCandidates" :key="item.id" :class="['dismantling-row', item.rarity, { attached: item.componentRecord || item.augmentRecord }]">
                <input type="checkbox" :checked="selectedDismantlingIds.includes(item.id)" @change="toggleDismantlingCandidate(item.id)" />
                <div>
                  <strong>{{ item.name }}</strong>
                  <small>{{ item.isHardcore ? 'HC' : 'SC' }} · {{ item.rarity === 'mi' ? 'Monster Infrequent' : item.rarity }} · Lv{{ item.itemLevel }} · Seed {{ item.seed }}</small>
                  <em v-if="item.componentRecord || item.augmentRecord">
                    {{ [item.componentRecord && 'component', item.augmentRecord && 'augment'].filter(Boolean).join(' + ') }} attached
                  </em>
                </div>
                <span>{{ formatPercentile(item.rollAnalysis?.overallEstimatedPercentile) }}</span>
              </label>
            </div>
            <button v-if="visibleDismantlingCandidates.length < filteredDismantlingCandidates.length" class="dismantling-more" type="button" @click="dismantlingVisibleCount += 120">
              Show 120 more · {{ (filteredDismantlingCandidates.length - visibleDismantlingCandidates.length).toLocaleString() }} remaining
            </button>
            <p v-if="filteredDismantlingCandidates.length === 0" class="vault-empty">No archived copies match these filters.</p>
          </section>

          <aside class="dismantling-preview">
            <header>
              <div><p class="section-label">Probability model</p><h3>Inventor preview</h3></div>
              <small v-if="dismantlingPreview">Rules: {{ dismantlingPreview.contentPack.toUpperCase() }}</small>
            </header>
            <p v-if="selectedDismantlingAttachments" class="dismantling-warning">{{ selectedDismantlingAttachments }} selected {{ selectedDismantlingAttachments === 1 ? 'copy has' : 'copies have' }} a component or augment. A future destructive workflow must make their fate explicit.</p>
            <button class="dismantling-run" type="button" :disabled="dismantlingBusy || selectedDismantlingIds.length === 0" @click="buildDismantlingPreview">
              {{ dismantlingBusy ? 'Reading installed loot tables…' : `Preview ${selectedDismantlingIds.length.toLocaleString()} selected` }}
            </button>
            <p v-if="dismantlingError" class="vault-notice error">{{ dismantlingError }}</p>
            <template v-if="dismantlingPreview">
              <div class="dismantling-costs">
                <article><small>Iron fee</small><strong>{{ dismantlingPreview.ironCost.toLocaleString() }}</strong></article>
                <article><small>Dynamite</small><strong>{{ dismantlingPreview.dynamiteCost.toLocaleString() }}</strong></article>
                <article><small>Scrap</small><strong>{{ dismantlingPreview.scrapExpected.toFixed(1) }} expected</strong><span>{{ dismantlingPreview.scrapMinimum }}–{{ dismantlingPreview.scrapMaximum }} possible</span></article>
              </div>
              <section class="scrap-distribution">
                <h4>Scrap per item</h4>
                <div><span v-for="outcome in dismantlingPreview.scrapOutcomes" :key="outcome.count"><b>{{ outcome.count }}</b><small>{{ (outcome.probability * 100).toFixed(0) }}%</small></span></div>
              </section>
              <section class="dismantling-rewards">
                <h4>Bonus reward expectations</h4>
                <p>Expected count is the long-run average for this batch; “any” is the chance this run yields at least one.</p>
                <div v-for="reward in dismantlingPreview.rewards" :key="reward.record" :class="`reward-${reward.category}`">
                  <span><strong>{{ reward.name }}</strong><small>{{ reward.category }}</small></span>
                  <b>{{ reward.expectedCount.toFixed(3) }} expected</b>
                  <em>{{ (reward.chanceAtLeastOne * 100).toFixed(1) }}% any</em>
                </div>
              </section>
              <footer>This is probability math from <code>{{ dismantlingPreview.ruleRecord }}</code>. No random roll has been performed or saved.</footer>
            </template>
            <div v-else class="dismantling-empty">
              <strong>Assemble a hypothetical batch.</strong>
              <p>The preview will show exact costs, Scrap range, and installed component/material probabilities.</p>
            </div>
          </aside>
        </div>
      </section>

      <section v-else-if="activeView === 'farming'" class="farming-workspace" aria-label="Collection farming planner">
        <ToolHeader
          eyebrow="Collection completion"
          title="Where should I farm?"
          description="Areas are ranked by how many currently missing item bases their indexed enemies can drop."
        >
          <template #aside><strong>{{ farmTargets.length }} useful areas</strong></template>
        </ToolHeader>
        <ExplorerToolbar
          v-model="farmingQuery"
          v-bind="searchGuidance.farming"
          search-label="Search farming targets"
          placeholder="Item, monster, area…"
          :result-count="farmTargets.length"
          result-label="useful areas"
          :search-error="searchErrorMessage(farmingStructuredQuery)"
        >
          <template #filters>
            <label>
              <span>Rarity</span>
              <select v-model="farmingRarity" autocomplete="off">
                <option value="all">All tracked rarities</option>
                <option value="mi">Monster Infrequents</option>
                <option value="epic">Epics</option>
                <option value="legendary">Legendaries</option>
              </select>
            </label>
          </template>
        </ExplorerToolbar>
        <div class="farm-list">
          <article v-for="(target, index) in farmTargets" :key="target.key">
            <span class="farm-rank">{{ index + 1 }}</span>
            <div>
              <h3>{{ target.name }} <small>{{ contentPackShortLabel(target.contentPack) }}</small></h3>
              <p>{{ target.items.length }} missing base{{ target.items.length === 1 ? '' : 's' }} · earliest item Lv{{ target.minimumLevel }}</p>
              <div class="farm-items">
                <button v-for="item in target.items.slice(0, 12)" :key="item.record" type="button" @mouseenter="queueTooltip(item, $event)" @mouseleave="scheduleTooltipHide" @click="openItem(item)">
                  <img v-if="itemIconUrl(item)" :src="itemIconUrl(item)!" alt="" />
                  <span>{{ item.name }}</span>
                </button>
                <small v-if="target.items.length > 12">+{{ target.items.length - 12 }} more</small>
              </div>
            </div>
          </article>
          <p v-if="farmTargets.length === 0" class="skill-empty">No missing items have indexed locations under this filter.</p>
        </div>
      </section>

      <section v-else-if="activeView === 'settings'" class="settings-workspace" aria-label="Cairn Codex settings">
        <ToolHeader
          eyebrow="Settings"
          title="Collection and transfer behavior"
          description="Long-lived choices live here. Search, filters, and sorting remain workspace controls."
        />

        <div class="settings-grid">
          <article class="settings-card onboarding-settings-card">
            <p class="section-label">Getting started</p>
            <h3>First-run guide</h3>
            <p>Reopen the guided tour for discovery, Item Assistant migration, archive/live transfers, SC/HC identity, backups, and experimental tools.</p>
            <div class="settings-status">
              <span class="status-dot" :class="{ dim: onboardingStatus !== 'completed' }" />
              <span><strong>{{ onboardingStatusLabel }}</strong>The guide never hides recovery or support controls.</span>
            </div>
            <div class="archive-backup-actions">
              <button class="settings-action" type="button" @click="resumeOnboarding(false)">{{ onboardingStatus === 'in-progress' ? 'Resume guide' : 'Open guide' }}</button>
              <button class="settings-action" type="button" @click="resumeOnboarding(true)">Start from beginning</button>
            </div>
          </article>

          <article class="settings-card">
            <p class="section-label">Live game</p>
            <h3>Connection lifecycle</h3>
            <label class="settings-toggle">
              <input
                type="checkbox"
                :checked="autoLiveConnect"
                :disabled="safeModeActive"
                @change="setAutoLiveConnect(($event.target as HTMLInputElement).checked)"
              />
              <span><strong>Auto-connect</strong><small>{{ safeModeActive ? 'Paused while recovery safe mode is active.' : 'Connect when Grim Dawn starts and disconnect when it exits.' }}</small></span>
            </label>
            <div class="settings-status">
              <span class="status-dot" :class="{ dim: liveStatus?.state !== 'ready' }" />
              <span><strong>{{ gameConnectionLabel }}</strong>{{ liveStatus?.detail ?? 'Checking live adapter…' }}</span>
            </div>
            <small class="settings-recommendation"><strong>Recommended:</strong> {{ connectionRecommendation }}</small>
            <button class="settings-action" type="button" @click="showConnectionDiagnostics = true">View connection diagnostics</button>
          </article>

          <article class="settings-card">
            <p class="section-label">Display</p>
            <h3>Interface scale</h3>
            <div class="zoom-controls">
              <button type="button" @click="setZoom(zoomFactor - 0.1)">−</button>
              <strong>{{ Math.round(zoomFactor * 100) }}%</strong>
              <button type="button" @click="setZoom(zoomFactor + 0.1)">+</button>
              <button type="button" @click="setZoom(1)">Reset</button>
            </div>
            <small>Ctrl + mouse wheel works anywhere in Cairn.</small>
          </article>

          <article class="settings-card workspace-tool-settings">
            <header>
              <div><p class="section-label">Workspace</p><h3>Visible tools</h3></div>
              <div class="workspace-tool-presets">
                <button type="button" @click="showEssentialWorkspaceTools">Essentials</button>
                <button type="button" @click="showAllWorkspaceTools">Show all</button>
              </div>
            </header>
            <p>Collection remains the permanent home view. Choose which specialist tools appear below the progress tracker.</p>
            <label class="settings-toggle experimental-tools-toggle">
              <input
                type="checkbox"
                :checked="experimentalToolsEnabled && !safeModeActive"
                :disabled="safeModeActive"
                @change="setExperimentalToolsEnabled(($event.target as HTMLInputElement).checked)"
              />
              <span><strong>Enable experimental tools</strong><small>{{ safeModeActive ? 'Unavailable while recovery safe mode is active.' : 'Shows Stash Oracle and the read-only Dismantling Lab. Their recommendations and simulations are explicitly provisional.' }}</small></span>
            </label>
            <div class="workspace-tool-options">
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
          </article>

          <ItemAssistantImport :disabled="!snapshot" @completed="handleGdiaImportCompleted" />

          <article class="settings-card archive-protection-settings">
            <p class="section-label">Archive protection</p>
            <h3>Verified rotating backups</h3>
            <p>Cairn keeps up to 12 verified snapshots after archive changes, plus three emergency pre-restore snapshots. Backups contain the Codex database only; Grim Dawn saves and stashes remain separate.</p>
            <div v-if="archiveBackupStatus?.latest" class="archive-backup-latest">
              <span class="status-dot" />
              <div>
                <strong>Last verified {{ formatBackupDate(archiveBackupStatus.latest.createdAtUtc) }}</strong>
                <small>
                  {{ archiveBackupStatus.latest.vaultItemCount.toLocaleString() }} stored copies ·
                  {{ formatBackupSize(archiveBackupStatus.latest.sizeBytes) }} ·
                  {{ archiveBackupStatus.latest.reason }}
                </small>
              </div>
            </div>
            <div v-else class="archive-backup-latest empty">
              <span class="status-dot dim" />
              <div><strong>No verified backup yet</strong><small>Cairn will create one automatically, or you can start one now.</small></div>
            </div>
            <small v-if="archiveBackupStatus">
              {{ archiveBackupStatus.backups.length }} rotating backup{{ archiveBackupStatus.backups.length === 1 ? '' : 's' }} retained locally.
            </small>
            <div class="archive-backup-actions">
              <button class="settings-action" type="button" :disabled="Boolean(archiveBackupBusy)" @click="createArchiveBackup">
                {{ archiveBackupBusy === 'backup' ? 'Verifying backup…' : 'Back up now' }}
              </button>
              <button class="settings-action" type="button" :disabled="Boolean(archiveBackupBusy)" @click="exportArchiveBackup">
                {{ archiveBackupBusy === 'export' ? 'Exporting…' : 'Export backup…' }}
              </button>
              <button class="settings-action danger" type="button" :disabled="Boolean(archiveBackupBusy)" @click="restoreArchiveBackup">
                {{ archiveBackupBusy === 'restore' ? 'Verifying restore…' : 'Restore backup…' }}
              </button>
              <button class="settings-action" type="button" :disabled="Boolean(archiveBackupBusy)" @click="openArchiveBackupDirectory">Open backup folder</button>
            </div>
            <small>Restore is staged for restart and first preserves the current archive as an emergency backup.</small>
          </article>

          <article class="settings-card">
            <p class="section-label">Collection progress</p>
            <h3>Monster Infrequent counting</h3>
            <label class="settings-toggle">
              <input v-model="miCountingMode" type="radio" value="base" />
              <span>
                <strong>Count each MI base once</strong>
                <small>Recommended. Owning any level tier completes that named base; exact tiers remain visible and retrievable.</small>
              </span>
            </label>
            <label class="settings-toggle">
              <input v-model="miCountingMode" type="radio" value="tier" />
              <span>
                <strong>Count every level tier</strong>
                <small>Strict mode. Each obtainable required-level variant is a separate collection entry.</small>
              </span>
            </label>
            <small>This changes completion statistics only. Farming, Skill Explorer, and Leveling Planner always retain the full MI tier catalog; stored copies are never merged or discarded.</small>
          </article>

          <article class="settings-card">
            <p class="section-label">Legacy tools</p>
            <h3>Stash Scanner</h3>
            <label class="settings-toggle">
              <input type="checkbox" :checked="showLegacyScanner" @change="setLegacyScannerVisible(($event.target as HTMLInputElement).checked)" />
              <span><strong>Show legacy stash scanner</strong><small>Expose physical-stash source controls and the diagnostic Stash Scanner collection mode.</small></span>
            </label>
            <small>The Codex Archive remains the default and recommended collection source.</small>
          </article>

          <article v-if="showLegacyScanner" class="settings-card source-settings">
            <header>
              <div><p class="section-label">Stash Scanner</p><h3>Physical copy sources</h3></div>
              <div class="source-presets">
                <button type="button" @click="selectSourceModeForBasis('stashes', false)">SC</button>
                <button type="button" @click="selectSourceModeForBasis('stashes', true)">HC</button>
              </div>
            </header>
            <p>Controls which Grim Dawn stash files the diagnostic scanner reads. These counts are separate from copies stored in the Codex Archive.</p>
            <div class="settings-source-list">
              <label v-for="stash in stashChoices" :key="`index:${stash.path}`" class="source-option">
                <input
                  type="checkbox"
                  :checked="indexStashPaths.includes(stash.path)"
                  :disabled="indexStashPaths.length === 1 && indexStashPaths.includes(stash.path)"
                  @change="toggleSourceForBasis('stashes', stash.path)"
                />
                <span :class="stash.isHardcore ? 'hardcore' : 'softcore'">{{ stash.isHardcore ? 'HC' : 'SC' }}</span>
                <div><strong>{{ stash.modLabel || 'Base game' }}</strong><small>{{ stash.path }}</small></div>
              </label>
            </div>
          </article>

          <article class="settings-card source-settings">
            <header>
              <div><p class="section-label">Codex Archive</p><h3>Archive mode scope</h3></div>
            </header>
            <p>Archive copies retain their game mode, not an originating stash. Enable either mode or both.</p>
            <div class="archive-mode-options">
              <label class="archive-mode-option">
                <input
                  type="checkbox"
                  :checked="archiveModeEnabled(false)"
                  :disabled="archiveModeCount === 1 && archiveModeEnabled(false)"
                  @change="setArchiveModeEnabled(false, ($event.target as HTMLInputElement).checked)"
                />
                <span class="mode-badge softcore">SC</span>
                <span><strong>Softcore</strong><small>Show archived Softcore copies.</small></span>
              </label>
              <label class="archive-mode-option">
                <input
                  type="checkbox"
                  :checked="archiveModeEnabled(true)"
                  :disabled="archiveModeCount === 1 && archiveModeEnabled(true)"
                  @change="setArchiveModeEnabled(true, ($event.target as HTMLInputElement).checked)"
                />
                <span class="mode-badge hardcore">HC</span>
                <span><strong>Hardcore</strong><small>Show archived Hardcore copies.</small></span>
              </label>
            </div>
          </article>

          <article class="settings-card retrieval-settings">
            <p class="section-label">Retrieval</p>
            <h3>Closed-game transfer target</h3>
            <select v-model="selectedStashPath" :disabled="vaultBusy">
              <option v-for="stash in stashChoices" :key="stash.path" :value="stash.path">
                {{ stash.isHardcore ? 'Hardcore' : 'Softcore' }} · {{ stash.path }}
              </option>
            </select>
            <small>Live retrieval always targets {{ liveStatus?.depositTabDescription ?? 'the second-to-last shared stash tab' }}.</small>
          </article>

          <article class="settings-card">
            <p class="section-label">Stored supplies</p>
            <h3>Dispensing behavior</h3>
            <label class="settings-toggle">
              <input
                type="checkbox"
                :checked="infiniteSupplies"
                :disabled="infiniteSuppliesBusy || vaultBusy"
                @change="setInfiniteSupplies(($event.target as HTMLInputElement).checked)"
              />
              <span>
                <strong>Infinite supplies</strong>
                <small>Keep an unlocked faction boost, difficulty merit, Nemesis warrant, augment, or movement rune after dispensing one copy.</small>
              </span>
            </label>
            <small v-if="infiniteSupplies">Each return emits one unit; the archived unlock remains available.</small>
            <small v-else>Disabled: returning a stored supply consumes that archived stack like an ordinary item.</small>
          </article>

          <article class="settings-card">
            <p class="section-label">Game data</p>
            <h3>Installed-data cache</h3>
            <p>Item records, drop-source graphs, map regions, and monster placements are cached locally. Game updates invalidate the cache automatically.</p>
            <button class="settings-action" type="button" :disabled="scanning" @click="rebuildGameDataIndex">
              {{ scanning && scanActivity === 'game-data' ? 'Rebuilding index…' : 'Rebuild game-data index' }}
            </button>
            <small>Use this after changing mods or if a location looks stale.</small>
          </article>

          <article class="settings-card">
            <p class="section-label">Lost quest-item recovery</p>
            <h3>Sahdina’s Memento fixer</h3>
            <p>Crate left this secret necklace sellable. Create exactly one clean replacement through Cairn’s verified live-delivery queue.</p>
            <div class="settings-status">
              <span class="status-dot" :class="{ dim: liveStatus?.state !== 'ready' }" />
              <span>
                <strong>{{ liveStatus?.state === 'ready' ? 'Grim Dawn connected' : 'Live game required' }}</strong>
                {{ liveStatus?.state === 'ready' ? 'Choose the active character inventory or verified shared-stash destination.' : 'Connect from the app header before recovering the item.' }}
              </span>
            </div>
            <div class="interface-recovery-actions">
              <button
                class="settings-action"
                type="button"
                :disabled="vaultBusy || liveStatus?.state !== 'ready'"
                @click="recoverSahdinasMemento('character-inventory')"
              >{{ sahdinaRecoveryBusy === 'character-inventory' ? 'Delivering…' : 'Recover to inventory' }}</button>
              <button
                class="settings-action"
                type="button"
                :disabled="vaultBusy || liveStatus?.state !== 'ready'"
                @click="recoverSahdinasMemento('shared-stash')"
              >{{ sahdinaRecoveryBusy === 'shared-stash' ? 'Delivering…' : 'Recover to shared stash' }}</button>
            </div>
            <small>Use this only if the original secret quest item was accidentally sold or otherwise lost.</small>
          </article>

          <article class="settings-card">
            <p class="section-label">Support and recovery</p>
            <h3>Local diagnostics</h3>
            <div v-if="recoveryStatus?.requiresAttention" class="recovery-alert">
              <strong>Pause transfers</strong>
              <span>{{ recoveryStatus.operations.length }} journal operation{{ recoveryStatus.operations.length === 1 ? '' : 's' }} require a recovery audit.</span>
              <code v-for="operation in recoveryStatus.operations.slice(0, 5)" :key="operation.id">
                {{ operation.operation }} · {{ operation.state }} · {{ operation.id }}
              </code>
            </div>
            <label class="settings-toggle">
              <input
                type="checkbox"
                :checked="debugLoggingStatus.enabled"
                :disabled="debugLoggingBusy"
                @change="setDebugLogging(($event.target as HTMLInputElement).checked)"
              />
              <span>
                <strong>Debug logging</strong>
                <small>Capture additional helper timings for up to {{ debugLoggingStatus.maxAgeDays }} days. Logs rotate after {{ debugLoggingStatus.maxFiles }} bounded files and never include item payloads or character names.</small>
              </span>
            </label>
            <p>Export one redacted JSON support bundle with rotating logs, job timings, versions and fingerprints, database integrity, and unfinished-operation state. Personal paths, character names, item payloads, saves, archives, queues, receipts, and credentials are excluded.</p>
            <button class="settings-action" type="button" :disabled="diagnosticsBusy" @click="exportDiagnostics">
              {{ diagnosticsBusy ? 'Collecting diagnostics…' : 'Export redacted support bundle' }}
            </button>
            <button class="settings-action" type="button" :disabled="preferenceExportBusy" @click="exportPreferences">
              {{ preferenceExportBusy ? 'Exporting preferences…' : 'Export preferences' }}
            </button>
            <small>Preference exports contain your planner profiles, to-dos, and configured local source paths. Keep them private; use the redacted support bundle for public bug reports.</small>
            <button class="settings-action" type="button" @click="openDataDirectory">Open data and backups folder</button>
            <div class="interface-recovery-actions">
              <button class="settings-action" type="button" @click="resetInterfacePreferences">Reset interface preferences</button>
              <button v-if="safeModeActive" class="settings-action" type="button" :disabled="safeModeBusy" @click="restartNormally">Restart normally</button>
              <button v-else class="settings-action" type="button" :disabled="safeModeBusy" @click="restartInSafeMode">Restart in safe mode</button>
            </div>
            <small>Interface reset preserves the Codex Archive, planner profiles, to-do list, source selection, saves, stashes, and backups.</small>
            <small>Standard diagnostics retain at most 3 × 256 KB for 7 days. Debug mode retains at most 6 × 1 MB for 14 days. Preserve the data folder after an uncertain transfer, but never post saves or the archive database publicly.</small>
          </article>
        </div>
      </section>

      <section v-else-if="activeView === 'vault'" class="vault-workspace" aria-label="Item vault">
        <ToolHeader
          eyebrow="Transfers"
          title="Audit item movement and recover exceptions."
          description="Ingest and dispense histories are read-only. Only quarantined copies can be selected and returned to Grim Dawn from this workspace."
        >
          <template #aside>
            <button type="button" :disabled="vaultBusy" @click="refreshVault">{{ vaultBusy ? 'Working…' : 'Recheck' }}</button>
          </template>
        </ToolHeader>

        <nav class="transfer-section-tabs" aria-label="Transfer workspace">
          <button type="button" :class="{ active: transferSection === 'ingest-history' }" @click="transferSection = 'ingest-history'">
            <strong>Ingest history</strong><small>Read-only · items entering Cairn</small>
          </button>
          <button type="button" :class="{ active: transferSection === 'dispense-history' }" @click="transferSection = 'dispense-history'">
            <strong>Dispense history</strong><small>Read-only · items sent to Grim Dawn</small>
          </button>
          <button type="button" :class="{ active: transferSection === 'quarantine' }" @click="transferSection = 'quarantine'">
            <strong>Quarantined items</strong><small>{{ quarantineVaultPage.total.toLocaleString() }} available for recovery</small>
          </button>
        </nav>


        <template v-if="transferSection === 'ingest-history' || transferSection === 'dispense-history'">
          <p class="vault-notice">
            Read-only audit trail. Historical operations cannot be selected, repeated, or changed here.
          </p>
          <ExplorerToolbar
            v-model="transferHistoryQuery"
            v-bind="searchGuidance.history"
            class="vault-explorer-toolbar"
            :search-label="transferSection === 'ingest-history' ? 'Search ingest history' : 'Search dispense history'"
            placeholder="Item, seed, outcome, correlation ID…"
            :result-count="operationHistory.total"
            result-label="operations"
            :loading="operationHistoryLoading"
            :search-error="searchErrorMessage(historyStructuredQuery)"
          >
            <template #filters>
              <label>
                <span>Outcome</span>
                <select v-model="transferHistoryOutcome" autocomplete="off">
                  <option value="all">All outcomes</option>
                  <option value="committed">Completed</option>
                  <option value="failed">Failed</option>
                  <option value="pending">Needs attention</option>
                </select>
              </label>
            </template>
          </ExplorerToolbar>

          <section class="operation-history" :aria-label="transferSection === 'ingest-history' ? 'Ingest history' : 'Dispense history'">
            <article v-for="operation in operationHistory.items" :key="operation.id" class="operation-history-row">
              <div class="operation-state" :class="`state-${operation.state}`">
                <strong>{{ operation.state === 'committed' ? 'Completed' : operation.state === 'failed' ? 'Failed' : 'Needs attention' }}</strong>
                <small>{{ operation.isHardcore === null ? 'Mode unknown' : operation.isHardcore ? 'Hardcore' : 'Softcore' }}</small>
              </div>
              <div class="operation-summary">
                <h3>{{ operation.itemCount }} item{{ operation.itemCount === 1 ? '' : 's' }} · {{ formatOperationSource(operation.source) }}</h3>
                <p v-if="operation.items.length">
                  <span v-for="item in operation.items" :key="`${operation.id}:${item.record}:${item.seed}`">
                    {{ item.name }}<small v-if="item.seed !== null">seed {{ item.seed }}</small>
                  </span>
                  <em v-if="operation.additionalItemCount">+{{ operation.additionalItemCount }} more</em>
                </p>
                <p v-else class="operation-empty">No retained item summary is available for this historical operation.</p>
                <p v-if="operation.error" class="operation-error">{{ operation.error }}</p>
              </div>
              <dl class="operation-meta">
                <div><dt>Started</dt><dd>{{ formatBackupDate(operation.startedAtUtc) }}</dd></div>
                <div v-if="operation.completedAtUtc"><dt>Finished</dt><dd>{{ formatBackupDate(operation.completedAtUtc) }}</dd></div>
                <div><dt>Correlation ID</dt><dd><code>{{ operation.id }}</code></dd></div>
              </dl>
            </article>
            <div v-if="!operationHistoryLoading && operationHistory.items.length === 0" class="vault-empty">No operations match these filters.</div>
            <nav v-if="operationHistoryPageCount > 1" class="pagination vault-pagination" aria-label="Operation history pages">
              <button type="button" :disabled="transferHistoryPage === 1" @click="transferHistoryPage -= 1">Previous</button>
              <span>Page {{ transferHistoryPage }} of {{ operationHistoryPageCount }}</span>
              <button type="button" :disabled="transferHistoryPage === operationHistoryPageCount" @click="transferHistoryPage += 1">Next</button>
            </nav>
          </section>
        </template>

        <template v-else>
          <nav class="transfer-mode-tabs" aria-label="Quarantine return method">
            <button type="button" :class="{ active: transferMode === 'live' }" @click="transferMode = 'live'">
              <span><strong>Live game</strong><small>Return to the verified in-game deposit tab</small></span>
              <em :class="`state-${liveStatus?.state ?? 'unavailable'}`">{{ gameConnectionLabel }}</em>
            </button>
            <button type="button" :class="{ active: transferMode === 'offline' }" @click="transferMode = 'offline'">
              <span><strong>Offline stash</strong><small>Return through an atomic shared-stash write</small></span>
              <em :class="{ ready: writeSafety?.permitted }">{{ writeSafety?.permitted ? 'Ready' : 'Locked' }}</em>
            </button>
          </nav>

          <section v-if="transferMode === 'live'" class="live-mode-card" :class="`state-${liveStatus?.state ?? 'unavailable'}`">
            <div class="live-mode-status">
              <span class="status-dot" :class="{ dim: liveStatus?.state !== 'ready' }" />
              <div>
                <p class="section-label">Quarantine destination</p>
                <h3>{{ liveStatus?.state === 'ready' ? liveStatus.depositTabDescription : 'Connect to Grim Dawn' }}</h3>
                <small>{{ liveStatus?.detail || 'Checking the verified live adapter…' }}</small>
              </div>
            </div>
            <div class="live-mode-actions">
              <button
                v-if="liveStatus?.state !== 'ready'"
                type="button"
                :disabled="vaultBusy || liveLifecyclePolling || liveStatus?.state === 'unavailable' || liveStatus?.state === 'blocked'"
                @click="startLiveMode"
              >{{ liveStatus?.state === 'connecting' ? 'Connecting…' : 'Connect' }}</button>
              <button v-else type="button" :disabled="vaultBusy || liveLifecyclePolling" @click="stopLiveMode">Disconnect</button>
            </div>
          </section>

          <div v-else class="vault-target">
            <label>
              <span>Return to shared stash</span>
              <select v-model="selectedStashPath" :disabled="vaultBusy">
                <option v-for="stash in stashChoices" :key="stash.path" :value="stash.path">
                  {{ stash.isHardcore ? 'Hardcore' : 'Softcore' }} · {{ stash.path }}
                </option>
              </select>
            </label>
            <div class="safety-state" :class="{ safe: writeSafety?.permitted }">
              <span class="status-dot" :class="{ dim: !writeSafety?.permitted }" />
              <div>
                <strong>{{ writeSafety?.permitted ? 'Writes unlocked' : 'Writes locked' }}</strong>
                <small v-if="writeSafety?.permitted">Grim Dawn and Item Assistant are closed.</small>
                <small v-else>{{ writeSafety?.reasons.join(' ') || 'Checking running processes…' }}</small>
              </div>
            </div>
          </div>

          <ExplorerToolbar
            v-model="vaultQuery"
            v-bind="searchGuidance.vault"
            class="vault-explorer-toolbar"
            search-label="Search quarantine"
            placeholder="Item record, name, seed…"
            :result-count="quarantineVaultPage.total"
            result-label="quarantined copies"
            :loading="vaultPageLoading"
            :search-error="searchErrorMessage(vaultStructuredQuery)"
          >
            <template #actions>
              <button type="button" :disabled="visibleQuarantinedVaultItems.length === 0" @click="selectedVaultIds = visibleQuarantinedVaultItems.map((item) => item.id)">Select visible</button>
              <button type="button" :disabled="selectedVaultIds.length === 0" @click="selectedVaultIds = []">Clear</button>
            </template>
          </ExplorerToolbar>
          <section class="vault-quarantine quarantine-workspace">
            <header>
              <div>
                <p class="section-label">Recovery quarantine</p>
                <h3>{{ quarantineVaultPage.total }} non-catalog item{{ quarantineVaultPage.total === 1 ? '' : 's' }} safely stored</h3>
              </div>
            </header>
            <p>Cairn retained these items because they could not safely join the collection catalog. Review the exact record and return only the copies you recognize.</p>
            <div v-if="visibleQuarantinedVaultItems.length" class="vault-item-list selectable">
              <label v-for="item in visibleQuarantinedVaultItems" :key="item.id" class="vault-row unsupported">
                <input type="checkbox" :checked="selectedVaultIds.includes(item.id)" :disabled="vaultBusy" @change="toggleVaultItem(item.id)" />
                <div><strong>{{ item.name }}</strong><small>{{ item.isHardcore ? 'HC' : 'SC' }} · {{ item.baseRecord }} · seed {{ item.seed }}</small></div>
              </label>
            </div>
            <div v-else class="vault-empty">Nothing is waiting in quarantine.</div>
            <nav v-if="vaultQuarantinePageCount > 1" class="pagination vault-pagination" aria-label="Quarantine pages">
              <button type="button" :disabled="vaultQuarantinePage === 1" @click="vaultQuarantinePage -= 1">Previous</button>
              <span>Page {{ vaultQuarantinePage }} of {{ vaultQuarantinePageCount }}</span>
              <button type="button" :disabled="vaultQuarantinePage === vaultQuarantinePageCount" @click="vaultQuarantinePage += 1">Next</button>
            </nav>
            <div class="quarantine-actions">
              <button
                v-if="transferMode === 'live'"
                type="button"
                :disabled="vaultBusy || liveStatus?.state !== 'ready' || selectedVaultIds.length === 0"
                @click="retrieveSelectedLive"
              >{{ vaultBusy ? 'Waiting for game…' : `Return ${selectedVaultIds.length || ''} selected live` }}</button>
              <button
                v-else
                type="button"
                :disabled="vaultBusy || !writeSafety?.permitted || staging?.itemCount !== 0 || selectedVaultIds.length === 0"
                @click="retrieveSelected"
              >{{ vaultBusy ? 'Verifying…' : `Return ${selectedVaultIds.length || ''} selected offline` }}</button>
            </div>
            <small v-if="transferMode === 'live'">Live return commits each copy only after the game acknowledges receipt.</small>
            <small v-else>Offline return requires Grim Dawn and Item Assistant to be closed and the final shared stash tab to be empty.</small>
          </section>
        </template>
      </section>

      <section v-else-if="!snapshot && (appInitializing || scanning)" class="empty-state">
        <div class="sigil loading" aria-hidden="true">C</div>
        <h3>Opening the Codex</h3>
        <p>Parsing the game database and your transfer stashes.</p>
      </section>

      <section v-else-if="activeView === 'sets'" class="set-grid" aria-label="Item sets">
        <article
          v-for="set in visibleSets"
          :key="set.record"
          class="set-card"
          :class="`rarity-${setRarity(set.items)}`"
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
        <div v-if="visibleSets.length === 0" class="no-results">No sets match these filters.</div>
      </section>

      <template v-else-if="snapshot">
        <section class="catalog-grid" :aria-label="activeCategory + ' collection items'">
          <article
            v-for="item in visibleItems"
            :key="item.record"
            class="item-card"
            :class="{ missing: !isCollectionOwned(item), 'awakening-available': itemAvailableByAwakeningOnly(item), legendary: item.rarity === 'legendary', epic: item.rarity === 'epic', mi: item.rarity === 'mi', rare: item.rarity === 'rare', component: item.rarity === 'component', consumable: item.rarity === 'consumable' }"
            role="button"
            tabindex="0"
            aria-describedby="item-tooltip"
            @mouseenter="queueTooltip(item, $event)"
            @mousemove="moveTooltip"
            @mouseleave="scheduleTooltipHide"
            @focus="queueTooltip(item, $event)"
            @blur="scheduleTooltipHide"
            @click="openItem(item)"
            @keydown.enter="openItem(item)"
          >
            <div class="item-mark" aria-hidden="true">
              <img v-if="itemIconUrl(item)" :src="itemIconUrl(item)!" alt="" />
              <span v-else>{{ isCollectionOwned(item) ? '✓' : '?' }}</span>
              <span v-if="item.upgradeRecord" class="awakening-sigil card-awakening-sigil"><i /></span>
            </div>
            <div class="item-copy">
              <h3>{{ item.name }}</h3>
              <p>{{ rarityLabel(item) }} · {{ item.slot }} · Lv{{ item.levelRequirement }}</p>
              <small v-if="item.upgradeRecord" class="awakening-label">Awakenable</small>
              <small v-if="item.setName">{{ item.setName }}</small>
            </div>
            <div class="card-result">
              <strong v-if="activeView !== 'materials' && item.bestRollPercentile !== null" class="roll-score">
                ★ {{ item.bestRollPercentile.toFixed(1) }}%
              </strong>
              <span v-else-if="activeView !== 'materials'" class="roll-score dim">★ —</span>
              <strong v-if="item.availableCount > 0">
                {{ item.availableCount }} {{ activeView === 'materials' ? (item.slot === 'potion-formula' ? 'learned' : 'stored') : item.availableCount === 1 ? 'copy' : 'copies' }}
              </strong>
              <strong v-else-if="itemAvailableByAwakeningOnly(item)" class="awakening-available">{{ awakeningAvailabilityLabel(item) }}</strong>
              <strong v-else-if="item.recipeUnlocked">Recipe unlocked · no stored copy</strong>
              <strong v-else-if="item.discovered">Discovered · no copies</strong>
              <strong v-else>Not found</strong>
            </div>
            <button
              v-if="liveStatus?.state === 'ready' && bestStoredCopy(item.record)"
              class="card-live-retrieve"
              type="button"
              :disabled="vaultBusy"
              title="Return the best stored copy to Grim Dawn"
              @click.stop="retrieveArchivedCopyLive(bestStoredCopy(item.record)!.id)"
            >
              Retrieve live
            </button>
            <span v-if="item.pinnedInstanceKey" class="pin-indicator">Pinned choice</span>
          </article>
          <div v-if="visibleItems.length === 0" class="no-results">No items match these filters.</div>
        </section>

        <nav v-if="pageCount > 1" class="pagination" aria-label="Catalog pages">
          <button type="button" :disabled="currentPage === 1" @click="goToPage(currentPage - 1)">Previous</button>
          <span>Page {{ currentPage }} of {{ pageCount }}</span>
          <button type="button" :disabled="currentPage === pageCount" @click="goToPage(currentPage + 1)">Next</button>
        </nav>
      </template>
    </main>
    </WorkspaceErrorBoundary>

    <Teleport to="body">
      <aside
        v-if="tooltipItem"
        ref="tooltipElement"
        id="item-tooltip"
        class="game-tooltip"
        :class="tooltipItem.rarity"
        :style="{ left: `${tooltipPosition.left}px`, top: `${tooltipPosition.top}px`, maxHeight: `${tooltipMaxHeight}px` }"
        role="tooltip"
      >
        <header class="tooltip-header">
          <img v-if="itemIconUrl(tooltipItem)" :src="itemIconUrl(tooltipItem)!" alt="" />
          <div>
            <h3>
              <span v-if="tooltipItem.upgradeRecord || tooltipItem.baseVersionRecord" class="awakening-sigil tooltip-awakening-sigil"><i /></span>
              {{ tooltipDisplayName }}
            </h3>
            <p v-if="tooltipItem.upgradeRecord" class="awakening-copy">Can be upgraded by Ashes of Awakening.</p>
            <p v-else-if="tooltipItem.baseVersionRecord" class="awakening-copy">Awakened with Ashes of Awakening.</p>
            <p v-if="itemAvailableByAwakeningOnly(tooltipItem)" class="awakening-availability">{{ awakeningAvailabilityLabel(tooltipItem) }}</p>
            <p v-if="tooltipItem.presentation?.flavorText">“{{ tooltipItem.presentation.flavorText }}”</p>
            <strong>{{ rarityLabel(tooltipItem) }} · {{ itemTypeLabel(tooltipItem) }}</strong>
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
            <span v-if="tooltipElement && tooltipElement.scrollHeight > tooltipElement.clientHeight">[Mouse Wheel to Scroll]</span>
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
          <img v-if="itemIconUrl(selectedItem)" :src="itemIconUrl(selectedItem)!" alt="" />
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
            <select v-model="miComparisonMetric">
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
            <select v-model="miComparisonDirection">
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
                  <img v-if="itemIconUrl(selectedItem)" :src="itemIconUrl(selectedItem)!" alt="" />
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
                    <small>{{ rarityLabel(selectedItem) }} · {{ itemTypeLabel(selectedItem) }} · Lv{{ selectedItem.levelRequirement }}</small>
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
                  <strong>{{ miMetricResult(copy, miComparisonMetric).display }}</strong>
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
