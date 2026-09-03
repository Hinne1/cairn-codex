import type { CollectionItem } from '@shared/contracts'

export type ResearchItemTone = 'default' | 'accent' | 'positive' | 'muted' | 'warning'

export function nextResearchSort<T extends string>(active: T, direction: 'asc' | 'desc', selected: T): {
  sort: T; direction: 'asc' | 'desc'
} {
  return { sort: selected, direction: active === selected && direction === 'asc' ? 'desc' : 'asc' }
}

// Planner ignore/favorite identities predate the visible Awakened qualifier.
export function researchItemPreferenceKey(item: Pick<CollectionItem, 'record' | 'name' | 'rarity' | 'slot'>): string {
  const name = item.record.replace(/\\/g, '/').toLocaleLowerCase().includes('/items/awakened/')
    ? item.name.replace(/^Awakened\s+/i, '') : item.name
  return `${item.rarity}:${item.slot}:${name.normalize('NFKD').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '')}`
}

export interface ResearchItemFact {
  label?: string
  text: string
  tone?: ResearchItemTone
}

export type ResearchItemModifierKind = 'conversion' | 'pet' | 'rank' | 'special' | 'visual'

export interface ResearchItemModifier extends ResearchItemFact {
  kind: ResearchItemModifierKind
  skill?: string
  targetDamageType?: string
}

export interface ResearchItemTableRow {
  item: CollectionItem
  itemType: string
  supports: readonly ResearchItemFact[]
  modifiers: readonly ResearchItemModifier[]
  acquisition: readonly ResearchItemFact[]
  archive: readonly ResearchItemFact[]
  favorite?: boolean
  ignored?: boolean
}

export type ResearchItemTableColumn =
  | 'item'
  | 'level'
  | 'slot'
  | 'supports'
  | 'modifiers'
  | 'acquisition'
  | 'archive'

const lowercaseSkillWords = new Set(['a', 'an', 'and', 'of', 'the', 'to'])

export function researchSkillName(skill: string): string {
  const words = skill.trim().split(/\s+/)
  return words.map((word, index) => {
    if (!word || word !== word.toLocaleLowerCase()) return word
    if (index > 0 && lowercaseSkillWords.has(word)) return word
    return word.charAt(0).toLocaleUpperCase() + word.slice(1)
  }).join(' ')
}

export function researchItemTypeLabel(item: CollectionItem): string {
  const itemClass = item.itemClass.toLocaleLowerCase()
  if (itemClass.includes('ranged2h')) return 'Two-handed ranged weapon'
  if (itemClass.includes('ranged1h')) return 'One-handed ranged weapon'
  if (itemClass.includes('spear2h')) return 'Two-handed spear'
  if (itemClass.includes('sword2h')) return 'Two-handed sword'
  if (itemClass.includes('axe2h')) return 'Two-handed axe'
  if (itemClass.includes('mace2h') || itemClass.includes('blunt2h')) return 'Two-handed mace'
  if (itemClass.includes('scepter')) return 'One-handed scepter (caster weapon)'
  if (itemClass.includes('dagger')) return 'One-handed dagger (caster weapon)'
  if (itemClass.includes('sword')) return 'One-handed sword'
  if (itemClass.includes('axe')) return 'One-handed axe'
  if (itemClass.includes('mace') || itemClass.includes('blunt')) return 'One-handed mace'
  if (itemClass.includes('melee') && itemClass.includes('2h')) return 'Two-handed melee weapon'
  if (itemClass.includes('shield')) return 'Shield'
  if (itemClass.includes('offhand') || itemClass.includes('focus')) return 'Caster off-hand'
  const labels: Record<string, string> = {
    head: 'Head armor', chest: 'Chest armor', shoulders: 'Shoulders', hands: 'Hands',
    legs: 'Leg armor', feet: 'Feet', waist: 'Waist', ring: 'Ring', amulet: 'Amulet',
    medal: 'Medal', relic: 'Relic', offhand: 'Offhand', weapon: 'Weapon',
    component: 'Component', material: 'Crafting material', 'potion-formula': 'Potion formula',
    augment: 'Augment', rune: 'Movement rune', writ: 'Faction writ', mandate: 'Faction mandate',
    warrant: 'Nemesis warrant', merit: 'Difficulty merit'
  }
  return labels[item.slot] ?? item.slot
}

export function researchRarityLabel(item: CollectionItem): string {
  if (item.rarity === 'mi') return 'Monster Infrequent'
  if (item.rarity === 'rare') return 'Rare'
  if (item.rarity === 'faction') return 'Faction Rare'
  if (item.rarity === 'component') return 'Component'
  if (item.rarity === 'consumable') return item.slot === 'potion-formula' ? 'Learned formula' : 'Consumable'
  return item.rarity.charAt(0).toLocaleUpperCase() + item.rarity.slice(1)
}

export function researchRollFact(item: CollectionItem): ResearchItemFact | null {
  if (item.bestRollPercentile === null) return null
  return {
    label: 'Best roll',
    text: `${item.bestRollPercentile.toFixed(1)} percentile`,
    tone: item.bestRollPercentile >= 90 ? 'accent' : 'default'
  }
}

export function researchAcquisitionFacts(item: CollectionItem): ResearchItemFact[] {
  const facts: ResearchItemFact[] = []
  for (const faction of item.acquisition?.factions ?? []) {
    facts.push({
      label: faction.kind === 'blueprint' ? 'Blueprint vendor' : faction.faction,
      text: faction.kind === 'blueprint' ? `${faction.faction} · ${faction.reputation}` : faction.reputation,
      tone: 'accent'
    })
  }
  if (!facts.length) {
    facts.push({ text: item.acquisition?.sources[0] ?? 'Random drop' })
  }
  const locations = item.acquisition?.locations ?? []
  if (locations.length) {
    facts.push({
      label: 'Area',
      text: locations.slice(0, 2).map((location) => location.name).join(', '),
      tone: 'muted'
    })
  }
  return facts
}
