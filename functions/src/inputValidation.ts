export class InputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputValidationError';
  }
}

type VocabularyRequest =
  | { action: 'word'; word: string }
  | { action: 'story'; words: string[] }
  | { action: 'translate'; text: string };

type ImageRequest = { word: string; query: string };

export type SharedCardInput = {
  word: string;
  translation: string;
  explanation: string;
  phonetic: string;
  category: string;
  partOfSpeech: string;
  emoji: string;
  audioUrl: string | null;
  imageUrl: string | null;
};

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

const asRecord = (value: unknown): Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
);

const boundedText = (value: unknown, maximum: number) => typeof value === 'string'
  ? value.trim().slice(0, maximum)
  : '';

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
  const action = boundedText(data.action, 16);

  if (action === 'word') {
    const word = boundedText(data.input, 80);
    if (!word) throw new InputValidationError('A word is required.');
    return { action, word };
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
    return {
      word,
      translation,
      explanation: boundedText(card.explanation, 2_048),
      phonetic: boundedText(card.phonetic, 256),
      category: boundedText(card.category, 128),
      partOfSpeech: boundedText(card.partOfSpeech, 64),
      emoji: boundedText(card.emoji, 64),
      audioUrl: trustedHttpsUrl(card.audioUrl, SHARED_AUDIO_HOSTS, 'audio'),
      imageUrl: trustedHttpsUrl(card.imageUrl, SHARED_IMAGE_HOSTS, 'image'),
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
