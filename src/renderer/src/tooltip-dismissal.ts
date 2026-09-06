// Layout changes can synthesize mouseenter when a tooltip uncovers its source.
// Re-arm hover only after the pointer changes position or focus moves elsewhere.
export function createTooltipDismissal() {
  let dismissed = false
  let pointer: { x: number; y: number } | null = null
  let hovered: { source: HTMLElement; resume: (event: PointerEvent) => void } | null = null

  function reset(): void {
    dismissed = false
  }

  function moved(event: PointerEvent): boolean {
    return pointer === null || pointer.x !== event.clientX || pointer.y !== event.clientY
  }

  function remember(event: PointerEvent): void {
    pointer = { x: event.clientX, y: event.clientY }
  }

  return {
    dismiss(): void {
      dismissed = true
    },
    focusChanged: reset,
    cancelHover(): void {
      hovered = null
    },
    allowHover(event: MouseEvent, resume: (event: PointerEvent) => void): boolean {
      // Only pointermove establishes movement. Compatibility mouseenter can round
      // fractional pointer coordinates and can also fire without physical movement.
      const source = event.currentTarget
      if (source instanceof HTMLElement) hovered = { source, resume }
      return !dismissed
    },
    pointerMoved(event: PointerEvent): void {
      const changed = moved(event)
      remember(event)
      if (!dismissed || !changed) return
      const request = hovered
      reset()
      if (request?.source.isConnected && event.target instanceof Node && request.source.contains(event.target)) {
        request.resume(event)
      } else {
        hovered = null
      }
    }
  }
}
