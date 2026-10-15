import type { Firestore } from 'firebase/firestore';
import type { CardData } from '../types/card';
import { normalizeCardData } from './cardNormalization';
import { app as firebaseApp, getSonFlashFunctions, isFirebaseConfigured, protectedFunctionsCapability } from './firebase';
import { ProtectedFunctionError, runProtectedFunction } from './protectedFunctionsCapability';
import { scheduleReview, type ReviewRating } from './reviewScheduler';
import type {
  CeremonyEvent,
  ReviewGamificationOutcome,
  VerifiedGamificationOutcome,
} from '../features/gamification/verifiedGamificationClient';

export type ReviewCommand = {
  cardId: string;
  opId: string;
  baseRevision: number;
  libraryEpoch: number;
  rating: ReviewRating;
  reviewedAt: string;
  fields: Partial<CardData>;
  fieldMask: readonly (keyof CardData)[];
  timeZone?: string;
};

export type ReviewCeremonyEvent = CeremonyEvent;
export type AuthoritativeGamification = VerifiedGamificationOutcome;
export type ReviewOutcome = Partial<ReviewGamificationOutcome>;

export type ReviewApplyResult =
  | ({ applied: true; duplicate: boolean; xpAwarded: 0 | 2; card: CardData } & ReviewOutcome)
  | {
      applied: false;
      reason: 'stale-library-epoch' | 'future-library-epoch' | 'missing' | 'identity-conflict'
        | 'stale-review' | 'future-review-clock-skew' | 'receipt-fingerprint-conflict';
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
    'stale-review', 'future-review-clock-skew', 'receipt-fingerprint-conflict',
  ].includes(value) ? value as ReviewConflictReason : null;
};

const isSafeNonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

const parseXpAwarded = (value: unknown): 0 | 2 => {
  if (value === 0 || value === 2) return value;
  throw new Error('Invalid review response.');
};

const isLocalDay = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const isLanguage = (value: unknown): value is string => typeof value === 'string'
  && value.length <= 16
  && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(value);

const parseCeremonyEvents = (value: unknown): readonly ReviewCeremonyEvent[] => {
  if (!Array.isArray(value) || value.some(event => event !== 'tierup' && event !== 'streak' && event !== 'levelup')) {
    throw new Error('Invalid review response.');
  }
  return value as ReviewCeremonyEvent[];
};

const parseReviewActivity = (value: unknown): NonNullable<AuthoritativeGamification['reviewActivity']> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid review response.');
  const source = value as Record<string, unknown>;
  if (!isLanguage(source.targetLanguage)
    || !isLocalDay(source.coverageStartedOn)
    || !source.days || typeof source.days !== 'object' || Array.isArray(source.days) || Object.keys(source.days).length > 182) {
    throw new Error('Invalid review response.');
  }
  for (const [day, counters] of Object.entries(source.days)) {
    if (!isLocalDay(day) || !counters || typeof counters !== 'object' || Array.isArray(counters)) {
      throw new Error('Invalid review response.');
    }
    const record = counters as Record<string, unknown>;
    if (Object.keys(record).length !== 5
      || !['reviewed', 'again', 'hard', 'good', 'easy'].every(key => isSafeNonNegativeInteger(record[key]))
      || Number(record.reviewed) !== Number(record.again) + Number(record.hard) + Number(record.good) + Number(record.easy)) {
      throw new Error('Invalid review response.');
    }
  }
  return source as unknown as NonNullable<AuthoritativeGamification['reviewActivity']>;
};

const parseRewardTimeZone = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value) throw new Error('Invalid review response.');
  try { return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone; } catch { throw new Error('Invalid review response.'); }
};

const parseGamification = (value: unknown): AuthoritativeGamification => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid review response.');
  const source = value as Record<string, unknown>;
  if (!isSafeNonNegativeInteger(source.xp)
    || !isSafeNonNegativeInteger(source.streak)
    || !Number.isSafeInteger(source.level) || Number(source.level) < 1
    || !isLocalDay(source.studyDay)) {
    throw new Error('Invalid review response.');
  }
  const events = parseCeremonyEvents(source.events);
  if (events.some(event => event === 'tierup')) throw new Error('Invalid review response.');
  const reviewActivity = source.reviewActivity === undefined ? undefined : parseReviewActivity(source.reviewActivity);
  const rewardTimeZone = parseRewardTimeZone(source.rewardTimeZone);
  return {
    xp: Number(source.xp), streak: Number(source.streak), level: Number(source.level), studyDay: source.studyDay, events,
    ...(reviewActivity ? { reviewActivity } : {}),
    ...(rewardTimeZone ? { rewardTimeZone } : {}),
  };
};

const timeZoneHint = (): string | undefined => {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof timeZone === 'string' && timeZone ? timeZone : undefined;
  } catch {
    return undefined;
  }
};

export const stableReviewCommand = (command: ReviewCommand): ReviewCommand => {
  const timeZone = command.timeZone ?? timeZoneHint();
  return {
    ...command,
    ...(timeZone ? { timeZone } : {}),
    ...structuredClone({ fields: command.fields, fieldMask: command.fieldMask }),
  };
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
    const { httpsCallable } = await import('firebase/functions');
    const app = firebaseApp;
    if (!app) throw new Error('Firebase is not initialized.');
    const callable = httpsCallable<ReviewCommand, unknown>(
      await getSonFlashFunctions(app),
      'reviewCardV2',
    );
    try {
      const timeZone = command.timeZone ?? timeZoneHint();
      const response = await callable({
        ...command,
        ...(timeZone ? { timeZone } : {}),
        fields: command.fields,
        fieldMask: [...command.fieldMask],
      });
      const value = response.data;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid review response.');
      const envelope = value as Record<string, unknown>;
      if (envelope.applied !== true || typeof envelope.duplicate !== 'boolean') throw new Error('Invalid review response.');
      const outcome: ReviewOutcome = {
        ...(envelope.gamification === undefined ? {} : { gamification: parseGamification(envelope.gamification) }),
        ...(envelope.ceremonyEvents === undefined ? {} : { ceremonyEvents: parseCeremonyEvents(envelope.ceremonyEvents) }),
      };
      return {
        applied: true,
        duplicate: envelope.duplicate,
        xpAwarded: parseXpAwarded(envelope.xpAwarded),
        card: parseCard(envelope.card),
        ...outcome,
      };
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
  const stableCommand = stableReviewCommand(command);
  const first = await apply(stableCommand);
  if (first.applied || first.reason !== 'revision-conflict') return first;
  const authoritative = first.card;
  const reviewedAt = new Date(stableCommand.reviewedAt);
  if (Number.isNaN(reviewedAt.getTime())) return first;
  const lastReview = authoritative.fsrs?.lastReview ?? authoritative.reviewHistory?.at(-1)?.reviewedAt;
  if (lastReview && reviewedAt.getTime() <= new Date(lastReview).getTime()) return {
    applied: false,
    reason: 'stale-review',
  };
  const fields = scheduleReview(authoritative, stableCommand.rating, reviewedAt);
  return apply({
    ...stableCommand,
    baseRevision: authoritative.revision ?? first.currentRevision,
    fields,
    fieldMask: REVIEW_FIELDS,
  });
}
