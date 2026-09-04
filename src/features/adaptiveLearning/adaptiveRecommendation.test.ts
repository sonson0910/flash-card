import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import type { SkillStateV4 } from '../skillEvidence/skillEvidenceModel';
import { createCourseItemId, type CourseItemV1 } from '../courses/courseModel';
import {
  createAdaptiveCandidateId,
  recommendNextActivity,
  type AdaptiveCandidateV1,
} from './adaptiveRecommendation';

const state = (listening: number | null, targetId: string): SkillStateV4 => ({
  schemaVersion: 4,
  ownerId: 'owner-a',
  target: { kind: 'lexeme', id: targetId },
  asOf: '2026-09-04T00:00:00.000Z',
  dimensions: {
    recognition: {
      score: 1,
      observations: 5,
      confidence: 1,
      lastObservedAt: '2026-09-04T00:00:00.000Z',
    },
    listening: {
      score: listening,
      observations: listening === null ? 0 : 5,
      confidence: listening === null ? 0 : 1,
      lastObservedAt: listening === null ? null : '2026-09-04T00:00:00.000Z',
    },
    context: {
      score: 1,
      observations: 5,
      confidence: 1,
      lastObservedAt: '2026-09-04T00:00:00.000Z',
    },
    production: {
      score: 1,
      observations: 5,
      confidence: 1,
      lastObservedAt: '2026-09-04T00:00:00.000Z',
    },
    pronunciation: { score: null, observations: 0, confidence: 0, lastObservedAt: null },
    speechMatch: { score: null, observations: 0, confidence: 0, lastObservedAt: null },
  },
});

const card = (id: string, overrides: Partial<CardData> = {}): CardData => ({
  id,
  word: id,
  normalizedWord: id,
  translation: `meaning-${id}`,
  explanation: '',
  phonetic: '',
  emoji: '📘',
  category: 'General',
  audioUrl: 'https://api.dictionaryapi.dev/audio.mp3',
  imageUrl: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  customDeck: null,
  difficulty: 'unrated',
  ...overrides,
});

const candidate = (
  id: string,
  overrides: Partial<AdaptiveCandidateV1> = {},
): AdaptiveCandidateV1 => {
  const item: CourseItemV1 = {
    schemaVersion: 1,
    id: createCourseItemId('course-a', 'scenario-a', id),
    courseId: 'course-a',
    scenarioId: 'scenario-a',
    lexemeId: id,
    rank: 1,
  };
  return {
    courseId: 'course-a',
    scenarioId: 'scenario-a',
    item,
    card: card(id),
    skillState: null,
    context: { chunkIds: [], hasExample: false },
    media: { licensedAudio: false, clipId: null, transcriptReady: false, availableOffline: false },
    ...overrides,
  };
};

const options = (overrides: Partial<Parameters<typeof recommendNextActivity>[1]> = {}) => ({
  activeCourseId: 'course-a',
  activeScenarioId: 'scenario-a',
  now: new Date('2026-09-04T08:00:00.000Z'),
  focus: 'balanced' as const,
  sessionSize: 'standard' as const,
  isOffline: false,
  recentModes: [],
  skippedActivityIds: new Set<string>(),
  introducedItemIds: new Set<string>(),
  newItemsRemaining: 8,
  ...overrides,
});

describe('adaptive recommendation', () => {
  it('prioritizes an overdue item before a new item and reports the session bound', () => {
    const result = recommendNextActivity([
      candidate('new-item'),
      candidate('due-item', {
        card: card('due-item', {
          nextReviewDate: '2026-09-03T08:00:00.000Z',
          reviews: 1,
          difficulty: 'hard',
        }),
      }),
    ], options());

    expect(result).toMatchObject({
      kind: 'exercise',
      lexemeId: 'due-item',
      reason: { kind: 'due' },
      window: { targetActivities: 10, maximumNewItems: 8 },
    });
  });

  it('keeps the same recommendation when candidate input order changes', () => {
    const input = [
      candidate('rank-two', { item: { ...candidate('rank-two').item, rank: 2 } }),
      candidate('rank-one', { item: { ...candidate('rank-one').item, rank: 1 } }),
    ];
    const first = recommendNextActivity(input, options());
    const second = recommendNextActivity([...input].reverse(), options());

    expect(second).toEqual(first);
  });

  it('uses a verified licensed clip for Hear and never emits one offline when uncached', () => {
    const input = [candidate('immerse-item', {
      media: { licensedAudio: true, clipId: 'clip-1', transcriptReady: true, availableOffline: false },
    })];
    const offline = recommendNextActivity(input, options({ focus: 'hear', isOffline: true }));
    expect(offline).toMatchObject({ kind: 'exercise', mode: 'active-recall', fallbackFrom: 'hear' });

    const online = recommendNextActivity(input, options({ focus: 'hear' }));
    expect(online).toMatchObject({ kind: 'immerse', clipId: 'clip-1' });
  });

  it('does not label a successful listening activity as a Hear fallback', () => {
    const result = recommendNextActivity([candidate('listening-item')], options({ focus: 'hear' }));

    expect(result).toMatchObject({ kind: 'exercise', mode: 'listening' });
    expect(result).not.toHaveProperty('fallbackFrom');
  });

  it('rejects candidate sets larger than the bounded recommendation window', () => {
    expect(() => recommendNextActivity(
      Array.from({ length: 16 }, (_, index) => candidate(`bounded-${index}`)),
      options(),
    )).toThrow(/at most 15/i);
  });

  it('returns no eligible activity when the new-item budget is exhausted', () => {
    const result = recommendNextActivity([candidate('new-item')], options({ newItemsRemaining: 0 }));

    expect(result).toMatchObject({ kind: 'empty', reason: 'no-eligible-activity' });
  });

  it('still practices an already-introduced new card when the introduction budget is exhausted', () => {
    const introduced = candidate('introduced-new-item');
    const result = recommendNextActivity([introduced], options({
      newItemsRemaining: 0,
      introducedItemIds: new Set([introduced.item.id]),
    }));

    expect(result).toMatchObject({ kind: 'exercise', reason: { kind: 'new' } });
  });

  it('does not bypass an exhausted new-item budget through the next-item path', () => {
    const result = recommendNextActivity([candidate('unintroduced-item', {
      card: card('unintroduced-item', {
        difficulty: 'good',
        reviews: 3,
        nextReviewDate: '2026-10-01T00:00:00.000Z',
      }),
      skillState: state(1, 'unintroduced-item'),
    })], options({ newItemsRemaining: 0 }));

    expect(result).toMatchObject({ kind: 'empty', reason: 'no-eligible-activity' });
  });

  it('does not bypass an exhausted new-item budget through a due item', () => {
    const result = recommendNextActivity([candidate('unintroduced-due-item', {
      card: card('unintroduced-due-item', {
        difficulty: 'hard',
        reviews: 1,
        nextReviewDate: '2026-09-03T00:00:00.000Z',
      }),
    })], options({ newItemsRemaining: 0 }));

    expect(result).toMatchObject({ kind: 'empty', reason: 'no-eligible-activity' });
  });

  it('does not bypass an exhausted new-item budget through a skill gap', () => {
    const result = recommendNextActivity([candidate('unintroduced-gap-item', {
      card: card('unintroduced-gap-item', {
        difficulty: 'good',
        reviews: 3,
        nextReviewDate: '2026-10-01T00:00:00.000Z',
      }),
      skillState: state(null, 'unintroduced-gap-item'),
    })], options({ newItemsRemaining: 0 }));

    expect(result).toMatchObject({ kind: 'empty', reason: 'no-eligible-activity' });
  });

  it('never selects a remote CardData audio URL for balanced offline practice', () => {
    const result = recommendNextActivity([candidate('offline-gap', {
      card: card('offline-gap', {
        difficulty: 'good',
        reviews: 3,
        nextReviewDate: '2026-10-01T00:00:00.000Z',
      }),
      skillState: state(null, 'offline-gap'),
      media: { licensedAudio: false, clipId: null, transcriptReady: false, availableOffline: true },
    })], options({ isOffline: true }));

    expect(result).toMatchObject({ kind: 'exercise', mode: 'active-recall' });
  });

  it('uses the lowest eligible SkillState dimension after review/new priorities', () => {
    const result = recommendNextActivity([candidate('mature-item', {
      card: card('mature-item', {
        difficulty: 'good',
        reviews: 3,
        nextReviewDate: '2026-10-01T00:00:00.000Z',
      }),
      skillState: state(null, 'mature-item'),
    })], options());

    expect(result).toMatchObject({
      kind: 'exercise',
      lexemeId: 'mature-item',
      mode: 'listening',
      reason: { kind: 'skill-gap' },
    });
  });

  it('keeps the lowest skill-gap candidate ahead of a higher-ranked mild gap', () => {
    const mild = candidate('mild-gap', {
      item: { ...candidate('mild-gap').item, rank: 1 },
      skillState: state(0.8, 'mild-gap'),
      card: card('mild-gap', {
        difficulty: 'good',
        reviews: 3,
        nextReviewDate: '2026-10-01T00:00:00.000Z',
      }),
    });
    const severe = candidate('severe-gap', {
      item: { ...candidate('severe-gap').item, rank: 2 },
      skillState: state(0.1, 'severe-gap'),
      card: card('severe-gap', {
        difficulty: 'good',
        reviews: 3,
        nextReviewDate: '2026-10-01T00:00:00.000Z',
      }),
    });
    const result = recommendNextActivity(
      [mild, severe],
      options({
        introducedItemIds: new Set([mild.item.id, severe.item.id]),
      }),
    );

    expect(result).toMatchObject({ lexemeId: 'severe-gap', reason: { kind: 'skill-gap' } });
  });

  it('falls back from Speak without claiming pronunciation or speech assessment', () => {
    const result = recommendNextActivity([candidate('speak-item')], options({ focus: 'speak' }));

    expect(result).toMatchObject({
      kind: 'exercise',
      mode: 'active-recall',
      fallbackFrom: 'speak',
    });
    expect(JSON.stringify(result)).not.toMatch(/pronunciation|native|accent|fluency|prosody/i);
  });

  it('temporarily deprioritizes a skipped candidate without mutating its card', () => {
    const skipped = candidate('skipped-item');
    const next = candidate('next-item', {
      item: { ...skipped.item, id: createCourseItemId('course-a', 'scenario-a', 'next-item'), lexemeId: 'next-item' },
    });
    const result = recommendNextActivity([
      skipped,
      next,
    ], options({ skippedActivityIds: new Set([createAdaptiveCandidateId(skipped)]) }));

    expect(result).toMatchObject({ lexemeId: 'next-item' });
    expect(skipped.card.difficulty).toBe('unrated');
  });

  it('returns explicit empty/completion states for bounded candidate sets', () => {
    expect(recommendNextActivity([], options())).toMatchObject({ kind: 'empty', reason: 'no-content' });

    const mature = candidate('complete-item', {
      card: card('complete-item', {
        difficulty: 'good',
        reviews: 4,
        nextReviewDate: '2026-10-01T00:00:00.000Z',
      }),
      skillState: state(1, 'complete-item'),
    });
    expect(recommendNextActivity([mature], options({
      introducedItemIds: new Set([mature.item.id]),
    }))).toMatchObject({ kind: 'course-complete' });

    expect(recommendNextActivity([mature], options())).toMatchObject({
      kind: 'exercise',
      lexemeId: 'complete-item',
      reason: { kind: 'next' },
    });
  });

  it('uses an adapter-declared context capability instead of dead chunk metadata', () => {
    const base = candidate('context-item', {
      card: card('context-item', {
        audioUrl: null,
        exampleSentence: 'We use context-item today.',
      }),
      skillState: state(1, 'context-item'),
    });
    const withoutContext = recommendNextActivity([base], options());
    const withContext = recommendNextActivity([{
      ...base,
      context: { chunkIds: ['chunk-1'], hasExample: true },
    }], options());

    expect(withoutContext).toMatchObject({ kind: 'exercise', mode: 'active-recall' });
    expect(withContext).toMatchObject({ kind: 'exercise', mode: 'cloze' });
  });

  it('rejects unsafe active course identifiers before selecting content', () => {
    expect(() => recommendNextActivity([], options({ activeCourseId: 'course\u0000a' })))
      .toThrow(/activeCourseId/i);
  });

  it('rejects non-canonical or unsafe media clip identifiers', () => {
    expect(() => recommendNextActivity([candidate('bad-clip', {
      media: { licensedAudio: true, clipId: ' ', transcriptReady: true, availableOffline: true },
    })], options({ focus: 'hear' }))).toThrow(/media|clipId/i);
    expect(() => recommendNextActivity([candidate('slash-clip', {
      media: { licensedAudio: true, clipId: 'clip/1', transcriptReady: true, availableOffline: true },
    })], options({ focus: 'hear' }))).toThrow(/media|clipId/i);
  });

  it('does not apply SkillState from a different learner target', () => {
    expect(() => recommendNextActivity([candidate('target-item', {
      skillState: state(null, 'other-item'),
    })], options())).toThrow(/skill state target/i);
  });
});
