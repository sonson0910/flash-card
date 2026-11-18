/**
 * The branched onboarding journey: native/UI language, target language, an
 * optional goal, daily pace, a 5-card "aha" moment, then the reminder choice.
 * Every step here is a pure, orderable id — the actual UI in
 * `OnboardingJourney.tsx` reads this array instead of hard-coding "what's
 * next", so step order changes never need to touch branching logic twice.
 */
export const ONBOARDING_STEPS = [
  'language',
  'target',
  'goal',
  'pace',
  'aha',
  'reminder',
] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

export const firstOnboardingStep = (): OnboardingStepId => ONBOARDING_STEPS[0];

export const nextOnboardingStep = (current: OnboardingStepId): OnboardingStepId | null => {
  const index = ONBOARDING_STEPS.indexOf(current);
  return index >= 0 && index < ONBOARDING_STEPS.length - 1 ? ONBOARDING_STEPS[index + 1] : null;
};

export const previousOnboardingStep = (current: OnboardingStepId): OnboardingStepId | null => {
  const index = ONBOARDING_STEPS.indexOf(current);
  return index > 0 ? ONBOARDING_STEPS[index - 1] : null;
};

export const isOnboardingStepId = (value: unknown): value is OnboardingStepId =>
  typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value);

/** The course profile remains the authority for whether onboarding is needed. */
const resumeKey = (ownerId: string) => `sonflash_onboarding_step_v1_${ownerId}`;
const inProgressKey = (ownerId: string) => `sonflash_onboarding_started_v1_${ownerId}`;

type ResumeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const getStorage = (): ResumeStorage | null => {
  try { return globalThis.localStorage; } catch { return null; }
};

export const hasOnboardingInProgress = (
  ownerId: string,
  storage: Pick<ResumeStorage, 'getItem'> | null = getStorage(),
): boolean => {
  try { return storage?.getItem(inProgressKey(ownerId)) === '1'; } catch { return false; }
};

export const markOnboardingInProgress = (
  ownerId: string,
  storage: Pick<ResumeStorage, 'setItem'> | null = getStorage(),
): void => {
  try { storage?.setItem(inProgressKey(ownerId), '1'); } catch { /* current session can still finish */ }
};

export const clearOnboardingInProgress = (
  ownerId: string,
  storage: Pick<ResumeStorage, 'removeItem'> | null = getStorage(),
): void => {
  try { storage?.removeItem(inProgressKey(ownerId)); } catch { /* course profile is authoritative */ }
};

export const readOnboardingResumeStep = (
  ownerId: string,
  storage: Pick<ResumeStorage, 'getItem'> | null = getStorage(),
): OnboardingStepId => {
  try {
    const raw = storage?.getItem(resumeKey(ownerId));
    return isOnboardingStepId(raw) ? raw : firstOnboardingStep();
  } catch {
    return firstOnboardingStep();
  }
};

export const writeOnboardingResumeStep = (
  ownerId: string,
  step: OnboardingStepId,
  storage: Pick<ResumeStorage, 'setItem'> | null = getStorage(),
): void => {
  try { storage?.setItem(resumeKey(ownerId), step); } catch { /* resume just restarts from step one */ }
};

export const clearOnboardingResumeStep = (
  ownerId: string,
  storage: Pick<ResumeStorage, 'removeItem'> | null = getStorage(),
): void => {
  try { storage?.removeItem(resumeKey(ownerId)); } catch { /* nothing left to clear */ }
};
