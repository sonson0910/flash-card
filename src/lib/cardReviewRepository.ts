import type { Firestore } from 'firebase/firestore';
import type { CardData } from '../types/card';
import { normalizeCardData } from './cardNormalization';
import { app as firebaseApp, isFirebaseConfigured, protectedFunctionsCapability } from './firebase';
import { ProtectedFunctionError, runProtectedFunction } from './protectedFunctionsCapability';
import { scheduleReview, type ReviewRating } from './reviewScheduler';

export type ReviewCommand = {
  cardId: string;
  opId: string;
  baseRevision: number;
  libraryEpoch: number;
  rating: ReviewRating;
  reviewedAt: string;
  fields: Partial<CardData>;
  fieldMask: readonly (keyof CardData)[];
};

export type ReviewApplyResult =
  | { applied: true; duplicate: boolean; card: CardData }
  | {
      applied: false;
      reason: 'stale-library-epoch' | 'future-library-epoch' | 'missing' | 'identity-conflict';
    }
  | { applied: false; reason: 'revision-conflict'; currentRevision: number; card: CardData };

type ReviewConflictReason = ReviewApplyResult extends infer Result
  ? Result extends { applied: false; reason: infer Reason } ? Reason : never
  : never;

const REVIEW_FIELDS: readonly (keyof CardData)[] = [
  'difficulty', 'nextReviewDate', 'reviews', 'interval', 'easeFactor',
  'fsrs', 'reviewHistory', 'correctStreak',
];

const hasFirestoreTimestamp = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  if ('toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') return true;
  return Array.isArray(value)
    ? value.some(hasFirestoreTimestamp)
    : Object.values(value).some(hasFirestoreTimestamp);
};

const parseCard = (value: unknown): CardData => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || hasFirestoreTimestamp(value)) {
    throw new Error('The protected review service returned an invalid card.');
  }
  const source = value as Record<string, unknown>;
  if (
    source.schemaVersion !== 2
    || !Number.isSafeInteger(source.revision)
    || Number(source.revision) < 1
    || !Number.isSafeInteger(source.libraryEpoch)
    || Number(source.libraryEpoch) < 0
    || typeof source.id !== 'string'
    || !source.id
  ) throw new Error('The protected review service returned an invalid card.');
  const card = normalizeCardData(source as Partial<CardData>, source.id);
  if (card.id !== source.id || card.revision !== source.revision || card.libraryEpoch !== source.libraryEpoch) {
    throw new Error('The protected review service returned an invalid card.');
  }
  return card;
};

const normalizeConflictReason = (value: unknown): ReviewConflictReason | null => {
  if (typeof value !== 'string') return null;
  return [
    'stale-library-epoch', 'future-library-epoch', 'revision-conflict', 'missing', 'identity-conflict',
  ].includes(value) ? value as ReviewConflictReason : null;
};

const readCallableConflict = (error: unknown): ReviewApplyResult | null => {
  if (!error || typeof error !== 'object') return null;
  const source = error as Record<string, unknown>;
  const code = typeof source.code === 'string'
    ? source.code.trim().toLowerCase().replace(/^firebase\//, '').replace(/^functions\//, '')
    : '';
  if (code !== 'failed-precondition' || !source.details || typeof source.details !== 'object') return null;
  const details = source.details as Record<string, unknown>;
  const reason = normalizeConflictReason(details.reason);
  if (!reason) return null;
  if (reason === 'revision-conflict') {
    if (!Number.isSafeInteger(details.currentRevision) || Number(details.currentRevision) < 1) return null;
    return {
      applied: false,
      reason,
      currentRevision: Number(details.currentRevision),
      card: parseCard(details.card),
    };
  }
  return { applied: false, reason };
};

export async function applyReviewViaCallable(
  database: Firestore,
  userId: string,
  command: ReviewCommand,
): Promise<ReviewApplyResult> {
  void database;
  void userId;
  if (!isFirebaseConfigured || !firebaseApp) {
    throw new ProtectedFunctionError({
      message: 'Card review is unavailable because protected cloud features are not configured for this build.',
      kind: 'configuration',
      code: 'firebase-unconfigured',
      retryable: false,
    });
  }
  return runProtectedFunction(protectedFunctionsCapability, 'Card review', async () => {
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const app = firebaseApp;
    if (!app) throw new Error('Firebase is not initialized.');
    const callable = httpsCallable<ReviewCommand, unknown>(
      getFunctions(app, 'asia-southeast1'),
      'reviewCard',
    );
    try {
      const response = await callable({
        ...command,
        fields: command.fields,
        fieldMask: [...command.fieldMask],
      });
      const value = response.data;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid review response.');
      const envelope = value as Record<string, unknown>;
      if (envelope.applied !== true || typeof envelope.duplicate !== 'boolean') throw new Error('Invalid review response.');
      return { applied: true, duplicate: envelope.duplicate, card: parseCard(envelope.card) };
    } catch (error) {
      const conflict = readCallableConflict(error);
      if (conflict) return conflict;
      throw error;
    }
  });
}

export async function applyReviewWithConflictRecovery(
  command: ReviewCommand,
  apply: (command: ReviewCommand) => Promise<ReviewApplyResult>,
): Promise<ReviewApplyResult> {
  const first = await apply(command);
  if (first.applied || first.reason !== 'revision-conflict') return first;
  const authoritative = first.card;
  const reviewedAt = new Date(command.reviewedAt);
  if (Number.isNaN(reviewedAt.getTime())) return first;
  const fields = scheduleReview(authoritative, command.rating, reviewedAt);
  return apply({
    ...command,
    baseRevision: authoritative.revision ?? first.currentRevision,
    fields,
    fieldMask: REVIEW_FIELDS,
  });
}
