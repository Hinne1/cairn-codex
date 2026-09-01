export const ONBOARDING_VERSION = 1
export const ONBOARDING_STEP_COUNT = 4

export type OnboardingStatus = 'in-progress' | 'skipped' | 'completed'

export interface OnboardingPreference {
  status: OnboardingStatus
  step: number
  shouldOpen: boolean
}

export interface ContinueWithoutImportDecision {
  collectionBasis: 'archive'
  onboarding: OnboardingPreference
}

export interface ContinueWithoutImportEffects {
  updateCollectionBasis: (basis: 'archive') => void
  updateOnboarding: (preference: OnboardingPreference) => void
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

/**
 * Projects the only state changes made by the no-import onboarding path.
 *
 * Keeping this decision pure is intentional: choosing not to import cannot be
 * given an archive, stash, save, database, filesystem, or IPC capability.
 */
export function continueWithoutImportDecision(): ContinueWithoutImportDecision {
  return {
    collectionBasis: 'archive',
    onboarding: onboardingPreference('in-progress', 2)
  }
}

export function applyContinueWithoutImport(
  effects: ContinueWithoutImportEffects
): ContinueWithoutImportDecision {
  const decision = continueWithoutImportDecision()
  effects.updateCollectionBasis(decision.collectionBasis)
  effects.updateOnboarding(decision.onboarding)
  return decision
}

