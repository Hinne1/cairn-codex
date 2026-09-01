import { shallowRef, type ShallowRef } from 'vue'

export type NotificationSeverity = 'success' | 'info' | 'warning' | 'error'

export interface NotificationAction {
  id: string
  label: string
  dismisses?: boolean
}

export interface NotificationRequest {
  key: string
  title: string
  message: string
  severity: NotificationSeverity
  timeoutMs?: number | null
  dismissible?: boolean
  action?: NotificationAction | null
}

export interface AppNotification extends NotificationRequest {
  id: number
  timeoutMs: number | null
  dismissible: boolean
}

export interface NotificationAnnouncement {
  id: number
  text: string
  assertive: boolean
}

export interface NotificationScheduler {
  setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>
  clearTimeout(timer: ReturnType<typeof setTimeout>): void
}

export interface NotificationService {
  current: ShallowRef<AppNotification | null>
  announcement: ShallowRef<NotificationAnnouncement | null>
  notify(request: NotificationRequest): number
  dismiss(id?: number): void
  dismissByKey(key: string): void
  clear(): void
}

function defaultTimeout(severity: NotificationSeverity): number | null {
  if (severity === 'success' || severity === 'info') return 7_000
  if (severity === 'warning') return 12_000
  return null
}

function severityPriority(severity: NotificationSeverity): number {
  return { success: 1, info: 2, warning: 3, error: 4 }[severity]
}

export function createNotificationService(
  scheduler: NotificationScheduler = {
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: (timer) => clearTimeout(timer)
  }
): NotificationService {
  const current = shallowRef<AppNotification | null>(null)
  const announcement = shallowRef<NotificationAnnouncement | null>(null)
  let queue: AppNotification[] = []
  let activeTimer: ReturnType<typeof setTimeout> | null = null
  let nextId = 1
  let nextAnnouncementId = 1

  function cancelTimer(): void {
    if (activeTimer) scheduler.clearTimeout(activeTimer)
    activeTimer = null
  }

  function announce(notification: AppNotification): void {
    announcement.value = {
      id: nextAnnouncementId++,
      text: `${notification.title}. ${notification.message}`,
      assertive: notification.severity === 'error'
    }
  }

  function schedule(notification: AppNotification): void {
    cancelTimer()
    if (notification.timeoutMs === null) return
    activeTimer = scheduler.setTimeout(() => dismiss(notification.id), notification.timeoutMs)
  }

  function activate(notification: AppNotification): void {
    current.value = notification
    announce(notification)
    schedule(notification)
  }

  function activateNext(): void {
    const next = queue.shift() ?? null
    current.value = null
    if (next) activate(next)
  }

  function normalize(request: NotificationRequest, id = nextId++): AppNotification {
    return {
      ...request,
      id,
      timeoutMs: request.timeoutMs === undefined ? defaultTimeout(request.severity) : request.timeoutMs,
      dismissible: request.dismissible ?? true,
      action: request.action ?? null
    }
  }

  function notify(request: NotificationRequest): number {
    if (current.value?.key === request.key) {
      const previous = current.value
      const updated = normalize(request, previous.id)
      const changed = previous.title !== updated.title || previous.message !== updated.message
      current.value = updated
      if (changed) announce(updated)
      schedule(updated)
      return updated.id
    }

    const queuedIndex = queue.findIndex((notification) => notification.key === request.key)
    if (queuedIndex >= 0) {
      const queued = queue[queuedIndex]!
      const updated = normalize(request, queued.id)
      queue.splice(queuedIndex, 1, updated)
      return updated.id
    }

    const notification = normalize(request)
    if (!current.value) {
      activate(notification)
    } else if (!current.value.dismissible) {
      cancelTimer()
      queue.unshift(current.value)
      activate(notification)
    } else if (severityPriority(notification.severity) > severityPriority(current.value.severity)) {
      cancelTimer()
      queue.unshift(current.value)
      activate(notification)
    } else {
      queue.push(notification)
    }
    return notification.id
  }

  function dismiss(id = current.value?.id): void {
    if (id === undefined) return
    if (current.value?.id === id) {
      cancelTimer()
      activateNext()
      return
    }
    queue = queue.filter((notification) => notification.id !== id)
  }

  function dismissByKey(key: string): void {
    if (current.value?.key === key) {
      dismiss(current.value.id)
      return
    }
    queue = queue.filter((notification) => notification.key !== key)
  }

  function clear(): void {
    cancelTimer()
    queue = []
    current.value = null
    announcement.value = null
  }

  return { current, announcement, notify, dismiss, dismissByKey, clear }
}
