import assert from 'node:assert/strict'
import { createNotificationService } from '../src/renderer/src/notification-service.ts'

class FakeScheduler {
  timers = new Map()
  nextId = 1
  setTimeout(callback) {
    const id = this.nextId++
    this.timers.set(id, callback)
    return id
  }
  clearTimeout(id) { this.timers.delete(id) }
  fireFirst() {
    const [id, callback] = this.timers.entries().next().value ?? []
    if (!callback) return
    this.timers.delete(id)
    callback()
  }
}

const scheduler = new FakeScheduler()
const notifications = createNotificationService(scheduler)

notifications.notify({
  key: 'recovery',
  title: 'Recovery',
  message: 'Audit required',
  severity: 'warning',
  timeoutMs: null,
  dismissible: false,
  action: { id: 'open-recovery', label: 'Review', dismisses: false }
})
assert.equal(notifications.current.value?.key, 'recovery')
assert.deepEqual(notifications.current.value?.action, { id: 'open-recovery', label: 'Review', dismisses: false })

notifications.notify({ key: 'success', title: 'Done', message: 'First item arrived', severity: 'success' })
assert.equal(notifications.current.value?.key, 'success', 'new feedback should temporarily preempt a persistent recovery reminder')
assert.equal(scheduler.timers.size, 1)

const firstAnnouncement = notifications.announcement.value?.id
notifications.notify({ key: 'success', title: 'Done', message: 'Second item arrived', severity: 'success' })
assert.equal(notifications.current.value?.message, 'Second item arrived')
assert.ok((notifications.announcement.value?.id ?? 0) > (firstAnnouncement ?? 0), 'changed coalesced content is announced once')
assert.equal(scheduler.timers.size, 1, 'coalescing resets rather than stacks timers')

const unchangedAnnouncement = notifications.announcement.value?.id
notifications.notify({ key: 'success', title: 'Done', message: 'Second item arrived', severity: 'success' })
assert.equal(notifications.announcement.value?.id, unchangedAnnouncement, 'identical repeats are not announced twice')

scheduler.fireFirst()
assert.equal(notifications.current.value?.key, 'recovery', 'persistent recovery reminder returns after transient feedback')

notifications.notify({ key: 'transfer', title: 'Transfer problem', message: 'Receipt mismatch', severity: 'error' })
assert.equal(notifications.current.value?.key, 'transfer')
assert.equal(scheduler.timers.size, 0, 'errors persist until dismissal by default')
assert.equal(notifications.announcement.value?.assertive, true)

notifications.dismiss()
assert.equal(notifications.current.value?.key, 'recovery')
notifications.dismissByKey('recovery')
assert.equal(notifications.current.value, null)

notifications.notify({ key: 'later-success', title: 'Done', message: 'Queued work completed', severity: 'success' })
notifications.notify({ key: 'urgent-error', title: 'Transfer problem', message: 'Write is blocked', severity: 'error' })
assert.equal(notifications.current.value?.key, 'urgent-error', 'errors preempt lower-severity feedback')
notifications.dismiss()
assert.equal(notifications.current.value?.key, 'later-success')

console.log(JSON.stringify({
  passed: true,
  oneVisibleAtATime: true,
  coalescing: true,
  persistentFailures: true,
  severityPreemption: true,
  recoveryPreemption: true,
  announcements: 'deduplicated'
}, null, 2))
