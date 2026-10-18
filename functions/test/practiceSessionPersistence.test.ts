import type { DocumentData, DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  completePracticeSessionV1,
  parseCompletePracticeSessionV1Request,
  parseStartPracticeSessionV1Request,
  startPracticeSessionV1,
  type StartPracticeSessionV1Request,
} from '../src/practiceSessionPersistence.js';

const snapshot = (exists: boolean, data?: DocumentData): DocumentSnapshot => ({ exists, data: () => data } as DocumentSnapshot);

const card = (id: string, word: string, translation: string) => ({ id, word, translation });

const harness = (documents: Record<string, DocumentData>) => {
  const values = new Map(Object.entries(documents));
  const reads: string[] = [];
  const writes: Array<{ path: string; data: DocumentData }> = [];
  const document = (path: string) => ({ path, collection: (name: string) => collection(`${path}/${name}`) }) as unknown as DocumentReference;
  const collection = (path: string) => ({ doc: (id: string) => document(`${path}/${id}`) });
  const transaction = {
    get: vi.fn(async (reference: DocumentReference) => {
      reads.push(reference.path);
      const data = values.get(reference.path);
      return snapshot(data !== undefined, data);
    }),
    create: vi.fn((reference: DocumentReference, data: DocumentData) => {
      if (values.has(reference.path)) throw { code: 6 };
      values.set(reference.path, data);
      writes.push({ path: reference.path, data });
      return transaction;
    }),
    set: vi.fn((reference: DocumentReference, data: DocumentData) => {
      values.set(reference.path, { ...(values.get(reference.path) ?? {}), ...data });
      writes.push({ path: reference.path, data });
      return transaction;
    }),
  } as unknown as Transaction;
  const database = {
    collection: (name: string) => collection(name),
    runTransaction: vi.fn(async (callback: (value: Transaction) => Promise<unknown>) => callback(transaction)),
  } as unknown as Firestore;
  return { database, reads, writes, values };
};

const request = (overrides: Partial<StartPracticeSessionV1Request> = {}): StartPracticeSessionV1Request => ({
  opId: 'practice-1', game: 'spelling', cardIds: ['card-1', 'card-2'], ...overrides,
});

describe('practice session persistence', () => {
  it('parses only bounded supported practice games and answer shapes', () => {
    expect(parseStartPracticeSessionV1Request(request())).toEqual(request());
    expect(() => parseStartPracticeSessionV1Request({ ...request(), game: 'shadowing' })).toThrow();
    expect(() => parseStartPracticeSessionV1Request({ ...request(), cardIds: ['card-1', 'card-1'] })).toThrow();
    expect(() => parseStartPracticeSessionV1Request({ ...request(), game: 'quiz' })).toThrow(/at least 4/i);
    expect(() => parseStartPracticeSessionV1Request({ ...request(), game: 'match' })).toThrow(/at least 4/i);
    expect(parseCompletePracticeSessionV1Request({ sessionId: 'practice-1', completionId: 'done-1', answers: { responses: { 'card-1': 'xin chào' } } }))
      .toMatchObject({ sessionId: 'practice-1' });
    expect(() => parseCompletePracticeSessionV1Request({ sessionId: 'practice-1', completionId: 'done-1', answers: { xp: 999 } })).toThrow();
  });

  it('reads exactly the requested owner cards and persists only a server session', async () => {
    const test = harness({
      'users/owner/cards/card-1': card('card-1', 'hello', 'xin chào'),
      'users/owner/cards/card-2': card('card-2', 'bye', 'tạm biệt'),
    });
    const result = await startPracticeSessionV1(test.database, 'owner', request(), new Date('2026-09-27T10:00:00.000Z'));
    expect(test.reads).toEqual(['users/owner/cards/card-1', 'users/owner/cards/card-2']);
    expect(result.challenge).toEqual({
      kind: 'spelling',
      prompts: [
        { cardId: 'card-1', prompt: 'xin chào', word: 'hello' },
        { cardId: 'card-2', prompt: 'tạm biệt', word: 'bye' },
      ],
    });
    expect(test.writes).toHaveLength(1);
    expect(test.writes[0].path).toBe('users/owner/practice_sessions/practice-1');
    expect(test.writes[0].data).toMatchObject({ status: 'active', requestFingerprint: expect.any(String), answerKey: expect.any(Array) });
  });

  it('returns the original start response for the same operation fingerprint', async () => {
    const test = harness({
      'users/owner/cards/card-1': card('card-1', 'hello', 'xin chào'),
      'users/owner/cards/card-2': card('card-2', 'bye', 'tạm biệt'),
    });
    const first = await startPracticeSessionV1(test.database, 'owner', request(), new Date('2026-09-27T10:00:00.000Z'));
    const replay = await startPracticeSessionV1(test.database, 'owner', request(), new Date('2026-09-27T11:00:00.000Z'));
    expect(replay).toEqual(first);
    await expect(startPracticeSessionV1(test.database, 'owner', request({ cardIds: ['card-2', 'card-1'] }))).rejects.toThrow(/fingerprint/i);
  });

  it('returns the stored start response when a retry follows card deletion', async () => {
    const test = harness({
      'users/owner/cards/card-1': card('card-1', 'hello', 'xin chào'),
      'users/owner/cards/card-2': card('card-2', 'bye', 'tạm biệt'),
    });
    const first = await startPracticeSessionV1(test.database, 'owner', request(), new Date('2026-09-27T10:00:00.000Z'));
    test.values.delete('users/owner/cards/card-1');

    await expect(startPracticeSessionV1(test.database, 'owner', request(), new Date('2026-09-27T11:00:00.000Z'))).resolves.toEqual(first);
  });

  it('scores spelling with the persisted target-language normalization and writes session, stats, and history', async () => {
    const test = harness({
      'users/owner/cards/card-1': { ...card('card-1', 'カタカナ', 'katakana'), language: 'ja' },
      'users/owner/cards/card-2': { ...card('card-2', 'café', 'coffee'), language: 'en' },
    });
    await startPracticeSessionV1(test.database, 'owner', request(), new Date('2026-09-27T10:00:00.000Z'));
    expect(test.values.get('users/owner/practice_sessions/practice-1')?.answerKey).toMatchObject([
      { targetLanguage: 'ja' }, { targetLanguage: 'en' },
    ]);
    test.reads.length = 0;
    test.writes.length = 0;
    const result = await completePracticeSessionV1(test.database, 'owner', {
      sessionId: 'practice-1', completionId: 'complete-1', timeZone: 'UTC',
      answers: { responses: { 'card-1': 'ｶﾀｶﾅ', 'card-2': 'ＣＡＦÉ' } },
    }, new Date('2026-09-27T10:01:00.000Z'));
    expect(result).toMatchObject({ correct: 2, total: 2, awardedXp: 10, outcome: { xp: 10 } });
    expect(test.reads).toEqual(['users/owner/practice_sessions/practice-1', 'users/owner/profile/stats']);
    expect(test.writes.map(write => write.path)).toEqual([
      'users/owner/profile/stats', 'users/owner/profile/xp_history', 'users/owner/practice_sessions/practice-1',
    ]);
  });

  it('accepts legacy spelling answer keys without a target language', async () => {
    const test = harness({
      'users/owner/cards/card-1': card('card-1', 'hello', 'xin chào'),
    });
    await startPracticeSessionV1(test.database, 'owner', request({ cardIds: ['card-1'] }), new Date('2026-09-27T10:00:00.000Z'));
    const path = 'users/owner/practice_sessions/practice-1';
    const session = test.values.get(path)!;
    test.values.set(path, {
      ...session,
      answerKey: session.answerKey.map(({ targetLanguage: _targetLanguage, ...answer }: { targetLanguage: string; cardId: string; word: string; translation: string }) => answer),
    });

    await expect(completePracticeSessionV1(test.database, 'owner', {
      sessionId: 'practice-1', completionId: 'complete-1', timeZone: 'UTC',
      answers: { responses: { 'card-1': 'ＨＥＬＬＯ' } },
    }, new Date('2026-09-27T10:01:00.000Z'))).resolves.toMatchObject({ correct: 1, awardedXp: 5 });
  });

  it('replays a completed result from the session alone and rejects changed answers', async () => {
    const test = harness({
      'users/owner/cards/card-1': card('card-1', 'hello', 'xin chào'),
      'users/owner/cards/card-2': card('card-2', 'bye', 'tạm biệt'),
    });
    await startPracticeSessionV1(test.database, 'owner', request(), new Date('2026-09-27T10:00:00.000Z'));
    const completion = { sessionId: 'practice-1', completionId: 'complete-1', timeZone: 'UTC', answers: { responses: { 'card-1': 'hello', 'card-2': 'bye' } } };
    const first = await completePracticeSessionV1(test.database, 'owner', completion, new Date('2026-09-27T10:01:00.000Z'));
    test.reads.length = 0;
    expect(await completePracticeSessionV1(test.database, 'owner', completion, new Date('2026-09-27T10:02:00.000Z'))).toEqual(first);
    expect(test.reads).toEqual(['users/owner/practice_sessions/practice-1']);
    await expect(completePracticeSessionV1(test.database, 'owner', {
      ...completion, answers: { responses: { 'card-1': 'wrong', 'card-2': 'bye' } },
    })).rejects.toThrow(/fingerprint/i);
    await expect(completePracticeSessionV1(test.database, 'owner', {
      ...completion, timeZone: 'Asia/Ho_Chi_Minh',
    })).rejects.toThrow(/fingerprint/i);
  });

  it('writes the level reward in the same completed practice transaction', async () => {
    const test = harness({
      'users/owner/cards/card-1': card('card-1', 'hello', 'xin chào'),
      'users/owner/profile/stats': { verifiedXp: 14395, rewardTimeZone: 'UTC' },
    });
    await startPracticeSessionV1(test.database, 'owner', request({ cardIds: ['card-1'] }), new Date('2026-09-27T10:00:00.000Z'));
    test.reads.length = 0;
    test.writes.length = 0;
    const result = await completePracticeSessionV1(test.database, 'owner', {
      sessionId: 'practice-1', completionId: 'complete-1', timeZone: 'UTC', answers: { responses: { 'card-1': 'hello' } },
    }, new Date('2026-09-27T10:01:00.000Z'));
    expect(result.outcome).toMatchObject({ xp: 14400, level: 13, events: ['levelup'] });
    expect(test.reads).toEqual([
      'users/owner/practice_sessions/practice-1', 'users/owner/profile/stats', 'users/owner/profile/rewards',
    ]);
    expect(test.writes.map(write => write.path)).toEqual([
      'users/owner/profile/stats', 'users/owner/profile/xp_history', 'users/owner/profile/rewards', 'users/owner/practice_sessions/practice-1',
    ]);
  });

  it('awards match XP only for every stored card and never accepts shadowing', async () => {
    const test = harness({
      'users/owner/cards/card-1': card('card-1', 'hello', 'xin chào'),
      'users/owner/cards/card-2': card('card-2', 'bye', 'tạm biệt'),
      'users/owner/cards/card-3': card('card-3', 'thanks', 'cảm ơn'),
      'users/owner/cards/card-4': card('card-4', 'yes', 'vâng'),
    });
    await startPracticeSessionV1(test.database, 'owner', request({ opId: 'match-1', game: 'match', cardIds: ['card-1', 'card-2', 'card-3', 'card-4'] }), new Date('2026-09-27T10:00:00.000Z'));
    await expect(completePracticeSessionV1(test.database, 'owner', {
      sessionId: 'match-1', completionId: 'complete-1', timeZone: 'UTC', answers: {
        pairs: [{ cardId: 'card-1', word: 'hello', translation: 'tạm biệt' }, { cardId: 'card-2', word: 'bye', translation: 'xin chào' }, { cardId: 'card-3', word: 'thanks', translation: 'cảm ơn' }, { cardId: 'card-4', word: 'yes', translation: 'vâng' }],
      },
    }, new Date('2026-09-27T10:01:00.000Z'))).rejects.toThrow(/invalid/i);
    await expect(completePracticeSessionV1(test.database, 'owner', {
      sessionId: 'match-1', completionId: 'complete-2', timeZone: 'UTC', answers: {
        pairs: [{ cardId: 'card-1', word: 'hello', translation: 'xin chào' }, { cardId: 'card-2', word: 'bye', translation: 'tạm biệt' }, { cardId: 'card-3', word: 'thanks', translation: 'cảm ơn' }, { cardId: 'card-4', word: 'yes', translation: 'vâng' }],
      },
    }, new Date('2026-09-27T10:01:00.000Z'))).resolves.toMatchObject({ awardedXp: 20, correct: 4 });
  });
});
