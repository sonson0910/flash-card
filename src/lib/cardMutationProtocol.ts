import type { CardData } from '../types/card';
import { createWordCardId } from './cardIdentity';

export const CURRENT_CARD_SCHEMA_VERSION = 2 as const;

export type CardMutationKind = 'create' | 'patch' | 'review' | 'delete';

export type CardMutableField = Exclude<
  keyof CardData,
  'id' | 'schemaVersion' | 'revision' | 'libraryEpoch' | 'createdAt' | 'updatedAt'
>;

const mutableCardFields = new Set<CardMutableField>([
  'word',
  'normalizedWord',
  'translation',
  'explanation',
  'explanationTranslation',
  'phonetic',
  'emoji',
  'category',
  'audioUrl',
  'imageUrl',
  'imageSearchQuery',
  'lastOpenedAt',
  'sortTouchedAt',
  'bookmarked',
  'difficulty',
  'customDeck',
  'nextReviewDate',
  'reviews',
  'interval',
  'easeFactor',
  'fsrs',
  'reviewHistory',
  'partOfSpeech',
  'cefrLevel',
  'exampleSentence',
  'exampleTranslation',
  'collocations',
  'synonyms',
  'antonyms',
  'register',
  'commonMistake',
  'correctStreak',
  'mnemonic',
  'wordFamily',
]);

export interface CardTombstone {
  cardId: string;
  opId: string;
  libraryEpoch: number;
  revision: number;
  deletedAt: string;
}

export interface MutationPrecondition {
  mutationEpoch: number;
  currentLibraryEpoch: number;
  baseRevision: number;
  currentRevision: number;
  tombstoneRevision?: number;
  operation?: CardMutationKind;
}

export type MutationPreconditionResult =
  | { accepted: true }
  | { accepted: false; reason: 'future-library-epoch' | 'stale-library-epoch' | 'revision-conflict' | 'deleted' };

const safeCounter = (value: unknown, fallback = 0): number =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback;

/**
 * Firestore Rules accept operation ids containing only ASCII letters, digits,
 * underscores, and hyphens. V1 pending deletes embedded an ISO timestamp, so
 * normalise those legacy values deterministically instead of dropping them.
 */
export function normalizeCardOperationId(value: string): string {
  if (/^[a-zA-Z0-9_-]{1,128}$/.test(value)) return value;
  return `op-${createWordCardId(value).slice('word-'.length)}`;
}

export function prepareCardForCreate(
  card: CardData,
  { libraryEpoch = card.libraryEpoch ?? 0 }: { libraryEpoch?: number } = {},
): CardData {
  return {
    ...card,
    schemaVersion: CURRENT_CARD_SCHEMA_VERSION,
    revision: 1,
    libraryEpoch: safeCounter(libraryEpoch),
  };
}

export function applyCardPatch(
  card: CardData,
  fields: Partial<CardData>,
  fieldMask: readonly (keyof CardData)[],
): CardData {
  const next: CardData = { ...card };
  const patch = selectMutableCardPatch(fields, fieldMask);
  for (const [field, value] of Object.entries(patch) as Array<[CardMutableField, unknown]>) {
    (next as unknown as Record<CardMutableField, unknown>)[field] = value;
  }
  next.schemaVersion = CURRENT_CARD_SCHEMA_VERSION;
  next.revision = safeCounter(card.revision) + 1;
  next.libraryEpoch = safeCounter(card.libraryEpoch);
  return next;
}

export function selectMutableCardPatch(
  fields: Partial<CardData>,
  fieldMask: readonly (keyof CardData)[],
): Partial<Pick<CardData, CardMutableField>> {
  return Object.fromEntries(fieldMask.flatMap(field =>
    mutableCardFields.has(field as CardMutableField)
      && Object.prototype.hasOwnProperty.call(fields, field)
      ? [[field as CardMutableField, fields[field]]]
      : [],
  )) as Partial<Pick<CardData, CardMutableField>>;
}

function cardFieldValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => cardFieldValuesEqual(value, right[index]));
  }
  if (
    left
    && right
    && typeof left === 'object'
    && typeof right === 'object'
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) =>
        key === rightKeys[index]
        && cardFieldValuesEqual(leftRecord[key], rightRecord[key]));
  }
  return false;
}

export function cardAlreadyHasPatch(
  card: Partial<CardData>,
  fields: Partial<CardData>,
  fieldMask: readonly (keyof CardData)[],
): boolean {
  const patch = selectMutableCardPatch(fields, fieldMask);
  return Object.entries(patch).every(([field, value]) =>
    cardFieldValuesEqual(card[field as keyof CardData], value));
}

export function evaluateMutationPrecondition(
  precondition: MutationPrecondition,
): MutationPreconditionResult {
  const mutationEpoch = safeCounter(precondition.mutationEpoch);
  const currentLibraryEpoch = safeCounter(precondition.currentLibraryEpoch);
  if (mutationEpoch < currentLibraryEpoch) return { accepted: false, reason: 'stale-library-epoch' };
  if (mutationEpoch > currentLibraryEpoch) return { accepted: false, reason: 'future-library-epoch' };

  const baseRevision = safeCounter(precondition.baseRevision);
  const currentRevision = safeCounter(precondition.currentRevision);
  if (baseRevision !== currentRevision) return { accepted: false, reason: 'revision-conflict' };

  const tombstoneRevision = precondition.tombstoneRevision === undefined
    ? undefined
    : safeCounter(precondition.tombstoneRevision);
  if (
    tombstoneRevision !== undefined
    && (precondition.operation !== 'create' || baseRevision < tombstoneRevision)
  ) {
    return { accepted: false, reason: 'deleted' };
  }
  return { accepted: true };
}

export function buildCardTombstone({
  cardId,
  opId,
  libraryEpoch,
  baseRevision,
  deletedAt,
}: {
  cardId: string;
  opId: string;
  libraryEpoch: number;
  baseRevision: number;
  deletedAt: string;
}): CardTombstone {
  return {
    cardId,
    opId: normalizeCardOperationId(opId),
    libraryEpoch: safeCounter(libraryEpoch),
    revision: safeCounter(baseRevision) + 1,
    deletedAt,
  };
}
