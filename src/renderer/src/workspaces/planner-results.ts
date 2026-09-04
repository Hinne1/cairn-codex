import type { CollectionItem, ItemPresentationLine } from '@shared/contracts'
import type { CompiledSearchQuery, SearchDocument } from '@shared/search-query'
import type { AppRoute } from '../app-route'
import { masteryMatchesForItem, type PlannerMasteryMatch } from '../planner-item-matches.ts'
import { skillMatchForItem, type SkillMatch } from './skill-explorer.ts'
import {
  researchAcquisitionFacts, researchItemIsAvailable, researchItemPreferenceKey,
  researchItemTypeLabel, researchRollFact, researchSkillName, type ResearchItemTableRow
} from './research-item-table.ts'

type PlannerControls = Extract<AppRoute, { workspace: 'planner' }>['controls']
export interface PlannerItemRow {
  item: CollectionItem
  matches: SkillMatch[]
  masteryMatches: PlannerMasteryMatch[]
  petBonuses: string[]
}
export type PlannerRecipeStatus = { label: string; known: boolean | null } | null

export function buildPlannerRows({
  items, controls, masteries, query, searchDocument, isArchivedItem, formatPresentationLine, ignoredRecords
}: {
  items: readonly CollectionItem[]
  controls: Pick<PlannerControls, 'skills' | 'minimumLevel' | 'maximumLevel' | 'ownership' | 'sort' | 'direction' | 'showIgnored'>
  masteries: string[]
  query: Pick<CompiledSearchQuery, 'matches'>
  searchDocument: (item: CollectionItem) => SearchDocument
  isArchivedItem: (item: CollectionItem) => boolean
  formatPresentationLine: (line: ItemPresentationLine) => string
  ignoredRecords: ReadonlySet<string>
}): PlannerItemRow[] {
  return items
    .filter((item) => item.levelRequirement >= controls.minimumLevel)
    .filter((item) => item.levelRequirement <= controls.maximumLevel)
    .filter((item) => {
      const archived = isArchivedItem(item)
      if (controls.ownership === 'owned') return archived
      if (controls.ownership === 'missing') return !archived
      return true
    })
    .filter((item) => query.matches(searchDocument(item)))
    .flatMap((item) => {
      const matches = controls.skills
        .map((skill) => skillMatchForItem(item, skill))
        .filter((match): match is SkillMatch => match !== null)
      const masteryMatches = masteryMatchesForItem(item, masteries)
      const petBonuses = (item.presentation?.sections ?? [])
        .filter((section) => section.kind === 'pet')
        .flatMap((section) => section.lines)
        .map(formatPresentationLine)
      return matches.length > 0 || masteryMatches.length > 0
        ? [{ item, matches, masteryMatches, petBonuses }]
        : []
    })
    .sort((left, right) => {
      const direction = controls.direction === 'asc' ? 1 : -1
      const rarityRank: Record<string, number> = { legendary: 5, epic: 4, mi: 3, faction: 2, rare: 1 }
      let comparison = 0
      if (controls.sort === 'name') comparison = left.item.name.localeCompare(right.item.name)
      else if (controls.sort === 'rarity') {
        comparison = (rarityRank[left.item.rarity] ?? 0) - (rarityRank[right.item.rarity] ?? 0)
      } else comparison = left.item.levelRequirement - right.item.levelRequirement
      if (comparison === 0) comparison = left.item.name.localeCompare(right.item.name)
      return comparison * direction
    })
    .filter(({ item }) =>
      controls.showIgnored === ignoredRecords.has(researchItemPreferenceKey(item))
    )
}

function masteryMatchEffect(match: PlannerMasteryMatch): string {
  return match.amount > 0
    ? `+${match.amount} rank${match.amount === 1 ? '' : 's'} to every ${match.mastery} skill`
    : `Supports every ${match.mastery} skill`
}


export function buildPlannerResearchRows({
  rows, archivedRecords, ownershipLabel, recipeStatus, isFavorite, ignored
}: {
  rows: readonly PlannerItemRow[]
  archivedRecords: ReadonlySet<string>
  ownershipLabel: (item: CollectionItem) => string | null
  recipeStatus: (item: CollectionItem) => PlannerRecipeStatus
  isFavorite: (item: CollectionItem) => boolean
  ignored: boolean
}): ResearchItemTableRow[] {
  return rows.map((row) => {
    const ownership = ownershipLabel(row.item)
    const roll = researchRollFact(row.item)
    const recipe = recipeStatus(row.item)
    return {
      item: row.item,
      available: researchItemIsAvailable(row.item, archivedRecords, recipe ? recipe.known === true : row.item.recipeUnlocked === true),
      itemType: researchItemTypeLabel(row.item),
      favorite: isFavorite(row.item),
      ignored: ignored,
      supports: [
        ...row.masteryMatches.map((match) => ({
          label: `All ${researchSkillName(match.mastery)} skills`,
          text: match.amount > 0 ? `+${match.amount}` : 'Supported',
          tone: 'accent' as const
        })),
        ...row.matches.map((match) => ({
          label: researchSkillName(match.skill),
          text: match.amount > 0 ? `+${match.amount}` : 'Modifier',
          tone: 'accent' as const
        }))
      ],
      modifiers: [
        ...(row.petBonuses.length ? [{ kind: 'pet' as const, label: 'All pets', text: row.petBonuses.join('; '), tone: 'accent' as const }] : []),
        ...row.masteryMatches.map((match) => ({ kind: 'rank' as const, label: 'Mastery-wide', text: masteryMatchEffect(match), skill: researchSkillName(match.mastery) })),
        ...row.matches.flatMap((match) => [
          ...(match.conversionTarget ? [{ kind: 'conversion' as const, label: 'Converts to', text: match.conversionTarget, tone: 'accent' as const, skill: researchSkillName(match.skill), targetDamageType: match.conversionTarget }] : []),
          ...(match.conversionDetails ? [{ kind: 'conversion' as const, label: researchSkillName(match.skill), text: match.conversionDetails, skill: researchSkillName(match.skill) }] : []),
          ...(match.special ? [{ kind: 'special' as const, label: researchSkillName(match.skill), text: match.special, skill: researchSkillName(match.skill) }] : []),
          ...(!match.conversionDetails && !match.special
            ? [{ kind: 'rank' as const, label: researchSkillName(match.skill), text: match.amount ? `+${match.amount} ranks` : 'Skill support', skill: researchSkillName(match.skill) }]
            : []),
          ...(match.visualTransformation ? [{ kind: 'visual' as const, label: 'Visual', text: match.visualTransformation, tone: 'positive' as const, skill: researchSkillName(match.skill) }] : [])
        ])
      ],
      acquisition: [
        ...(recipe ? [{
          label: 'Blueprint',
          text: recipe.label,
          tone: recipe.known ? 'positive' as const : recipe.known === false ? 'warning' as const : 'muted' as const
        }] : []),
        ...researchAcquisitionFacts(row.item)
      ],
      archive: [
        ...(ownership ? [{ text: ownership, tone: 'positive' as const }] : [{ text: 'Not archived', tone: 'muted' as const }]),
        ...(roll ? [roll] : [])
      ]
    }
  })
}
