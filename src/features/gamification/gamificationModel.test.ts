import { describe, expect, it } from 'vitest';
import { addXpToHistory, calculateLocalGamification } from './gamificationModel';

describe('gamification model', () => {
  it('continues a streak only from yesterday and never drops below one', () => {
    const now = new Date('2026-07-13T08:00:00+07:00');
    expect(calculateLocalGamification({ streak: 4, xp: 100, lastActive: '2026-07-12T08:00:00+07:00' }, now)).toMatchObject({ streak: 5, xp: 100 });
    expect(calculateLocalGamification({ streak: 4, xp: 100, lastActive: '2026-07-01T08:00:00+07:00' }, now)).toMatchObject({ streak: 1, xp: 100 });
  });

  it('adds XP without mutating the previous history', () => {
    const previous = { 'Jul 13, 2026': 10 };
    expect(addXpToHistory(previous, 'Jul 13, 2026', 5)).toEqual({ 'Jul 13, 2026': 15 });
    expect(previous).toEqual({ 'Jul 13, 2026': 10 });
  });
});
