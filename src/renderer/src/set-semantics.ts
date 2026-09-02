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

export interface SetRollRating {
  average: number | null
  ratedPieces: number
  availablePieces: number
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

export function compareSetCompletion(
  left: readonly CollectionItem[],
  right: readonly CollectionItem[]
): number {
  // Completion sorting has three user-facing bands. Crafting, awakening, and a
  // mixture of both are all complete qualifications; their implementation path
  // must not outrank how much of the set has actually been discovered.
  const readinessRank: Record<SetReadiness['kind'], number> = {
    stored: 2,
    crafting: 1,
    awakening: 1,
    mixed: 1,
    missing: 0
  }
  const readinessComparison =
    readinessRank[setReadiness(left).kind] - readinessRank[setReadiness(right).kind]
  if (readinessComparison !== 0) return readinessComparison

  const leftCollected = setCompletionCount(left)
  const rightCollected = setCompletionCount(right)
  return leftCollected / left.length - rightCollected / right.length ||
    leftCollected - rightCollected
}

export function setRollRating(items: readonly CollectionItem[]): SetRollRating {
  const available = items.filter((item) => item.availableCount > 0)
  const ratings = available
    .filter((item) => item.analyzedCopyCount > 0)
    .map((item) => item.bestRollPercentile)
    .filter((rating): rating is number => rating !== null && Number.isFinite(rating))
  return {
    average: ratings.length > 0
      ? ratings.reduce((total, rating) => total + rating, 0) / ratings.length
      : null,
    ratedPieces: ratings.length,
    availablePieces: available.length
  }
}
