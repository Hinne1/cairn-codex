import type { OperationHistoryOutcome } from '@shared/contracts'
import type { OracleReadiness, OracleStyle } from './stash-oracle'

export const APP_ROUTE_VERSION = 1 as const
export const APP_ROUTE_HASH_KEY = 'cc-route'

export type ActiveView =
  | 'collection'
  | 'sets'
  | 'materials'
  | 'skills'
  | 'planner'
  | 'oracle'
  | 'mi-workshop'
  | 'supplies'
  | 'farming'
  | 'dismantling'
  | 'vault'
  | 'settings'

export type OwnershipFilter = 'all' | 'owned' | 'missing'
export type RarityFilter = 'all' | 'epic' | 'legendary' | 'mi' | 'double-rare' | 'rare' | 'recipe'
export type SortDirection = 'asc' | 'desc'
export type SortMode = 'name' | 'level' | 'completion' | 'recent' | 'roll'
export type SetProgressFilter = 'all' | 'complete' | 'progress' | 'unstarted'
export type SetFeatureFilter = 'all' | 'visual'
export type SetSortMode = 'completion' | 'level' | 'name'
export type SkillScope = 'archive' | 'all'
export type SkillSort = 'item' | 'slot' | 'amount' | 'conversion' | 'special' | 'level'
export type SkillRarityFilter = 'all' | 'epic' | 'legendary' | 'mi' | 'rare'
export type MiAffixFilter = 'all' | 'double-rare'
export type MiSortMode = 'metric' | 'level' | 'name' | 'copies'
export type MiMetricKey = 'overall' | 'base' | 'prefix' | 'suffix' | `item:${string}` | `pet:${string}`
export type OracleSortMode = 'score' | 'name' | 'class' | 'readiness'
export type PlannerSortMode = 'level' | 'name' | 'rarity'
export type PlannerDisplay = 'list' | 'grid' | 'map'
export type PlannerMapScope = 'selected' | 'all'
export type PlannerMapSortMode = 'items' | 'name' | 'level'
export type MaterialCategory = 'all' | 'component' | 'material' | 'potion-formula'
export type SupplyCategory = 'writs' | 'augments'
export type SupplySlotFilter = 'all' | 'weapon' | 'armor' | 'jewelry'
export type DismantlingModeFilter = 'all' | 'softcore' | 'hardcore'
export type DismantlingRarityFilter = 'all' | 'epic' | 'legendary' | 'mi' | 'rare'
export type VaultRarityFilter = 'all' | 'epic' | 'legendary' | 'mi' | 'rare'
export type VaultSortMode = 'recent' | 'name' | 'level' | 'roll'
export type TransferMode = 'live' | 'offline'
export type TransferSection = 'ingest-history' | 'dispense-history' | 'quarantine'

interface RouteBase<TWorkspace extends ActiveView, TControls> {
  version: typeof APP_ROUTE_VERSION
  workspace: TWorkspace
  itemRecord: string | null
  controls: TControls
}

export type AppRoute =
  | RouteBase<'collection', {
      category: string
      query: string
      ownership: OwnershipFilter
      rarity: RarityFilter
      sort: SortMode
      direction: SortDirection
      page: number
    }>
  | RouteBase<'sets', {
      query: string
      progress: SetProgressFilter
      feature: SetFeatureFilter
      sort: SetSortMode
      direction: SortDirection
      page: number
    }>
  | RouteBase<'materials', {
      category: MaterialCategory
      query: string
      ownership: OwnershipFilter
      rarity: RarityFilter
      sort: SortMode
      direction: SortDirection
      page: number
    }>
  | RouteBase<'skills', {
      skill: string
      query: string
      scope: SkillScope
      rarity: SkillRarityFilter
      slot: string
      sort: SkillSort
      direction: SortDirection
      page: number
    }>
  | RouteBase<'planner', {
      profileId: string | null
      skills: string[]
      minimumLevel: number
      maximumLevel: number
      query: string
      ownership: OwnershipFilter
      showIgnored: boolean
      sort: PlannerSortMode
      direction: SortDirection
      display: PlannerDisplay
      page: number
      atlasQuery: string
      atlasRegion: string | null
      mapScope: PlannerMapScope
      mapSort: PlannerMapSortMode
      mapDirection: SortDirection
    }>
  | RouteBase<'oracle', {
      query: string
      characterClass: string
      style: OracleStyle
      readiness: 'all' | OracleReadiness
      minimumLevel: number
      maximumLevel: number
      sort: OracleSortMode
      direction: SortDirection
      page: number
    }>
  | RouteBase<'mi-workshop', {
      query: string
      affix: MiAffixFilter
      metric: MiMetricKey
      metricDirection: SortDirection
      sort: MiSortMode
      page: number
    }>
  | RouteBase<'supplies', {
      category: SupplyCategory
      slot: SupplySlotFilter
      query: string
      mode: TransferMode
      page: number
    }>
  | RouteBase<'farming', {
      query: string
      rarity: RarityFilter
      page: number
    }>
  | RouteBase<'dismantling', {
      query: string
      mode: DismantlingModeFilter
      rarity: DismantlingRarityFilter
    }>
  | RouteBase<'vault', {
      mode: TransferMode
      section: TransferSection
      historyQuery: string
      historyOutcome: OperationHistoryOutcome
      historyPage: number
      vaultQuery: string
      vaultRarity: VaultRarityFilter
      vaultSort: VaultSortMode
      vaultDirection: SortDirection
      vaultPage: number
      quarantinePage: number
    }>
  | RouteBase<'settings', Record<string, never>>

export interface AppHistoryEntry {
  cairnCodex: true
  routeVersion: typeof APP_ROUTE_VERSION
  index: number
  route: AppRoute
}

type UnknownRecord = Record<string, unknown>

const activeViews: readonly ActiveView[] = [
  'collection', 'sets', 'materials', 'skills', 'planner', 'oracle', 'mi-workshop',
  'supplies', 'farming', 'dismantling', 'vault', 'settings'
]
const ownershipFilters: readonly OwnershipFilter[] = ['all', 'owned', 'missing']
const rarityFilters: readonly RarityFilter[] = ['all', 'epic', 'legendary', 'mi', 'double-rare', 'rare', 'recipe']
const directions: readonly SortDirection[] = ['asc', 'desc']
const sortModes: readonly SortMode[] = ['name', 'level', 'completion', 'recent', 'roll']
const setProgressFilters: readonly SetProgressFilter[] = ['all', 'complete', 'progress', 'unstarted']
const setFeatureFilters: readonly SetFeatureFilter[] = ['all', 'visual']
const setSortModes: readonly SetSortMode[] = ['completion', 'level', 'name']
const skillScopes: readonly SkillScope[] = ['archive', 'all']
const skillRarities: readonly SkillRarityFilter[] = ['all', 'epic', 'legendary', 'mi', 'rare']
const skillSorts: readonly SkillSort[] = ['item', 'slot', 'amount', 'conversion', 'special', 'level']
const miAffixes: readonly MiAffixFilter[] = ['all', 'double-rare']
const miSortModes: readonly MiSortMode[] = ['metric', 'level', 'name', 'copies']
const oracleStyles: readonly OracleStyle[] = ['all', 'pets', 'retaliation', 'weapon', 'caster']
const oracleReadiness: ReadonlyArray<'all' | OracleReadiness> = ['all', 'ready', 'near', 'wildcard']
const oracleSortModes: readonly OracleSortMode[] = ['score', 'name', 'class', 'readiness']
const plannerSortModes: readonly PlannerSortMode[] = ['level', 'name', 'rarity']
const plannerDisplays: readonly PlannerDisplay[] = ['list', 'grid', 'map']
const plannerMapScopes: readonly PlannerMapScope[] = ['selected', 'all']
const plannerMapSortModes: readonly PlannerMapSortMode[] = ['items', 'name', 'level']
const materialCategories: readonly MaterialCategory[] = ['all', 'component', 'material', 'potion-formula']
const supplyCategories: readonly SupplyCategory[] = ['writs', 'augments']
const supplySlots: readonly SupplySlotFilter[] = ['all', 'weapon', 'armor', 'jewelry']
const dismantlingModes: readonly DismantlingModeFilter[] = ['all', 'softcore', 'hardcore']
const dismantlingRarities: readonly DismantlingRarityFilter[] = ['all', 'epic', 'legendary', 'mi', 'rare']
const vaultRarities: readonly VaultRarityFilter[] = ['all', 'epic', 'legendary', 'mi', 'rare']
const vaultSortModes: readonly VaultSortMode[] = ['recent', 'name', 'level', 'roll']
const transferModes: readonly TransferMode[] = ['live', 'offline']
const transferSections: readonly TransferSection[] = ['ingest-history', 'dispense-history', 'quarantine']
const operationOutcomes: readonly OperationHistoryOutcome[] = ['all', 'committed', 'failed', 'pending']

function objectValue(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function stringValue(value: unknown, fallback = '', maximumLength = 500): string {
  return typeof value === 'string' ? value.slice(0, maximumLength) : fallback
}

function nullableString(value: unknown, maximumLength = 500): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, maximumLength) : null
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
}

function integerValue(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function stringArray(value: unknown, maximumItems = 24): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').slice(0, maximumItems).map((item) => item.slice(0, 120))
    : []
}

function metricValue(value: unknown): MiMetricKey {
  const metric = stringValue(value, 'overall', 180)
  return metric === 'overall' || metric === 'base' || metric === 'prefix' || metric === 'suffix' ||
    metric.startsWith('item:') || metric.startsWith('pet:')
    ? metric as MiMetricKey
    : 'overall'
}

export function defaultAppRoute(workspace: ActiveView = 'collection'): AppRoute {
  return parseAppRoute({ version: APP_ROUTE_VERSION, workspace, itemRecord: null, controls: {} })!
}

export function parseAppRoute(value: unknown): AppRoute | null {
  const input = objectValue(value)
  if (!input || input.version !== APP_ROUTE_VERSION) return null
  if (typeof input.workspace !== 'string' || !activeViews.includes(input.workspace as ActiveView)) return null
  const workspace = input.workspace as ActiveView
  const itemRecord = nullableString(input.itemRecord, 500)
  const controls = objectValue(input.controls) ?? {}

  switch (workspace) {
    case 'collection': return { version: APP_ROUTE_VERSION, workspace, itemRecord, controls: {
      category: stringValue(controls.category, 'All', 80), query: stringValue(controls.query),
      ownership: enumValue(controls.ownership, ownershipFilters, 'all'), rarity: enumValue(controls.rarity, rarityFilters, 'all'),
      sort: enumValue(controls.sort, sortModes, 'recent'), direction: enumValue(controls.direction, directions, 'desc'),
      page: integerValue(controls.page, 1, 1, 100_000)
    } }
    case 'sets': return { version: APP_ROUTE_VERSION, workspace, itemRecord, controls: {
      query: stringValue(controls.query), progress: enumValue(controls.progress, setProgressFilters, 'all'),
      feature: enumValue(controls.feature, setFeatureFilters, 'all'), sort: enumValue(controls.sort, setSortModes, 'completion'),
      direction: enumValue(controls.direction, directions, 'desc'), page: integerValue(controls.page, 1, 1, 100_000)
    } }
    case 'materials': return { version: APP_ROUTE_VERSION, workspace, itemRecord, controls: {
      category: enumValue(controls.category, materialCategories, 'all'), query: stringValue(controls.query),
      ownership: enumValue(controls.ownership, ownershipFilters, 'all'), rarity: enumValue(controls.rarity, rarityFilters, 'all'),
      sort: enumValue(controls.sort, sortModes, 'recent'), direction: enumValue(controls.direction, directions, 'desc'),
      page: integerValue(controls.page, 1, 1, 100_000)
    } }
    case 'skills': return { version: APP_ROUTE_VERSION, workspace, itemRecord, controls: {
      skill: stringValue(controls.skill, 'Wendigo Totem', 160), query: stringValue(controls.query),
      scope: enumValue(controls.scope, skillScopes, 'archive'), rarity: enumValue(controls.rarity, skillRarities, 'all'),
      slot: stringValue(controls.slot, 'all', 80), sort: enumValue(controls.sort, skillSorts, 'amount'),
      direction: enumValue(controls.direction, directions, 'desc'), page: integerValue(controls.page, 1, 1, 100_000)
    } }
    case 'planner': return { version: APP_ROUTE_VERSION, workspace, itemRecord, controls: {
      profileId: nullableString(controls.profileId, 160), skills: stringArray(controls.skills),
      minimumLevel: integerValue(controls.minimumLevel, 1, 1, 100), maximumLevel: integerValue(controls.maximumLevel, 70, 1, 100),
      query: stringValue(controls.query), ownership: enumValue(controls.ownership, ownershipFilters, 'all'),
      showIgnored: booleanValue(controls.showIgnored), sort: enumValue(controls.sort, plannerSortModes, 'level'),
      direction: enumValue(controls.direction, directions, 'asc'), display: enumValue(controls.display, plannerDisplays, 'list'),
      page: integerValue(controls.page, 1, 1, 100_000), atlasQuery: stringValue(controls.atlasQuery),
      atlasRegion: nullableString(controls.atlasRegion, 300), mapScope: enumValue(controls.mapScope, plannerMapScopes, 'selected'),
      mapSort: enumValue(controls.mapSort, plannerMapSortModes, 'items'), mapDirection: enumValue(controls.mapDirection, directions, 'desc')
    } }
    case 'oracle': return { version: APP_ROUTE_VERSION, workspace, itemRecord, controls: {
      query: stringValue(controls.query), characterClass: stringValue(controls.characterClass, 'all', 100),
      style: enumValue(controls.style, oracleStyles, 'all'), readiness: enumValue(controls.readiness, oracleReadiness, 'all'),
      minimumLevel: integerValue(controls.minimumLevel, 65, 1, 100), maximumLevel: integerValue(controls.maximumLevel, 100, 1, 100),
      sort: enumValue(controls.sort, oracleSortModes, 'score'), direction: enumValue(controls.direction, directions, 'desc'),
      page: integerValue(controls.page, 1, 1, 100_000)
    } }
    case 'mi-workshop': return { version: APP_ROUTE_VERSION, workspace, itemRecord, controls: {
      query: stringValue(controls.query), affix: enumValue(controls.affix, miAffixes, 'all'), metric: metricValue(controls.metric),
      metricDirection: enumValue(controls.metricDirection, directions, 'desc'), sort: enumValue(controls.sort, miSortModes, 'metric'),
      page: integerValue(controls.page, 1, 1, 100_000)
    } }
    case 'supplies': return { version: APP_ROUTE_VERSION, workspace, itemRecord, controls: {
      category: enumValue(controls.category, supplyCategories, 'writs'), slot: enumValue(controls.slot, supplySlots, 'all'),
      query: stringValue(controls.query), mode: enumValue(controls.mode, transferModes, 'live'),
      page: integerValue(controls.page, 1, 1, 100_000)
    } }
    case 'farming': return { version: APP_ROUTE_VERSION, workspace, itemRecord, controls: {
      query: stringValue(controls.query), rarity: enumValue(controls.rarity, rarityFilters, 'all'),
      page: integerValue(controls.page, 1, 1, 100_000)
    } }
    case 'dismantling': return { version: APP_ROUTE_VERSION, workspace, itemRecord, controls: {
      query: stringValue(controls.query), mode: enumValue(controls.mode, dismantlingModes, 'all'),
      rarity: enumValue(controls.rarity, dismantlingRarities, 'all')
    } }
    case 'vault': return { version: APP_ROUTE_VERSION, workspace, itemRecord, controls: {
      mode: enumValue(controls.mode, transferModes, 'live'), section: enumValue(controls.section, transferSections, 'ingest-history'),
      historyQuery: stringValue(controls.historyQuery), historyOutcome: enumValue(controls.historyOutcome, operationOutcomes, 'all'),
      historyPage: integerValue(controls.historyPage, 1, 1, 100_000), vaultQuery: stringValue(controls.vaultQuery),
      vaultRarity: enumValue(controls.vaultRarity, vaultRarities, 'all'), vaultSort: enumValue(controls.vaultSort, vaultSortModes, 'recent'),
      vaultDirection: enumValue(controls.vaultDirection, directions, 'desc'), vaultPage: integerValue(controls.vaultPage, 1, 1, 100_000),
      quarantinePage: integerValue(controls.quarantinePage, 1, 1, 100_000)
    } }
    case 'settings': return { version: APP_ROUTE_VERSION, workspace, itemRecord, controls: {} }
  }
}

export function createAppHistoryEntry(index: number, route: AppRoute): AppHistoryEntry {
  return { cairnCodex: true, routeVersion: APP_ROUTE_VERSION, index: Math.max(0, Math.trunc(index)), route }
}

export function parseAppHistoryEntry(value: unknown): AppHistoryEntry | null {
  const input = objectValue(value)
  if (!input || input.cairnCodex !== true || input.routeVersion !== APP_ROUTE_VERSION) return null
  const route = parseAppRoute(input.route)
  if (!route) return null
  return createAppHistoryEntry(integerValue(input.index, 0, 0, 1_000_000), route)
}

export function appRouteHash(route: AppRoute): string {
  const params = new URLSearchParams()
  params.set(APP_ROUTE_HASH_KEY, String(APP_ROUTE_VERSION))
  params.set('view', route.workspace)
  if (route.itemRecord) params.set('item', route.itemRecord)
  if (Object.keys(route.controls).length > 0) params.set('controls', JSON.stringify(route.controls))
  return `#${params.toString()}`
}

export function appRouteHref(route: AppRoute, currentHref: string): string {
  const url = new URL(currentHref)
  url.hash = appRouteHash(route)
  return url.href
}

export function parseAppRouteHash(hash: string): AppRoute | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  if (params.get(APP_ROUTE_HASH_KEY) !== String(APP_ROUTE_VERSION)) return null
  const controlsText = params.get('controls')
  if (controlsText && controlsText.length > 8_000) return null
  let controls: unknown = {}
  try {
    controls = controlsText ? JSON.parse(controlsText) : {}
  } catch {
    return null
  }
  return parseAppRoute({
    version: APP_ROUTE_VERSION,
    workspace: params.get('view'),
    itemRecord: params.get('item'),
    controls
  })
}
