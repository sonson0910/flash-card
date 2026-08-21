export const LANDING_QUICK_START_INTENT = 'landing-quick-start' as const;
export const LANDING_QUICK_START_MAX_LENGTH = 80;

export interface LandingQuickStartIntent {
  readonly type: typeof LANDING_QUICK_START_INTENT;
  readonly initialDraft: string;
}

export interface LandingQuickStartDestination {
  changeDraft(value: string): void;
  openLibrary(): void;
}

export type LandingQuickStartHandler = (intent: LandingQuickStartIntent) => void;

export const normalizeLandingQuickStartWord = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const createLandingQuickStartIntent = (
  value: unknown,
): LandingQuickStartIntent | null => {
  const initialDraft = normalizeLandingQuickStartWord(value);
  return initialDraft
    && initialDraft.length <= LANDING_QUICK_START_MAX_LENGTH
    ? { type: LANDING_QUICK_START_INTENT, initialDraft }
    : null;
};

export const submitLandingQuickStart = (
  value: unknown,
  onQuickStart: LandingQuickStartHandler,
): boolean => {
  const intent = createLandingQuickStartIntent(value);
  if (!intent) return false;
  onQuickStart(intent);
  return true;
};

export const applyLandingQuickStartIntent = (
  intent: LandingQuickStartIntent | null,
  destination: LandingQuickStartDestination,
): boolean => {
  if (!intent?.initialDraft) return false;
  destination.changeDraft(intent.initialDraft);
  destination.openLibrary();
  return true;
};
