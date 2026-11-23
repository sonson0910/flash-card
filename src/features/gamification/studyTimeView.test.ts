import { describe, expect, it } from 'vitest';
import { buildStudyTimeView } from './studyTimeView';
import { stateFromFixture, studyTimeFixture } from './testing/verifiedStatsFixtures';
import { verifiedGamificationFromDocuments } from './verifiedGamificationClient';

describe('buildStudyTimeView', () => {
  it('totals today, the Monday week and the recent pace from the server days', () => {
    const view = buildStudyTimeView(stateFromFixture(studyTimeFixture), studyTimeFixture.now);
    expect(view).toEqual({
      coverageStartedOn: '2026-11-12',
      fromFirstAction: false,
      totalMs: 1_515_000,
      today: { activeMs: 135_000, reviewMs: 90_000, timedReviews: 4 },
      week: { weekStart: '2026-11-16', activeMs: 855_000, reviewMs: 750_000, timedReviews: 35, since: null },
      // 1,290 s over 61 timed reviews in the last 28 days, and 1,515 s over 5 study days.
      msPerReview: 21_148,
      dailyAverageMs: 303_000,
    });
  });

  it('marks the week in which counting began, and holds back estimates without enough evidence', () => {
    const stats = studyTimeFixture.stats as Record<string, unknown>;
    const state = verifiedGamificationFromDocuments({
      ...stats,
      studyTimeV1: {
        coverageStartedOn: '2026-11-19', fromFirstAction: false, lastActionAtMs: Date.parse('2026-11-19T13:04:05.000Z'),
        totalMs: 135_000, days: { '2026-11-19': { activeMs: 135_000, reviewMs: 90_000, timedReviews: 4 } },
      },
    }, {}, {});
    const view = buildStudyTimeView(state, studyTimeFixture.now);
    expect(view).toMatchObject({ week: { activeMs: 135_000, since: '2026-11-19' }, msPerReview: null, dailyAverageMs: null });
  });

  it('is absent before the server counts any study time, and for a malformed stored map', () => {
    expect(buildStudyTimeView(verifiedGamificationFromDocuments({}, {}, {}), studyTimeFixture.now)).toBeNull();
    const stats = studyTimeFixture.stats as Record<string, unknown>;
    const malformed = verifiedGamificationFromDocuments({
      ...stats, studyTimeV1: { ...(stats.studyTimeV1 as object), days: { '2026-11-19': { activeMs: 1, reviewMs: 2, timedReviews: 0 } } },
    }, {}, {});
    expect(buildStudyTimeView(malformed, studyTimeFixture.now)).toBeNull();
  });
});
