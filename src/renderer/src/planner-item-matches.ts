import type { CollectionItem } from '@shared/contracts'

export interface PlannerMasteryMatch {
  mastery: string
  amount: number
}

export function masteryMatchesForItem(
  item: Pick<CollectionItem, 'presentation'>,
  requestedMasteries: readonly string[]
): PlannerMasteryMatch[] {
  const selected = new Map<string, string>()
  for (const mastery of requestedMasteries) {
    const displayName = mastery.trim()
    if (displayName) selected.set(displayName.toLocaleLowerCase(), displayName)
  }
  if (selected.size === 0) return []

  const matches = new Map<string, PlannerMasteryMatch>()
  for (const line of item.presentation?.sections.flatMap((section) => section.lines) ?? []) {
    if (line.tone !== 'mastery') continue
    const masteryName = line.label.match(/^to all skills in\s+(.+)$/i)?.[1]?.trim()
    if (!masteryName) continue
    const normalized = masteryName.toLocaleLowerCase()
    const selectedName = selected.get(normalized)
    if (!selectedName) continue
    const amount = line.minimum ?? 0
    if (amount <= 0) continue
    const current = matches.get(normalized)
    if (!current || amount > current.amount) {
      matches.set(normalized, { mastery: selectedName, amount })
    }
  }
  return [...matches.values()]
}
