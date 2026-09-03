import { glossarySources } from '../../../shared/glossary-sources.ts'

export interface GlossarySection {
  id: string
  title: string
  paragraphs: readonly string[]
  bullets?: readonly string[]
  table?: { caption: string; headings: readonly string[]; rows: readonly (readonly string[])[] }
  expandable?: boolean
  caution?: boolean
}

export interface GlossaryEntry {
  id: string
  title: string
  summary: string
  example: { label: string; quality: string; rank: string; explanation: string }
  sections: readonly GlossarySection[]
  sources: readonly { label: string; url: string }[]
}

// Content is independent of the application shell. Add future entries here.
export const glossaryEntries: readonly GlossaryEntry[] = [{
  id: 'item-rolls',
  title: 'Item rolls & ratings',
  summary: 'Read the roll, choose the category that matters to your build, then compare the actual bonuses.',
  example: {
    label: 'A category score might read',
    quality: '78%',
    rank: '98th',
    explanation: '78% is the average quality of the included rolls. 98th is the estimated percentile of that average among sampled rolls of the same item template. A 78% average can already be rare; it is not 78% of an item’s power.'
  },
  sections: [
    {
      id: 'what-is-rated', title: 'What the numbers tell you',
      paragraphs: ['An actual value is the bonus on your copy, such as 9 Vitality damage. A variable roll can differ between copies; a fixed bonus cannot. Quality describes where a variable value sits between its sampled minimum (0%) and maximum (100%).'],
      bullets: [
        'The first number is roll quality. Category scores average the included stat groups equally; they do not weight them by importance to your build.',
        'The number in parentheses is a percentile rank, not another quality score. It describes the sampled frequency of the result, not the item’s usefulness.',
        'A dash or absent category is not a zero roll. There may be no variable stats to rate, analysis may be unavailable or untrusted, or cached scores may be awaiting recalculation.'
      ]
    },
    {
      id: 'affixes', title: 'A great roll can still be the wrong item', caution: true,
      paragraphs: [
        'Scores apply to the exact base item + prefix + suffix template. This matters especially for Monster Infrequents (MIs): an 81% Pet score can belong to a copy with poor pet affixes.',
        'The rating does not judge affix desirability, how likely those affixes are to drop, or whether the item fits your build. Comparing scores across different templates does not establish which item is stronger. Check actual bonuses, skill modifiers, conversions, and the affixes themselves before choosing.'
      ]
    },
    {
      id: 'categories', title: 'Choose the category your build uses',
      paragraphs: ['There is no universal “best” score. A multi-type item can roll well for one damage family and poorly for another. Categories appear only when they contain rated variable stats.'],
      bullets: [
        'Offense: separate damage-family scores such as Pierce, Bleeding, or Fire. Shared offensive rolls, including Offensive Ability and attack/cast speed, contribute to every present offense family. Damage-over-time rolls follow their family, such as Burn with Fire.',
        'Retaliation: its own category, not part of ordinary offense. It matters greatly to retaliation builds, but not to most others.',
        'Defense: defensive rolls such as resistances, health, and Defensive Ability.',
        'Utility: other modeled rolls, including energy and miscellaneous benefits. Newly modeled fields without a more specific classification fall back here.',
        'Pet: only the separate pet-bonus stat block. Player bonuses are never mixed into it. Player-scaling summons use player stats instead of these pet bonuses.'
      ]
    },
    {
      id: 'choosing-copies', title: 'Cards, sorting & your reference copy',
      paragraphs: [
        'With a roll-quality sort selected, each Collection card shows the highest-quality owned copy for that category. “Offense · strongest type” selects the best offense family, which may not be the type your build uses. Choose a specific damage type when you know what you need.',
        'Other Collection sorts show the strongest available category as a compact summary. The label tells you which category won; it is not a whole-item rating.',
        'Roll sorting compares average quality first, then combination percentile to break ties. Unrated entries stay after rated ones in either direction. “All items” still includes missing items and recipe-only entries; they have no stored-copy roll score.',
        'Opening a scored card uses the exact copy behind its badge as the comparison reference. This is a viewing choice, not an automatic saved pin. “Save this reference” or “Use as reference” explicitly saves your choice; “Clear saved reference” removes the pin. Back/Forward restores the viewed copy when it is still available.',
        'MI Workshop groups exact affix combinations and lets you choose a category or an individual stat. Its selected metric and direction determine the group’s leading copy. Legacy overall/base/prefix/suffix metrics are still labeled as percentile averages; they are not the new range-quality score.'
      ]
    },
    {
      id: 'calculation', title: 'How the calculation works', expandable: true,
      paragraphs: [
        'Roll model v9 evaluates 4,096 deterministic seeds for the exact item template. Reusing the same seeds makes results repeatable and preserves relationships between stats rolled together. These are sample estimates, not exhaustive probabilities for every possible drop.',
        'For each variable stat: quality = 100 × (actual − sampled minimum) ÷ (sampled maximum − sampled minimum), clamped to 0–100. Fixed stats and unavailable or untrusted values are excluded, not scored as zero. The sampled endpoints are not a guarantee of the theoretical limits.',
        'For a displayed min/max damage range, normalize each variable member separately, leave fixed members out, then average the remaining members. Count that displayed range once. For example, member qualities of 50% and 100% form one 75% group; if one member is fixed, only the variable member counts.',
        'Average the included groups with equal weight to obtain a category’s quality. Calculate that same average for every sampled seed, then rank the copy against those averages. Category rarity is not a rank of the old average of per-stat percentiles.',
        'Individual stat ranks compare actual values against the sampled values for that stat. A displayed min/max range does not invent a combined percentile by averaging its member ranks; its tooltip keeps the individual ranks available.'
      ]
    },
    {
      id: 'ties', title: 'Why a maximum can be 100% (83rd)', expandable: true,
      paragraphs: [
        'Imagine a stat with equally frequent possible values of 7, 8, and 9. These quality percentages and percentile ranks answer different questions:',
        'A percentile counts all sampled rolls below the value plus half of those tied with it: 100 × (lower + tied ÷ 2) ÷ sample count. At 9, two thirds are lower and one third tie, giving 83⅓, displayed as 83rd. It is still the maximum: 100% quality.',
        'Do not subtract the percentile from 100 to get the chance of rolling this well or better. In this example, 9 occurs one third of the time, not about 17%. Rounded displays can also hide small differences.'
      ],
      table: {
        caption: 'Illustrative equal-frequency rolls', headings: ['Actual value', 'Range quality', 'Percentile rank'],
        rows: [['7 (minimum)', '0%', '17th'], ['8', '50%', '50th'], ['9 (maximum)', '100%', '83rd']]
      }
    },
    {
      id: 'elemental', title: 'Elemental is shared, not a fourth element', expandable: true,
      paragraphs: [
        'Flat Elemental damage divides equally into Fire, Cold, and Lightning. For example, 30 Elemental damage means 10 of each. A +30% Elemental damage bonus instead gives the full +30% to each of those three types.',
        'In the rating, shared Elemental rolls contribute to any present Fire, Cold, or Lightning family, and an Elemental score remains available for the shared rolls themselves. Shared offensive stats also contribute. The normalized quality and percentile are never divided by three: dividing a damage value is different from rating how well it rolled.'
      ]
    }
  ],
  sources: glossarySources
}]

export function glossaryEntry(id: unknown): GlossaryEntry {
  return glossaryEntries.find(entry => entry.id === id) ?? glossaryEntries[0]!
}
