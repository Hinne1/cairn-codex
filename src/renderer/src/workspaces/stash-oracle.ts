import type { CompiledSearchQuery } from '@shared/search-query'
import type { AppRoute } from '../app-route'
import type { OracleCandidate, OracleReadiness } from '../stash-oracle'

export type StashOracleControls = Extract<AppRoute, { workspace: 'oracle' }>['controls']

export interface StashOracleView {
  classOptions: string[]
  candidates: OracleCandidate[]
  filteredCandidates: OracleCandidate[]
  readinessCounts: Record<OracleReadiness, number>
}

function normalize(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function updateStashOracleControls(
  controls: StashOracleControls,
  patch: Partial<StashOracleControls>,
  resetPage: boolean
): StashOracleControls {
  return { ...controls, ...patch, ...(resetPage ? { page: 1 } : {}) }
}

export function surpriseStashOracle(controls: StashOracleControls): StashOracleControls {
  return updateStashOracleControls(controls, {
    characterClass: 'all',
    style: 'all',
    readiness: 'all',
    query: ''
  }, true)
}

export function createStashOracleView(
  allCandidates: readonly OracleCandidate[],
  controls: StashOracleControls,
  query: Pick<CompiledSearchQuery, 'matches'>
): StashOracleView {
  const classOptions = [...new Set(allCandidates.map((candidate) => candidate.className))]
    .sort((left, right) => left.localeCompare(right))
  const candidates = controls.characterClass === 'all'
    ? [...allCandidates]
    : allCandidates.filter((candidate) => normalize(candidate.className) === normalize(controls.characterClass))
  const readinessCounts: Record<OracleReadiness, number> = {
    ready: candidates.filter((candidate) => candidate.readiness === 'ready').length,
    near: candidates.filter((candidate) => candidate.readiness === 'near').length,
    wildcard: candidates.filter((candidate) => candidate.readiness === 'wildcard').length
  }
  const direction = controls.direction === 'asc' ? 1 : -1
  const readinessRank: Record<OracleReadiness, number> = { ready: 3, near: 2, wildcard: 1 }
  const filteredCandidates = candidates
    .filter((candidate) => {
      if (controls.readiness !== 'all' && candidate.readiness !== controls.readiness) return false
      return query.matches({
        text: [
          candidate.title,
          candidate.skill,
          candidate.damageType,
          candidate.style,
          candidate.className,
          ...candidate.masteries,
          ...candidate.relatedSkills,
          ...candidate.sets.map((set) => set.name),
          ...candidate.evidence.flatMap((evidence) => [evidence.item.name, ...evidence.reasons])
        ].join(' '),
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
      if (controls.sort === 'name') comparison = left.title.localeCompare(right.title)
      else if (controls.sort === 'class') comparison = left.className.localeCompare(right.className)
      else if (controls.sort === 'readiness') comparison = readinessRank[left.readiness] - readinessRank[right.readiness]
      else comparison = left.score - right.score
      if (comparison === 0) comparison = left.title.localeCompare(right.title)
      return comparison * direction
    })
  return { classOptions, candidates, filteredCandidates, readinessCounts }
}
