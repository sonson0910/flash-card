import { describe, expect, it } from 'vitest';
import { mergeCardsById, reconcileCardsByAuthoritativeWord } from './deviceStore';

describe('mergeCardsById', () => {
  it('keeps one card per id and lets the incoming version win', () => {
    const existing = [
      { id: 'a', word: 'old', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', word: 'second', createdAt: '2026-01-02T00:00:00.000Z' },
    ];
    const incoming = [
      { id: 'a', word: 'new', createdAt: '2026-01-03T00:00:00.000Z' },
      { id: 'c', word: 'third', createdAt: '2026-01-04T00:00:00.000Z' },
    ];

    expect(mergeCardsById(existing, incoming)).toEqual([
      incoming[1],
      incoming[0],
      existing[1],
    ]);
  });

  it('ignores malformed entries at the storage boundary', () => {
    expect(mergeCardsById([{ id: 'valid' }], [null, {}, { id: 123 }])).toEqual([{ id: 'valid' }]);
  });

  it('does not let an older same-id card overwrite a newer generation or revision', () => {
    const newerGeneration = {
      id: 'generation-card',
      word: 'current generation',
      libraryEpoch: 3,
      revision: 1,
    };
    const newerRevision = {
      id: 'revision-card',
      word: 'current revision',
      libraryEpoch: 2,
      revision: 7,
    };

    expect(mergeCardsById(
      [newerGeneration, newerRevision],
      [
        { ...newerGeneration, word: 'stale generation', libraryEpoch: 2, revision: 99 },
        { ...newerRevision, word: 'stale revision', revision: 6 },
      ],
    )).toEqual(expect.arrayContaining([newerGeneration, newerRevision]));
  });

  it('does not retain two ids for the same normalized word', () => {
    const original = {
      id: 'original',
      word: 'Chance',
      normalizedWord: 'chance',
      createdAt: '2026-01-01T00:00:00.000Z',
      reviewHistory: [{ reviewedAt: '2026-01-02T00:00:00.000Z' }],
      difficulty: 'good',
    };
    const duplicate = {
      id: 'duplicate',
      word: ' chance ',
      createdAt: '2026-02-01T00:00:00.000Z',
      reviewHistory: [],
      difficulty: 'unrated',
    };

    expect(mergeCardsById([original], [duplicate])).toEqual([original]);
  });

  it('lets strict reconciliation prefer authoritative word identity without comparing cross-id revisions', () => {
    const candidate = {
      id: 'candidate-id',
      word: 'Shared Word',
      normalizedWord: 'shared word',
      translation: 'queued',
      libraryEpoch: 2,
      revision: 9,
      createdAt: '2026-08-09T00:00:00.000Z',
    };
    const authoritative = {
      ...candidate,
      id: 'authoritative-id',
      translation: 'cloud',
      revision: 1,
    };

    expect(reconcileCardsByAuthoritativeWord([candidate], [authoritative])).toEqual([
      authoritative,
    ]);
    expect(reconcileCardsByAuthoritativeWord(
      [{ ...candidate, libraryEpoch: 3 }],
      [authoritative],
    )).toEqual([{ ...candidate, libraryEpoch: 3 }]);
  });
});
