import { describe, expect, it } from 'vitest';
import { parseStreakChange, parseStreakState, repairOfferFor, streakStatus, type StreakStateV1 } from '../src/streak-rules';
import { shiftStudyDay, studyDaysBetween, weekStartOf } from '../src/study-day-rules';

const record = (fields: Partial<StreakStateV1> = {}): StreakStateV1 => ({
  coverageStartedOn: '2026-11-02', freezes: 0, refilledWeek: '2026-11-16', best: 0, bestCountedFrom: '2026-11-02',
  days: {}, milestones: {}, repair: null, lastRepairedOn: null, ...fields,
});

describe('study day arithmetic', () => {
  it('shifts across months and years and starts weeks on Monday', () => {
    expect(shiftStudyDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftStudyDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(studyDaysBetween('2026-11-16', '2026-11-19')).toBe(3);
    expect(weekStartOf('2026-11-22')).toBe('2026-11-16');
    expect(weekStartOf('2026-11-16')).toBe('2026-11-16');
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28');
  });
});

describe('streakStatus', () => {
  it('keeps the run open the day after studying and safe on the day studied', () => {
    expect(streakStatus({ run: 5, lastStudyDay: '2026-11-18', today: '2026-11-18', state: record() }))
      .toMatchObject({ status: 'safe', length: 5 });
    expect(streakStatus({ run: 5, lastStudyDay: '2026-11-18', today: '2026-11-19', state: record() }))
      .toMatchObject({ status: 'open', length: 5, freezesUsedNow: 0 });
  });

  it('uses one held freeze per missed day and ends the run on the first uncovered day', () => {
    const state = record({ freezes: 2 });
    expect(streakStatus({ run: 9, lastStudyDay: '2026-11-15', today: '2026-11-18', state }))
      .toMatchObject({ status: 'frozen', length: 9, freezes: 0, freezesUsedNow: 2, repair: null });
    expect(streakStatus({ run: 9, lastStudyDay: '2026-11-14', today: '2026-11-18', state })).toMatchObject({
      status: 'ended', length: 0, previousLength: 9, freezes: 0, freezesUsedNow: 2,
      repair: { runLength: 9, lastStudiedOn: '2026-11-14', endedOn: '2026-11-17', deadline: '2026-11-19', cardsDone: 0, cardsNeeded: 20 },
    });
  });

  it('caps the legacy reward freeze until the server writes the record', () => {
    expect(streakStatus({ run: 4, lastStudyDay: '2026-11-17', today: '2026-11-19', legacyFreezes: 5 }))
      .toMatchObject({ status: 'frozen', freezes: 1, freezesUsedNow: 1, refillPending: true });
    expect(streakStatus({ run: 4, lastStudyDay: '2026-11-17', today: '2026-11-19', legacyFreezes: -1 }))
      .toMatchObject({ status: 'ended', freezesUsedNow: 0 });
  });

  it('reports a pending weekly top-up until the first review of the week', () => {
    expect(streakStatus({ run: 1, lastStudyDay: '2026-11-15', today: '2026-11-16', state: record({ refilledWeek: '2026-11-09' }) }))
      .toMatchObject({ refillPending: true });
    expect(streakStatus({ run: 1, lastStudyDay: '2026-11-16', today: '2026-11-22', state: record({ refilledWeek: '2026-11-16' }) }))
      .toMatchObject({ refillPending: false });
  });

  it('drops a stored repair once its deadline has passed', () => {
    const repair = { runLength: 23, lastStudiedOn: '2026-11-16', endedOn: '2026-11-17', deadline: '2026-11-19', cardsDone: 8, cardsNeeded: 20 };
    const state = record({ repair });
    expect(streakStatus({ run: 1, lastStudyDay: '2026-11-18', today: '2026-11-19', state }).repair).toEqual(repair);
    expect(streakStatus({ run: 1, lastStudyDay: '2026-11-18', today: '2026-11-20', state }).repair).toBeNull();
  });

  it('shows no streak without a study day or a run', () => {
    expect(streakStatus({ run: 0, lastStudyDay: '2026-11-18', today: '2026-11-19' })).toMatchObject({ status: 'none', length: 0 });
    expect(streakStatus({ run: 3, lastStudyDay: null, today: '2026-11-19' })).toMatchObject({ status: 'none', length: 0 });
  });
});

describe('repairOfferFor', () => {
  it('offers a repair for runs of three days or more until the second day after the break ends', () => {
    expect(repairOfferFor(3, '2026-11-16', '2026-11-17', '2026-11-19', null)).toMatchObject({ deadline: '2026-11-19' });
    expect(repairOfferFor(2, '2026-11-16', '2026-11-17', '2026-11-18', null)).toBeNull();
    expect(repairOfferFor(3, '2026-11-16', '2026-11-17', '2026-11-20', null)).toBeNull();
  });

  it('offers at most one repair every thirty days', () => {
    expect(repairOfferFor(10, '2026-11-16', '2026-11-17', '2026-11-18', '2026-10-20')).toBeNull();
    expect(repairOfferFor(10, '2026-11-16', '2026-11-17', '2026-11-18', '2026-10-19')).not.toBeNull();
  });
});

describe('parseStreakState', () => {
  it('reads a stored record field by field and needs only a valid coverage day', () => {
    expect(parseStreakState({ coverageStartedOn: '2026-11-02' })).toEqual(record({ refilledWeek: null, bestCountedFrom: null }));
    expect(parseStreakState({ ...record(), freezes: 3, refilledWeek: '2026-11-17', lastRepairedOn: 'soon' }))
      .toMatchObject({ freezes: 2, refilledWeek: null, lastRepairedOn: null });
    expect(parseStreakState(null)).toBeUndefined();
    expect(parseStreakState([])).toBeUndefined();
  });
});

describe('parseStreakChange', () => {
  it('keeps known fields and drops what it cannot read', () => {
    expect(parseStreakChange({ freezesUsed: 0, freezesEarned: 1, milestone: 14, milestoneXp: 50, repaired: true, future: 'field' }))
      .toEqual({ freezesUsed: 0, freezesEarned: 1, milestone: 14, milestoneXp: 50, repaired: true });
    expect(parseStreakChange({ freezesUsed: 0, freezesEarned: 0, milestone: 21, milestoneXp: 100 }))
      .toEqual({ freezesUsed: 0, freezesEarned: 0 });
    expect(parseStreakChange({ freezesUsed: 1 })).toBeUndefined();
  });
});
