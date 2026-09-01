import type { CollectionItem } from '../../shared/contracts'
import type { SemanticTone } from './semantic-tokens'

export type SetRarity = 'epic' | 'legendary'

export interface SetSemanticBadge {
  key: string
  label: string
  tone: SemanticTone
}

export interface SetReadiness {
  kind: 'stored' | 'crafting' | 'awakening' | 'mixed' | 'missing'
  label: string
  tone: SemanticTone
  unqualifiedCount: number
}

function isAvailableViaAwakening(item: CollectionItem): boolean {
  return item.availableViaAwakening === true && (item.awakeningSourceAvailableCount ?? 0) > 0
}

export function setItemDiscovered(item: CollectionItem): boolean {
  return item.discovered === true || item.availableCount > 0
}

export function setCompletionCount(items: readonly CollectionItem[]): number {
  return items.filter(setItemDiscovered).length
}

export function setRarity(items: readonly CollectionItem[]): SetRarity {
  return items.some((item) => item.rarity === 'legendary') ? 'legendary' : 'epic'
}

export function setItemUnqualified(item: CollectionItem): boolean {
  return item.availableCount <= 0 && !item.recipeUnlocked && !isAvailableViaAwakening(item)
}

export function setItemBadges(item: CollectionItem): SetSemanticBadge[] {
  const badges: SetSemanticBadge[] = []
  if (item.availableCount > 0) {
    badges.push({ key: 'owned', label: `Owned ×${item.availableCount}`, tone: 'owned' })
  } else if (setItemDiscovered(item)) {
    badges.push({ key: 'discovered', label: 'Discovered', tone: 'discovered' })
  }
  if (item.recipeUnlocked) {
    badges.push({ key: 'recipe', label: 'Recipe', tone: 'crafting' })
  }
  if (isAvailableViaAwakening(item)) {
    badges.push({ key: 'awakening', label: 'Awaken base', tone: 'awakening' })
  }
  if (badges.length === 0) {
    badges.push({ key: 'missing', label: 'Missing', tone: 'missing' })
  }
  return badges
}

export function setReadiness(items: readonly CollectionItem[]): SetReadiness {
  const missingFromStorage = items.filter((item) => item.availableCount <= 0)
  if (missingFromStorage.length === 0) {
    return { kind: 'stored', label: 'Ready from storage', tone: 'owned', unqualifiedCount: 0 }
  }

  const unqualifiedCount = missingFromStorage.filter(setItemUnqualified).length
  if (unqualifiedCount > 0) {
    return {
      kind: 'missing',
      label: `${unqualifiedCount} unqualified ${unqualifiedCount === 1 ? 'piece' : 'pieces'}`,
      tone: 'missing',
      unqualifiedCount
    }
  }

  const everyPieceCraftable = missingFromStorage.every((item) => item.recipeUnlocked)
  const everyPieceAwakenable = missingFromStorage.every(isAvailableViaAwakening)
  if (everyPieceCraftable) {
    return { kind: 'crafting', label: 'Ready after crafting', tone: 'crafting', unqualifiedCount: 0 }
  }
  if (everyPieceAwakenable) {
    return { kind: 'awakening', label: 'Ready after awakening', tone: 'awakening', unqualifiedCount: 0 }
  }
  return {
    kind: 'mixed',
    label: 'Ready via crafting + awakening',
    tone: 'progress',
    unqualifiedCount: 0
  }
}
