import type { CollectionSnapshot } from '../shared/contracts.ts'

export function workspaceQueryCollection(template: CollectionSnapshot): CollectionSnapshot {
  const gear = ['legendary', 'epic', 'mi', 'rare'].map((rarity, index) => ({ ...template.items[0]!,
    record: `records/synthetic/query_gear_${index}.dbr`, name: `Synthetic ${rarity} equipment`,
    rarity: rarity as 'legendary' | 'epic' | 'mi' | 'rare', slot: 'chest',
    contentPack: 'base', levelRequirement: 50, itemLevel: 50, availableCount: 5000, discovered: true }))
  const supplies = ['writ', 'potion', 'rune'].map(slot => ({ ...template.items[0]!,
    record: `records/synthetic/query_${slot}.dbr`, name: `Synthetic ${slot}`, rarity: 'supply' as const,
    slot, contentPack: 'base', availableCount: 1, discovered: true, supplySlotFamilies: ['weapon' as const] }))
  const stash = { path: 'C:\\Synthetic QA\\workspace-queries\\transfer.gst', isHardcore: false,
    modLabel: 'Synthetic', itemCount: 0, lastWriteUtc: '2026-09-05T00:00:00.000Z', sha256: 'a'.repeat(64) }
  return { ...template, items: gear, plannerItems: [], supplies, observedItems: [],
    discovery: { installations: [], saveLocations: [] }, scannedStashes: [stash], availableStashes: [stash],
    supplySummary: { rarity: 'supply', total: 3, collected: 3, availableCopies: 145 } }
}
