export interface TooltipWheelInput {
  deltaX: number
  deltaY: number
  deltaMode: number
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

export interface TooltipScrollState {
  top: number
  height: number
  scrollHeight: number
  target: number | null
  direct: boolean
  boundary: 'page' | 'contain'
  pageHeight: number
}

export type TooltipWheelIntent =
  | { kind: 'native' | 'contain' | 'pending' }
  | { kind: 'page'; delta: number }
  | { kind: 'tooltip'; top: number }

export function wheelPixels(delta: number, mode: number, pageHeight: number): number {
  return delta * (mode === 1 ? 16 : mode === 2 ? pageHeight : 1)
}

// The fixed overlay needs explicit page handoff: Chromium does not reliably
// chain its wheel input, including when the tooltip has no scroll range at all.
export function tooltipWheelIntent(input: TooltipWheelInput, state: TooltipScrollState): TooltipWheelIntent {
  if (input.shiftKey || input.ctrlKey || input.metaKey || Math.abs(input.deltaX) >= Math.abs(input.deltaY)) return { kind: 'native' }
  const page = (): TooltipWheelIntent => state.direct
    ? { kind: 'page', delta: wheelPixels(input.deltaY, input.deltaMode, state.pageHeight) }
    : { kind: 'native' }
  const maximum = Math.max(0, state.scrollHeight - state.height)
  if (maximum === 0) return page()
  const atBoundary = input.deltaY < 0 ? state.top <= 1 : state.top >= maximum - 1
  if (atBoundary) return state.boundary === 'contain' ? { kind: 'contain' } : page()

  // Accumulate a burst in its current direction. Reversal starts at the visible
  // position so an unfinished downward animation cannot swallow upward input.
  const target = state.target !== null && (state.target - state.top) * input.deltaY >= 0 ? state.target : state.top
  if (input.deltaY < 0 ? target <= 0 : target >= maximum) return { kind: 'pending' }
  return { kind: 'tooltip', top: Math.max(0, Math.min(maximum, target + wheelPixels(input.deltaY, input.deltaMode, state.height))) }
}
