import { createWordCardId } from '../../lib/cardIdentity';
import { normalizeCardData } from '../../lib/cardNormalization';
import type { CardData } from '../../types/card';
import { createLexemeId, createTrackMembershipId } from './lexemeIdentity';
import type {
  LearningStateV3,
  LexemeV3,
  TrackMembershipV3,
} from './schemaV3';

export interface V2MigrationInput {
  readonly ownerId: string;
  readonly sourceDocumentId: string;
  readonly card: Partial<CardData>;
  readonly senseKey?: string;
  readonly migratedAt: string;
}

export interface V2MigrationSource {
  readonly ownerId: string;
  readonly documentId: string;
  readonly cardId: string;
  readonly schemaVersion: 2 | null;
  readonly revision?: number;
  readonly libraryEpoch?: number;
  readonly fingerprint: string;
}

export interface V2RollbackSnapshot {
  readonly schemaVersion: 3;
  readonly snapshotVersion: 1;
  readonly ownerId: string;
  readonly sourceDocumentId: string;
  readonly sourceFingerprint: string;
  readonly normalizedCard: CardData;
}

export interface V2MigrationBundle {
  readonly schemaVersion: 3;
  readonly migrationVersion: 1;
  readonly migrationId: string;
  readonly migratedAt: string;
  readonly source: V2MigrationSource;
  readonly lexeme: LexemeV3;
  readonly memberships: readonly [TrackMembershipV3];
  readonly learningState: LearningStateV3;
  readonly rollback: V2RollbackSnapshot;
}

const requireText = (name: string, value: string): string => {
  const normalized = value.normalize('NFKC').trim();
  if (!normalized) throw new TypeError(`${name} is required for v2 migration.`);
  return normalized;
};

const requireOpaqueId = (name: string, value: string): string => {
  if (!value) throw new TypeError(`${name} is required for v2 migration.`);
  return value;
};

const normalizeIsoDate = (name: string, value: string): string => {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new TypeError(`${name} must be a valid date.`);
  return timestamp.toISOString();
};

const canonicalJson = (value: unknown): string => JSON.stringify(value, (_key, entry) => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  return Object.fromEntries(
    Object.entries(entry as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0),
  );
});

const utf8Hex = (value: string): string => Array.from(new TextEncoder().encode(value))
  .map(byte => byte.toString(16).padStart(2, '0'))
  .join('');

const fingerprint = (prefix: 'v2' | 'rollback' | 'migration', value: unknown): string =>
  `${prefix}-${createWordCardId(utf8Hex(canonicalJson(value))).slice('word-'.length)}`;

const cloneCard = (card: CardData): CardData => ({
  ...card,
  collocations: card.collocations ? [...card.collocations] : card.collocations,
  synonyms: card.synonyms ? [...card.synonyms] : card.synonyms,
  antonyms: card.antonyms ? [...card.antonyms] : card.antonyms,
  reviewHistory: card.reviewHistory?.map(review => ({ ...review })),
  fsrs: card.fsrs ? { ...card.fsrs } : card.fsrs,
});

const defaultSenseKey = (sourceDocumentId: string): string =>
  `legacy-${createWordCardId(utf8Hex(sourceDocumentId)).slice('word-'.length)}`.slice(0, 128);

const optionalLocalizedText = (language: string, text: string) =>
  text ? [{ language, text }] : [];

function createRollbackSnapshot({
  ownerId,
  sourceDocumentId,
  normalizedCard,
}: {
  ownerId: string;
  sourceDocumentId: string;
  normalizedCard: CardData;
}): V2RollbackSnapshot {
  const card = cloneCard(normalizedCard);
  return {
    schemaVersion: 3,
    snapshotVersion: 1,
    ownerId,
    sourceDocumentId,
    sourceFingerprint: fingerprint('rollback', { ownerId, sourceDocumentId, card }),
    normalizedCard: card,
  };
}

export function restoreV2Card(snapshot: V2RollbackSnapshot): CardData {
  const expected = fingerprint('rollback', {
    ownerId: snapshot.ownerId,
    sourceDocumentId: snapshot.sourceDocumentId,
    card: snapshot.normalizedCard,
  });
  if (snapshot.sourceFingerprint !== expected) {
    throw new Error('The rollback snapshot fingerprint does not match its normalized card.');
  }
  return cloneCard(snapshot.normalizedCard);
}

export function planV2CardMigration(input: V2MigrationInput): V2MigrationBundle {
  const ownerId = requireOpaqueId('ownerId', input.ownerId);
  const sourceDocumentId = requireOpaqueId('sourceDocumentId', input.sourceDocumentId);
  const migrationTimestamp = normalizeIsoDate('migratedAt', input.migratedAt);
  const normalizedCard = normalizeCardData(input.card, sourceDocumentId);
  const lemma = requireText('word', normalizedCard.word);
  const normalizedLemma = requireText('normalizedWord', normalizedCard.normalizedWord || lemma);
  const partOfSpeech = normalizedCard.partOfSpeech || 'unknown';
  const senseKey = input.senseKey
    ? requireText('senseKey', input.senseKey).toLowerCase().replace(/\s+/g, ' ').slice(0, 128)
    : defaultSenseKey(sourceDocumentId);
  const sourceFingerprint = fingerprint('v2', { sourceDocumentId, card: normalizedCard });
  const lexemeId = createLexemeId({
    language: 'en',
    normalizedLemma,
    partOfSpeech,
    senseKey,
  });
  const membershipId = createTrackMembershipId({ trackId: 'general', lexemeId });

  const lexeme: LexemeV3 = {
    schemaVersion: 3,
    id: lexemeId,
    language: 'en',
    lemma,
    normalizedLemma,
    partOfSpeech,
    senseKey,
    definitions: [
      ...optionalLocalizedText('vi', normalizedCard.translation),
      ...optionalLocalizedText('en', normalizedCard.explanation),
      ...optionalLocalizedText('vi', normalizedCard.explanationTranslation || ''),
    ],
    phonetics: normalizedCard.phonetic ? [normalizedCard.phonetic] : [],
    examples: normalizedCard.exampleSentence
      ? [{
          text: normalizedCard.exampleSentence,
          translations: optionalLocalizedText('vi', normalizedCard.exampleTranslation || ''),
        }]
      : [],
    collocations: [...(normalizedCard.collocations || [])],
    wordFamily: [],
    media: {
      audioUrl: normalizedCard.audioUrl,
      imageUrl: normalizedCard.imageUrl,
      ...(normalizedCard.imageSearchQuery
        ? { imageSearchQuery: normalizedCard.imageSearchQuery }
        : {}),
    },
    compatibility: {
      translation: normalizedCard.translation,
      explanation: normalizedCard.explanation,
      explanationTranslation: normalizedCard.explanationTranslation || '',
      emoji: normalizedCard.emoji,
      exampleSentence: normalizedCard.exampleSentence || '',
      exampleTranslation: normalizedCard.exampleTranslation || '',
      synonyms: [...(normalizedCard.synonyms || [])],
      antonyms: [...(normalizedCard.antonyms || [])],
      register: normalizedCard.register || '',
      commonMistake: normalizedCard.commonMistake || '',
    },
    provenance: {
      source: 'legacy-v2',
      license: 'non-publishable',
      reviewer: 'unreviewed',
      editorialStatus: 'draft',
    },
    contentVersion: 1,
    createdAt: migrationTimestamp,
    updatedAt: migrationTimestamp,
  };

  const membership: TrackMembershipV3 = {
    schemaVersion: 3,
    id: membershipId,
    lexemeId,
    trackId: 'general',
    tier: 'legacy',
    cefrLevel: normalizedCard.cefrLevel || null,
    topic: normalizedCard.category,
    legacyCategory: normalizedCard.category,
    skills: [],
    rank: 0,
    lessonGroup: 'legacy-v2',
    editorialStatus: 'draft',
    contentVersion: 1,
  };

  const learningState: LearningStateV3 = {
    schemaVersion: 3,
    ownerId,
    lexemeId,
    legacyCardId: normalizedCard.id,
    ...(normalizedCard.fsrs ? { fsrs: { ...normalizedCard.fsrs } } : {}),
    reviewHistory: (normalizedCard.reviewHistory || []).map(review => ({ ...review })),
    bookmarked: normalizedCard.bookmarked === true,
    difficulty: normalizedCard.difficulty || 'unrated',
    correctStreak: normalizedCard.correctStreak || 0,
    lastActivityAt: normalizedCard.sortTouchedAt || normalizedCard.lastOpenedAt || normalizedCard.createdAt,
    customCollections: normalizedCard.customDeck ? [normalizedCard.customDeck] : [],
    ...(normalizedCard.nextReviewDate ? { nextReviewDate: normalizedCard.nextReviewDate } : {}),
    reviews: normalizedCard.reviews,
    interval: normalizedCard.interval,
    easeFactor: normalizedCard.easeFactor,
    ...(normalizedCard.revision !== undefined ? { revision: normalizedCard.revision } : {}),
    ...(normalizedCard.libraryEpoch !== undefined ? { libraryEpoch: normalizedCard.libraryEpoch } : {}),
    createdAt: normalizedCard.createdAt as string,
    ...(normalizedCard.lastOpenedAt ? { lastOpenedAt: normalizedCard.lastOpenedAt } : {}),
    ...(normalizedCard.sortTouchedAt ? { sortTouchedAt: normalizedCard.sortTouchedAt } : {}),
    ...(normalizedCard.updatedAt ? { updatedAt: normalizedCard.updatedAt } : {}),
  };

  const source: V2MigrationSource = {
    ownerId,
    documentId: sourceDocumentId,
    cardId: normalizedCard.id,
    schemaVersion: normalizedCard.schemaVersion ?? null,
    ...(normalizedCard.revision !== undefined ? { revision: normalizedCard.revision } : {}),
    ...(normalizedCard.libraryEpoch !== undefined ? { libraryEpoch: normalizedCard.libraryEpoch } : {}),
    fingerprint: sourceFingerprint,
  };
  const rollback = createRollbackSnapshot({
    ownerId,
    sourceDocumentId,
    normalizedCard,
  });

  return {
    schemaVersion: 3,
    migrationVersion: 1,
    migrationId: fingerprint('migration', { ownerId, sourceDocumentId, sourceFingerprint }),
    migratedAt: migrationTimestamp,
    source,
    lexeme,
    memberships: [membership],
    learningState,
    rollback,
  };
}
