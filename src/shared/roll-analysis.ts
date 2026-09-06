// Keep the helper's ItemRollAnalysis.ModelVersion in sync. A model change invalidates
// cached category scores; exact item payloads and per-stat sampled bounds are separate.
export const ROLL_ANALYSIS_VERSION = 10

export const ROLL_DAMAGE_TYPES = [
  { id: 'physical', label: 'Physical', overTime: false },
  { id: 'internal-trauma', label: 'Internal Trauma', overTime: true },
  { id: 'pierce', label: 'Pierce', overTime: false },
  { id: 'bleeding', label: 'Bleeding', overTime: true },
  { id: 'fire', label: 'Fire', overTime: false },
  { id: 'burn', label: 'Burn', overTime: true },
  { id: 'cold', label: 'Cold', overTime: false },
  { id: 'frostburn', label: 'Frostburn', overTime: true },
  { id: 'lightning', label: 'Lightning', overTime: false },
  { id: 'electrocute', label: 'Electrocute', overTime: true },
  { id: 'acid', label: 'Acid', overTime: false },
  { id: 'poison', label: 'Poison', overTime: true },
  { id: 'vitality', label: 'Vitality', overTime: false },
  { id: 'vitality-decay', label: 'Vitality Decay', overTime: true },
  { id: 'aether', label: 'Aether', overTime: false },
  { id: 'chaos', label: 'Chaos', overTime: false },
  { id: 'elemental', label: 'Elemental', overTime: false }
] as const

export type RollDamageType = typeof ROLL_DAMAGE_TYPES[number]['id']

export function isDamageOverTime(type: string | null | undefined): boolean {
  return ROLL_DAMAGE_TYPES.some(damage => damage.id === type && damage.overTime)
}
