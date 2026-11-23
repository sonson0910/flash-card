import { describe, expect, it } from 'vitest';
import { clearLibraryFigures } from './clearLibraryFigures';

const course = { total: 50, learned: 12, deckCount: 3 };

describe('clearLibraryFigures', () => {
  it('shows the owner-wide card count, not the active course figures, when other courses hold cards', () => {
    expect(clearLibraryFigures(course, { tracked: true, cardCount: 250 })).toEqual({ cardCount: 250 });
  });

  it('shows no figure while the owner-wide count is unknown', () => {
    expect(clearLibraryFigures(course, { tracked: true, cardCount: null })).toEqual({});
  });

  it('shows every figure when the active course is the whole library', () => {
    expect(clearLibraryFigures(course, { tracked: true, cardCount: 50 })).toEqual({ cardCount: 50, masteredCount: 12, deckCount: 3 });
  });

  it('keeps the course figures where no owner-wide count is tracked', () => {
    expect(clearLibraryFigures(course, { tracked: false, cardCount: null })).toEqual({ cardCount: 50, masteredCount: 12, deckCount: 3 });
    expect(clearLibraryFigures({ total: 0, learned: 0 }, { tracked: false, cardCount: null })).toEqual({});
  });
});
