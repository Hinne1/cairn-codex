export const ONBOARDING_VERSION = 1
export const ONBOARDING_STEP_COUNT = 4

export type OnboardingStatus = 'in-progress' | 'skipped' | 'completed'

export interface OnboardingPreference {
  status: OnboardingStatus
  step: number
  shouldOpen: boolean
}

function boundedStep(value: unknown): number {
  const parsed = Number(value)
  return Number.isInteger(parsed)
    ? Math.max(0, Math.min(ONBOARDING_STEP_COUNT - 1, parsed))
    : 0
}

export function onboardingPreference(
  status: OnboardingStatus,
  step: number
): OnboardingPreference {
  const bounded = boundedStep(step)
  return { status, step: bounded, shouldOpen: status === 'in-progress' }
}

