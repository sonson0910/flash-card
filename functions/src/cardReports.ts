import type { Firestore } from 'firebase-admin/firestore';
import { InputValidationError } from './inputValidation.js';

export const CARD_REPORT_REASONS = [
  'wrong-meaning',
  'wrong-example',
  'wrong-pronunciation',
  'wrong-image',
  'offensive',
  'other',
] as const;

export type CardReportReason = typeof CARD_REPORT_REASONS[number];

export type CardReportRequest = {
  cardId: string;
  reason: CardReportReason;
  note?: string;
};

export class ReportedCardNotFoundError extends Error {
  constructor() {
    super('The card could not be found.');
    this.name = 'ReportedCardNotFoundError';
  }
}

const asRecord = (value: unknown): Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
);

export const parseCardReportRequest = (value: unknown): CardReportRequest => {
  const source = asRecord(value);
  if (Object.keys(source).some(key => !['cardId', 'reason', 'note'].includes(key))) {
    throw new InputValidationError('Card report contains an unsupported field.');
  }
  if (typeof source.cardId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(source.cardId)) {
    throw new InputValidationError('Card report id is invalid.');
  }
  if (typeof source.reason !== 'string'
    || !CARD_REPORT_REASONS.includes(source.reason as CardReportReason)) {
    throw new InputValidationError('Card report reason is invalid.');
  }
  if (source.note !== undefined && (typeof source.note !== 'string' || source.note.length > 280)) {
    throw new InputValidationError('Card report note must be at most 280 characters.');
  }
  const note = typeof source.note === 'string' ? source.note.trim() : '';
  return {
    cardId: source.cardId,
    reason: source.reason as CardReportReason,
    ...(note ? { note } : {}),
  };
};

const REPORTABLE_CARD_FIELDS = [
  'word',
  'translation',
  'explanation',
  'explanationTranslation',
  'phonetic',
  'category',
  'partOfSpeech',
  'cefrLevel',
  'exampleSentence',
  'exampleTranslation',
  'imageSearchQuery',
  'imageUrl',
  'audioUrl',
  'collocations',
  'synonyms',
  'antonyms',
  'origin',
] as const;

const copyReportableCardFields = (source: Record<string, unknown>): Record<string, unknown> => {
  const copied: Record<string, unknown> = {};
  for (const field of REPORTABLE_CARD_FIELDS) {
    const value = source[field];
    if (typeof value === 'string') copied[field] = value.slice(0, field.includes('example') || field.includes('explanation') ? 2_048 : 256);
    else if (value === null && (field === 'imageUrl' || field === 'audioUrl')) copied[field] = null;
    else if (Array.isArray(value) && ['collocations', 'synonyms', 'antonyms'].includes(field)) {
      copied[field] = value.filter((item): item is string => typeof item === 'string').slice(0, 4).map(item => item.slice(0, 100));
    }
  }
  return copied;
};

export const reportCardForOwner = async (
  database: Firestore,
  userId: string,
  input: CardReportRequest,
  now = () => new Date(),
): Promise<{ reportId: string; status: 'open' }> => {
  const cardRef = database.collection('users').doc(userId).collection('cards').doc(input.cardId);
  const reportRef = database.collection('card_reports').doc();
  const createdAt = now().toISOString();
  const expiresAt = new Date(Date.parse(createdAt) + 180 * 24 * 60 * 60 * 1_000);

  await database.runTransaction(async transaction => {
    const cardSnapshot = await transaction.get(cardRef);
    if (!cardSnapshot.exists) throw new ReportedCardNotFoundError();
    const card = cardSnapshot.data();
    if (!card) throw new ReportedCardNotFoundError();
    transaction.create(reportRef, {
      uid: userId,
      cardId: input.cardId,
      card: copyReportableCardFields(card),
      reason: input.reason,
      ...(input.note ? { note: input.note } : {}),
      createdAt,
      expiresAt,
      status: 'open',
    });
  });

  return { reportId: reportRef.id, status: 'open' };
};

export const __cardReportTesting = { copyReportableCardFields };
