import { describe, expect, it } from 'vitest';
import {
  EQUIP_OWNED_FRAME_CALLABLE,
  acceptAuthoritativeGamificationOutcome,
  normalizeDeferredGamificationOutcomes,
  replayAuthoritativeGamificationOutcomes,
  verifiedGamificationFromDocuments,
} from './verifiedGamificationClient';

describe('verified gamification client', () => {
  it('uses the exported reward-frame callable contract', () => {
    expect(EQUIP_OWNED_FRAME_CALLABLE).toBe('equipOwnedFrame');
  });

  it('shows verified progress from zero while retaining legacy progress as labeled history', () => {
    const state = verifiedGamificationFromDocuments(
      { xp: 5000, streak: 42 },
      { '2026-09-27': 12, 'Sun Jul 12 2026': 7, verifiedByDayV1: { '2026-09-27': 2 } },
      { ownedFrameIds: ['crimson-wing'], ownedTitleIds: ['word-collector'], hintTokens: 1 },
    );
    expect(state).toMatchObject({ xp: 0, level: 1, streak: 0, xpHistory: { '2026-09-27': 2 } });
    expect(state.legacyHistory).toEqual({ label: 'legacy', xp: 5000, streak: 42, history: { '2026-09-27': 12, 'Sun Jul 12 2026': 7 } });
    expect(state.rewards.ownedFrameIds).toEqual(['crimson-wing']);
    expect(state.rewards.ownedTitleIds).toEqual(['word-collector']);
  });

  it('hydrates an equipped frame only when the account owns it', () => {
    expect(verifiedGamificationFromDocuments({}, {}, {
      ownedFrameIds: ['crimson-wing'], equippedFrameId: 'crimson-wing',
    }).rewards.equippedFrameId).toBe('crimson-wing');
    expect(verifiedGamificationFromDocuments({}, {}, {
      ownedFrameIds: [], equippedFrameId: 'crimson-wing',
    }).rewards.equippedFrameId).toBeNull();
  });

  it('accepts only a level consistent with the authoritative XP outcome', () => {
    const current = verifiedGamificationFromDocuments({}, {}, {});
    expect(acceptAuthoritativeGamificationOutcome(current, { xp: 14_400, level: 13, streak: 30 }))
      .toMatchObject({ xp: 14_400, level: 13, streak: 30 });
    expect(acceptAuthoritativeGamificationOutcome(current, { xp: 200, level: 9, streak: 2 })).toBe(current);
  });

  it('keeps newer progress and applies verified history and threshold inventory once', () => {
    const initial = verifiedGamificationFromDocuments(
      { verifiedXp: 14_399, verifiedStreak: 29 },
      { verifiedByDayV1: { '2026-09-26': 14_399 } },
      { hintTokens: 0, streakFreezes: 0 },
    );
    const awarded = acceptAuthoritativeGamificationOutcome(initial, {
      xp: 14_401, level: 13, streak: 30, studyDay: '2026-09-27', events: ['streak', 'levelup'],
    });
    expect(awarded).toMatchObject({ xp: 14_401, level: 13, streak: 30, xpHistory: { '2026-09-27': 2 } });
    expect(awarded.rewards).toMatchObject({
      unlockedBadgeIds: ['web-wanderer'], ownedFrameIds: ['crimson-wing'], ownedTitleIds: ['word-collector'], hintTokens: 1, streakFreezes: 1,
    });
    expect(acceptAuthoritativeGamificationOutcome(awarded, {
      xp: 14_401, level: 13, streak: 30, studyDay: '2026-09-27', events: ['streak', 'levelup'],
    })).toEqual(awarded);
    expect(acceptAuthoritativeGamificationOutcome(awarded, { xp: 2, level: 1, streak: 1 })).toMatchObject({ xp: 14_401, streak: 30 });
  });

  it('replays an outcome received before hydration over the real baseline', () => {
    const hydrated = verifiedGamificationFromDocuments(
      { verifiedXp: 14_399, verifiedStreak: 29 },
      { verifiedByDayV1: { '2026-09-26': 14_399 } },
      { hintTokens: 0, streakFreezes: 0 },
    );
    const state = replayAuthoritativeGamificationOutcomes(hydrated, [{
      xp: 14_401, level: 13, streak: 30, studyDay: '2026-09-27', events: ['streak', 'levelup'],
    }]);
    expect(state.xpHistory).toEqual({ '2026-09-26': 14_399, '2026-09-27': 2 });
    expect(state.rewards).toMatchObject({ hintTokens: 1, streakFreezes: 1, ownedFrameIds: ['crimson-wing'] });
  });

  it('replays out-of-order outcomes by cumulative XP and deduplicates pending responses', () => {
    const hydrated = verifiedGamificationFromDocuments(
      { verifiedXp: 0, verifiedStreak: 0 }, {}, {},
    );
    const dayTwo = { xp: 20, level: 1, streak: 2, studyDay: '2026-09-28' } as const;
    const dayOne = { xp: 10, level: 1, streak: 1, studyDay: '2026-09-27' } as const;
    expect(replayAuthoritativeGamificationOutcomes(hydrated, [dayTwo, dayOne]).xpHistory)
      .toEqual({ '2026-09-27': 10, '2026-09-28': 10 });
    expect(normalizeDeferredGamificationOutcomes(Array.from(
      { length: 65 }, () => dayOne,
    ))).toEqual([dayOne]);
    const manyDayTwo = Array.from({ length: 64 }, (_, index) => ({
      xp: index + 2, level: 1, streak: 2, studyDay: '2026-09-28',
    }));
    const firstDay = { xp: 1, level: 1, streak: 30, studyDay: '2026-09-27', events: ['streak'] as const };
    const replayed = replayAuthoritativeGamificationOutcomes(hydrated, [...manyDayTwo.reverse(), firstDay]);
    expect(replayed.xpHistory).toEqual({ '2026-09-27': 1, '2026-09-28': 64 });
    expect(replayed.rewards.unlockedBadgeIds).toContain('web-wanderer');
  });
});
