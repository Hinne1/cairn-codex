export const RESETTABLE_UI_PREFERENCE_KEYS = [
  'cairn-codex-zoom',
  'cairn-codex-visible-workspace-tools',
  'cairn-codex-workspace-tools-version',
  'cairn-codex-experimental-tools',
  'cairn-codex-tracker-collapsed',
  'cairn-codex-tracker-layout-version',
  'cairn-codex-show-legacy-scanner',
  'cairn-codex-skill',
  'cairn-codex-skill-scope',
  'cairn-codex-oracle-class',
  'cairn-codex-oracle-style',
  'cairn-codex-oracle-minimum-level',
  'cairn-codex-oracle-maximum-level',
  'cairn-codex-planner-display',
  'cairn-codex-mi-counting-mode'
] as const

export interface RendererFailureReport {
  correlationId: string
  workspace: string
  message: string
  stack: string | null
}

export const RENDERER_FAILURE_EVENT = 'cairn-codex:renderer-failure'

export function resetUiPreferences(storage: Pick<Storage, 'removeItem'>): number {
  for (const key of RESETTABLE_UI_PREFERENCE_KEYS) storage.removeItem(key)
  return RESETTABLE_UI_PREFERENCE_KEYS.length
}

export function rendererFailureReport(error: unknown, workspace: string): RendererFailureReport {
  const value = error instanceof Error ? error : new Error(String(error))
  return {
    correlationId: crypto.randomUUID(),
    workspace: workspace.slice(0, 64),
    message: value.message.slice(0, 500) || 'Unknown renderer error',
    stack: value.stack?.slice(0, 4000) ?? null
  }
}
