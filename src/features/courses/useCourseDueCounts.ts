import { useEffect, useState } from 'react';
import type { CourseTargetLanguage } from './courseModel';

/** Cards due now per course language; a language is missing until its count has been read. */
export type CourseDueCounts = Readonly<Partial<Record<CourseTargetLanguage, number>>>;

export type CourseDueCountReader = (ownerId: string, language: CourseTargetLanguage) => Promise<number>;

const NO_COUNTS: CourseDueCounts = {};

/**
 * One aggregate count read per course, the same count the library shows. Firebase loads only
 * when a course surface first asks for a count, so the switcher chunk and its tests stay free of it.
 */
export const readCourseDueCount: CourseDueCountReader = async (ownerId, language) => {
  const [{ db }, { fetchLibraryDueCount }] = await Promise.all([
    import('../../lib/firebase'),
    import('../../lib/cardRepository'),
  ]);
  if (!db) throw new Error('Cloud storage is not configured.');
  return (await fetchLibraryDueCount(db, ownerId, language)).due;
};

/**
 * Reads the due count of each listed course every time `enabled` turns true. A count that fails
 * to load (offline, rules, quota) stays missing, so callers show no number rather than a guess.
 */
export function useCourseDueCounts(
  ownerId: string | null | undefined,
  languages: readonly CourseTargetLanguage[],
  enabled: boolean,
  read: CourseDueCountReader = readCourseDueCount,
): CourseDueCounts {
  const [state, setState] = useState<{ readonly owner: string | null; readonly counts: CourseDueCounts }>({ owner: null, counts: NO_COUNTS });
  const key = languages.join(',');
  useEffect(() => {
    if (!enabled || !ownerId || key === '') return undefined;
    let cancelled = false;
    for (const language of key.split(',') as CourseTargetLanguage[]) {
      read(ownerId, language).then(due => {
        if (cancelled) return;
        setState(current => {
          if (current.owner !== ownerId) return { owner: ownerId, counts: { [language]: due } };
          return current.counts[language] === due ? current : { owner: ownerId, counts: { ...current.counts, [language]: due } };
        });
      }, () => undefined);
    }
    return () => { cancelled = true; };
  }, [enabled, ownerId, key, read]);
  return ownerId && state.owner === ownerId ? state.counts : NO_COUNTS;
}
