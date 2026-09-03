export const MAX_PREFERENCE_BYTES = 2 * 1024 * 1024
export const MAX_PLANNER_PROFILES = 100
export const MAX_PREFERENCE_TODOS = 1000

const WORKSPACE_TOOLS = new Set([
  'sets', 'materials', 'skills', 'oracle', 'planner', 'mi-workshop',
  'supplies', 'farming', 'dismantling', 'trivia', 'todo'
])

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed)
  return Object.keys(value).every((key) => allowedSet.has(key))
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && onlyKeys(value, expected)
}

function boundedString(value: unknown, maximum: number, required = true): boolean {
  return typeof value === 'string' && value.length <= maximum && (!required || value.length > 0)
}

function boundedNumber(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}

function stringArray(value: unknown, maximumEntries: number, maximumLength: number): value is string[] {
  return Array.isArray(value) && value.length <= maximumEntries &&
    value.every((entry) => boundedString(entry, maximumLength, false))
}

function plannerProfile(value: unknown): boolean {
  const profile = record(value)
  if (!profile || !onlyKeys(profile, [
    'id', 'name', 'className', 'masteries', 'skills', 'excludedSkills', 'minimumLevel',
    'levelCap', 'source', 'characterPath', 'characterLevel', 'isHardcore', 'modifiedAt'
  ])) return false
  if (!boundedString(profile.id, 200) || !boundedString(profile.name, 60) ||
      !stringArray(profile.skills, 128, 200) || !stringArray(profile.excludedSkills, 128, 200) ||
      !boundedNumber(profile.minimumLevel, 1, 100) || !boundedNumber(profile.levelCap, 1, 100) ||
      (profile.source !== 'manual' && profile.source !== 'character') ||
      !boundedString(profile.modifiedAt, 64)) return false
  if (profile.className !== undefined && !boundedString(profile.className, 80, false)) return false
  if (profile.masteries !== undefined && !stringArray(profile.masteries, 2, 40)) return false
  if (profile.characterPath !== undefined && !boundedString(profile.characterPath, 4096, false)) return false
  if (profile.characterLevel !== undefined && !boundedNumber(profile.characterLevel, 1, 100)) return false
  return profile.isHardcore === undefined || typeof profile.isHardcore === 'boolean'
}

function todo(value: unknown): boolean {
  const item = record(value)
  return Boolean(item) && exactKeys(item!, ['id', 'text', 'done', 'createdAt']) &&
    boundedString(item!.id, 200) && boundedString(item!.text, 500, false) &&
    typeof item!.done === 'boolean' && boundedString(item!.createdAt, 64)
}

export function isPreferenceDocument(value: unknown): value is Record<string, unknown> {
  const root = record(value)
  if (!root || !exactKeys(root, [
    'version', 'meta', 'appearance', 'workspace', 'search', 'planner', 'notes', 'sources', 'onboarding'
  ]) || root.version !== 1) return false

  const meta = record(root.meta)
  const appearance = record(root.appearance)
  const workspace = record(root.workspace)
  const search = record(root.search)
  const planner = record(root.planner)
  const notes = record(root.notes)
  const sources = record(root.sources)
  const onboarding = record(root.onboarding)
  if (!meta || !appearance || !workspace || !search || !planner || !notes || !sources || !onboarding) return false

  if (!exactKeys(meta, ['profileKind', 'updatedAtUtc']) ||
      (meta.profileKind !== 'fresh' && meta.profileKind !== 'returning') ||
      !boundedString(meta.updatedAtUtc, 64)) return false
  if (!onlyKeys(appearance, ['theme', 'zoomFactor', 'trackerCollapsed', 'navigationCollapsed', 'plannerDisplay', 'tooltipBoundaryScroll']) ||
      !['theme', 'zoomFactor', 'trackerCollapsed', 'plannerDisplay'].every((key) => key in appearance) ||
      appearance.theme !== 'cairn' || !boundedNumber(appearance.zoomFactor, 0.7, 1.8) ||
      typeof appearance.trackerCollapsed !== 'boolean' ||
      (appearance.navigationCollapsed !== undefined && typeof appearance.navigationCollapsed !== 'boolean') ||
      (appearance.tooltipBoundaryScroll !== undefined && appearance.tooltipBoundaryScroll !== 'page' && appearance.tooltipBoundaryScroll !== 'contain') ||
      !['table', 'journey', 'map', 'list', 'grid'].includes(String(appearance.plannerDisplay))) return false
  if (!exactKeys(workspace, ['visibleTools', 'experimentalToolsEnabled', 'showLegacyScanner', 'miCountingMode']) ||
      !Array.isArray(workspace.visibleTools) || workspace.visibleTools.length > WORKSPACE_TOOLS.size ||
      !workspace.visibleTools.every((tool) => typeof tool === 'string' && WORKSPACE_TOOLS.has(tool)) ||
      new Set(workspace.visibleTools).size !== workspace.visibleTools.length ||
      typeof workspace.experimentalToolsEnabled !== 'boolean' || typeof workspace.showLegacyScanner !== 'boolean' ||
      (workspace.miCountingMode !== 'base' && workspace.miCountingMode !== 'tier')) return false
  if (!exactKeys(search, [
    'selectedSkill', 'skillScope', 'oracleClass', 'oracleStyle', 'oracleMinimumLevel', 'oracleMaximumLevel'
  ]) || !boundedString(search.selectedSkill, 200, false) ||
      (search.skillScope !== 'archive' && search.skillScope !== 'all') ||
      !boundedString(search.oracleClass, 100, false) ||
      !['all', 'pets', 'retaliation', 'weapon', 'caster'].includes(String(search.oracleStyle)) ||
      !boundedNumber(search.oracleMinimumLevel, 1, 100) || !boundedNumber(search.oracleMaximumLevel, 1, 100)) return false
  if (!exactKeys(planner, ['profiles', 'selectedProfileId', 'ignoredRecords', 'favoriteRecords']) ||
      !Array.isArray(planner.profiles) || !planner.profiles.length || planner.profiles.length > MAX_PLANNER_PROFILES ||
      !planner.profiles.every(plannerProfile) || !boundedString(planner.selectedProfileId, 200) ||
      !planner.profiles.some((profile) => record(profile)?.id === planner.selectedProfileId) ||
      !stringArray(planner.ignoredRecords, 512, 4096) || !stringArray(planner.favoriteRecords, 512, 4096)) return false
  if (!exactKeys(notes, ['todos']) || !Array.isArray(notes.todos) || notes.todos.length > MAX_PREFERENCE_TODOS ||
      !notes.todos.every(todo)) return false
  if (!exactKeys(sources, ['collectionBasis', 'archivePaths', 'indexPaths', 'retrievalStash', 'autoLiveConnect']) ||
      (sources.collectionBasis !== 'archive' && sources.collectionBasis !== 'stashes') ||
      !stringArray(sources.archivePaths, 512, 4096) || !stringArray(sources.indexPaths, 512, 4096) ||
      !boundedString(sources.retrievalStash, 4096, false) || typeof sources.autoLiveConnect !== 'boolean') return false
  return exactKeys(onboarding, ['version', 'status', 'step']) && onboarding.version === 1 &&
    ['completed', 'skipped', 'in-progress'].includes(String(onboarding.status)) &&
    boundedNumber(onboarding.step, 0, 3)
}
