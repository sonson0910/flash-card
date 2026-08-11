import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import { buildDailyPlan } from '../dailyLearning/dailyPlan';
import {
  beginCatalogLibraryAdd,
  catalogEntryIsInLibrary,
  catalogEntryToLibraryCard,
  createCatalogLibraryIdentityIndex,
  createCatalogOptimisticLibraryState,
  mergeCatalogEntryIntoLibrary,
  scopeCatalogOptimisticLibraryState,
  settleCatalogLibraryAdd,
} from './catalogLearningFlow';
import type { CatalogVocabularyPresentation } from './catalogPresentation';

const entry: CatalogVocabularyPresentation = {
  id: 'published-analysis',
  lemma: 'Analysis',
  language: 'en',
  phonetic: '/\u0259\u02c8n\u00e6l\u0259s\u026as/',
  partOfSpeech: 'noun',
  cefr: 'B2',
  tier: 'foundation',
  topics: ['Education'],
  skills: ['Reading'],
  meaning: 'a careful study of something',
  meaningLanguage: 'en',
  translation: 's\u1ef1 ph\u00e2n t\u00edch',
  translationLanguage: 'vi',
  example: 'The report contains a detailed analysis.',
  exampleTranslation: 'B\u00e1o c\u00e1o c\u00f3 ph\u00e2n t\u00edch chi ti\u1ebft.',
  collocations: ['detailed analysis'],
  provenance: {
    sourceLabel: 'Published editorial catalog',
    licenseLabel: 'CC BY 4.0',
    reviewerLabel: 'Editorial review recorded',
  },
};

describe('catalog learning flow', () => {
  it('maps a published entry to an unrated learner card that Today can plan', () => {
    const card = catalogEntryToLibraryCard(entry, '2026-08-04T04:00:00.000Z');
    const plan = buildDailyPlan([card], { now: new Date('2026-08-04T04:00:00.000Z') });

    expect(card).toMatchObject({
      id: 'word-analysis',
      word: 'analysis',
      translation: 's\u1ef1 ph\u00e2n t\u00edch',
      explanation: 'a careful study of something',
      difficulty: 'unrated',
      reviews: 0,
    });
    expect(plan.items.map(item => item.card.id)).toEqual(['word-analysis']);
  });

  it('adds the same catalog entry idempotently by normalized word', () => {
    const first = mergeCatalogEntryIntoLibrary([], entry, '2026-08-04T04:00:00.000Z');
    const second = mergeCatalogEntryIntoLibrary(first.cards, { ...entry, id: 'another-release-id', lemma: ' analysis ' }, '2026-08-04T05:00:00.000Z');

    expect(first.status).toBe('created');
    expect(second.status).toBe('existing');
    expect(second.cards).toHaveLength(1);
    expect(second.card).toBe(first.card);
  });

  it('recognizes an actual review as learning activity but not a merely added card', () => {
    const added = catalogEntryToLibraryCard(entry, '2026-08-04T04:00:00.000Z');
    const reviewed: CardData = {
      ...added,
      difficulty: 'good',
      reviews: 1,
      reviewHistory: [{ rating: 'good', reviewedAt: '2026-08-04T05:00:00.000Z', scheduledDays: 1, elapsedDays: 0 }],
    };

    expect(added.reviewHistory).toBeUndefined();
    expect(reviewed.reviewHistory).toHaveLength(1);
  });

  it('indexes normalized library identities once for constant-time catalog membership checks', () => {
    const card = catalogEntryToLibraryCard(entry);
    const index = createCatalogLibraryIdentityIndex([
      { ...card, word: '  ANALYSIS ', normalizedWord: '' },
    ]);

    expect(index).toEqual(new Set(['analysis']));
    expect(catalogEntryIsInLibrary(index, { lemma: ' Analysis ' })).toBe(true);
    expect(catalogEntryIsInLibrary(index, { lemma: 'synthesis' })).toBe(false);
  });

  it('scopes optimistic additions to their owner and ignores a stale settlement', () => {
    const ownerA = createCatalogOptimisticLibraryState('owner-a');
    const pending = beginCatalogLibraryAdd(ownerA, 'owner-a', 0, entry.id);
    const ownerB = scopeCatalogOptimisticLibraryState(pending.state, 'owner-b', 1);
    const settled = settleCatalogLibraryAdd(ownerB, 'owner-b', 1, pending.token, 'created');

    expect(pending.state.addingCardIds).toEqual(new Set([entry.id]));
    expect(ownerB).toEqual(createCatalogOptimisticLibraryState('owner-b', 1));
    expect(settled).toEqual(ownerB);
  });

  it('ignores an old promise even if the same owner signs in again later', () => {
    const firstSession = createCatalogOptimisticLibraryState('owner-a', 0);
    const pending = beginCatalogLibraryAdd(firstSession, 'owner-a', 0, entry.id);
    const laterSession = scopeCatalogOptimisticLibraryState(pending.state, 'owner-a', 2);
    const settled = settleCatalogLibraryAdd(laterSession, 'owner-a', 2, pending.token, 'created');

    expect(settled).toEqual(laterSession);
    expect(settled.addedCardIds).toEqual(new Set());
  });

  it('moves a current optimistic addition to added only after a successful result', () => {
    const initial = createCatalogOptimisticLibraryState('owner-a');
    const pending = beginCatalogLibraryAdd(initial, 'owner-a', 0, entry.id);
    const failed = settleCatalogLibraryAdd(pending.state, 'owner-a', 0, pending.token, 'failed');
    const successfulPending = beginCatalogLibraryAdd(failed, 'owner-a', 0, entry.id);
    const successful = settleCatalogLibraryAdd(
      successfulPending.state,
      'owner-a',
      0,
      successfulPending.token,
      'existing',
    );

    expect(failed.addingCardIds).toEqual(new Set());
    expect(failed.addedCardIds).toEqual(new Set());
    expect(failed.failedCardIds).toEqual(new Set([entry.id]));
    expect(successfulPending.state.failedCardIds).toEqual(new Set());
    expect(successful.addingCardIds).toEqual(new Set());
    expect(successful.addedCardIds).toEqual(new Set([entry.id]));
    expect(successful.failedCardIds).toEqual(new Set());
  });
});
