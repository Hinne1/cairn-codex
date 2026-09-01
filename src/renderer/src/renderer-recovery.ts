import { createPreferenceRepository, type PreferenceStorage } from './preference-repository.ts'

export interface RendererFailureReport {
  correlationId: string
  workspace: string
  message: string
  stack: string | null
}

export const RENDERER_FAILURE_EVENT = 'cairn-codex:renderer-failure'

export function resetUiPreferences(storage: PreferenceStorage): number {
  return createPreferenceRepository(storage).resetInterface()
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
