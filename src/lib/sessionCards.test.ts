import { describe, expect, it } from 'vitest';
import {
  canUseDeviceBackupForSession,
  planCardsForSignedInSession,
  retainCardsForSession,
  selectCardsVisibleForSession,
} from './sessionCards';

const cachedCards = [{ id: 'private-card' }];

describe('selectCardsVisibleWithoutAuthentication', () => {
  it('hides a card cache owned by a signed-in account', () => {
    expect(selectCardsVisibleForSession(cachedCards, 'user-1', null)).toEqual([]);
  });

  it('keeps cards created in an anonymous-only session visible', () => {
    expect(selectCardsVisibleForSession(cachedCards, null, null)).toEqual(cachedCards);
  });

  it('never gives one account the local cache of another account', () => {
    expect(selectCardsVisibleForSession(cachedCards, 'user-1', 'user-2')).toEqual([]);
    expect(selectCardsVisibleForSession(cachedCards, 'user-1', 'user-1')).toEqual(cachedCards);
  });
});

describe('canUseDeviceBackupForSession', () => {
  it('only exposes a shared backup to its matching signed-in account', () => {
    expect(canUseDeviceBackupForSession('user-1', 'user-1')).toBe(true);
    expect(canUseDeviceBackupForSession('user-1', 'user-2')).toBe(false);
    expect(canUseDeviceBackupForSession('user-1', null)).toBe(false);
    expect(canUseDeviceBackupForSession(null, null)).toBe(true);
  });
});

describe('planCardsForSignedInSession', () => {
  it('preserves anonymous cards and marks them for migration into the first signed-in account', () => {
    expect(planCardsForSignedInSession(cachedCards, null, 'user-1')).toEqual({
      visibleCards: cachedCards,
      cardsToMigrate: cachedCards,
      discardLocalCache: false,
    });
  });

  it('keeps a matching account cache without re-importing it', () => {
    expect(planCardsForSignedInSession(cachedCards, 'user-1', 'user-1')).toEqual({
      visibleCards: cachedCards,
      cardsToMigrate: [],
      discardLocalCache: false,
    });
  });

  it('never migrates or displays a cache owned by another account', () => {
    expect(planCardsForSignedInSession(cachedCards, 'user-1', 'user-2')).toEqual({
      visibleCards: [],
      cardsToMigrate: [],
      discardLocalCache: true,
    });
  });
});

describe('retainCardsForSession', () => {
  it('keeps the complete anonymous library while bounding a signed-in cloud page', () => {
    const cards = Array.from({ length: 12 }, (_, id) => ({ id }));

    expect(retainCardsForSession(cards, false, 9)).toHaveLength(12);
    expect(retainCardsForSession(cards, true, 9)).toEqual(cards.slice(0, 9));
  });
});
