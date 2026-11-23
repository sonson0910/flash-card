import { describe, expect, it } from 'vitest';
import {
  STUDY_TIME_DAYS_KEPT, nextStudyTime, parseStudyTime, studyTimeCredit, type StudyTimeAction, type StudyTimeV1,
} from '../src/study-time-rules';
import { shiftStudyDay } from '../src/study-day-rules';

const at = (iso: string) => Date.parse(iso);
const review = (iso: string, studyDay = '2026-11-19'): StudyTimeAction => ({ atMs: at(iso), studyDay });

describe('studyTimeCredit', () => {
  const last = at('2026-11-19T13:00:00.000Z');

  it('credits a review the gap up to a minute, a minute up to five, and nothing after a longer break', () => {
    expect(studyTimeCredit(last, review('2026-11-19T13:00:09.000Z'))).toEqual({ creditMs: 9_000, timed: true });
    expect(studyTimeCredit(last, review('2026-11-19T13:01:00.000Z'))).toEqual({ creditMs: 60_000, timed: true });
    expect(studyTimeCredit(last, review('2026-11-19T13:02:30.000Z'))).toEqual({ creditMs: 60_000, timed: true });
    expect(studyTimeCredit(last, review('2026-11-19T13:05:00.000Z'))).toEqual({ creditMs: 60_000, timed: true });
    expect(studyTimeCredit(last, review('2026-11-19T13:05:00.001Z'))).toEqual({ creditMs: 0, timed: false });
  });

  it('credits nothing without a previous action or for an action committed out of order', () => {
    expect(studyTimeCredit(null, review('2026-11-19T13:00:09.000Z'))).toEqual({ creditMs: 0, timed: false });
    expect(studyTimeCredit(last, review('2026-11-19T13:00:00.000Z'))).toEqual({ creditMs: 0, timed: false });
    expect(studyTimeCredit(last, review('2026-11-19T12:59:00.000Z'))).toEqual({ creditMs: 0, timed: false });
  });

  it('credits practice from its start or the previous action, capped per card and in total', () => {
    const practice = (iso: string, startedIso: string | null, cards: number): StudyTimeAction => ({
      ...review(iso), practice: { startedAtMs: startedIso === null ? null : at(startedIso), cards },
    });
    // Started after the previous action: counted from the start.
    expect(studyTimeCredit(last, practice('2026-11-19T13:01:00.000Z', '2026-11-19T13:00:20.000Z', 6)).creditMs).toBe(40_000);
    // Started before it: counted from the previous action, so no time is counted twice.
    expect(studyTimeCredit(last, practice('2026-11-19T13:01:00.000Z', '2026-11-19T12:58:00.000Z', 6)).creditMs).toBe(60_000);
    expect(studyTimeCredit(last, practice('2026-11-19T13:10:00.000Z', '2026-11-19T13:00:00.000Z', 6)).creditMs).toBe(120_000);
    expect(studyTimeCredit(null, practice('2026-11-19T14:00:00.000Z', '2026-11-19T13:00:00.000Z', 200)).creditMs).toBe(30 * 60_000);
    expect(studyTimeCredit(last, practice('2026-11-19T13:01:00.000Z', null, 6))).toEqual({ creditMs: 0, timed: false });
    expect(studyTimeCredit(at('2026-11-19T13:02:00.000Z'), practice('2026-11-19T13:01:00.000Z', '2026-11-19T13:00:00.000Z', 6)).creditMs).toBe(0);
  });
});

describe('nextStudyTime', () => {
  it('reproduces the evening session: 135 s with 90 s over 4 timed reviews', () => {
    const fresh = nextStudyTime({
      stored: undefined,
      seed: { lastActionAtMs: at('2026-11-19T01:15:00.000Z'), fromFirstAction: false },
      action: review('2026-11-19T13:00:00.000Z'),
    });
    expect(fresh.creditMs).toBe(0);
    let state: StudyTimeV1 = fresh.state;
    const credits: number[] = [];
    for (const iso of ['2026-11-19T13:00:09.000Z', '2026-11-19T13:00:21.000Z', '2026-11-19T13:02:51.000Z', '2026-11-19T13:03:00.000Z']) {
      const next = nextStudyTime({ stored: state, seed: { lastActionAtMs: null, fromFirstAction: true }, action: review(iso) });
      credits.push(next.creditMs);
      state = next.state;
    }
    const match = nextStudyTime({
      stored: state, seed: { lastActionAtMs: null, fromFirstAction: true },
      action: { ...review('2026-11-19T13:04:05.000Z'), practice: { startedAtMs: at('2026-11-19T13:03:20.000Z'), cards: 6 } },
    });
    expect([...credits, match.creditMs]).toEqual([9_000, 12_000, 60_000, 9_000, 45_000]);
    expect(match.state).toEqual({
      coverageStartedOn: '2026-11-19', fromFirstAction: false, lastActionAtMs: at('2026-11-19T13:04:05.000Z'), totalMs: 135_000,
      days: { '2026-11-19': { activeMs: 135_000, reviewMs: 90_000, timedReviews: 4 } },
    });
    expect(parseStudyTime(match.state)).toEqual(match.state);
  });

  it('never moves the chain back for an action committed out of order', () => {
    const stored = parseStudyTime({
      coverageStartedOn: '2026-11-12', fromFirstAction: true, lastActionAtMs: at('2026-11-19T13:00:00.000Z'), totalMs: 5, days: {},
    });
    const next = nextStudyTime({ stored, seed: { lastActionAtMs: null, fromFirstAction: false }, action: review('2026-11-19T12:59:30.000Z') });
    expect(next).toEqual({ creditMs: 0, state: stored });
  });

  it('keeps 35 study days counted back from the newest and credits the day of the action', () => {
    const newest = '2026-11-19';
    const days = Object.fromEntries(Array.from({ length: STUDY_TIME_DAYS_KEPT + 3 }, (_, index) => [
      shiftStudyDay(newest, -index - 1), { activeMs: 1_000, reviewMs: 1_000, timedReviews: 1 },
    ]));
    const stored = parseStudyTime({
      coverageStartedOn: '2026-10-01', fromFirstAction: false, lastActionAtMs: at('2026-11-18T16:59:50.000Z'), totalMs: 38_000, days,
    });
    // 00:00:05 on 19 November in Ho Chi Minh City, fifteen seconds after the previous answer the evening before.
    const next = nextStudyTime({ stored, seed: { lastActionAtMs: null, fromFirstAction: false }, action: review('2026-11-18T17:00:05.000Z', newest) });
    expect(next.creditMs).toBe(15_000);
    expect(Object.keys(next.state.days)).toHaveLength(STUDY_TIME_DAYS_KEPT);
    expect(Object.keys(next.state.days).sort()[0]).toBe(shiftStudyDay(newest, 1 - STUDY_TIME_DAYS_KEPT));
    expect(next.state.days[newest]).toEqual({ activeMs: 15_000, reviewMs: 15_000, timedReviews: 1 });
    expect(next.state.totalMs).toBe(53_000);
  });
});
