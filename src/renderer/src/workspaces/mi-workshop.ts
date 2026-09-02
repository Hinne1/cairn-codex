import { ref, type Ref } from 'vue'
import type {
  CollectionAffix,
  CollectionItem,
  ItemPresentation,
  ObservedStashItem
} from '@shared/contracts'
import type { CompiledSearchQuery } from '@shared/search-query'
import type { AppRoute, MiMetricKey, SortDirection } from '../app-route'

export type MiWorkshopControls = Extract<AppRoute, { workspace: 'mi-workshop' }>['controls']

export interface MiWorkshopSession {
  showReserves: Ref<boolean>
}

export interface MiMetricOption {
  key: MiMetricKey
  label: string
}

export interface MiMetricOptions {
  quality: MiMetricOption[]
  item: MiMetricOption[]
  pet: MiMetricOption[]
}

export interface MiMetricResult {
  value: number | null
  percentile: number | null
  display: string
}

export interface MiWorkshopRow {
  key: string
  base: CollectionItem
  prefix: string
  prefixRarity: 'magical' | 'rare' | null
  suffix: string
  suffixRarity: 'magical' | 'rare' | null
  copies: ObservedStashItem[]
  leader: ObservedStashItem
  selectedMetric: MiMetricResult
}

export interface MiWorkshopViewOptions {
  items: readonly CollectionItem[]
  affixes: readonly CollectionAffix[]
  copies: readonly ObservedStashItem[]
  controls: MiWorkshopControls
  query: Pick<CompiledSearchQuery, 'matches'>
}

interface AffixPresentation {
  name: string
  rarity: 'magical' | 'rare'
  presentation?: ItemPresentation
}

export function createMiWorkshopSession(): MiWorkshopSession {
  return { showReserves: ref(false) }
}

export function updateMiWorkshopControls(
  controls: MiWorkshopControls,
  patch: Partial<MiWorkshopControls>,
  resetPage: boolean
): MiWorkshopControls {
  return { ...controls, ...patch, ...(resetPage ? { page: 1 } : {}) }
}

export function miFamilyKey(item: CollectionItem): string {
  return `${item.slot}\0${item.name.normalize('NFKC').trim().toLocaleLowerCase()}`
}

export function buildMiMetricOptions(copies: readonly ObservedStashItem[]): MiMetricOptions {
  const itemFields = new Set<string>()
  const petFields = new Set<string>()
  for (const copy of copies) {
    for (const stat of copy.rollAnalysis?.stats ?? []) itemFields.add(stat.field)
    for (const stat of copy.rollAnalysis?.petStats ?? []) petFields.add(stat.field)
  }
  const byLabel = (left: string, right: string) =>
    humanStatName(left).localeCompare(humanStatName(right)) || left.localeCompare(right)
  return {
    quality: [
      { key: 'overall', label: 'Overall roll quality' },
      { key: 'base', label: 'Base roll quality' },
      { key: 'prefix', label: 'Prefix roll quality' },
      { key: 'suffix', label: 'Suffix roll quality' }
    ],
    item: [...itemFields].sort(byLabel).map((field) => ({
      key: `item:${field}` as MiMetricKey,
      label: humanStatName(field)
    })),
    pet: [...petFields].sort(byLabel).map((field) => ({
      key: `pet:${field}` as MiMetricKey,
      label: humanStatName(field)
    }))
  }
}

export function miMetricLabel(options: MiMetricOptions, metric: MiMetricKey): string {
  const option = [...options.quality, ...options.item, ...options.pet]
    .find((candidate) => candidate.key === metric)
  if (!option) return 'Overall roll quality'
  return metric.startsWith('pet:') ? `Pet · ${option.label}` : option.label
}

export function createMiWorkshopRows(options: MiWorkshopViewOptions): MiWorkshopRow[] {
  const bases = new Map(
    options.items
      .filter((item) => item.rarity === 'mi')
      .map((item) => [item.record.toLocaleLowerCase(), item])
  )
  const affixByRecord = buildAffixIndex(options.affixes)
  const grouped = new Map<string, Omit<MiWorkshopRow, 'leader' | 'selectedMetric'>>()
  for (const copy of options.copies) {
    const base = bases.get(copy.baseRecord.toLocaleLowerCase())
    if (!base) continue
    const prefix = affixByRecord.get(copy.prefixRecord.toLocaleLowerCase())
    const suffix = affixByRecord.get(copy.suffixRecord.toLocaleLowerCase())
    const key = [copy.baseRecord, copy.prefixRecord, copy.suffixRecord]
      .map((value) => value.toLocaleLowerCase())
      .join('|')
    const existing = grouped.get(key)
    if (existing) existing.copies.push(copy)
    else {
      grouped.set(key, {
        key,
        base,
        prefix: prefix?.name ?? recordLabel(copy.prefixRecord, 'No prefix'),
        prefixRarity: prefix?.rarity ?? null,
        suffix: suffix?.name ?? recordLabel(copy.suffixRecord, 'No suffix'),
        suffixRarity: suffix?.rarity ?? null,
        copies: [copy]
      })
    }
  }
  const direction = options.controls.metricDirection === 'asc' ? 1 : -1
  return [...grouped.values()]
    .map((group): MiWorkshopRow => {
      const copies = [...group.copies].sort((left, right) =>
        compareCopiesByMiMetric(left, right, options.controls.metric, 'desc')
      )
      const leader = copies[0]!
      return { ...group, copies, leader, selectedMetric: miMetricResult(leader, options.controls.metric) }
    })
    .filter((group) => options.controls.affix === 'all' ||
      (group.prefixRarity === 'rare' && group.suffixRarity === 'rare'))
    .filter((group) => {
      const presentation = [
        presentationSearchText(group.base.presentation),
        ...group.copies.flatMap((copy) => [
          presentationSearchText(affixByRecord.get(copy.prefixRecord.toLocaleLowerCase())?.presentation),
          presentationSearchText(affixByRecord.get(copy.suffixRecord.toLocaleLowerCase())?.presentation)
        ])
      ].join(' ')
      return options.query.matches({
        text: [
          group.base.name,
          group.base.record,
          group.base.slot,
          group.base.levelRequirement,
          group.prefix,
          group.suffix,
          presentation
        ].join(' '),
        fields: {
          name: group.base.name,
          slot: group.base.slot,
          level: group.base.levelRequirement,
          prefix: group.prefix,
          suffix: group.suffix,
          affix: [group.prefix, group.suffix],
          skill: presentation,
          damage: presentation,
          stat: presentation,
          copies: group.copies.length
        }
      })
    })
    .sort((left, right) => compareMiWorkshopRows(left, right, options.controls, direction))
}

export function miMetricResult(copy: ObservedStashItem, metric: MiMetricKey): MiMetricResult {
  const analysis = copy.rollAnalysis
  if (!analysis) return { value: null, percentile: null, display: '—' }
  const qualityValues: Record<'overall' | 'base' | 'prefix' | 'suffix', number | null> = {
    overall: analysis.overallEstimatedPercentile,
    base: analysis.baseEstimatedPercentile,
    prefix: analysis.prefixEstimatedPercentile,
    suffix: analysis.suffixEstimatedPercentile
  }
  if (metric === 'overall' || metric === 'base' || metric === 'prefix' || metric === 'suffix') {
    const value = qualityValues[metric]
    return { value, percentile: value, display: formatPercentile(value) }
  }
  const pet = metric.startsWith('pet:')
  const field = metric.slice(metric.indexOf(':') + 1)
  const stat = (pet ? analysis.petStats : analysis.stats)?.find((candidate) => candidate.field === field)
  if (!stat) return { value: null, percentile: null, display: '—' }
  return {
    value: stat.value,
    percentile: stat.estimatedPercentile,
    display: `${formatRollValue(stat.value)}${stat.estimatedPercentile === null ? '' : ` · ${stat.estimatedPercentile.toFixed(0)}%`}`
  }
}

export function compareCopiesByMiMetric(
  left: ObservedStashItem,
  right: ObservedStashItem,
  metric: MiMetricKey,
  direction: SortDirection
): number {
  const leftMetric = miMetricResult(left, metric)
  const rightMetric = miMetricResult(right, metric)
  if (leftMetric.value === null && rightMetric.value !== null) return 1
  if (leftMetric.value !== null && rightMetric.value === null) return -1
  if (leftMetric.value !== null && rightMetric.value !== null && leftMetric.value !== rightMetric.value) {
    return direction === 'asc'
      ? leftMetric.value - rightMetric.value
      : rightMetric.value - leftMetric.value
  }
  return (
    (right.rollAnalysis?.overallEstimatedPercentile ?? -1) -
    (left.rollAnalysis?.overallEstimatedPercentile ?? -1)
  )
}

export function formatPercentile(value: number | null | undefined): string {
  return value == null ? '—' : `${value.toFixed(1)}%`
}

export function humanStatName(field: string): string {
  const names: Record<string, string> = {
    characterStrength: 'Physique',
    characterDexterity: 'Cunning',
    characterAttackSpeedModifier: 'Attack speed',
    characterSpellCastSpeedModifier: 'Cast speed',
    characterRunSpeedModifier: 'Movement speed',
    characterTotalSpeedModifier: 'Total speed',
    characterIntelligence: 'Spirit',
    characterLife: 'Health',
    characterLifeModifier: 'Health',
    characterMana: 'Energy',
    characterManaModifier: 'Energy',
    characterDefensiveAbility: 'Defensive ability',
    characterOffensiveAbility: 'Offensive ability',
    characterOffensiveAbilityModifier: 'Offensive ability',
    conversionPercentage: 'Damage conversion',
    offensiveTotalDamageModifier: 'All damage',
    offensivePhysical: 'Physical damage',
    offensivePhysicalModifier: 'Physical damage',
    offensivePierce: 'Pierce damage',
    offensivePierceModifier: 'Pierce damage',
    offensiveFire: 'Fire damage',
    offensiveFireModifier: 'Fire damage',
    offensiveCold: 'Cold damage',
    offensiveColdModifier: 'Cold damage',
    offensiveLightning: 'Lightning damage',
    offensiveLightningModifier: 'Lightning damage',
    offensivePoison: 'Acid damage',
    offensivePoisonModifier: 'Acid damage',
    offensiveLife: 'Vitality damage',
    offensiveLifeModifier: 'Vitality damage',
    offensiveAether: 'Aether damage',
    offensiveAetherModifier: 'Aether damage',
    offensiveChaos: 'Chaos damage',
    offensiveChaosModifier: 'Chaos damage',
    offensiveElemental: 'Elemental damage',
    offensiveElementalModifier: 'Elemental damage',
    offensiveCritDamageModifier: 'Critical damage',
    offensiveLifeLeechMin: 'Attack damage converted to health',
    offensiveSlowPhysical: 'Internal trauma damage',
    offensiveSlowPhysicalModifier: 'Internal trauma damage',
    offensiveSlowBleeding: 'Bleeding damage',
    offensiveSlowBleedingModifier: 'Bleeding damage',
    offensiveSlowFire: 'Burn damage',
    offensiveSlowFireModifier: 'Burn damage',
    offensiveSlowCold: 'Frostburn damage',
    offensiveSlowColdModifier: 'Frostburn damage',
    offensiveSlowLightning: 'Electrocute damage',
    offensiveSlowLightningModifier: 'Electrocute damage',
    offensiveSlowPoison: 'Poison damage',
    offensiveSlowPoisonModifier: 'Poison damage',
    offensiveSlowLife: 'Vitality decay',
    offensiveSlowLifeModifier: 'Vitality decay',
    defensivePhysical: 'Physical resistance',
    defensivePierce: 'Pierce resistance',
    defensiveFire: 'Fire resistance',
    defensiveCold: 'Cold resistance',
    defensiveLightning: 'Lightning resistance',
    defensivePoison: 'Acid resistance',
    defensiveLife: 'Vitality resistance',
    defensiveAether: 'Aether resistance',
    defensiveChaos: 'Chaos resistance',
    defensiveBleeding: 'Bleeding resistance',
    defensiveElementalResistance: 'Elemental resistance'
  }
  return names[field] ?? field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (value) => value.toUpperCase())
}

function buildAffixIndex(affixes: readonly CollectionAffix[]): Map<string, AffixPresentation> {
  const index = new Map<string, AffixPresentation>()
  for (const affix of affixes) {
    for (const record of affix.records) {
      index.set(record.toLocaleLowerCase(), {
        name: affix.name,
        rarity: affix.rarity,
        presentation: affix.presentations?.[record]
      })
    }
  }
  return index
}

function compareMiWorkshopRows(
  left: MiWorkshopRow,
  right: MiWorkshopRow,
  controls: MiWorkshopControls,
  direction: number
): number {
  if (controls.sort === 'metric') {
    const leftValue = left.selectedMetric.value
    const rightValue = right.selectedMetric.value
    if (leftValue !== null || rightValue !== null) {
      if (leftValue === null) return 1
      if (rightValue === null) return -1
      if (leftValue !== rightValue) return (leftValue - rightValue) * direction
    }
  }
  if (controls.sort === 'level' && left.base.levelRequirement !== right.base.levelRequirement) {
    return (left.base.levelRequirement - right.base.levelRequirement) * direction
  }
  if (controls.sort === 'name') {
    const byName = left.base.name.localeCompare(right.base.name)
    if (byName !== 0) return byName * direction
  }
  if (controls.sort === 'copies' && left.copies.length !== right.copies.length) {
    return (left.copies.length - right.copies.length) * direction
  }
  return left.base.name.localeCompare(right.base.name) ||
    (left.base.levelRequirement - right.base.levelRequirement) ||
    left.prefix.localeCompare(right.prefix) ||
    left.suffix.localeCompare(right.suffix)
}

function recordLabel(record: string, empty: string): string {
  if (!record) return empty
  return record.replaceAll('\\', '/').split('/').at(-1)?.replace(/\.dbr$/i, '') ?? record
}

function presentationSearchText(presentation: ItemPresentation | undefined): string {
  return (presentation?.sections ?? [])
    .flatMap((section) => [
      section.heading ?? '',
      ...section.lines.map((line) => `${line.prefix} ${line.label} ${line.suffix}`)
    ])
    .join(' ')
}

function formatRollValue(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1)
}
