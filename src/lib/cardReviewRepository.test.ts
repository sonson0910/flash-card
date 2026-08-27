import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../types/card';
import { applyReviewWithConflictRecovery, type ReviewCommand, type ReviewApplyResult } from './cardReviewRepository';

const card: CardData = {
  id: 'word-focus',
  word: 'focus',
  normalizedWord: 'focus',
  translation: 'tập trung',
  explanation: 'to concentrate',
  phonetic: '/ˈfəʊ.kəs/',
  emoji: '🎯',
  category: 'Study',
  audioUrl: null,
  imageUrl: null,
  revision: 3,
  libraryEpoch: 2,
  reviews: 0,
  interval: 0,
  easeFactor: 2.5,
  difficulty: 'unrated',
  reviewHistory: [],
};

const command: ReviewCommand = {
  cardId: card.id,
  opId: 'device-a:review-1',
  baseRevision: 3,
  libraryEpoch: 2,
  rating: 'good',
  reviewedAt: '2026-08-24T00:00:00.000Z',
  fields: { reviewHistory: [] },
  fieldMask: ['reviewHistory'],
};

describe('review conflict recovery', () => {
  it('keeps the review scheduler out of the static repository graph', () => {
    const source = readFileSync(fileURLToPath(new URL('./cardReviewRepository.ts', import.meta.url)), 'utf8');

    expect(source).not.toMatch(/import\s+\{[^}]*scheduleReview[^}]*\}\s+from\s+['"]\.\/reviewScheduler['"]/);
    expect(source).toContain("await import('./reviewScheduler')");
  });

  it('recomputes from the authoritative card and retries exactly once with the same operation', async () => {
    const first: ReviewApplyResult = {
      applied: false,
      reason: 'revision-conflict',
      currentRevision: 4,
      card: { ...card, revision: 4, reviews: 2, reviewHistory: [] },
    };
    const apply = vi.fn<(_: ReviewCommand) => Promise<ReviewApplyResult>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ applied: true, duplicate: false, card: { ...first.card, revision: 5 } });

    const result = await applyReviewWithConflictRecovery(command, apply);

    expect(result).toMatchObject({ applied: true, card: { revision: 5 } });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[1][0]).toMatchObject({
      opId: command.opId,
      baseRevision: 4,
      rating: command.rating,
      reviewedAt: command.reviewedAt,
    });
    expect(apply.mock.calls[1][0].fields.reviewHistory).toHaveLength(1);
  });

  it('does not retry non-revision failures', async () => {
    const result = await applyReviewWithConflictRecovery(
      command,
      vi.fn(async (): Promise<ReviewApplyResult> => ({ applied: false, reason: 'missing' })),
    );
    expect(result).toEqual({ applied: false, reason: 'missing' });
  });
});
