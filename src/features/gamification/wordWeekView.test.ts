import { describe, expect, it } from 'vitest';
import { stateFromFixture, wordWeeksFixture } from './testing/verifiedStatsFixtures';
import { verifiedGamificationFromDocuments } from './verifiedGamificationClient';
import { buildWordWeekView } from './wordWeekView';

const stats = wordWeeksFixture.stats as Record<string, unknown>;
const record = stats.wordWeeksV1 as Record<string, unknown>;

describe('buildWordWeekView', () => {
  it('counts the Monday week, compares it with last week and the best week, and picks the word of the week', () => {
    const view = buildWordWeekView(stateFromFixture(wordWeeksFixture), 'en', wordWeeksFixture.now);
    expect(view).toMatchObject({ weekStart: '2026-11-16', weekEnd: '2026-11-22', today: '2026-11-19' });
    expect(view.words).toMatchObject({
      since: null, started: 146, mastered: 10, lastWeekStarted: 108, aheadOfLastWeek: 38,
      best: { weekStart: '2026-11-09', started: 108 }, isBestWeek: true, bestSince: '2026-11-02',
      wordOfWeek: { cardId: 'word-immediate', reviews: 4 },
    });
    expect(view.words?.days.map(day => [day.day, day.started, day.future])).toEqual([
      ['2026-11-16', 61, false], ['2026-11-17', 45, false], ['2026-11-18', 0, false], ['2026-11-19', 40, false],
      ['2026-11-20', 0, true], ['2026-11-21', 0, true], ['2026-11-22', 0, true],
    ]);
    // Again 12 of 130 graded reviews: Hard counts as recalled.
    expect(view.recall).toEqual({ graded: 130, recalled: 118, percent: 91, since: null });
  });

  it('says since when counting began inside the week, and never compares with an uncounted week', () => {
    const state = verifiedGamificationFromDocuments({
      ...stats, wordWeeksV1: { ...record, coverageStartedOn: '2026-11-18', bestWeekByLanguage: {} },
    }, {}, {});
    expect(buildWordWeekView(state, 'en', wordWeeksFixture.now).words).toMatchObject({
      since: '2026-11-18', lastWeekStarted: null, aheadOfLastWeek: null, best: null, isBestWeek: false,
    });
  });

  it('treats a new learner first week as complete', () => {
    const { '2026-11-09': _beforeFirstAction, ...days } = (record.daysByLanguage as Record<string, Record<string, unknown>>).en;
    const state = verifiedGamificationFromDocuments({
      ...stats,
      wordWeeksV1: { ...record, coverageStartedOn: '2026-11-11', fromFirstAction: true, daysByLanguage: { en: days } },
    }, {}, {});
    expect(buildWordWeekView(state, 'en', wordWeeksFixture.now).words).toMatchObject({
      since: null, lastWeekStarted: 78, aheadOfLastWeek: 68, bestSince: null,
    });
  });

  it('hides the word of the week below two reviews and recall below five graded reviews', () => {
    const state = verifiedGamificationFromDocuments({
      ...stats,
      reviewActivityV1: {
        coverageStartedOnByLanguage: { en: '2026-11-17' },
        daysByLanguage: { en: { '2026-11-17': { reviewed: 4, again: 1, hard: 1, good: 2, easy: 0 } } },
      },
      wordWeeksV1: { ...record, wordOfWeekByLanguage: { en: { '2026-11-16': { cardId: 'word-immediate', reviews: 1 } } } },
    }, {}, {});
    const view = buildWordWeekView(state, 'en', wordWeeksFixture.now);
    expect(view.words?.wordOfWeek).toBeNull();
    expect(view.recall).toEqual({ graded: 4, recalled: 3, percent: null, since: '2026-11-17' });
  });

  it('has no word counts for another course language or a malformed map', () => {
    expect(buildWordWeekView(stateFromFixture(wordWeeksFixture), 'ja', wordWeeksFixture.now))
      .toMatchObject({ words: { started: 0, best: null, wordOfWeek: null }, recall: null });
    const malformed = verifiedGamificationFromDocuments({
      ...stats, wordWeeksV1: { ...record, daysByLanguage: { en: { '2026-11-16': { started: -1, mastered: 0 } } } },
    }, {}, {});
    expect(buildWordWeekView(malformed, 'en', wordWeeksFixture.now).words).toBeNull();
  });
});
