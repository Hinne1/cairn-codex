import { nextTick, onBeforeUnmount, type Ref } from 'vue'

const MODAL_FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

export interface ModalDialogFocusOptions {
  initialFocus?: () => HTMLElement | null
  restoreFocus?: () => HTMLElement | null
  restoreFallback?: () => HTMLElement | null
  onEscape?: () => void
}

export interface ModalDialogFocus {
  activate: () => void
  deactivate: (restore?: boolean) => void
  handleKeydown: (event: KeyboardEvent) => void
}

export function nextModalFocusTarget<T>(
  root: T,
  controls: readonly T[],
  active: T | null,
  backwards: boolean
): T | null {
  if (controls.length === 0) return root
  const first = controls[0]!
  const last = controls[controls.length - 1]!
  const activeIndex = active === null ? -1 : controls.indexOf(active)
  if (backwards && (active === root || activeIndex <= 0)) return last
  if (!backwards && (active === root || activeIndex < 0 || activeIndex === controls.length - 1)) return first
  return null
}

export function isModalHistoryShortcut(event: Pick<KeyboardEvent, 'altKey' | 'key'>): boolean {
  return event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
}

export function connectedModalFocusTarget<T extends { isConnected: boolean }>(
  target: T | null,
  fallback: T | null
): T | null {
  if (target?.isConnected) return target
  return fallback?.isConnected ? fallback : null
}

export function modalFocusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR)]
    .filter((element) => (
      !element.hidden &&
      element.getAttribute('aria-hidden') !== 'true' &&
      !element.closest('[inert]') &&
      (element.offsetParent !== null || element === document.activeElement)
    ))
}

function defaultRestoreFallback(): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>([
    '.history-nav button:not([disabled])',
    '.workspace-sidebar button:not([disabled])',
    'main button:not([disabled])',
    'main a[href]',
    'main input:not([disabled]):not([type="hidden"])',
    'main select:not([disabled])',
    'main [tabindex]:not([tabindex="-1"])'
  ].join(', '))].find((element) => (
    element.offsetParent !== null &&
    !element.closest('[inert]')
  )) ?? null
}

export function useModalDialogFocus(
  root: Ref<HTMLElement | null>,
  options: ModalDialogFocusOptions = {}
): ModalDialogFocus {
  let active = false
  let previouslyFocused: HTMLElement | null = null
  let observer: MutationObserver | null = null

  function focusInitial(): void {
    const dialog = root.value
    if (!active || !dialog) return
    const target = options.initialFocus?.() ?? dialog
    target.focus({ preventScroll: true })
  }

  function repairFocus(): void {
    const dialog = root.value
    if (!active || !dialog?.isConnected) return
    const focused = document.activeElement
    if (focused instanceof HTMLElement && dialog.contains(focused) &&
      !focused.matches(':disabled') && !focused.closest('[hidden], [inert]') && focused.getClientRects().length) return
    const target = options.initialFocus?.() ?? modalFocusableElements(dialog)[0] ?? dialog
    target.focus()
  }

  function retainFocus(): void { repairFocus() }

  function activate(): void {
    if (active) return
    previouslyFocused = options.restoreFocus?.() ?? (
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body && document.activeElement !== document.documentElement
        ? document.activeElement : null
    )
    active = true
    document.addEventListener('focusin', retainFocus, true)
    void nextTick(() => {
      focusInitial()
      if (!active || !root.value) return
      // Removing a focused control does not emit focusin. Repair after Vue's DOM
      // update without replacing the original dialog invoker.
      observer = new MutationObserver(repairFocus)
      observer.observe(root.value, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['disabled', 'hidden', 'inert', 'open'] })
    })
  }

  function deactivate(restore = true): void {
    if (!active && !previouslyFocused) return
    active = false
    observer?.disconnect()
    observer = null
    document.removeEventListener('focusin', retainFocus, true)
    const target = options.restoreFocus?.() ?? previouslyFocused
    previouslyFocused = null
    if (restore) void nextTick(() => {
      const fallback = options.restoreFallback?.() ?? defaultRestoreFallback()
      connectedModalFocusTarget(target, fallback)?.focus({ preventScroll: true })
    })
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (isModalHistoryShortcut(event)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key === 'Escape' && options.onEscape) {
      event.preventDefault()
      event.stopPropagation()
      options.onEscape()
      return
    }
    if (event.key !== 'Tab' || !root.value) return
    const target = nextModalFocusTarget(
      root.value,
      modalFocusableElements(root.value),
      document.activeElement instanceof HTMLElement ? document.activeElement : null,
      event.shiftKey
    )
    if (!target) return
    event.preventDefault()
    target.focus()
  }

  onBeforeUnmount(() => deactivate())

  return { activate, deactivate, handleKeydown }
}
