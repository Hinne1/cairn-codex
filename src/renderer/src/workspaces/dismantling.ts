import type { DismantlingPreview } from '@shared/contracts'
import { ref, type Ref } from 'vue'
import type { AppRoute } from '../app-route'
import type { ArchiveItemSummary } from '../../../shared/workspace-query-contracts.ts'

export type DismantlingControls = Extract<AppRoute, { workspace: 'dismantling' }>['controls']

export interface DismantlingSession {
  contextKey: Ref<string | null>
  page: Ref<number>
  selectedIds: Ref<string[]>
  selectedItems: Ref<Map<string, ArchiveItemSummary>>
  preview: Ref<DismantlingPreview | null>
  busy: Ref<boolean>
  error: Ref<string | null>
}

export function createDismantlingSession(): DismantlingSession {
  return {
    contextKey: ref(null),
    page: ref(1),
    selectedIds: ref([]),
    selectedItems: ref(new Map()),
    preview: ref(null),
    busy: ref(false),
    error: ref(null)
  }
}

export function updateDismantlingControls(
  controls: DismantlingControls,
  patch: Partial<DismantlingControls>
): DismantlingControls {
  return { ...controls, ...patch }
}
