import { describe, expect, it } from 'vitest';
import { mergeCardsById, reconcileCardsByAuthoritativeWord } from './sharedDeviceStore';

describe('shared device-store helper', () => {
  it('keeps newer cards and deduplicates the same normalized word', () => {
    const current = {
      id: 'current',
      word: 'Chance',
      normalizedWord: 'chance',
      libraryEpoch: 3,
      revision: 1,
      createdAt: '2026-01-02T00:00:00.000Z',
    };
    const stale = { ...current, word: 'stale', libraryEpoch: 2, revision: 99 };
    const duplicate = { ...current, id: 'duplicate', word: ' chance ', libraryEpoch: 3, revision: 2 };

    expect(mergeCardsById([current], [stale, duplicate])).toEqual([current]);
  });

  it('replaces an optimistic duplicate only with an authoritative card in the same epoch', () => {
    const optimistic = {
      id: 'optimistic', word: 'Shared', normalizedWord: 'shared', libraryEpoch: 2, revision: 9,
    };
    const authoritative = { ...optimistic, id: 'authoritative', revision: 1 };

    expect(reconcileCardsByAuthoritativeWord([optimistic], [authoritative])).toEqual([authoritative]);
    expect(reconcileCardsByAuthoritativeWord(
      [{ ...optimistic, libraryEpoch: 3 }],
      [authoritative],
    )).toEqual([{ ...optimistic, libraryEpoch: 3 }]);
  });
});
