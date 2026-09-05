import type { CollectionItem, ObservedStashItem, RolledStat } from '../../../shared/contracts.ts'
import { rollStatQuality, averageRollQuality, formatCombinationPercentile } from '../roll-rating.ts'
import { humanStatName } from '../workspaces/mi-workshop.ts'
import { formatRollValue } from '../item-presentation.ts'

export interface PresentedRollStat {
  key: string
  label: string
  value: number
  maximumValue: number | null
  unit: string
  valueLabel: string
  qualityPercent: number | null
  rankLabel: string | null
  rankDescription: string
  rangeLabel: string
}



export interface ComparisonStatRow extends PresentedRollStat {
  deltaLabel: string
  deltaTone: 'positive' | 'negative' | 'same' | 'unique' | 'missing' | 'reference'
  qualityDeltaLabel: string | null
  missingFromCopy: boolean
}

export function presentRolledStats(source: RolledStat[] | undefined, includeFixed = false, item: CollectionItem | null = null): PresentedRollStat[] {
  const stats = (source ?? [])
    .filter((stat) => includeFixed || stat.estimatedPercentile !== null)
  const byField = new Map(stats.map((stat) => [stat.field, stat]))
  const consumed = new Set<string>()
  return stats
    .flatMap<PresentedRollStat>((stat): PresentedRollStat[] => {
      if (consumed.has(stat.field)) return []
      if (stat.field.endsWith('Max') && byField.has(stat.field.slice(0, -3))) return []
      const root = stat.field.endsWith('Min') ? stat.field.slice(0, -3) : stat.field
      const maximum = byField.get(root + 'Max')
      if (maximum && maximum.field !== stat.field) {
        if (maximum && (includeFixed || maximum.estimatedPercentile !== null)) {
          consumed.add(maximum.field)
          const unit = rollStatUnit(root)
          const valueLabel =
            stat.value === maximum.value
              ? `${formatRollValue(stat.value)}${unit}`
              : `${formatRollValue(stat.value)}–${formatRollValue(maximum.value)}${unit}`
          return [
            {
              key: root,
              label: rollStatName(root, item),
              value: stat.value,
              maximumValue: maximum.value,
              unit,
              valueLabel,
              qualityPercent: averageRollQuality([stat, maximum]),
              rankLabel: null,
              rankDescription: `Individual sampled percentile ranks: minimum ${formatCombinationPercentile(stat.estimatedPercentile) ?? 'fixed'}; maximum ${formatCombinationPercentile(maximum.estimatedPercentile) ?? 'fixed'}.`,
              rangeLabel: `${formatRollValue(stat.observedMinimum ?? stat.value)}–${formatRollValue(maximum.observedMaximum ?? maximum.value)}${unit}`
            }
          ]
        }
      }
      return [
        {
          key: stat.field,
          label: rollStatName(stat.field, item),
          value: stat.value,
          maximumValue: null,
          unit: rollStatUnit(stat.field),
          valueLabel: `${formatRollValue(stat.value)}${rollStatUnit(stat.field)}`,
          qualityPercent: rollStatQuality(stat),
          rankLabel: formatCombinationPercentile(stat.estimatedPercentile),
          rankDescription: 'Range quality (0% minimum, 100% maximum); parentheses show sampled percentile rank, counting half of ties.',
          rangeLabel: `${formatRollValue(stat.observedMinimum ?? stat.value)}–${formatRollValue(stat.observedMaximum ?? stat.value)}${rollStatUnit(stat.field)}`
        }
      ]
    })
    .sort((left, right) => left.label.localeCompare(right.label))
}

export function rollStatName(field: string, item: CollectionItem | null = null): string {
  if (field.startsWith('conversionPercentage')) {
    const conversionIndex = field.endsWith('2') ? 1 : 0
    const conversions = (item?.presentation?.sections ?? [])
      .flatMap((section) => section.lines)
      .filter((line) => line.label.includes('Damage converted to'))
    return conversions[conversionIndex]?.label ?? 'Damage conversion'
  }
  return humanStatName(field)
}

export function rollStatUnit(field: string): string {
  if (
    field.startsWith('conversionPercentage') ||
    field.endsWith('Modifier') ||
    (field.startsWith('defensive') &&
      !['defensiveProtection', 'defensiveBlock', 'defensiveBonusProtection'].includes(field)) ||
    field === 'offensiveLifeLeechMin' ||
    field.includes('Chance') ||
    field.includes('Reduction')
  ) return '%'
  return ''
}

export function formatSignedRollDelta(value: number, unit: string): string {
  if (Math.abs(value) < 0.0000001) return `0${unit}`
  return `${value > 0 ? '+' : '−'}${formatRollValue(Math.abs(value))}${unit}`
}

export function statValuesMatch(left: PresentedRollStat, right: PresentedRollStat): boolean {
  return left.value === right.value && left.maximumValue === right.maximumValue
}

export function createComparisonProjection(pet: boolean, copies: readonly ObservedStashItem[], reference: ObservedStashItem | null, item: CollectionItem | null = null): (copy: ObservedStashItem) => ComparisonStatRow[] {
  const sourceFor = (candidate: ObservedStashItem) => presentRolledStats(
    pet ? candidate.rollAnalysis?.petStats : candidate.rollAnalysis?.stats,
    true,
    item
  )
  const projected = new Map(copies.map(copy => [copy, sourceFor(copy)]))
  const referenceStats = new Map((reference ? sourceFor(reference) : []).map((stat) => [stat.key, stat]))
  const universe = new Map<string, PresentedRollStat[]>()
  for (const candidate of copies) {
    for (const stat of projected.get(candidate)!) {
      const existing = universe.get(stat.key)
      if (existing) existing.push(stat)
      else universe.set(stat.key, [stat])
    }
  }
  const differences = [...universe.entries()]
    .filter(([, variants]) =>
      variants.some((stat) => stat.qualityPercent !== null) ||
      variants.length !== copies.length ||
      variants.some((stat) => !statValuesMatch(stat, variants[0]!))
    )
  const cached = new WeakMap<ObservedStashItem, ComparisonStatRow[]>()
  return (copy) => {
    const previous = cached.get(copy)
    if (previous) return previous
    const current = new Map((projected.get(copy) ?? sourceFor(copy)).map(stat => [stat.key, stat]))
    const rows = differences.map(([key, variants]) => {
      const own = current.get(key)
      const baseline = referenceStats.get(key)
      const template = own ?? baseline ?? variants[0]!
      const isReference = copy.instanceKey === reference?.instanceKey
      if (isReference) {
        return {
          ...template,
          valueLabel: own?.valueLabel ?? '—',
          qualityPercent: own?.qualityPercent ?? null,
          deltaLabel: 'Reference',
          deltaTone: 'reference' as const,
          qualityDeltaLabel: null,
          missingFromCopy: !own
        }
      }
      if (!own && baseline) {
        return {
          ...baseline,
          valueLabel: '—',
          qualityPercent: null,
          deltaLabel: `Missing ${baseline.valueLabel}`,
          deltaTone: 'missing' as const,
          qualityDeltaLabel: null,
          missingFromCopy: true
        }
      }
      if (own && !baseline) {
        return {
          ...own,
          deltaLabel: `Adds ${own.valueLabel}`,
          deltaTone: 'unique' as const,
          qualityDeltaLabel: null,
          missingFromCopy: false
        }
      }
      if (!own || !baseline) {
        return {
          ...template,
          valueLabel: own?.valueLabel ?? '—',
          qualityPercent: own?.qualityPercent ?? null,
          deltaLabel: '—',
          deltaTone: 'same' as const,
          qualityDeltaLabel: null,
          missingFromCopy: !own
        }
      }
      const lowerDelta = own.value - baseline.value
      const upperDelta = own.maximumValue !== null || baseline.maximumValue !== null
        ? (own.maximumValue ?? own.value) - (baseline.maximumValue ?? baseline.value)
        : null
      const deltaLabel = upperDelta !== null && upperDelta !== lowerDelta
        ? `${formatSignedRollDelta(lowerDelta, own.unit)} / ${formatSignedRollDelta(upperDelta, own.unit)}`
        : formatSignedRollDelta(lowerDelta, own.unit)
      const qualityDelta = own.qualityPercent !== null && baseline.qualityPercent !== null
        ? own.qualityPercent - baseline.qualityPercent
        : null
      return {
        ...own,
        deltaLabel: statValuesMatch(own, baseline) ? 'Same value' : deltaLabel,
        deltaTone: lowerDelta > 0 || (lowerDelta === 0 && (upperDelta ?? 0) > 0)
          ? 'positive' as const
          : lowerDelta < 0 || (lowerDelta === 0 && (upperDelta ?? 0) < 0)
            ? 'negative' as const
            : 'same' as const,
        qualityDeltaLabel: qualityDelta === null || Math.abs(qualityDelta) < 0.05
          ? null
          : `${qualityDelta > 0 ? '+' : '−'}${Math.abs(qualityDelta).toFixed(0)} quality points`,
        missingFromCopy: false
      }
    })
    .sort((left, right) => left.label.localeCompare(right.label))
    cached.set(copy, rows)
    return rows
  }
}

/** Convenience entry for callers comparing a single copy. Sessions reuse the projection. */
export function comparisonStats(copy: ObservedStashItem, pet: boolean, copies: readonly ObservedStashItem[], reference: ObservedStashItem | null, item: CollectionItem | null = null): ComparisonStatRow[] {
  return createComparisonProjection(pet, copies, reference, item)(copy)
}

export function copyAffixDelta(copy: ObservedStashItem, kind: 'prefix' | 'suffix', reference: ObservedStashItem | null): string {
  if (!reference || copy.instanceKey === reference.instanceKey) return 'Reference affix'
  const record = kind === 'prefix' ? copy.prefixRecord : copy.suffixRecord
  const baseline = kind === 'prefix' ? reference.prefixRecord : reference.suffixRecord
  if (record === baseline) return 'Same as reference'
  if (!record) return 'Missing vs reference'
  if (!baseline) return 'Added vs reference'
  return 'Different from reference'
}
