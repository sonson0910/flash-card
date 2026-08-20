import { describe, expect, it } from 'vitest';
import {
  MAX_APPLIED_XP_OPERATION_IDS,
  MAX_GAMIFICATION_HISTORY_ENTRIES,
  addXpToGamification,
  addXpToHistory,
  calculateLocalGamification,
  normalizeAppliedXpOperationIds,
  normalizeAppliedXpSequenceByClient,
  normalizeGamificationHistory,
  normalizePendingXpOperations,
  rebaseGamificationSnapshots,
} from './gamificationModel';

describe('gamification model', () => {
  it('continues a streak only from yesterday and never drops below one', () => {
    const now = new Date('2026-07-13T08:00:00+07:00');
    expect(calculateLocalGamification({
      streak: 4,
      xp: 100,
      lastActive: '2026-07-12T08:00:00+07:00',
    }, now)).toMatchObject({ streak: 5, xp: 100 });
    expect(calculateLocalGamification({
      streak: 4,
      xp: 100,
      lastActive: '2026-07-01T08:00:00+07:00',
    }, now)).toMatchObject({ streak: 1, xp: 100 });
  });

  it('adds XP without mutating previous history', () => {
    const previous = { 'Jul 13, 2026': 10 };
    expect(addXpToHistory(previous, 'Jul 13, 2026', 5)).toEqual({ 'Jul 13, 2026': 15 });
    expect(previous).toEqual({ 'Jul 13, 2026': 10 });
  });

  it('keeps history bounded when adding XP for a new day at capacity', () => {
    const previous = Object.fromEntries(Array.from(
      { length: MAX_GAMIFICATION_HISTORY_ENTRIES },
      (_, index) => [`day-${index.toString().padStart(4, '0')}`, index + 1],
    ));

    const next = addXpToHistory(previous, 'day-0730', 5);

    expect(Object.keys(next)).toHaveLength(MAX_GAMIFICATION_HISTORY_ENTRIES);
    expect(next).not.toHaveProperty('day-0000');
    expect(Object.keys(next)[0]).toBe('day-0001');
    expect(next['day-0730']).toBe(5);
  });

  it('rebases local pending deltas on authoritative cloud XP instead of taking a maximum', () => {
    expect(rebaseGamificationSnapshots({
      streak: 3,
      xp: 110,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 110 },
      pendingOperations: [{ id: 'operation-negative', delta: -10, day: 'Aug 9, 2026' }],
    }, {
      streak: 4,
      xp: 200,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 8, 2026': 20, 'Aug 9, 2026': 180 },
      appliedOperationIds: [],
    })).toEqual({
      streak: 4,
      xp: 190,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 8, 2026': 20, 'Aug 9, 2026': 170 },
      pendingOperations: [{ id: 'operation-negative', delta: -10, day: 'Aug 9, 2026' }],
      appliedOperationIds: [],
    });
  });

  it('drops pending operations already acknowledged by cloud metadata', () => {
    expect(rebaseGamificationSnapshots({
      streak: 2,
      xp: 120,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 120 },
      pendingOperations: [
        { id: 'operation-applied', delta: 10, day: 'Aug 9, 2026' },
        { id: 'operation-pending', delta: -5, day: 'Aug 9, 2026' },
      ],
    }, {
      streak: 2,
      xp: 210,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 210 },
      appliedOperationIds: ['operation-applied'],
    })).toEqual({
      streak: 2,
      xp: 205,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 205 },
      pendingOperations: [{ id: 'operation-pending', delta: -5, day: 'Aug 9, 2026' }],
      appliedOperationIds: ['operation-applied'],
    });
  });

  it('uses a per-client sequence watermark after recent operation IDs are evicted', () => {
    expect(rebaseGamificationSnapshots({
      streak: 2,
      xp: 120,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 120 },
      pendingOperations: [{
        id: 'xp2:client-a:41',
        clientId: 'client-a',
        sequence: 41,
        delta: 10,
        day: 'Aug 9, 2026',
      }],
    }, {
      streak: 2,
      xp: 300,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 300 },
      appliedOperationIds: [],
      appliedOperationSequenceByClient: { 'client-a': 41 },
    })).toEqual({
      streak: 2,
      xp: 300,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 300 },
      appliedOperationIds: [],
      appliedOperationSequenceByClient: { 'client-a': 41 },
    });

    expect(normalizeAppliedXpSequenceByClient({
      'client-a': 41,
      'bad client': 7,
      'client-negative': -1,
      'client-fractional': 1.5,
      'client-huge': Number.POSITIVE_INFINITY,
    })).toEqual({ 'client-a': 41 });
  });

  it('preserves every valid legacy stream instead of silently truncating at sixteen', () => {
    const legacy = Object.fromEntries(Array.from(
      { length: 64 },
      (_, index) => [`legacy-client-${index}`, index + 1],
    ));

    expect(Object.keys(normalizeAppliedXpSequenceByClient(legacy))).toHaveLength(64);
  });

  it('validates untrusted operation metadata and bounds cloud idempotency history', () => {
    expect(normalizeGamificationHistory({
      'Aug 8, 2026': 1.5,
      'Aug 9, 2026': 5,
    })).toEqual({ 'Aug 9, 2026': 5 });

    expect(normalizePendingXpOperations([
      { id: 'valid-operation', delta: -10, day: 'Aug 9, 2026', ignored: true },
      { id: 'valid-operation', delta: 99, day: 'Aug 9, 2026' },
      { id: 'bad delta', delta: Number.POSITIVE_INFINITY, day: 'Aug 9, 2026' },
      { id: 'bad-day', delta: 1, day: '__proto__' },
      {
        id: 'xp2:client-a:42',
        clientId: 'client-a',
        sequence: 42,
        delta: 5,
        day: 'Aug 9, 2026',
      },
      null,
    ])).toEqual([
      { id: 'valid-operation', delta: -10, day: 'Aug 9, 2026' },
      {
        id: 'xp2:client-a:42',
        clientId: 'client-a',
        sequence: 42,
        delta: 5,
        day: 'Aug 9, 2026',
      },
    ]);

    const ids = Array.from(
      { length: MAX_APPLIED_XP_OPERATION_IDS + 10 },
      (_, index) => `operation-${index}`,
    );
    const bounded = normalizeAppliedXpOperationIds(ids);
    expect(bounded).toHaveLength(MAX_APPLIED_XP_OPERATION_IDS);
    expect(bounded[0]).toBe('operation-10');
    expect(bounded.at(-1)).toBe(`operation-${ids.length - 1}`);
  });

  it('updates XP and daily history in one immutable snapshot', () => {
    const previous = {
      streak: 2,
      xp: 120,
      lastActive: 'Sat Aug 08 2026',
      history: { 'Aug 8, 2026': 120 },
    };
    const next = addXpToGamification(previous, 15, new Date('2026-08-09T08:00:00+07:00'));

    expect(next).toEqual({
      streak: 2,
      xp: 135,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 8, 2026': 120, 'Aug 9, 2026': 15 },
    });
    expect(previous).toEqual({
      streak: 2,
      xp: 120,
      lastActive: 'Sat Aug 08 2026',
      history: { 'Aug 8, 2026': 120 },
    });
  });
});
