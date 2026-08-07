import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import { createMultilingualCardReader } from './multilingualCardReader';
import { planV2CardMigration } from './v2Migration';

const legacy: CardData = {
  schemaVersion: 2,
  id: 'word-focus', word: 'focus', normalizedWord: 'focus', translation: 'tập trung',
  explanation: 'Give attention.', phonetic: '', emoji: '🎯', category: 'General',
  audioUrl: null, imageUrl: null, createdAt: '2026-01-01T00:00:00.000Z',
  bookmarked: true, difficulty: 'good', reviewHistory: [], correctStreak: 2,
};

describe('multilingualCardReader', () => {
  it('loads validated v3 aggregates through one bounded production-facing port', async () => {
    const bundle = planV2CardMigration({
      ownerId: 'owner-a', sourceDocumentId: 'legacy-focus', card: legacy,
      migratedAt: '2026-08-03T00:00:00.000Z',
    });
    const fetchSources = async () => [{
      documentId: bundle.lexeme.id,
      learningState: bundle.learningState,
      lexeme: bundle.lexeme,
      memberships: bundle.memberships,
    }];
    const reader = createMultilingualCardReader({ fetchSources });

    const result = await reader.readOwnerLibrary('owner-a', 50);

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({ id: 'word-focus', bookmarked: true });
    expect(result.rejected).toEqual([]);
  });

  it('quarantines missing or malformed joined sources without manufacturing cards', async () => {
    const reader = createMultilingualCardReader({
      fetchSources: async () => [{
        documentId: 'lexeme-missing', learningState: { ownerId: 'owner-a' },
        lexeme: null, memberships: [],
      }],
    });

    const result = await reader.readOwnerLibrary('owner-a', 20);

    expect(result.cards).toEqual([]);
    expect(result.rejected).toEqual([{ documentId: 'lexeme-missing', reason: expect.any(String) }]);
  });

  it('bounds reads and requires a non-empty owner', async () => {
    const requested: number[] = [];
    const reader = createMultilingualCardReader({
      fetchSources: async (_ownerId, maximum) => { requested.push(maximum); return []; },
    });

    await reader.readOwnerLibrary('owner-a', 10_000);
    expect(requested).toEqual([100]);
    await expect(reader.readOwnerLibrary('', 10)).rejects.toThrow(/owner/i);
  });
});
