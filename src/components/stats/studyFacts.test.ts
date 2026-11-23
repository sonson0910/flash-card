import { describe, expect, it } from 'vitest';
import { buildStudyTimeView } from '../../features/gamification/studyTimeView';
import { stateFromFixture, streakFixtures, studyTimeFixture } from '../../features/gamification/testing/verifiedStatsFixtures';
import {
  boardDateLocale,
  buildProgressStudyFacts,
  firstVerifiedStudyDay,
  formatBoardDate,
  hoursAndMinutes,
  minutesAndSeconds,
  reviewEstimateMinutes,
} from './studyFacts';

describe('Progress study facts', () => {
  it('reads Learning since from the first day the server credited XP, never from a zero day', () => {
    expect(firstVerifiedStudyDay({ '2026-09-27': 40, '2026-06-02': 15, '2026-05-30': 0, 'Sat Jan 03 2026': 9 })).toBe('2026-06-02');
    expect(firstVerifiedStudyDay({})).toBeNull();
  });

  it('reads studied time account-wide, since the day counting began for an account that studied before', () => {
    const facts = buildProgressStudyFacts(stateFromFixture(studyTimeFixture), studyTimeFixture.now);

    expect(facts.studied).toEqual({ totalMs: 1_515_000, since: '2026-11-12' });
    // 1,515,000 ms over the five days studied in the last four weeks.
    expect(facts.dailyMinutes).toBe(5);
    expect(facts.learningSince).toBeNull();
  });

  it('leaves every study-time fact out before study time is counted', () => {
    const facts = buildProgressStudyFacts(stateFromFixture(streakFixtures.frozenOneDay), streakFixtures.frozenOneDay.now);

    expect(facts.studied).toBeNull();
    expect(facts.dailyMinutes).toBeUndefined();
    expect(facts.bestStreak).toBe(11);
  });

  it('shows no best streak before the server records one', () => {
    expect(buildProgressStudyFacts(stateFromFixture(studyTimeFixture), studyTimeFixture.now).bestStreak).toBeNull();
  });

  it('estimates the next review from the recent pace, at least one minute, and not without a pace', () => {
    const pace = buildStudyTimeView(stateFromFixture(studyTimeFixture), studyTimeFixture.now)?.msPerReview ?? null;
    expect(pace).not.toBeNull();
    expect(reviewEstimateMinutes(24, pace)).toBe(Math.max(1, Math.round((24 * pace!) / 60_000)));
    expect(reviewEstimateMinutes(1, 2_000)).toBe(1);
    expect(reviewEstimateMinutes(0, pace)).toBeNull();
    expect(reviewEstimateMinutes(24, null)).toBeNull();
  });

  it('splits durations the way the boards print them', () => {
    expect(hoursAndMinutes(14 * 3_600_000 + 20 * 60_000 + 59_000)).toEqual({ hours: 14, minutes: 20 });
    expect(minutesAndSeconds(4 * 60_000 + 5_400)).toEqual({ minutes: 4, seconds: 5 });
  });

  it('writes board dates day first in English and in the UI locale otherwise', () => {
    expect(boardDateLocale('en')).toBe('en-GB');
    expect(boardDateLocale('vi')).toBe('vi');
    expect(formatBoardDate('2026-06-02', 'en', { day: 'numeric', month: 'long', year: 'numeric' })).toBe('2 June 2026');
  });
});
