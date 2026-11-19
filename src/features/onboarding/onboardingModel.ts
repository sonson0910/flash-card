/**
 * The branched onboarding journey: native/UI language, the language to learn,
 * an optional goal, the exam or level details with a countdown to its date,
 * daily pace, a 5-card flashcard trial, then the reminder choice. Every step
 * here is a pure, orderable id — the actual UI in `OnboardingJourney.tsx`
 * reads this array instead of hard-coding "what's next", so step order
 * changes never need to touch branching logic twice.
 */
export const ONBOARDING_STEPS = [
  'language',
  'target',
  'goal',
  'exam',
  'pace',
  'aha',
  'reminder',
] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

/**
 * The exam step holds the chosen goal's score, level and date, so a learner
 * without a goal never sees it and it drops out of the progress count.
 */
export const onboardingStepsFor = (hasGoal: boolean): readonly OnboardingStepId[] =>
  hasGoal ? ONBOARDING_STEPS : ONBOARDING_STEPS.filter(step => step !== 'exam');

export const firstOnboardingStep = (): OnboardingStepId => ONBOARDING_STEPS[0];

export const nextOnboardingStep = (
  current: OnboardingStepId,
  steps: readonly OnboardingStepId[] = ONBOARDING_STEPS,
): OnboardingStepId | null => {
  const index = steps.indexOf(current);
  return index >= 0 && index < steps.length - 1 ? steps[index + 1] : null;
};

export const previousOnboardingStep = (
  current: OnboardingStepId,
  steps: readonly OnboardingStepId[] = ONBOARDING_STEPS,
): OnboardingStepId | null => {
  const index = steps.indexOf(current);
  return index > 0 ? steps[index - 1] : null;
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

const DAY_MS = 24 * 60 * 60 * 1000;

const localDayNumber = (year: number, monthIndex: number, day: number) =>
  Math.round(Date.UTC(year, monthIndex, day) / DAY_MS);

/**
 * Whole calendar days from `today` (the learner's local date) to an ISO
 * `YYYY-MM-DD` goal date; null when the date is missing or malformed.
 * Negative once the date has passed.
 */
export const daysUntilGoalDate = (isoDate: string, today: Date = new Date()): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const parsed = new Date(year, month, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month || parsed.getDate() !== day) return null;
  return localDayNumber(year, month, day) - localDayNumber(today.getFullYear(), today.getMonth(), today.getDate());
};

/** The countdown's week strip: at most 12 weeks, the last one being the exam week. */
export const MAX_COUNTDOWN_WEEKS = 12;

export const countdownWeeks = (days: number): number => Math.max(1, Math.ceil(days / 7));
