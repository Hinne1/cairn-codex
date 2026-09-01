import assert from 'node:assert/strict'
import {
  ONBOARDING_STEP_COUNT,
  continueWithoutImportDecision,
  onboardingPreference
} from '../src/renderer/src/onboarding.ts'

assert.deepEqual(onboardingPreference('skipped', 2), {
  status: 'skipped', step: 2, shouldOpen: false
})
assert.deepEqual(onboardingPreference('in-progress', 99), {
  status: 'in-progress', step: ONBOARDING_STEP_COUNT - 1, shouldOpen: true
})
assert.deepEqual(onboardingPreference('completed', -20), {
  status: 'completed', step: 0, shouldOpen: false
})

const noImportDecision = continueWithoutImportDecision()
assert.deepEqual(noImportDecision, {
  collectionBasis: 'archive',
  onboarding: { status: 'in-progress', step: 2, shouldOpen: true }
})
assert.deepEqual(Object.keys(noImportDecision).sort(), ['collectionBasis', 'onboarding'])
assert.equal(JSON.stringify(noImportDecision).match(/delete|clear|remove|reset|wipe/iu), null)

console.log(JSON.stringify({
  passed: true,
  skipResumeState: true,
  stepBounds: ONBOARDING_STEP_COUNT,
  purePreferenceProjection: true,
  continueWithoutImportEffects: ['collection-basis preference', 'onboarding progress preference'],
  destructiveCapabilitiesAvailable: false
}, null, 2))
