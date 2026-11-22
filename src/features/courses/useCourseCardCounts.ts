import { useEffect, useState } from 'react';
import type { CourseTargetLanguage } from './courseModel';

/** A course's cards: every card in its language, and those reviewed at least once. */
export interface CourseCardCount {
  readonly total: number;
  readonly reviewed: number;
}

/** Card counts per course language; a language is missing until its counts have been read. */
export type CourseCardCounts = Readonly<Partial<Record<CourseTargetLanguage, CourseCardCount>>>;

export type CourseCardCountReader = (ownerId: string, language: CourseTargetLanguage) => Promise<CourseCardCount>;

const NO_COUNTS: CourseCardCounts = {};

/** Cards of the course never reviewed: the new words still waiting for a first study. */
export const newWordCount = (count: CourseCardCount): number => Math.max(0, count.total - count.reviewed);

/** Whole percent of the course's cards reviewed at least once; 0 for an empty course. */
export const reviewedPercent = (count: CourseCardCount): number =>
  count.total > 0 ? Math.min(100, Math.round((100 * Math.min(count.reviewed, count.total)) / count.total)) : 0;

/**
 * Two aggregate count reads per course, the same `language` and `reviews > 0` queries the
 * library statistics use, so each costs one read per 1,000 cards counted. Firebase loads only
 * when a course surface first asks, like the due counts.
 */
export const readCourseCardCount: CourseCardCountReader = async (ownerId, language) => {
  const [{ db }, firestore] = await Promise.all([import('../../lib/firebase'), import('firebase/firestore')]);
  if (!db) throw new Error('Cloud storage is not configured.');
  const cards = firestore.collection(db, 'users', ownerId, 'cards');
  const inCourse = firestore.where('language', '==', language);
  const [total, reviewed] = await Promise.all([
    firestore.getCountFromServer(firestore.query(cards, inCourse)),
    firestore.getCountFromServer(firestore.query(cards, inCourse, firestore.where('reviews', '>', 0))),
  ]);
  return { total: total.data().count, reviewed: reviewed.data().count };
};

/**
 * Reads the card counts of each listed course every time `enabled` turns true. A count that
 * fails to load stays missing, so the surface shows no number and no bar rather than a guess.
 */
export function useCourseCardCounts(
  ownerId: string | null | undefined,
  languages: readonly CourseTargetLanguage[],
  enabled: boolean,
  read: CourseCardCountReader = readCourseCardCount,
): CourseCardCounts {
  const [state, setState] = useState<{ readonly owner: string | null; readonly counts: CourseCardCounts }>({ owner: null, counts: NO_COUNTS });
  const key = languages.join(',');
  useEffect(() => {
    if (!enabled || !ownerId || key === '') return undefined;
    let cancelled = false;
    for (const language of key.split(',') as CourseTargetLanguage[]) {
      read(ownerId, language).then(count => {
        if (cancelled) return;
        setState(current => {
          if (current.owner !== ownerId) return { owner: ownerId, counts: { [language]: count } };
          const previous = current.counts[language];
          return previous && previous.total === count.total && previous.reviewed === count.reviewed
            ? current
            : { owner: ownerId, counts: { ...current.counts, [language]: count } };
        });
      }, () => undefined);
    }
    return () => { cancelled = true; };
  }, [enabled, ownerId, key, read]);
  return ownerId && state.owner === ownerId ? state.counts : NO_COUNTS;
}
