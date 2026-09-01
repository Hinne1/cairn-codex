export interface SearchGuidance {
  searchHelp: string
  searchExamples: readonly [string, ...string[]]
}

export const searchGuidance = {
  collection: {
    searchHelp: 'Terms use AND by default. You can also use explicit AND/OR, parentheses, quoted phrases, and NOT or -term. Fields: name, set, skill, damage, slot, type, rarity, pack, level, and owned.',
    searchExamples: ['skill:wendigo AND "vitality damage"', 'rarity:legendary level:>=75', '(slot:amulet OR slot:medal) -damage:aether']
  },
  sets: {
    searchHelp: 'Search set and piece data with AND/OR, parentheses, quotes, and negation. Fields: set, name, skill, damage, slot, rarity, pack, level, owned, complete, craftable, awakening, and fx. owned: means discovered, while qualified sources remain separate.',
    searchExamples: ['set:ultos AND damage:lightning', 'craftable:true OR awakening:true', 'rarity:legendary complete:false fx:true']
  },
  materials: {
    searchHelp: 'Search effects and metadata with AND/OR, quotes, parentheses, and negation. Fields: name, skill, damage, slot, type, rarity, pack, level, and owned.',
    searchExamples: ['"fire resistance" AND slot:component', 'skill:wendigo', 'pack:gdx1 -damage:cold']
  },
  skillItems: {
    searchHelp: 'Combine terms with AND/OR, parentheses, quotes, and negation. Fields: name, skill, damage, stat, slot, rarity, level, conversion, and owned.',
    searchExamples: ['slot:amulet AND damage:cold', 'conversion:vitality OR stat:recharge', 'level:>=75 -rarity:rare']
  },
  oracle: {
    searchHelp: 'Search build evidence with Boolean logic and quoted phrases. Fields: name, class, mastery, skill, damage, style, set, item, readiness, and score.',
    searchExamples: ['class:conjurer AND damage:vitality', 'skill:wendigo OR skill:briarthorn', 'readiness:ready score:>=75']
  },
  planner: {
    searchHelp: 'Search shopping-list items with Boolean logic. Fields: name, type, slot, rarity, skill, damage, source, area, level, and owned. location: is an alias for area:.',
    searchExamples: ['skill:wendigo AND "vitality damage"', 'area:ugdenbog OR source:zaria', 'level:<=50 -owned:true']
  },
  atlas: {
    searchHelp: 'Search source regions with AND/OR, quotes, and negation. Fields: name, area, item, monster, source, pack, and level.',
    searchExamples: ['area:ugdenbog AND monster:wendigo', 'item:"zaria’s pendant"', 'pack:gdx1 level:>=75']
  },
  miWorkshop: {
    searchHelp: 'Search retained MI combinations with Boolean logic. Fields: name, slot, level, prefix, suffix, affix, skill, damage, stat, and copies.',
    searchExamples: ['name:"bloodsworn codex" AND damage:vitality', 'prefix:devouring OR suffix:"of the wild"', 'copies:>=2 -damage:aether']
  },
  supplies: {
    searchHelp: 'Search supply effects and access with Boolean logic. Fields: name, category, effect, faction, slot, source, mode, and eligible.',
    searchExamples: ['effect:"aether resistance" AND slot:armor', 'faction:homestead eligible:true', 'category:rune OR category:merit']
  },
  dismantling: {
    searchHelp: 'Search eligible copies with Boolean logic. Fields: name, base, prefix, suffix, affix, rarity, mode, and level. Adjacent filters still apply.',
    searchExamples: ['name:stoneplate AND rarity:rare', 'prefix:devouring OR suffix:"of decay"', 'mode:hardcore level:>=75']
  },
  farming: {
    searchHelp: 'Search missing drops and their sources with Boolean logic. Fields: name, skill, damage, monster, source, area, rarity, and level.',
    searchExamples: ['skill:wendigo AND area:ugdenbog', 'monster:cronley OR source:zaria', 'rarity:mi level:>=75']
  },
  vault: {
    searchHelp: 'Search stored copies with AND/OR, parentheses, quotes, and negation. Fields: name, base, prefix, suffix, affix, slot, rarity, level, seed, mode, and pack.',
    searchExamples: ['rarity:legendary AND level:>=94', 'affix:devouring -mode:hardcore', 'seed:3100000000 OR slot:amulet']
  },
  history: {
    searchHelp: 'Search durable operations with Boolean logic. Fields: item, name, base, seed, outcome, state, id, mode, source, and time. correlation: aliases id:; date: aliases time:.',
    searchExamples: ['source:"item assistant" AND mode:hardcore', 'outcome:failed OR state:needs_recovery', 'correlation:gdia-import seed:>=3100000000']
  }
} satisfies Record<string, SearchGuidance>
