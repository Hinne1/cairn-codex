export const ONBOARDING_VERSION = 1
export const ONBOARDING_STEP_COUNT = 4

const versionKey = 'cairn-codex-onboarding-version'
const statusKey = 'cairn-codex-onboarding-status'
const stepKey = 'cairn-codex-onboarding-step'

export type OnboardingStatus = 'in-progress' | 'skipped' | 'completed'

export interface OnboardingPreference {
  status: OnboardingStatus
  step: number
  shouldOpen: boolean
}

export interface OnboardingStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function boundedStep(value: unknown): number {
  const parsed = Number(value)
  return Number.isInteger(parsed)
    ? Math.max(0, Math.min(ONBOARDING_STEP_COUNT - 1, parsed))
    : 0
}

export function readOnboardingPreference(storage: OnboardingStorage): OnboardingPreference {
  const version = Number(storage.getItem(versionKey))
  if (version !== ONBOARDING_VERSION) {
    const preference: OnboardingPreference = { status: 'in-progress', step: 0, shouldOpen: true }
    writeOnboardingPreference(storage, preference.status, preference.step)
    return preference
  }
  const storedStatus = storage.getItem(statusKey)
  const status: OnboardingStatus = storedStatus === 'completed' || storedStatus === 'skipped'
    ? storedStatus
    : 'in-progress'
  const step = boundedStep(storage.getItem(stepKey))
  return { status, step, shouldOpen: status === 'in-progress' }
}

export function writeOnboardingPreference(
  storage: OnboardingStorage,
  status: OnboardingStatus,
  step: number
): OnboardingPreference {
  const bounded = boundedStep(step)
  storage.setItem(versionKey, String(ONBOARDING_VERSION))
  storage.setItem(statusKey, status)
  storage.setItem(stepKey, String(bounded))
  return { status, step: bounded, shouldOpen: status === 'in-progress' }
}

