import { COURSE_NATIVE_LANGUAGES, COURSE_TARGET_LANGUAGES, type CourseNativeLanguage, type CourseTargetLanguage } from '../courses/courseModel';
import { goalKindsFor } from '../courses/courseGoalCatalog';
import { isDailyPace, type DailyPace } from '../settings/dailyPacePreference';

export interface OnboardingDraft {
  readonly nativeLanguage: CourseNativeLanguage;
  readonly targetLanguage: CourseTargetLanguage | null;
  readonly goalKind: string | null;
  readonly goalLevel: string;
  readonly goalTargetDate: string;
  readonly zhScript: 'hans' | 'hant' | null;
  readonly pace: DailyPace;
}

const draftKey = (ownerId: string) => `sonflash_onboarding_draft_v1_${ownerId}`;
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const getStorage = (): DraftStorage | null => {
  try { return globalThis.localStorage; } catch { return null; }
};

export const readOnboardingDraft = (
  ownerId: string,
  storage: Pick<DraftStorage, 'getItem'> | null = getStorage(),
): OnboardingDraft | null => {
  try {
    const raw = storage?.getItem(draftKey(ownerId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const draft = value as Record<string, unknown>;
    if (!COURSE_NATIVE_LANGUAGES.includes(draft.nativeLanguage as CourseNativeLanguage)
      || (draft.targetLanguage !== null && !COURSE_TARGET_LANGUAGES.includes(draft.targetLanguage as CourseTargetLanguage))
      || (draft.targetLanguage !== null && draft.targetLanguage === draft.nativeLanguage)
      || (draft.goalKind !== null && (typeof draft.goalKind !== 'string' || draft.goalKind.length > 64))
      || (draft.goalKind !== null && (draft.targetLanguage === null
        || !goalKindsFor(draft.targetLanguage as CourseTargetLanguage).some(goal => goal.kind === draft.goalKind)))
      || typeof draft.goalLevel !== 'string' || draft.goalLevel.length > 32
      || typeof draft.goalTargetDate !== 'string' || draft.goalTargetDate.length > 10
      || (draft.zhScript !== null && draft.zhScript !== 'hans' && draft.zhScript !== 'hant')
      || !isDailyPace(draft.pace)) return null;
    return draft as unknown as OnboardingDraft;
  } catch { return null; }
};

export const writeOnboardingDraft = (
  ownerId: string,
  draft: OnboardingDraft,
  storage: Pick<DraftStorage, 'setItem'> | null = getStorage(),
): void => {
  try { storage?.setItem(draftKey(ownerId), JSON.stringify(draft)); } catch { /* resume falls back to target choice */ }
};

export const clearOnboardingDraft = (
  ownerId: string,
  storage: Pick<DraftStorage, 'removeItem'> | null = getStorage(),
): void => {
  try { storage?.removeItem(draftKey(ownerId)); } catch { /* no saved draft to rely on */ }
};
