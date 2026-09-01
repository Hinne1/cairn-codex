export interface SearchGuidance {
  searchHelp: string
  searchExamples: readonly [string, ...string[]]
}

export const searchGuidance = {
  collection: {
    searchHelp: 'Match item names, sets, stats, skills, slots, rarities, content packs, and sources. Separate terms narrow the results. Fields include name, set, skill, slot, type, rarity, pack, and level.',
    searchExamples: ['skill:wendigo', 'rarity:legendary level:>=75', '"aether damage" slot:amulet']
  },
  sets: {
    searchHelp: 'Match set names, piece names, set bonuses, skills, stats, slots, and levels. Separate terms narrow the results, and the collection field prefixes are supported.',
    searchExamples: ['set:ultos', '"aether damage"', 'skill:wendigo']
  },
  materials: {
    searchHelp: 'Match component and consumable names, effects, skills, item types, content packs, and levels. Separate terms narrow the results.',
    searchExamples: ['"fire resistance"', 'skill:wendigo', 'pack:gdx1']
  },
  skillItems: {
    searchHelp: 'Match the selected skill’s items by name, rarity, slot, level, modifier text, conversion, damage type, or other displayed stats.',
    searchExamples: ['amulet', 'cold damage', 'converted']
  },
  oracle: {
    searchHelp: 'Match build archetypes by class, mastery, skill, damage type, play style, supporting set, or evidence item.',
    searchExamples: ['Warder', 'vitality', 'Wendigo']
  },
  planner: {
    searchHelp: 'Match shopping-list items by name, type, slot, rarity, stats, skills, acquisition source, or area.',
    searchExamples: ['amulet', 'vitality damage', 'Ugdenbog']
  },
  atlas: {
    searchHelp: 'Match source regions by area name, Monster Infrequent item, monster, or other indexed source text.',
    searchExamples: ['Ugdenbog', 'Zaria', 'Cronley']
  },
  miWorkshop: {
    searchHelp: 'Match archived Monster Infrequents by base item, slot, level, prefix, suffix, stat, skill, or damage type.',
    searchExamples: ["Zaria's Pendant", 'of the Abyss', 'vitality damage']
  },
  supplies: {
    searchHelp: 'Match supplies by name, category, effect, faction requirement, slot family, or other indexed item text.',
    searchExamples: ["Devil's Crossing", 'reputation gain', 'movement']
  },
  dismantling: {
    searchHelp: 'Match eligible archived copies by item or base name, or by a prefix, suffix, or base record path. Use the adjacent filters for game mode and rarity.',
    searchExamples: ['Stoneplate', 'records/items/gearfeet', 'records/items/gearweapons']
  },
  farming: {
    searchHelp: 'Match missing items by name, stat, skill, monster, source, or area. Cairn ranks the remaining source areas by useful missing drops.',
    searchExamples: ['Ugdenbog', 'Cronley', 'skill:wendigo']
  },
  vault: {
    searchHelp: 'Match stored copies by item or base name, slot, rarity, level, seed, or base, prefix, and suffix record paths.',
    searchExamples: ['legendary', 'amulet', 'records/items/']
  }
} satisfies Record<string, SearchGuidance>
