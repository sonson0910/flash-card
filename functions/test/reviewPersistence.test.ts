import type { DocumentData, DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  applyReviewForOwner,
  parseReviewRequest,
  type ReviewRequest,
} from '../src/reviewPersistence.js';
import { scheduleReviewTransition } from '../src/reviewScheduler.js';

const snapshot = (exists: boolean, data?: DocumentData): DocumentSnapshot => ({
  exists,
  data: () => data,
} as DocumentSnapshot);

const baseCard = (reviewHistory: unknown[] = [], operationIds: string[] = []) => ({
  id: 'word-focus',
  word: 'focus',
  normalizedWord: 'focus',
  translation: 'tập trung',
  explanation: 'to concentrate',
  explanationTranslation: 'tập trung',
  phonetic: '/ˈfəʊ.kəs/',
  category: 'Study',
  emoji: '🎯',
  audioUrl: null,
  imageUrl: null,
  imageSearchQuery: 'focus study',
  createdAt: '2026-08-01T00:00:00.000Z',
  bookmarked: false,
  customDeck: null,
  difficulty: 'unrated',
  reviews: 0,
  interval: 0,
  easeFactor: 2.5,
  correctStreak: 0,
  partOfSpeech: 'verb',
  cefrLevel: 'B1',
  exampleSentence: 'Focus on the task.',
  exampleTranslation: 'Tập trung vào nhiệm vụ.',
  collocations: [],
  synonyms: [],
  antonyms: [],
  register: '',
  commonMistake: '',
  reviewHistory,
  appliedReviewOperationIds: operationIds,
  schemaVersion: 2,
  revision: 3,
  libraryEpoch: 2,
});

const reviewRequest = (overrides: Partial<ReviewRequest> = {}): ReviewRequest => ({
  opId: 'device-a:review-1',
  cardId: 'word-focus',
  baseRevision: 3,
  libraryEpoch: 2,
  rating: 'good',
  reviewedAt: '2026-08-24T00:00:00.000Z',
  fields: {
    difficulty: 'good',
    nextReviewDate: '2026-08-24T00:10:00.000Z',
    reviews: 1,
    interval: 0,
    easeFactor: 2.788189603,
    fsrs: {
      due: '2026-08-24T00:10:00.000Z',
      stability: 2.3065,
      difficulty: 2.11810397,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 1,
      reps: 1,
      lapses: 0,
      state: 1,
      lastReview: '2026-08-24T00:00:00.000Z',
    },
    reviewHistory: [{
      rating: 'good',
      reviewedAt: '2026-08-24T00:00:00.000Z',
      scheduledDays: 0,
      elapsedDays: 0,
    }],
    correctStreak: 1,
  },
  fieldMask: [
    'difficulty', 'nextReviewDate', 'reviews', 'interval', 'easeFactor',
    'fsrs', 'reviewHistory', 'correctStreak',
  ],
  ...overrides,
});

const harness = (card = baseCard()) => {
  const values = new Map<string, DocumentSnapshot>([
    ['users/owner/profile/library_state', snapshot(true, { libraryEpoch: 2 })],
    ['users/owner/cards/word-focus', snapshot(true, card)],
  ]);
  const writes: Array<{ path: string; data: DocumentData }> = [];
  const transaction = {
    get: vi.fn(async (reference: DocumentReference) => values.get(reference.path) ?? snapshot(false)),
    set: vi.fn((reference: DocumentReference, data: DocumentData) => {
      writes.push({ path: reference.path, data });
      return transaction;
    }),
  } as unknown as Transaction;
  const database = {
    collection: (name: string) => ({
      doc: (ownerId: string) => ({
        collection: (subcollection: string) => ({
          doc: (id: string) => ({ path: `${name}/${ownerId}/${subcollection}/${id}` }),
        }),
        path: `${name}/${ownerId}`,
      }),
    }),
    runTransaction: vi.fn(async (update: (value: Transaction) => Promise<unknown>) => update(transaction)),
  } as unknown as Firestore;
  return { database, writes, values };
};

describe('review persistence', () => {
  it('parses only the complete bounded review protocol', () => {
    expect(parseReviewRequest(reviewRequest())).toMatchObject({ opId: 'device-a:review-1' });
    expect(() => parseReviewRequest({ ...reviewRequest(), fieldMask: ['reviewHistory'] })).toThrow();
    expect(() => parseReviewRequest({ ...reviewRequest(), opId: '../unsafe' })).toThrow();
  });

  it('appends one review, increments the revision, and stores the bounded receipt', async () => {
    const test = harness();
    await expect(applyReviewForOwner(test.database, 'owner', reviewRequest())).resolves.toMatchObject({
      applied: true,
      duplicate: false,
      card: { revision: 4, appliedReviewOperationIds: ['device-a:review-1'] },
    });
    expect(test.writes[0]).toMatchObject({ path: 'users/owner/cards/word-focus' });
  });

  it('returns the authoritative card for duplicate operations without writing', async () => {
    const test = harness(baseCard([], ['device-a:review-1']));
    await expect(applyReviewForOwner(test.database, 'owner', reviewRequest({ baseRevision: 0 }))).resolves.toMatchObject({
      applied: true,
      duplicate: true,
      card: { revision: 3 },
    });
    expect(test.writes).toEqual([]);
  });

  it('returns a bounded authoritative card on revision conflict', async () => {
    const test = harness();
    await expect(applyReviewForOwner(test.database, 'owner', reviewRequest({ baseRevision: 2 }))).rejects.toMatchObject({
      reason: 'revision-conflict',
      currentRevision: 3,
      card: { id: 'word-focus', revision: 3 },
    });
    expect(test.writes).toEqual([]);
  });

  it('rejects malformed retained history before any write', async () => {
    const test = harness(baseCard([{
      rating: 'good', reviewedAt: '2026-08-01T00:00:00.000Z', scheduledDays: 1, elapsedDays: 0, extra: true,
    }]));
    await expect(applyReviewForOwner(test.database, 'owner', reviewRequest())).rejects.toThrow();
    expect(test.writes).toEqual([]);
  });

  it('trims a valid 101-entry transition and rejects malformed entries beyond the Rules sample', async () => {
    const history: Array<Record<string, unknown>> = Array.from({ length: 100 }, (_, index) => ({
      rating: 'good',
      reviewedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      scheduledDays: 1,
      elapsedDays: 0,
    }));
    const finalEntry = {
      rating: 'good',
      reviewedAt: '2026-08-24T00:00:00.000Z',
      scheduledDays: 1,
      elapsedDays: 0,
    };
    const stored = baseCard(history);
    const request = reviewRequest({
      fields: scheduleReviewTransition(stored, 'good', new Date(finalEntry.reviewedAt)),
    });
    const test = harness(stored);
    const result = await applyReviewForOwner(test.database, 'owner', request);
    expect(result.card.reviewHistory).toHaveLength(100);
    const requestedHistory = request.fields.reviewHistory;
    if (!Array.isArray(requestedHistory)) throw new Error('test fixture history is invalid');
    expect(Array.isArray(result.card.reviewHistory) ? result.card.reviewHistory.at(-1) : undefined)
      .toEqual(requestedHistory.at(-1));
  });

  it.each([4, 99])('rejects a malformed retained entry at index %s', async index => {
    const history: Array<Record<string, unknown>> = Array.from({ length: 100 }, (_, item) => ({
      rating: 'good',
      reviewedAt: new Date(Date.UTC(2026, 0, item + 1)).toISOString(),
      scheduledDays: 1,
      elapsedDays: 0,
    }));
    history[index] = { ...history[index], extra: true };
    const test = harness(baseCard(history));
    await expect(applyReviewForOwner(test.database, 'owner', reviewRequest())).rejects.toThrow();
    expect(test.writes).toEqual([]);
  });

  it.each([
    ['difficulty/rating', (fields: ReviewRequest['fields']) => ({ ...fields, difficulty: 'hard' })],
    ['nextReviewDate/fsrs.due', (fields: ReviewRequest['fields']) => ({ ...fields, nextReviewDate: '2026-08-24T00:20:00.000Z' })],
    ['reviews/fsrs.reps', (fields: ReviewRequest['fields']) => ({ ...fields, reviews: 2 })],
    ['interval/fsrs.scheduledDays', (fields: ReviewRequest['fields']) => ({ ...fields, interval: 1 })],
    ['history scheduledDays/fsrs.scheduledDays', (fields: ReviewRequest['fields']) => {
      const history = fields.reviewHistory;
      if (!Array.isArray(history)) throw new Error('test fixture history is invalid');
      const final = history.at(-1);
      if (!final || typeof final !== 'object' || Array.isArray(final)) throw new Error('test fixture entry is invalid');
      return { ...fields, reviewHistory: [...history.slice(0, -1), { ...final, scheduledDays: 1 }] };
    }],
    ['history elapsedDays/fsrs.elapsedDays', (fields: ReviewRequest['fields']) => {
      const history = fields.reviewHistory;
      if (!Array.isArray(history)) throw new Error('test fixture history is invalid');
      const final = history.at(-1);
      if (!final || typeof final !== 'object' || Array.isArray(final)) throw new Error('test fixture entry is invalid');
      return { ...fields, reviewHistory: [...history.slice(0, -1), { ...final, elapsedDays: 1 }] };
    }],
    ['fsrs.lastReview/reviewedAt', (fields: ReviewRequest['fields']) => {
      const fsrs = fields.fsrs;
      if (!fsrs || typeof fsrs !== 'object' || Array.isArray(fsrs)) throw new Error('test fixture FSRS is invalid');
      return { ...fields, fsrs: { ...fsrs, lastReview: '2026-08-23T00:00:00.000Z' } };
    }],
    ['correctStreak', (fields: ReviewRequest['fields']) => ({ ...fields, correctStreak: 2 })],
    ['easeFactor/difficulty', (fields: ReviewRequest['fields']) => ({ ...fields, easeFactor: 2.6 })],
  ])('rejects scheduler coupling mismatch: %s', async (_name, mutate) => {
    const valid = reviewRequest();
    const mismatch = reviewRequest({ fields: mutate(valid.fields) });
    await expect(applyReviewForOwner(harness().database, 'owner', mismatch)).rejects.toThrow(
      'Review fields do not match the scheduler transition.',
    );
  });

  it('rejects unsafe numeric ceilings in review fields', async () => {
    const oversized = reviewRequest({ fields: { ...reviewRequest().fields, interval: Number.MAX_SAFE_INTEGER + 1 } });
    await expect(applyReviewForOwner(harness().database, 'owner', oversized)).rejects.toThrow();
  });

  it('rejects a self-consistent but impossible scheduler jump', async () => {
    const valid = reviewRequest();
    const fsrs = valid.fields.fsrs;
    const history = valid.fields.reviewHistory;
    const final = Array.isArray(history) ? history.at(-1) : undefined;
    if (!fsrs || typeof fsrs !== 'object' || Array.isArray(fsrs)
      || !Array.isArray(history)
      || !final || typeof final !== 'object' || Array.isArray(final)) {
      throw new Error('test fixture is invalid');
    }
    const impossible = reviewRequest({
      fields: {
        ...valid.fields,
        nextReviewDate: '2028-08-24T00:00:00.000Z',
        reviews: 1_000,
        interval: 1_000,
        fsrs: {
          ...fsrs,
          due: '2028-08-24T00:00:00.000Z',
          scheduledDays: 1_000,
          reps: 1_000,
        },
        reviewHistory: [...history.slice(0, -1), {
          ...final,
          scheduledDays: 1_000,
        }],
      },
    });
    await expect(applyReviewForOwner(harness().database, 'owner', impossible)).rejects.toThrow();
  });
});
