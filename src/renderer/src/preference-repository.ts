import { ONBOARDING_STEP_COUNT, ONBOARDING_VERSION, type OnboardingStatus } from './onboarding.ts'
import {
  isPreferenceDocument,
  MAX_PLANNER_PROFILES,
  MAX_PREFERENCE_BYTES
} from '../../shared/preference-schema.ts'

export const PREFERENCE_STORAGE_KEY = 'cairn-codex-preferences'
export const PREFERENCE_SCHEMA_VERSION = 1

export type PreferenceLoadSource = 'fresh' | 'legacy' | 'stored'
export type CollectionBasisPreference = 'stashes' | 'archive'
export type PreferenceTheme = 'cairn'
export type PlannerDisplayPreference = 'table' | 'journey' | 'map'
export type TooltipBoundaryScrollPreference = 'page' | 'contain'
export type MiCountingPreference = 'base' | 'tier'
export type SkillScopePreference = 'archive' | 'all'
export type OracleStylePreference = 'all' | 'pets' | 'retaliation' | 'weapon' | 'caster'
export type WorkspaceToolPreference =
  | 'sets' | 'materials' | 'skills' | 'oracle' | 'planner' | 'mi-workshop'
  | 'supplies' | 'farming' | 'dismantling' | 'trivia' | 'todo'

export const DEFAULT_WORKSPACE_TOOLS: WorkspaceToolPreference[] = [
  'sets', 'materials', 'skills', 'oracle', 'planner', 'mi-workshop',
  'supplies', 'farming', 'dismantling', 'trivia', 'todo'
]

export interface StoredPlannerProfile {
  id: string
  name: string
  className?: string
  masteries?: string[]
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

export interface StoredTodoItem {
  id: string
  text: string
  done: boolean
  createdAt: string
}

export interface AppPreferencesV1 {
  version: 1
  meta: {
    profileKind: 'fresh' | 'returning'
    updatedAtUtc: string
  }
  appearance: {
    theme: PreferenceTheme
    zoomFactor: number
    trackerCollapsed: boolean
    navigationCollapsed: boolean
    plannerDisplay: PlannerDisplayPreference
    tooltipBoundaryScroll: TooltipBoundaryScrollPreference
  }
  workspace: {
    visibleTools: WorkspaceToolPreference[]
    experimentalToolsEnabled: boolean
    showLegacyScanner: boolean
    miCountingMode: MiCountingPreference
  }
  search: {
    selectedSkill: string
    skillScope: SkillScopePreference
    oracleClass: string
    oracleStyle: OracleStylePreference
    oracleMinimumLevel: number
    oracleMaximumLevel: number
  }
  planner: {
    profiles: StoredPlannerProfile[]
    selectedProfileId: string
    ignoredRecords: string[]
    favoriteRecords: string[]
  }
  notes: {
    todos: StoredTodoItem[]
  }
  sources: {
    collectionBasis: CollectionBasisPreference
    archivePaths: string[]
    indexPaths: string[]
    retrievalStash: string
    autoLiveConnect: boolean
  }
  onboarding: {
    version: number
    status: OnboardingStatus
    step: number
  }
}

export interface PreferenceLoadDiagnostics {
  source: PreferenceLoadSource
  migrated: boolean
  schemaVersion: number
  invalidFields: string[]
}

export interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface PreferenceRepository {
  readonly value: AppPreferencesV1
  readonly diagnostics: PreferenceLoadDiagnostics
  update: <K extends keyof Omit<AppPreferencesV1, 'version' | 'meta'>>(
    section: K,
    patch: Partial<AppPreferencesV1[K]>
  ) => AppPreferencesV1
  resetInterface: () => number
  exportJson: () => string
}

const legacyKeys = [
  'cairn-codex-zoom', 'cairn-codex-visible-workspace-tools',
  'cairn-codex-workspace-tools-version', 'cairn-codex-experimental-tools',
  'cairn-codex-tracker-collapsed', 'cairn-codex-tracker-layout-version',
  'cairn-codex-show-legacy-scanner', 'cairn-codex-skill',
  'cairn-codex-skill-scope', 'cairn-codex-oracle-class',
  'cairn-codex-oracle-style', 'cairn-codex-oracle-minimum-level',
  'cairn-codex-oracle-maximum-level', 'cairn-codex-planner-display',
  'cairn-codex-mi-counting-mode', 'cairn-codex-planner-profiles',
  'cairn-codex-planner-profile', 'cairn-codex-planner-skills',
  'cairn-codex-planner-level-cap', 'cairn-codex-planner-level-cap-version',
  'cairn-codex-planner-ignored-records', 'cairn-codex-planner-favorite-records',
  'cairn-codex-todos', 'cairn-codex-collection-basis',
  'cairn-codex-collection-basis-default-version', 'cairn-codex-archive-sources',
  'cairn-codex-index-sources', 'cairn-codex-sources',
  'cairn-codex-retrieval-stash', 'cairn-codex-auto-live-connect',
  'cairn-codex-onboarding-version', 'cairn-codex-onboarding-status',
  'cairn-codex-onboarding-step'
] as const

const STALE_PREFERENCE_TIMESTAMP = '1970-01-01T00:00:00.000Z'

function clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

function parseJson(value: string | null): unknown {
  if (value === null) return undefined
  try { return JSON.parse(value) as unknown } catch { return undefined }
}

function stringArray(value: unknown, maximumEntries = 512, maximumLength = 4096): string[] | null {
  return Array.isArray(value) && value.length <= maximumEntries &&
    value.every((entry) => typeof entry === 'string' && entry.length <= maximumLength)
    ? [...value]
    : null
}

function legacyStringArray(storage: PreferenceStorage, key: string): string[] {
  return stringArray(parseJson(storage.getItem(key))) ?? []
}

function legacyBoolean(storage: PreferenceStorage, key: string, fallback: boolean): boolean {
  const value = storage.getItem(key)
  return value === null ? fallback : value === 'true'
}

function createPlannerProfile(
  storage: PreferenceStorage,
  now: string,
  createId: () => string
): StoredPlannerProfile {
  const legacySkills = storage.getItem('cairn-codex-planner-skills') === null
    ? ['Wendigo Totem']
    : legacyStringArray(storage, 'cairn-codex-planner-skills')
  const levelCap = storage.getItem('cairn-codex-planner-level-cap-version') === '1'
    ? clampNumber(storage.getItem('cairn-codex-planner-level-cap'), 70, 1, 100)
    : 70
  return {
    id: createId(), name: 'Current build', skills: legacySkills, excludedSkills: [],
    minimumLevel: 1, levelCap, source: 'manual', modifiedAt: now
  }
}

function validPlannerProfile(value: unknown, fallbackTime: string): StoredPlannerProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const profile = value as Partial<StoredPlannerProfile>
  const serialized = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const id = typeof profile.id === 'string' && profile.id
    ? profile.id.slice(0, 200)
    : `recovered-${(hash >>> 0).toString(16).padStart(8, '0')}`
  const masteries = stringArray(profile.masteries, 2, 40)
  return {
    id,
    name: typeof profile.name === 'string' && profile.name.trim()
      ? profile.name.slice(0, 60)
      : 'Recovered plan',
    ...(typeof profile.className === 'string' ? { className: profile.className.slice(0, 80) } : {}),
    ...(masteries ? { masteries } : {}),
    skills: stringArray(profile.skills, 128, 200) ?? [],
    excludedSkills: stringArray(profile.excludedSkills, 128, 200) ?? [],
    minimumLevel: clampNumber(profile.minimumLevel, 1, 1, 100),
    levelCap: clampNumber(profile.levelCap, 70, 1, 100),
    source: profile.source === 'character' ? 'character' : 'manual',
    ...(typeof profile.characterPath === 'string' ? { characterPath: profile.characterPath.slice(0, 4096) } : {}),
    ...(typeof profile.characterLevel === 'number'
      ? { characterLevel: clampNumber(profile.characterLevel, 1, 1, 100) }
      : {}),
    ...(typeof profile.isHardcore === 'boolean' ? { isHardcore: profile.isHardcore } : {}),
    modifiedAt: typeof profile.modifiedAt === 'string' && profile.modifiedAt
      ? profile.modifiedAt.slice(0, 64)
      : fallbackTime
  }
}

function validPlannerProfiles(values: unknown[], fallbackTime: string): StoredPlannerProfile[] {
  const profiles: StoredPlannerProfile[] = []
  const usedIds = new Set<string>()
  for (const value of values.slice(0, MAX_PLANNER_PROFILES)) {
    const profile = validPlannerProfile(value, fallbackTime)
    if (!profile) continue
    const baseId = profile.id.slice(0, 190)
    let id = baseId
    let suffix = 2
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`
    usedIds.add(id)
    profiles.push(id === profile.id ? profile : { ...profile, id })
  }
  return profiles
}

function validTodo(value: unknown): StoredTodoItem | null {
  if (!value || typeof value !== 'object') return null
  const todo = value as Partial<StoredTodoItem>
  return typeof todo.id === 'string' && todo.id.length > 0 && todo.id.length <= 200 &&
    typeof todo.text === 'string' && todo.text.length <= 500 &&
    typeof todo.done === 'boolean' && typeof todo.createdAt === 'string' &&
    todo.createdAt.length > 0 && todo.createdAt.length <= 64
    ? { id: todo.id, text: todo.text.slice(0, 500), done: todo.done, createdAt: todo.createdAt }
    : null
}

function interfaceDefaults(): Pick<AppPreferencesV1, 'appearance' | 'workspace' | 'search'> {
  return {
    appearance: {
      theme: 'cairn', zoomFactor: 1, trackerCollapsed: false,
      navigationCollapsed: false, plannerDisplay: 'table', tooltipBoundaryScroll: 'page'
    },
    workspace: {
      visibleTools: [...DEFAULT_WORKSPACE_TOOLS], experimentalToolsEnabled: false,
      showLegacyScanner: false, miCountingMode: 'base'
    },
    search: {
      selectedSkill: 'Wendigo Totem', skillScope: 'all', oracleClass: 'all',
      oracleStyle: 'all', oracleMinimumLevel: 65, oracleMaximumLevel: 100
    }
  }
}

function freshPreferences(now: string, createId: () => string): AppPreferencesV1 {
  const defaults = interfaceDefaults()
  const profile: StoredPlannerProfile = {
    id: createId(), name: 'Current build', skills: ['Wendigo Totem'], excludedSkills: [],
    minimumLevel: 1, levelCap: 70, source: 'manual', modifiedAt: now
  }
  return {
    version: PREFERENCE_SCHEMA_VERSION,
    meta: { profileKind: 'fresh', updatedAtUtc: now },
    ...defaults,
    planner: { profiles: [profile], selectedProfileId: profile.id, ignoredRecords: [], favoriteRecords: [] },
    notes: { todos: [] },
    sources: {
      collectionBasis: 'archive', archivePaths: [], indexPaths: [], retrievalStash: '',
      autoLiveConnect: true
    },
    onboarding: { version: ONBOARDING_VERSION, status: 'in-progress', step: 0 }
  }
}

function legacyPreferences(
  storage: PreferenceStorage,
  now: string,
  createId: () => string
): AppPreferencesV1 {
  const defaults = interfaceDefaults()
  const parsedProfiles = parseJson(storage.getItem('cairn-codex-planner-profiles'))
  const profiles = Array.isArray(parsedProfiles)
    ? validPlannerProfiles(parsedProfiles, now)
    : []
  if (!profiles.length) profiles.push(createPlannerProfile(storage, now, createId))
  const storedProfileId = storage.getItem('cairn-codex-planner-profile')
  const selectedProfileId = profiles.some((profile) => profile.id === storedProfileId)
    ? storedProfileId!
    : profiles[0]!.id
  const workspaceTools = stringArray(parseJson(storage.getItem('cairn-codex-visible-workspace-tools')))
  const allowedTools = new Set(DEFAULT_WORKSPACE_TOOLS)
  const visibleTools = workspaceTools
    ? [...new Set(workspaceTools.filter((tool): tool is WorkspaceToolPreference => allowedTools.has(tool as WorkspaceToolPreference)))]
    : [...DEFAULT_WORKSPACE_TOOLS]
  if (Number(storage.getItem('cairn-codex-workspace-tools-version') ?? 0) < 2 && !visibleTools.includes('dismantling')) {
    visibleTools.push('dismantling')
  }
  const todosValue = parseJson(storage.getItem('cairn-codex-todos'))
  const onboardingStatusValue = storage.getItem('cairn-codex-onboarding-status')
  const onboardingVersion = Number(storage.getItem('cairn-codex-onboarding-version'))
  const onboardingStatus: OnboardingStatus = onboardingVersion === ONBOARDING_VERSION &&
    (onboardingStatusValue === 'completed' || onboardingStatusValue === 'skipped')
    ? onboardingStatusValue
    : 'in-progress'
  return {
    version: PREFERENCE_SCHEMA_VERSION,
    meta: { profileKind: 'returning', updatedAtUtc: now },
    appearance: {
      theme: 'cairn',
      zoomFactor: clampNumber(storage.getItem('cairn-codex-zoom'), 1, 0.7, 1.8),
      trackerCollapsed: storage.getItem('cairn-codex-tracker-layout-version') === '2'
        ? legacyBoolean(storage, 'cairn-codex-tracker-collapsed', false)
        : false,
      navigationCollapsed: false,
      tooltipBoundaryScroll: defaults.appearance.tooltipBoundaryScroll,
      plannerDisplay: storage.getItem('cairn-codex-planner-display') === 'grid' ||
        storage.getItem('cairn-codex-planner-display') === 'journey'
        ? 'journey'
        : storage.getItem('cairn-codex-planner-display') === 'map'
          ? 'map'
          : defaults.appearance.plannerDisplay
    },
    workspace: {
      visibleTools,
      experimentalToolsEnabled: storage.getItem('cairn-codex-experimental-tools') === null
        ? storage.getItem('cairn-codex-workspace-tools-version') !== null
        : legacyBoolean(storage, 'cairn-codex-experimental-tools', false),
      showLegacyScanner: legacyBoolean(storage, 'cairn-codex-show-legacy-scanner', false),
      miCountingMode: storage.getItem('cairn-codex-mi-counting-mode') === 'tier' ? 'tier' : 'base'
    },
    search: {
      selectedSkill: storage.getItem('cairn-codex-skill') ?? defaults.search.selectedSkill,
      skillScope: storage.getItem('cairn-codex-skill-scope') === 'archive' ? 'archive' : 'all',
      oracleClass: storage.getItem('cairn-codex-oracle-class') ?? 'all',
      oracleStyle: ['pets', 'retaliation', 'weapon', 'caster'].includes(storage.getItem('cairn-codex-oracle-style') ?? '')
        ? storage.getItem('cairn-codex-oracle-style') as OracleStylePreference
        : 'all',
      oracleMinimumLevel: clampNumber(storage.getItem('cairn-codex-oracle-minimum-level'), 65, 1, 100),
      oracleMaximumLevel: clampNumber(storage.getItem('cairn-codex-oracle-maximum-level'), 100, 1, 100)
    },
    planner: {
      profiles, selectedProfileId,
      ignoredRecords: legacyStringArray(storage, 'cairn-codex-planner-ignored-records'),
      favoriteRecords: legacyStringArray(storage, 'cairn-codex-planner-favorite-records')
    },
    notes: {
      todos: Array.isArray(todosValue)
        ? todosValue.map(validTodo).filter((todo): todo is StoredTodoItem => Boolean(todo))
        : []
    },
    sources: {
      collectionBasis: storage.getItem('cairn-codex-collection-basis-default-version') === '2' &&
        storage.getItem('cairn-codex-collection-basis') === 'stashes' ? 'stashes' : 'archive',
      archivePaths: legacyStringArray(storage, 'cairn-codex-archive-sources'),
      indexPaths: legacyStringArray(storage, 'cairn-codex-index-sources').length
        ? legacyStringArray(storage, 'cairn-codex-index-sources')
        : legacyStringArray(storage, 'cairn-codex-sources'),
      retrievalStash: storage.getItem('cairn-codex-retrieval-stash') ?? '',
      autoLiveConnect: legacyBoolean(storage, 'cairn-codex-auto-live-connect', true)
    },
    onboarding: {
      version: ONBOARDING_VERSION,
      status: onboardingStatus,
      step: onboardingVersion === ONBOARDING_VERSION
        ? clampNumber(storage.getItem('cairn-codex-onboarding-step'), 0, 0, ONBOARDING_STEP_COUNT - 1)
        : 0
    }
  }
}

function validateStored(
  raw: unknown,
  fallback: AppPreferencesV1,
  invalidFields: string[]
): AppPreferencesV1 {
  if (!raw || typeof raw !== 'object') {
    invalidFields.push('document')
    return fallback
  }
  const source = raw as Partial<AppPreferencesV1>
  if (source.version !== PREFERENCE_SCHEMA_VERSION) invalidFields.push('version')
  const result = structuredClone(fallback)
  const invalid = (path: string): void => { invalidFields.push(path) }
  const readBoolean = (value: unknown, path: string, current: boolean): boolean => {
    if (typeof value === 'boolean') return value
    if (value !== undefined) invalid(path)
    return current
  }
  const readString = (value: unknown, path: string, current: string, maximum = 500): string => {
    if (typeof value === 'string') return value.slice(0, maximum)
    if (value !== undefined) invalid(path)
    return current
  }
  const readNumber = (
    value: unknown,
    path: string,
    current: number,
    minimum: number,
    maximum: number
  ): number => {
    if (typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum) return value
    if (value !== undefined) invalid(path)
    return current
  }
  if (source.meta && typeof source.meta === 'object') {
    if (source.meta.profileKind === 'fresh' || source.meta.profileKind === 'returning') result.meta.profileKind = source.meta.profileKind
    else invalid('meta.profileKind')
    if (typeof source.meta.updatedAtUtc === 'string' && source.meta.updatedAtUtc.length > 0) {
      result.meta.updatedAtUtc = source.meta.updatedAtUtc.slice(0, 64)
    } else invalid('meta.updatedAtUtc')
  } else invalid('meta')
  if (source.appearance && typeof source.appearance === 'object') {
    if (source.appearance.theme !== 'cairn') invalid('appearance.theme')
    result.appearance.zoomFactor = readNumber(source.appearance.zoomFactor, 'appearance.zoomFactor', result.appearance.zoomFactor, 0.7, 1.8)
    result.appearance.trackerCollapsed = readBoolean(source.appearance.trackerCollapsed, 'appearance.trackerCollapsed', result.appearance.trackerCollapsed)
    result.appearance.navigationCollapsed = readBoolean(source.appearance.navigationCollapsed, 'appearance.navigationCollapsed', result.appearance.navigationCollapsed)
    if (source.appearance.plannerDisplay === 'table' || source.appearance.plannerDisplay === 'journey' || source.appearance.plannerDisplay === 'map') {
      result.appearance.plannerDisplay = source.appearance.plannerDisplay
    } else if ((source.appearance.plannerDisplay as unknown) === 'list') {
      result.appearance.plannerDisplay = 'table'
    } else if ((source.appearance.plannerDisplay as unknown) === 'grid') {
      result.appearance.plannerDisplay = 'journey'
    } else if (source.appearance.plannerDisplay !== undefined) invalid('appearance.plannerDisplay')
    if (source.appearance.tooltipBoundaryScroll === 'page' || source.appearance.tooltipBoundaryScroll === 'contain') {
      result.appearance.tooltipBoundaryScroll = source.appearance.tooltipBoundaryScroll
    } else if (source.appearance.tooltipBoundaryScroll !== undefined) invalid('appearance.tooltipBoundaryScroll')
  } else invalid('appearance')
  if (source.workspace && typeof source.workspace === 'object') {
    const visibleTools = stringArray(source.workspace.visibleTools)
    const allowed = new Set(DEFAULT_WORKSPACE_TOOLS)
    if (visibleTools) {
      result.workspace.visibleTools = [...new Set(visibleTools.filter(
        (tool): tool is WorkspaceToolPreference => allowed.has(tool as WorkspaceToolPreference)
      ))]
      if (result.workspace.visibleTools.length !== visibleTools.length) invalid('workspace.visibleTools')
    }
    else invalid('workspace.visibleTools')
    result.workspace.experimentalToolsEnabled = readBoolean(source.workspace.experimentalToolsEnabled, 'workspace.experimentalToolsEnabled', result.workspace.experimentalToolsEnabled)
    result.workspace.showLegacyScanner = readBoolean(source.workspace.showLegacyScanner, 'workspace.showLegacyScanner', result.workspace.showLegacyScanner)
    if (source.workspace.miCountingMode === 'base' || source.workspace.miCountingMode === 'tier') result.workspace.miCountingMode = source.workspace.miCountingMode
    else if (source.workspace.miCountingMode !== undefined) invalid('workspace.miCountingMode')
  } else invalid('workspace')
  if (source.search && typeof source.search === 'object') {
    result.search.selectedSkill = readString(source.search.selectedSkill, 'search.selectedSkill', result.search.selectedSkill, 200)
    result.search.oracleClass = readString(source.search.oracleClass, 'search.oracleClass', result.search.oracleClass, 100)
    if (source.search.skillScope === 'archive' || source.search.skillScope === 'all') result.search.skillScope = source.search.skillScope
    else if (source.search.skillScope !== undefined) invalid('search.skillScope')
    if (['all', 'pets', 'retaliation', 'weapon', 'caster'].includes(String(source.search.oracleStyle))) result.search.oracleStyle = source.search.oracleStyle!
    else if (source.search.oracleStyle !== undefined) invalid('search.oracleStyle')
    result.search.oracleMinimumLevel = readNumber(source.search.oracleMinimumLevel, 'search.oracleMinimumLevel', result.search.oracleMinimumLevel, 1, 100)
    result.search.oracleMaximumLevel = readNumber(source.search.oracleMaximumLevel, 'search.oracleMaximumLevel', result.search.oracleMaximumLevel, 1, 100)
  } else invalid('search')
  if (source.planner && typeof source.planner === 'object') {
    if (Array.isArray(source.planner.profiles)) {
      const profiles = validPlannerProfiles(source.planner.profiles, fallback.meta.updatedAtUtc)
      if (profiles.length) result.planner.profiles = profiles
      if (profiles.length !== source.planner.profiles.length || !profiles.length ||
          source.planner.profiles.length > MAX_PLANNER_PROFILES) invalid('planner.profiles')
    } else invalid('planner.profiles')
    if (typeof source.planner.selectedProfileId === 'string' &&
      result.planner.profiles.some((profile) => profile.id === source.planner!.selectedProfileId)) {
      result.planner.selectedProfileId = source.planner.selectedProfileId
    } else {
      result.planner.selectedProfileId = result.planner.profiles[0]!.id
      invalid('planner.selectedProfileId')
    }
    const ignored = stringArray(source.planner.ignoredRecords)
    const favorites = stringArray(source.planner.favoriteRecords)
    if (ignored) result.planner.ignoredRecords = ignored; else invalid('planner.ignoredRecords')
    if (favorites) result.planner.favoriteRecords = favorites; else invalid('planner.favoriteRecords')
  } else invalid('planner')
  if (source.notes && typeof source.notes === 'object' && Array.isArray(source.notes.todos) && source.notes.todos.length <= 1000) {
    result.notes.todos = source.notes.todos.map(validTodo).filter((todo): todo is StoredTodoItem => Boolean(todo))
    if (result.notes.todos.length !== source.notes.todos.length) invalid('notes.todos')
  } else invalid('notes.todos')
  if (source.sources && typeof source.sources === 'object') {
    if (source.sources.collectionBasis === 'stashes' || source.sources.collectionBasis === 'archive') {
      result.sources.collectionBasis = source.sources.collectionBasis
    } else invalid('sources.collectionBasis')
    const archive = stringArray(source.sources.archivePaths)
    const index = stringArray(source.sources.indexPaths)
    if (archive) result.sources.archivePaths = archive; else invalid('sources.archivePaths')
    if (index) result.sources.indexPaths = index; else invalid('sources.indexPaths')
    result.sources.retrievalStash = readString(source.sources.retrievalStash, 'sources.retrievalStash', '', 4096)
    result.sources.autoLiveConnect = readBoolean(source.sources.autoLiveConnect, 'sources.autoLiveConnect', result.sources.autoLiveConnect)
  } else invalid('sources')
  if (source.onboarding && typeof source.onboarding === 'object') {
    if (source.onboarding.version !== ONBOARDING_VERSION) invalid('onboarding.version')
    if (source.onboarding.status === 'completed' || source.onboarding.status === 'skipped' || source.onboarding.status === 'in-progress') {
      result.onboarding.status = source.onboarding.status
    } else invalid('onboarding.status')
    result.onboarding.step = readNumber(source.onboarding.step, 'onboarding.step', 0, 0, ONBOARDING_STEP_COUNT - 1)
    result.onboarding.version = ONBOARDING_VERSION
  } else invalid('onboarding')
  return result
}

/**
 * Returns the browser-origin preferences that may need importing into the durable store.
 * Unlike createPreferenceRepository, this never writes to storage or advances updatedAtUtc:
 * doing either before the durable store has chosen its source would make a stale browser
 * mirror look newer than the file-backed preferences.
 */
export function canonicalPreferenceCandidate(
  storage: PreferenceStorage,
  now: () => string = () => new Date().toISOString(),
  createId: () => string = () => crypto.randomUUID()
): string | null {
  const rawStored = storage.getItem(PREFERENCE_STORAGE_KEY)
  const hasLegacy = legacyKeys.some((key) => storage.getItem(key) !== null)
  if (rawStored === null && !hasLegacy) return null

  const serialize = (candidate: AppPreferencesV1): string | null => {
    if (!isPreferenceDocument(candidate)) return null
    const serialized = JSON.stringify(candidate)
    return new TextEncoder().encode(serialized).byteLength <= MAX_PREFERENCE_BYTES
      ? serialized
      : null
  }

  if (rawStored === null) {
    const legacy = legacyPreferences(storage, STALE_PREFERENCE_TIMESTAMP, createId)
    const candidate = validateStored(
      legacy,
      freshPreferences(STALE_PREFERENCE_TIMESTAMP, createId),
      []
    )
    return serialize(candidate)
  }

  // A malformed modern mirror can still contribute recoverable fields, but it must not gain
  // a fresh startup timestamp and displace a valid durable document.
  const fallback = freshPreferences(STALE_PREFERENCE_TIMESTAMP, createId)
  const candidate = validateStored(parseJson(rawStored), fallback, [])
  return serialize(candidate)
}

export function createPreferenceRepository(
  storage: PreferenceStorage,
  now: () => string = () => new Date().toISOString(),
  createId: () => string = () => crypto.randomUUID()
): PreferenceRepository {
  const loadedAt = now()
  const rawStored = storage.getItem(PREFERENCE_STORAGE_KEY)
  const hasLegacy = legacyKeys.some((key) => storage.getItem(key) !== null)
  const source: PreferenceLoadSource = rawStored === null ? (hasLegacy ? 'legacy' : 'fresh') : 'stored'
  const fallback = rawStored === null && hasLegacy
    ? legacyPreferences(storage, loadedAt, createId)
    : freshPreferences(loadedAt, createId)
  const invalidFields: string[] = []
  let value = rawStored === null
    ? fallback
    : validateStored(parseJson(rawStored), fallback, invalidFields)
  const diagnostics: PreferenceLoadDiagnostics = {
    source,
    migrated: source === 'legacy',
    schemaVersion: PREFERENCE_SCHEMA_VERSION,
    invalidFields: [...new Set(invalidFields)].slice(0, 64)
  }
  const persist = (): void => {
    value.meta.updatedAtUtc = now()
    storage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(value))
  }
  persist()
  return {
    get value() { return value },
    diagnostics,
    update(section, patch) {
      value = {
        ...value,
        [section]: { ...value[section], ...patch }
      }
      persist()
      return value
    },
    resetInterface() {
      const defaults = interfaceDefaults()
      value = { ...value, ...defaults }
      persist()
      return 3
    },
    exportJson() {
      return `${JSON.stringify(value, null, 2)}\n`
    }
  }
}
