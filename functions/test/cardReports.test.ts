import type { DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import { InputValidationError } from '../src/inputValidation.js';
import {
  parseCardReportRequest,
  reportCardForOwner,
  ReportedCardNotFoundError,
} from '../src/cardReports.js';

const snapshot = (exists: boolean, data?: Record<string, unknown>): DocumentSnapshot => ({
  exists,
  data: () => data,
} as DocumentSnapshot);

const makeDatabase = (card: DocumentSnapshot) => {
  const creates: Array<{ path: string; data: Record<string, unknown> }> = [];
  const references: Array<{ path: string; id: string }> = [];
  let reportNumber = 0;
  const database = {
    collection: (name: string) => ({
      doc: (id?: string) => {
        const documentId = id ?? `report-${++reportNumber}`;
        const reference = { path: `${name}/${documentId}`, id: documentId };
        references.push(reference);
        return name === 'users'
          ? {
              ...reference,
              collection: (subcollection: string) => ({
                doc: (cardId: string) => ({ path: `${name}/${documentId}/${subcollection}/${cardId}` }),
              }),
            }
          : reference;
      },
    }),
    runTransaction: vi.fn(async (callback: (transaction: Transaction) => Promise<unknown>) => callback({
      get: vi.fn(async () => card),
      create: vi.fn((reference: DocumentReference, data: Record<string, unknown>) => {
        creates.push({ path: reference.path, data });
      }),
    } as unknown as Transaction)),
  } as unknown as Firestore;
  return { database, creates, references };
};

describe('card reporting', () => {
  it('accepts bounded report input and trims an optional note', () => {
    expect(parseCardReportRequest({
      cardId: 'word-focus',
      reason: 'wrong-meaning',
      note: '  Nghĩa chưa đúng.  ',
    })).toEqual({ cardId: 'word-focus', reason: 'wrong-meaning', note: 'Nghĩa chưa đúng.' });
    expect(parseCardReportRequest({ cardId: 'card_1', reason: 'other', note: ' '.repeat(280) }))
      .toEqual({ cardId: 'card_1', reason: 'other' });
  });

  it('rejects unknown fields, invalid reasons, malformed ids and oversized notes', () => {
    for (const input of [
      { cardId: 'card', reason: 'other', uid: 'forged' },
      { cardId: 'card', reason: 'unknown' },
      { cardId: '../card', reason: 'other' },
      { cardId: 'card', reason: 'other', note: 'x'.repeat(281) },
    ]) {
      expect(() => parseCardReportRequest(input)).toThrow(InputValidationError);
    }
  });

  it('copies the server-side card snapshot into a private report without scheduling data', async () => {
    const { database, creates } = makeDatabase(snapshot(true, {
      word: 'focus',
      translation: 'tập trung',
      explanation: 'Concentrate attention.',
      exampleSentence: 'Focus on the task.',
      origin: 'ai',
      reviews: 12,
      userNote: 'must not be copied',
    }));
    const result = await reportCardForOwner(database, 'learner-1', {
      cardId: 'word-focus',
      reason: 'wrong-example',
      note: 'Example is unnatural.',
    }, () => new Date('2026-09-24T00:00:00.000Z'));

    expect(result).toEqual({ reportId: 'report-1', status: 'open' });
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({
      path: 'card_reports/report-1',
      data: {
        uid: 'learner-1',
        cardId: 'word-focus',
        card: {
          word: 'focus',
          translation: 'tập trung',
          explanation: 'Concentrate attention.',
          exampleSentence: 'Focus on the task.',
          origin: 'ai',
        },
        reason: 'wrong-example',
        note: 'Example is unnatural.',
        createdAt: '2026-09-24T00:00:00.000Z',
        expiresAt: new Date('2027-03-23T00:00:00.000Z'),
        status: 'open',
      },
    });
    expect(creates[0].data.card).not.toHaveProperty('reviews');
    expect(creates[0].data.card).not.toHaveProperty('userNote');
  });

  it('does not create a report when the card no longer exists', async () => {
    const { database, creates } = makeDatabase(snapshot(false));
    await expect(reportCardForOwner(database, 'learner-1', {
      cardId: 'missing',
      reason: 'other',
    })).rejects.toBeInstanceOf(ReportedCardNotFoundError);
    expect(creates).toHaveLength(0);
  });
});
