import { useEffect, useState } from 'react';

export interface ClearLibraryFigures {
  readonly cardCount?: number;
  readonly masteredCount?: number;
  readonly deckCount?: number;
}

/**
 * The figures the clear-library confirmation shows. Clearing deletes the cards of every course,
 * so the active course's counts are shown only when they are the whole library. When the
 * owner-wide count is still loading or could not be read, no figure is shown rather than a
 * smaller one; when other courses hold cards, only the owner-wide card count is shown.
 */
export const clearLibraryFigures = (
  course: { readonly total: number; readonly learned: number; readonly deckCount?: number },
  owner: { readonly tracked: boolean; readonly cardCount: number | null },
): ClearLibraryFigures => {
  const courseFigures = course.total > 0
    ? { cardCount: course.total, masteredCount: course.learned, ...(course.deckCount === undefined ? {} : { deckCount: course.deckCount }) }
    : {};
  if (!owner.tracked) return courseFigures;
  if (owner.cardCount === null || owner.cardCount <= 0) return {};
  return owner.cardCount === course.total ? courseFigures : { cardCount: owner.cardCount };
};

/** Reads the owner-wide card count once each time `active` turns on; null until it is known. */
export const useOwnerCardCount = (active: boolean, load: (() => Promise<number>) | undefined): number | null => {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!active || !load) return undefined;
    let current = true;
    setCount(null);
    void load().then(value => { if (current) setCount(value); }, () => { if (current) setCount(null); });
    return () => { current = false; };
  }, [active, load]);
  return load && active ? count : null;
};
