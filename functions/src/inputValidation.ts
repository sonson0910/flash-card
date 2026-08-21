export class InputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputValidationError';
  }
}

type VocabularyRequest =
  | { action: 'word'; word: string; context?: string; language?: { source: string; target: string } }
  | { action: 'story'; words: string[] }
  | { action: 'translate'; text: string };

type ImageRequest = { word: string; query: string };

export type SharedCardInput = {
  word: string;
  translation: string;
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
  category: string;
  cards: SharedCardInput[];
};

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

const assertAllowedFields = (
  source: Record<string, unknown>,
  allowed: readonly string[],
  message: string,
): void => {
  if (Object.keys(source).some(key => !allowed.includes(key))) {
    throw new InputValidationError(message);
  }
};

const parseWordLanguage = (value: unknown): { source: string; target: string } | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InputValidationError('Word language must be an object.');
  }
  const language = value as Record<string, unknown>;
  assertAllowedFields(language, ['source', 'target'], 'Unsupported word language field.');
  const source = boundedText(language.source, 16).toLowerCase();
  const target = boundedText(language.target, 16).toLowerCase();
  if (!/^[a-z]{2,8}(?:-[a-z]{2,8})?$/.test(source)
    || !/^[a-z]{2,8}(?:-[a-z]{2,8})?$/.test(target)) {
    throw new InputValidationError('Word language codes are invalid.');
  }
  return { source, target };
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

export const parseVocabularyRequest = (value: unknown): VocabularyRequest => {
  const data = asRecord(value);
  assertAllowedFields(data, ['action', 'input'], 'Unsupported vocabulary request field.');
  const action = boundedText(data.action, 16);

  if (action === 'word') {
    if (typeof data.input === 'string') {
      const word = boundedText(data.input, 80);
      if (!word) throw new InputValidationError('A word is required.');
      return { action, word };
    }
    if (typeof data.input !== 'object' || data.input === null || Array.isArray(data.input)) {
      throw new InputValidationError('A word is required.');
    }
    const structured = data.input as Record<string, unknown>;
    assertAllowedFields(structured, ['term', 'context', 'language'], 'Unsupported word input field.');
    const word = boundedText(structured.term, 80);
    if (!word) throw new InputValidationError('A word is required.');
    if (structured.context !== undefined && typeof structured.context !== 'string') {
      throw new InputValidationError('Word context must be a string.');
    }
    const context = typeof structured.context === 'string'
      ? boundedText(structured.context, 500).replace(/\s+/g, ' ')
      : '';
    const language = parseWordLanguage(structured.language);
    return {
      action,
      word,
      ...(context ? { context } : {}),
      ...(language ? { language } : {}),
    };
  }

  if (action === 'story') {
    if (!Array.isArray(data.input)) {
      throw new InputValidationError('At least one word is required.');
    }
    if (data.input.length > 5) {
      throw new InputValidationError('A story can contain at most five words.');
    }
    const words = data.input.map(item => boundedText(item, 80)).filter(Boolean);
    if (words.length === 0) throw new InputValidationError('At least one word is required.');
    return { action, words };
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
    return {
      word,
      translation,
      explanation: boundedText(card.explanation, 2_048),
      explanationTranslation: boundedText(card.explanationTranslation, 2_048),
      phonetic: boundedText(card.phonetic, 256),
      category: boundedText(card.category, 128),
      partOfSpeech: boundedText(card.partOfSpeech, 64),
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
  const normalized = { category, cards };
  if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > 750_000) {
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
