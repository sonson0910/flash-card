// Every verified review, practice completion and card create reads and writes a fixed set of
// documents. The stats records (streak, achievements, study time, weekly words) ride in the stats
// write those actions already make, so once an account has them the set is unchanged; only an
// account's first action after they were added reads its baseline, once.
import type { DocumentData, DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import { commitVerifiedGamification, prepareVerifiedGamification, reviewXpAwardId } from '../src/verifiedGamification.js';
import { steadyStats } from './support/steady-stats.js';

const STATS = 'users/owner/profile/stats';
const HISTORY = 'users/owner/profile/xp_history';
const REWARDS = 'users/owner/profile/rewards';
const award = (cardId: string, studyDay: string) => `users/owner/review_xp_awards/${reviewXpAwardId(cardId, studyDay)}`;

// Records every document read, document write and count query, in order.
const firestore = (documents: Record<string, DocumentData>) => {
  const values = new Map(Object.entries(documents));
  const log: string[] = [];
  const document = (path: string) => ({ path, collection: (name: string) => collection(`${path}/${name}`) }) as unknown as DocumentReference;
  const collection = (path: string) => ({
    doc: (id: string) => document(`${path}/${id}`),
    where: (field: string, operator: string, value: unknown) => ({
      count: () => ({
        get: async () => {
          log.push(`query ${path} where ${field} ${operator} ${String(value)}`);
          return { data: () => ({ count: 0 }) };
        },
      }),
    }),
  });
  const transaction = {
    get: vi.fn(async (reference: DocumentReference) => {
      log.push(`read ${reference.path}`);
      const data = values.get(reference.path);
      return { exists: data !== undefined, data: () => data };
    }),
    set: vi.fn((reference: DocumentReference) => {
      log.push(`write ${reference.path}`);
      return transaction;
    }),
    create: vi.fn((reference: DocumentReference) => {
      log.push(`write ${reference.path}`);
      return transaction;
    }),
  } as unknown as Transaction;
  const database = { collection: (name: string) => collection(name) } as unknown as Firestore;
  return { database, transaction, log };
};

const receivedAt = new Date('2026-11-19T13:00:00.000Z');
const actions = {
  review: {
    kind: 'review' as const, receivedAt, timeZone: 'Asia/Saigon', targetLanguage: 'en', rating: 'good' as const, cardId: 'word-focus',
    reviewedCard: {
      firstReview: false, firstEasy: false, started: false, mastered: false, reviewTimesMs: [receivedAt.getTime()],
    },
  },
  create: { kind: 'create' as const, receivedAt, timeZone: 'Asia/Saigon' },
  spelling: {
    kind: 'spelling' as const, receivedAt, timeZone: 'Asia/Saigon', resultXp: 10, correctAnswers: 2,
    practiceStartedAt: new Date('2026-11-19T12:59:00.000Z'), practiceCards: 2,
  },
  match: {
    kind: 'match' as const, receivedAt, timeZone: 'Asia/Saigon', resultXp: 20,
    practiceStartedAt: new Date('2026-11-19T12:59:00.000Z'), practiceCards: 4,
  },
};

const costOf = async (documents: Record<string, DocumentData>, action: Parameters<typeof prepareVerifiedGamification>[3]) => {
  const test = firestore(documents);
  commitVerifiedGamification(test.transaction, await prepareVerifiedGamification(test.database, test.transaction, 'owner', action));
  return test.log;
};

describe('verified action cost', () => {
  it('reads and writes only the documents a review always has', async () => {
    expect(await costOf({ [STATS]: steadyStats() }, actions.review)).toEqual([
      `read ${STATS}`, `read ${award('word-focus', '2026-11-19')}`,
      `write ${STATS}`, `write ${HISTORY}`, `write ${award('word-focus', '2026-11-19')}`,
    ]);
  });

  it('reads and writes only the documents a card create always has', async () => {
    expect(await costOf({ [STATS]: steadyStats() }, actions.create)).toEqual([`read ${STATS}`, `write ${STATS}`, `write ${HISTORY}`]);
  });

  it('reads and writes only the documents a practice completion always has', async () => {
    for (const action of [actions.spelling, actions.match]) {
      expect(await costOf({ [STATS]: steadyStats() }, action)).toEqual([`read ${STATS}`, `write ${STATS}`, `write ${HISTORY}`]);
    }
  });

  it('reads the baseline of an existing account once, on its first action after the records were added', async () => {
    const { streakV1, achievementsV1, studyTimeV1, wordWeeksV1, ...before } = steadyStats();
    expect([streakV1, achievementsV1, studyTimeV1, wordWeeksV1].every(Boolean)).toBe(true);
    expect(await costOf({ [STATS]: before, [REWARDS]: { hintTokens: 1 } }, actions.review)).toEqual([
      `read ${STATS}`, `read ${award('word-focus', '2026-11-19')}`, `read ${REWARDS}`, `read ${HISTORY}`,
      'query users/owner/cards where reviews > 0', 'query users/owner/cards where difficulty == easy',
      `write ${STATS}`, `write ${HISTORY}`, `write ${award('word-focus', '2026-11-19')}`,
    ]);
  });

  it('adds only the two card counts to the first action of a new account', async () => {
    expect(await costOf({}, actions.create)).toEqual([
      `read ${STATS}`,
      'query users/owner/cards where reviews > 0', 'query users/owner/cards where difficulty == easy',
      `write ${STATS}`, `write ${HISTORY}`,
    ]);
  });
});
