import type { CollectionSnapshot } from '@shared/contracts'
import type { OnboardingStatus } from '../onboarding'

export type MiCountingMode = 'base' | 'tier'
export type WorkspaceToolId = 'sets' | 'materials' | 'skills' | 'oracle' | 'planner' | 'mi-workshop' | 'supplies' | 'farming' | 'dismantling' | 'trivia' | 'todo'
export type SettingsStashChoice = NonNullable<CollectionSnapshot['availableStashes']>[number]

export interface WorkspaceToolDefinition {
  id: WorkspaceToolId
  label: string
  detail: string
  experimental?: boolean
}

export const workspaceToolDefinitions: WorkspaceToolDefinition[] = [
  { id: 'sets', label: 'Sets', detail: 'Set completion, bonuses, recipes, and visual modifiers.' },
  { id: 'materials', label: 'Components & Consumables', detail: 'Components, crafting materials, and consumable formulas.' },
  { id: 'skills', label: 'Skill Explorer', detail: 'Every item that ranks, converts, or otherwise modifies a skill.' },
  { id: 'oracle', label: 'Stash Oracle', detail: 'Build archetypes suggested by the items already in your archive.', experimental: true },
  { id: 'planner', label: 'Leveling Planner', detail: 'Character shopping lists and leveling routes.' },
  { id: 'mi-workshop', label: 'MI Workshop', detail: 'Stored Monster Infrequents, affixes, and stat comparisons.' },
  { id: 'supplies', label: 'Supplies', detail: 'Reusable boosts, merits, warrants, augments, and runes.' },
  { id: 'farming', label: 'Collection Farming', detail: 'Areas ranked by potential collection progress.' },
  { id: 'dismantling', label: 'Dismantling Lab', detail: 'Read-only Inventor cost and material-yield simulation.', experimental: true },
  { id: 'trivia', label: 'Collection Trivia', detail: 'Roll, duplicate, and collection curiosities.' },
  { id: 'todo', label: 'To-do', detail: 'Your small in-app task list.' }
]

export const defaultWorkspaceToolIds = workspaceToolDefinitions.map((tool) => tool.id)
export const essentialWorkspaceToolIds: WorkspaceToolId[] = ['sets', 'skills', 'planner', 'mi-workshop', 'supplies']

export function settingsOnboardingStatusLabel(status: OnboardingStatus, step: number): string {
  if (status === 'completed') return 'Completed'
  if (status === 'skipped') return 'Skipped · resume any time'
  return `In progress · step ${step + 1}`
}

export function settingsArchiveModeEnabled(
  stashes: readonly SettingsStashChoice[],
  archivePaths: readonly string[],
  isHardcore: boolean
): boolean {
  const modePaths = new Set(stashes.filter((stash) => stash.isHardcore === isHardcore).map((stash) => stash.path))
  return archivePaths.some((path) => modePaths.has(path))
}

export function settingsArchiveModeCount(
  stashes: readonly SettingsStashChoice[],
  archivePaths: readonly string[]
): number {
  return [false, true].filter((isHardcore) => settingsArchiveModeEnabled(stashes, archivePaths, isHardcore)).length
}

export function formatSettingsBackupDate(value: string): string {
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

export function formatSettingsBackupSize(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
