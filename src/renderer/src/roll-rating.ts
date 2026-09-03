import type { ItemRollAnalysis, RollCategoryScore, RolledStat } from '@shared/contracts'

const damageTypeLabels: Record<string, string> = {
  physical: 'Physical',
  pierce: 'Pierce',
  bleeding: 'Bleeding',
  fire: 'Fire',
  cold: 'Cold',
  lightning: 'Lightning',
  acid: 'Acid',
  vitality: 'Vitality',
  aether: 'Aether',
  chaos: 'Chaos',
  elemental: 'Elemental'
}

export function rollCategoryLabel(score: RollCategoryScore): string {
  if (score.category === 'offense') {
    return score.damageType ? damageTypeLabels[score.damageType] ?? score.damageType : 'Offense'
  }
  if (score.category === 'defense') return 'Defense'
  if (score.category === 'retaliation') return 'Retaliation'
  if (score.category === 'pet') return 'Pet'
  return 'Utility'
}

export function rollCategoryScores(
  analysis: ItemRollAnalysis | null | undefined
): readonly RollCategoryScore[] {
  // Old category percentiles cannot be relabeled as range quality. Wait for v9 hydration.
  return analysis?.trusted ? (analysis.categoryScores ?? []).filter((score) =>
    typeof score.qualityPercent === 'number' && Number.isFinite(score.qualityPercent)
  ) : []
}

export function rollStatQuality(stat: RolledStat): number | null {
  if (!stat.rollable || stat.estimatedPercentile == null) return null
  const minimum = stat.observedMinimum
  const maximum = stat.observedMaximum
  if (minimum === null || maximum === null || !Number.isFinite(stat.value) ||
      !Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum - minimum < 0.0000001) return null
  // Also supports old per-stat caches: the value and sampled bounds are sufficient.
  return Math.max(0, Math.min(100, 100 * (stat.value - minimum) / (maximum - minimum)))
}

export function averageRollQuality(stats: readonly RolledStat[]): number | null {
  const qualities = stats.map(rollStatQuality).filter((quality): quality is number => quality !== null)
  return qualities.length ? qualities.reduce((sum, quality) => sum + quality, 0) / qualities.length : null
}

export function formatCategoryPercentile(value: number): string {
  return `${Math.round(value)}%`
}

export function formatCombinationPercentile(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const rounded = Math.round(value)
  const remainder100 = rounded % 100
  const remainder10 = rounded % 10
  let suffix = 'th'
  if (remainder100 < 11 || remainder100 > 13) {
    if (remainder10 === 1) suffix = 'st'
    else if (remainder10 === 2) suffix = 'nd'
    else if (remainder10 === 3) suffix = 'rd'
  }
  return `${rounded}${suffix}`
}

export function formatCategoryScore(score: RollCategoryScore): string {
  if (score.qualityPercent === undefined) return '—'
  const combination = formatCombinationPercentile(score.combinationPercentile)
  return `${formatCategoryPercentile(score.qualityPercent)}${combination ? ` (${combination})` : ''}`
}

export function categoryScoreDescription(score: RollCategoryScore): string {
  const label = rollCategoryLabel(score)
  if (score.qualityPercent === undefined) return `${label}: range-based roll quality is pending recalculation.`
  const groups = `${score.statCount} ${score.statCount === 1 ? 'variable stat group' : 'variable stat groups'}`
  const combination = formatCombinationPercentile(score.combinationPercentile)
  const quality = `${label}: ${formatCategoryPercentile(score.qualityPercent)} average range-based roll quality across ${groups}. Each stat runs from 0% at its sampled minimum to 100% at its sampled maximum.`
  if (!combination) return quality
  return `${quality} ${combination} percentile for this average quality among sampled rolls for this exact item template. Percentile ranks count rolls below this score plus half of tied rolls; they are not the chance of rolling this score or higher.`
}

export function categoryMetricKey(score: RollCategoryScore): `category:${string}` {
  return `category:${score.key}`
}

export function categoryScoreForMetric(
  analysis: ItemRollAnalysis | null | undefined,
  metric: string
): RollCategoryScore | undefined {
  if (!metric.startsWith('category:')) return undefined
  const key = metric.slice('category:'.length)
  return rollCategoryScores(analysis).find((score) => score.key === key)
}
