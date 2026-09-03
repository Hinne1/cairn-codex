import type { CollectionItem, ItemPresentationLine } from '@shared/contracts'
import type { CompiledSearchQuery } from '@shared/search-query'
import type { AppRoute, SkillSort } from '../app-route'

export type SkillExplorerControls = Extract<AppRoute, { workspace: 'skills' }>['controls']

export interface SkillMatch {
  skill: string
  amount: number
  conversionTarget: string
  conversionDetails: string
  special: string
  visualTransformation: string
}

export interface SkillExplorerRow extends SkillMatch {
  item: CollectionItem
}

export interface SkillExplorerViewOptions {
  isArchivedItem: (item: CollectionItem) => boolean
  query: Pick<CompiledSearchQuery, 'matches'>
}

export type SkillSuggestionDirection = 'next' | 'previous'

export function nextSkillSuggestionIndex(
  currentIndex: number,
  suggestionCount: number,
  direction: SkillSuggestionDirection,
  pickerWasOpen: boolean
): number {
  if (suggestionCount <= 0) return 0
  if (!pickerWasOpen) return direction === 'next' ? 0 : suggestionCount - 1
  const step = direction === 'next' ? 1 : -1
  return (currentIndex + step + suggestionCount) % suggestionCount
}

export function skillSortAriaValue(
  activeSort: SkillSort,
  direction: SkillExplorerControls['direction'],
  column: SkillSort
): 'ascending' | 'descending' | undefined {
  if (activeSort !== column) return undefined
  return direction === 'asc' ? 'ascending' : 'descending'
}

export function updateSkillExplorerControls(
  controls: SkillExplorerControls,
  patch: Partial<SkillExplorerControls>,
  resetPage: boolean
): SkillExplorerControls {
  return { ...controls, ...patch, ...(resetPage ? { page: 1 } : {}) }
}

export function buildSkillNames(
  items: readonly CollectionItem[],
  skillMasteries: Readonly<Record<string, string>> = {}
): string[] {
  const names = new Set<string>(Object.keys(skillMasteries))
  for (const item of items) {
    for (const section of item.presentation?.sections ?? []) {
      if (section.kind === 'skill-modifier' && section.heading) names.add(section.heading)
      for (const line of section.lines) {
        if (line.tone === 'skill' && line.label.startsWith('to ')) names.add(line.label.slice(3))
      }
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right))
}

export function skillMatchForItem(item: CollectionItem, requestedSkill: string): SkillMatch | null {
  const normalizedSkill = requestedSkill.trim().toLocaleLowerCase()
  if (!normalizedSkill) return null
  const sections = item.presentation?.sections ?? []
  const amount = Math.max(
    0,
    ...sections
      .flatMap((section) => section.lines)
      .filter((line) =>
        line.tone === 'skill' &&
        line.label.startsWith('to ') &&
        line.label.slice(3).toLocaleLowerCase() === normalizedSkill
      )
      .map((line) => line.minimum ?? 0)
  )
  const modifiers = sections
    .filter((section) =>
      section.kind === 'skill-modifier' &&
      section.heading?.toLocaleLowerCase() === normalizedSkill
    )
    .flatMap((section) => section.lines)
  const visualTransformationLines = sections
    .filter((section) =>
      section.kind === 'visual-modifier' &&
      skillSectionHeading(section.heading, normalizedSkill)
    )
    .flatMap((section) => section.lines)
  if (amount === 0 && modifiers.length === 0 && visualTransformationLines.length === 0) return null
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
    special: specialLines.map(formatPresentationLine).join('; '),
    visualTransformation: visualTransformationLines.map(formatPresentationLine).join('; ')
  }
}

export function createSkillExplorerRows(
  items: readonly CollectionItem[],
  controls: SkillExplorerControls,
  options: SkillExplorerViewOptions
): SkillExplorerRow[] {
  const skill = controls.skill.trim().toLocaleLowerCase()
  if (!skill) return []
  const candidates = items.flatMap((item) => {
    if (controls.scope === 'archive' && !options.isArchivedItem(item)) return []
    const match = skillMatchForItem(item, skill)
    return match ? [{ item, ...match }] : []
  })
  const miByBase = new Map<string, SkillExplorerRow>()
  const rows = candidates.filter((row) => {
    if (row.item.rarity !== 'mi') return true
    const key = `${row.item.name.toLocaleLowerCase()}|${row.item.slot}`
    const current = miByBase.get(key)
    if (!current || row.item.levelRequirement < current.item.levelRequirement) miByBase.set(key, row)
    return false
  })
  rows.push(...miByBase.values())
  return rows
    .filter((row) => controls.rarity === 'all' || row.item.rarity === controls.rarity)
    .filter((row) => controls.slot === 'all' || row.item.slot === controls.slot)
    .filter((row) => {
      const presentation = presentationSearchText(row.item)
      return options.query.matches({
        text: [
          row.item.name,
          row.item.rarity,
          row.item.slot,
          row.item.levelRequirement,
          row.amount,
          row.conversionTarget,
          row.conversionDetails,
          row.special,
          row.visualTransformation,
          presentation
        ].join(' '),
        fields: {
          name: row.item.name,
          skill: [row.skill, presentation],
          damage: [row.conversionTarget, row.conversionDetails, presentation],
          stat: [row.special, row.visualTransformation, presentation],
          slot: row.item.slot,
          rarity: row.item.rarity,
          level: row.item.levelRequirement,
          conversion: [row.conversionTarget, row.conversionDetails],
          owned: options.isArchivedItem(row.item)
        }
      })
    })
    .sort((left, right) => compareSkillRows(left, right, controls.sort, controls.direction))
}

export function nextSkillSortControls(
  controls: SkillExplorerControls,
  sort: SkillSort
): SkillExplorerControls {
  if (controls.sort === sort) {
    return updateSkillExplorerControls(
      controls,
      { direction: controls.direction === 'asc' ? 'desc' : 'asc' },
      true
    )
  }
  const direction = ['item', 'slot', 'conversion', 'special', 'level'].includes(sort) ? 'asc' : 'desc'
  return updateSkillExplorerControls(controls, { sort, direction }, true)
}

function compareSkillRows(
  left: SkillExplorerRow,
  right: SkillExplorerRow,
  sort: SkillSort,
  direction: SkillExplorerControls['direction']
): number {
  let comparison = 0
  if (sort === 'amount') {
    const leftHasModifier = left.conversionDetails.length > 0 || left.special.length > 0 || left.visualTransformation.length > 0 ? 1 : 0
    const rightHasModifier = right.conversionDetails.length > 0 || right.special.length > 0 || right.visualTransformation.length > 0 ? 1 : 0
    comparison = leftHasModifier - rightHasModifier || left.amount - right.amount
  } else if (sort === 'slot') comparison = left.item.slot.localeCompare(right.item.slot)
  else if (sort === 'conversion') comparison = left.conversionTarget.localeCompare(right.conversionTarget)
  else if (sort === 'special') comparison = left.special.localeCompare(right.special)
  else if (sort === 'level') comparison = left.item.levelRequirement - right.item.levelRequirement
  else comparison = left.item.name.localeCompare(right.item.name)
  if (comparison === 0) comparison = left.item.name.localeCompare(right.item.name)
  return direction === 'asc' ? comparison : -comparison
}

function presentationSearchText(item: CollectionItem): string {
  return (item.presentation?.sections ?? [])
    .flatMap((section) => [
      section.heading ?? '',
      ...section.lines.map((line) => `${line.prefix} ${line.label} ${line.suffix}`)
    ])
    .join(' ')
}

function skillSectionHeading(heading: string | null, normalizedSkill: string): boolean {
  if (!heading) return false
  const normalizedHeading = heading.toLocaleLowerCase()
  return normalizedHeading === normalizedSkill || normalizedHeading.startsWith(`${normalizedSkill} ·`)
}

function formatPresentationLine(line: ItemPresentationLine): string {
  const minimum = formatRollValue(line.minimum)
  const maximum = formatRollValue(line.maximum)
  const range = maximum ? `${minimum}${line.unit} - ${maximum}${line.unit}` : `${minimum}${line.unit}`
  return `${line.prefix}${range}${range ? ' ' : ''}${line.label}${line.suffix}`
}

function formatRollValue(value: number | null): string {
  if (value === null) return ''
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '')
}

function conversionTarget(label: string): string | null {
  const match = label.match(/converted to\s+(.+)$/i)
  const target = match?.[1]?.replace(/\s+Damage$/i, '').trim()
  return target || null
}

function isDamageTypeConversion(label: string): boolean {
  return /\bDamage converted to .+ Damage\b/i.test(label)
}
