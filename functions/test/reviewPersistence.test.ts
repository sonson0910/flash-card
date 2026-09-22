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
  expectedOwnerId: 'owner',
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

const harness = (card = baseCard(), fenced = false) => {
  const values = new Map<string, DocumentSnapshot>([
    ['users/owner/profile/library_state', snapshot(true, { libraryEpoch: 2 })],
    ['users/owner/cards/word-focus', snapshot(true, card)],
    ...(fenced ? [['users/owner/profile/library_migration_fence', snapshot(true, { schemaVersion: 1, active: true })] as const] : []),
  ]);
  const writes: Array<{ path: string; data: DocumentData }> = [];
  const transaction = {
    get: vi.fn(async (reference: DocumentReference) => values.get(reference.path) ?? snapshot(false)),
    set: vi.fn((reference: DocumentReference, data: DocumentData) => {
      writes.push({ path: reference.path, data });
      return transaction;
    }),
    create: vi.fn((reference: DocumentReference, data: DocumentData) => {
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
  it('rejects review writes while the durable migration fence is active', async () => {
    const test = harness(baseCard(), true);
    await expect(applyReviewForOwner(test.database, 'owner', reviewRequest()))
      .rejects.toMatchObject({ name: 'LegacyLibraryMigrationFenceError' });
    expect(test.writes).toEqual([]);
  });

  it('parses only the complete bounded review protocol', () => {
    expect(parseReviewRequest(reviewRequest())).toMatchObject({
      expectedOwnerId: 'owner',
      opId: 'device-a:review-1',
    });
    expect(parseReviewRequest({ ...reviewRequest(), expectedOwnerId: 'owner@example.com' }))
      .toMatchObject({ expectedOwnerId: 'owner@example.com' });
    expect(() => parseReviewRequest({ ...reviewRequest(), expectedOwnerId: undefined })).toThrow();
    expect(() => parseReviewRequest({ ...reviewRequest(), expectedOwnerId: 'x'.repeat(129) })).toThrow();
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
    expect(test.writes[1]).toMatchObject({
      path: 'users/owner/review_receipts/word-focus:device-a:review-1',
      data: expect.objectContaining({
        fingerprint: expect.any(String),
        result: expect.objectContaining({ applied: true, duplicate: false }),
        createdAt: expect.anything(),
        expiresAt: expect.any(Date),
      }),
    });
  });

  it('does not treat a legacy bounded operation ID as a receipt without its fingerprint', async () => {
    const test = harness(baseCard([], ['device-a:review-1']));
    await expect(applyReviewForOwner(test.database, 'owner', reviewRequest({ baseRevision: 0 })))
      .rejects.toMatchObject({ reason: 'revision-conflict' });
    expect(test.writes).toEqual([]);
  });

  it('preserves legacy bounded operation-ID duplicates without strict receipt or timestamp rejections', async () => {
    const stored = baseCard([{ rating: 'good', reviewedAt: '2026-08-24T00:00:00.000Z', scheduledDays: 1, elapsedDays: 0 }], ['device-a:review-1']);
    const test = harness(stored);
    await expect(applyReviewForOwner(test.database, 'owner', reviewRequest({ baseRevision: 0 }), { strict: false }))
      .resolves.toMatchObject({ applied: true, duplicate: true, card: { revision: 3 } });
    expect(test.writes).toEqual([]);
  });

  it('blocks an old replay after its receipt is absent or expired without writes', async () => {
    const stored = baseCard([{
      rating: 'good', reviewedAt: '2026-08-24T00:00:00.000Z', scheduledDays: 1, elapsedDays: 0,
    }]);
    const request = reviewRequest({ opId: 'device-a:expired-replay' });
    for (const receipt of [undefined, {
      fingerprint: 'expired-fingerprint',
      result: { applied: true, duplicate: false, card: stored },
      expiresAt: new Date('2026-08-25T00:00:00.000Z'),
    }]) {
      const test = harness(stored);
      if (receipt) test.values.set('users/owner/review_receipts/word-focus:device-a:expired-replay', snapshot(true, receipt));
      await expect(applyReviewForOwner(test.database, 'owner', request))
        .rejects.toMatchObject({ reason: 'stale-review' });
      expect(test.writes).toEqual([]);
    }
  });

  it('rejects a distinct operation at an equal authoritative timestamp', async () => {
    const stored = baseCard([{ rating: 'good', reviewedAt: '2026-08-24T00:00:00.000Z', scheduledDays: 1, elapsedDays: 0 }]);
    const test = harness(stored);
    await expect(applyReviewForOwner(test.database, 'owner', reviewRequest({ opId: 'device-a:review-2' })))
      .rejects.toMatchObject({ reason: 'stale-review' });
    expect(test.writes).toEqual([]);
  });

  it('accepts the same stale request on the legacy path that V2 rejects', async () => {
    const stored = baseCard([{ rating: 'good', reviewedAt: '2026-08-24T00:00:00.000Z', scheduledDays: 1, elapsedDays: 0 }]);
    const request = reviewRequest({
      opId: 'device-a:review-2',
      fields: scheduleReviewTransition(stored, 'good', new Date('2026-08-24T00:00:00.000Z')),
    });
    const legacy = harness(stored);
    await expect(applyReviewForOwner(legacy.database, 'owner', request, { strict: false }))
      .resolves.toMatchObject({ applied: true, duplicate: false });
    expect(legacy.writes).toHaveLength(1);

    await expect(applyReviewForOwner(harness(stored).database, 'owner', request))
      .rejects.toMatchObject({ reason: 'stale-review' });
  });

  it('rejects a duplicate operation whose payload fingerprint changed', async () => {
    const request = reviewRequest();
    const test = harness();
    await applyReviewForOwner(test.database, 'owner', request);
    const receipt = test.writes.find(write => write.path.includes('review_receipts'));
    if (!receipt) throw new Error('receipt was not written');
    test.values.set(receipt.path, snapshot(true, receipt.data));
    await expect(applyReviewForOwner(test.database, 'owner', { ...request, rating: 'easy' }))
      .rejects.toMatchObject({ reason: 'receipt-fingerprint-conflict' });
    expect(test.writes.filter(write => write.path.includes('review_receipts'))).toHaveLength(1);
  });

  it('uses the legacy FSRS fallback for malformed stored state and writes a canonical successor', async () => {
    const stored = {
      ...baseCard([], []),
      fsrs: {
      due: '2026-08-24T00:10:00.000Z', stability: 0, difficulty: 2,
      elapsedDays: 0, scheduledDays: 0, learningSteps: 0, reps: 0, lapses: 0, state: 0,
      lastReview: '2026-08-23T00:00:00.000Z',
      },
    };
    const request = reviewRequest({ fields: scheduleReviewTransition(stored, 'good', new Date('2026-08-24T00:00:00.000Z')) });
    const test = harness(stored);
    const result = await applyReviewForOwner(test.database, 'owner', request);
    expect(result.card.fsrs).toMatchObject({
      stability: expect.any(Number), difficulty: expect.any(Number),
      elapsedDays: expect.any(Number), scheduledDays: expect.any(Number),
      learningSteps: expect.any(Number), reps: expect.any(Number), lapses: expect.any(Number),
    });
    const fsrs = result.card.fsrs as Record<string, number>;
    expect(fsrs.stability).toBeGreaterThan(0);
    expect(fsrs.difficulty).toBeGreaterThanOrEqual(1);
    expect(fsrs.difficulty).toBeLessThanOrEqual(10);
    expect([fsrs.elapsedDays, fsrs.scheduledDays, fsrs.learningSteps, fsrs.reps, fsrs.lapses]
      .every(Number.isSafeInteger)).toBe(true);
    expect(test.writes[0].data.fsrs).toMatchObject({ stability: expect.any(Number) });
  });

  it.each(['2026-08-23T23:59:59.999Z', '2026-08-24T00:00:00.000Z'])(
    'rejects malformed stored FSRS chronology at %s without writes',
    async reviewedAt => {
      const stored = {
        ...baseCard([], []),
        fsrs: {
          due: '2026-08-24T00:10:00.000Z', stability: 0, difficulty: 2,
          elapsedDays: 0, scheduledDays: 0, learningSteps: 0, reps: 0, lapses: 0, state: 0,
          lastReview: '2026-08-24T00:00:00.000Z',
        },
      };
      const test = harness(stored);
      await expect(applyReviewForOwner(test.database, 'owner', reviewRequest({ reviewedAt })))
        .rejects.toMatchObject({ reason: 'stale-review' });
      expect(test.writes).toEqual([]);
    },
  );

  it('still rejects a client candidate with malformed FSRS state', async () => {
    const fields = reviewRequest().fields;
    const fsrs = fields.fsrs as Record<string, unknown>;
    await expect(applyReviewForOwner(harness().database, 'owner', reviewRequest({
      fields: { ...fields, fsrs: { ...fsrs, stability: 0 } },
    }))).rejects.toThrow('Card fsrs is invalid.');
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
