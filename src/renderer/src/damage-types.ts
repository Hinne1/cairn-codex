// Rainbow Filter's Full Rainbow damage semantics. Source codes and original hues:
// https://github.com/WareBare/WanezGD_Tools/blob/master/app/data/gd-colorcodes.json
// https://github.com/WareBare/WanezRainbowFiles/blob/main/text_en/tags_ui.txt
// Pierce and Vitality use lighter text variants for the application's dark surfaces.
// Rainbow color groups are independent of score identity: Pierce and Bleeding stay separate scores.
export const DAMAGE_FAMILIES = [
  { id: 'physical', label: 'Physical / Internal Trauma', code: 'K', source: '#f1e78c', color: '#f1e78c', aliases: ['physical', 'internal trauma', 'trauma'] },
  { id: 'pierce', label: 'Pierce / Bleeding', code: 'R', source: '#ff4200', color: '#ff5722', aliases: ['pierce', 'piercing', 'bleeding', 'bleed'] },
  { id: 'elemental', label: 'Elemental', code: 'Y', source: '#fff62c', color: '#fff62c', aliases: ['elemental', 'elemental blaze'] },
  { id: 'cold', label: 'Cold / Frostburn', code: 'C', source: '#00ffff', color: '#00ffff', aliases: ['cold', 'frostburn'] },
  { id: 'fire', label: 'Fire / Burn', code: 'O', source: '#f3a44d', color: '#f3a44d', aliases: ['fire', 'burn'] },
  { id: 'acid', label: 'Acid / Poison', code: 'L', source: '#92cc00', color: '#92cc00', aliases: ['acid', 'poison'] },
  { id: 'lightning', label: 'Lightning / Electrocute', code: 'Z', source: '#6a91e0', color: '#6a91e0', aliases: ['lightning', 'electrocute'] },
  { id: 'vitality', label: 'Vitality / Vitality Decay', code: 'M', source: '#800000', color: '#e57878', aliases: ['vitality', 'vitality decay', 'vitality-decay'] },
  { id: 'chaos', label: 'Chaos', code: 'P', source: '#bd94c6', color: '#bd94c6', aliases: ['chaos'] },
  { id: 'aether', label: 'Aether', code: 'A', source: '#80ffd5', color: '#80ffd5', aliases: ['aether'] }
] as const

export type DamageFamily = typeof DAMAGE_FAMILIES[number]['id']
export type DamageToken = `--gd-damage-${DamageFamily}`
export const DAMAGE_TOKENS = DAMAGE_FAMILIES.map(({ id }) => `--gd-damage-${id}` as DamageToken)
export const DAMAGE_TOKEN_COLORS = Object.fromEntries(
  DAMAGE_FAMILIES.map(({ id, color }) => [`--gd-damage-${id}`, color])
) as Record<DamageToken, string>

const aliases = new Map<string, DamageFamily>(DAMAGE_FAMILIES.flatMap(family =>
  family.aliases.map(alias => [alias, family.id] as const)))

export function damageFamily(type: string | null | undefined): DamageFamily | undefined {
  return type ? aliases.get(type.trim().toLowerCase()) : undefined
}

export function damageStyle(type: string | null | undefined): { color: string } | undefined {
  const family = damageFamily(type)
  return family ? { color: `var(--gd-damage-${family})` } : undefined
}

export interface DamageTextSpan { text: string; family?: DamageFamily; conversionRole?: 'source' | 'target' }

// Longest names first avoids splitting Vitality Decay, Internal Trauma, and Frostburn.
const names = [...aliases.keys()].sort((a, b) => b.length - a.length).join('|')
const typePattern = new RegExp(`\\b(${names})\\b`, 'giu')
const conversionPattern = new RegExp(`\\b(${names})(?: Damage)? converted to (${names})(?: Damage)?\\b`, 'giu')
const statSuffix = /^(?:\s*(?:Damage|Resistance|Resistances|Resist|Retaliation|Duration|Modifier)\b)/iu

// Stat text only, never item names, skill names, or flavor prose. Known type fields
// (e.g. a conversion target) can explicitly opt into type-only labels.
// Every span is original text, rendered by Vue as text nodes, never HTML.
export function damageTextSpans(text: string, typesOnly = false): DamageTextSpan[] {
  const matches: Array<{ start: number; end: number; family: DamageFamily; conversionRole?: 'source' | 'target' }> = []
  const conversions = [...text.matchAll(conversionPattern)]
  for (const match of text.matchAll(typePattern)) {
    const start = match.index
    const end = start + match[0].length
    const conversion = conversions.find(conversion => start >= conversion.index && end <= conversion.index + conversion[0].length)
    const prefix = text.slice(0, start)
    // Energy Burn is not Fire damage, and rank/skill names are not stat labels.
    if (/\bEnergy\s+$/iu.test(prefix) || /\bto\s+$/iu.test(prefix) && !conversion && !typesOnly) continue
    // Some generated stats omit "Damage", e.g. +25% Vitality Decay.
    const bareStat = /^\s*(?:$|;)/u.test(text.slice(end)) && /(?:^|;)\s*[-+−]?(?:[\d.%\s-]+)?$/u.test(prefix)
    if (typesOnly || conversion || bareStat || statSuffix.test(text.slice(end))) {
      matches.push({ start, end, family: damageFamily(match[0])!, ...(conversion
        ? { conversionRole: start === conversion.index ? 'source' as const : 'target' as const } : {}) })
    }
  }
  if (!matches.length) return [{ text }]
  const spans: DamageTextSpan[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.start > cursor) spans.push({ text: text.slice(cursor, match.start) })
    spans.push({ text: text.slice(match.start, match.end), family: match.family, ...(match.conversionRole ? { conversionRole: match.conversionRole } : {}) })
    cursor = match.end
  }
  if (cursor < text.length) spans.push({ text: text.slice(cursor) })
  return spans
}
