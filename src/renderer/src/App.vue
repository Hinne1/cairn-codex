<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  buildStashOracle,
  type OracleReadiness,
  type OracleStyle
} from './stash-oracle'
import type {
  CharacterSaveProfile,
  CollectionBasis,
  CollectionItem,
  CollectionRaritySummary,
  CollectionSnapshot,
  GrimDawnDiscovery,
  ItemPresentation,
  ItemPresentationLine,
  ItemRollAnalysis,
  LiveGameStatus,
  MapRegionLocation,
  ObservedStashItem,
  RolledStat,
  StagingTabInspection,
  VaultListItem,
  WriteSafetyStatus
} from '@shared/contracts'

type OwnershipFilter = 'all' | 'owned' | 'missing'
type RarityFilter = 'all' | 'epic' | 'legendary' | 'mi' | 'rare' | 'recipe'
type SortMode = 'name' | 'level' | 'completion' | 'recent' | 'roll'
type SortDirection = 'asc' | 'desc'
type ActiveView = 'collection' | 'sets' | 'materials' | 'skills' | 'planner' | 'oracle' | 'mi-workshop' | 'supplies' | 'farming' | 'vault' | 'settings'
type SetProgressFilter = 'all' | 'complete' | 'progress' | 'unstarted'
type SetSortMode = 'completion' | 'level' | 'name'
type SkillScope = 'archive' | 'all'
type SkillSort = 'item' | 'slot' | 'amount' | 'conversion' | 'special' | 'level'
type TransferMode = 'live' | 'offline'
type PlannerDisplay = 'list' | 'grid' | 'map'
type PlannerMapScope = 'selected' | 'all'
type SupplyCategory = 'writs' | 'augments'
type SupplySlotFilter = 'all' | 'weapon' | 'armor' | 'jewelry'
type MaterialCategory = 'all' | 'component' | 'material' | 'potion-formula'
type MiMetricKey = 'overall' | 'base' | 'prefix' | 'suffix' | `item:${string}` | `pet:${string}`

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
  miComparisonMetric: MiMetricKey
  miComparisonDirection: SortDirection
}

interface PlannerProfile {
  id: string
  name: string
  skills: string[]
  excludedSkills: string[]
  minimumLevel: number
  levelCap: number
  source: 'manual' | 'character'
  characterPath?: string
  characterLevel?: number
  isHardcore?: boolean
  modifiedAt: string
}

interface SkillMatch {
  skill: string
  amount: number
  conversionTarget: string
  conversionDetails: string
  special: string
}

interface TodoItem {
  id: string
  text: string
  done: boolean
  createdAt: string
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

const discovery = ref<GrimDawnDiscovery | null>(null)
const snapshot = ref<CollectionSnapshot | null>(null)
const indexStashPaths = ref<string[]>(readStoredSourcePaths('stashes'))
const archiveStashPaths = ref<string[]>(readStoredSourcePaths('archive'))
const collectionBasis = ref<CollectionBasis>(readStoredCollectionBasis())
const enabledStashPaths = computed<string[]>({
  get: () =>
    collectionBasis.value === 'archive' ? archiveStashPaths.value : indexStashPaths.value,
  set: (paths) => {
    if (collectionBasis.value === 'archive') archiveStashPaths.value = paths
    else indexStashPaths.value = paths
  }
})
const scanning = ref(false)
const archiveRollHydrating = ref(false)
const scanActivity = ref<'collection' | 'game-data'>('collection')
const scanError = ref<string | null>(null)
const cacheIssue = ref<string | null>(null)
const zoomFactor = ref(readStoredZoomFactor())
const activeCategory = ref('All')
const activeView = ref<ActiveView>('collection')
const query = ref('')
const ownership = ref<OwnershipFilter>('all')
const rarityFilter = ref<RarityFilter>('all')
const sortMode = ref<SortMode>('recent')
const sortDirection = ref<SortDirection>('desc')
const trackerCollapsed = ref(readStoredTrackerCollapsed())
const showLegacyScanner = ref(readStoredBoolean('cairn-codex-show-legacy-scanner', false))
const setProgressFilter = ref<SetProgressFilter>('all')
const setSortMode = ref<SetSortMode>('completion')
const setSortDirection = ref<SortDirection>('desc')
const selectedSkill = ref(localStorage.getItem('cairn-codex-skill') ?? 'Wendigo Totem')
const skillScope = ref<SkillScope>(
  localStorage.getItem('cairn-codex-skill-scope') === 'archive' ? 'archive' : 'all'
)
const skillSort = ref<SkillSort>('amount')
const skillSortDirection = ref<SortDirection>('desc')
const skillPickerOpen = ref(false)
const skillPickerIndex = ref(0)
const plannerProfiles = ref<PlannerProfile[]>(readStoredPlannerProfiles())
const selectedPlannerProfileId = ref(readStoredPlannerProfileId(plannerProfiles.value))
const initialPlannerProfile = plannerProfiles.value.find((profile) => profile.id === selectedPlannerProfileId.value)
  ?? plannerProfiles.value[0]
const plannerSkills = ref<string[]>([...(initialPlannerProfile?.skills ?? ['Wendigo Totem'])])
const plannerSkillDraft = ref('')
const plannerProfileDraft = ref('')
const plannerMinimumLevel = ref(initialPlannerProfile?.minimumLevel ?? 1)
const plannerLevelCap = ref(initialPlannerProfile?.levelCap ?? readStoredPlannerLevelCap())
const plannerMinimumLevelDraft = ref(plannerMinimumLevel.value)
const plannerLevelCapDraft = ref(plannerLevelCap.value)
const plannerDisplay = ref<PlannerDisplay>(readStoredPlannerDisplay())
const plannerMapScope = ref<PlannerMapScope>('selected')
const plannerQuery = ref('')
const plannerOwnership = ref<OwnershipFilter>('all')
const plannerIgnoredRecords = ref<string[]>(readStoredStringArray('cairn-codex-planner-ignored-records'))
const plannerFavoriteRecords = ref<string[]>(readStoredStringArray('cairn-codex-planner-favorite-records'))
const plannerShowIgnored = ref(false)
const oracleClass = ref(localStorage.getItem('cairn-codex-oracle-class') ?? 'all')
const oracleStyle = ref<OracleStyle>(readStoredOracleStyle())
const oracleReadiness = ref<'all' | OracleReadiness>('all')
const oracleMinimumLevel = ref(readStoredNumber('cairn-codex-oracle-minimum-level', 65, 1, 100))
const oracleMaximumLevel = ref(readStoredNumber('cairn-codex-oracle-maximum-level', 100, 1, 100))
const oracleQuery = ref('')
const oracleVisibleCount = ref(12)
const discoveredCharacters = ref<CharacterSaveProfile[]>([])
const characterImportOpen = ref(false)
const characterImportLoading = ref(false)
const characterImportError = ref<string | null>(null)
const atlasRegionQuery = ref('')
const selectedAtlasRegion = ref<string | null>(null)
const transferMode = ref<TransferMode>('live')
const currentPage = ref(1)
const selectedRecord = ref<string | null>(null)
const activeCopyAffixTarget = ref<{ copyKey: string; record: string } | null>(null)
const pinning = ref(false)
const vaultItems = ref<VaultListItem[]>([])
const staging = ref<StagingTabInspection | null>(null)
const writeSafety = ref<WriteSafetyStatus | null>(null)
const selectedStashPath = ref(localStorage.getItem('cairn-codex-retrieval-stash') ?? '')
const selectedVaultIds = ref<string[]>([])
const selectedSupplyIds = ref<string[]>([])
const reusableSupplyQuery = ref('')
const supplyCategory = ref<SupplyCategory>('writs')
const supplySlotFilter = ref<SupplySlotFilter>('all')
const materialCategory = ref<MaterialCategory>('all')
const farmingQuery = ref('')
const farmingRarity = ref<RarityFilter>('all')
const infiniteSupplies = ref(true)
const infiniteSuppliesBusy = ref(false)
const vaultBusy = ref(false)
const vaultError = ref<string | null>(null)
const vaultMessage = ref<string | null>(null)
const liveStatus = ref<LiveGameStatus | null>(null)
const headerCharacters = ref<CharacterSaveProfile[]>([])
const liveIssues = ref<string[]>([])
const liveSyncing = ref(false)
const liveLifecyclePolling = ref(false)
const showConnectionDiagnostics = ref(false)
const todoOpen = ref(false)
const todoDraft = ref('')
const todoInput = ref<HTMLInputElement | null>(null)
const todos = ref<TodoItem[]>(readStoredTodos())
const manualDisconnectProcessId = ref<number | null>(null)
const showMiReserves = ref(false)
const miWorkshopQuery = ref('')
const miComparisonMetric = ref<MiMetricKey>('overall')
const miComparisonDirection = ref<SortDirection>('desc')
const canNavigateBack = ref(false)
const canNavigateForward = ref(false)
const autoLiveConnect = ref(readStoredBoolean('cairn-codex-auto-live-connect', true))
const tooltipRecord = ref<string | null>(null)
const tooltipPosition = ref({ left: 0, top: 0 })
const tooltipMaxHeight = computed(() => Math.max(180, window.innerHeight - tooltipPosition.value.top - 14))
const tooltipElement = ref<HTMLElement | null>(null)
const tooltipDetailsHeld = ref(false)
let tooltipTimer: ReturnType<typeof setTimeout> | null = null
let tooltipHideTimer: ReturnType<typeof setTimeout> | null = null
let liveSyncTimer: ReturnType<typeof setInterval> | null = null
let liveLifecycleTimer: ReturnType<typeof setInterval> | null = null
let vaultErrorTimer: ReturnType<typeof setTimeout> | null = null
let vaultMessageTimer: ReturnType<typeof setTimeout> | null = null
let scanErrorTimer: ReturnType<typeof setTimeout> | null = null
let appHistoryReady = false
let restoringAppHistory = false
let appHistoryIndex = 0
let appHistoryMaximum = 0
const pageSize = 48

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
const availableVaultItems = computed(() =>
  vaultItems.value.filter(
    (item) =>
      item.catalogued &&
      item.rarity !== 'supply' &&
      item.state === 'ingested' &&
      item.isHardcore === activeTransferHardcore.value
  )
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
const eligibleFactionAugmentCount = computed(() =>
  (snapshot.value?.supplies ?? [])
    .filter((item) => item.slot === 'augment')
    .filter((item) => (item.acquisition?.factions ?? []).some(
      (requirement) => characterMeetsReputation(requirement.faction, requirement.reputation)
    )).length
)
const factionAugmentCount = computed(() =>
  (snapshot.value?.supplies ?? []).filter((item) => item.slot === 'augment').length
)
const supplyAccessSummary = computed(() => activeCharacter.value
  ? `${eligibleFactionAugmentCount.value} augments available to ${activeCharacter.value.name}`
  : `${factionAugmentCount.value} augments indexed · connect a character to check access`
)
const supplyCatalogByRecord = computed(() => new Map(
  (snapshot.value?.supplies ?? []).map((item) => [item.record.toLocaleLowerCase(), item])
))
const supplyVaultItems = computed<SupplyOption[]>(() => {
  const needle = reusableSupplyQuery.value.trim().toLocaleLowerCase()
  if (supplyCategory.value === 'augments') {
    const factionAugments = (snapshot.value?.supplies ?? [])
      .filter((item) => item.slot === 'augment')
      .map((item): SupplyOption => {
        const requirements = item.acquisition?.factions ?? []
        const eligible = requirements.some((requirement) => characterMeetsReputation(requirement.faction, requirement.reputation))
        const effects = supplyEffectLines(item)
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
          effectCount: effects.length
        }
      })
    const archivedRunes = vaultItems.value
      .filter((item) => item.rarity === 'supply' && item.slot === 'rune' && item.state === 'ingested')
      .map((item): SupplyOption => {
        const eligible = activeTransferHardcore.value !== undefined &&
          item.isHardcore === activeTransferHardcore.value
        const catalogItem = supplyCatalogByRecord.value.get(item.baseRecord.toLocaleLowerCase()) ?? null
        const effects = catalogItem ? supplyEffectLines(catalogItem) : []
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
      .filter((item) => !needle || item.name.toLocaleLowerCase().includes(needle) ||
        item.detail.toLocaleLowerCase().includes(needle) ||
        item.effects.some((effect) => effect.toLocaleLowerCase().includes(needle)) ||
        Boolean(item.catalogItem && matchesSearch(item.catalogItem, needle)))
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
      if (!needle) return true
      const catalog = snapshot.value?.supplies?.find((entry) =>
        entry.record.toLocaleLowerCase() === item.baseRecord.toLocaleLowerCase()
      )
      return item.name.toLocaleLowerCase().includes(needle) || item.slot.includes(needle) ||
        Boolean(catalog && matchesSearch(catalog, needle))
    })
    .sort((left, right) => left.slot.localeCompare(right.slot) || left.name.localeCompare(right.name))
    .map((item): SupplyOption => {
      const eligible = activeTransferHardcore.value !== undefined &&
        item.isHardcore === activeTransferHardcore.value
      const catalogItem = supplyCatalogByRecord.value.get(item.baseRecord.toLocaleLowerCase()) ?? null
      const effects = catalogItem ? supplyEffectLines(catalogItem) : []
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
const quarantinedVaultItems = computed(() =>
  vaultItems.value.filter(
    (item) =>
      !item.catalogued &&
      item.state === 'ingested' &&
      item.isHardcore === activeTransferHardcore.value
  )
)
const retrievedVaultItems = computed(() =>
  vaultItems.value.filter((item) => item.state === 'retrieved')
)
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
  return medianSummary(items.map((item) => item.bestRollPercentile))
}
const allItemRollSummary = computed(() => itemRollSummary())
const legendaryRollSummary = computed(() => itemRollSummary('legendary'))
const epicRollSummary = computed(() => itemRollSummary('epic'))
const miRollSummary = computed(() => itemRollSummary('mi'))
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
  availableCopies: collectionSets.value.filter((set) =>
    set.items.every((item) => item.availableCount > 0)
  ).length
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
const stagingHasUnsupported = computed(() => staging.value?.items.some((item) => !item.supported) ?? false)
const ingestBlockedReason = computed(() => {
  if (vaultBusy.value) return 'A Vault operation is already running.'
  if (!writeSafety.value) return 'Checking whether stash writes are safe…'
  if (!writeSafety.value.permitted) return writeSafety.value.reasons.join(' ') || 'Stash writes are locked.'
  if (!staging.value) return 'Inspecting the final stash tab…'
  if (staging.value.itemCount === 0) return 'Put at least one Epic, Legendary, or Monster Infrequent in the final stash tab.'
  if (stagingHasUnsupported.value) return 'Remove unsupported items from the final stash tab first.'
  return null
})

const filteredItems = computed(() => {
  if (!snapshot.value) return []
  const needle = query.value.trim().toLocaleLowerCase()
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
        : item.rarity === rarityFilter.value)
    )
    .filter((item) => {
      if (ownership.value === 'owned') return Boolean(item.discovered)
      if (ownership.value === 'missing') return !item.discovered
      return true
    })
    .filter((item) => {
      if (!needle) return true
      return matchesSearch(item, needle)
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
      existing.collected += item.discovered ? 1 : 0
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
        collected: item.discovered ? 1 : 0,
        availableCopies: item.availableCount,
        minimumLevel: item.levelRequirement > 0 ? item.levelRequirement : 0,
        maximumLevel: item.levelRequirement > 0 ? item.levelRequirement : 0
      })
    }
  }
  for (const set of grouped.values()) {
    set.items.sort((left, right) => left.slot.localeCompare(right.slot) || left.name.localeCompare(right.name))
  }
  return [...grouped.values()]
})

const visibleSets = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
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
    .filter((set) => {
      if (!needle) return true
      return (
        set.name.toLocaleLowerCase().includes(needle) ||
        (set.items[0]?.setPresentation?.tiers ?? []).some((tier) =>
          tier.lines.some((line) => formatPresentationLine(line).toLocaleLowerCase().includes(needle))
        ) ||
        set.items.some((item) => matchesSearch(item, needle))
      )
    })
  return sets.sort(compareSets)
})

const displayedResultCount = computed(() =>
  activeView.value === 'settings'
    ? 0
    : activeView.value === 'vault'
    ? availableVaultItems.value.length
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

const activeArchiveModes = computed(() => new Set(
  stashChoices.value
    .filter((stash) => archiveStashPaths.value.includes(stash.path))
    .map((stash) => stash.isHardcore)
))
const archivedRecordSet = computed(() => new Set(
  vaultItems.value
    .filter((item) =>
      item.catalogued && item.state === 'ingested' && activeArchiveModes.value.has(item.isHardcore)
    )
    .map((item) => item.baseRecord.toLocaleLowerCase())
))

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

const selectedStoredCopies = computed(() => {
  if (!selectedRecord.value) return []
  return vaultItems.value
    .filter(
      (item) =>
        item.catalogued &&
        item.state === 'ingested' &&
        item.baseRecord.toLocaleLowerCase() === selectedRecord.value?.toLocaleLowerCase() &&
        (snapshot.value?.isHardcore === undefined || item.isHardcore === snapshot.value.isHardcore)
    )
    .map((item) => {
      const observed = snapshot.value?.observedItems.find(
        (copy) => copy.sourcePath === `vault://${item.id}`
      )
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
  const needle = normalizeLoose(oracleQuery.value)
  return oracleCandidates.value.filter((candidate) => {
    if (oracleReadiness.value !== 'all' && candidate.readiness !== oracleReadiness.value) return false
    if (!needle) return true
    return normalizeLoose([
      candidate.title,
      candidate.skill,
      candidate.damageType,
      candidate.style,
      candidate.className,
      ...candidate.masteries,
      ...candidate.relatedSkills,
      ...candidate.sets.map((set) => set.name),
      ...candidate.evidence.flatMap((evidence) => [evidence.item.name, ...evidence.reasons])
    ].join(' ')).includes(needle)
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
  return rows.sort((left, right) => {
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

const farmTargets = computed<FarmTarget[]>(() => {
  if (!snapshot.value) return []
  const query = farmingQuery.value.trim().toLocaleLowerCase()
  const grouped = new Map<string, FarmTarget>()
  for (const item of snapshot.value.items) {
    if (item.discovered) continue
    if (farmingRarity.value !== 'all' && item.rarity !== farmingRarity.value) continue
    if (query && !matchesSearch(item, query)) continue
    for (const location of item.acquisition?.locations ?? []) {
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
  .filter((item) => matchesPlannerQuery(item, plannerQuery.value))
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
  .sort((left, right) =>
    left.item.levelRequirement - right.item.levelRequirement ||
    left.item.name.localeCompare(right.item.name)
  ))

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
  const needle = normalizeLoose(atlasRegionQuery.value)
  if (!needle) return atlasRegions.value
  return atlasRegions.value.filter((region) =>
    normalizeLoose([
      region.name,
      ...region.items.map((item) => item.name),
      ...region.items.flatMap((item) => item.acquisition?.sources ?? [])
    ].join(' ')).includes(needle)
  )
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
        base,
        prefix: prefix?.name ?? (copy.prefixRecord ? copy.prefixRecord.split('/').at(-1) ?? copy.prefixRecord : 'No prefix'),
        prefixRarity: prefix?.rarity ?? null,
        suffix: suffix?.name ?? (copy.suffixRecord ? copy.suffixRecord.split('/').at(-1) ?? copy.suffixRecord : 'No suffix'),
        suffixRarity: suffix?.rarity ?? null,
        copies: [copy]
      })
    }
  }
  const needle = normalizeLoose(miWorkshopQuery.value)
  const direction = miComparisonDirection.value === 'asc' ? 1 : -1
  return [...grouped.values()]
    .map((group) => {
      const copies = group.copies.sort((left, right) =>
        compareCopiesByMiMetric(left, right, miComparisonMetric.value, miComparisonDirection.value)
      )
      return {
        ...group,
        copies,
        leader: copies[0]!,
        selectedMetric: miMetricResult(copies[0]!, miComparisonMetric.value)
      }
    })
    .filter((group) => !needle || normalizeLoose([
      group.base.name,
      group.base.record,
      group.base.slot,
      group.base.levelRequirement,
      group.prefix,
      group.suffix,
      presentationSearchText(group.base.presentation),
      ...group.copies.flatMap((copy) => [
        presentationSearchText(affixByRecord.value.get(copy.prefixRecord.toLocaleLowerCase())?.presentation),
        presentationSearchText(affixByRecord.value.get(copy.suffixRecord.toLocaleLowerCase())?.presentation)
      ])
    ].join(' ')).includes(needle))
    .sort(
      (left, right) => {
        const leftValue = left.selectedMetric.value
        const rightValue = right.selectedMetric.value
        if (leftValue !== null || rightValue !== null) {
          if (leftValue === null) return 1
          if (rightValue === null) return -1
          if (leftValue !== rightValue) return (leftValue - rightValue) * direction
        }
        return left.base.name.localeCompare(right.base.name) ||
        left.base.levelRequirement - right.base.levelRequirement ||
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
    miComparisonMetric: miComparisonMetric.value,
    miComparisonDirection: miComparisonDirection.value
  }
}

function updateHistoryButtons(): void {
  canNavigateBack.value = appHistoryIndex > 0
  canNavigateForward.value = appHistoryIndex < appHistoryMaximum
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
  miWorkshopQuery.value = state.miWorkshopQuery
  miComparisonMetric.value = state.miComparisonMetric
  miComparisonDirection.value = state.miComparisonDirection
  updateHistoryButtons()
  void nextTick(() => { restoringAppHistory = false })
}

function navigateAppHistory(direction: 'back' | 'forward'): void {
  if (direction === 'back' && canNavigateBack.value) window.history.back()
  if (direction === 'forward' && canNavigateForward.value) window.history.forward()
}

watch(
  [activeView, activeCategory, query, ownership, rarityFilter, sortMode, sortDirection, setProgressFilter, setSortMode, setSortDirection, materialCategory],
  () => {
    currentPage.value = 1
  }
)

watch(sortMode, (mode) => {
  sortDirection.value = mode === 'name' ? 'asc' : 'desc'
})

watch(setSortMode, (mode) => {
  setSortDirection.value = mode === 'completion' ? 'desc' : 'asc'
})

watch(selectedSkill, (skill) => localStorage.setItem('cairn-codex-skill', skill))
watch(skillScope, (scope) => localStorage.setItem('cairn-codex-skill-scope', scope))
watch(oracleClass, (className) => localStorage.setItem('cairn-codex-oracle-class', className))
watch(oracleStyle, (style) => localStorage.setItem('cairn-codex-oracle-style', style))
watch(oracleMinimumLevel, (level) => localStorage.setItem('cairn-codex-oracle-minimum-level', String(level)))
watch(oracleMaximumLevel, (level) => localStorage.setItem('cairn-codex-oracle-maximum-level', String(level)))
watch([oracleClass, oracleStyle, oracleReadiness, oracleMinimumLevel, oracleMaximumLevel, oracleQuery], () => {
  oracleVisibleCount.value = 12
})
watch(selectedRecord, () => {
  activeCopyAffixTarget.value = null
})
watch([activeView, selectedRecord], () => {
  if (!appHistoryReady || restoringAppHistory) return
  appHistoryIndex += 1
  appHistoryMaximum = appHistoryIndex
  window.history.pushState(currentAppHistoryState(), '')
  updateHistoryButtons()
}, { flush: 'post' })
watch(
  [activeCategory, query, ownership, rarityFilter, miWorkshopQuery, miComparisonMetric, miComparisonDirection],
  () => {
    if (!appHistoryReady || restoringAppHistory) return
    window.history.replaceState(currentAppHistoryState(), '')
  },
  { flush: 'post' }
)
watch(plannerSkills, (skills) => {
  localStorage.setItem('cairn-codex-planner-skills', JSON.stringify(skills))
}, { deep: true })
watch(plannerLevelCap, (level) => localStorage.setItem('cairn-codex-planner-level-cap', String(level)))
watch(plannerMinimumLevel, (level) => {
  plannerMinimumLevelDraft.value = level
  if (level > plannerLevelCap.value) plannerLevelCap.value = level
})
watch(plannerLevelCap, (level) => {
  plannerLevelCapDraft.value = level
  if (level < plannerMinimumLevel.value) plannerMinimumLevel.value = level
})
watch(plannerDisplay, (display) => localStorage.setItem('cairn-codex-planner-display', display))
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
  localStorage.setItem('cairn-codex-planner-profiles', JSON.stringify(profiles))
}, { deep: true, immediate: true })
watch(selectedPlannerProfileId, (profileId) => {
  localStorage.setItem('cairn-codex-planner-profile', profileId)
})
watch(plannerIgnoredRecords, (records) => {
  localStorage.setItem('cairn-codex-planner-ignored-records', JSON.stringify(records))
}, { deep: true })
watch(plannerFavoriteRecords, (records) => {
  localStorage.setItem('cairn-codex-planner-favorite-records', JSON.stringify(records))
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
  selectedSupplyIds.value = []
  vaultError.value = null
  vaultMessage.value = null
})
watch(supplySlotFilter, () => {
  selectedSupplyIds.value = []
})

watch(selectedStashPath, async (path) => {
  if (path) {
    localStorage.setItem('cairn-codex-retrieval-stash', path)
    await refreshStaging()
  }
})

watch(activeView, async (view) => {
  await nextTick()
  window.scrollTo({ top: 0, behavior: 'auto' })
  if (view === 'vault' || view === 'supplies') {
    await refreshVault()
    await pollLiveLifecycle()
  }
})

watch(vaultError, (message) => {
  if (vaultErrorTimer) clearTimeout(vaultErrorTimer)
  if (message) vaultErrorTimer = setTimeout(() => { vaultError.value = null }, 12_000)
})

watch(vaultMessage, (message) => {
  if (vaultMessageTimer) clearTimeout(vaultMessageTimer)
  if (message) vaultMessageTimer = setTimeout(() => { vaultMessage.value = null }, 7_000)
})

watch(scanError, (message) => {
  if (scanErrorTimer) clearTimeout(scanErrorTimer)
  if (message) scanErrorTimer = setTimeout(() => { scanError.value = null }, 12_000)
})

onMounted(async () => {
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
  window.scrollTo(0, 0)
  appHistoryIndex = 0
  appHistoryMaximum = 0
  window.history.replaceState(currentAppHistoryState(0), '')
  appHistoryReady = true
  updateHistoryButtons()
  window.addEventListener('popstate', handleAppHistory)
  window.addEventListener('keydown', handleEscape)
  window.addEventListener('keyup', handleTooltipKeyUp)
  window.addEventListener('wheel', handleZoomWheel, { passive: false })
  zoomFactor.value = await window.cairnCodex.setZoomFactor(zoomFactor.value)
  try {
    infiniteSupplies.value = await window.cairnCodex.getInfiniteSupplies()
  } catch (error) {
    console.warn('Stored-supply setting could not be loaded; preserving the safe default.', error)
  }
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
    applySnapshot(cached)
    // While live mode owns the hook, keep the helper responsive to durable queue work.
    // The cached catalog is complete enough to browse; heavy scan/roll refreshes remain
    // manual and run automatically once the game session ends.
    if (cached.cacheNeedsRefresh && liveStatus.value?.state !== 'ready') void scanCollection()
    if (!cached.cacheNeedsRefresh || liveStatus.value?.state === 'ready') void hydrateArchiveRolls()
  } else {
    await scanCollection()
  }
  await refreshVault()
  await nextTick()
  window.scrollTo({ top: 0, behavior: 'auto' })
})

onBeforeUnmount(() => {
  window.removeEventListener('popstate', handleAppHistory)
  window.removeEventListener('keydown', handleEscape)
  window.removeEventListener('keyup', handleTooltipKeyUp)
  window.removeEventListener('wheel', handleZoomWheel)
  cancelTooltip()
  cancelTooltipHide()
  if (liveSyncTimer) clearInterval(liveSyncTimer)
  if (liveLifecycleTimer) clearInterval(liveLifecycleTimer)
  if (vaultErrorTimer) clearTimeout(vaultErrorTimer)
  if (vaultMessageTimer) clearTimeout(vaultMessageTimer)
  if (scanErrorTimer) clearTimeout(scanErrorTimer)
})

async function scanCollection(): Promise<void> {
  const requestedSources = [...enabledStashPaths.value]
  const requestedBasis = collectionBasis.value
  const requestedKey = JSON.stringify({
    basis: requestedBasis,
    paths: requestedSources.map((path) => path.toLocaleLowerCase()).sort()
  })
  scanActivity.value = 'collection'
  scanning.value = true
  scanError.value = null
  try {
    const result = await window.cairnCodex.scanCollection(requestedSources, requestedBasis)
    const currentKey = JSON.stringify({
      basis: collectionBasis.value,
      paths: enabledStashPaths.value.map((path) => path.toLocaleLowerCase()).sort()
    })
    if (requestedKey === currentKey) {
      applySnapshot(result)
      if (liveStatus.value?.state !== 'ready') void hydrateArchiveRolls()
    } else {
      const current = await window.cairnCodex.getCachedCollection(
        [...enabledStashPaths.value],
        collectionBasis.value
      )
      if (current) applySnapshot(current)
    }
  } catch (error) {
    scanError.value = error instanceof Error ? error.message : 'Collection scan failed.'
  } finally {
    scanning.value = false
  }
}

async function rebuildGameDataIndex(): Promise<void> {
  scanActivity.value = 'game-data'
  scanning.value = true
  vaultError.value = null
  vaultMessage.value = null
  try {
    const result = await window.cairnCodex.rebuildGameDataIndex(
      [...enabledStashPaths.value],
      collectionBasis.value
    )
    applySnapshot(result)
    vaultMessage.value = 'Game-data and map location indexes rebuilt from the installed Grim Dawn files.'
  } catch (error) {
    vaultError.value = readableError(error)
  } finally {
    scanning.value = false
  }
}

function applySnapshot(value: CollectionSnapshot): void {
  snapshot.value = value
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

function readStoredSourcePaths(basis: CollectionBasis): string[] {
  try {
    const key = basis === 'archive' ? 'cairn-codex-archive-sources' : 'cairn-codex-index-sources'
    const stored = localStorage.getItem(key) ?? localStorage.getItem('cairn-codex-sources') ?? '[]'
    const parsed = JSON.parse(stored) as unknown
    return Array.isArray(parsed) && parsed.every((value) => typeof value === 'string') ? parsed : []
  } catch {
    return []
  }
}

function readStoredStringArray(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
    return Array.isArray(parsed) && parsed.every((value) => typeof value === 'string') ? parsed : []
  } catch {
    return []
  }
}

function readStoredTodos(): TodoItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('cairn-codex-todos') ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is TodoItem => {
      if (!value || typeof value !== 'object') return false
      const todo = value as Partial<TodoItem>
      return typeof todo.id === 'string' && typeof todo.text === 'string' &&
        typeof todo.done === 'boolean' && typeof todo.createdAt === 'string'
    })
  } catch {
    return []
  }
}

function storeTodos(): void {
  localStorage.setItem('cairn-codex-todos', JSON.stringify(todos.value))
}

async function openTodos(): Promise<void> {
  todoOpen.value = true
  showConnectionDiagnostics.value = false
  await nextTick()
  todoInput.value?.focus()
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

function readStoredPlannerProfiles(): PlannerProfile[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('cairn-codex-planner-profiles') ?? '[]') as unknown
    if (Array.isArray(parsed)) {
      const profiles = parsed.filter((value): value is PlannerProfile => {
        if (!value || typeof value !== 'object') return false
        const profile = value as Partial<PlannerProfile>
        return typeof profile.id === 'string' && typeof profile.name === 'string' &&
          Array.isArray(profile.skills) && profile.skills.every((skill) => typeof skill === 'string') &&
          typeof profile.levelCap === 'number'
      }).map((profile) => ({
        ...profile,
        excludedSkills: Array.isArray(profile.excludedSkills) ? profile.excludedSkills : [],
        minimumLevel: typeof profile.minimumLevel === 'number'
          ? Math.min(100, Math.max(1, profile.minimumLevel))
          : 1,
        source: profile.source === 'character' ? 'character' as const : 'manual' as const,
        modifiedAt: profile.modifiedAt || new Date().toISOString()
      }))
      if (profiles.length > 0) return profiles
    }
  } catch {
    // Fall through to the legacy planner migration below.
  }
  const legacySkills = localStorage.getItem('cairn-codex-planner-skills') === null
    ? ['Wendigo Totem']
    : readStoredStringArray('cairn-codex-planner-skills')
  return [{
    id: crypto.randomUUID(),
    name: 'Current build',
    skills: legacySkills,
    excludedSkills: [],
    minimumLevel: 1,
    levelCap: readStoredPlannerLevelCap(),
    source: 'manual',
    modifiedAt: new Date().toISOString()
  }]
}

function readStoredPlannerProfileId(profiles: PlannerProfile[]): string {
  const stored = localStorage.getItem('cairn-codex-planner-profile')
  return profiles.some((profile) => profile.id === stored) ? stored! : profiles[0]?.id ?? ''
}

function readStoredPlannerDisplay(): PlannerDisplay {
  const stored = localStorage.getItem('cairn-codex-planner-display')
  return stored === 'grid' || stored === 'map' ? stored : 'list'
}

function readStoredOracleStyle(): OracleStyle {
  const stored = localStorage.getItem('cairn-codex-oracle-style')
  return stored === 'pets' || stored === 'retaliation' || stored === 'weapon' || stored === 'caster'
    ? stored
    : 'all'
}

function readStoredNumber(key: string, fallback: number, minimum: number, maximum: number): number {
  const stored = localStorage.getItem(key)
  if (stored === null) return fallback
  const value = Number(stored)
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback
}

function readStoredPlannerLevelCap(): number {
  const versionKey = 'cairn-codex-planner-level-cap-version'
  if (localStorage.getItem(versionKey) !== '1') {
    localStorage.setItem(versionKey, '1')
    localStorage.setItem('cairn-codex-planner-level-cap', '70')
    return 70
  }
  return readStoredNumber('cairn-codex-planner-level-cap', 70, 1, 100)
}

function storeSourcePaths(): void {
  const key =
    collectionBasis.value === 'archive'
      ? 'cairn-codex-archive-sources'
      : 'cairn-codex-index-sources'
  localStorage.setItem(key, JSON.stringify(enabledStashPaths.value))
}

async function toggleSourceForBasis(basis: CollectionBasis, path: string): Promise<void> {
  const target = basis === 'archive' ? archiveStashPaths : indexStashPaths
  target.value = target.value.includes(path)
    ? target.value.filter((candidate) => candidate !== path)
    : [...target.value, path]
  localStorage.setItem(
    basis === 'archive' ? 'cairn-codex-archive-sources' : 'cairn-codex-index-sources',
    JSON.stringify(target.value)
  )
  if (collectionBasis.value === basis) await loadSelectedSources()
}

async function selectSourceModeForBasis(basis: CollectionBasis, isHardcore: boolean): Promise<void> {
  const paths = stashChoices.value
    .filter((stash) => stash.isHardcore === isHardcore)
    .map((stash) => stash.path)
  const target = basis === 'archive' ? archiveStashPaths : indexStashPaths
  target.value = paths
  localStorage.setItem(
    basis === 'archive' ? 'cairn-codex-archive-sources' : 'cairn-codex-index-sources',
    JSON.stringify(paths)
  )
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
  localStorage.setItem('cairn-codex-archive-sources', JSON.stringify(archiveStashPaths.value))
  if (collectionBasis.value === 'archive') await loadSelectedSources()
}

function readStoredCollectionBasis(): CollectionBasis {
  const defaultVersionKey = 'cairn-codex-collection-basis-default-version'
  if (localStorage.getItem(defaultVersionKey) !== '2') {
    localStorage.setItem(defaultVersionKey, '2')
    localStorage.setItem('cairn-codex-collection-basis', 'archive')
    return 'archive'
  }
  return localStorage.getItem('cairn-codex-collection-basis') === 'stashes'
    ? 'stashes'
    : 'archive'
}

async function setCollectionBasis(basis: CollectionBasis): Promise<void> {
  if (collectionBasis.value === basis) return
  collectionBasis.value = basis
  localStorage.setItem('cairn-codex-collection-basis', basis)
  await loadSelectedSources()
}

function readStoredZoomFactor(): number {
  const stored = Number(localStorage.getItem('cairn-codex-zoom'))
  return Number.isFinite(stored) && stored >= 0.7 && stored <= 1.8 ? stored : 1
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  const stored = localStorage.getItem(key)
  return stored === null ? fallback : stored === 'true'
}

function readStoredTrackerCollapsed(): boolean {
  const versionKey = 'cairn-codex-tracker-layout-version'
  if (localStorage.getItem(versionKey) !== '2') {
    localStorage.setItem(versionKey, '2')
    localStorage.setItem('cairn-codex-tracker-collapsed', 'false')
    return false
  }
  return readStoredBoolean('cairn-codex-tracker-collapsed', false)
}

function setAutoLiveConnect(enabled: boolean): void {
  autoLiveConnect.value = enabled
  localStorage.setItem('cairn-codex-auto-live-connect', String(enabled))
  if (enabled) {
    manualDisconnectProcessId.value = null
    void pollLiveLifecycle()
  }
}

function setLegacyScannerVisible(enabled: boolean): void {
  showLegacyScanner.value = enabled
  localStorage.setItem('cairn-codex-show-legacy-scanner', String(enabled))
  if (!enabled && collectionBasis.value !== 'archive') void setCollectionBasis('archive')
}

function toggleTracker(): void {
  trackerCollapsed.value = !trackerCollapsed.value
  localStorage.setItem('cairn-codex-tracker-collapsed', String(trackerCollapsed.value))
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
  vaultError.value = null
  try {
    infiniteSupplies.value = await window.cairnCodex.setInfiniteSupplies(enabled)
    selectedSupplyIds.value = []
    await refreshVault()
  } catch (error) {
    vaultError.value = readableError(error)
  } finally {
    infiniteSuppliesBusy.value = false
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
    vaultMessage.value = 'Approved exact Game.dll ' + connectionFingerprint.value + '. Connect and perform a disposable round-trip test.'
  } catch (error) {
    vaultError.value = readableError(error)
  } finally {
    vaultBusy.value = false
  }
}

async function setZoom(factor: number): Promise<void> {
  zoomFactor.value = await window.cairnCodex.setZoomFactor(factor)
  localStorage.setItem('cairn-codex-zoom', String(zoomFactor.value))
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

async function hydrateArchiveRolls(): Promise<void> {
  if (archiveRollHydrating.value || collectionBasis.value !== 'archive' || !snapshot.value) return
  archiveRollHydrating.value = true
  const requestedSources = [...enabledStashPaths.value]
  try {
    let pending = 1
    while (pending > 0 && collectionBasis.value === 'archive' && liveStatus.value?.state !== 'ready') {
      const hydrated = await window.cairnCodex.hydrateArchiveRolls(requestedSources)
      if (
        !hydrated ||
        collectionBasis.value !== 'archive' ||
        JSON.stringify([...enabledStashPaths.value].sort()) !== JSON.stringify(requestedSources.sort())
      ) break
      applySnapshot(hydrated)
      pending = hydrated.rollHydrationPending ?? 0
      if (pending > 0) await new Promise((resolve) => setTimeout(resolve, 40))
    }
  } catch (error) {
    console.warn('Archived item rolls could not be hydrated in the background.', error)
  } finally {
    archiveRollHydrating.value = false
  }
}

function rarity(name: 'epic' | 'legendary' | 'mi'): CollectionRaritySummary | undefined {
  return snapshot.value?.rarities.find((summary) => summary.rarity === name)
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
  selectedSupplyIds.value = supplyVaultItems.value.filter((item) => item.eligible).map((item) => item.id)
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
  const normalize = (value: string): string => value.toLocaleLowerCase().replaceAll('’', "'").replace(/[^a-z0-9]/g, '')
  const faction = activeCharacter.value.factions.find((entry) => normalize(entry.name) === normalize(factionName))
  return Boolean(faction?.isUnlocked && faction.value >= threshold)
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
  if (!snapshot.value) return '0 / 0'
  const matches = snapshot.value.items.filter((item) => matchesCategory(item, category))
  return `${matches.filter((item) => item.discovered).length} / ${matches.length}`
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
  vaultError.value = null
  try {
    // Archive browsing must not depend on a legacy transfer-stash selection or on
    // the optional write-safety probe. In particular, live-ingested reusable
    // supplies should appear even when offline staging is not configured.
    const items = await window.cairnCodex.listVaultItems()
    vaultItems.value = items
    selectedVaultIds.value = selectedVaultIds.value.filter((id) =>
      items.some((item) => item.id === id && item.state === 'ingested')
    )
    selectedSupplyIds.value = selectedSupplyIds.value.filter((id) =>
      id.startsWith('augment:') ||
      items.some((item) => item.id === id && item.state === 'ingested' && item.rarity === 'supply')
    )
    const [safety, live] = await Promise.allSettled([
      window.cairnCodex.inspectWriteSafety(),
      window.cairnCodex.inspectLiveGame()
    ])
    if (safety.status === 'fulfilled') writeSafety.value = safety.value
    else console.warn('Offline write safety could not be refreshed.', safety.reason)
    if (live.status === 'fulfilled') liveStatus.value = live.value
    else console.warn('Live-game status could not be refreshed.', live.reason)
    if (selectedStashPath.value) await refreshStaging()
    else staging.value = null
  } catch (error) {
    vaultError.value = readableError(error)
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
  vaultError.value = null
  try {
    liveStatus.value = await window.cairnCodex.startLiveGame()
    if (liveStatus.value.state === 'ready') {
      vaultMessage.value = 'Live mode connected. Put an Epic, Legendary, or Monster Infrequent into the final shared stash tab to archive it instantly.'
    } else {
      vaultError.value = liveStatus.value.detail
    }
  } catch (error) {
    vaultError.value = readableError(error)
    liveStatus.value = await window.cairnCodex.inspectLiveGame()
  } finally {
    vaultBusy.value = false
  }
}

async function stopLiveMode(): Promise<void> {
  if (vaultBusy.value || liveLifecyclePolling.value) return
  liveLifecyclePolling.value = true
  manualDisconnectProcessId.value = liveStatus.value?.connectedProcessId ?? liveStatus.value?.grimDawnProcessIds[0] ?? null
  try {
    liveStatus.value = await window.cairnCodex.stopLiveGame()
    liveIssues.value = []
    vaultMessage.value = 'Live mode disconnected.'
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
        vaultMessage.value = 'Auto-connected to Grim Dawn. Live ingest is watching the configured stash tab.'
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
  }
}

async function syncLiveMode(): Promise<void> {
  if (liveStatus.value?.state !== 'ready' || liveSyncing.value || vaultBusy.value) return
  liveSyncing.value = true
  try {
    const result = await window.cairnCodex.syncLiveGame()
    liveStatus.value = result.status
    liveIssues.value = result.issues
    if (result.ingested.length > 0) {
      applyLiveIngests(result.ingested)
      vaultMessage.value = `Live-ingested ${result.ingested.map((item) => item.name).join(', ')}.`
      await refreshVault()
      void hydrateArchiveRolls()
    }
  } catch (error) {
    const message = readableError(error)
    if (!message.includes('Another vault write is already in progress')) liveIssues.value = [message]
  } finally {
    liveSyncing.value = false
  }
}

async function retrieveSelectedLive(): Promise<void> {
  if (selectedVaultIds.value.length === 0 || vaultBusy.value) return
  const count = selectedVaultIds.value.length
  const selected = selectedVaultIds.value.map((id) => vaultItems.value.find((item) => item.id === id))
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
  vaultError.value = null
  vaultMessage.value = null
  try {
    const result = await window.cairnCodex.retrieveLiveVaultItems([...selectedVaultIds.value])
    applyLiveRetrievals(result.retrieved)
    vaultMessage.value = result.issues.length
      ? `${reusable ? 'Dispensed' : 'Live-retrieved'} ${result.retrieved.length} item${result.retrieved.length === 1 ? '' : 's'}; stopped safely: ${result.issues[0]}`
      : `${reusable ? 'Dispensed' : 'Live-retrieved'} ${result.retrieved.length} item${result.retrieved.length === 1 ? '' : 's'} into Grim Dawn${reusable ? '; the unlocks remain in Cairn.' : '.'}`
    const retrievedIds = new Set(result.retrieved.map((item) => item.vaultItemId))
    selectedVaultIds.value = selectedVaultIds.value.filter((id) => !retrievedIds.has(id))
    await refreshVault()
  } catch (error) {
    vaultError.value = readableError(error)
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
    vaultError.value = 'Soulbound augments require a live Grim Dawn connection and are delivered to the active character.'
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
    vaultError.value = null
    vaultMessage.value = null
    try {
      const result = await window.cairnCodex.dispenseLiveAugments(
        factionAugments.map((item) => item.record),
        activeCharacter.value?.name
      )
      const delivered = new Set(result.dispensed.map((item) => `augment:${item.record}`))
      selectedSupplyIds.value = selectedSupplyIds.value.filter((id) => !delivered.has(id))
      const deliveredNames = result.dispensed.map((item) => item.name).join(', ')
      vaultMessage.value = result.issues.length
        ? `Delivered ${result.dispensed.length} augment${result.dispensed.length === 1 ? '' : 's'} to ${result.activeCharacter} (${deliveredNames}); stopped safely: ${result.issues[0]}`
        : `Delivered exactly ${result.dispensed.length} augment${result.dispensed.length === 1 ? '' : 's'} directly to ${result.activeCharacter}: ${deliveredNames}.`
    } catch (error) {
      vaultError.value = readableError(error)
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
    (item) => !vaultItems.value.find((vaultItem) => vaultItem.id === item.vaultItemId)?.reusable
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
  const rarities = (['epic', 'legendary', 'mi'] as const).map((rarity) => {
    const items = value.items.filter((item) => item.rarity === rarity)
    return {
      rarity,
      total: items.length,
      collected: items.filter((item) => item.discovered).length,
      availableCopies: items.reduce((sum, item) => sum + item.availableCount, 0)
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
    vaultError.value = readableError(error)
  }
}

async function ingestStagingTab(): Promise<void> {
  if (!staging.value || staging.value.itemCount === 0 || vaultBusy.value) return
  const confirmed = window.confirm(
    `Ingest ${staging.value.itemCount} item${staging.value.itemCount === 1 ? '' : 's'} from the final shared stash tab? A verified backup will be created first.`
  )
  if (!confirmed) return
  vaultBusy.value = true
  vaultError.value = null
  vaultMessage.value = null
  try {
    const result = await window.cairnCodex.ingestStagingTab(selectedStashPath.value)
    vaultMessage.value = `Safely ingested ${result.ingested.length} item${result.ingested.length === 1 ? '' : 's'}. Backup: ${result.backupPath}`
    await scanCollection()
    await refreshVault()
  } catch (error) {
    vaultError.value = readableError(error)
    await refreshVault()
  } finally {
    vaultBusy.value = false
  }
}

async function retrieveSelected(): Promise<void> {
  if (selectedVaultIds.value.length === 0 || vaultBusy.value) return
  const selected = selectedVaultIds.value.map((id) => vaultItems.value.find((item) => item.id === id))
  const reusable = selected.every((item) => item?.reusable)
  const supplies = selected.every((item) => item?.rarity === 'supply')
  const confirmed = window.confirm(reusable
    ? `Dispense ${selectedVaultIds.value.length} reusable ${selectedVaultIds.value.length === 1 ? 'supply' : 'supplies'} into the empty final shared stash tab? The Codex unlocks remain available and a verified backup will be created first.`
    : supplies
      ? `Return ${selectedVaultIds.value.length} stored ${selectedVaultIds.value.length === 1 ? 'supply' : 'supplies'} into the empty final shared stash tab? Infinite supplies are disabled, so this consumes the archived ${selectedVaultIds.value.length === 1 ? 'stack' : 'stacks'}.`
    : `Retrieve ${selectedVaultIds.value.length} item${selectedVaultIds.value.length === 1 ? '' : 's'} into the empty final shared stash tab? A verified backup will be created first.`)
  if (!confirmed) return
  vaultBusy.value = true
  vaultError.value = null
  vaultMessage.value = null
  try {
    const result = await window.cairnCodex.retrieveVaultItems(
      selectedStashPath.value,
      selectedVaultIds.value
    )
    selectedVaultIds.value = []
    vaultMessage.value = reusable
      ? `Dispensed ${result.retrieved.length} reusable ${result.retrieved.length === 1 ? 'supply' : 'supplies'}; the unlocks remain in Cairn. Backup: ${result.backupPath}`
      : `Safely retrieved ${result.retrieved.length} item${result.retrieved.length === 1 ? '' : 's'}. Backup: ${result.backupPath}`
    await scanCollection()
    await refreshVault()
  } catch (error) {
    vaultError.value = readableError(error)
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
    comparison = Number(Boolean(left.discovered)) - Number(Boolean(right.discovered))
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
  const matches = vaultItems.value.filter(
    (item) =>
      item.catalogued &&
      item.state === 'ingested' &&
      item.baseRecord.toLocaleLowerCase() === record.toLocaleLowerCase() &&
      (snapshot.value?.isHardcore === undefined || item.isHardcore === snapshot.value.isHardcore)
  )
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
    (collectionBasis.value === 'archive' && Boolean(item.discovered))
}

function plannerOwnershipLabel(item: CollectionItem): string | null {
  if (archivedRecordSet.value.has(item.record.toLocaleLowerCase())) return 'Archived'
  if (item.recipeUnlocked) return 'Recipe learned'
  if (collectionBasis.value === 'archive' && item.discovered) return 'Archived'
  return null
}

function normalizeLoose(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '')
}

function matchesPlannerQuery(item: CollectionItem, rawQuery: string): boolean {
  const needle = normalizeLoose(rawQuery)
  if (!needle) return true
  const haystack = [
    item.name,
    item.itemClass,
    item.slot,
    item.rarity,
    item.presentation?.searchText,
    ...(item.acquisition?.sources ?? []),
    ...(item.acquisition?.locations ?? []).map((location) => location.name)
  ].filter(Boolean).join(' ')
  return normalizeLoose(haystack).includes(needle)
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

function matchesSearch(item: CollectionItem, normalizedQuery: string): boolean {
  const tokens = normalizedQuery.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
  const fields: Record<string, string> = {
    name: item.name,
    set: item.setName ?? '',
    skill: skillSearchText(item),
    slot: item.slot,
    type: item.itemClass,
    rarity: item.rarity,
    pack: item.contentPack
  }
  const everything = [
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
        tier.grantedSkill?.name,
        tier.grantedSkill?.description,
        tier.grantedSkill?.trigger,
        ...(tier.grantedSkill?.lines.map((line) => formatPresentationLine(line)) ?? [])
      ]
    ) ?? [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()

  return tokens.every((rawToken) => {
    const token = rawToken.replaceAll('"', '')
    const separator = token.indexOf(':')
    if (separator < 1) return everything.includes(token)
    const field = token.slice(0, separator)
    const value = token.slice(separator + 1)
    if (field === 'level') return matchesLevel(item.levelRequirement, value)
    return fields[field]?.toLocaleLowerCase().includes(value) ?? false
  })
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
    granted?.name,
    granted?.description,
    granted?.trigger,
    ...((granted?.lines ?? []).map((line) => line.label))
  ]
    .filter(Boolean)
    .join(' ')
}

function matchesLevel(level: number, expression: string): boolean {
  const match = /^(>=|<=|>|<|=)?(\d+)$/.exec(expression)
  if (!match) return false
  const target = Number(match[2])
  if (match[1] === '>=') return level >= target
  if (match[1] === '<=') return level <= target
  if (match[1] === '>') return level > target
  if (match[1] === '<') return level < target
  return level === target
}

function queueTooltip(item: CollectionItem, event: MouseEvent | FocusEvent): void {
  cancelTooltipHide()
  cancelTooltip()
  positionTooltip(event)
  tooltipTimer = setTimeout(() => {
    tooltipDetailsHeld.value = false
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

function vaultCopyForObserved(copy: ObservedStashItem): VaultListItem | null {
  if (!copy.sourcePath.startsWith('vault://')) return null
  const id = copy.sourcePath.slice('vault://'.length)
  return vaultItems.value.find((item) => item.id === id && item.state === 'ingested') ?? null
}

function copyAffixName(record: string, emptyLabel: string): string {
  if (!record) return emptyLabel
  return affixByRecord.value.get(record.toLocaleLowerCase())?.name ??
    record.replaceAll('\\', '/').split('/').at(-1)?.replace(/\.dbr$/i, '') ?? record
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

function presentRolledStats(source: RolledStat[] | undefined, includeFixed = false) {
  const stats = (source ?? [])
    .filter((stat) => includeFixed || stat.estimatedPercentile !== null)
  const byField = new Map(stats.map((stat) => [stat.field, stat]))
  const consumed = new Set<string>()
  return stats
    .flatMap((stat) => {
      if (consumed.has(stat.field)) return []
      if (stat.field.endsWith('Min')) {
        const root = stat.field.slice(0, -3)
        const maximum = byField.get(root + 'Max')
        if (maximum && (includeFixed || maximum.estimatedPercentile !== null)) {
          consumed.add(maximum.field)
          const valueLabel =
            stat.value === maximum.value
              ? formatRollValue(stat.value)
              : `${formatRollValue(stat.value)}–${formatRollValue(maximum.value)}`
          return [
            {
              key: root,
              label: humanStatName(root),
              valueLabel,
              percentile: stat.estimatedPercentile === null || maximum.estimatedPercentile === null
                ? null
                : (stat.estimatedPercentile + maximum.estimatedPercentile) / 2,
              rangeLabel: `${formatRollValue(stat.observedMinimum ?? stat.value)}–${formatRollValue(maximum.observedMaximum ?? maximum.value)}`
            }
          ]
        }
      }
      return [
        {
          key: stat.field,
          label: humanStatName(stat.field),
          valueLabel: formatRollValue(stat.value),
          percentile: stat.estimatedPercentile!,
          rangeLabel: `${formatRollValue(stat.observedMinimum ?? stat.value)}–${formatRollValue(stat.observedMaximum ?? stat.value)}`
        }
      ]
    })
    .sort((left, right) => left.label.localeCompare(right.label))
}

function rollableStats(copy: ObservedStashItem) {
  return presentRolledStats(copy.rollAnalysis?.stats)
}

function petRollableStats(copy: ObservedStashItem) {
  return presentRolledStats(copy.rollAnalysis?.petStats, true)
}

function humanStatName(field: string): string {
  const names: Record<string, string> = {
    characterAttackSpeedModifier: 'Attack speed',
    characterSpellCastSpeedModifier: 'Cast speed',
    characterIntelligence: 'Spirit',
    characterLifeModifier: 'Health',
    characterDefensiveAbility: 'Defensive ability',
    characterOffensiveAbility: 'Offensive ability',
    characterOffensiveAbilityModifier: 'Offensive ability',
    conversionPercentage: 'Damage conversion',
    offensiveTotalDamageModifier: 'All damage',
    offensiveFireModifier: 'Fire damage',
    offensiveSlowFire: 'Burn damage',
    offensiveSlowFireModifier: 'Burn damage bonus'
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
  <div class="app-shell" :data-cache-issue="cacheIssue">
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
              <button type="button" :disabled="vaultBusy || liveLifecyclePolling" @click="handleHeaderLiveAction">{{ headerConnectionAction }}</button>
              <button v-if="canApproveCurrentGameBuild" type="button" :disabled="vaultBusy" @click="approveCurrentGameBuild">Trust exact build…</button>
              <button type="button" @click="activeView = 'vault'; transferMode = 'live'; showConnectionDiagnostics = false">Transfers</button>
              <button type="button" @click="activeView = 'settings'; showConnectionDiagnostics = false">Settings</button>
            </footer>
          </aside>
        </div>
      </div>
    </header>

    <aside class="growl-stack" aria-live="polite" aria-label="Notifications">
      <article v-if="vaultError" class="growl error">
        <span><strong>Transfer problem</strong>{{ vaultError }}</span>
        <button type="button" aria-label="Dismiss notification" @click="vaultError = null">×</button>
      </article>
      <article v-if="scanError" class="growl error">
        <span><strong>Collection scan</strong>{{ scanError }}</span>
        <button type="button" aria-label="Dismiss notification" @click="scanError = null">×</button>
      </article>
      <article v-if="vaultMessage" class="growl success">
        <span><strong>Done</strong>{{ vaultMessage }}</span>
        <button type="button" aria-label="Dismiss notification" @click="vaultMessage = null">×</button>
      </article>
    </aside>

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

    <main>
      <section v-if="(scanning || archiveRollHydrating) && snapshot" class="background-scan" aria-live="polite">
        <span class="scan-spinner" aria-hidden="true" />
        <div>
          <strong>{{ archiveRollHydrating ? 'Rating archived item rolls' : scanActivity === 'game-data' ? 'Rebuilding the game-data index' : 'Refreshing collection in the background' }}</strong>
          <small v-if="archiveRollHydrating">The Codex remains usable while missing copy scores are calculated and saved.</small>
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
              {{ snapshot?.items.length.toLocaleString() ?? 0 }} catalog entries
            </template>
            <template v-else>
              Locating Grim Dawn, its item database, and transfer stashes.
            </template>
          </p>
        </div>
        <button class="primary-action" type="button" :disabled="scanning" @click="scanCollection">
          {{ scanning ? 'Reading the archives…' : 'Refresh collection' }}
        </button>
      </section>

      <section class="completion-tracker" aria-label="Collection completion">
        <header>
          <div><p class="section-label">Collection progress</p><strong>{{ allItemSummary.collected }} / {{ allItemSummary.total }} item bases</strong></div>
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
            {{ percentage(allItemSummary) }} discovered · Epic, Legendary, and MI bases
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
            <span>MI Bases</span>
            <strong>{{ rarity('mi')?.collected ?? 0 }} / {{ rarity('mi')?.total ?? '—' }}</strong>
          </div>
          <div class="meter mi"><span :style="{ width: percentage(rarity('mi')) }" /></div>
          <small>
            {{ percentage(rarity('mi')) }} discovered · level tiers tracked separately
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
            {{ percentage(setSummary) }} complete · {{ setSummary.availableCopies }} ready to equip
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
      <nav class="workspace-tabs" aria-label="Cairn Codex workspace">
        <button type="button" :class="{ active: activeView === 'collection' }" @click="activeView = 'collection'">
          <span>Collection</span><small>Items and copies</small>
        </button>
        <button type="button" :class="{ active: activeView === 'sets' }" @click="activeView = 'sets'">
          <span>Sets</span><small>{{ collectionSets.length }} catalogued</small>
        </button>
        <button type="button" :class="{ active: activeView === 'materials' }" @click="openMaterials()">
          <span>Components & Consumables</span><small>{{ componentSummary.collected + consumableSummary.collected }} discovered</small>
        </button>
        <button type="button" :class="{ active: activeView === 'skills' }" @click="activeView = 'skills'">
          <span>Skill Explorer</span><small>{{ skillNames.length }} skills indexed</small>
        </button>
        <button type="button" :class="{ active: activeView === 'oracle' }" @click="openStashOracle">
          <span>Stash Oracle</span><small>{{ oracleReadinessCounts.ready }} builds ready now</small>
        </button>
        <button type="button" :class="{ active: activeView === 'planner' }" @click="activeView = 'planner'">
          <span>Leveling Planner</span><small>{{ plannerSkills.length }} skills · Lv{{ plannerMinimumLevel }}–{{ plannerLevelCap }}</small>
        </button>
        <button type="button" :class="{ active: activeView === 'mi-workshop' }" @click="activeView = 'mi-workshop'">
          <span>MI Workshop</span><small>{{ miWorkshopRows.length }} affix combinations</small>
        </button>
        <button type="button" :class="{ active: activeView === 'supplies' }" @click="openSupplies">
          <span>Supplies</span><small>{{ reusableSupplySummary.collected }} / {{ reusableSupplySummary.total || '—' }} reusable unlocks</small>
        </button>
        <button type="button" :class="{ active: activeView === 'farming' }" @click="activeView = 'farming'">
          <span>Collection Farming</span><small>{{ farmTargets.length }} useful areas</small>
        </button>
        <button type="button" :aria-expanded="todoOpen" @click="openTodos">
          <span>To-do</span><small>{{ remainingTodoCount }} remaining</small>
        </button>
      </nav>

      <nav v-if="activeView === 'collection'" class="category-tabs" aria-label="Item categories">
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

      <section v-if="activeView === 'collection' || activeView === 'sets' || activeView === 'materials'" class="filter-bar" aria-label="Collection filters">
        <label class="search-field">
          <span class="sr-only">Search collection</span>
          <input
            v-model="query"
            type="search"
            placeholder="Search names, stats, skills…  (try skill:wendigo)"
          />
        </label>
        <div v-if="activeView === 'collection' || activeView === 'materials'" class="segmented-control" aria-label="Collection status filter">
          <button
            v-for="option in (['all', 'owned', 'missing'] as OwnershipFilter[])"
            :key="option"
            type="button"
            :class="{ active: ownership === option }"
            @click="ownership = option"
          >
            {{ option === 'all' ? 'All' : option === 'owned' ? 'Collected' : 'Missing' }}
          </button>
        </div>
        <div v-else-if="activeView === 'sets'" class="segmented-control set-progress-filter" aria-label="Set completion filter">
          <button
            v-for="option in (['all', 'complete', 'progress', 'unstarted'] as SetProgressFilter[])"
            :key="option"
            type="button"
            :class="{ active: setProgressFilter === option }"
            @click="setProgressFilter = option"
          >
            {{ option === 'all' ? 'All sets' : option === 'progress' ? 'In progress' : option === 'unstarted' ? 'Unstarted' : 'Complete' }}
          </button>
        </div>
        <div v-if="activeView === 'materials'" class="segmented-control" aria-label="Material category">
          <button type="button" :class="{ active: materialCategory === 'all' }" @click="materialCategory = 'all'">All</button>
          <button type="button" :class="{ active: materialCategory === 'component' }" @click="materialCategory = 'component'">Components</button>
          <button type="button" :class="{ active: materialCategory === 'material' }" @click="materialCategory = 'material'">Materials</button>
          <button type="button" :class="{ active: materialCategory === 'potion-formula' }" @click="materialCategory = 'potion-formula'">Potion formulas</button>
        </div>
        <select v-if="activeView !== 'materials'" v-model="rarityFilter" aria-label="Rarity">
          <option value="all">All rarities</option>
          <option value="legendary">Legendary</option>
          <option value="epic">Epic</option>
          <option value="mi">Monster Infrequent</option>
          <option value="rare">Rare recipe item</option>
          <option value="recipe">Craftable from recipe</option>
        </select>
        <select v-if="activeView === 'collection' || activeView === 'materials'" v-model="sortMode" aria-label="Sort collection">
          <option value="recent">Recently collected</option>
          <option value="completion">Collected status</option>
          <option value="name">Name</option>
          <option value="level">Level</option>
          <option value="roll">Best roll</option>
        </select>
        <select v-if="activeView === 'collection' || activeView === 'materials'" v-model="sortDirection" class="sort-direction" aria-label="Sort direction">
          <option value="asc">↑ Ascending</option>
          <option value="desc">↓ Descending</option>
        </select>
        <select v-if="activeView === 'sets'" v-model="setSortMode" aria-label="Sort sets">
          <option value="completion">Completion</option>
          <option value="level">Required level</option>
          <option value="name">Name</option>
        </select>
        <select v-if="activeView === 'sets'" v-model="setSortDirection" class="sort-direction" aria-label="Set sort direction">
          <option value="asc">↑ Ascending</option>
          <option value="desc">↓ Descending</option>
        </select>
        <span class="result-count">{{ displayedResultCount.toLocaleString() }} results</span>
      </section>

      <section v-if="activeView === 'skills'" class="skill-explorer" aria-label="Skill item explorer">
        <header class="skill-explorer-heading">
          <div>
            <p class="section-label">Build research prototype</p>
            <h2>Items for a skill</h2>
            <p>Choose a skill to compare direct rank bonuses, damage conversions, special modifiers, and level requirements.</p>
          </div>
          <div class="skill-scope segmented-control" aria-label="Skill item scope">
            <button type="button" :class="{ active: skillScope === 'archive' }" @click="skillScope = 'archive'">My Archive</button>
            <button type="button" :class="{ active: skillScope === 'all' }" @click="skillScope = 'all'">All catalog items</button>
          </div>
        </header>
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
          <div class="skill-match-count">
            <strong>{{ skillItemRows.length }}</strong>
            <span>matching items</span>
          </div>
        </div>
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
                    <span><strong>{{ row.item.name }}</strong><small>{{ row.item.rarity }}</small></span>
                  </div>
                </td>
                <td>{{ row.item.slot }}</td>
                <td class="skill-amount">{{ row.amount > 0 ? `+${row.amount}` : '—' }}</td>
                <td class="skill-conversion-target">{{ row.conversionTarget || '—' }}</td>
                <td>{{ row.conversionDetails || '—' }}</td>
                <td>{{ row.special || '—' }}</td>
                <td>{{ row.item.levelRequirement }}</td>
              </tr>
              <tr v-if="skillItemRows.length === 0"><td colspan="7" class="skill-empty">No matching items in this scope.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-else-if="activeView === 'oracle'" class="stash-oracle" aria-label="Stash Oracle build recommendations">
        <header class="tool-heading oracle-heading">
          <div>
            <p class="section-label">Archetype assembler</p>
            <h2>What build is your stash trying to make you play?</h2>
            <p>Cairn follows the mechanical evidence: archived skill modifiers, conversions, set progress, high-level MIs, and the slots those items need. Every recommendation shows its work.</p>
          </div>
          <button type="button" class="oracle-surprise" @click="surpriseMeWithOracle">Surprise me</button>
        </header>

        <div class="oracle-controls">
          <label>
            <span>Class</span>
            <select v-model="oracleClass">
              <option value="all">Any class</option>
              <option v-for="className in oracleClassOptions" :key="className" :value="className">{{ className }}</option>
            </select>
          </label>
          <label>
            <span>Build style</span>
            <select v-model="oracleStyle">
              <option value="all">Any style</option>
              <option value="pets">Pets</option>
              <option value="caster">Caster</option>
              <option value="weapon">Weapon</option>
              <option value="retaliation">Retaliation</option>
            </select>
          </label>
          <label class="oracle-level-control">
            <span>Item level</span>
            <span><input v-model.number="oracleMinimumLevel" type="number" min="1" :max="oracleMaximumLevel" aria-label="Minimum item level" /><b>to</b><input v-model.number="oracleMaximumLevel" type="number" :min="oracleMinimumLevel" max="100" aria-label="Maximum item level" /></span>
          </label>
          <label class="oracle-search">
            <span>Find an archetype</span>
            <input v-model="oracleQuery" type="search" placeholder="Skill, damage type, set, item…" />
          </label>
        </div>

        <div class="oracle-readiness-bar">
          <div class="segmented-control" aria-label="Build readiness">
            <button type="button" :class="{ active: oracleReadiness === 'all' }" @click="oracleReadiness = 'all'">All <small>{{ oracleCandidates.length }}</small></button>
            <button type="button" :class="{ active: oracleReadiness === 'ready' }" @click="oracleReadiness = 'ready'">Ready now <small>{{ oracleReadinessCounts.ready }}</small></button>
            <button type="button" :class="{ active: oracleReadiness === 'near' }" @click="oracleReadiness = 'near'">Nearly there <small>{{ oracleReadinessCounts.near }}</small></button>
            <button type="button" :class="{ active: oracleReadiness === 'wildcard' }" @click="oracleReadiness = 'wildcard'">Wild cards <small>{{ oracleReadinessCounts.wildcard }}</small></button>
          </div>
          <p>Scores measure archived mechanical support and equipability—not whether a build is fashionable.</p>
        </div>

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
                  <span><strong>{{ evidence.item.name }}</strong><small>{{ evidence.owned ? 'Archived' : 'Missing' }} · {{ evidence.reasons.slice(0, 2).join(' · ') }}</small></span>
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
        <header class="planner-heading">
          <div>
            <p class="section-label">Character shopping list</p>
            <h2>Leveling Planner</h2>
            <p>Pick the skills your character actually uses. Cairn merges their supporting MIs, Epics, Legendaries, and faction gear into one leveling route.</p>
          </div>
          <div class="segmented-control planner-display" aria-label="Planner display">
            <button type="button" :class="{ active: plannerDisplay === 'list' }" @click="plannerDisplay = 'list'">Table</button>
            <button type="button" :class="{ active: plannerDisplay === 'grid' }" @click="plannerDisplay = 'grid'">Cards</button>
            <button type="button" :class="{ active: plannerDisplay === 'map' }" @click="plannerDisplay = 'map'">MI sources</button>
          </div>
        </header>

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
          <div class="planner-filterbar">
            <input v-model="plannerQuery" type="search" placeholder="Filter items, monsters, areas… (try zarias)" />
            <div class="segmented-control" aria-label="Archive ownership">
              <button type="button" :class="{ active: plannerOwnership === 'all' }" @click="plannerOwnership = 'all'">All</button>
              <button type="button" :class="{ active: plannerOwnership === 'owned' }" @click="plannerOwnership = 'owned'">In Archive</button>
              <button type="button" :class="{ active: plannerOwnership === 'missing' }" @click="plannerOwnership = 'missing'">Not archived</button>
            </div>
            <button type="button" class="planner-ignored-filter" :class="{ active: plannerShowIgnored }" @click="plannerShowIgnored = !plannerShowIgnored">
              {{ plannerShowIgnored ? 'Back to list' : `Ignored (${plannerIgnoredRecords.length})` }}
            </button>
          </div>
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
          <div class="planner-map-toolbar">
            <div class="segmented-control" aria-label="MI map scope">
              <button type="button" :class="{ active: plannerMapScope === 'selected' }" @click="plannerMapScope = 'selected'">Selected build</button>
              <button type="button" :class="{ active: plannerMapScope === 'all' }" @click="plannerMapScope = 'all'">All MI tiers</button>
            </div>
            <input v-model="atlasRegionQuery" type="search" placeholder="Filter areas, MIs, or monsters…" />
            <span>{{ plannerMiItems.length }} MI tiers · {{ visibleAtlasRegions.length }} areas<span v-if="unlocatedPlannerMiItems.length"> · {{ unlocatedPlannerMiItems.length }} unlocated</span></span>
          </div>
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
        <header class="mi-workshop-heading">
          <div>
            <p class="section-label">Monster Infrequent research</p>
            <h2>MI Workshop</h2>
            <p>Each MI level tier is its own base entry. Affix combinations are grouped below, with the strongest rolled copy leading each group.</p>
          </div>
          <label class="reserve-toggle">
            <input v-model="showMiReserves" type="checkbox" />
            Show archived copies
          </label>
        </header>
        <div class="mi-workshop-summary">
          <span><strong>{{ rarity('mi')?.collected ?? 0 }}</strong> MI tiers collected</span>
          <span><strong>{{ snapshot?.affixSummary.collected ?? 0 }}</strong> affixes discovered</span>
          <span><strong>{{ miWorkshopRows.length }}</strong> combinations retained</span>
        </div>
        <div class="mi-workshop-controls">
          <label class="mi-workshop-search">
            <span>Search workshop</span>
            <input v-model="miWorkshopQuery" type="search" placeholder="Base, affix, stat, skill…" />
            <button v-if="miWorkshopQuery" type="button" aria-label="Clear Workshop search" @click="miWorkshopQuery = ''">×</button>
          </label>
          <label>
            <span>Compare copies by</span>
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
        </div>
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
              <tr v-for="row in miWorkshopRows" :key="`${row.base.record}|${row.prefix}|${row.suffix}`" @click="openItem(row.base)">
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
                <td colspan="6" class="skill-empty">{{ miWorkshopQuery ? `No stored MI matches “${miWorkshopQuery}”.` : 'Archive a Monster Infrequent to start building the Workshop.' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-else-if="activeView === 'supplies'" class="supplies-workspace" aria-label="Reusable supplies">
        <header class="tool-heading">
          <div>
            <p class="section-label">Reusable collection</p>
            <h2>Supplies</h2>
            <p>Archived faction boosts, difficulty merits, Nemesis warrants, and runes are reusable. Soulbound augments unlock per character from that character's faction reputation.</p>
          </div>
          <div class="tool-heading-summary">
            <strong>{{ reusableSupplySummary.collected }} / {{ reusableSupplySummary.total || '—' }} reusable unlocks</strong>
            <small>{{ supplyAccessSummary }}</small>
          </div>
        </header>
        <div class="supply-toolbar">
          <div class="segmented-control" aria-label="Supply category">
            <button type="button" :class="{ active: supplyCategory === 'writs' }" @click="supplyCategory = 'writs'; supplySlotFilter = 'all'; selectedSupplyIds = []">Boosts, merits & consumables</button>
            <button type="button" :class="{ active: supplyCategory === 'augments' }" @click="supplyCategory = 'augments'; selectedSupplyIds = []">Augments & runes</button>
          </div>
          <div v-if="supplyCategory === 'augments'" class="segmented-control supply-slot-filter" aria-label="Compatible equipment slot">
            <button type="button" :class="{ active: supplySlotFilter === 'all' }" @click="supplySlotFilter = 'all'">All slots</button>
            <button type="button" :class="{ active: supplySlotFilter === 'weapon' }" @click="supplySlotFilter = 'weapon'">Weapons</button>
            <button type="button" :class="{ active: supplySlotFilter === 'armor' }" @click="supplySlotFilter = 'armor'">Armor</button>
            <button type="button" :class="{ active: supplySlotFilter === 'jewelry' }" @click="supplySlotFilter = 'jewelry'">Jewelry</button>
          </div>
          <input v-model="reusableSupplyQuery" type="search" placeholder="Filter names, effects, factions…" />
          <button type="button" :disabled="!supplyVaultItems.length" @click="selectAllVisibleSupplies">Select visible</button>
          <button v-if="supplyCategory === 'writs'" type="button" :disabled="vaultBusy || !supplyVaultItems.length" @click="dispenseAllWrits">Dispense all unlocked faction boosts</button>
        </div>
        <div class="supply-status">
          <span :class="'state-' + connectionColorState">{{ transferMode === 'live' ? gameConnectionLabel : writeSafety?.permitted ? 'Offline staging ready' : 'Offline staging locked' }}</span>
          <div class="segmented-control" aria-label="Supply transfer method">
            <button type="button" :class="{ active: transferMode === 'live' }" @click="transferMode = 'live'">Live</button>
            <button type="button" :class="{ active: transferMode === 'offline' }" @click="transferMode = 'offline'">Offline</button>
          </div>
        </div>
        <div v-if="supplyVaultItems.length" class="supply-grid">
          <label
            v-for="item in supplyVaultItems"
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
        <p v-else class="vault-empty">{{ reusableSupplyQuery ? 'No unlocked supplies match this filter.' : 'No supplies unlocked in this category yet.' }}</p>
        <button
          class="supply-dispense"
          type="button"
          :disabled="vaultBusy || selectedSupplyIds.length === 0 || (supplyCategory === 'augments' && selectedSupplyIds.some((id) => id.startsWith('augment:')) ? liveStatus?.state !== 'ready' : transferMode === 'live' ? liveStatus?.state !== 'ready' : !writeSafety?.permitted || staging?.itemCount !== 0)"
          @click="retrieveSupplies"
        >{{ vaultBusy ? 'Verifying…' : (infiniteSupplies ? 'Dispense ' : 'Return ') + selectedSupplyIds.length + ' selected' }}</button>
      </section>

      <section v-else-if="activeView === 'farming'" class="farming-workspace" aria-label="Collection farming planner">
        <header class="tool-heading">
          <div>
            <p class="section-label">Collection completion</p>
            <h2>Where should I farm?</h2>
            <p>Areas are ranked by how many currently missing item bases their indexed enemies can drop.</p>
          </div>
          <strong>{{ farmTargets.length }} useful areas</strong>
        </header>
        <div class="farming-toolbar">
          <input v-model="farmingQuery" type="search" placeholder="Filter item, monster, or area…" />
          <select v-model="farmingRarity" aria-label="Rarity">
            <option value="all">All tracked rarities</option>
            <option value="mi">Monster Infrequents</option>
            <option value="epic">Epics</option>
            <option value="legendary">Legendaries</option>
          </select>
        </div>
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
        <header class="settings-heading">
          <div>
            <p class="section-label">Settings</p>
            <h2>Collection and transfer behavior</h2>
            <p>Long-lived choices live here. Search, filters, and sorting remain workspace controls.</p>
          </div>
        </header>

        <div class="settings-grid">
          <article class="settings-card">
            <p class="section-label">Live game</p>
            <h3>Connection lifecycle</h3>
            <label class="settings-toggle">
              <input
                type="checkbox"
                :checked="autoLiveConnect"
                @change="setAutoLiveConnect(($event.target as HTMLInputElement).checked)"
              />
              <span><strong>Auto-connect</strong><small>Connect when Grim Dawn starts and disconnect when it exits.</small></span>
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
        </div>
      </section>

      <section v-else-if="activeView === 'vault'" class="vault-workspace" aria-label="Item vault">
        <header class="vault-heading">
          <div>
            <p class="section-label">Transfers</p>
            <h2>Move items without losing them.</h2>
            <p>
              Live transfers operate while Grim Dawn is running. Offline staging provides the
              same verified archive and retrieval workflow directly against the shared stash file.
            </p>
          </div>
          <button type="button" :disabled="vaultBusy" @click="refreshVault">
            {{ vaultBusy ? 'Working…' : 'Recheck' }}
          </button>
        </header>

        <nav class="transfer-mode-tabs" aria-label="Transfer method">
          <button type="button" :class="{ active: transferMode === 'live' }" @click="transferMode = 'live'">
            <span><strong>Live game</strong><small>Watched tabs while Grim Dawn is running</small></span>
            <em :class="`state-${liveStatus?.state ?? 'unavailable'}`">{{ gameConnectionLabel }}</em>
          </button>
          <button type="button" :class="{ active: transferMode === 'offline' }" @click="transferMode = 'offline'">
            <span><strong>Offline staging</strong><small>Atomic shared-stash file operations</small></span>
            <em :class="{ ready: writeSafety?.permitted }">{{ writeSafety?.permitted ? 'Ready' : 'Locked' }}</em>
          </button>
        </nav>

        <article v-if="false" class="vault-panel reusable-supplies-panel">
          <header>
            <div>
              <p>Stored supplies</p>
              <h3>Faction boosts, difficulty merits, Nemesis warrants, augments, and runes</h3>
            </div>
            <strong>{{ supplyVaultItems.length }}</strong>
          </header>
          <p class="panel-help">
            <template v-if="infiniteSupplies">
              Ingest one supply to unlock it. Each dispense creates one usable copy while keeping the template safely available in Cairn.
            </template>
            <template v-else>
              Infinite supplies are disabled. Returning a supply consumes its stored stack; collection history remains tracked.
            </template>
          </p>
          <input
            v-model="reusableSupplyQuery"
            class="vault-search"
            type="search"
            placeholder="Filter unlocked supplies…"
          />
          <div v-if="supplyVaultItems.length" class="vault-item-list selectable reusable-supply-list">
            <label v-for="item in supplyVaultItems" :key="item.id" class="vault-row">
              <input
                type="checkbox"
                :checked="selectedSupplyIds.includes(item.id)"
                :disabled="vaultBusy"
                @change="toggleSupply(item.id)"
              />
              <div>
                <strong>{{ item.name }}</strong>
                <small>{{ item.isHardcore ? 'HC' : 'SC' }} · {{ item.slot === 'rune' ? 'movement rune' : item.slot }}</small>
              </div>
              <span class="reusable-mark">{{ item.reusable ? '∞' : 'stored' }}</span>
            </label>
          </div>
          <div v-else class="vault-empty">
            {{ reusableSupplyQuery ? 'No stored supplies match this filter.' : 'No supplies stored for this mode yet.' }}
          </div>
          <button
            class="vault-action"
            :class="{ 'live-action': transferMode === 'live' }"
            type="button"
            :disabled="vaultBusy || selectedSupplyIds.length === 0 || (transferMode === 'live' ? liveStatus?.state !== 'ready' : !writeSafety?.permitted || staging?.itemCount !== 0)"
            @click="retrieveSupplies"
          >
            {{ vaultBusy ? 'Verifying…' : selectedSupplyIds.length ? `${infiniteSupplies ? 'Dispense' : 'Return'} ${selectedSupplyIds.length} selected` : 'Select supplies' }}
          </button>
        </article>

        <template v-if="transferMode === 'live'">
        <section class="live-mode-card" :class="`state-${liveStatus?.state ?? 'unavailable'}`">
          <div class="live-mode-status">
            <span class="status-dot" :class="{ dim: liveStatus?.state !== 'ready' }" />
            <div>
              <p class="section-label">Live game adapter</p>
              <h3>{{ liveStatus?.state === 'ready' ? 'Connected to Grim Dawn' : 'Optional live transfers' }}</h3>
              <small>{{ liveStatus?.detail || 'Checking the bundled Cairn live adapter…' }}</small>
              <small v-if="liveStatus?.hookVersion">Hook {{ liveStatus.hookVersion }}</small>
            </div>
          </div>
          <div class="live-mode-actions">
            <label class="live-auto-toggle">
              <input
                type="checkbox"
                :checked="autoLiveConnect"
                @change="setAutoLiveConnect(($event.target as HTMLInputElement).checked)"
              />
              <span>Auto-connect</span>
            </label>
            <button
              v-if="liveStatus?.state !== 'ready'"
              type="button"
              :disabled="vaultBusy || liveLifecyclePolling || liveStatus?.state === 'unavailable' || liveStatus?.state === 'blocked'"
              @click="startLiveMode"
            >
              {{ liveStatus?.state === 'connecting' ? 'Connecting…' : 'Enable live mode' }}
            </button>
            <button v-else type="button" :disabled="vaultBusy || liveLifecyclePolling" @click="stopLiveMode">
              Disconnect
            </button>
          </div>
          <div v-if="liveStatus?.state === 'ready'" class="live-ready-instructions">
            <strong>{{ liveSyncing ? 'Checking queue…' : `Watching the ${liveStatus.ingestTabDescription}` }}</strong>
            <small>Retrieval target: {{ liveStatus.depositTabDescription }}.</small>
              <small>Place equipment, faction boosts, difficulty merits, Nemesis warrants, augments, or movement runes in the watched tab.</small>
          </div>
        </section>
        <p v-for="issue in liveIssues" :key="issue" class="vault-notice error">{{ issue }}</p>

        <section v-if="quarantinedVaultItems.length" class="vault-quarantine">
          <header>
            <div>
              <p class="section-label">Recovery quarantine</p>
              <h3>{{ quarantinedVaultItems.length }} non-catalog item{{ quarantinedVaultItems.length === 1 ? '' : 's' }} safely stored</h3>
            </div>
          </header>
          <p>
            Cairn intercepted these items but they are outside the Epic/Legendary/MI collection.
            Select them and use live return; their verified receipt remains on disk until the return is acknowledged.
          </p>
          <div class="vault-item-list selectable">
            <label v-for="item in quarantinedVaultItems" :key="item.id" class="vault-row unsupported">
              <input
                type="checkbox"
                :checked="selectedVaultIds.includes(item.id)"
                :disabled="vaultBusy"
                @change="toggleVaultItem(item.id)"
              />
              <div>
                <strong>{{ item.name }}</strong>
                <small>{{ item.isHardcore ? 'HC' : 'SC' }} · {{ item.baseRecord }} · seed {{ item.seed }}</small>
              </div>
            </label>
          </div>
          <button
            class="vault-action live-action"
            type="button"
            :disabled="vaultBusy || liveStatus?.state !== 'ready' || selectedVaultIds.length === 0 || selectedVaultIds.some((id) => !quarantinedVaultItems.some((item) => item.id === id))"
            @click="retrieveSelectedLive"
          >
            {{ vaultBusy ? 'Waiting for game…' : `Live-return ${selectedVaultIds.length || ''} selected` }}
          </button>
        </section>

        <article class="vault-panel live-stored-panel">
          <header>
            <div>
              <p>Codex Archive</p>
              <h3>Return a stored copy to the game</h3>
            </div>
            <strong>{{ availableVaultItems.length }}</strong>
          </header>
          <p class="panel-help">
            Select one or more copies. Cairn sends them one at a time to {{ liveStatus?.depositTabDescription ?? 'the live deposit tab' }}
            and commits each return only after the game acknowledges receipt.
          </p>
          <div v-if="availableVaultItems.length" class="vault-item-list selectable">
            <label v-for="item in availableVaultItems" :key="item.id" class="vault-row">
              <input
                type="checkbox"
                :checked="selectedVaultIds.includes(item.id)"
                :disabled="vaultBusy"
                @change="toggleVaultItem(item.id)"
              />
              <div>
                <strong>{{ item.name }}</strong>
                <small>{{ item.isHardcore ? 'HC' : 'SC' }} · {{ item.rarity }} · seed {{ item.seed }}</small>
              </div>
            </label>
          </div>
          <div v-else class="vault-empty">No archived items are waiting.</div>
          <button
            class="vault-action live-action"
            type="button"
            :disabled="vaultBusy || liveStatus?.state !== 'ready' || selectedVaultIds.length === 0 || selectedVaultIds.some((id) => !availableVaultItems.some((item) => item.id === id))"
            @click="retrieveSelectedLive"
          >
            {{ vaultBusy ? 'Waiting for game…' : selectedVaultIds.length ? `Return ${selectedVaultIds.length} selected live` : 'Select stored copies' }}
          </button>
        </article>
        </template>

        <section v-if="false" class="source-selector" aria-label="Collection stash sources">
          <header>
            <div>
              <p class="section-label">Collection sources</p>
              <h3>Choose which stashes count.</h3>
              <small>Hardcore and Softcore remain separate unless you explicitly select both.</small>
            </div>
            <div class="source-presets">
              <button type="button" @click="selectSourceMode(false)">Softcore only</button>
              <button type="button" @click="selectSourceMode(true)">Hardcore only</button>
            </div>
          </header>
          <div class="source-options">
            <label v-for="stash in stashChoices" :key="stash.path" class="source-option">
              <input
                type="checkbox"
                :checked="enabledStashPaths.includes(stash.path)"
                :disabled="enabledStashPaths.length === 1 && enabledStashPaths.includes(stash.path)"
                @change="toggleCollectionSource(stash.path)"
              />
              <span :class="stash.isHardcore ? 'hardcore' : 'softcore'">
                {{ stash.isHardcore ? 'HC' : 'SC' }}
              </span>
              <div>
                <strong>{{ stash.modLabel || 'Base game' }}</strong>
                <small>{{ stash.itemCount }} items · {{ stash.path }}</small>
              </div>
            </label>
          </div>
        </section>

        <template v-if="transferMode === 'offline'">
        <div class="vault-target">
          <label>
            <span>Shared stash</span>
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

        <div class="vault-columns">
          <article class="vault-panel staging-panel">
            <header>
              <div>
                <p>Final stash tab</p>
                <h3>Staged for ingest</h3>
              </div>
              <strong>{{ staging?.itemCount ?? '—' }}</strong>
            </header>
            <p class="panel-help">
              Put equipment or reusable supplies you want archived into tab
              {{ staging ? staging.tabIndex + 1 : '—' }}.
            </p>
            <div v-if="staging?.items.length" class="vault-item-list">
              <div
                v-for="item in staging.items"
                :key="`${item.itemIndex}:${item.seed}`"
                class="vault-row"
                :class="{ unsupported: !item.supported }"
              >
                <span class="item-rune">{{ item.supported ? '◆' : '!' }}</span>
                <div>
                  <strong>{{ item.name }}</strong>
                  <small>Seed {{ item.seed }}{{ item.supported ? '' : ' · not supported by the Codex' }}</small>
                </div>
              </div>
            </div>
            <div v-else class="vault-empty">The staging tab is empty.</div>
            <button
              class="vault-action"
              type="button"
              :disabled="Boolean(ingestBlockedReason)"
              :title="ingestBlockedReason ?? 'Archive the staged items in Cairn Codex.'"
              @click="ingestStagingTab"
            >
              {{ vaultBusy ? 'Verifying…' : `Ingest ${staging?.itemCount ?? 0} staged` }}
            </button>
            <p v-if="ingestBlockedReason" class="action-blocked-reason">{{ ingestBlockedReason }}</p>
          </article>

          <article class="vault-panel">
            <header>
              <div>
                <p>Codex vault</p>
                <h3>Stored copies</h3>
              </div>
              <strong>{{ availableVaultItems.length }}</strong>
            </header>
            <p class="panel-help">
              These copies are already part of the Codex Archive. Selecting one retrieves it out to the game; no filing step is required.
            </p>
            <div v-if="availableVaultItems.length" class="vault-item-list selectable">
              <label v-for="item in availableVaultItems" :key="item.id" class="vault-row">
                <input
                  type="checkbox"
                  :checked="selectedVaultIds.includes(item.id)"
                  :disabled="vaultBusy"
                  @change="toggleVaultItem(item.id)"
                />
                <div>
                  <strong>{{ item.name }}</strong>
                  <small>{{ item.isHardcore ? 'HC' : 'SC' }} · {{ item.rarity }} · seed {{ item.seed }}</small>
                </div>
              </label>
            </div>
            <div v-else class="vault-empty">No archived items are waiting.</div>
            <button
              class="vault-action"
              type="button"
              :disabled="vaultBusy || !writeSafety?.permitted || staging?.itemCount !== 0 || selectedVaultIds.length === 0"
              @click="retrieveSelected"
            >
              {{ vaultBusy ? 'Verifying…' : `Retrieve ${selectedVaultIds.length} selected` }}
            </button>
          </article>
        </div>
        </template>

        <section v-if="retrievedVaultItems.length" class="vault-history">
          <div>
            <p class="section-label">History</p>
            <h3>Previously retrieved</h3>
          </div>
          <div class="history-chips">
            <span v-for="item in retrievedVaultItems" :key="item.id">
              {{ item.isHardcore ? 'HC' : 'SC' }} · {{ item.name }} · seed {{ item.seed }}
            </span>
          </div>
        </section>
      </section>

      <section v-else-if="!snapshot && scanning" class="empty-state">
        <div class="sigil loading" aria-hidden="true">C</div>
        <h3>Opening the Codex</h3>
        <p>Parsing the game database and your transfer stashes.</p>
      </section>

      <section v-else-if="activeView === 'sets'" class="set-grid" aria-label="Item sets">
        <article v-for="set in visibleSets" :key="set.record" class="set-card">
          <header>
            <div>
              <p>Item set</p>
              <h3>{{ set.name }}</h3>
              <small class="set-level">{{ setLevelLabel(set) }}</small>
            </div>
            <strong :class="{ complete: set.collected === set.items.length }">
              {{ set.collected }} / {{ set.items.length }}
            </strong>
            <span class="set-percentage">{{ setCompletionPercent(set) }}</span>
          </header>
          <div class="set-meter">
            <span :style="{ width: `${(set.collected / set.items.length) * 100}%` }" />
          </div>
          <ul>
            <li v-for="item in set.items" :key="item.record" :class="{ missing: !item.discovered }">
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
                <span aria-hidden="true">{{ item.discovered ? '✓' : '○' }}</span>
                <div><strong>{{ item.name }}</strong><small>{{ item.slot }}</small></div>
                <em v-if="item.availableCount > 0">×{{ item.availableCount }}</em>
              </button>
            </li>
          </ul>
          <div v-if="set.items[0]?.setPresentation?.tiers.length" class="set-bonus-tiers">
            <section
              v-for="tier in set.items[0]?.setPresentation?.tiers"
              :key="tier.requiredPieces"
              :class="{ unlocked: set.collected >= tier.requiredPieces }"
            >
              <h4>({{ tier.requiredPieces }}) Set</h4>
              <p v-for="(line, index) in tier.lines" :key="`${line.label}:${index}`">
                {{ formatPresentationLine(line) }}
              </p>
              <div v-if="tier.petLines?.length" class="set-tier-group">
                <h5>Bonus to All Pets</h5>
                <p v-for="(line, index) in tier.petLines" :key="`pet:${line.label}:${index}`">
                  {{ formatPresentationLine(line) }}
                </p>
              </div>
              <div
                v-for="modifier in tier.skillModifiers ?? []"
                :key="`modifier:${modifier.heading}`"
                class="set-tier-group skill-bonus"
              >
                <h5>{{ modifier.heading }}</h5>
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
            :class="{ missing: !item.discovered, legendary: item.rarity === 'legendary', epic: item.rarity === 'epic', mi: item.rarity === 'mi', rare: item.rarity === 'rare', component: item.rarity === 'component', consumable: item.rarity === 'consumable' }"
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
              <span v-else>{{ item.discovered ? '✓' : '?' }}</span>
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
              {{ tooltipItem.name }}
            </h3>
            <p v-if="tooltipItem.upgradeRecord" class="awakening-copy">Can be upgraded by Ashes of Awakening.</p>
            <p v-else-if="tooltipItem.baseVersionRecord" class="awakening-copy">Awakened with Ashes of Awakening.</p>
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
                  missing: !member.discovered
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
          </section>
        </template>

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

    <div v-if="selectedItem" class="drawer-backdrop" @click.self="selectedRecord = null">
      <aside class="item-drawer" :aria-label="selectedItem.name + ' roll comparison'">
        <button class="drawer-close" type="button" aria-label="Close comparison" @click="selectedRecord = null">×</button>
        <p class="section-label">Copy comparison</p>
        <h2>{{ selectedItem.name }}</h2>
        <p class="drawer-intro">
          Auto-best averages the estimated percentile of each variable stat line. Pin whichever copy you actually prefer.
        </p>
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
        <p
          v-if="selectedItem.pinnedInstanceKey && !selectedCopies.some((copy) => copy.instanceKey === selectedItem?.pinnedInstanceKey)"
          class="pinned-away"
        >
          Your pinned copy is remembered, but it is not in a currently scanned stash.
        </p>

        <div class="copy-list">
          <p v-if="selectedCopies.length === 0" class="drawer-empty">
            No currently scanned copy is available. The catalog tooltip will show this item's possible ranges.
          </p>
          <article
            v-for="(copy, index) in selectedCopies"
            :key="copy.instanceKey"
            class="copy-card"
            :class="{ pinned: copy.instanceKey === selectedItem.pinnedInstanceKey }"
          >
            <header>
              <div class="copy-identity">
                <p>Copy {{ index + 1 }} <span v-if="vaultCopyForObserved(copy)" class="stored-badge">Stored</span></p>
                <div class="copy-score">
                  <strong v-if="copy.rollAnalysis?.overallEstimatedPercentile != null">
                    {{ copy.rollAnalysis.overallEstimatedPercentile.toFixed(1) }}%
                  </strong>
                  <strong v-else class="unscored">Unscored</strong>
                  <small>overall roll quality</small>
                </div>
                <p v-if="selectedItem.rarity === 'mi'" class="copy-selected-metric">
                  <span>{{ selectedMiMetricLabel }}</span>
                  <strong>{{ miMetricResult(copy, miComparisonMetric).display }}</strong>
                </p>
                <div class="copy-affixes">
                  <button
                    type="button"
                    :disabled="!copy.prefixRecord"
                    :class="{ active: copyAffixIsOpen(copy, copy.prefixRecord) }"
                    :title="copy.prefixRecord ? 'Show this prefix’s bonuses' : 'This copy has no prefix'"
                    @click="toggleCopyAffix(copy, copy.prefixRecord)"
                  ><small>Prefix</small><strong>{{ copyAffixName(copy.prefixRecord, 'No prefix') }}</strong></button>
                  <button
                    type="button"
                    :disabled="!copy.suffixRecord"
                    :class="{ active: copyAffixIsOpen(copy, copy.suffixRecord) }"
                    :title="copy.suffixRecord ? 'Show this suffix’s bonuses' : 'This copy has no suffix'"
                    @click="toggleCopyAffix(copy, copy.suffixRecord)"
                  ><small>Suffix</small><strong>{{ copyAffixName(copy.suffixRecord, 'No suffix') }}</strong></button>
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
                  {{ copy.instanceKey === selectedItem.pinnedInstanceKey ? 'Unpin' : 'Pin this copy' }}
                </button>
              </div>
            </header>

            <p v-if="copy.rollAnalysis && !copy.rollAnalysis.trusted" class="withheld-note">
              {{ copy.rollAnalysis.reason }}
            </p>
            <div v-else-if="copy.rollAnalysis && (rollableStats(copy).length || petRollableStats(copy).length)" class="copy-roll-sections">
              <section v-if="rollableStats(copy).length">
                <h3>Item rolls</h3>
                <div class="stat-list">
                  <div v-for="stat in rollableStats(copy)" :key="stat.key" class="stat-row">
                    <div class="stat-heading">
                      <span>{{ stat.label }}</span>
                      <strong>{{ stat.valueLabel }}<template v-if="stat.percentile !== null"> · {{ stat.percentile.toFixed(0) }}%</template><template v-else> · fixed</template></strong>
                    </div>
                    <div v-if="stat.percentile !== null" class="stat-meter"><span :style="{ width: `${stat.percentile}%` }" /></div>
                    <small>{{ stat.percentile === null ? 'Fixed value' : `${stat.rangeLabel} sampled range` }}</small>
                  </div>
                </div>
              </section>
              <section v-if="petRollableStats(copy).length" class="pet-roll-section">
                <h3>Bonus to All Pets</h3>
                <div class="stat-list">
                  <div v-for="stat in petRollableStats(copy)" :key="`pet:${stat.key}`" class="stat-row pet-stat-row">
                    <div class="stat-heading">
                      <span>{{ stat.label }}</span>
                      <strong>{{ stat.valueLabel }}<template v-if="stat.percentile !== null"> · {{ stat.percentile.toFixed(0) }}%</template><template v-else> · fixed</template></strong>
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
