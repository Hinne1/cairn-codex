import { computed, nextTick, ref, watch } from 'vue'
import type { CollectionItem, CollectionSnapshot, CharacterSaveProfile, ItemPresentationLine, MapRegionLocation } from '@shared/contracts'
import type { AppPreferencesV1, StoredPlannerProfile as PlannerProfile } from '../preference-repository'
import type { AppRoute, OwnershipFilter, PlannerDisplay, PlannerMapScope, PlannerMapSortMode, PlannerSortMode, SortDirection } from '../app-route'
import type { OracleCandidate } from '../stash-oracle'
import { compileSearchQuery, type SearchDocument } from '../../../shared/search-query.ts'
import { searchQueryOptions, searchSchemas } from '../../../shared/search-schema.ts'
import { createCharacterPlannerProfile, createManualPlannerProfile, createPlannerClassOptions, type PlannerSetupSubmission } from '../planner-setup.ts'
import { nextResearchSort, researchItemPreferenceKey } from './research-item-table.ts'
import { buildPlannerRows, buildPlannerResearchRows } from './planner-results.ts'

export type LevelingPlannerControls = Extract<AppRoute, { workspace: 'planner' }>['controls']

export interface LevelingPlannerDependencies {
  initialPreferences: AppPreferencesV1
  items: () => CollectionItem[]
  snapshot: () => CollectionSnapshot | null
  skillNames: () => string[]
  archivedRecords: () => ReadonlySet<string>
  isArchivedItem: (item: CollectionItem) => boolean
  ownershipLabel: (item: CollectionItem) => string | null
  itemSearchDocument: (item: CollectionItem) => SearchDocument
  formatPresentationLine: (line: ItemPresentationLine) => string
  persistPlanner: (patch: Partial<AppPreferencesV1['planner']>) => void
  persistDisplay: (display: PlannerDisplay) => void
  listCharacters: () => Promise<CharacterSaveProfile[]>
  readableError: (error: unknown) => string
  reportProblem: (message: string) => void
  reportSuccess: (message: string) => void
}

// Kept alive by the shell so navigation never resets drafts or in-flight discovery.
// Domain state and persistence stay here; the workspace owns DOM/focus presentation.
export function createLevelingPlannerSession(options: LevelingPlannerDependencies) {
  const { initialPreferences, isArchivedItem, formatPresentationLine } = options
  const plannerCatalogItems = computed(options.items)
  const snapshot = computed(options.snapshot)
  const skillNames = computed(options.skillNames)
  const skillMasteries = computed(() => snapshot.value?.skillMasteries)
  const archivedRecordSet = computed(options.archivedRecords)
  const plannerOwnershipLabel = options.ownershipLabel
  const itemStructuredSearchDocument = options.itemSearchDocument
  let restoringRoute = false

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
  const plannerIgnoredRecords = computed<string[]>({
    get: () => plannerProfiles.value.find((profile) => profile.id === selectedPlannerProfileId.value)?.ignoredRecords ?? [],
    set: (records) => {
      plannerProfiles.value = plannerProfiles.value.map((profile) => profile.id === selectedPlannerProfileId.value
        ? { ...profile, ignoredRecords: [...records], modifiedAt: new Date().toISOString() }
        : profile)
    }
  })
  const plannerFavoriteRecords = ref<string[]>([...initialPreferences.planner.favoriteRecords])
  const plannerShowIgnored = ref(false)

  const discoveredCharacters = ref<CharacterSaveProfile[]>([])
  const characterImportLoading = ref(false)
  const characterImportError = ref<string | null>(null)
  const atlasRegionQuery = ref('')
  const selectedAtlasRegion = ref<string | null>(null)

  const plannerStructuredQuery = computed(() => compileSearchQuery(plannerQuery.value, searchQueryOptions(searchSchemas.planner)))
  const atlasStructuredQuery = computed(() => compileSearchQuery(atlasRegionQuery.value, searchQueryOptions(searchSchemas.atlas)))


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


  const plannerSkillOptions = computed(() => {
    const needle = plannerSkillDraft.value.trim().toLocaleLowerCase()
    return skillNames.value
      .filter((skill) => !plannerSkills.value.includes(skill))
      .filter((skill) => !needle || skill.toLocaleLowerCase().includes(needle))
      .slice(0, 30)
  })

  const plannerRows = computed(() => buildPlannerRows({
    items: plannerCatalogItems.value,
    controls: {
      skills: plannerSkills.value, minimumLevel: plannerMinimumLevel.value, maximumLevel: plannerLevelCap.value,
      ownership: plannerOwnership.value, sort: plannerSortMode.value, direction: plannerSortDirection.value,
      showIgnored: plannerShowIgnored.value
    },
    masteries: selectedPlannerProfile.value?.masteries ?? [],
    query: plannerStructuredQuery.value,
    searchDocument: plannerSearchDocument,
    isArchivedItem,
    formatPresentationLine,
    ignoredRecords: plannerIgnoredRecordSet.value
  }))
  const plannerResearchRows = computed(() => buildPlannerResearchRows({
    rows: plannerRows.value,
    archivedRecords: archivedRecordSet.value,
    ownershipLabel: plannerOwnershipLabel,
    recipeStatus,
    isFavorite: isPlannerFavorite,
    ignored: plannerShowIgnored.value
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
      discoveredCharacters.value = await options.listCharacters()
    } catch (error) {
      characterImportError.value = options.readableError(error)
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
      options.reportProblem('The source character save could not be found. The existing plan was not changed.')
      return
    }
    importCharacterProfile(character)
    options.reportSuccess(`Refreshed ${profile.name} from its character save.`)
  }

  function deletePlannerProfile(): void {
    if (plannerProfiles.value.length <= 1) return
    const index = plannerProfiles.value.findIndex((profile) => profile.id === selectedPlannerProfileId.value)
    plannerProfiles.value = plannerProfiles.value.filter((profile) => profile.id !== selectedPlannerProfileId.value)
    const fallback = plannerProfiles.value[Math.max(0, index - 1)] ?? plannerProfiles.value[0]
    if (fallback) selectPlannerProfile(fallback.id)
  }

  function plannerRecordKey(item: CollectionItem): string {
    return researchItemPreferenceKey(item)
  }

  function sortPlannerTable(sort: string): void {
    if (sort !== 'name' && sort !== 'level' && sort !== 'rarity') return
    const next = nextResearchSort(plannerSortMode.value, plannerSortDirection.value, sort)
    plannerSortMode.value = next.sort
    plannerSortDirection.value = next.direction
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


  function contentPackRank(contentPack: string): number {
    return ({ base: 0, gdx1: 1, gdx2: 2, gdx3: 3 } as Record<string, number>)[contentPack] ?? 9
  }


  watch(plannerMinimumLevel, (level) => {
    plannerMinimumLevelDraft.value = level
    if (level > plannerLevelCap.value) plannerLevelCap.value = level
  })
  watch(plannerLevelCap, (level) => {
    plannerLevelCapDraft.value = level
    if (level < plannerMinimumLevel.value) plannerMinimumLevel.value = level
  })
  watch(plannerDisplay, (plannerDisplay) => options.persistDisplay(plannerDisplay))
  watch([plannerQuery, plannerOwnership, plannerShowIgnored, plannerSortMode, plannerSortDirection, plannerSkills, plannerMinimumLevel, plannerLevelCap], () => {
    if (restoringRoute) return
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
    options.persistPlanner({
      profiles: profiles.map((profile) => ({
        ...profile,
        skills: [...profile.skills],
        excludedSkills: [...profile.excludedSkills]
      }))
    })
  }, { deep: true, immediate: true })
  watch(selectedPlannerProfileId, (profileId) => {
    options.persistPlanner({ selectedProfileId: profileId })
  })
  watch(plannerFavoriteRecords, (records) => {
    options.persistPlanner({ favoriteRecords: [...records] })
  }, { deep: true })
  watch([plannerMapScope, plannerMinimumLevel, plannerLevelCap, plannerSkills], () => {
    if (restoringRoute) return
    selectedAtlasRegion.value = null
  })
  watch(visibleAtlasRegions, (regions) => {
    if (restoringRoute) return
    if (!regions.some((region) => region.key === selectedAtlasRegion.value)) {
      selectedAtlasRegion.value = regions[0]?.key ?? null
    }
  }, { immediate: true })

  const routeControls = computed<LevelingPlannerControls>(() => ({
    profileId: selectedPlannerProfileId.value, skills: [...plannerSkills.value], minimumLevel: plannerMinimumLevel.value,
    maximumLevel: plannerLevelCap.value, query: plannerQuery.value, ownership: plannerOwnership.value,
    showIgnored: plannerShowIgnored.value, sort: plannerSortMode.value, direction: plannerSortDirection.value,
    display: plannerDisplay.value, page: plannerPage.value, atlasQuery: atlasRegionQuery.value,
    atlasRegion: selectedAtlasRegion.value, mapScope: plannerMapScope.value, mapSort: plannerMapSortMode.value,
    mapDirection: plannerMapSortDirection.value
  }))
  function restoreRoute(controls: LevelingPlannerControls): void {
    restoringRoute = true
    applyingPlannerProfile = true
    if (controls.profileId) selectPlannerProfile(controls.profileId)
    if (controls.skills.length > 0) plannerSkills.value = [...controls.skills]
    plannerMinimumLevel.value = controls.minimumLevel
    plannerLevelCap.value = Math.max(controls.minimumLevel, controls.maximumLevel)
    plannerQuery.value = controls.query
    plannerOwnership.value = controls.ownership
    plannerShowIgnored.value = controls.showIgnored
    plannerSortMode.value = controls.sort
    plannerSortDirection.value = controls.direction
    plannerDisplay.value = controls.display
    plannerPage.value = controls.page
    atlasRegionQuery.value = controls.atlasQuery
    selectedAtlasRegion.value = controls.atlasRegion
    plannerMapScope.value = controls.mapScope
    plannerMapSortMode.value = controls.mapSort
    plannerMapSortDirection.value = controls.mapDirection

    void nextTick(() => {
      applyingPlannerProfile = false
      restoringRoute = false
    })
  }

  function buildFromOracle(candidate: Pick<OracleCandidate, 'skill' | 'relatedSkills'>, minimumLevel: number, maximumLevel: number): void {
    plannerSkills.value = [...new Set([candidate.skill, ...candidate.relatedSkills])]
    plannerMinimumLevelDraft.value = Math.min(plannerMinimumLevel.value, minimumLevel)
    plannerLevelCapDraft.value = Math.max(plannerLevelCap.value, maximumLevel)
    plannerMinimumLevel.value = plannerMinimumLevelDraft.value
    plannerLevelCap.value = plannerLevelCapDraft.value
    plannerQuery.value = ''
    plannerOwnership.value = 'all'
  }

  return {
    plannerProfiles,
    selectedPlannerProfileId,
    plannerSkills,
    plannerSkillDraft,
    plannerSetupOpen,
    plannerMinimumLevel,
    plannerLevelCap,
    plannerMinimumLevelDraft,
    plannerLevelCapDraft,
    plannerDisplay,
    plannerPage,
    plannerMapScope,
    plannerMapSortMode,
    plannerMapSortDirection,
    plannerQuery,
    plannerOwnership,
    plannerSortMode,
    plannerSortDirection,
    plannerIgnoredRecords,
    plannerFavoriteRecords,
    plannerShowIgnored,
    discoveredCharacters,
    characterImportLoading,
    characterImportError,
    atlasRegionQuery,
    selectedAtlasRegion,
    plannerStructuredQuery,
    atlasStructuredQuery,
    selectedPlannerProfile,
    plannerClassOptions,
    plannerSkillOptions,
    plannerRows,
    plannerResearchRows,
    plannerMiItems,
    atlasRegions,
    unlocatedPlannerMiItems,
    visibleAtlasRegions,
    atlasMapPins,
    selectedAtlasItems,
    addPlannerSkill,
    removePlannerSkill,
    restorePlannerSkill,
    selectPlannerProfile,
    commitPlannerMinimumLevel,
    commitPlannerLevelCap,
    openPlannerSetup,
    loadCharacterProfiles,
    completePlannerSetup,
    refreshSelectedCharacterProfile,
    deletePlannerProfile,
    sortPlannerTable,
    recipeStatus,
    isPlannerFavorite,
    togglePlannerFavorite,
    togglePlannerIgnored,
    routeControls,
    restoreRoute,
    buildFromOracle,
    skillNames,
    skillMasteries
  }
}

export type LevelingPlannerSession = ReturnType<typeof createLevelingPlannerSession>
