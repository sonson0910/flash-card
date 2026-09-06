import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import type { CatalogContentChunkV1 } from '../catalogPipeline/catalogContracts';
import type { CardIntakeSharedAdoptionResult } from '../intake/cardIntakeController';
import type { IntakeSharingSessionActions } from '../intake/useIntakeSharingSession';
import { LISTEN_PHRASE_CARDS } from '../listenMvp/listenPhraseCards';
import { adoptListenPhraseCard } from './DailyLearningWorkspace';

const chunk: CatalogContentChunkV1 = {
  schemaVersion: 1,
  id: 'break-the-news',
  language: 'en',
  kind: 'idiom',
  text: 'break the news',
  lexemeIds: [LISTEN_PHRASE_CARDS[0].id],
  contentRights: {
    schemaVersion: 1,
    registryVersion: 1,
    sourceRef: 'voa-break-the-news',
    sourceAssetSha256: 'a'.repeat(64),
  },
};

const resolvedCard: CardData = {
  id: 'legacy-break-the-news',
  word: 'break the news',
  normalizedWord: 'break the news',
  translation: 'báo tin xấu cho ai đó',
  explanation: 'to tell someone bad or upsetting news',
  phonetic: '',
  emoji: '📚',
  category: 'Communication',
  audioUrl: null,
  imageUrl: null,
};

const adopt = (
  result: unknown,
): NonNullable<IntakeSharingSessionActions['adoptCards']> => vi.fn(async () => result as CardIntakeSharedAdoptionResult);

describe('listen phrase intake journey', () => {
  it('maps a listening chunk to its editorial card and returns the fully resolved card', async () => {
    const adoptCards = adopt({
      status: 'completed',
      candidateCount: 1,
      createdCount: 1,
      reusedCount: 0,
      cards: [resolvedCard],
      resolvedCards: [resolvedCard],
    });

    await expect(adoptListenPhraseCard(chunk, adoptCards)).resolves.toEqual([resolvedCard]);
    expect(adoptCards).toHaveBeenCalledWith([expect.objectContaining({
      id: 'word-break-the-news-8cf1bbbc36168e996c96e549',
      word: 'break the news',
      translation: 'báo tin xấu cho ai đó',
      audioUrl: null,
      imageUrl: null,
    })]);
  });

  it('accepts an existing legacy card as the resolved handoff', async () => {
    const adoptCards = adopt({
      status: 'completed',
      candidateCount: 1,
      createdCount: 0,
      reusedCount: 1,
      cards: [],
      resolvedCards: [resolvedCard],
    });

    await expect(adoptListenPhraseCard(chunk, adoptCards)).resolves.toEqual([resolvedCard]);
  });

  it.each([
    ['busy', { status: 'busy' }],
    ['failed', { status: 'failed', error: new Error('failed') }],
    ['stale', { status: 'stale' }],
    ['zero resolved cards', {
      status: 'completed', candidateCount: 1, createdCount: 0, reusedCount: 0, cards: [], resolvedCards: [],
    }],
    ['malformed resolved cards', {
      status: 'completed', candidateCount: 1, createdCount: 1, reusedCount: 0, cards: [resolvedCard], resolvedCards: [{ id: 'wrong' }],
    }],
    ['inconsistent counts', {
      status: 'completed', candidateCount: 1, createdCount: 1, reusedCount: 1, cards: [resolvedCard], resolvedCards: [resolvedCard],
    }],
    ['missing created card', {
      status: 'completed', candidateCount: 1, createdCount: 1, reusedCount: 0, cards: [], resolvedCards: [resolvedCard],
    }],
    ['created card with a different identity', {
      status: 'completed', candidateCount: 1, createdCount: 1, reusedCount: 0,
      cards: [{ ...resolvedCard, id: 'new-card' }], resolvedCards: [resolvedCard],
    }],
    ['non-integer count', {
      status: 'completed', candidateCount: 1, createdCount: 0.5, reusedCount: 0.5, cards: [], resolvedCards: [resolvedCard],
    }],
  ])('rejects %s without reporting a successful save', async (_label, result) => {
    const adoptCards = adopt(result);

    await expect(adoptListenPhraseCard(chunk, adoptCards)).rejects.toThrow();
  });

  it('rejects a chunk that has no T10 editorial phrase mapping', async () => {
    const adoptCards = adopt({
      status: 'completed',
      candidateCount: 1,
      createdCount: 1,
      reusedCount: 0,
      cards: [resolvedCard],
      resolvedCards: [resolvedCard],
    });

    await expect(adoptListenPhraseCard({ ...chunk, lexemeIds: ['unknown-lexeme'] }, adoptCards)).rejects.toThrow();
    expect(adoptCards).not.toHaveBeenCalled();
  });
});
