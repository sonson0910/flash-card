import { describe, expect, it } from 'vitest';
import {
  WORD_WEEKS_MAX_LANGUAGES, nextWordWeeks, parseWordWeeks, type WordWeekReview, type WordWeeksV1,
} from '../src/word-week-rules';

const review = (fields: Partial<WordWeekReview> = {}): WordWeekReview => ({
  studyDay: '2026-11-19', language: 'en', cardId: 'word-immediate', started: false, mastered: false, reviewsThisWeek: 1, ...fields,
});

const record = (fields: Partial<WordWeeksV1> = {}): WordWeeksV1 => ({
  coverageStartedOn: '2026-11-02', fromFirstAction: false, daysByLanguage: {}, bestWeekByLanguage: {}, wordOfWeekByLanguage: {}, ...fields,
});

const apply = (stored: WordWeeksV1 | undefined, fields: Partial<WordWeekReview> = {}, fromFirstAction = false) =>
  nextWordWeeks({ stored, fromFirstAction, review: review(fields) });

describe('nextWordWeeks', () => {
  it('starts a record on the first review and counts started and mastered words per day', () => {
    const first = apply(undefined, { started: true, mastered: true });
    expect(first).toEqual({
      coverageStartedOn: '2026-11-19', fromFirstAction: false,
      daysByLanguage: { en: { '2026-11-19': { started: 1, mastered: 1 } } },
      bestWeekByLanguage: {},
      wordOfWeekByLanguage: { en: { '2026-11-16': { cardId: 'word-immediate', reviews: 1 } } },
    });
    const second = apply(first, { cardId: 'word-instant', mastered: true });
    expect(second?.daysByLanguage.en['2026-11-19']).toEqual({ started: 1, mastered: 2 });
    // A review that neither starts nor masters a word adds no day.
    expect(apply(undefined, {})?.daysByLanguage).toEqual({});
    expect(parseWordWeeks(second)).toEqual(second);
  });

  it('keeps the word of the week on a tie and replaces it on a strictly higher count', () => {
    const instant = apply(record(), { cardId: 'word-instant', reviewsThisWeek: 3, studyDay: '2026-11-17' });
    const tie = apply(instant, { cardId: 'word-immediate', reviewsThisWeek: 3, studyDay: '2026-11-18' });
    expect(tie?.wordOfWeekByLanguage.en).toEqual({ '2026-11-16': { cardId: 'word-instant', reviews: 3 } });
    const ahead = apply(tie, { cardId: 'word-immediate', reviewsThisWeek: 4 });
    expect(ahead?.wordOfWeekByLanguage.en).toEqual({ '2026-11-16': { cardId: 'word-immediate', reviews: 4 } });
  });

  it('keeps the words of this week and last week only, and starts a new pick on Monday', () => {
    const stored = record({
      wordOfWeekByLanguage: { en: { '2026-11-02': { cardId: 'word-old', reviews: 9 }, '2026-11-09': { cardId: 'word-instant', reviews: 5 } } },
    });
    expect(apply(stored, { studyDay: '2026-11-16', cardId: 'word-new', reviewsThisWeek: 1 })?.wordOfWeekByLanguage.en).toEqual({
      '2026-11-09': { cardId: 'word-instant', reviews: 5 },
      '2026-11-16': { cardId: 'word-new', reviews: 1 },
    });
  });

  it('folds complete counted weeks into the best week before dropping their days', () => {
    const stored = record({
      daysByLanguage: {
        en: {
          '2026-11-02': { started: 50, mastered: 0 }, '2026-11-09': { started: 30, mastered: 2 },
          '2026-11-11': { started: 40, mastered: 1 }, '2026-11-13': { started: 38, mastered: 4 },
          '2026-11-16': { started: 61, mastered: 3 },
        },
      },
    });
    const next = apply(stored, { started: true });
    // The week of 2 November counts: coverage began that Monday. The week of 9 November started 108.
    expect(next?.bestWeekByLanguage).toEqual({ en: { weekStart: '2026-11-09', started: 108 } });
    expect(Object.keys(next?.daysByLanguage.en ?? {})).toEqual(['2026-11-09', '2026-11-11', '2026-11-13', '2026-11-16', '2026-11-19']);
    // The current week is never folded, however many words it has.
    expect(apply(record({ daysByLanguage: { en: { '2026-11-16': { started: 500, mastered: 0 } } } }))?.bestWeekByLanguage).toEqual({});
  });

  it('leaves out the partial week coverage began in, unless coverage began with the first action', () => {
    const stored = record({ coverageStartedOn: '2026-11-11', daysByLanguage: { en: { '2026-11-12': { started: 20, mastered: 0 } } } });
    expect(apply(stored)?.bestWeekByLanguage).toEqual({});
    expect(apply({ ...stored, fromFirstAction: true })?.bestWeekByLanguage).toEqual({ en: { weekStart: '2026-11-09', started: 20 } });
    // A tie keeps the earlier best week.
    const tied = record({
      bestWeekByLanguage: { en: { weekStart: '2026-11-02', started: 20 } },
      daysByLanguage: { en: { '2026-11-12': { started: 20, mastered: 0 } } },
    });
    expect(apply(tied)?.bestWeekByLanguage.en).toEqual({ weekStart: '2026-11-02', started: 20 });
  });

  it('folds and drops the days of a language studied long ago when another language is reviewed', () => {
    const stored = record({
      coverageStartedOn: '2026-10-01',
      daysByLanguage: { ko: { '2026-10-20': { started: 7, mastered: 0 } } },
      wordOfWeekByLanguage: { ko: { '2026-10-19': { cardId: 'word-ko', reviews: 2 } } },
    });
    const next = apply(stored, { started: true });
    expect(next?.daysByLanguage).toEqual({ en: { '2026-11-19': { started: 1, mastered: 0 } } });
    expect(next?.bestWeekByLanguage).toEqual({ ko: { weekStart: '2026-10-19', started: 7 } });
    expect(next?.wordOfWeekByLanguage).toEqual({ en: { '2026-11-16': { cardId: 'word-immediate', reviews: 1 } } });
  });

  it('does not count a language beyond the cap and keeps counting the languages it has', () => {
    const languages = Array.from({ length: WORD_WEEKS_MAX_LANGUAGES }, (_, index) => `l${String.fromCharCode(97 + index)}`);
    const full = record({
      bestWeekByLanguage: Object.fromEntries(languages.map(language => [language, { weekStart: '2026-11-09', started: 1 }])),
    });
    expect(apply(full, { language: 'en', started: true })).toBeUndefined();
    expect(apply(full, { language: languages[0], started: true })?.daysByLanguage).toEqual({
      [languages[0]]: { '2026-11-19': { started: 1, mastered: 0 } },
    });
  });
});
