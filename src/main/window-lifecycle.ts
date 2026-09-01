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
