import { describe, expect, it } from 'vitest';
import type { CardData } from '../types/card';
import {
  applyCardPatch,
  buildCardTombstone,
  evaluateMutationPrecondition,
  normalizeCardOperationId,
  prepareCardForCreate,
} from './cardMutationProtocol';

const card: CardData = {
  id: 'word-quite',
  word: 'quite',
  normalizedWord: 'quite',
  translation: 'khá',
  explanation: '',
  phonetic: '',
  emoji: '📝',
  category: 'Other',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-07-01T00:00:00.000Z',
};

describe('card mutation protocol', () => {
  it('prepares a backward-compatible card with an immutable v2 creation revision', () => {
    expect(prepareCardForCreate(card, { libraryEpoch: 4 })).toEqual({
      ...card,
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 4,
    });
  });

  it('applies only the declared field mask and advances the revision', () => {
    const result = applyCardPatch(
      { ...card, schemaVersion: 2, revision: 7, libraryEpoch: 4 },
      {
        translation: 'hoàn toàn',
        imageUrl: 'https://images.pexels.com/quite.jpeg',
      },
      ['imageUrl'],
    );

    expect(result).toEqual({
      ...card,
      imageUrl: 'https://images.pexels.com/quite.jpeg',
      schemaVersion: 2,
      revision: 8,
      libraryEpoch: 4,
    });
  });

  it('persists mnemonic enrichment through the declared mutation mask', () => {
    const result = applyCardPatch(
      { ...card, schemaVersion: 2, revision: 7, libraryEpoch: 4 },
      { mnemonic: 'A resilient spring bounces back.' },
      ['mnemonic'],
    );

    expect(result.mnemonic).toBe('A resilient spring bounces back.');
    expect(result.revision).toBe(8);
  });

  it('rejects stale library epochs, stale revisions and mutations shadowed by tombstones', () => {
    expect(evaluateMutationPrecondition({
      mutationEpoch: 2,
      currentLibraryEpoch: 3,
      baseRevision: 8,
      currentRevision: 8,
    })).toEqual({ accepted: false, reason: 'stale-library-epoch' });
    expect(evaluateMutationPrecondition({
      mutationEpoch: 3,
      currentLibraryEpoch: 3,
      baseRevision: 7,
      currentRevision: 8,
    })).toEqual({ accepted: false, reason: 'revision-conflict' });
    expect(evaluateMutationPrecondition({
      mutationEpoch: 3,
      currentLibraryEpoch: 3,
      baseRevision: 8,
      currentRevision: 8,
      tombstoneRevision: 9,
    })).toEqual({ accepted: false, reason: 'deleted' });
  });

  it('allows an explicit recreate only above the tombstone revision in the current epoch', () => {
    expect(evaluateMutationPrecondition({
      mutationEpoch: 3,
      currentLibraryEpoch: 3,
      baseRevision: 9,
      currentRevision: 9,
      tombstoneRevision: 9,
      operation: 'create',
    })).toEqual({ accepted: true });
  });

  it('builds a revisioned tombstone tied to the library epoch and operation id', () => {
    expect(buildCardTombstone({
      cardId: card.id,
      opId: 'delete-op',
      libraryEpoch: 5,
      baseRevision: 11,
      deletedAt: '2026-07-26T00:00:00.000Z',
    })).toEqual({
      cardId: card.id,
      opId: 'delete-op',
      libraryEpoch: 5,
      revision: 12,
      deletedAt: '2026-07-26T00:00:00.000Z',
    });
  });

  it('rejects revision increments beyond the maximum safe counter', () => {
    const maxSafe = Number.MAX_SAFE_INTEGER;
    const current = { ...card, schemaVersion: 2 as const, revision: maxSafe, libraryEpoch: 5 };

    expect(() => applyCardPatch(current, { bookmarked: true }, ['bookmarked'])).toThrow(/revision/i);
    expect(() => buildCardTombstone({
      cardId: 'max-safe',
      opId: 'delete-max-safe',
      libraryEpoch: 5,
      baseRevision: maxSafe,
      deletedAt: '2026-08-23T00:00:00.000Z',
    })).toThrow(/revision/i);
  });

  it('converts legacy operation ids into deterministic values accepted by Firestore Rules', () => {
    const legacyId = 'legacy-delete-word-quite-2026-07-26T04:12:03.456Z';
    const normalized = normalizeCardOperationId(legacyId);

    expect(normalized).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
    expect(normalized).toBe(normalizeCardOperationId(legacyId));
    expect(normalizeCardOperationId('delete-op_123')).toBe('delete-op_123');
  });
});
