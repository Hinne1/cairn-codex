import type { CollectionItem } from './contracts'

export function withRecipeAvailability<T extends CollectionItem>(
  item: T,
  isHardcore?: boolean
): T & { recipeUnlocked: boolean } {
  const crafting = item.acquisition?.crafting
  const recipeUnlocked = !crafting
    ? false
    : isHardcore === true
      ? crafting.knownHardcore === true
      : isHardcore === false
        ? crafting.knownSoftcore === true
        : crafting.knownSoftcore === true || crafting.knownHardcore === true

  return {
    ...item,
    recipeUnlocked
  }
}
