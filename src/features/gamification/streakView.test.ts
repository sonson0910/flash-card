import { describe, expect, it } from 'vitest';
import { buildStreakView } from './streakView';
import { stateFromFixture, streakFixtures } from './testing/verifiedStatsFixtures';
import { verifiedGamificationFromDocuments } from './verifiedGamificationClient';

const viewOf = (fixture: (typeof streakFixtures)[keyof typeof streakFixtures]) => buildStreakView(stateFromFixture(fixture), fixture.now);
const weekStates = (fixture: (typeof streakFixtures)[keyof typeof streakFixtures]) => viewOf(fixture).week.map(day => day.state);

describe('buildStreakView', () => {
  it('projects the legacy reward freeze until the server writes the streak record', () => {
    const view = viewOf(streakFixtures.legacyOpen);
    expect(view).toMatchObject({
      status: 'open', today: '2026-11-19', length: 6, previousLength: 6,
      freezes: { held: 1, max: 2, usingNow: 0, nextEarnIn: 1, refillPending: true },
      repair: null, best: null, nextMilestone: { length: 7, daysLeft: 1 }, milestones: {},
    });
    // Before the record, the stored run is the evidence: Monday 16 to Wednesday 18 were studied.
    expect(weekStates(streakFixtures.legacyOpen)).toEqual(['done', 'done', 'done', 'today', 'future', 'future', 'future']);
  });

  it('shows a missed day covered by a held freeze as frozen without shortening the run', () => {
    const view = viewOf(streakFixtures.frozenOneDay);
    expect(view).toMatchObject({
      status: 'frozen', length: 11, previousLength: 11,
      freezes: { held: 0, max: 2, usingNow: 1, nextEarnIn: 3, refillPending: false },
      repair: null, best: { length: 11, countedFrom: '2026-09-28' },
      nextMilestone: { length: 14, daysLeft: 3 }, milestones: { 7: '2026-11-13' },
    });
    expect(weekStates(streakFixtures.frozenOneDay)).toEqual(['done', 'done', 'frozen', 'today', 'future', 'future', 'future']);
  });

  it('offers a repair that closes when the second day after the break ends in the account zone', () => {
    const view = viewOf(streakFixtures.repairAvailable);
    expect(view).toMatchObject({
      status: 'ended', length: 0, previousLength: 23,
      freezes: { held: 0, usingNow: 0, nextEarnIn: 7 },
      repair: { state: 'available', cardsDone: 0, cardsNeeded: 20, runLength: 23, deadline: '2026-11-19' },
      best: { length: 23 }, nextMilestone: { length: 7, daysLeft: 7 },
    });
    // Midnight at the end of Thursday in Ho Chi Minh City: 36 hours after Wednesday noon.
    expect(view.repair?.endsAt.toISOString()).toBe('2026-11-19T17:00:00.000Z');
    expect(view.repair!.endsAt.getTime() - streakFixtures.repairAvailable.now.getTime()).toBe(36 * 60 * 60 * 1000);
    expect(weekStates(streakFixtures.repairAvailable)).toEqual(['done', 'missed', 'today', 'future', 'future', 'future', 'future']);
  });

  it('keeps a stored repair in progress beside the new run', () => {
    const view = viewOf(streakFixtures.repairInProgress);
    expect(view).toMatchObject({
      status: 'safe', length: 1, previousLength: 23,
      repair: { state: 'in-progress', cardsDone: 8, cardsNeeded: 20, runLength: 23 },
      best: { length: 23 },
    });
    expect(weekStates(streakFixtures.repairInProgress)).toEqual(['done', 'missed', 'done', 'future', 'future', 'future', 'future']);
  });

  it('ends the run without a repair once the window has passed', () => {
    const view = viewOf(streakFixtures.endedNoRepair);
    expect(view).toMatchObject({ status: 'ended', length: 0, previousLength: 23, repair: null });
    expect(weekStates(streakFixtures.endedNoRepair)).toEqual(['done', 'missed', 'missed', 'missed', 'today', 'future', 'future']);
  });

  it('reports a reached milestone, the next one and the best streak on the day studied', () => {
    const view = viewOf(streakFixtures.safeAtMilestone);
    expect(view).toMatchObject({
      status: 'safe', length: 30,
      freezes: { held: 2, nextEarnIn: 5, refillPending: false },
      best: { length: 30, countedFrom: '2026-10-21' },
      nextMilestone: { length: 60, daysLeft: 30 },
      milestones: { 7: '2026-10-27', 14: '2026-11-03', 30: '2026-11-19' },
    });
    expect(weekStates(streakFixtures.safeAtMilestone)).toEqual(['done', 'done', 'done', 'done', 'future', 'future', 'future']);
  });

  it('spends every freeze before ending a run that the freezes cannot bridge', () => {
    const { stats, now } = streakFixtures.frozenOneDay;
    const record = stats.streakV1 as Record<string, unknown>;
    // Last studied Monday 16 with one freeze; Thursday 19 has two uncovered missed days.
    const state = verifiedGamificationFromDocuments(
      { ...stats, lastVerifiedStudyDay: '2026-11-16', verifiedStreak: 10, streakV1: { ...record, days: {} } }, {}, {},
    );
    const view = buildStreakView(state, now);
    expect(view).toMatchObject({ status: 'ended', previousLength: 10, freezes: { held: 0 } });
    // The freeze covered Tuesday; the run ended on Wednesday, so the repair closes after Friday.
    expect(view.repair).toMatchObject({ deadline: '2026-11-20' });
    expect(view.week.map(day => day.state)).toEqual(['done', 'frozen', 'missed', 'today', 'future', 'future', 'future']);
  });

  it('uses the stored reward zone, not the device zone, for today', () => {
    // 23:30 on Wednesday in UTC is already Thursday 06:30 in Ho Chi Minh City.
    const view = buildStreakView(stateFromFixture(streakFixtures.frozenOneDay), new Date('2026-11-18T23:30:00.000Z'));
    expect(view).toMatchObject({ today: '2026-11-19', timeZone: 'Asia/Ho_Chi_Minh', status: 'frozen' });
  });

  it('shows no streak for an account that has not studied', () => {
    const view = buildStreakView(verifiedGamificationFromDocuments({}, {}, {}), new Date('2026-11-19T00:00:00.000Z'));
    expect(view).toMatchObject({ status: 'none', length: 0, best: null, repair: null, freezes: { held: 0, nextEarnIn: 7 } });
  });
});
