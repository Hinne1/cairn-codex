import type { BoundedResultKey } from './bounded-results'
import type { ResearchItemTableRow } from './workspaces/research-item-table'

export interface ItemContextRequest<T> {
  key: BoundedResultKey
  item: T
  source: HTMLElement
  point?: { x: number; y: number }
}

export type ItemContextActionId = 'inspect' | 'favorite' | 'ignore'
export interface ItemContextAction {
  id: ItemContextActionId
  label: string
  description?: string
}
export interface ItemContextCapabilities {
  favorite: boolean
  ignore: boolean
}

export function isItemContextShortcut(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>): boolean {
  return !event.ctrlKey && !event.altKey && !event.metaKey &&
    (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
}

export function researchItemContextActions(row: ResearchItemTableRow, capabilities: ItemContextCapabilities): ItemContextAction[] {
  return [
    { id: 'inspect', label: 'Inspect item' },
    ...(capabilities.favorite ? [{ id: 'favorite' as const, label: row.favorite ? 'Unfavorite' : 'Favorite', description: 'Matching item variants across your plans' }] : []),
    ...(capabilities.ignore ? [{ id: 'ignore' as const, label: row.ignored ? 'Restore base to this plan' : 'Ignore base in this plan', description: 'Matching item variants in the current plan' }] : [])
  ]
}

export function itemMenuPosition(point: { x: number; y: number }, size: { width: number; height: number }, viewport: { width: number; height: number }): { left: number; top: number } {
  return {
    left: Math.max(8, Math.min(point.x, viewport.width - size.width - 8)),
    top: Math.max(8, Math.min(point.y, viewport.height - size.height - 8))
  }
}
