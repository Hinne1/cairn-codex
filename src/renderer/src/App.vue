<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  AppStatus,
  CollectionBasis,
  CollectionItem,
  CollectionRaritySummary,
  CollectionSnapshot,
  GrimDawnDiscovery,
  ItemPresentationLine,
  LiveGameStatus,
  ObservedStashItem,
  StagingTabInspection,
  VaultListItem,
  WriteSafetyStatus
} from '@shared/contracts'

type OwnershipFilter = 'all' | 'owned' | 'missing'
type RarityFilter = 'all' | 'epic' | 'legendary'
type SortMode = 'name' | 'level' | 'completion' | 'roll'
type SortDirection = 'asc' | 'desc'
type ActiveView = 'collection' | 'sets' | 'vault'

interface CollectionSet {
  record: string
  name: string
  items: CollectionItem[]
  collected: number
  availableCopies: number
}

const status = ref<AppStatus | null>(null)
const discovery = ref<GrimDawnDiscovery | null>(null)
const snapshot = ref<CollectionSnapshot | null>(null)
const enabledStashPaths = ref<string[]>(readStoredSourcePaths())
const collectionBasis = ref<CollectionBasis>(readStoredCollectionBasis())
const scanning = ref(false)
const scanError = ref<string | null>(null)
const cacheIssue = ref<string | null>(null)
const zoomFactor = ref(readStoredZoomFactor())
const activeCategory = ref('All')
const activeView = ref<ActiveView>('collection')
const query = ref('')
const ownership = ref<OwnershipFilter>('all')
const rarityFilter = ref<RarityFilter>('all')
const sortMode = ref<SortMode>('completion')
const sortDirection = ref<SortDirection>('desc')
const currentPage = ref(1)
const selectedRecord = ref<string | null>(null)
const pinning = ref(false)
const vaultItems = ref<VaultListItem[]>([])
const staging = ref<StagingTabInspection | null>(null)
const writeSafety = ref<WriteSafetyStatus | null>(null)
const selectedStashPath = ref('')
const selectedVaultIds = ref<string[]>([])
const vaultBusy = ref(false)
const vaultError = ref<string | null>(null)
const vaultMessage = ref<string | null>(null)
const liveStatus = ref<LiveGameStatus | null>(null)
const liveIssues = ref<string[]>([])
const liveSyncing = ref(false)
const tooltipRecord = ref<string | null>(null)
const tooltipPosition = ref({ left: 0, top: 0 })
let tooltipTimer: ReturnType<typeof setTimeout> | null = null
let liveTimer: ReturnType<typeof setInterval> | null = null
const pageSize = 48

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
const availableVaultItems = computed(() =>
  vaultItems.value.filter(
    (item) => item.state === 'ingested' && item.isHardcore === targetStash.value?.isHardcore
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
const collectionBasisLabel = computed(() =>
  collectionBasis.value === 'archive' ? 'Codex Archive' : 'Stash Index'
)
const stagingHasUnsupported = computed(() => staging.value?.items.some((item) => !item.supported) ?? false)
const ingestBlockedReason = computed(() => {
  if (vaultBusy.value) return 'A Vault operation is already running.'
  if (!writeSafety.value) return 'Checking whether stash writes are safe…'
  if (!writeSafety.value.permitted) return writeSafety.value.reasons.join(' ') || 'Stash writes are locked.'
  if (!staging.value) return 'Inspecting the final stash tab…'
  if (staging.value.itemCount === 0) return 'Put at least one Epic or Legendary in the final stash tab.'
  if (stagingHasUnsupported.value) return 'Remove unsupported items from the final stash tab first.'
  return null
})

const filteredItems = computed(() => {
  if (!snapshot.value) return []
  const needle = query.value.trim().toLocaleLowerCase()
  return snapshot.value.items
    .filter((item) => matchesCategory(item, activeCategory.value))
    .filter((item) => rarityFilter.value === 'all' || item.rarity === rarityFilter.value)
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
    } else {
      grouped.set(item.setRecord, {
        record: item.setRecord,
        name: item.setName,
        items: [item],
        collected: item.discovered ? 1 : 0,
        availableCopies: item.availableCount
      })
    }
  }
  for (const set of grouped.values()) {
    set.items.sort((left, right) => left.slot.localeCompare(right.slot) || left.name.localeCompare(right.name))
  }
  return [...grouped.values()].sort((left, right) => {
    const leftRatio = left.collected / left.items.length
    const rightRatio = right.collected / right.items.length
    return rightRatio - leftRatio || left.name.localeCompare(right.name)
  })
})

const visibleSets = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return collectionSets.value
    .filter(
      (set) =>
        rarityFilter.value === 'all' || set.items.some((item) => item.rarity === rarityFilter.value)
    )
    .filter((set) => {
      if (ownership.value === 'owned') return set.collected > 0
      if (ownership.value === 'missing') return set.collected < set.items.length
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
})

const displayedResultCount = computed(() =>
  activeView.value === 'vault'
    ? availableVaultItems.value.length
    : activeView.value === 'sets'
      ? visibleSets.value.length
      : filteredItems.value.length
)

const selectedItem = computed(() =>
  snapshot.value?.items.find((item) => item.record === selectedRecord.value) ?? null
)

const tooltipItem = computed(() =>
  snapshot.value?.items.find((item) => item.record === tooltipRecord.value) ?? null
)

const selectedCopies = computed(() => {
  if (!snapshot.value || !selectedRecord.value) return []
  const pinned = selectedItem.value?.pinnedInstanceKey
  return snapshot.value.observedItems
    .filter((item) => item.baseRecord === selectedRecord.value && item.instanceKey)
    .sort((left, right) => {
      if ((left.instanceKey === pinned) !== (right.instanceKey === pinned)) {
        return left.instanceKey === pinned ? -1 : 1
      }
      return (
        (right.rollAnalysis?.overallEstimatedPercentile ?? -1) -
        (left.rollAnalysis?.overallEstimatedPercentile ?? -1)
      )
    })
})

watch(
  [activeView, activeCategory, query, ownership, rarityFilter, sortMode, sortDirection],
  () => {
    currentPage.value = 1
  }
)

watch(sortMode, (mode) => {
  sortDirection.value = mode === 'name' ? 'asc' : 'desc'
})

watch(selectedStashPath, async (path) => {
  if (path) await refreshStaging()
})

watch(activeView, async (view) => {
  if (view === 'vault') await refreshVault()
})

onMounted(async () => {
  window.addEventListener('keydown', handleEscape)
  window.addEventListener('wheel', handleZoomWheel, { passive: false })
  zoomFactor.value = await window.cairnCodex.setZoomFactor(zoomFactor.value)
  status.value = await window.cairnCodex.getAppStatus()
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
    void scanCollection()
  } else {
    await scanCollection()
  }
  await refreshVault()
  liveStatus.value = await window.cairnCodex.inspectLiveGame()
  liveTimer = setInterval(() => void syncLiveMode(), 1000)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleEscape)
  window.removeEventListener('wheel', handleZoomWheel)
  cancelTooltip()
  if (liveTimer) clearInterval(liveTimer)
})

async function scanCollection(): Promise<void> {
  const requestedSources = [...enabledStashPaths.value]
  const requestedBasis = collectionBasis.value
  const requestedKey = JSON.stringify({
    basis: requestedBasis,
    paths: requestedSources.map((path) => path.toLocaleLowerCase()).sort()
  })
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

function readStoredSourcePaths(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('cairn-codex-sources') ?? '[]') as unknown
    return Array.isArray(parsed) && parsed.every((value) => typeof value === 'string') ? parsed : []
  } catch {
    return []
  }
}

function storeSourcePaths(): void {
  localStorage.setItem('cairn-codex-sources', JSON.stringify(enabledStashPaths.value))
}

function readStoredCollectionBasis(): CollectionBasis {
  return localStorage.getItem('cairn-codex-collection-basis') === 'archive'
    ? 'archive'
    : 'stashes'
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

async function setZoom(factor: number): Promise<void> {
  zoomFactor.value = await window.cairnCodex.setZoomFactor(factor)
  localStorage.setItem('cairn-codex-zoom', String(zoomFactor.value))
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
  if (cached) applySnapshot(cached)
  else await scanCollection()
  await refreshVault()
}

function rarity(name: 'epic' | 'legendary'): CollectionRaritySummary | undefined {
  return snapshot.value?.rarities.find((summary) => summary.rarity === name)
}

function filterToRarity(value: 'epic' | 'legendary'): void {
  activeView.value = 'collection'
  activeCategory.value = 'All'
  rarityFilter.value = value
  window.scrollTo({ top: 500, behavior: 'smooth' })
}

function percentage(summary: CollectionRaritySummary | undefined): string {
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
  if (!selectedStashPath.value) return
  vaultError.value = null
  try {
    const [items, safety, live] = await Promise.all([
      window.cairnCodex.listVaultItems(),
      window.cairnCodex.inspectWriteSafety(),
      window.cairnCodex.inspectLiveGame()
    ])
    vaultItems.value = items
    writeSafety.value = safety
    liveStatus.value = live
    selectedVaultIds.value = selectedVaultIds.value.filter((id) =>
      items.some((item) => item.id === id && item.state === 'ingested')
    )
    await refreshStaging()
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
  vaultBusy.value = true
  vaultError.value = null
  try {
    liveStatus.value = await window.cairnCodex.startLiveGame()
    if (liveStatus.value.state === 'ready') {
      vaultMessage.value = 'Live mode connected. Put an Epic or Legendary into the final shared stash tab to archive it instantly.'
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

async function syncLiveMode(): Promise<void> {
  if (liveStatus.value?.state !== 'ready' || liveSyncing.value || vaultBusy.value) return
  liveSyncing.value = true
  try {
    const result = await window.cairnCodex.syncLiveGame()
    liveStatus.value = result.status
    liveIssues.value = result.issues
    if (result.ingested.length > 0) {
      vaultMessage.value = `Live-ingested ${result.ingested.map((item) => item.name).join(', ')}.`
      await refreshVault()
      if (collectionBasis.value === 'archive') await loadSelectedSources()
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
  const confirmed = window.confirm(
    `Live-retrieve ${selectedVaultIds.value.length} item${selectedVaultIds.value.length === 1 ? '' : 's'}? Keep the shared stash open until the in-game deposit is acknowledged.`
  )
  if (!confirmed) return
  vaultBusy.value = true
  vaultError.value = null
  vaultMessage.value = null
  try {
    const result = await window.cairnCodex.retrieveLiveVaultItems([...selectedVaultIds.value])
    vaultMessage.value = `Live-retrieved ${result.retrieved.length} item${result.retrieved.length === 1 ? '' : 's'} into Grim Dawn.`
    selectedVaultIds.value = []
    await refreshVault()
    if (collectionBasis.value === 'archive') await loadSelectedSources()
  } catch (error) {
    vaultError.value = readableError(error)
    await refreshVault()
  } finally {
    vaultBusy.value = false
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
  const confirmed = window.confirm(
    `Retrieve ${selectedVaultIds.value.length} item${selectedVaultIds.value.length === 1 ? '' : 's'} into the empty final shared stash tab? A verified backup will be created first.`
  )
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
    vaultMessage.value = `Safely retrieved ${result.retrieved.length} item${result.retrieved.length === 1 ? '' : 's'}. Backup: ${result.backupPath}`
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
  } else if (sortMode.value === 'roll') {
    comparison = (left.bestRollPercentile ?? -1) - (right.bestRollPercentile ?? -1)
  } else {
    comparison = left.name.localeCompare(right.name)
  }
  if (comparison === 0) comparison = left.name.localeCompare(right.name)
  return sortDirection.value === 'asc' ? comparison : -comparison
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

function itemIconUrl(item: CollectionItem): string | null {
  return item.iconKey ? `cairn-icon://asset/${item.iconKey}.png` : null
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
  cancelTooltip()
  positionTooltip(event)
  tooltipTimer = setTimeout(() => {
    tooltipRecord.value = item.record
  }, 180)
}

function moveTooltip(event: MouseEvent): void {
  if (tooltipRecord.value) positionTooltip(event)
}

function positionTooltip(event: MouseEvent | FocusEvent): void {
  const width = 430
  const margin = 14
  let x: number
  let y: number
  if (event instanceof MouseEvent) {
    x = event.clientX + 18
    y = event.clientY + 14
  } else {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    x = rect.right + 12
    y = rect.top
  }
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

function hideTooltip(): void {
  cancelTooltip()
  tooltipRecord.value = null
}

function handleEscape(event: KeyboardEvent): void {
  if (event.ctrlKey && event.key === '0') {
    event.preventDefault()
    void setZoom(1)
    return
  }
  if (event.key !== 'Escape') return
  hideTooltip()
  selectedRecord.value = null
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

function rollableStats(copy: ObservedStashItem) {
  const stats = (copy.rollAnalysis?.stats ?? [])
    .filter((stat) => stat.estimatedPercentile !== null)
  const byField = new Map(stats.map((stat) => [stat.field, stat]))
  const consumed = new Set<string>()
  return stats
    .flatMap((stat) => {
      if (consumed.has(stat.field)) return []
      if (stat.field.endsWith('Min')) {
        const root = stat.field.slice(0, -3)
        const maximum = byField.get(root + 'Max')
        if (maximum?.estimatedPercentile !== null && maximum?.estimatedPercentile !== undefined) {
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
              percentile: (stat.estimatedPercentile! + maximum.estimatedPercentile) / 2,
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

function humanStatName(field: string): string {
  const names: Record<string, string> = {
    characterAttackSpeedModifier: 'Attack speed',
    characterSpellCastSpeedModifier: 'Cast speed',
    characterIntelligence: 'Spirit',
    characterDefensiveAbility: 'Defensive ability',
    characterOffensiveAbility: 'Offensive ability',
    conversionPercentage: 'Damage conversion',
    offensiveFireModifier: 'Fire damage',
    offensiveSlowFire: 'Burn damage',
    offensiveSlowFireModifier: 'Burn damage bonus'
  }
  return names[field] ?? field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (value) => value.toUpperCase())
}

function formatRollValue(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1)
}
</script>

<template>
  <div class="app-shell" :data-cache-issue="cacheIssue">
    <header class="topbar">
      <div>
        <p class="eyebrow">Grim Dawn collection atlas</p>
        <h1>Cairn Codex</h1>
      </div>
      <div class="topbar-actions">
        <span class="source-pill">{{ sourceModeLabel }} · {{ activeSourceCount }} sources</span>
        <div class="status-pill">
          <span class="status-dot" :class="{ dim: status?.helper !== 'available' }" />
          {{ status ? `v${status.appVersion} · ${status.helper}` : 'Connecting…' }}
        </div>
      </div>
    </header>

    <main>
      <section v-if="scanning && snapshot" class="background-scan" aria-live="polite">
        <span class="scan-spinner" aria-hidden="true" />
        <div>
          <strong>Refreshing collection in the background</strong>
          <small>Your cached Codex is ready; stash counts and rolls are being rechecked.</small>
        </div>
      </section>
      <section class="hero">
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
          <p v-if="scanError" class="scan-error">{{ scanError }}</p>
        </div>
        <button class="primary-action" type="button" :disabled="scanning" @click="scanCollection">
          {{ scanning ? 'Reading the archives…' : 'Refresh collection' }}
        </button>
      </section>

      <section class="metrics" aria-label="Collection completion">
        <button
          type="button"
          :aria-pressed="rarityFilter === 'legendary'"
          @click="filterToRarity('legendary')"
        >
          <div class="metric-heading">
            <span>Legendaries</span>
            <strong>{{ rarity('legendary')?.collected ?? 0 }} / {{ rarity('legendary')?.total ?? '—' }}</strong>
          </div>
          <div class="meter"><span :style="{ width: percentage(rarity('legendary')) }" /></div>
          <small>{{ percentage(rarity('legendary')) }} discovered · {{ rarity('legendary')?.availableCopies ?? 0 }} copies available</small>
        </button>
        <button
          type="button"
          :aria-pressed="rarityFilter === 'epic'"
          @click="filterToRarity('epic')"
        >
          <div class="metric-heading">
            <span>Epics</span>
            <strong>{{ rarity('epic')?.collected ?? 0 }} / {{ rarity('epic')?.total ?? '—' }}</strong>
          </div>
          <div class="meter epic"><span :style="{ width: percentage(rarity('epic')) }" /></div>
          <small>{{ percentage(rarity('epic')) }} discovered · {{ rarity('epic')?.availableCopies ?? 0 }} copies available</small>
        </button>
      </section>

      <section class="collection-basis" aria-label="Collection persistence">
        <button
          type="button"
          :class="{ active: collectionBasis === 'stashes' }"
          :aria-pressed="collectionBasis === 'stashes'"
          @click="setCollectionBasis('stashes')"
        >
          <strong>Stash Index</strong>
          <small>Ownership mirrors the selected transfer stashes.</small>
        </button>
        <button
          type="button"
          :class="{ active: collectionBasis === 'archive' }"
          :aria-pressed="collectionBasis === 'archive'"
          @click="setCollectionBasis('archive')"
        >
          <strong>Codex Archive</strong>
          <small>Ownership persists here after items are ingested from the game.</small>
        </button>
      </section>

      <nav class="workspace-tabs" aria-label="Cairn Codex workspace">
        <button type="button" :class="{ active: activeView === 'collection' }" @click="activeView = 'collection'">
          <span>Collection</span><small>Items and copies</small>
        </button>
        <button type="button" :class="{ active: activeView === 'sets' }" @click="activeView = 'sets'">
          <span>Sets</span><small>{{ collectionSets.length }} catalogued</small>
        </button>
        <button type="button" :class="{ active: activeView === 'vault' }" @click="activeView = 'vault'">
          <span>Vault</span><small>{{ availableVaultItems.length }} ready</small>
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

      <section v-if="activeView !== 'vault'" class="filter-bar" aria-label="Collection filters">
        <label class="search-field">
          <span class="sr-only">Search collection</span>
          <input
            v-model="query"
            type="search"
            placeholder="Search names, stats, skills…  (try skill:wendigo)"
          />
        </label>
        <div class="segmented-control" aria-label="Ownership filter">
          <button
            v-for="option in (['all', 'owned', 'missing'] as OwnershipFilter[])"
            :key="option"
            type="button"
            :class="{ active: ownership === option }"
            @click="ownership = option"
          >
            {{ option }}
          </button>
        </div>
        <select v-model="rarityFilter" aria-label="Rarity">
          <option value="all">All rarities</option>
          <option value="legendary">Legendary</option>
          <option value="epic">Epic</option>
        </select>
        <select v-if="activeView === 'collection'" v-model="sortMode" aria-label="Sort collection">
          <option value="completion">Collected first</option>
          <option value="name">Name</option>
          <option value="level">Level</option>
          <option value="roll">Best roll</option>
        </select>
        <button
          v-if="activeView === 'collection'"
          type="button"
          class="sort-direction"
          :aria-label="sortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'"
          @click="sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'"
        >
          {{ sortDirection === 'asc' ? '↑ Asc' : '↓ Desc' }}
        </button>
        <span class="result-count">{{ displayedResultCount.toLocaleString() }} results</span>
      </section>

      <section v-if="activeView === 'vault'" class="vault-workspace" aria-label="Item vault">
        <header class="vault-heading">
          <div>
            <p class="section-label">Transfer vault</p>
            <h2>One tab in. One tab out.</h2>
            <p>
              The final shared stash tab is the staging area. Every commit is process-gated,
              backed up, written atomically, reparsed, and hash-verified.
            </p>
          </div>
          <button type="button" :disabled="vaultBusy" @click="refreshVault">
            {{ vaultBusy ? 'Working…' : 'Recheck' }}
          </button>
        </header>

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
          <button
            v-if="liveStatus?.state !== 'ready'"
            type="button"
            :disabled="vaultBusy || liveStatus?.state === 'unavailable' || liveStatus?.state === 'blocked'"
            @click="startLiveMode"
          >
            {{ liveStatus?.state === 'connecting' ? 'Retry connection' : 'Enable live mode' }}
          </button>
          <div v-else class="live-ready-instructions">
            <strong>{{ liveSyncing ? 'Checking queue…' : `Watching the ${liveStatus.ingestTabDescription}` }}</strong>
            <small>Retrieval target: {{ liveStatus.depositTabDescription }}.</small>
            <small>Only place Epics or Legendaries in the watched tab.</small>
          </div>
        </section>
        <p v-for="issue in liveIssues" :key="issue" class="vault-notice error">{{ issue }}</p>

        <section class="source-selector" aria-label="Collection stash sources">
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

        <p v-if="vaultError" class="vault-notice error">{{ vaultError }}</p>
        <p v-if="vaultMessage" class="vault-notice success">{{ vaultMessage }}</p>

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
              Put only the Epics and Legendaries you want archived into tab
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
                  <small>Seed {{ item.seed }}{{ item.supported ? '' : ' · not an Epic/Legendary' }}</small>
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
                <h3>Ready to retrieve</h3>
              </div>
              <strong>{{ availableVaultItems.length }}</strong>
            </header>
            <p class="panel-help">
              Retrieval requires the final stash tab to be empty. Select one or more archived copies.
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
            <button
              v-if="liveStatus?.state === 'ready'"
              class="vault-action live-action"
              type="button"
              :disabled="vaultBusy || selectedVaultIds.length === 0"
              @click="retrieveSelectedLive"
            >
              {{ vaultBusy ? 'Waiting for game…' : `Live-retrieve ${selectedVaultIds.length} selected` }}
            </button>
          </article>
        </div>

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
            </div>
            <strong :class="{ complete: set.collected === set.items.length }">
              {{ set.collected }} / {{ set.items.length }}
            </strong>
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
                @mouseleave="hideTooltip"
                @focus="queueTooltip(item, $event)"
                @blur="hideTooltip"
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
            :class="{ missing: !item.discovered, legendary: item.rarity === 'legendary', epic: item.rarity === 'epic' }"
            role="button"
            tabindex="0"
            aria-describedby="item-tooltip"
            @mouseenter="queueTooltip(item, $event)"
            @mousemove="moveTooltip"
            @mouseleave="hideTooltip"
            @focus="queueTooltip(item, $event)"
            @blur="hideTooltip"
            @click="openItem(item)"
            @keydown.enter="openItem(item)"
          >
            <div class="item-mark" aria-hidden="true">
              <img v-if="itemIconUrl(item)" :src="itemIconUrl(item)!" alt="" />
              <span v-else>{{ item.discovered ? '✓' : '?' }}</span>
            </div>
            <div class="item-copy">
              <h3>{{ item.name }}</h3>
              <p>{{ item.rarity }} · {{ item.slot }} · Lv{{ item.levelRequirement }}</p>
              <small v-if="item.setName">{{ item.setName }}</small>
            </div>
            <div class="card-result">
              <strong v-if="item.bestRollPercentile !== null" class="roll-score">
                ★ {{ item.bestRollPercentile.toFixed(1) }}%
              </strong>
              <span v-else class="roll-score dim">★ —</span>
              <strong v-if="item.availableCount > 0">
                {{ item.availableCount }} {{ item.availableCount === 1 ? 'copy' : 'copies' }}
              </strong>
              <strong v-else-if="item.discovered">Discovered · no copies</strong>
              <strong v-else>Not found</strong>
            </div>
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
        id="item-tooltip"
        class="game-tooltip"
        :class="tooltipItem.rarity"
        :style="{ left: `${tooltipPosition.left}px`, top: `${tooltipPosition.top}px` }"
        role="tooltip"
      >
        <header class="tooltip-header">
          <img v-if="itemIconUrl(tooltipItem)" :src="itemIconUrl(tooltipItem)!" alt="" />
          <div>
            <h3>{{ tooltipItem.name }}</h3>
            <p v-if="tooltipItem.presentation?.flavorText">“{{ tooltipItem.presentation.flavorText }}”</p>
            <strong>{{ tooltipItem.rarity }} {{ tooltipItem.slot }}</strong>
          </div>
        </header>

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
            <p
              v-for="member in setMemberItems(tooltipItem)"
              :key="member.record"
              class="set-member"
              :class="{
                current: member.record === tooltipItem.record,
                missing: !member.discovered
              }"
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
          <p v-for="source in tooltipItem.acquisition.sources" :key="source">{{ source }}</p>
        </section>

        <footer>
          <span v-if="tooltipItem.levelRequirement">Required Player Level: {{ tooltipItem.levelRequirement }}</span>
          <span>Item Level: {{ tooltipItem.itemLevel }}</span>
          <em v-if="tooltipItem.contentPack !== 'base'">{{ tooltipItem.contentPack.toUpperCase() }}</em>
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
              <div>
                <p>Copy {{ index + 1 }} · seed {{ copy.seed }}</p>
                <strong v-if="copy.rollAnalysis?.overallEstimatedPercentile !== null">
                  {{ copy.rollAnalysis?.overallEstimatedPercentile?.toFixed(1) }}%
                </strong>
                <strong v-else>Score withheld</strong>
              </div>
              <div class="copy-actions">
                <span v-if="isAutoBest(copy)" class="auto-badge">Auto-best</span>
                <button type="button" :disabled="pinning" @click="pinCopy(copy)">
                  {{ copy.instanceKey === selectedItem.pinnedInstanceKey ? 'Unpin' : 'Pin this copy' }}
                </button>
              </div>
            </header>

            <p v-if="copy.rollAnalysis && !copy.rollAnalysis.trusted" class="withheld-note">
              {{ copy.rollAnalysis.reason }}
            </p>
            <div v-else class="stat-list">
              <div v-for="stat in rollableStats(copy)" :key="stat.key" class="stat-row">
                <div class="stat-heading">
                  <span>{{ stat.label }}</span>
                  <strong>{{ stat.valueLabel }} · {{ stat.percentile.toFixed(0) }}%</strong>
                </div>
                <div class="stat-meter"><span :style="{ width: `${stat.percentile}%` }" /></div>
                <small>{{ stat.rangeLabel }} sampled range</small>
              </div>
            </div>
          </article>
        </div>
      </aside>
    </div>
  </div>
</template>
