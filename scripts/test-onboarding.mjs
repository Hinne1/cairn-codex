import assert from 'node:assert/strict'
import {
  ONBOARDING_STEP_COUNT,
  readOnboardingPreference,
  writeOnboardingPreference
} from '../src/renderer/src/onboarding.ts'

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
}

const fresh = new MemoryStorage()
assert.deepEqual(readOnboardingPreference(fresh), {
  status: 'in-progress', step: 0, shouldOpen: true
})

assert.deepEqual(writeOnboardingPreference(fresh, 'skipped', 2), {
  status: 'skipped', step: 2, shouldOpen: false
})
assert.deepEqual(readOnboardingPreference(fresh), {
  status: 'skipped', step: 2, shouldOpen: false
})

assert.deepEqual(writeOnboardingPreference(fresh, 'in-progress', 99), {
  status: 'in-progress', step: ONBOARDING_STEP_COUNT - 1, shouldOpen: true
})
assert.deepEqual(writeOnboardingPreference(fresh, 'completed', -20), {
  status: 'completed', step: 0, shouldOpen: false
})

fresh.setItem('cairn-codex-onboarding-version', '0')
fresh.setItem('cairn-codex-onboarding-status', 'completed')
assert.deepEqual(readOnboardingPreference(fresh), {
  status: 'in-progress', step: 0, shouldOpen: true
})

console.log(JSON.stringify({
  passed: true,
  freshProfileOpens: true,
  skipResumeState: true,
  stepBounds: ONBOARDING_STEP_COUNT,
  versionReset: true
}, null, 2))
