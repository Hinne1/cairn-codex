import type { CollectionItem, ItemPresentationLine, ItemPresentationSection } from '@shared/contracts'

export type OracleStyle = 'all' | 'pets' | 'retaliation' | 'weapon' | 'caster'
export type OracleReadiness = 'ready' | 'near' | 'wildcard'

export interface OracleOptions {
  minimumLevel: number
  maximumLevel: number
  mastery: string
  style: OracleStyle
  skillMasteries?: Record<string, string>
}

export interface OracleEvidence {
  item: CollectionItem
  owned: boolean
  strength: number
  reasons: string[]
}

export interface OracleSetEvidence {
  name: string
  owned: number
  total: number
  capstonePieces: number
  capstoneUnlocked: boolean
}

export interface OracleCandidate {
  key: string
  title: string
  skill: string
  damageType: string
  style: Exclude<OracleStyle, 'all'>
  anchorSet: string | null
  score: number
  readiness: OracleReadiness
  ownedCore: number
  coreSize: number
  masteries: string[]
  relatedSkills: string[]
  evidence: OracleEvidence[]
  sets: OracleSetEvidence[]
  conflicts: string[]
  summary: string
}

interface SkillSignal {
  skill: string
  strength: number
  reasons: string[]
  modifierLines: ItemPresentationLine[]
}

const DAMAGE_TYPES = [
  'Internal Trauma', 'Vitality Decay', 'Frostburn', 'Electrocute', 'Bleeding',
  'Elemental', 'Physical', 'Pierce', 'Fire', 'Cold', 'Lightning', 'Acid', 'Poison',
  'Vitality', 'Aether', 'Chaos', 'Burn'
] as const

const DAMAGE_FAMILIES: Record<string, string> = {
  'internal trauma': 'Physical',
  burn: 'Fire',
  frostburn: 'Cold',
  electrocute: 'Lightning',
  poison: 'Acid',
  'vitality decay': 'Vitality'
}

export function oracleMasteries(items: CollectionItem[]): string[] {
  const result = new Set<string>()
  for (const item of items) {
    for (const mastery of itemMasteries(item)) result.add(mastery)
  }
  return [...result].sort((left, right) => left.localeCompare(right))
}

export function buildStashOracle(
  items: CollectionItem[],
  isOwned: (item: CollectionItem) => boolean,
  options: OracleOptions
): OracleCandidate[] {
  const tierItems = collapseMiTiers(items.filter((item) =>
    item.levelRequirement >= options.minimumLevel &&
    item.levelRequirement <= options.maximumLevel &&
    ['epic', 'legendary', 'mi'].includes(item.rarity)
  ))
  const setProgress = buildSetProgress(items, isOwned)
  const bySkill = new Map<string, { item: CollectionItem; signal: SkillSignal }[]>()

  for (const item of tierItems) {
    for (const signal of itemSkillSignals(item)) {
      const rows = bySkill.get(signal.skill) ?? []
      rows.push({ item, signal })
      bySkill.set(signal.skill, rows)
    }
  }

  const exactSkillMasteries = new Map(
    Object.entries(options.skillMasteries ?? {}).map(([skill, mastery]) => [skill.toLocaleLowerCase(), mastery])
  )
  const candidates: OracleCandidate[] = []
  for (const [skill, allRows] of bySkill) {
    if (allRows.length < 2 && !allRows.some((row) => isOwned(row.item))) continue
    const hasDirectModifier = allRows.some((row) => row.signal.modifierLines.length > 0)
    if (!hasDirectModifier && !isPetSkillName(skill)) continue
    const anchorSets = [...new Set(
      allRows
        .filter((row) => row.item.setName && (setProgress.get(row.item.setName.toLocaleLowerCase())?.owned ?? 0) > 0)
        .map((row) => row.item.setName!)
    )]
    const rowGroups = [
      ...anchorSets.map((anchorSet) => ({
        anchorSet,
        rows: allRows.filter((row) => row.item.setName === anchorSet || !row.item.setName)
      })),
      {
        anchorSet: null,
        rows: allRows.filter((row) => !row.item.setName)
      }
    ].filter((group) => group.rows.some((row) => isOwned(row.item)))

    for (const { anchorSet, rows } of rowGroups) {
      const damageScores = scoreDamageTypes(rows, isOwned, anchorSet)
      const selectedDamageVariants = selectDamageVariants(damageScores)
      const damageVariants = anchorSet && selectedDamageVariants.length > 1
        ? [selectedDamageVariants.join(' / ')]
        : selectedDamageVariants
      for (const damageType of damageVariants) {
        const evidence = rows
        .map(({ item, signal }) => {
          const owned = isOwned(item)
          const affinity = damageAffinity(item, signal, damageType, anchorSet)
          const set = anchorSet && item.setName === anchorSet
            ? setProgress.get(anchorSet.toLocaleLowerCase())
            : undefined
          const reasons = [...signal.reasons]
          if (damageType !== 'General' && affinity > 0) reasons.push(`${damageType} support`)
          if (set && set.owned > 0) reasons.push(`${set.owned}/${set.total} ${set.name}`)
          return {
            item,
            owned,
            strength: signal.strength + affinity + (set?.owned ?? 0) * 0.8,
            reasons: [...new Set(reasons)],
            damageTypes: signalDamageTypes(item, signal, anchorSet)
          }
        })
        .filter((row) =>
          (damageType === 'General'
            ? !anchorSet || row.item.setName === anchorSet || row.damageTypes.length === 0
            : false) ||
          row.damageTypes.length === 0 ||
          row.damageTypes.some((type) => candidateDamageTypes(damageType).includes(type))
        )
        .sort((left, right) =>
          Number(right.owned) - Number(left.owned) ||
          right.strength - left.strength ||
          right.item.levelRequirement - left.item.levelRequirement ||
          left.item.name.localeCompare(right.item.name)
        )
        if (evidence.length === 0) continue

        const style = inferStyle(skill, rows.map((row) => row.signal))
        const masteries = candidateMasteries(skill, evidence.map((row) => row.item), exactSkillMasteries, anchorSet)
        if (options.mastery !== 'all' && !masteries.some((value) => sameText(value, options.mastery))) continue
        if (options.style !== 'all' && style !== options.style) continue

        const core = evidence.slice(0, 7)
        const ownedCore = core.filter((row) => row.owned).length
        const ownedStrength = core.filter((row) => row.owned).reduce((sum, row) => sum + row.strength, 0)
        const totalStrength = Math.max(1, core.reduce((sum, row) => sum + row.strength, 0))
        const candidateSets = anchorSet
          ? [setProgress.get(anchorSet.toLocaleLowerCase())!].filter(Boolean)
          : []
        const conflicts = slotConflicts(core.filter((row) => row.owned).map((row) => row.item))
        const bestSetRatio = Math.max(0, ...candidateSets.map((set) => set.owned / Math.max(1, set.capstonePieces)))
        const completeSetBonus = candidateSets.some((set) => set.capstoneUnlocked) ? 9 : 0
        const ownershipScore = Math.min(48, (ownedStrength / totalStrength) * 48)
        const breadthScore = Math.min(18, ownedCore * 5)
        const setScore = bestSetRatio * 17 + completeSetBonus
        const coherenceScore = damageType === 'General' ? 4 : 11
        const conflictPenalty = Math.min(18, conflicts.length * 6)
        const score = Math.max(0, Math.min(100, Math.round(
          ownershipScore + breadthScore + setScore + coherenceScore - conflictPenalty - (hasDirectModifier ? 0 : 12)
        )))
        const capstoneReady = candidateSets.every((set) => set.capstoneUnlocked)
        const readiness: OracleReadiness = score >= 72 && ownedCore >= 3 && capstoneReady
          ? 'ready'
          : score >= 35 && ownedCore >= 2
            ? 'near'
            : 'wildcard'
        const relatedSkills = relatedSkillsForEvidence(skill, evidence.map((row) => row.item)).slice(0, 3)
        const summary = candidateSummary({ skill, damageType, style, ownedCore, coreSize: core.length, candidateSets, conflicts })

        candidates.push({
          key: `${skill}|${damageType}|${style}|${anchorSet ?? 'loose'}`.toLocaleLowerCase(),
          title: `${damageType === 'General' ? '' : `${damageType} `}${skill}`.trim(),
          skill,
          damageType,
          style,
          anchorSet,
          score,
          readiness,
          ownedCore,
          coreSize: core.length,
          masteries,
          relatedSkills,
          evidence: evidence.slice(0, 10),
          sets: candidateSets,
          conflicts,
          summary
        })
      }
    }
  }

  return candidates
    .sort((left, right) =>
      readinessRank(left.readiness) - readinessRank(right.readiness) ||
      right.score - left.score ||
      right.ownedCore - left.ownedCore ||
      left.title.localeCompare(right.title)
    )
    .filter((candidate, index, all) =>
      all.findIndex((other) => other.key === candidate.key) === index
    )
}

function collapseMiTiers(items: CollectionItem[]): CollectionItem[] {
  const result: CollectionItem[] = []
  const mi = new Map<string, CollectionItem>()
  for (const item of items) {
    if (item.rarity !== 'mi') {
      result.push(item)
      continue
    }
    const key = `${item.name}|${item.slot}`.toLocaleLowerCase()
    const current = mi.get(key)
    if (!current || item.levelRequirement > current.levelRequirement) mi.set(key, item)
  }
  result.push(...mi.values())
  return result
}

function buildSetProgress(items: CollectionItem[], isOwned: (item: CollectionItem) => boolean): Map<string, OracleSetEvidence> {
  const sets = new Map<string, { name: string; records: Set<string>; ownedRecords: Set<string>; capstonePieces: number }>()
  for (const item of items) {
    if (!item.setName) continue
    const key = item.setName.toLocaleLowerCase()
    const current = sets.get(key) ?? { name: item.setName, records: new Set(), ownedRecords: new Set(), capstonePieces: 0 }
    current.records.add(item.name.toLocaleLowerCase())
    if (isOwned(item)) current.ownedRecords.add(item.name.toLocaleLowerCase())
    current.capstonePieces = Math.max(
      current.capstonePieces,
      ...(item.setPresentation?.tiers.map((tier) => tier.requiredPieces) ?? [0])
    )
    sets.set(key, current)
  }
  return new Map([...sets].map(([key, value]) => [key, {
    name: value.name,
    owned: value.ownedRecords.size,
    total: value.records.size,
    capstonePieces: value.capstonePieces || value.records.size,
    capstoneUnlocked: value.ownedRecords.size >= (value.capstonePieces || value.records.size)
  }]))
}

function itemSkillSignals(item: CollectionItem): SkillSignal[] {
  const signals = new Map<string, SkillSignal>()
  const addSection = (section: ItemPresentationSection, source: 'item' | 'set') => {
    if (section.kind !== 'skill-modifier' || !section.heading) return
    const signal = ensureSignal(signals, section.heading)
    signal.strength += source === 'set' ? 5 : 6
    signal.reasons.push(source === 'set' ? 'set skill modifier' : 'direct skill modifier')
    signal.modifierLines.push(...section.lines)
  }
  const addRankLines = (lines: ItemPresentationLine[], source: 'item' | 'set') => {
    for (const line of lines) {
      const skill = skillFromRankLine(line)
      if (!skill) continue
      const signal = ensureSignal(signals, skill)
      const amount = Math.max(1, line.maximum ?? line.minimum ?? 1)
      signal.strength += Math.min(5, amount) + (source === 'set' ? 1 : 0)
      signal.reasons.push(`${source === 'set' ? 'set ' : ''}+${amount} ranks`)
    }
  }

  for (const section of item.presentation?.sections ?? []) {
    addSection(section, 'item')
    addRankLines(section.lines, 'item')
  }
  for (const tier of item.setPresentation?.tiers ?? []) {
    addRankLines(tier.lines, 'set')
    addRankLines(tier.petLines, 'set')
    for (const section of tier.skillModifiers) addSection(section, 'set')
  }
  return [...signals.values()].map((signal) => ({
    ...signal,
    reasons: [...new Set(signal.reasons)]
  }))
}

function ensureSignal(signals: Map<string, SkillSignal>, skill: string): SkillSignal {
  const normalized = skill.trim()
  const current = signals.get(normalized)
  if (current) return current
  const created = { skill: normalized, strength: 0, reasons: [], modifierLines: [] }
  signals.set(normalized, created)
  return created
}

function skillFromRankLine(line: ItemPresentationLine): string | null {
  if (line.tone !== 'skill' || !line.label.toLocaleLowerCase().startsWith('to ')) return null
  const skill = line.label.slice(3).trim()
  if (!skill || /^all skills in /i.test(skill)) return null
  return skill
}

function itemMasteries(item: CollectionItem): string[] {
  const result = new Set<string>()
  const lines = [
    ...(item.presentation?.sections.flatMap((section) => section.lines) ?? []),
    ...(item.setPresentation?.tiers.flatMap((tier) => [...tier.lines, ...tier.petLines]) ?? [])
  ]
  for (const line of lines) {
    const match = line.label.match(/all skills in\s+(.+)$/i)
    if (match?.[1]) result.add(match[1].trim())
  }
  return [...result]
}

function candidateMasteries(
  skill: string,
  items: CollectionItem[],
  skillMasteries: Map<string, string>,
  anchorSet: string | null
): string[] {
  const primary = skillMasteries.get(skill.toLocaleLowerCase())
  const secondaryScores = new Map<string, number>()
  for (const item of items) {
    for (const mastery of itemMasteries(item)) {
      secondaryScores.set(mastery, (secondaryScores.get(mastery) ?? 0) + (item.setName === anchorSet ? 12 : 2))
    }
    for (const signal of itemSkillSignals(item)) {
      if (sameText(signal.skill, skill)) continue
      const mastery = skillMasteries.get(signal.skill.toLocaleLowerCase())
      if (mastery) {
        secondaryScores.set(mastery, (secondaryScores.get(mastery) ?? 0) + signal.strength)
      }
    }
  }
  if (primary) secondaryScores.delete(primary)
  const secondary = [...secondaryScores.keys()].sort((left, right) =>
    (secondaryScores.get(right) ?? 0) - (secondaryScores.get(left) ?? 0) || left.localeCompare(right)
  )[0]
  return [primary, secondary].filter((value): value is string => Boolean(value))
}

function scoreDamageTypes(
  rows: { item: CollectionItem; signal: SkillSignal }[],
  isOwned: (item: CollectionItem) => boolean,
  anchorSet: string | null
): Map<string, number> {
  if (anchorSet) {
    const anchor = rows.find((row) => row.item.setName === anchorSet)?.item
    return anchor ? setDamageScores(anchor) : new Map()
  }
  const scores = new Map<string, number>()
  for (const { item, signal } of rows) {
    const ownership = isOwned(item) ? 1.8 : 1
    const relevantLines = signal.modifierLines.length
      ? signal.modifierLines
      : isPetSkillName(signal.skill)
        ? item.presentation?.sections.filter((section) => section.kind === 'pet').flatMap((section) => section.lines) ?? []
        : []
    for (const line of relevantLines) {
      const conversion = line.label.match(/converted to\s+(.+?)(?:\s+Damage)?$/i)?.[1]
      if (conversion) {
        const family = damageFamily(conversion)
        if (family) scores.set(family, (scores.get(family) ?? 0) + 7 * ownership)
      } else {
        for (const type of damageTypesIn(line.label)) {
          scores.set(type, (scores.get(type) ?? 0) + 2.2 * ownership)
        }
      }
    }
  }
  return scores
}

function selectDamageVariants(scores: Map<string, number>): string[] {
  const ordered = [...scores].sort((left, right) => right[1] - left[1])
  const best = ordered[0]
  if (!best || best[1] < 3) return ['General']
  const variants = ordered.filter(([, score]) => score >= best[1] * 0.58).slice(0, 2).map(([type]) => type)
  return variants.length ? variants : ['General']
}

function damageAffinity(item: CollectionItem, signal: SkillSignal, damageType: string, anchorSet: string | null): number {
  if (damageType === 'General') return 0
  const candidateTypes = candidateDamageTypes(damageType)
  if (anchorSet && item.setName === anchorSet) {
    return candidateTypes.some((type) => setDamageScores(item).has(type)) ? 5 : 0
  }
  const lines = signal.modifierLines.length
    ? signal.modifierLines
    : item.presentation?.sections.flatMap((section) => section.lines) ?? []
  let affinity = 0
  for (const line of lines) {
    const conversionTarget = line.label.match(/converted to\s+(.+?)(?:\s+Damage)?$/i)?.[1]
    if (conversionTarget) {
      if (candidateTypes.includes(damageFamily(conversionTarget) ?? '')) affinity += 4
    } else if (damageTypesIn(line.label).some((type) => candidateTypes.includes(type))) affinity += 1.2
  }
  return affinity
}

function signalDamageTypes(item: CollectionItem, signal: SkillSignal, anchorSet: string | null): string[] {
  if (anchorSet && item.setName === anchorSet) return [...setDamageScores(item).keys()]
  const lines = signal.modifierLines.length
    ? signal.modifierLines
    : isPetSkillName(signal.skill)
      ? item.presentation?.sections.filter((section) => section.kind === 'pet').flatMap((section) => section.lines) ?? []
      : []
  return [...new Set(lines.flatMap((line) => {
    const conversionTarget = line.label.match(/converted to\s+(.+?)(?:\s+Damage)?$/i)?.[1]
    const conversionFamily = conversionTarget ? damageFamily(conversionTarget) : null
    return conversionFamily ? [conversionFamily] : damageTypesIn(line.label)
  }))]
}

function setDamageScores(item: CollectionItem): Map<string, number> {
  const scores = new Map<string, number>()
  const tiers = item.setPresentation?.tiers ?? []
  const capstone = Math.max(0, ...tiers.map((tier) => tier.requiredPieces))
  for (const tier of tiers) {
    const weight = 1 + tier.requiredPieces * 0.75 + (tier.requiredPieces === capstone ? 4 : 0)
    const lines = [
      ...tier.lines,
      ...tier.petLines,
      ...tier.skillModifiers.flatMap((section) => section.lines)
    ]
    for (const line of lines) {
      const conversionTarget = line.label.match(/converted to\s+(.+?)(?:\s+Damage)?$/i)?.[1]
      if (conversionTarget) {
        const family = damageFamily(conversionTarget)
        if (family) scores.set(family, (scores.get(family) ?? 0) + weight * 5)
      } else if (/\bdamage\b|retaliation/i.test(line.label) && !/resistance/i.test(line.label)) {
        for (const type of damageTypesIn(line.label)) {
          scores.set(type, (scores.get(type) ?? 0) + weight)
        }
      }
    }
  }
  if (scores.has('Elemental')) {
    const elementalFamily = ['Fire', 'Cold', 'Lightning'].reduce(
      (sum, type) => sum + (scores.get(type) ?? 0),
      scores.get('Elemental') ?? 0
    )
    scores.set('Elemental', elementalFamily)
    scores.delete('Fire')
    scores.delete('Cold')
    scores.delete('Lightning')
  }
  return scores
}

function damageTypesIn(label: string): string[] {
  const lower = label.toLocaleLowerCase()
  const result = new Set<string>()
  for (const type of DAMAGE_TYPES) {
    if (lower.includes(type.toLocaleLowerCase())) result.add(damageFamily(type) ?? type)
  }
  return [...result]
}

function damageFamily(value: string): string | null {
  const normalized = value.trim().replace(/\s+damage$/i, '').toLocaleLowerCase()
  if (DAMAGE_FAMILIES[normalized]) return DAMAGE_FAMILIES[normalized]
  const direct = DAMAGE_TYPES.find((type) => type.toLocaleLowerCase() === normalized)
  return direct ?? null
}

function candidateDamageTypes(value: string): string[] {
  return value.split('/').map((type) => type.trim()).filter(Boolean)
}

function inferStyle(skill: string, signals: SkillSignal[]): Exclude<OracleStyle, 'all'> {
  const modifierText = signals.flatMap((signal) => signal.modifierLines.map((line) => line.label)).join(' ')
  if (isPetSkillName(skill)) return 'pets'
  if (/retaliation/i.test(modifierText)) return 'retaliation'
  if (/weapon damage/i.test(modifierText) || /ranged expertise|cadence|fire strike|savagery|righteous fervor/i.test(skill)) return 'weapon'
  return 'caster'
}

function isPetSkillName(skill: string): boolean {
  return /summon|raise skeletons|hellhound|familiar|briarthorn|blight fiend|reap spirit|primal spirit|skeletal servant|mend flesh|emboldening presence|manipulation|bonds of bysmiel|storm spirit|ground slam|infernal breath/i.test(skill)
}

function relatedSkillsForEvidence(primary: string, items: CollectionItem[]): string[] {
  const strengths = new Map<string, number>()
  for (const item of items) {
    for (const signal of itemSkillSignals(item)) {
      if (sameText(signal.skill, primary)) continue
      strengths.set(signal.skill, (strengths.get(signal.skill) ?? 0) + signal.strength)
    }
  }
  return [...strengths.keys()].sort((left, right) => (strengths.get(right) ?? 0) - (strengths.get(left) ?? 0))
}

function slotConflicts(items: CollectionItem[]): string[] {
  const bySlot = new Map<string, CollectionItem[]>()
  for (const item of items) {
    const slot = item.slot.toLocaleLowerCase()
    const rows = bySlot.get(slot) ?? []
    if (!rows.some((row) => row.name === item.name)) rows.push(item)
    bySlot.set(slot, rows)
  }
  const conflicts: string[] = []
  for (const [slot, rows] of bySlot) {
    const capacity = slot === 'ring' ? 2 : 1
    if (rows.length > capacity) conflicts.push(`${rows.length} ${slot} options compete for ${capacity === 1 ? 'one slot' : `${capacity} slots`}`)
  }
  const weapons = bySlot.get('weapon') ?? []
  const offhands = [...(bySlot.get('offhand') ?? []), ...(bySlot.get('shield') ?? [])]
  if (weapons.some((item) => /2h|twohand/i.test(item.itemClass)) && offhands.length) {
    conflicts.push('two-handed weapon support conflicts with an off-hand')
  }
  return conflicts
}

function candidateSummary(input: {
  skill: string
  damageType: string
  style: Exclude<OracleStyle, 'all'>
  ownedCore: number
  coreSize: number
  candidateSets: OracleSetEvidence[]
  conflicts: string[]
}): string {
  const set = input.candidateSets[0]
  const pieces = `${input.ownedCore} of ${input.coreSize} strongest signals are archived`
  const setText = set?.owned
    ? `; ${set.name} is ${set.owned}/${set.total}${set.capstoneUnlocked ? ' with its capstone active' : ` and its ${set.capstonePieces}-piece capstone is still locked`}`
    : ''
  const conflictText = input.conflicts.length ? `; ${input.conflicts.length} slot conflict${input.conflicts.length === 1 ? '' : 's'} need a choice` : ''
  const damage = input.damageType === 'General' ? '' : `${input.damageType} `
  return `${damage}${input.style} support for ${input.skill}: ${pieces}${setText}${conflictText}.`
}

function readinessRank(value: OracleReadiness): number {
  return value === 'ready' ? 0 : value === 'near' ? 1 : 2
}

function sameText(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase()
}
