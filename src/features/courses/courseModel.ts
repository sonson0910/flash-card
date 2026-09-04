import type { CardData } from '../../types/card';
import { assertFirestoreDocumentSegment } from '../multilingual/firestoreDocumentIdentity';
import { createMigrationFingerprint } from '../multilingual/v2Migration';
import { SCHEMA_V3_LIMITS } from '../multilingual/schemaV3';

export type CourseSourceV1 = 'personal' | 'catalog';
export type LearningFocusV1 = 'balanced' | 'learn' | 'hear' | 'speak';
export type SessionSizeV1 = 'short' | 'standard' | 'deep';

export const ADAPTIVE_SESSION_TARGETS = Object.freeze({
  short: 5,
  standard: 10,
  deep: 15,
} as const);

export interface CourseV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly ownerId: string | null;
  readonly contentLanguage: string;
  readonly supportLanguage: string;
  readonly title: string;
  readonly description: string;
  readonly source: CourseSourceV1;
  readonly archivedAt: string | null;
  readonly revision: number;
}

export interface ScenarioV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly courseId: string;
  readonly title: string;
  readonly rank: number;
}

export interface CourseItemV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly courseId: string;
  readonly scenarioId: string;
  readonly lexemeId: string;
  readonly rank: number;
}

export interface EnrollmentV1 {
  readonly schemaVersion: 1;
  readonly courseId: string;
  readonly activeScenarioId: string;
  readonly completedScenarioIds: readonly string[];
  readonly introducedItemIds: readonly string[];
  readonly updatedAt: string;
}

export interface LearningPreferencesV1 {
  readonly schemaVersion: 1;
  readonly useV3Courses: boolean;
  readonly activeCourseByLanguage: Readonly<Record<string, string>>;
  readonly focus: LearningFocusV1;
  readonly sessionSize: SessionSizeV1;
}

export interface CourseProjectionV1 {
  readonly course: CourseV1;
  readonly scenario: ScenarioV1;
  readonly items: readonly CourseItemV1[];
  readonly enrollment: EnrollmentV1;
  readonly preferences: LearningPreferencesV1;
}

export interface PersonalLibraryProjectionInput {
  readonly ownerId: string;
  readonly contentLanguage: string;
  readonly supportLanguage: string;
  readonly cards: readonly CardData[];
  readonly migratedAt: string;
}

export interface CatalogCourseProjectionEntry {
  readonly lexemeId: string;
  readonly rank: number;
}

export interface CatalogEntriesProjectionInput {
  readonly catalogId: string;
  readonly releaseId: string;
  readonly trackId: string;
  readonly contentLanguage: string;
  readonly supportLanguage: string;
  readonly title: string;
  readonly entries: readonly CatalogCourseProjectionEntry[];
  readonly createdAt: string;
}

export class AdaptiveCourseValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'AdaptiveCourseValidationError';
  }
}

type UnknownRecord = Record<string, unknown>;
type DocumentSegmentKind = 'ownerId' | 'lexemeId' | 'sourceDocumentId';

const fail = (path: string, message: string): never => {
  throw new AdaptiveCourseValidationError(`${path}: ${message}`);
};

const recordAt = (value: unknown, path: string, keys: readonly string[]): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'expected object');
  }
  const record = value as UnknownRecord;
  const unknown = Object.keys(record).find(key => !keys.includes(key));
  if (unknown) fail(`${path}.${unknown}`, 'unknown field');
  return record;
};

const textAt = (
  value: unknown,
  path: string,
  maximum: number,
  allowEmpty = false,
): string => {
  if (typeof value !== 'string' || value.length > maximum) {
    fail(path, `expected ${allowEmpty ? 0 : 1}-${maximum} characters`);
  }
  const text = value as string;
  if (!allowEmpty && !text) fail(path, `expected 1-${maximum} characters`);
  if (text !== text.normalize('NFKC').trim()) fail(path, 'must be canonical and trimmed');
  return text;
};

const documentSegmentAt = (
  value: unknown,
  path: string,
  kind: DocumentSegmentKind,
): string => {
  const segment = textAt(value, path, SCHEMA_V3_LIMITS.id);
  try {
    return assertFirestoreDocumentSegment(segment, kind);
  } catch {
    return fail(path, 'invalid Firestore document segment');
  }
};

const languageAt = (value: unknown, path: string): string => {
  const language = textAt(value, path, SCHEMA_V3_LIMITS.languageCode);
  if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(language)) {
    fail(path, 'must be a language code');
  }
  return language;
};

const enumAt = <T extends string>(
  value: unknown,
  path: string,
  values: readonly T[],
): T => {
  const parsed = textAt(value, path, SCHEMA_V3_LIMITS.shortText);
  if (!values.includes(parsed as T)) fail(path, 'unsupported value');
  return parsed as T;
};

const schemaVersionAt = (value: unknown, path: string): 1 => {
  if (value !== 1) fail(path, 'expected schema version 1');
  return 1;
};

const integerAt = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(path, `expected an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
};

const timestampAt = (value: unknown, path: string): string => {
  const timestamp = textAt(value, path, SCHEMA_V3_LIMITS.shortText);
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) {
    fail(path, 'expected canonical ISO-8601 UTC timestamp');
  }
  return timestamp;
};

const booleanAt = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') fail(path, 'expected boolean');
  return value as boolean;
};

const arrayOfIdsAt = (value: unknown, path: string, kind: DocumentSegmentKind): readonly string[] => {
  const values = Array.isArray(value) ? value : fail(path, 'expected an array');
  if (values.length > SCHEMA_V3_LIMITS.memberships) {
    fail(path, `expected at most ${SCHEMA_V3_LIMITS.memberships} items`);
  }
  const ids = values.map((entry, index) => documentSegmentAt(entry, `${path}[${index}]`, kind));
  if (new Set(ids).size !== ids.length) fail(path, 'contains duplicate IDs');
  return ids;
};

const languageMapAt = (value: unknown, path: string): Readonly<Record<string, string>> => {
  const record = recordAt(value, path, Object.keys((value ?? {}) as object));
  const entries = Object.entries(record);
  if (entries.length > SCHEMA_V3_LIMITS.skills) {
    fail(path, `expected at most ${SCHEMA_V3_LIMITS.skills} languages`);
  }
  const result: Record<string, string> = {};
  for (const [language, courseId] of entries) {
    const parsedLanguage = languageAt(language, `${path}.${language}`);
    result[parsedLanguage] = documentSegmentAt(courseId, `${path}.${language}`, 'sourceDocumentId');
  }
  return result;
};

const generatedId = (domain: string, value: unknown): string => (
  assertFirestoreDocumentSegment(
    createMigrationFingerprint('migration', { domain, value }),
    'sourceDocumentId',
  )
);

const assertProjectionItems = (items: readonly CourseItemV1[]): readonly CourseItemV1[] => {
  if (items.length > 10_000) throw new AdaptiveCourseValidationError('items: exceeds 10000 items');
  const parsed = items.map(item => parseCourseItemV1(item));
  const ids = new Set(parsed.map(item => item.id));
  const lexemeIds = new Set(parsed.map(item => item.lexemeId));
  if (ids.size !== parsed.length || lexemeIds.size !== parsed.length) {
    throw new AdaptiveCourseValidationError('items: contains duplicate IDs');
  }
  return parsed;
};

export const createCourseId = (
  source: CourseSourceV1,
  contentLanguage: string,
  key: string,
): string => {
  const parsedSource = enumAt(source, 'source', ['personal', 'catalog'] as const);
  const parsedLanguage = languageAt(contentLanguage, 'contentLanguage');
  const parsedKey = textAt(key, 'key', SCHEMA_V3_LIMITS.longText);
  return generatedId('course', { source: parsedSource, contentLanguage: parsedLanguage, key: parsedKey });
};

export const createScenarioId = (courseId: string, title: string): string => (
  generatedId('scenario', {
    courseId: documentSegmentAt(courseId, 'courseId', 'sourceDocumentId'),
    title: textAt(title, 'title', SCHEMA_V3_LIMITS.displayName),
  })
);

export const createCourseItemId = (courseId: string, scenarioId: string, lexemeId: string): string => (
  generatedId('course-item', {
    courseId: documentSegmentAt(courseId, 'courseId', 'sourceDocumentId'),
    scenarioId: documentSegmentAt(scenarioId, 'scenarioId', 'sourceDocumentId'),
    lexemeId: documentSegmentAt(lexemeId, 'lexemeId', 'lexemeId'),
  })
);

export function parseCourseV1(value: unknown): CourseV1 {
  const record = recordAt(value, 'course', [
    'schemaVersion', 'id', 'ownerId', 'contentLanguage', 'supportLanguage', 'title',
    'description', 'source', 'archivedAt', 'revision',
  ]);
  const source = enumAt(record.source, 'course.source', ['personal', 'catalog'] as const);
  const ownerId = record.ownerId === null
    ? null
    : documentSegmentAt(record.ownerId, 'course.ownerId', 'ownerId');
  if ((source === 'personal') !== (ownerId !== null)) {
    fail('course.ownerId', 'must match course source');
  }
  const archivedAt = record.archivedAt === null
    ? null
    : timestampAt(record.archivedAt, 'course.archivedAt');
  return {
    schemaVersion: schemaVersionAt(record.schemaVersion, 'course.schemaVersion'),
    id: documentSegmentAt(record.id, 'course.id', 'sourceDocumentId'),
    ownerId,
    contentLanguage: languageAt(record.contentLanguage, 'course.contentLanguage'),
    supportLanguage: languageAt(record.supportLanguage, 'course.supportLanguage'),
    title: textAt(record.title, 'course.title', SCHEMA_V3_LIMITS.displayName),
    description: textAt(record.description, 'course.description', SCHEMA_V3_LIMITS.longText, true),
    source,
    archivedAt,
    revision: integerAt(record.revision, 'course.revision', 1, Number.MAX_SAFE_INTEGER),
  };
}

export function parseScenarioV1(value: unknown): ScenarioV1 {
  const record = recordAt(value, 'scenario', ['schemaVersion', 'id', 'courseId', 'title', 'rank']);
  return {
    schemaVersion: schemaVersionAt(record.schemaVersion, 'scenario.schemaVersion'),
    id: documentSegmentAt(record.id, 'scenario.id', 'sourceDocumentId'),
    courseId: documentSegmentAt(record.courseId, 'scenario.courseId', 'sourceDocumentId'),
    title: textAt(record.title, 'scenario.title', SCHEMA_V3_LIMITS.displayName),
    rank: integerAt(record.rank, 'scenario.rank', 0, Number.MAX_SAFE_INTEGER),
  };
}

export function parseCourseItemV1(value: unknown): CourseItemV1 {
  const record = recordAt(value, 'courseItem', [
    'schemaVersion', 'id', 'courseId', 'scenarioId', 'lexemeId', 'rank',
  ]);
  return {
    schemaVersion: schemaVersionAt(record.schemaVersion, 'courseItem.schemaVersion'),
    id: documentSegmentAt(record.id, 'courseItem.id', 'sourceDocumentId'),
    courseId: documentSegmentAt(record.courseId, 'courseItem.courseId', 'sourceDocumentId'),
    scenarioId: documentSegmentAt(record.scenarioId, 'courseItem.scenarioId', 'sourceDocumentId'),
    lexemeId: documentSegmentAt(record.lexemeId, 'courseItem.lexemeId', 'lexemeId'),
    rank: integerAt(record.rank, 'courseItem.rank', 0, Number.MAX_SAFE_INTEGER),
  };
}

export function parseEnrollmentV1(value: unknown): EnrollmentV1 {
  const record = recordAt(value, 'enrollment', [
    'schemaVersion', 'courseId', 'activeScenarioId', 'completedScenarioIds', 'introducedItemIds', 'updatedAt',
  ]);
  return {
    schemaVersion: schemaVersionAt(record.schemaVersion, 'enrollment.schemaVersion'),
    courseId: documentSegmentAt(record.courseId, 'enrollment.courseId', 'sourceDocumentId'),
    activeScenarioId: documentSegmentAt(record.activeScenarioId, 'enrollment.activeScenarioId', 'sourceDocumentId'),
    completedScenarioIds: arrayOfIdsAt(
      record.completedScenarioIds,
      'enrollment.completedScenarioIds',
      'sourceDocumentId',
    ),
    introducedItemIds: arrayOfIdsAt(
      record.introducedItemIds,
      'enrollment.introducedItemIds',
      'sourceDocumentId',
    ),
    updatedAt: timestampAt(record.updatedAt, 'enrollment.updatedAt'),
  };
}

export function parseLearningPreferencesV1(value: unknown): LearningPreferencesV1 {
  const record = recordAt(value, 'learningPreferences', [
    'schemaVersion', 'useV3Courses', 'activeCourseByLanguage', 'focus', 'sessionSize',
  ]);
  return {
    schemaVersion: schemaVersionAt(record.schemaVersion, 'learningPreferences.schemaVersion'),
    useV3Courses: booleanAt(record.useV3Courses, 'learningPreferences.useV3Courses'),
    activeCourseByLanguage: languageMapAt(
      record.activeCourseByLanguage,
      'learningPreferences.activeCourseByLanguage',
    ),
    focus: enumAt(record.focus, 'learningPreferences.focus', ['balanced', 'learn', 'hear', 'speak'] as const),
    sessionSize: enumAt(
      record.sessionSize,
      'learningPreferences.sessionSize',
      ['short', 'standard', 'deep'] as const,
    ),
  };
}

const defaultScenario = (courseId: string): ScenarioV1 => parseScenarioV1({
  schemaVersion: 1,
  id: createScenarioId(courseId, 'Getting started'),
  courseId,
  title: 'Getting started',
  rank: 0,
});

const projection = (
  course: CourseV1,
  scenario: ScenarioV1,
  items: readonly CourseItemV1[],
  updatedAt: string,
): CourseProjectionV1 => {
  const parsedCourse = parseCourseV1(course);
  const parsedScenario = parseScenarioV1(scenario);
  if (parsedScenario.courseId !== parsedCourse.id) {
    throw new AdaptiveCourseValidationError('scenario.courseId: must match course.id');
  }
  const parsedItems = assertProjectionItems(items);
  for (const item of parsedItems) {
    if (item.courseId !== parsedCourse.id || item.scenarioId !== parsedScenario.id) {
      throw new AdaptiveCourseValidationError('items: membership does not match projection');
    }
  }
  const enrollment = parseEnrollmentV1({
    schemaVersion: 1,
    courseId: parsedCourse.id,
    activeScenarioId: parsedScenario.id,
    completedScenarioIds: [],
    introducedItemIds: [],
    updatedAt,
  });
  const preferences = parseLearningPreferencesV1({
    schemaVersion: 1,
    useV3Courses: false,
    activeCourseByLanguage: { [parsedCourse.contentLanguage]: parsedCourse.id },
    focus: 'balanced',
    sessionSize: 'standard',
  });
  return {
    course: parsedCourse,
    scenario: parsedScenario,
    items: parsedItems,
    enrollment,
    preferences,
  };
};

export const projectPersonalLibraryToCourse = ({
  ownerId,
  contentLanguage,
  supportLanguage,
  cards,
  migratedAt,
}: PersonalLibraryProjectionInput): CourseProjectionV1 => {
  const parsedOwnerId = documentSegmentAt(ownerId, 'ownerId', 'ownerId');
  const parsedContentLanguage = languageAt(contentLanguage, 'contentLanguage');
  const parsedSupportLanguage = languageAt(supportLanguage, 'supportLanguage');
  const updatedAt = timestampAt(migratedAt, 'migratedAt');
  if (cards.length > 10_000) throw new AdaptiveCourseValidationError('cards: exceeds 10000 items');
  const cardIds = cards.map((card, index) => documentSegmentAt(card.id, `cards[${index}].id`, 'lexemeId'))
    .sort((left, right) => left.localeCompare(right));
  if (new Set(cardIds).size !== cardIds.length) {
    throw new AdaptiveCourseValidationError('cards: contains duplicate IDs');
  }
  const course = parseCourseV1({
    schemaVersion: 1,
    id: createCourseId('personal', parsedContentLanguage, `${parsedOwnerId}:${parsedContentLanguage}`),
    ownerId: parsedOwnerId,
    contentLanguage: parsedContentLanguage,
    supportLanguage: parsedSupportLanguage,
    title: 'My Vocabulary',
    description: 'Your personal vocabulary',
    source: 'personal',
    archivedAt: null,
    revision: 1,
  });
  const scenario = defaultScenario(course.id);
  const items = cardIds.map((lexemeId, rank) => ({
    schemaVersion: 1 as const,
    id: createCourseItemId(course.id, scenario.id, lexemeId),
    courseId: course.id,
    scenarioId: scenario.id,
    lexemeId,
    rank,
  }));
  return projection(course, scenario, items, updatedAt);
};

export const projectCatalogEntriesToCourse = ({
  catalogId,
  releaseId,
  trackId,
  contentLanguage,
  supportLanguage,
  title,
  entries,
  createdAt,
}: CatalogEntriesProjectionInput): CourseProjectionV1 => {
  const parsedCatalogId = documentSegmentAt(catalogId, 'catalogId', 'sourceDocumentId');
  const parsedReleaseId = documentSegmentAt(releaseId, 'releaseId', 'sourceDocumentId');
  const parsedTrackId = documentSegmentAt(trackId, 'trackId', 'sourceDocumentId');
  const parsedContentLanguage = languageAt(contentLanguage, 'contentLanguage');
  const parsedSupportLanguage = languageAt(supportLanguage, 'supportLanguage');
  const parsedTitle = textAt(title, 'title', SCHEMA_V3_LIMITS.displayName);
  const updatedAt = timestampAt(createdAt, 'createdAt');
  if (entries.length > 10_000) throw new AdaptiveCourseValidationError('entries: exceeds 10000 items');
  const parsedEntries = entries.map((entry, index) => ({
    lexemeId: documentSegmentAt(entry.lexemeId, `entries[${index}].lexemeId`, 'lexemeId'),
    rank: integerAt(entry.rank, `entries[${index}].rank`, 0, Number.MAX_SAFE_INTEGER),
  })).sort((left, right) => left.rank - right.rank || left.lexemeId.localeCompare(right.lexemeId));
  if (new Set(parsedEntries.map(entry => entry.lexemeId)).size !== parsedEntries.length) {
    throw new AdaptiveCourseValidationError('entries: contains duplicate lexeme IDs');
  }
  const course = parseCourseV1({
    schemaVersion: 1,
    id: createCourseId(
      'catalog',
      parsedContentLanguage,
      `${parsedCatalogId}:${parsedReleaseId}:${parsedTrackId}`,
    ),
    ownerId: null,
    contentLanguage: parsedContentLanguage,
    supportLanguage: parsedSupportLanguage,
    title: parsedTitle,
    description: `Catalog ${parsedCatalogId} · ${parsedTrackId}`,
    source: 'catalog',
    archivedAt: null,
    revision: 1,
  });
  const scenario = defaultScenario(course.id);
  const items = parsedEntries.map(({ lexemeId }, rank) => ({
    schemaVersion: 1 as const,
    id: createCourseItemId(course.id, scenario.id, lexemeId),
    courseId: course.id,
    scenarioId: scenario.id,
    lexemeId,
    rank,
  }));
  return projection(course, scenario, items, updatedAt);
};
