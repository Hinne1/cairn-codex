import type { CharacterSaveProfile, LiveGameStatus } from '../../shared/contracts.ts'

/** Save-file recency is collection knowledge, never evidence of live presence. */
export function resolveActiveCharacter(
  status: LiveGameStatus | null,
  characters: readonly CharacterSaveProfile[]
): CharacterSaveProfile | null {
  if (status?.state !== 'ready' || !status.grimDawnProcessIds.length ||
      !status.activeCharacterName?.trim() || typeof status.isHardcore !== 'boolean') return null
  const name = status.activeCharacterName.toLowerCase()
  return characters
    .filter(character => !character.error && character.isHardcore === status.isHardcore &&
      character.name.toLowerCase() === name)
    .sort((left, right) => Date.parse(right.lastWriteUtc) - Date.parse(left.lastWriteUtc))[0] ?? null
}
