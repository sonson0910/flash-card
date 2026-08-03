import { createLexemeId, createTrackMembershipId } from './lexemeIdentity';
import { isSupportedAudioUrl } from '../../lib/audio';
import { normalizeCardOperationId } from '../../lib/cardMutationProtocol';
import { isSupportedImageUrl } from '../../lib/images';
import {
  SCHEMA_V3_LIMITS,
  type FsrsStateV3,
  type LearningStateV3,
  type LexemeAggregateV3,
  type LexemeExampleV3,
  type LexemeV3,
  type LocalizedTextV3,
  type ReviewHistoryEntryV3,
  type TrackMembershipV3,
} from './schemaV3';

export class SchemaV3ValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaV3ValidationError';
  }
}

export interface ParseLexemeAggregateV3Options {
  readonly expectedOwnerId?: string;
}

export interface ParseLearningStateV3Options {
  readonly expectedOwnerId?: string;
  readonly expectedLexemeId: string;
}

type UnknownRecord = Record<string, unknown>;

function fail(path: string, reason: string): never {
  throw new SchemaV3ValidationError(`${path}: ${reason}`);
}

const objectAt = (value: unknown, path: string, keys: readonly string[]): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'expected object');
  const record = value as UnknownRecord;
  const unknownKey = Object.keys(record).find(key => !keys.includes(key));
  if (unknownKey) fail(`${path}.${unknownKey}`, 'unknown field');
  return record;
};

const schemaVersionAt = (value: unknown, path: string): 3 => {
  if (value !== 3) fail(path, 'expected schema version 3');
  return 3;
};

const stringAt = (
  value: unknown,
  path: string,
  maximum: number,
  options: { allowEmpty?: boolean } = {},
): string => {
  if (typeof value !== 'string') fail(path, 'expected string');
  if (!options.allowEmpty && value.length === 0) fail(path, 'must not be empty');
  if (value.length > maximum) fail(path, `exceeds ${maximum} characters`);
  return value;
};

const nullableStringAt = (value: unknown, path: string, maximum: number): string | null => {
  if (value === null) return null;
  return stringAt(value, path, maximum, { allowEmpty: true });
};

const finiteAt = (
  value: unknown,
  path: string,
  options: { integer?: boolean; minimum?: number; maximum?: number } = {},
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'expected finite number');
  if (options.integer && !Number.isSafeInteger(value)) fail(path, 'expected safe integer');
  if (options.minimum !== undefined && value < options.minimum) fail(path, `must be >= ${options.minimum}`);
  if (options.maximum !== undefined && value > options.maximum) fail(path, `must be <= ${options.maximum}`);
  return value;
};

const booleanAt = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') fail(path, 'expected boolean');
  return value;
};

const isoAt = (value: unknown, path: string): string => {
  const text = stringAt(value, path, SCHEMA_V3_LIMITS.shortText);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text) || !Number.isFinite(Date.parse(text))) {
    fail(path, 'expected ISO-8601 UTC timestamp');
  }
  return text;
};

const arrayAt = <T>(
  value: unknown,
  path: string,
  maximum: number,
  parse: (item: unknown, itemPath: string) => T,
  minimum = 0,
): readonly T[] => {
  if (!Array.isArray(value)) fail(path, 'expected array');
  if (value.length < minimum) fail(path, `requires at least ${minimum} item(s)`);
  if (value.length > maximum) fail(path, `exceeds ${maximum} items`);
  return value.map((item, index) => parse(item, `${path}[${index}]`));
};

const optional = <T>(value: unknown, parse: (candidate: unknown) => T): T | undefined => (
  value === undefined ? undefined : parse(value)
);

const localizedTextAt = (value: unknown, path: string): LocalizedTextV3 => {
  const record = objectAt(value, path, ['language', 'text']);
  return {
    language: stringAt(record.language, `${path}.language`, SCHEMA_V3_LIMITS.languageCode),
    text: stringAt(record.text, `${path}.text`, SCHEMA_V3_LIMITS.longText),
  };
};

const exampleAt = (value: unknown, path: string): LexemeExampleV3 => {
  const record = objectAt(value, path, ['text', 'translations']);
  return {
    text: stringAt(record.text, `${path}.text`, SCHEMA_V3_LIMITS.longText),
    translations: arrayAt(
      record.translations,
      `${path}.translations`,
      SCHEMA_V3_LIMITS.translationsPerExample,
      localizedTextAt,
    ),
  };
};

const lexemeAt = (value: unknown, path: string): LexemeV3 => {
  const record = objectAt(value, path, [
    'schemaVersion', 'id', 'language', 'lemma', 'normalizedLemma', 'partOfSpeech', 'senseKey',
    'definitions', 'phonetics', 'examples', 'collocations', 'wordFamily', 'media', 'compatibility', 'provenance',
    'contentVersion', 'createdAt', 'updatedAt',
  ]);
  const media = objectAt(record.media, `${path}.media`, ['audioUrl', 'imageUrl', 'imageSearchQuery']);
  const compatibility = objectAt(record.compatibility, `${path}.compatibility`, [
    'legacyPartOfSpeech', 'translation', 'explanation', 'explanationTranslation', 'emoji', 'exampleSentence',
    'exampleTranslation', 'synonyms', 'antonyms', 'register', 'commonMistake',
  ]);
  const provenance = objectAt(
    record.provenance,
    `${path}.provenance`,
    ['source', 'license', 'reviewer', 'editorialStatus'],
  );
  const editorialStatus = stringAt(
    provenance.editorialStatus,
    `${path}.provenance.editorialStatus`,
    SCHEMA_V3_LIMITS.shortText,
  );
  if (!['draft', 'reviewed', 'published', 'archived'].includes(editorialStatus)) {
    fail(`${path}.provenance.editorialStatus`, 'unsupported status');
  }
  const parsed: LexemeV3 = {
    schemaVersion: schemaVersionAt(record.schemaVersion, `${path}.schemaVersion`),
    id: stringAt(record.id, `${path}.id`, SCHEMA_V3_LIMITS.id),
    language: stringAt(record.language, `${path}.language`, SCHEMA_V3_LIMITS.languageCode),
    lemma: stringAt(record.lemma, `${path}.lemma`, SCHEMA_V3_LIMITS.lemma),
    normalizedLemma: stringAt(record.normalizedLemma, `${path}.normalizedLemma`, SCHEMA_V3_LIMITS.lemma),
    partOfSpeech: stringAt(record.partOfSpeech, `${path}.partOfSpeech`, SCHEMA_V3_LIMITS.partOfSpeech),
    senseKey: stringAt(record.senseKey, `${path}.senseKey`, SCHEMA_V3_LIMITS.senseKey),
    definitions: arrayAt(record.definitions, `${path}.definitions`, SCHEMA_V3_LIMITS.definitions, localizedTextAt, 1),
    phonetics: arrayAt(record.phonetics, `${path}.phonetics`, SCHEMA_V3_LIMITS.phonetics,
      (item, itemPath) => stringAt(item, itemPath, SCHEMA_V3_LIMITS.shortText)),
    examples: arrayAt(record.examples, `${path}.examples`, SCHEMA_V3_LIMITS.examples, exampleAt),
    collocations: arrayAt(record.collocations, `${path}.collocations`, SCHEMA_V3_LIMITS.collocations,
      (item, itemPath) => stringAt(item, itemPath, SCHEMA_V3_LIMITS.shortText)),
    wordFamily: arrayAt(record.wordFamily, `${path}.wordFamily`, SCHEMA_V3_LIMITS.wordFamily,
      (item, itemPath) => stringAt(item, itemPath, SCHEMA_V3_LIMITS.shortText)),
    media: {
      audioUrl: nullableStringAt(media.audioUrl, `${path}.media.audioUrl`, SCHEMA_V3_LIMITS.longText),
      imageUrl: nullableStringAt(media.imageUrl, `${path}.media.imageUrl`, SCHEMA_V3_LIMITS.longText),
      imageSearchQuery: optional(media.imageSearchQuery, item => stringAt(
        item, `${path}.media.imageSearchQuery`, SCHEMA_V3_LIMITS.shortText, { allowEmpty: true },
      )),
    },
    compatibility: {
      legacyPartOfSpeech: stringAt(
        compatibility.legacyPartOfSpeech,
        `${path}.compatibility.legacyPartOfSpeech`,
        SCHEMA_V3_LIMITS.partOfSpeech,
        { allowEmpty: true },
      ),
      translation: stringAt(compatibility.translation, `${path}.compatibility.translation`, 256),
      explanation: stringAt(compatibility.explanation, `${path}.compatibility.explanation`, SCHEMA_V3_LIMITS.longText, { allowEmpty: true }),
      explanationTranslation: stringAt(compatibility.explanationTranslation, `${path}.compatibility.explanationTranslation`, SCHEMA_V3_LIMITS.longText, { allowEmpty: true }),
      emoji: stringAt(compatibility.emoji, `${path}.compatibility.emoji`, 64, { allowEmpty: true }),
      exampleSentence: stringAt(compatibility.exampleSentence, `${path}.compatibility.exampleSentence`, SCHEMA_V3_LIMITS.longText, { allowEmpty: true }),
      exampleTranslation: stringAt(compatibility.exampleTranslation, `${path}.compatibility.exampleTranslation`, SCHEMA_V3_LIMITS.longText, { allowEmpty: true }),
      synonyms: arrayAt(compatibility.synonyms, `${path}.compatibility.synonyms`, 4,
        (item, itemPath) => stringAt(item, itemPath, 100)),
      antonyms: arrayAt(compatibility.antonyms, `${path}.compatibility.antonyms`, 4,
        (item, itemPath) => stringAt(item, itemPath, 100)),
      register: stringAt(compatibility.register, `${path}.compatibility.register`, 64, { allowEmpty: true }),
      commonMistake: stringAt(compatibility.commonMistake, `${path}.compatibility.commonMistake`, SCHEMA_V3_LIMITS.longText, { allowEmpty: true }),
    },
    provenance: {
      source: stringAt(provenance.source, `${path}.provenance.source`, SCHEMA_V3_LIMITS.shortText),
      license: stringAt(provenance.license, `${path}.provenance.license`, SCHEMA_V3_LIMITS.shortText),
      reviewer: stringAt(provenance.reviewer, `${path}.provenance.reviewer`, SCHEMA_V3_LIMITS.shortText),
      editorialStatus: editorialStatus as LexemeV3['provenance']['editorialStatus'],
    },
    contentVersion: finiteAt(record.contentVersion, `${path}.contentVersion`, { integer: true, minimum: 1 }),
    createdAt: isoAt(record.createdAt, `${path}.createdAt`),
    updatedAt: isoAt(record.updatedAt, `${path}.updatedAt`),
  };
  if (parsed.media.audioUrl !== null && !isSupportedAudioUrl(parsed.media.audioUrl)) {
    fail(`${path}.media.audioUrl`, 'unsupported audio URL');
  }
  if (parsed.media.imageUrl !== null && !isSupportedImageUrl(parsed.media.imageUrl)) {
    fail(`${path}.media.imageUrl`, 'unsupported image URL');
  }
  const expectedId = createLexemeId(parsed);
  if (parsed.id !== expectedId) fail(`${path}.id`, 'does not match logical lexeme identity');
  return parsed;
};

const membershipAt = (value: unknown, path: string, lexemeId: string): TrackMembershipV3 => {
  const record = objectAt(value, path, [
    'schemaVersion', 'id', 'lexemeId', 'trackId', 'tier', 'cefrLevel', 'topic', 'legacyCategory', 'skills',
    'rank', 'lessonGroup', 'editorialStatus', 'contentVersion',
  ]);
  const parsed: TrackMembershipV3 = {
    schemaVersion: schemaVersionAt(record.schemaVersion, `${path}.schemaVersion`),
    id: stringAt(record.id, `${path}.id`, SCHEMA_V3_LIMITS.id),
    lexemeId: stringAt(record.lexemeId, `${path}.lexemeId`, SCHEMA_V3_LIMITS.id),
    trackId: stringAt(record.trackId, `${path}.trackId`, SCHEMA_V3_LIMITS.id),
    tier: stringAt(record.tier, `${path}.tier`, SCHEMA_V3_LIMITS.shortText),
    cefrLevel: nullableStringAt(record.cefrLevel, `${path}.cefrLevel`, SCHEMA_V3_LIMITS.shortText),
    topic: stringAt(record.topic, `${path}.topic`, SCHEMA_V3_LIMITS.shortText),
    legacyCategory: stringAt(record.legacyCategory, `${path}.legacyCategory`, SCHEMA_V3_LIMITS.shortText),
    skills: arrayAt(record.skills, `${path}.skills`, SCHEMA_V3_LIMITS.skills,
      (item, itemPath) => stringAt(item, itemPath, SCHEMA_V3_LIMITS.shortText)),
    rank: finiteAt(record.rank, `${path}.rank`, { integer: true, minimum: 0 }),
    lessonGroup: stringAt(record.lessonGroup, `${path}.lessonGroup`, SCHEMA_V3_LIMITS.shortText),
    editorialStatus: (() => {
      const status = stringAt(record.editorialStatus, `${path}.editorialStatus`, SCHEMA_V3_LIMITS.shortText);
      if (!['draft', 'reviewed', 'published', 'archived'].includes(status)) {
        fail(`${path}.editorialStatus`, 'unsupported status');
      }
      return status as TrackMembershipV3['editorialStatus'];
    })(),
    contentVersion: finiteAt(record.contentVersion, `${path}.contentVersion`, { integer: true, minimum: 1 }),
  };
  if (parsed.lexemeId !== lexemeId) fail(`${path}.lexemeId`, 'does not reference aggregate lexeme');
  const expectedId = createTrackMembershipId(parsed);
  if (parsed.id !== expectedId) fail(`${path}.id`, 'does not match membership identity');
  return parsed;
};

const fsrsAt = (value: unknown, path: string): FsrsStateV3 => {
  const record = objectAt(value, path, [
    'due', 'stability', 'difficulty', 'elapsedDays', 'scheduledDays', 'learningSteps',
    'reps', 'lapses', 'state', 'lastReview',
  ]);
  return {
    due: isoAt(record.due, `${path}.due`),
    stability: finiteAt(record.stability, `${path}.stability`, { minimum: 0 }),
    difficulty: finiteAt(record.difficulty, `${path}.difficulty`, { minimum: 0, maximum: 10 }),
    elapsedDays: finiteAt(record.elapsedDays, `${path}.elapsedDays`, { minimum: 0 }),
    scheduledDays: finiteAt(record.scheduledDays, `${path}.scheduledDays`, { minimum: 0 }),
    learningSteps: finiteAt(record.learningSteps, `${path}.learningSteps`, { minimum: 0 }),
    reps: finiteAt(record.reps, `${path}.reps`, { integer: true, minimum: 0 }),
    lapses: finiteAt(record.lapses, `${path}.lapses`, { integer: true, minimum: 0 }),
    state: finiteAt(record.state, `${path}.state`, { integer: true, minimum: 0, maximum: 3 }),
    lastReview: optional(record.lastReview, item => isoAt(item, `${path}.lastReview`)),
  };
};

const reviewAt = (value: unknown, path: string): ReviewHistoryEntryV3 => {
  const record = objectAt(value, path, ['rating', 'reviewedAt', 'scheduledDays', 'elapsedDays']);
  const rating = stringAt(record.rating, `${path}.rating`, 16);
  if (!['again', 'hard', 'good', 'easy'].includes(rating)) fail(`${path}.rating`, 'unsupported rating');
  return {
    rating: rating as ReviewHistoryEntryV3['rating'],
    reviewedAt: isoAt(record.reviewedAt, `${path}.reviewedAt`),
    scheduledDays: finiteAt(record.scheduledDays, `${path}.scheduledDays`, { integer: true, minimum: 0 }),
    elapsedDays: finiteAt(record.elapsedDays, `${path}.elapsedDays`, { integer: true, minimum: 0 }),
  };
};

const learningStateAt = (value: unknown, path: string, lexemeId: string): LearningStateV3 => {
  const record = objectAt(value, path, [
    'schemaVersion', 'ownerId', 'lexemeId', 'legacyCardId', 'legacySchemaVersion', 'fsrs', 'reviewHistory', 'bookmarked', 'difficulty',
    'mastery', 'correctStreak', 'lastActivityAt', 'customCollections', 'nextReviewDate', 'reviews',
    'interval', 'easeFactor', 'revision', 'libraryEpoch', 'createdAt', 'lastOpenedAt', 'sortTouchedAt', 'updatedAt',
  ]);
  const difficulty = stringAt(record.difficulty, `${path}.difficulty`, 16);
  if (!['easy', 'good', 'hard', 'unrated'].includes(difficulty)) fail(`${path}.difficulty`, 'unsupported difficulty');
  const parsed: LearningStateV3 = {
    schemaVersion: schemaVersionAt(record.schemaVersion, `${path}.schemaVersion`),
    ownerId: stringAt(record.ownerId, `${path}.ownerId`, SCHEMA_V3_LIMITS.id),
    lexemeId: stringAt(record.lexemeId, `${path}.lexemeId`, SCHEMA_V3_LIMITS.id),
    legacyCardId: stringAt(record.legacyCardId, `${path}.legacyCardId`, SCHEMA_V3_LIMITS.id),
    legacySchemaVersion: optional(record.legacySchemaVersion, item => {
      if (item !== 2) fail(`${path}.legacySchemaVersion`, 'expected legacy schema version 2');
      return 2 as const;
    }),
    fsrs: optional(record.fsrs, item => fsrsAt(item, `${path}.fsrs`)),
    reviewHistory: arrayAt(record.reviewHistory, `${path}.reviewHistory`, SCHEMA_V3_LIMITS.reviewHistory, reviewAt),
    bookmarked: booleanAt(record.bookmarked, `${path}.bookmarked`),
    difficulty: difficulty as LearningStateV3['difficulty'],
    mastery: optional(record.mastery, item => finiteAt(item, `${path}.mastery`, { minimum: 0, maximum: 1 })),
    correctStreak: finiteAt(record.correctStreak, `${path}.correctStreak`, { integer: true, minimum: 0 }),
    lastActivityAt: optional(record.lastActivityAt, item => isoAt(item, `${path}.lastActivityAt`)),
    customCollections: arrayAt(record.customCollections, `${path}.customCollections`, SCHEMA_V3_LIMITS.customCollections,
      (item, itemPath) => stringAt(item, itemPath, SCHEMA_V3_LIMITS.shortText)),
    nextReviewDate: optional(record.nextReviewDate, item => isoAt(item, `${path}.nextReviewDate`)),
    reviews: optional(record.reviews, item => finiteAt(item, `${path}.reviews`, { integer: true, minimum: 0 })),
    interval: optional(record.interval, item => finiteAt(item, `${path}.interval`, { minimum: 0 })),
    easeFactor: optional(record.easeFactor, item => finiteAt(item, `${path}.easeFactor`, { minimum: 0, maximum: 5 })),
    revision: optional(record.revision, item => finiteAt(item, `${path}.revision`, { integer: true, minimum: 0 })),
    libraryEpoch: optional(record.libraryEpoch, item => finiteAt(item, `${path}.libraryEpoch`, { integer: true, minimum: 0 })),
    createdAt: isoAt(record.createdAt, `${path}.createdAt`),
    lastOpenedAt: optional(record.lastOpenedAt, item => isoAt(item, `${path}.lastOpenedAt`)),
    sortTouchedAt: optional(record.sortTouchedAt, item => isoAt(item, `${path}.sortTouchedAt`)),
    updatedAt: optional(record.updatedAt, item => isoAt(item, `${path}.updatedAt`)),
  };
  if (parsed.lexemeId !== lexemeId) fail(`${path}.lexemeId`, 'does not reference aggregate lexeme');
  if (normalizeCardOperationId(parsed.legacyCardId) !== parsed.legacyCardId) {
    fail(`${path}.legacyCardId`, 'must be a Firestore-safe document id');
  }
  return parsed;
};

export function parseLearningStateV3(
  value: unknown,
  options: ParseLearningStateV3Options,
): LearningStateV3 {
  const parsed = learningStateAt(value, 'learningState', options.expectedLexemeId);
  if (options.expectedOwnerId !== undefined && parsed.ownerId !== options.expectedOwnerId) {
    fail('learningState.ownerId', 'does not match expected owner');
  }
  return parsed;
}

export function parseLexemeAggregateV3(
  value: unknown,
  options: ParseLexemeAggregateV3Options = {},
): LexemeAggregateV3 {
  const record = objectAt(value, 'aggregate', ['schemaVersion', 'lexeme', 'memberships', 'learningState']);
  const schemaVersion = schemaVersionAt(record.schemaVersion, 'aggregate.schemaVersion');
  const lexeme = lexemeAt(record.lexeme, 'aggregate.lexeme');
  const memberships = arrayAt(
    record.memberships,
    'aggregate.memberships',
    SCHEMA_V3_LIMITS.memberships,
    (item, itemPath) => membershipAt(item, itemPath, lexeme.id),
    1,
  );
  if (new Set(memberships.map(item => item.id)).size !== memberships.length) {
    fail('aggregate.memberships', 'contains duplicate ids');
  }
  const learningState = record.learningState === null
    ? null
    : parseLearningStateV3(record.learningState, {
      expectedOwnerId: options.expectedOwnerId,
      expectedLexemeId: lexeme.id,
    });
  return { schemaVersion, lexeme, memberships, learningState };
}
