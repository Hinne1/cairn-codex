// Layout changes can synthesize mouseenter when a tooltip uncovers its source.
// Re-arm hover only after the pointer changes position or focus moves elsewhere.
export function createTooltipDismissal() {
  let dismissed = false
  let pointer: { x: number; y: number } | null = null
  let pending: { source: HTMLElement; resume: () => void } | null = null

  function reset(): void {
    dismissed = false
    pending = null
  }

  function moved(event: MouseEvent): boolean {
    return pointer === null || pointer.x !== event.clientX || pointer.y !== event.clientY
  }

  function remember(event: MouseEvent): void {
    pointer = { x: event.clientX, y: event.clientY }
  }

  return {
    dismiss(): void {
      dismissed = true
      pending = null
    },
    focusChanged: reset,
    cancelHover(): void {
      pending = null
    },
    allowHover(event: MouseEvent, resume: (source: HTMLElement) => void): boolean {
      if (moved(event)) reset()
      remember(event)
      if (!dismissed) return true
      const source = event.currentTarget
      if (source instanceof HTMLElement) pending = { source, resume: () => resume(source) }
      return false
    },
    pointerMoved(event: PointerEvent): void {
      const changed = moved(event)
      remember(event)
      if (!dismissed || !changed) return
      const request = pending
      reset()
      if (request?.source.isConnected && event.target instanceof Node && request.source.contains(event.target)) {
        request.resume()
      }
    }
  }
}
