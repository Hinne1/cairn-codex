import type { SearchQueryOptions } from './search-query.ts'

export type SearchFieldKind = 'text' | 'number' | 'boolean' | 'choice'

export interface SearchFieldDefinition {
  name: string
  label: string
  kind: SearchFieldKind
  values?: readonly string[]
}

export interface SearchWorkspaceSchema {
  key: string
  description: string
  fields: readonly SearchFieldDefinition[]
  aliases?: Readonly<Record<string, string>>
  examples: readonly [string, ...string[]]
}

const fieldCatalog = {
  affix: ['Affix', 'text'],
  area: ['Area', 'text'],
  awakening: ['Awakening available', 'boolean'],
  base: ['Base item', 'text'],
  category: ['Category', 'choice', ['rune', 'merit', 'writ', 'augment']],
  class: ['Class', 'text'],
  complete: ['Set complete', 'boolean'],
  conversion: ['Conversion', 'text'],
  copies: ['Copy count', 'number'],
  craftable: ['Craftable', 'boolean'],
  damage: ['Damage type', 'text'],
  effect: ['Effect', 'text'],
  eligible: ['Eligible', 'boolean'],
  faction: ['Faction', 'text'],
  fx: ['Visual effect', 'boolean'],
  id: ['Correlation ID', 'text'],
  item: ['Item', 'text'],
  level: ['Level', 'number'],
  mastery: ['Mastery', 'text'],
  mode: ['Mode', 'choice', ['softcore', 'hardcore']],
  monster: ['Monster', 'text'],
  name: ['Name', 'text'],
  outcome: ['Outcome', 'choice', ['committed', 'failed', 'pending', 'needs_recovery']],
  owned: ['Owned', 'boolean'],
  pack: ['Content pack', 'choice', ['base', 'gdx1', 'gdx2', 'gdx3']],
  prefix: ['Prefix', 'text'],
  rarity: ['Rarity', 'choice', ['legendary', 'epic', 'mi', 'rare', 'double-rare']],
  readiness: ['Readiness', 'choice', ['ready', 'near', 'wildcard']],
  score: ['Score', 'number'],
  seed: ['Seed', 'number'],
  set: ['Set', 'text'],
  skill: ['Skill', 'text'],
  slot: ['Slot', 'choice'],
  source: ['Source', 'text'],
  state: ['State', 'choice', ['committed', 'failed', 'needs_recovery', 'pending']],
  stat: ['Stat', 'text'],
  style: ['Build style', 'choice', ['pets', 'caster', 'weapon', 'retaliation']],
  suffix: ['Suffix', 'text'],
  time: ['Time', 'text'],
  type: ['Type', 'text']
} as const satisfies Record<string, readonly [string, SearchFieldKind, (readonly string[])?]>

type FieldName = keyof typeof fieldCatalog

function fields(...names: readonly FieldName[]): readonly SearchFieldDefinition[] {
  return names.map((name) => {
    const [label, kind, values] = fieldCatalog[name]
    return { name, label, kind, ...(values ? { values } : {}) }
  })
}

function withChoiceValues(
  definitions: readonly SearchFieldDefinition[],
  values: Readonly<Record<string, readonly string[]>>
): readonly SearchFieldDefinition[] {
  return definitions.map((definition) => values[definition.name]
    ? { ...definition, values: values[definition.name] }
    : definition)
}

const itemSlotValues = [
  'head', 'chest', 'shoulders', 'hands', 'legs', 'feet', 'waist',
  'ring', 'amulet', 'medal', 'weapon', 'offhand', 'shield', 'relic'
] as const
const materialSlotValues = ['component', 'material', 'potion-formula'] as const
const supplySlotValues = ['weapon', 'armor', 'jewelry'] as const

export const searchSchemas = {
  collection: {
    key: 'collection',
    description: 'Search collection item data with Boolean logic, phrases, comparisons, and exclusions.',
    fields: withChoiceValues(fields('name', 'set', 'skill', 'damage', 'slot', 'type', 'rarity', 'pack', 'level', 'owned'), { slot: itemSlotValues }),
    aliases: { class: 'type' },
    examples: ['skill:wendigo AND "vitality damage"', 'rarity:legendary level:>=75', '(slot:amulet OR slot:medal) -damage:aether']
  },
  sets: {
    key: 'sets',
    description: 'Search set and piece data. Owned means discovered; qualified sources remain separate.',
    fields: withChoiceValues(fields('name', 'set', 'skill', 'damage', 'slot', 'rarity', 'pack', 'level', 'owned', 'complete', 'craftable', 'awakening', 'fx'), { slot: itemSlotValues }),
    examples: ['set:ultos AND damage:lightning', 'craftable:true OR awakening:true', 'rarity:legendary complete:false fx:true']
  },
  materials: {
    key: 'materials',
    description: 'Search component and consumable effects and metadata.',
    fields: withChoiceValues(fields('name', 'skill', 'damage', 'slot', 'type', 'rarity', 'pack', 'level', 'owned'), { slot: materialSlotValues }),
    examples: ['"fire resistance" AND slot:component', 'skill:wendigo', 'pack:gdx1 -damage:cold']
  },
  skillItems: {
    key: 'skill-items',
    description: 'Search matching items, modifiers, and conversions.',
    fields: withChoiceValues(fields('name', 'skill', 'damage', 'stat', 'slot', 'rarity', 'level', 'conversion', 'owned'), { slot: itemSlotValues }),
    examples: ['slot:amulet AND damage:cold', 'conversion:vitality OR stat:recharge', 'level:>=75 -rarity:rare']
  },
  oracle: {
    key: 'oracle',
    description: 'Search build archetypes and the evidence behind them.',
    fields: fields('name', 'class', 'mastery', 'skill', 'damage', 'style', 'set', 'item', 'readiness', 'score'),
    examples: ['class:conjurer AND damage:vitality', 'skill:wendigo OR skill:briarthorn', 'readiness:ready score:>=75']
  },
  planner: {
    key: 'planner',
    description: 'Search shopping-list items and acquisition sources.',
    fields: withChoiceValues(fields('name', 'type', 'slot', 'rarity', 'skill', 'damage', 'source', 'area', 'level', 'owned'), { slot: itemSlotValues }),
    aliases: { location: 'area' },
    examples: ['skill:wendigo AND "vitality damage"', 'area:ugdenbog OR source:zaria', 'level:<=50 -owned:true']
  },
  atlas: {
    key: 'atlas',
    description: 'Search source regions, monsters, and their drops.',
    fields: fields('name', 'area', 'item', 'monster', 'source', 'pack', 'level'),
    examples: ['area:ugdenbog AND monster:wendigo', 'item:"zaria’s pendant"', 'pack:gdx1 level:>=75']
  },
  miWorkshop: {
    key: 'mi-workshop',
    description: 'Search retained Monster Infrequent combinations and affixes.',
    fields: withChoiceValues(fields('name', 'slot', 'level', 'prefix', 'suffix', 'affix', 'skill', 'damage', 'stat', 'copies'), { slot: itemSlotValues }),
    examples: ['name:"bloodsworn codex" AND damage:vitality', 'prefix:devouring OR suffix:"of the wild"', 'copies:>=2 -damage:aether']
  },
  supplies: {
    key: 'supplies',
    description: 'Search reusable supply effects and access requirements.',
    fields: withChoiceValues(fields('name', 'category', 'effect', 'faction', 'slot', 'source', 'mode', 'eligible'), { slot: supplySlotValues }),
    examples: ['effect:"aether resistance" AND slot:armor', 'faction:homestead eligible:true', 'category:rune OR category:merit']
  },
  dismantling: {
    key: 'dismantling',
    description: 'Search eligible copies. Adjacent safety filters still apply.',
    fields: fields('name', 'base', 'prefix', 'suffix', 'affix', 'rarity', 'mode', 'level'),
    examples: ['name:stoneplate AND rarity:rare', 'prefix:devouring OR suffix:"of decay"', 'mode:hardcore level:>=75']
  },
  farming: {
    key: 'farming',
    description: 'Search missing drops and the monsters and areas that provide them.',
    fields: fields('name', 'skill', 'damage', 'monster', 'source', 'area', 'rarity', 'level'),
    examples: ['skill:wendigo AND area:ugdenbog', 'monster:cronley OR source:zaria', 'rarity:mi level:>=75']
  },
  vault: {
    key: 'vault',
    description: 'Search stored item copies and their exact metadata.',
    fields: withChoiceValues(fields('name', 'base', 'prefix', 'suffix', 'affix', 'slot', 'rarity', 'level', 'seed', 'mode', 'pack'), { slot: itemSlotValues }),
    examples: ['rarity:legendary AND level:>=94', 'affix:devouring -mode:hardcore', 'seed:3100000000 OR slot:amulet']
  },
  history: {
    key: 'history',
    description: 'Search durable transfer and ingestion operations.',
    fields: fields('item', 'name', 'base', 'seed', 'outcome', 'state', 'id', 'mode', 'source', 'time'),
    aliases: { correlation: 'id', date: 'time' },
    examples: ['source:"item assistant" AND mode:hardcore', 'outcome:failed OR state:needs_recovery', 'correlation:gdia-import seed:>=3100000000']
  }
} as const satisfies Record<string, SearchWorkspaceSchema>

export function searchQueryOptions(schema: SearchWorkspaceSchema): SearchQueryOptions {
  return {
    fields: schema.fields.map((field) => field.name),
    numericFields: schema.fields.filter((field) => field.kind === 'number').map((field) => field.name),
    ...(schema.aliases ? { aliases: schema.aliases } : {})
  }
}

export function searchHelp(schema: SearchWorkspaceSchema): string {
  const names = schema.fields.map((field) => field.name).join(', ')
  const aliases = Object.entries(schema.aliases ?? {})
    .map(([alias, target]) => `${alias} → ${target}`)
    .join(', ')
  return `${schema.description} Fields: ${names}.${aliases ? ` Aliases: ${aliases}.` : ''}`
}
