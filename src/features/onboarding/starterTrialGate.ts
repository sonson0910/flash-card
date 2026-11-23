import { ProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import { COURSE_NATIVE_LANGUAGES, COURSE_TARGET_LANGUAGES, type CourseNativeLanguage, type CourseTargetLanguage } from '../courses/courseModel';
import type { StarterCardOutcome } from './createStarterCards';

export type StarterTrialResult = StarterCardOutcome | 'already-added';

/** Where the gate keeps the target it wrote starter cards for, so a reload of the same setup still sees it. */
export interface StarterClaimStore {
  read(): CourseTargetLanguage | null;
  write(target: CourseTargetLanguage | null): void;
}

type ClaimStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const claimKey = (ownerId: string) => `sonflash_onboarding_starter_claim_v1_${ownerId}`;
const languageKey = (ownerId: string) => `sonflash_onboarding_starter_language_v1_${ownerId}`;
const getStorage = (): ClaimStorage | null => {
  try { return globalThis.localStorage; } catch { return null; }
};

export const starterClaimStore = (ownerId: string, storage: ClaimStorage | null = getStorage()): StarterClaimStore => ({
  read: () => {
    try {
      const value = storage?.getItem(claimKey(ownerId));
      return COURSE_TARGET_LANGUAGES.find(language => language === value) ?? null;
    } catch { return null; }
  },
  write: target => {
    try {
      if (target === null) storage?.removeItem(claimKey(ownerId));
      else storage?.setItem(claimKey(ownerId), target);
    } catch { /* the claim then lasts for this page load only */ }
  },
});

/** The native language the first starter batch was written with, kept beside the claim for the same setup. */
export const starterMeaningsLanguageStore = (ownerId: string, storage: ClaimStorage | null = getStorage()) => {
  const read = (): CourseNativeLanguage | null => {
    try {
      const value = storage?.getItem(languageKey(ownerId));
      return COURSE_NATIVE_LANGUAGES.find(language => language === value) ?? null;
    } catch { return null; }
  };
  return {
    read,
    /** Keeps the language of the first batch; a later batch in another language does not replace it. */
    rememberFirst: (language: CourseNativeLanguage): CourseNativeLanguage => {
      const earlier = read();
      if (earlier !== null) return earlier;
      try { storage?.setItem(languageKey(ownerId), language); } catch { /* the language then lasts for this page load only */ }
      return language;
    },
  };
};

export const clearStarterClaim = (ownerId: string, storage: ClaimStorage | null = getStorage()): void => {
  starterClaimStore(ownerId, storage).write(null);
  try { storage?.removeItem(languageKey(ownerId)); } catch { /* nothing to clear */ }
};

// A refusal the server or the client raised before any card was written. Anything else, a lost reply
// or an unreadable one, may still have committed the batch, so the claim stays.
const wroteNothing = (error: unknown): boolean =>
  error instanceof ProtectedFunctionError
  && (error.kind === 'authentication' || error.kind === 'permission' || error.kind === 'configuration' || error.kind === 'quota');

/**
 * Lets one onboarding write starter cards for a single target language. Each target has its own
 * operation id, so a second target would reserve the monthly AI-card quota again and leave the
 * first batch outside the course the learner finishes with. Asking again for the same target is
 * allowed because the server replays that operation without spending quota. A batch that was
 * refused or wrote nothing does not hold the claim; a batch whose outcome is unknown does. A
 * different target waits for a batch that is still in flight, so it is judged by what that batch
 * really did. The claim lives in the store, so it survives a reload of the setup.
 */
export function createStarterTrialGate(store: StarterClaimStore = { read: () => null, write: () => undefined }) {
  let claimedTarget: CourseTargetLanguage | null = store.read();
  let inFlight: { readonly target: CourseTargetLanguage; readonly promise: Promise<StarterTrialResult> } | null = null;
  const setClaim = (target: CourseTargetLanguage | null) => {
    claimedTarget = target;
    store.write(target);
  };

  const run = async (
    target: CourseTargetLanguage,
    create: () => Promise<StarterCardOutcome>,
  ): Promise<StarterTrialResult> => {
    while (inFlight !== null) {
      if (inFlight.target === target) return inFlight.promise;
      await inFlight.promise.catch(() => undefined);
    }
    if (claimedTarget !== null && claimedTarget !== target) return 'already-added';
    const previousClaim = claimedTarget;
    setClaim(target);
    const promise = (async (): Promise<StarterTrialResult> => {
      try {
        const outcome = await create();
        if (outcome.created.length === 0) setClaim(previousClaim);
        return outcome;
      } catch (error) {
        if (wroteNothing(error)) setClaim(previousClaim);
        throw error;
      }
    })();
    const entry = { target, promise };
    inFlight = entry;
    try {
      return await promise;
    } finally {
      if (inFlight === entry) inFlight = null;
    }
  };

  return { run };
}
