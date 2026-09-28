/**
 * Daily pace is a per-device UI preference, the same tier as theme, sound and
 * haptics (`lumi-preference.ts`, `interactionSounds.ts`, `haptics.ts`): it
 * never touches Firestore, so switching or reading it costs zero reads and
 * zero writes. It is not part of the `Course`/`CoursePreferences` schema,
 * which owns exam goals and script preferences, not a study cadence.
 */
export const DAILY_PACE_STORAGE_KEY = 'sonflash_daily_pace_v1';
export const DAILY_PACE_OPTIONS = [5, 10, 15, 20] as const;
export type DailyPace = (typeof DAILY_PACE_OPTIONS)[number];
export const DEFAULT_DAILY_PACE: DailyPace = 10;

type PaceStorage = Pick<Storage, 'getItem' | 'setItem'>;

const getStorage = (): PaceStorage | null => {
  try { return globalThis.localStorage; } catch { return null; }
};

export const isDailyPace = (value: unknown): value is DailyPace =>
  typeof value === 'number' && (DAILY_PACE_OPTIONS as readonly number[]).includes(value);

export const readDailyPace = (storage: Pick<PaceStorage, 'getItem'> | null = getStorage()): DailyPace => {
  try {
    const raw = storage?.getItem(DAILY_PACE_STORAGE_KEY);
    const parsed = raw === null || raw === undefined ? NaN : Number(raw);
    return isDailyPace(parsed) ? parsed : DEFAULT_DAILY_PACE;
  } catch {
    return DEFAULT_DAILY_PACE;
  }
};

/** ETA requires an explicitly saved pace; unlike settings, it must not invent a default. */
export const readDailyPaceForEta = (
  storage: Pick<PaceStorage, 'getItem'> | null = getStorage(),
): DailyPace | null => {
  try {
    const raw = storage?.getItem(DAILY_PACE_STORAGE_KEY);
    const parsed = raw === null || raw === undefined ? NaN : Number(raw);
    return isDailyPace(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const writeDailyPace = (pace: DailyPace, storage: Pick<PaceStorage, 'setItem'> | null = getStorage()): void => {
  try { storage?.setItem(DAILY_PACE_STORAGE_KEY, String(pace)); } catch { /* the in-memory choice still applies for this view */ }
};
