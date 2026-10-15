import {
  COURSE_NATIVE_LANGUAGES,
  COURSE_TARGET_LANGUAGES,
  type CourseNativeLanguage,
  type CourseTargetLanguage,
} from './course-profile-contract.js';

export class InputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputValidationError';
  }
}

export function parsePurchaseIntentRequest(value: unknown): { trigger: 'quota' | 'menu'; expectedOwnerId?: string; offerVersion?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputValidationError('Purchase intent must be an object.');
  }
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some(key => key !== 'trigger' && key !== 'expectedOwnerId' && key !== 'offerVersion') || !Object.hasOwn(source, 'trigger')
    || (source.trigger !== 'quota' && source.trigger !== 'menu')) {
    throw new InputValidationError('Purchase intent trigger must be quota or menu.');
  }
  const expectedOwnerId = parseExpectedOwnerId(source.expectedOwnerId);
  if (source.offerVersion !== undefined && (typeof source.offerVersion !== 'string' || !/^[a-f0-9]{64}$/.test(source.offerVersion))) {
    throw new InputValidationError('Purchase intent offer version is invalid.');
  }
  return {
    trigger: source.trigger,
    ...(expectedOwnerId === undefined ? {} : { expectedOwnerId }),
    ...(source.offerVersion === undefined ? {} : { offerVersion: source.offerVersion }),
  };
}

export const PART_OF_SPEECH_HINTS = [
  'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction',
  'determiner', 'interjection', 'phrasal verb', 'auxiliary verb', 'modal verb',
  'article', 'numeral', 'idiom', 'phrase',
] as const;

export type PartOfSpeechHint = typeof PART_OF_SPEECH_HINTS[number];

type VocabularyRequest =
  | { action: 'word'; word: string; operationId?: string; context?: string; language?: { source: string; target: string }; partOfSpeech?: PartOfSpeechHint }
  | { action: 'story'; words: string[]; targetLanguage: CourseTargetLanguage; translationLanguage: CourseNativeLanguage }
  | { action: 'translate'; text: string };

type ImageRequest = { word: string; query: string };

export type SharedCardInput = {
  lexemeId?: string;
  language?: string;
  senseKey?: string;
  normalizedLemma?: string;
  word: string;
  translation: string;
  origin?: 'ai' | 'manual';
  explanation: string;
  explanationTranslation: string;
  phonetic: string;
  category: string;
  partOfSpeech: string;
  cefrLevel: string;
  exampleSentence: string;
  exampleTranslation: string;
  collocations: string[];
  synonyms: string[];
  antonyms: string[];
  register: string;
  commonMistake: string;
  imageSearchQuery: string;
  emoji: string;
  audioUrl: string | null;
  imageUrl: string | null;
  mnemonic?: string;
  wordFamily?: SharedCardWordFamily;
};

export type SharedCardWordFamily = Partial<Record<'noun' | 'verb' | 'adj' | 'adv', string>>;

export type CreateSharedDeckRequest = {
  expectedOwnerId?: string;
  opId?: string;
  operationCreatedAt?: string;
  category: string;
  cards: SharedCardInput[];
  targetLanguage?: string;
  nativeLanguage?: string;
};

export const LEGACY_SHARED_DECK_OPERATION_COMPATIBILITY_END = '2026-12-31T23:59:59.999Z';
const STRICT_SHARED_DECK_OPERATION_ID = /^share-v2:(\d{13}):[A-Za-z0-9_-]{1,96}$/;

export const sharedDeckRequestFingerprint = (input: CreateSharedDeckRequest): string => createHash('sha256')
  .update(JSON.stringify({
    category: input.category, cards: input.cards, operationCreatedAt: input.operationCreatedAt,
    targetLanguage: input.targetLanguage, nativeLanguage: input.nativeLanguage,
  }))
  .digest('hex');

export const strictSharedDeckOperationMatches = (input: CreateSharedDeckRequest): boolean => {
  if (!input.opId || !input.operationCreatedAt) return false;
  const match = STRICT_SHARED_DECK_OPERATION_ID.exec(input.opId);
  const operationMillis = Date.parse(input.operationCreatedAt);
  return match !== null
    && Number.isSafeInteger(operationMillis)
    && new Date(operationMillis).toISOString() === input.operationCreatedAt
    && Number(match[1]) === operationMillis;
};

export const sharedDeckRequestOwnerMatches = (
  expectedOwnerId: string | undefined,
  authenticatedOwnerId: string,
): boolean => expectedOwnerId !== undefined && expectedOwnerId === authenticatedOwnerId;

export const calculateSharedDeckPayloadBytes = (input: CreateSharedDeckRequest): number =>
  new TextEncoder().encode(JSON.stringify({
    category: input.category, cards: input.cards,
    ...(input.targetLanguage ? { targetLanguage: input.targetLanguage, nativeLanguage: input.nativeLanguage } : {}),
  })).byteLength;

export type DuplicateCleanupRequest = {
  action: 'run' | 'status';
  jobId: string;
  dryRun: boolean;
  chunkSize: number;
};

export type LegacyLibraryMigrationRequest = {
  batchSize: number;
  dryRun: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
);

const boundedText = (value: unknown, maximum: number) => typeof value === 'string'
  ? value.trim().slice(0, maximum)
  : '';

const boundedLanguageCode = (value: unknown, invalidMessage: string, lowercase = false) => {
  if (typeof value === 'string' && value.trim().length > 16) {
    throw new InputValidationError(invalidMessage);
  }
  const text = boundedText(value, 16);
  return lowercase ? text.toLowerCase() : text;
};

const parsePartOfSpeechHint = (value: unknown): PartOfSpeechHint | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > 64) {
    throw new InputValidationError('Part of speech hint is invalid.');
  }
  const normalized = value.trim().toLocaleLowerCase('en-US');
  if (!PART_OF_SPEECH_HINTS.includes(normalized as PartOfSpeechHint)) {
    throw new InputValidationError('Part of speech hint is invalid.');
  }
  return normalized as PartOfSpeechHint;
};

export const isCanonicalLanguageCode = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length <= 16
  && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(value)
);

export const isSupportedCardTranslationLanguage = (value: unknown): value is 'en' | 'vi' => (
  value === 'en' || value === 'vi'
);

export type CardLanguageFields = {
  language?: string;
  translationLanguage?: string;
};

/**
 * Validate card language metadata independently from the canonical lexeme
 * tuple. Wave-1 meaning languages are en/vi. Legacy cards may provide either
 * field; missing values are resolved to en/vi by read models and are not
 * written here.
 */
export const parseCardLanguagePair = (value: unknown): CardLanguageFields => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputValidationError('Card language fields must be an object.');
  }
  const source = value as Record<string, unknown>;
  const result: CardLanguageFields = {};
  for (const field of ['language', 'translationLanguage'] as const) {
    if (source[field] === undefined) continue;
    const code = boundedLanguageCode(source[field], 'Card language codes are invalid.', true);
    if (!isCanonicalLanguageCode(code)) throw new InputValidationError('Card language codes are invalid.');
    if (field === 'translationLanguage' && !isSupportedCardTranslationLanguage(code)) {
      throw new InputValidationError('Card language codes are invalid.');
    }
    result[field] = code;
  }
  return result;
};

export type CardSourceMetadata = {
  url?: string;
  title?: string;
  context?: string;
  capturedAt?: string;
};

const CARD_SOURCE_FIELDS = ['url', 'title', 'context', 'capturedAt'] as const;
const CARD_SOURCE_URL_MAX_LENGTH = 2_048;
const CARD_SOURCE_TITLE_MAX_LENGTH = 256;
const CARD_SOURCE_CONTEXT_MAX_LENGTH = 500;

const boundedSourceText = (value: unknown, field: string, maximum: number): string => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > maximum) {
    throw new InputValidationError(`Card source ${field} is invalid.`);
  }
  return value.trim();
};

/**
 * Strip credentials, the query string, and the fragment before persisting a
 * captured page URL. Query and fragment routinely carry session tokens, auth
 * codes, or tracking identifiers that add privacy risk without adding value
 * for "which page did this word come from" — origin + pathname is enough to
 * recognize or revisit the page. http/https only; anything else (javascript:,
 * data:, chrome-extension:, file:, …) is rejected outright.
 */
const trustedCardSourceUrl = (value: unknown): string => {
  const text = boundedSourceText(value, 'url', CARD_SOURCE_URL_MAX_LENGTH);
  if (!text) return '';
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new InputValidationError('Card source url is invalid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InputValidationError('Card source url is invalid.');
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  const serialized = url.toString();
  if (serialized.length > CARD_SOURCE_URL_MAX_LENGTH) {
    throw new InputValidationError('Card source url is invalid.');
  }
  return serialized;
};

const parseCardSourceCapturedAt = (value: unknown): string => {
  const text = boundedSourceText(value, 'capturedAt', 128);
  if (!text) return '';
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) throw new InputValidationError('Card source capturedAt is invalid.');
  return new Date(parsed).toISOString();
};

/**
 * Bounded metadata for a card captured from a web page via the browser
 * extension. Every field is optional and independent; a card created inside
 * the app (or any legacy card) simply omits `source`, and nothing here ever
 * guesses or backfills one. `canonicalCard` only calls this at creation time
 * — Firestore Rules separately deny any client update that touches `source`,
 * so once set it is immutable for the life of the card.
 */
export const parseCardSourceMetadata = (value: unknown): CardSourceMetadata | undefined => {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputValidationError('Card source must be an object.');
  }
  const source = value as Record<string, unknown>;
  assertAllowedFields(source, CARD_SOURCE_FIELDS, 'Card source contains an unsupported field.');
  const url = trustedCardSourceUrl(source.url);
  const title = boundedSourceText(source.title, 'title', CARD_SOURCE_TITLE_MAX_LENGTH);
  const context = boundedSourceText(source.context, 'context', CARD_SOURCE_CONTEXT_MAX_LENGTH);
  const capturedAt = parseCardSourceCapturedAt(source.capturedAt);
  if (!url && !title && !context && !capturedAt) return undefined;
  return {
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
    ...(context ? { context } : {}),
    ...(capturedAt ? { capturedAt } : {}),
  };
};

export const canonicalLexemeId = (language: string, lemma: string, partOfSpeech: string, senseKey: string): string => {
  const component = (value: string, lowercase = false) => {
    const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
    return lowercase ? normalized.toLowerCase() : normalized;
  };
  const bytes = Buffer.from(JSON.stringify([
    component(language, true), component(lemma), component(partOfSpeech, true), component(senseKey, true),
  ])).toString('hex');
  const value = `\u0000${bytes}`;
  const slug = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
  return `lexeme-${slug}-${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
};

const assertAllowedFields = (
  source: Record<string, unknown>,
  allowed: readonly string[],
  message: string,
): void => {
  if (Object.keys(source).some(key => !allowed.includes(key))) throw new InputValidationError(message);
};

/**
 * Word-generation source languages with a shipped language pack (headword
 * script handling, romanization/furigana/pinyin reading, speech scoring).
 * Adding a language here without a pack lets learners request generation for
 * a language the UI and speech pipeline cannot render or score correctly, so
 * this list is intentionally the same set as `LANGUAGE_PACK_IDS`.
 */
const SUPPORTED_WORD_LANGUAGE_SOURCES = ['en', 'ko', 'ja', 'zh'] as const;
/** Meaning languages the generation prompt is tuned to translate into. */
const SUPPORTED_WORD_LANGUAGE_TARGETS = ['en', 'vi'] as const;

export const isSupportedWordLanguagePair = (source: string, target: string): boolean => (
  (SUPPORTED_WORD_LANGUAGE_SOURCES as readonly string[]).includes(source)
  && (SUPPORTED_WORD_LANGUAGE_TARGETS as readonly string[]).includes(target)
  && source !== target
);

const parseWordLanguage = (value: unknown): { source: string; target: string } | undefined => {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputValidationError('Word language must be an object.');
  }
  const language = value as Record<string, unknown>;
  assertAllowedFields(language, ['source', 'target'], 'Unsupported word language field.');
  const source = boundedLanguageCode(language.source, 'Word language codes are invalid.', true);
  const target = boundedLanguageCode(language.target, 'Word language codes are invalid.', true);
  if (!isCanonicalLanguageCode(source) || !isCanonicalLanguageCode(target)) {
    throw new InputValidationError('Word language codes are invalid.');
  }
  if (!isSupportedWordLanguagePair(source, target)) {
    throw new InputValidationError('This language pair is not supported for generation yet.');
  }
  return { source, target };
};

const parseSharedDeckLanguagePair = (data: Record<string, unknown>): {
  targetLanguage?: string;
  nativeLanguage?: string;
} => {
  const hasTarget = data.targetLanguage !== undefined;
  const hasNative = data.nativeLanguage !== undefined;
  if (!hasTarget && !hasNative) return {};
  if (!hasTarget || !hasNative) throw new InputValidationError('Shared-deck language fields must be provided together.');
  const targetLanguage = boundedLanguageCode(data.targetLanguage, 'Shared-deck language codes are invalid.', true);
  const nativeLanguage = boundedLanguageCode(data.nativeLanguage, 'Shared-deck language codes are invalid.', true);
  if (!isCanonicalLanguageCode(targetLanguage) || !isCanonicalLanguageCode(nativeLanguage)) {
    throw new InputValidationError('Shared-deck language codes are invalid.');
  }
  return { targetLanguage, nativeLanguage };
};

const boundedTextList = (value: unknown): string[] => Array.isArray(value)
  ? value.slice(0, 4).flatMap(item => {
      const text = boundedText(item, 100);
      return text ? [text] : [];
    })
  : [];

const boundedWordFamily = (value: unknown): SharedCardWordFamily | undefined => {
  const source = asRecord(value);
  const family: SharedCardWordFamily = {};
  for (const key of ['noun', 'verb', 'adj', 'adv'] as const) {
    const text = boundedText(source[key], 100);
    if (text) family[key] = text;
  }
  return Object.keys(family).length > 0 ? family : undefined;
};

const trustedHttpsUrl = (
  value: unknown,
  allowedHosts: ReadonlySet<string>,
  label: string,
): string | null => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2_048) {
    throw new InputValidationError(`A shared card contains an invalid ${label} URL.`);
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) {
      throw new Error('untrusted');
    }
    return url.toString();
  } catch {
    throw new InputValidationError(`A shared card contains an untrusted ${label} URL.`);
  }
};

const SHARED_IMAGE_HOSTS = new Set([
  'images.pexels.com',
  'images.unsplash.com',
  'upload.wikimedia.org',
]);
const SHARED_AUDIO_HOSTS = new Set([
  'api.dictionaryapi.dev',
  'ssl.gstatic.com',
]);

const WORD_OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const parseExpectedOwnerId = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || value.includes('/')) {
    throw new InputValidationError('Expected owner is invalid.');
  }
  return value;
};

export const parseCancelCardGenerationRequest = (value: unknown): string => {
  const data = asRecord(value);
  assertAllowedFields(data, ['operationId', 'expectedOwnerId'], 'Unsupported cancellation field.');
  parseExpectedOwnerId(data.expectedOwnerId);
  if (typeof data.operationId !== 'string' || !WORD_OPERATION_ID.test(data.operationId)) {
    throw new InputValidationError('Operation ID must be a UUID v4.');
  }
  return data.operationId;
};

export const parseVocabularyRequest = (value: unknown): VocabularyRequest => {
  const data = asRecord(value);
  assertAllowedFields(data, ['action', 'input', 'operationId', 'expectedOwnerId'], 'Unsupported vocabulary request field.');
  parseExpectedOwnerId(data.expectedOwnerId);
  const action = boundedText(data.action, 16);
  const operationId = data.operationId === undefined ? undefined : data.operationId;
  if (operationId !== undefined && (action !== 'word' || typeof operationId !== 'string'
    || !WORD_OPERATION_ID.test(operationId))) {
    throw new InputValidationError('Operation ID must be a UUID v4 for a word request.');
  }

  if (action === 'word') {
    if (typeof data.input === 'string') {
      const word = boundedText(data.input, 80);
      if (!word) throw new InputValidationError('A word is required.');
      return { action, word, ...(operationId ? { operationId } : {}) };
    }
    if (!data.input || typeof data.input !== 'object' || Array.isArray(data.input)) {
      throw new InputValidationError('A word is required.');
    }
    const input = data.input as Record<string, unknown>;
    assertAllowedFields(input, ['term', 'context', 'language', 'partOfSpeech'], 'Unsupported word input field.');
    const word = boundedText(input.term, 80);
    if (!word) throw new InputValidationError('A word is required.');
    if (input.context !== undefined && typeof input.context !== 'string') {
      throw new InputValidationError('Word context must be a string.');
    }
    const context = boundedText(input.context, 500).replace(/\s+/g, ' ');
    const language = parseWordLanguage(input.language);
    const partOfSpeech = parsePartOfSpeechHint(input.partOfSpeech);
    return {
      action,
      word,
      ...(operationId ? { operationId } : {}),
      ...(context ? { context } : {}),
      ...(language ? { language } : {}),
      ...(partOfSpeech ? { partOfSpeech } : {}),
    };
  }

  if (action === 'story') {
    const legacyInput = Array.isArray(data.input);
    if (!legacyInput && (!data.input || typeof data.input !== 'object')) {
      throw new InputValidationError('At least one word is required.');
    }
    const input = legacyInput ? undefined : data.input as Record<string, unknown>;
    if (input) assertAllowedFields(input, ['words', 'targetLanguage', 'translationLanguage'], 'Unsupported story input field.');
    const wordInput = legacyInput ? data.input : input?.words;
    if (!Array.isArray(wordInput)) throw new InputValidationError('At least one word is required.');
    if (wordInput.length > 5) {
      throw new InputValidationError('A story can contain at most five words.');
    }
    const words = wordInput.map(item => boundedText(item, 80)).filter(Boolean);
    if (words.length === 0) throw new InputValidationError('At least one word is required.');
    const targetLanguage = legacyInput ? 'en' : input?.targetLanguage;
    const translationLanguage = legacyInput ? 'vi' : input?.translationLanguage;
    if (typeof targetLanguage !== 'string' || !COURSE_TARGET_LANGUAGES.includes(targetLanguage as CourseTargetLanguage)) {
      throw new InputValidationError('Story target language is invalid.');
    }
    if (typeof translationLanguage !== 'string'
      || !COURSE_NATIVE_LANGUAGES.includes(translationLanguage as CourseNativeLanguage)) {
      throw new InputValidationError('Story translation language is invalid.');
    }
    return {
      action,
      words,
      targetLanguage: targetLanguage as CourseTargetLanguage,
      translationLanguage: translationLanguage as CourseNativeLanguage,
    };
  }

  if (action === 'translate') {
    const text = boundedText(data.input, 2_048);
    if (!text) throw new InputValidationError('Text is required.');
    return { action, text };
  }

  throw new InputValidationError('Unsupported AI action.');
};

export const parseImageRequest = (value: unknown): ImageRequest => {
  const data = asRecord(value);
  const word = boundedText(data.word, 80);
  if (!word) throw new InputValidationError('A word is required.');
  const query = boundedText(data.query, 160) || word;
  return { word, query };
};

export const parseCreateSharedDeckRequest = (value: unknown): CreateSharedDeckRequest => {
  const data = asRecord(value);
  if (!Array.isArray(data.cards) || data.cards.length === 0) {
    throw new InputValidationError('A shared deck must contain at least one card.');
  }
  if (data.cards.length > 100) {
    throw new InputValidationError('A shared deck can contain at most 100 cards.');
  }

  const cards = data.cards.map((rawCard): SharedCardInput => {
    const card = asRecord(rawCard);
    const word = boundedText(card.word, 256);
    const translation = boundedText(card.translation, 256);
    if (!word || !translation) {
      throw new InputValidationError('Every shared card requires a word and translation.');
    }
    const mnemonic = boundedText(card.mnemonic, 2_048);
    const wordFamily = boundedWordFamily(card.wordFamily);
    const origin = card.origin;
    if (origin !== undefined && origin !== 'ai' && origin !== 'manual') {
      throw new InputValidationError('A shared card origin is invalid.');
    }
    const lexemeId = boundedText(card.lexemeId, 128);
    const senseKey = boundedText(card.senseKey, 128);
    const partOfSpeech = boundedText(card.partOfSpeech, 64);
    const normalizedLemma = boundedText(card.normalizedLemma, 256) || word;
    const hasCanonicalIdentity = Boolean(lexemeId || senseKey || card.normalizedLemma !== undefined);
    const language = card.language === undefined
      ? undefined
      : typeof card.language === 'string' && card.language.trim().length <= 16
        ? boundedLanguageCode(card.language, 'A shared card has an invalid language code.', true)
        : '';
    if (card.language !== undefined && !isCanonicalLanguageCode(language)) {
      throw new InputValidationError(hasCanonicalIdentity
        ? 'A shared card has an invalid lexeme identity.'
        : 'A shared card has an invalid language code.');
    }
    if (hasCanonicalIdentity && (!language || !senseKey || !partOfSpeech
      || lexemeId !== canonicalLexemeId(language, normalizedLemma, partOfSpeech, senseKey))) {
      throw new InputValidationError('A shared card has an invalid lexeme identity.');
    }
    return {
      ...(hasCanonicalIdentity ? { lexemeId, language, senseKey, normalizedLemma } : {}),
      ...(!hasCanonicalIdentity && language ? { language } : {}),
      word,
      translation,
      ...(origin ? { origin } : {}),
      explanation: boundedText(card.explanation, 2_048),
      explanationTranslation: boundedText(card.explanationTranslation, 2_048),
      phonetic: boundedText(card.phonetic, 256),
      category: boundedText(card.category, 128),
      partOfSpeech,
      cefrLevel: boundedText(card.cefrLevel, 8),
      exampleSentence: boundedText(card.exampleSentence, 2_048),
      exampleTranslation: boundedText(card.exampleTranslation, 2_048),
      collocations: boundedTextList(card.collocations),
      synonyms: boundedTextList(card.synonyms),
      antonyms: boundedTextList(card.antonyms),
      register: boundedText(card.register, 64),
      commonMistake: boundedText(card.commonMistake, 2_048),
      imageSearchQuery: boundedText(card.imageSearchQuery, 120),
      emoji: boundedText(card.emoji, 64),
      audioUrl: trustedHttpsUrl(card.audioUrl, SHARED_AUDIO_HOSTS, 'audio'),
      imageUrl: trustedHttpsUrl(card.imageUrl, SHARED_IMAGE_HOSTS, 'image'),
      ...(mnemonic ? { mnemonic } : {}),
      ...(wordFamily ? { wordFamily } : {}),
    };
  });
  const category = boundedText(data.category, 128) || 'Shared';
  const expectedOwnerId = typeof data.expectedOwnerId === 'string'
    && data.expectedOwnerId.length > 0
    && data.expectedOwnerId.length <= 128
    ? data.expectedOwnerId
    : '';
  const opId = boundedText(data.opId, 128);
  if (data.opId !== undefined && (!opId || (!/^[a-zA-Z0-9_-]+$/.test(opId)
    && !STRICT_SHARED_DECK_OPERATION_ID.test(opId)))) {
    throw new InputValidationError('Shared-deck operation ID is invalid.');
  }
  let operationCreatedAt = '';
  if (data.operationCreatedAt !== undefined) {
    if (typeof data.operationCreatedAt !== 'string' || !Number.isFinite(Date.parse(data.operationCreatedAt))) {
      throw new InputValidationError('Shared-deck operation time is invalid.');
    }
    operationCreatedAt = new Date(Date.parse(data.operationCreatedAt)).toISOString();
  }
  const languagePair = parseSharedDeckLanguagePair(data);
  if (languagePair.targetLanguage && cards.some(card => (
    card.language !== undefined && card.language !== languagePair.targetLanguage
  ))) {
    throw new InputValidationError('A shared-deck target language must match every canonical card language.');
  }
  const normalized = {
    ...(expectedOwnerId ? { expectedOwnerId } : {}),
    ...(opId ? { opId } : {}),
    ...(operationCreatedAt ? { operationCreatedAt } : {}),
    category,
    cards,
    ...languagePair,
  };
  if (calculateSharedDeckPayloadBytes(normalized) > 750_000) {
    throw new InputValidationError('The shared deck is too large.');
  }
  return normalized;
};

export const parseRevokeSharedDeckRequest = (value: unknown): { shareId: string } => {
  const shareId = boundedText(asRecord(value).shareId, 128);
  if (!shareId || !/^[a-zA-Z0-9_-]+$/.test(shareId)) {
    throw new InputValidationError('A valid share ID is required.');
  }
  return { shareId };
};

export const parseDuplicateCleanupRequest = (value: unknown): DuplicateCleanupRequest => {
  const data = asRecord(value);
  const action = boundedText(data.action, 16) || 'run';
  if (action !== 'run' && action !== 'status') {
    throw new InputValidationError('Unsupported duplicate cleanup action.');
  }
  const jobId = boundedText(data.jobId, 48);
  if (!jobId || !/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    throw new InputValidationError('A valid cleanup job ID is required.');
  }
  const requestedChunkSize = typeof data.chunkSize === 'number' && Number.isFinite(data.chunkSize)
    ? Math.floor(data.chunkSize)
    : 50;
  return {
    action,
    jobId,
    dryRun: data.dryRun === false ? false : true,
    chunkSize: Math.max(10, Math.min(100, requestedChunkSize)),
  };
};

export const parseLegacyLibraryMigrationRequest = (
  value: unknown,
): LegacyLibraryMigrationRequest => {
  const data = asRecord(value);
  const allowed = new Set(['batchSize', 'dryRun']);
  if (Object.keys(data).some(key => !allowed.has(key))) {
    throw new InputValidationError('Unsupported library migration field.');
  }
  if (data.batchSize !== undefined && (
    typeof data.batchSize !== 'number' || !Number.isFinite(data.batchSize)
  )) {
    throw new InputValidationError('Library migration batchSize must be a finite number.');
  }
  if (data.dryRun !== undefined && typeof data.dryRun !== 'boolean') {
    throw new InputValidationError('Library migration dryRun must be a boolean.');
  }
  const requestedBatchSize = data.batchSize === undefined ? 100 : Math.floor(data.batchSize);
  return {
    batchSize: Math.max(10, Math.min(100, requestedBatchSize)),
    dryRun: data.dryRun === undefined ? true : data.dryRun,
  };
};
import { createHash } from 'node:crypto';
