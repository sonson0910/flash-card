import type { CourseTargetLanguage } from './courseModel';

/**
 * The level a learner says a course starts at: Foundation, Core or Advanced, the same three
 * tiers the Paths catalog uses. It is the learner's own answer, never a test result, so it is
 * kept on this device like the daily pace and costs no Firestore read or write. The Paths
 * catalog and the courses surface read it; nothing schedules cards from it.
 */
export const STARTING_TIERS = ['foundation', 'core', 'advanced'] as const;
export type StartingTier = (typeof STARTING_TIERS)[number];

type TierStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const getStorage = (): TierStorage | null => {
  try { return globalThis.localStorage; } catch { return null; }
};

const tierKey = (ownerId: string, language: CourseTargetLanguage) => `sonflash_starting_tier_v1_${ownerId}_${language}`;

export const isStartingTier = (value: unknown): value is StartingTier =>
  typeof value === 'string' && (STARTING_TIERS as readonly string[]).includes(value);

export const readStartingTier = (
  ownerId: string,
  language: CourseTargetLanguage,
  storage: Pick<TierStorage, 'getItem'> | null = getStorage(),
): StartingTier | null => {
  try {
    const raw = storage?.getItem(tierKey(ownerId, language));
    return isStartingTier(raw) ? raw : null;
  } catch {
    return null;
  }
};

export const writeStartingTier = (
  ownerId: string,
  language: CourseTargetLanguage,
  tier: StartingTier,
  storage: Pick<TierStorage, 'setItem'> | null = getStorage(),
): boolean => {
  try {
    storage?.setItem(tierKey(ownerId, language), tier);
    return storage !== null;
  } catch {
    return false;
  }
};
