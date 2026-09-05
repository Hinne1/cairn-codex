import type { CollectionItem, CollectionSnapshot, ObservedStashItem } from '../shared/contracts.ts'
import { CATALOG_PRESENTATION_VERSION } from '../main/catalog-versions.ts'

export function createScreenshotCollectionFixture(name: string): CollectionSnapshot {
  if (name === 'onboarding') return createScreenshotCollectionFixture('search-help')
  if (name === 'settings') {
    const fixture = createScreenshotCollectionFixture('search-help')
    const stashes = [false, true].map((isHardcore) => ({
      path: `C:\\Synthetic QA\\settings\\${isHardcore ? 'transfer.gsh' : 'transfer.gst'}`,
      isHardcore,
      modLabel: 'Main campaign',
      itemCount: 0,
      lastWriteUtc: '2026-09-02T00:00:00.000Z',
      sha256: (isHardcore ? '1' : '0').repeat(64)
    }))
    return { ...fixture, basis: 'archive', scannedStashes: stashes, availableStashes: stashes }
  }
  if (name === 'bounded-grid-a11y') {
    const fixture = createScreenshotCollectionFixture('skill-explorer')
    const supplySlotFamilies = ['weapon', 'armor', 'jewelry'] as const
    const items = fixture.items.map((item, index): CollectionItem => {
      if (index < 60) return item
      const presentation = item.presentation!
      return {
        ...item,
        presentation: {
          ...presentation,
          sections: presentation.sections.map((section) => ({
            ...section,
            heading: section.heading === 'Wendigo Totem' ? 'Savagery' : section.heading,
            lines: section.lines.map((line) => ({
              ...line,
              label: line.label.replace('Wendigo Totem', 'Savagery')
            }))
          })),
          searchText: presentation.searchText.replaceAll('wendigo totem', 'savagery')
        }
      }
    })
    const supplies = items.slice(0, 6).map((item, index): CollectionItem => ({
      ...item,
      record: `records/items/synthetic/a11y_augment_${index}.dbr`,
      name: `Accessible Grid Augment ${index + 1}`,
      rarity: 'faction',
      itemClass: 'augment',
      slot: 'augment',
      supplySlotFamilies: [supplySlotFamilies[index % supplySlotFamilies.length]!],
      availableCount: 0,
      discovered: true,
      acquisition: {
        sources: ['Synthetic QA faction vendor'],
        sourceRecords: [],
        locations: [],
        factions: [{
          kind: 'item',
          faction: 'Synthetic QA',
          reputation: 'Revered',
          vendorRecord: `records/creatures/npcs/merchants/synthetic_a11y_${index}.dbr`
        }],
        crafting: null
      }
    }))
    return {
      ...fixture,
      items,
      supplies,
      supplySummary: { rarity: 'supply', total: supplies.length, collected: 0, availableCopies: 0 },
      skillMasteries: { ...fixture.skillMasteries, Savagery: 'Shaman' }
    }
  }
  if (name === 'farming-routes') {
    const fixture = createScreenshotCollectionFixture('search-help')
    const template = fixture.items[0]!
    const rarities = ['mi', 'epic', 'legendary'] as const
    const contentPacks = ['base', 'gdx1', 'gdx2', 'gdx3'] as const
    const items = Array.from({ length: 214 }, (_, routeIndex) =>
      Array.from({ length: routeIndex === 0 ? 13 : 1 }, (_, itemIndex): CollectionItem => {
        const routeNumber = String(routeIndex + 1).padStart(3, '0')
        const rarity = rarities[routeIndex % rarities.length]!
        const contentPack = contentPacks[routeIndex % contentPacks.length]!
        return {
          ...template,
          record: `records/items/synthetic/farming_route_${routeNumber}_item_${itemIndex}.dbr`,
          name: `Route ${routeNumber} Missing Base ${String(itemIndex + 1).padStart(2, '0')}`,
          rarity,
          levelRequirement: 1 + routeIndex % 94,
          itemLevel: 1 + routeIndex % 94,
          availableCount: 0,
          discovered: false,
          acquisition: {
            sources: [`Dropped by Route ${routeNumber} Guardian`],
            sourceRecords: [],
            factions: [],
            crafting: null,
            locations: [{
              name: `Synthetic Route ${routeNumber}`,
              routeName: `Rift ${1 + routeIndex % 7}`,
              zoneRecord: `records/levels/synthetic/farming_route_${routeNumber}.dbr`,
              levelFile: `levels/synthetic/farming_route_${routeNumber}.lvl`,
              contentPack,
              originX: routeIndex * 10,
              originY: routeIndex * 5
            }]
          },
          presentation: {
            ...template.presentation!,
            searchText: `synthetic farming route ${routeNumber} ${rarity}`
          }
        }
      })
    ).flat()
    return {
      ...fixture,
      items,
      observedItems: [],
      rarities: rarities.map((rarity) => ({
        rarity,
        total: items.filter((item) => item.rarity === rarity).length,
        collected: 0,
        availableCopies: 0
      }))
    }
  }
  if (name === 'planner') {
    const fixture = createScreenshotCollectionFixture('search-help')
    const template = fixture.items[0]!
    const rarities = ['legendary', 'epic', 'mi', 'faction'] as const
    const slots = ['head', 'chest', 'shoulders', 'medal', 'sword', 'offhand'] as const
    const items = Array.from({ length: 120 }, (_, index): CollectionItem => {
      const rarity = rarities[index % rarities.length]!
      const slot = slots[index % slots.length]!
      const conversionTarget = ['Vitality', 'Cold', 'Lightning', 'Acid'][index % 4]!
      return {
        ...template,
        record: `records/items/synthetic/planner_support_${index}.dbr`,
        name: `Wendigo Field Kit ${String(index + 1).padStart(3, '0')}`,
        rarity,
        itemClass: slot === 'sword' ? 'weapon_sword' : `armor_${slot}`,
        slot,
        levelRequirement: 1 + index % 70,
        itemLevel: 1 + index % 70,
        availableCount: index % 5 === 0 ? 1 : 0,
        discovered: index % 5 === 0,
        acquisition: Math.floor(index / 4) % 2 === 1 && template.acquisition
          ? {
              ...template.acquisition,
              locations: [{
                ...template.acquisition.locations![0]!,
                name: 'Review Hollow',
                routeName: 'Typed Route Review',
                zoneRecord: 'records/levels/synthetic/review_hollow.dbr',
                levelFile: 'levels/synthetic/review_hollow.map',
                originX: 240,
                originY: 180
              }]
            }
          : template.acquisition,
        presentation: {
          flavorText: null,
          sections: [{
            kind: 'base',
            heading: null,
            lines: [{
              label: 'to Wendigo Totem',
              minimum: 1 + index % 3,
              maximum: 1 + index % 3,
              unit: '',
              tone: 'skill',
              prefix: '+',
              suffix: ''
            }]
          }, {
            kind: 'skill-modifier',
            heading: 'Wendigo Totem',
            lines: [{
              label: `Bleeding Damage converted to ${conversionTarget} Damage`,
              minimum: 20 + index % 31,
              maximum: 20 + index % 31,
              unit: '%',
              tone: 'standard',
              prefix: '',
              suffix: ''
            }, {
              label: 'Skill Recharge',
              minimum: -(index % 4 + 1) * 0.25,
              maximum: -(index % 4 + 1) * 0.25,
              unit: 's',
              tone: 'standard',
              prefix: '',
              suffix: ''
            }]
          }, ...(index % 4 === 0 ? ['Wendigo Totem', 'Storm Totem'].map((skill, fxIndex) => ({
            kind: 'visual-modifier' as const,
            heading: `${skill} · Visual transformation`,
            lines: [{
              label: fxIndex === 0 ? 'Alternate crimson spirit effect' : 'Alternate azure storm effect',
              minimum: null, maximum: null, unit: '' as const,
              tone: 'visual' as const, prefix: '', suffix: ''
            }]
          })) : []), {
            kind: 'skill-modifier', heading: 'Fixture Talons', parentSkills: ['Wendigo Totem'],
            lines: [{ label: 'Weapon Damage', minimum: 30, maximum: null, unit: '%', tone: 'standard', prefix: '', suffix: '' }]
          }],
          grantedSkill: null,
          searchText: `wendigo totem ${conversionTarget.toLocaleLowerCase()} damage leveling planner synthetic qa`
        }
      }
    })
    return {
      ...fixture,
      items,
      rarities: rarities.map((rarity) => ({
        rarity,
        total: items.filter((item) => item.rarity === rarity).length,
        collected: items.filter((item) => item.rarity === rarity && item.discovered).length,
        availableCopies: items.filter((item) => item.rarity === rarity).reduce((total, item) => total + item.availableCount, 0)
      })),
      skillMasteries: {
        'Curse of Frailty': 'Occultist',
        'Summon Hellhound': 'Occultist',
        'Summon Briarthorn': 'Shaman',
        'Wendigo Totem': 'Shaman',
        'Raise Skeletons': 'Necromancer',
        'Field Command': 'Soldier'
      },
      skillClassNames: {
        'Occultist|Shaman': 'Conjurer',
        'Necromancer|Soldier': 'Death Knight'
      }
    }
  }
  if (name === 'sets-bounded') {
    const items = Array.from({ length: 202 }, (_, index) => {
      const ordinal = String(index + 1).padStart(3, '0')
      const setName = `Bounded Set ${ordinal}`
      const setRecord = `records/items/synthetic/bounded_set_${ordinal}.dbr`
      const rarity = index % 2 === 0 ? 'legendary' as const : 'epic' as const
      const level = rarity === 'legendary' ? 94 : 50
      const state = index % 4
      const visual = index % 7 === 0
      const setPresentation = {
        name: setName,
        description: 'Synthetic detailed set used only for bounded renderer verification.',
        members: [`${setName} Crown`, `${setName} Guard`],
        tiers: [{
          requiredPieces: 2,
          lines: [{
            label: 'All Damage', minimum: 80 + index % 21, maximum: 80 + index % 21,
            unit: '%' as const, tone: 'standard' as const, prefix: '+', suffix: ''
          }],
          petLines: [],
          skillModifiers: visual ? [{
            kind: 'visual-modifier' as const,
            heading: 'Synthetic Skill · Visual transformation',
            lines: [{
              label: 'Alternate bounded verification effect', minimum: null, maximum: null,
              unit: '' as const, tone: 'visual' as const, prefix: '', suffix: ''
            }]
          }] : [],
          grantedSkill: null
        }]
      }
      return [
        createScreenshotSetItem({
          record: `records/items/synthetic/bounded_${ordinal}_crown.dbr`,
          name: `${setName} Crown`, rarity, slot: 'head', level, setName, setRecord,
          availableCount: state === 0 || state === 1 ? 1 : 0,
          discovered: state === 0 || state === 1,
          bestRollPercentile: state === 0 || state === 1 ? 70 + index % 25 : undefined,
          recipeUnlocked: state === 2,
          setPresentation,
          visual
        }),
        createScreenshotSetItem({
          record: `records/items/synthetic/bounded_${ordinal}_guard.dbr`,
          name: `${setName} Guard`, rarity, slot: 'chest', level, setName, setRecord,
          availableCount: state === 0 ? 1 : 0,
          discovered: state === 0,
          bestRollPercentile: state === 0 ? 65 + index % 30 : undefined,
          availableViaAwakening: state === 2,
          awakeningSourceAvailableCount: state === 2 ? 1 : 0,
          awakeningSourceName: state === 2 ? `${setName} Mark` : undefined,
          setPresentation
        })
      ]
    }).flat()
    return {
      ...createScreenshotCollectionFixture('search-help'),
      items,
      rarities: (['epic', 'legendary'] as const).map((rarity) => ({
        rarity,
        total: items.filter((item) => item.rarity === rarity).length,
        collected: items.filter((item) => item.rarity === rarity && item.discovered).length,
        availableCopies: items
          .filter((item) => item.rarity === rarity)
          .reduce((total, item) => total + item.availableCount, 0)
      }))
    }
  }
  if (name === 'sets-semantics') {
    const setPresentation = {
      name: 'Veil of the Cairn',
      description: 'Synthetic set used only for isolated UI verification.',
      members: ['Cairn Hood', 'Cairn Mantle', 'Cairn Sigil'],
      tiers: [{
        requiredPieces: 2,
        lines: [{
          label: 'Vitality Damage', minimum: 80, maximum: 80, unit: '%' as const,
          tone: 'standard' as const, prefix: '+', suffix: ''
        }],
        petLines: [],
        skillModifiers: [{
          kind: 'visual-modifier' as const,
          heading: 'Wendigo Totem · Visual transformation',
          lines: [{
            label: 'Alternate crimson spirit effect', minimum: null, maximum: null, unit: '' as const,
            tone: 'visual' as const, prefix: '', suffix: ''
          }]
        }],
        grantedSkill: null
      }]
    }
    const items = [
      createScreenshotSetItem({
        record: 'records/items/synthetic/cairn_hood.dbr', name: 'Cairn Hood', rarity: 'legendary',
        slot: 'head', level: 94, setName: 'Veil of the Cairn', setRecord: 'records/items/synthetic/cairn_set.dbr',
        availableCount: 2, discovered: true, bestRollPercentile: 72.5, setPresentation, visual: true
      }),
      createScreenshotSetItem({
        record: 'records/items/synthetic/cairn_mantle.dbr', name: 'Cairn Mantle', rarity: 'legendary',
        slot: 'shoulders', level: 94, setName: 'Veil of the Cairn', setRecord: 'records/items/synthetic/cairn_set.dbr',
        recipeUnlocked: true, setPresentation
      }),
      createScreenshotSetItem({
        record: 'records/items/synthetic/cairn_sigil.dbr', name: 'Cairn Sigil', rarity: 'legendary',
        slot: 'medal', level: 94, setName: 'Veil of the Cairn', setRecord: 'records/items/synthetic/cairn_set.dbr',
        availableViaAwakening: true, awakeningSourceAvailableCount: 1,
        awakeningSourceName: 'Cairn Mark', setPresentation
      }),
      createScreenshotSetItem({
        record: 'records/items/synthetic/warden_guard.dbr', name: "Warden's Guard", rarity: 'epic',
        slot: 'chest', level: 50, setName: "Warden's Vigil", setRecord: 'records/items/synthetic/warden_set.dbr',
        availableCount: 1, discovered: true, bestRollPercentile: 91
      }),
      createScreenshotSetItem({
        record: 'records/items/synthetic/warden_step.dbr', name: "Warden's Step", rarity: 'epic',
        slot: 'feet', level: 50, setName: "Warden's Vigil", setRecord: 'records/items/synthetic/warden_set.dbr',
        availableCount: 1, discovered: true, bestRollPercentile: 79
      }),
      createScreenshotSetItem({
        record: 'records/items/synthetic/forgotten_crown.dbr', name: 'Forgotten Crown', rarity: 'legendary',
        slot: 'head', level: 75, setName: 'Forgotten Oath', setRecord: 'records/items/synthetic/forgotten_set.dbr',
        discovered: true
      }),
      createScreenshotSetItem({
        record: 'records/items/synthetic/forgotten_blade.dbr', name: 'Forgotten Blade', rarity: 'legendary',
        slot: 'sword', level: 75, setName: 'Forgotten Oath', setRecord: 'records/items/synthetic/forgotten_set.dbr'
      })
    ]
    return {
      ...createScreenshotCollectionFixture('search-help'),
      items,
      rarities: [
        { rarity: 'epic', total: 2, collected: 2, availableCopies: 2 },
        { rarity: 'legendary', total: 5, collected: 2, availableCopies: 2 }
      ]
    }
  }
  if (name === 'mi-workshop') {
    const fixture = createScreenshotCollectionFixture('search-help')
    const syntheticStash = {
      path: 'C:\\Synthetic QA\\route-fixtures\\transfer.gst',
      isHardcore: false,
      modLabel: 'Main campaign',
      itemCount: 72,
      lastWriteUtc: '2026-09-01T12:00:00.000Z',
      sha256: '0'.repeat(64)
    }
    const template = fixture.items[0]!
    const bases = Array.from({ length: 6 }, (_, index): CollectionItem => ({
      ...template,
      record: `records/items/synthetic/mi_base_${index}.dbr`,
      name: ['Bloodsworn Repeater', 'Yeti Horn', 'Leafmane Trophy', 'Voidplume Crest', 'Korvan Gaze', 'Ugdenbog Edge'][index]!,
      rarity: 'mi',
      itemClass: index % 2 === 0 ? 'weapon_sword' : 'armor_medal',
      slot: index % 2 === 0 ? 'sword' : 'medal',
      levelRequirement: 35 + index * 12,
      itemLevel: 35 + index * 12,
      availableCount: 12,
      analyzedCopyCount: 12,
      bestRollPercentile: 94 - index * 4,
      discovered: true,
      presentation: {
        ...template.presentation!,
        searchText: `synthetic monster infrequent ${index % 2 === 0 ? 'physical damage' : 'vitality damage'}`
      }
    }))
    const prefixes = Array.from({ length: 12 }, (_, index) => ({
      key: `synthetic-prefix-${index}`,
      name: ['Void-Touched', 'Subjugator\'s', 'Glacial', 'Impervious', 'Devouring', 'Thunderstruck'][index % 6]! + (index >= 6 ? ' Prime' : ''),
      kind: 'prefix' as const,
      rarity: index % 3 === 0 ? 'magical' as const : 'rare' as const,
      records: [`records/items/synthetic/prefix_${index}.dbr`],
      availableCount: 6
    }))
    const suffixes = Array.from({ length: 12 }, (_, index) => ({
      key: `synthetic-suffix-${index}`,
      name: ['of Alacrity', 'of Binding', 'of Frostbite', 'of the Cabal', 'of Corrupted Peaks', 'of Scorching'][index % 6]! + (index >= 6 ? ' Prime' : ''),
      kind: 'suffix' as const,
      rarity: index % 4 === 0 ? 'magical' as const : 'rare' as const,
      records: [`records/items/synthetic/suffix_${index}.dbr`],
      availableCount: 6
    }))
    const observedItems = Array.from({ length: 72 }, (_, index): ObservedStashItem => {
      const base = bases[Math.floor(index / 12)]!
      const prefix = prefixes[index % 12]!
      const suffix = suffixes[(index * 5) % 12]!
      const percentile = 20 + (index * 17) % 79
      return {
        sourcePath: syntheticStash.path,
        tabIndex: Math.floor(index / 24),
        itemIndex: index % 24,
        baseRecord: base.record,
        prefixRecord: prefix.records[0]!,
        suffixRecord: suffix.records[0]!,
        modifierRecord: '',
        transmuteRecord: '',
        seed: 1_000_000 + index,
        materiaRecord: '',
        relicCompletionBonusRecord: '',
        relicSeed: 0,
        enchantmentRecord: '',
        ascendantRecord: '',
        ascendantRecord2H: '',
        enchantmentSeed: 0,
        materiaCombines: 0,
        stackCount: 1,
        rerolls: 0,
        affixRerolls: 0,
        instanceKey: `fixture-mi-${index}`,
        rollAnalysis: {
          modelVersion: 9,
          baseRecord: base.record,
          prefixRecord: prefix.records[0]!,
          suffixRecord: suffix.records[0]!,
          seed: 1_000_000 + index,
          supported: true,
          trusted: true,
          reason: null,
          percentileSampleSize: 1_000,
          overallEstimatedPercentile: percentile,
          baseEstimatedPercentile: Math.max(1, percentile - 7),
          prefixEstimatedPercentile: Math.min(99, percentile + 5),
          suffixEstimatedPercentile: Math.max(1, percentile - 3),
          categoryScores: [
            {
              key: 'offense:physical',
              category: 'offense',
              damageType: 'physical',
              estimatedPercentile: percentile,
              qualityPercent: percentile,
              statCount: 2,
              combinationPercentile: Math.min(99, percentile + 15)
            },
            ...(index % 3 === 0 ? [{
              key: 'offense:fire',
              category: 'offense' as const,
              damageType: 'fire',
              estimatedPercentile: Math.max(4, 98 - percentile),
              qualityPercent: Math.max(4, 98 - percentile),
              statCount: 1,
              combinationPercentile: Math.max(4, 98 - percentile)
            }] : []),
            {
              key: 'defense',
              category: 'defense',
              damageType: null,
              estimatedPercentile: Math.max(3, percentile - 13),
              qualityPercent: Math.max(3, percentile - 13),
              statCount: 2,
              combinationPercentile: Math.max(8, percentile - 2)
            },
            {
              key: 'utility',
              category: 'utility',
              damageType: null,
              estimatedPercentile: Math.min(99, percentile + 9),
              qualityPercent: Math.min(99, percentile + 9),
              statCount: 1,
              combinationPercentile: Math.min(99, percentile + 9)
            },
            ...(index % 4 === 0 ? [{
              key: 'pet',
              category: 'pet' as const,
              damageType: null,
              estimatedPercentile: 25 + (index * 11) % 70,
              qualityPercent: 25 + (index * 11) % 70,
              statCount: 2,
              combinationPercentile: 30 + (index * 13) % 69
            }] : [])
          ],
          stats: [{
            field: 'offensivePhysicalModifier',
            value: 80 + index,
            rollable: true,
            observedMinimum: 75,
            observedMaximum: 155,
            estimatedPercentile: percentile
          }],
          petStats: [],
          unmodeledFields: []
        }
      }
    })
    return {
      ...fixture,
      scannedStashes: [syntheticStash],
      availableStashes: [syntheticStash],
      observedItems,
      items: bases,
      rarities: [{ rarity: 'mi', total: bases.length, collected: bases.length, availableCopies: observedItems.length }],
      affixes: [...prefixes, ...suffixes],
      affixSummary: { total: prefixes.length + suffixes.length, collected: prefixes.length + suffixes.length, availableCopies: observedItems.length * 2 }
    }
  }
  if (name === 'skill-explorer') {
    const fixture = createScreenshotCollectionFixture('search-help')
    const template = fixture.items[0]!
    const rarities = ['legendary', 'epic', 'rare'] as const
    const slots = ['head', 'chest', 'shoulders', 'medal', 'sword', 'offhand'] as const
    const items = Array.from({ length: 120 }, (_, index): CollectionItem => {
      const rarity = rarities[index % rarities.length]!
      const slot = slots[index % slots.length]!
      const conversionTarget = ['Vitality', 'Cold', 'Lightning', 'Acid'][index % 4]!
      return {
        ...template,
        record: `records/items/synthetic/skill_support_${index}.dbr`,
        name: `Totemic Research ${String(index + 1).padStart(3, '0')}`,
        rarity,
        itemClass: slot === 'sword' ? 'weapon_sword' : `armor_${slot}`,
        slot,
        levelRequirement: 20 + index % 75,
        itemLevel: 20 + index % 75,
        availableCount: index % 4 === 0 ? 1 : 0,
        discovered: index % 4 === 0 || index % 8 === 3,
        recipeUnlocked: index % 4 === 1,
        availableViaAwakening: index % 4 === 2,
        awakeningSourceAvailableCount: index % 4 === 2 ? 1 : 0,
        awakeningSourceName: index % 4 === 2 ? 'Synthetic Epic Base' : null,
        presentation: {
          flavorText: null,
          sections: [{
            kind: 'base',
            heading: null,
            lines: [{
              label: 'to Wendigo Totem',
              minimum: 1 + index % 3,
              maximum: 1 + index % 3,
              unit: '',
              tone: 'skill',
              prefix: '+',
              suffix: ''
            }]
          }, {
            kind: 'skill-modifier',
            heading: 'Wendigo Totem',
            lines: [{
              label: `Bleeding Damage converted to ${conversionTarget} Damage`,
              minimum: 20 + index % 31,
              maximum: 20 + index % 31,
              unit: '%',
              tone: 'standard',
              prefix: '',
              suffix: ''
            }, {
              label: 'Skill Recharge',
              minimum: -(index % 4 + 1) * 0.25,
              maximum: -(index % 4 + 1) * 0.25,
              unit: 's',
              tone: 'standard',
              prefix: '',
              suffix: ''
            }]
          }, ...(index % 4 === 0 ? [{
            kind: 'visual-modifier' as const,
            heading: 'Wendigo Totem · Visual transformation',
            lines: [{
              label: 'Alternate crimson spirit effect',
              minimum: null,
              maximum: null,
              unit: '' as const,
              tone: 'visual' as const,
              prefix: '',
              suffix: ''
            }]
          }, {
            kind: 'visual-modifier' as const,
            heading: 'Storm Totem · Visual transformation',
            lines: [{
              label: 'Alternate azure storm effect',
              minimum: null, maximum: null, unit: '' as const,
              tone: 'visual' as const, prefix: '', suffix: ''
            }]
          }] : []), {
            kind: 'skill-modifier', heading: 'Fixture Talons', parentSkills: ['Wendigo Totem'],
            lines: [{ label: 'Weapon Damage', minimum: 30, maximum: null, unit: '%', tone: 'standard', prefix: '', suffix: '' }]
          }],
          grantedSkill: null,
          searchText: `wendigo totem ${conversionTarget.toLocaleLowerCase()} damage skill recharge alternate crimson spirit effect synthetic qa`
        }
      }
    })
    return {
      ...fixture,
      items,
      rarities: rarities.map((rarity) => ({
        rarity,
        total: items.filter((item) => item.rarity === rarity).length,
        collected: items.filter((item) => item.rarity === rarity && item.discovered).length,
        availableCopies: items.filter((item) => item.rarity === rarity).reduce((total, item) => total + item.availableCount, 0)
      })),
      skillMasteries: Object.fromEntries([
        ['Wendigo Totem', 'Shaman'],
        ...Array.from({ length: 60 }, (_, index) => [
          `Synthetic Skill ${String(index + 1).padStart(3, '0')}`,
          'Synthetic QA'
        ])
      ])
    }
  }
  if (name !== 'search-help') throw new Error(`Unknown screenshot fixture: ${name}`)
  return {
    catalogPresentationVersion: CATALOG_PRESENTATION_VERSION,
    cacheNeedsRefresh: false,
    basis: 'stashes',
    scannedAtUtc: '2026-09-01T00:00:00.000Z',
    discovery: { installations: [], saveLocations: [] },
    contentPacks: [],
    scannedStashes: [],
    availableStashes: [],
    observedItems: [],
    warnings: [],
    rarities: [],
    items: [{
      record: 'records/items/synthetic/searchlight.dbr',
      name: 'Mythical Searchlight',
      rarity: 'legendary',
      itemClass: 'armor_head',
      slot: 'head',
      levelRequirement: 84,
      itemLevel: 84,
      setName: null,
      setRecord: null,
      bitmap: null,
      contentPack: 'Synthetic QA',
      acquisition: {
        sources: ['Synthetic QA source'],
        sourceRecords: [],
        locations: [{
          name: 'QA Hollow',
          routeName: 'Search Tips Route',
          zoneRecord: 'records/levels/synthetic/qa_hollow.dbr',
          levelFile: 'levels/synthetic/qa_hollow.map',
          contentPack: 'Synthetic QA',
          originX: 0,
          originY: 0
        }],
        additionalLocationCount: 0,
        factions: [],
        crafting: null
      },
      presentation: {
        flavorText: null,
        sections: [{
          kind: 'base',
          heading: null,
          lines: [{
            label: 'Fire Resistance',
            minimum: 100,
            maximum: 100,
            unit: '%',
            tone: 'standard',
            prefix: '+',
            suffix: ''
          }]
        }],
        grantedSkill: null,
        searchText: 'fire resistance synthetic qa ward'
      },
      supplySlotFamilies: null,
      availableCount: 0,
      bestRollPercentile: null,
      analyzedCopyCount: 0,
      pinnedInstanceKey: null,
      discovered: false,
      recipeUnlocked: false,
      firstDiscoveredAt: null
    }],
    recipeSummary: { total: 0, collected: 0, unlockedItems: 0 },
    supplySummary: { rarity: 'supply', total: 0, collected: 0, availableCopies: 0 },
    affixSummary: { total: 0, collected: 0, availableCopies: 0 },
    affixes: [],
    plannerItems: [],
    supplies: [],
    materials: [],
    uiIcons: {},
    accountStores: [],
    skillMasteries: {},
    skillClassNames: {}
  }
}

export function createScreenshotSetItem(input: {
  record: string
  name: string
  rarity: 'epic' | 'legendary'
  slot: string
  level: number
  setName: string
  setRecord: string
  availableCount?: number
  bestRollPercentile?: number
  discovered?: boolean
  recipeUnlocked?: boolean
  availableViaAwakening?: boolean
  awakeningSourceAvailableCount?: number
  awakeningSourceName?: string
  setPresentation?: CollectionItem['setPresentation']
  visual?: boolean
}): CollectionItem {
  return {
    record: input.record,
    name: input.name,
    rarity: input.rarity,
    itemClass: `armor_${input.slot}`,
    slot: input.slot,
    levelRequirement: input.level,
    itemLevel: input.level,
    setName: input.setName,
    setRecord: input.setRecord,
    bitmap: null,
    contentPack: 'Synthetic QA',
    setPresentation: input.setPresentation ?? null,
    presentation: input.visual ? {
      flavorText: null,
      sections: [{
        kind: 'visual-modifier',
        heading: 'Wendigo Totem · Visual transformation',
        lines: [{
          label: 'Alternate crimson spirit effect', minimum: null, maximum: null,
          unit: '', tone: 'visual', prefix: '', suffix: ''
        }]
      }],
      grantedSkill: null,
      searchText: 'wendigo totem vitality damage alternate crimson spirit effect'
    } : undefined,
    availableCount: input.availableCount ?? 0,
    bestRollPercentile: input.bestRollPercentile ?? null,
    analyzedCopyCount: input.bestRollPercentile === undefined ? 0 : 1,
    pinnedInstanceKey: null,
    discovered: input.discovered ?? false,
    recipeUnlocked: input.recipeUnlocked ?? false,
    availableViaAwakening: input.availableViaAwakening ?? false,
    awakeningSourceRecord: input.availableViaAwakening ? `${input.record}.base` : null,
    awakeningSourceName: input.awakeningSourceName ?? null,
    awakeningSourceAvailableCount: input.awakeningSourceAvailableCount ?? 0,
    firstDiscoveredAt: input.discovered ? '2026-09-01T00:00:00.000Z' : null
  }
}
