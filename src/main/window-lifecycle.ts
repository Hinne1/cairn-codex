export interface LifecycleWindow {
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

export interface LifecycleApp {
  on(event: 'second-instance', listener: () => void): void
  on(event: 'activate', listener: () => void): void
  on(event: 'window-all-closed', listener: () => void): void
  on(event: 'before-quit', listener: (event: { preventDefault(): void }) => void): void
  quit(): void
}

export interface WindowLifecycleDependencies {
  app: LifecycleApp
  getWindows(): LifecycleWindow[]
  createWindow(): Promise<void>
  platform: NodeJS.Platform
}

export type WindowPlacementEvent = 'moved' | 'resized' | 'maximize' | 'unmaximize' | 'close'

export interface WindowPlacementSource {
  on(event: WindowPlacementEvent, listener: () => void): void
}

export interface WindowStatePersistence {
  flush(): Promise<void>
  finalize(): Promise<void>
}

/**
 * Persists placement only after a native move/resize gesture has completed.
 * Windows emits `move`/`resize` continuously while the user drags, so doing
 * timer or filesystem work from those events can make the native gesture
 * stutter. Requests which arrive during an active write are coalesced into one
 * final write of the newest window state.
 */
export function registerWindowStatePersistence<T>(
  window: WindowPlacementSource,
  capture: () => T,
  persist: (state: T) => Promise<void>,
  onFailure: (error: unknown) => void
): WindowStatePersistence {
  let pending: T | undefined
  let hasPending = false
  let active: Promise<void> | null = null
  let closeObserved = false
  let sealed = false

  const drain = (): void => {
    if (active) return
    active = (async () => {
      while (hasPending) {
        const state = pending as T
        pending = undefined
        hasPending = false
        await persist(state)
      }
    })()
      .catch(onFailure)
      .finally(() => {
        active = null
        if (hasPending) drain()
      })
  }

  const request = (): void => {
    if (sealed) return
    try {
      pending = capture()
      hasPending = true
      drain()
    } catch (error) {
      onFailure(error)
    }
  }

  for (const event of ['moved', 'resized', 'maximize', 'unmaximize'] as const) {
    window.on(event, request)
  }
  window.on('close', () => {
    closeObserved = true
    request()
  })

  return {
    async flush(): Promise<void> {
      while (active) await active
    },
    async finalize(): Promise<void> {
      if (!sealed) {
        if (!closeObserved) request()
        sealed = true
      }
      while (active) await active
    }
  }
}

export function registerPrimaryWindowLifecycle(
  dependencies: WindowLifecycleDependencies,
  singleInstance: boolean
): void {
  const { app, getWindows } = dependencies
  if (singleInstance) {
    app.on('second-instance', () => {
      const window = getWindows()[0]
      if (!window) return
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    })
  }
  app.on('activate', () => {
    if (getWindows().length === 0) void dependencies.createWindow()
  })
  app.on('window-all-closed', () => {
    if (dependencies.platform !== 'darwin') app.quit()
  })
}

export function registerManagedShutdown(
  app: LifecycleApp,
  shutdown: () => Promise<void>,
  onFailure: (error: unknown) => void
): void {
  let shutdownReady = false
  let shutdownStarted = false
  app.on('before-quit', (event) => {
    if (shutdownReady) return
    event.preventDefault()
    if (shutdownStarted) return
    shutdownStarted = true
    void shutdown()
      .catch(onFailure)
      .finally(() => {
        shutdownReady = true
        app.quit()
      })
  })
}
