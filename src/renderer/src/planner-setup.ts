import type { StoredPlannerProfile } from './preference-repository.ts'
import type { CharacterSaveProfile } from '@shared/contracts'

export type PlannerSetupSource = 'blank' | 'character' | 'clone'

export interface PlannerClassOption {
  className: string
  masteries: string[]
}

export interface PlannerSetupSubmission {
  source: PlannerSetupSource
  name: string
  className: string
  masteries: string[]
  skills: string[]
  minimumLevel: number
  levelCap: number
  characterPath?: string
  cloneProfileId?: string
}

export function createPlannerClassOptions(classNames: Record<string, string> | undefined): PlannerClassOption[] {
  const unique = new Map<string, PlannerClassOption>()
  for (const [pair, className] of Object.entries(classNames ?? {})) {
    const masteries = pair.split('|').map((mastery) => mastery.trim()).filter(Boolean)
    const name = className.trim()
    if (!name || masteries.length !== 2) continue
    const key = name.toLocaleLowerCase()
    if (!unique.has(key)) unique.set(key, { className: name, masteries })
  }
  return [...unique.values()].sort((left, right) => left.className.localeCompare(right.className))
}

export function createManualPlannerProfile(
  submission: PlannerSetupSubmission,
  id: string,
  modifiedAt: string
): StoredPlannerProfile {
  const minimumLevel = Math.max(1, Math.min(100, Math.round(submission.minimumLevel)))
  const levelCap = Math.max(minimumLevel, Math.min(100, Math.round(submission.levelCap)))
  return {
    id,
    name: submission.name.trim().slice(0, 60),
    className: submission.className.trim().slice(0, 80),
    masteries: [...new Set(submission.masteries.map((mastery) => mastery.trim()).filter(Boolean))].slice(0, 2),
    skills: [...new Set(submission.skills.map((skill) => skill.trim()).filter(Boolean))].slice(0, 128),
    excludedSkills: [],
    minimumLevel,
    levelCap,
    source: 'manual',
    modifiedAt
  }
}

export function createCharacterPlannerProfile(input: {
  character: CharacterSaveProfile
  skillNames: string[]
  classOptions: PlannerClassOption[]
  existing?: StoredPlannerProfile
  setup?: PlannerSetupSubmission
  id: string
  modifiedAt: string
}): StoredPlannerProfile {
  const { character, existing, setup } = input
  const validNames = new Map(input.skillNames.map((name) => [name.toLocaleLowerCase(), name]))
  const parsedSkills = [...new Set(character.skills
    .map((skill) => validNames.get(skill.name.toLocaleLowerCase()))
    .filter((skill): skill is string => Boolean(skill)))]
  const excludedSkills = setup
    ? []
    : existing?.excludedSkills.filter((skill) => parsedSkills.includes(skill)) ?? []
  const classOption = input.classOptions.find((option) =>
    option.className.localeCompare(setup?.className ?? character.className, undefined, { sensitivity: 'base' }) === 0
  )
  const minimumLevel = Math.max(1, Math.min(100, Math.round(
    setup?.minimumLevel ?? (existing?.characterLevel === undefined ? character.level : existing.minimumLevel)
  )))
  const levelCap = Math.max(minimumLevel, Math.min(100, Math.round(
    setup?.levelCap ?? existing?.levelCap ?? Math.max(70, character.level)
  )))
  return {
    id: existing?.id ?? input.id,
    name: (setup?.name ?? character.name).trim().slice(0, 60),
    className: (classOption?.className ?? character.className).trim().slice(0, 80),
    masteries: [...new Set(setup?.masteries ?? classOption?.masteries ?? [])].slice(0, 2),
    skills: [...new Set(setup?.skills ?? parsedSkills.filter((skill) => !excludedSkills.includes(skill)))].slice(0, 128),
    excludedSkills,
    minimumLevel,
    levelCap,
    source: 'character',
    ...(existing?.ignoredRecords ? { ignoredRecords: [...existing.ignoredRecords] } : {}),
    characterPath: character.path,
    characterLevel: character.level,
    isHardcore: character.isHardcore,
    modifiedAt: input.modifiedAt
  }
}

export function plannerSkillsForMasteries(
  skills: string[],
  skillMasteries: Record<string, string> | undefined,
  masteries: string[]
): string[] {
  const selected = new Set(masteries.map((mastery) => mastery.toLocaleLowerCase()))
  if (!selected.size) return [...skills]
  const masteryBySkill = new Map(
    Object.entries(skillMasteries ?? {}).map(([skill, mastery]) => [skill.toLocaleLowerCase(), mastery.toLocaleLowerCase()])
  )
  return skills.filter((skill) => selected.has(masteryBySkill.get(skill.toLocaleLowerCase()) ?? ''))
}
