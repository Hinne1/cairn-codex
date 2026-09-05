import { computed, createApp, h, ref, shallowRef } from 'vue'
import CollectionDashboard from '../../src/renderer/src/workspaces/CollectionDashboard.vue'
import CollectionMaterials from '../../src/renderer/src/workspaces/CollectionMaterialsWorkspace.vue'
import Sets from '../../src/renderer/src/workspaces/SetsWorkspace.vue'
import Drawer from '../../src/renderer/src/inspection/ItemInspectionDrawer.vue'
import MiWorkshop from '../../src/renderer/src/workspaces/MiWorkshopWorkspace.vue'
import { applyCopyFavorite, createCopyFavorites } from '../../src/renderer/src/inspection/copy-favorites'
import { createCollectionDashboard } from '../../src/renderer/src/workspaces/collection-dashboard'
import { createSetsSession } from '../../src/renderer/src/workspaces/sets'
import { createItemInspectionSession } from '../../src/renderer/src/inspection/item-inspection'
import { buildMiMetricOptions, createMiWorkshopSession } from '../../src/renderer/src/workspaces/mi-workshop'
import { createScreenshotCollectionFixture } from '../../src/verification/fixtures'
import '../../src/renderer/src/semantic-tokens.css'
import '../../src/renderer/src/styles.css'

// Memory-only production owners and components. No preload, disk archive or helper.
const template = createScreenshotCollectionFixture('search-help')
const makeItem = index => ({ ...template.items[0], record: `records/synthetic/owner-${index}.dbr`,
  name: `Synthetic Item ${String(index).padStart(5, '0')}`, iconKey: null, rarity: 'legendary',
  setRecord: `set-${Math.floor(index / 5)}`, setName: `Synthetic Set ${String(Math.floor(index / 5)).padStart(4, '0')}`,
  setPresentation: null, availableCount: 1, discovered: true, levelRequirement: index % 100 + 1,
  bestRollPercentile: 50, pinnedInstanceKey: null, recipeUnlocked: false, availableViaAwakening: false })
const makeCopy = (index, baseRecord) => ({ sourcePath: 'Synthetic transfer.gst', tabIndex: 0, itemIndex: index,
  baseRecord, instanceKey: `copy-${index}`, seed: index, prefixRecord: 'synthetic-prefix', suffixRecord: '',
  rollAnalysis: { trusted: true, modelVersion: 9, categoryScores: [], stats: [{ field: 'offensiveFire',
    value: index % 11, rollable: true, observedMinimum: 0, observedMaximum: 10, estimatedPercentile: 50 }], petStats: [] } })
const snapshot = shallowRef(null)
const copies = shallowRef([])
const workspace = ref('collection')
const controls = ref({ category: 'All', query: '', ownership: 'all', rarity: 'all', sort: 'name', direction: 'asc', page: 1 })
const metric = ref('overall')
const direction = ref('desc')
const collapsed = ref(false)
const busy = ref(false)
const events = []
const itemDocument = item => ({ text: `${item.name} ${item.setName}`, fields: { name: item.name, set: item.setName, level: item.levelRequirement } })
createApp({ setup() {
  const favoritesEnabled = ref(false)
  const favoriteFailure = ref(false)
  const favorites = createCopyFavorites({ contextKey: () => 'fixture-sc', modeFor: copy => copy.isHardcore,
    reconcile: () => events.push(['favorite-reconcile']),
    write: async (...args) => { if (favoriteFailure.value) throw new Error('Synthetic save failure'); events.push(['favorite', ...args]) },
    apply: (...args) => { copies.value = applyCopyFavorite(copies.value, ...args) },
    reportError: error => events.push(['favorite-error', error.message]) })
  const favoriteRecords = computed(() => new Set(copies.value.filter(copy => copy.isFavorite).map(copy => copy.baseRecord.toLowerCase())))
  const miSession = createMiWorkshopSession()
  const miControls = ref({ query: '', affix: 'all', metric: 'overall', metricDirection: 'desc', sort: 'metric', page: 1 })
  const sets = createSetsSession({ items: () => snapshot.value?.items ?? [], itemSearchDocument: itemDocument, restoringHistory: () => false })
  const dashboard = createCollectionDashboard({ snapshot: () => snapshot.value, miCountingMode: () => 'base', sets: () => sets.collectionSets.value })
  const inspection = createItemInspectionSession({ available: () => Boolean(snapshot.value), items: () => snapshot.value?.items ?? [],
    contextKey: () => 'synthetic-sc',
    copies: () => copies.value, observedCopies: () => [], metric: () => metric.value, metricDirection: () => direction.value,
    affixes: () => new Map([['synthetic-prefix', { name: 'Synthetic prefix', kind: 'prefix', rarity: 'rare', presentation: { sections: [] } }]]),
    storedCopyFor: () => null, modeFor: () => false, setPinnedBest: async (...args) => { events.push(['pin', ...args]) } })
  function setCount(count) {
    const items = Array.from({ length: count }, (_, index) => makeItem(index))
    snapshot.value = { ...template, items, observedItems: [], affixes: [], materials: [],
      rarities: [{ rarity: 'legendary', total: count, collected: count, availableCopies: count }] }
    copies.value = items.slice(0, 1).flatMap(item => Array.from({ length: 3 }, (_, index) => makeCopy(index, item.record)))
  }
  setCount(120)
  window.collectionOwnerFixture = { workspace, snapshot, copies, sets, dashboard, inspection, controls, collapsed, busy, events,
    favoritesEnabled, favoriteFailure, favorites, miControls,
    setCount, openCopies: count => { copies.value = Array.from({ length: count }, (_, index) => makeCopy(index, snapshot.value.items[0].record)); inspection.open(snapshot.value.items[0]) } }
  const openItem = item => inspection.open(item)
  return () => h('main', { style: 'padding:16px;min-width:0' }, [
    workspace.value === 'collection' ? [
      h(CollectionDashboard, { model: dashboard, available: Boolean(snapshot.value), installationFound: true,
        sourceModeLabel: 'Softcore', contentPackCount: 1, scannedStashCount: 1, catalogEntryCount: snapshot.value?.items.length ?? 0,
        archivedCopyCount: snapshot.value?.items.length ?? 0, scanning: busy.value, trackerCollapsed: collapsed.value,
        collectionBasis: 'archive', showLegacyScanner: false, miCountingMode: 'base', selectedRarity: controls.value.rarity,
        affixSummary: snapshot.value?.affixSummary, recipeSummary: snapshot.value?.recipeSummary,
        reusableSupplySummary: { total: 0, collected: 0, availableCopies: 0, rarity: 'supply' }, supplyAccessSummary: 'Synthetic access',
        onRefresh: () => events.push(['refresh']), onToggleTracker: () => { collapsed.value = !collapsed.value },
        onFilterRarity: rarity => { controls.value = { ...controls.value, rarity, page: 1 } },
        onFilterAll: () => { controls.value = { ...controls.value, rarity: 'all', page: 1 } } }),
      h(CollectionMaterials, { mode: 'collection', items: snapshot.value?.items ?? [], controls: controls.value,
        'onUpdate:controls': value => { controls.value = value }, doubleRareMiBaseRecords: new Set(), favoriteRecords: favoriteRecords.value,
        searchDocumentForItem: itemDocument, categoryProgress: category => dashboard.categoryProgressByName.value.get(category) ?? '0 / 0',
        iconUrlForItem: () => null, bestStoredCopyForItem: () => null, liveReady: false, retrievalBusy: false, onOpenItem: openItem })
    ] : workspace.value === 'mi' ? h(MiWorkshop, { items: snapshot.value?.items ?? [], affixes: [], copies: copies.value,
      collected: 0, countingMode: 'base', affixesDiscovered: 0, session: miSession, controls: miControls.value,
      'onUpdate:controls': value => { miControls.value = value }, iconUrlForItem: () => null, onOpenItem: openItem })
      : h(Sets, { session: sets, available: Boolean(snapshot.value), onOpenItem: openItem }),
    h(Drawer, { session: inspection, favorites: favoritesEnabled.value ? favorites : undefined, metric: metric.value, 'onUpdate:metric': value => { metric.value = value },
      metricDirection: direction.value, 'onUpdate:metricDirection': value => { direction.value = value },
      itemIconUrl: () => null, catalogItemByRecord: record => snapshot.value?.items.find(item => item.record === record) ?? null,
      vaultCopyForObserved: () => null, isDoubleRareMiCopy: () => false, miMetricOptions: buildMiMetricOptions(copies.value),
      depositTabDescription: 'synthetic retrieval tab', busy: false, liveReady: false, onOpenItem: openItem,
      onOpenRollHelp: () => { events.push(['help']); inspection.close() }, onRetrieveCopy: id => events.push(['retrieve', id]) })
  ])
} }).mount('#app')
