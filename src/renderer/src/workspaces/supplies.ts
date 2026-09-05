import { ref, type Ref } from 'vue'
import type { AppRoute, SupplyCategory } from '../app-route'
import type { SupplySelectionItem } from '../../../shared/workspace-query-contracts.ts'
export * from '../../../shared/supply-presentation.ts'
export type { SupplyOption } from '../../../shared/workspace-query-contracts.ts'

export type SupplyControls = Extract<AppRoute, { workspace: 'supplies' }>['controls']
export interface SupplySession {
  contextKey: Ref<string | null>
  selectedIds: Ref<string[]>
  selectedItems: Ref<Map<string, SupplySelectionItem>>
}
export function createSupplySession(): SupplySession {
  return { contextKey: ref(null), selectedIds: ref<string[]>([]), selectedItems: ref(new Map()) }
}

export function updateSupplyControls(controls: SupplyControls, patch: Partial<SupplyControls>, resetPage: boolean): SupplyControls {
  return { ...controls, ...patch, ...(resetPage ? { page: 1 } : {}) }
}
export function changeSupplyCategory(controls: SupplyControls, category: SupplyCategory): SupplyControls {
  return updateSupplyControls(controls, { category, slot: 'all' }, true)
}
